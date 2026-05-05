// packages/cli/src/commands/extract.ts
//
// `bd extract <markdown-files...>` — find Mermaid/PlantUML fenced blocks in
// each Markdown file and either:
//
//   inline mode (default, no --assets-dir): inject a /v1/beautify.svg embed
//   URL directly after each fence — no API calls, no files written, no quota.
//   Anonymous endpoint → watermarked output.
//
//   sidecar mode (--assets-dir <path>): render each block to a local SVG via
//   /v1/export and inject a relative image reference. Plan-aware (pro/premium
//   get watermark-free SVG). Existing behaviour before 1.4.0.
//
// Idempotency:
//   inline: URL encodes the source deterministically; re-running with unchanged
//   source produces identical URL → no diff. When source changes the old URL is
//   replaced.
//
//   sidecar: 8-char content hash in filename and marker; skip when both the
//   file on disk and the marker are current.
//
// Inline size cap: blocks whose UTF-8 byte length exceeds 5 120 bytes are
// skipped in inline mode (URL length limits). A warning is printed and the
// exit code is set to 1.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir, platform } from "node:os";
import { ApiClient } from "../lib/api-client.js";
import { getBoolFlag, getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { pMap } from "../lib/concurrency.js";
import { exportOne } from "../lib/exporter.js";
import { assertWithinRoot, writeFileAtomic } from "../lib/io.js";
import {
  applyImageMarkers,
  computeBlockHash,
  parseDiagramBlocks,
  type DiagramBlock,
  type RenderedImage,
} from "../lib/markdown.js";

const DEFAULT_CONCURRENCY = 4;
const INLINE_SIZE_CAP = 5120; // 5 KB in bytes

// ---------------------------------------------------------------------------
// State file — tracks one-time hints shown to the user.
// ---------------------------------------------------------------------------

function bdStateDir(): string {
  if (platform() === "win32") {
    const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
    return path.join(appdata, "bd");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return path.join(xdg, "bd");
}

export function bdStateFilePath(): string {
  return path.join(bdStateDir(), "state.json");
}

export type BdState = {
  extractInlineHintShown?: boolean;
};

export function readBdState(): BdState {
  const file = bdStateFilePath();
  try {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, "utf8");
    return JSON.parse(raw) as BdState;
  } catch {
    return {};
  }
}

export function writeBdState(state: BdState): void {
  try {
    const dir = bdStateDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(bdStateFilePath(), JSON.stringify(state, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Silently ignore — hint will just show again next time.
  }
}

// ---------------------------------------------------------------------------
// Inline embed URL helpers
// ---------------------------------------------------------------------------

export function buildInlineUrl(
  baseUrl: string,
  source: string,
  theme: string | undefined,
): string {
  const encoded = Buffer.from(source, "utf8").toString("base64url");
  const themeQuery = theme ? `&theme=${encodeURIComponent(theme)}` : "";
  return `${baseUrl}/v1/beautify.svg?source=${encoded}${themeQuery}`;
}

/**
 * Parse the `source` query param from an existing inline embed URL, decode it,
 * and return the source string. Returns null when the URL is not a beautify.svg
 * inline URL or the param is missing/malformed.
 */
export function parseInlineUrlSource(url: string): string | null {
  try {
    const u = new URL(url);
    const src = u.searchParams.get("source");
    if (!src) return null;
    return Buffer.from(src, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline marker helpers — the bd:inline-img marker pair for inline mode.
// ---------------------------------------------------------------------------

const INLINE_MARKER_RE = /^(\s*\n)?<!-- bd:inline-img hash=([0-9a-f]+) -->\n!\[.*?\]\(([^)]+)\)\n<!-- \/bd:inline-img -->\n?/;

function renderInlineMarker(hash: string, url: string, alt: string): string {
  const safeAlt = alt.replace(/[\[\]]/g, "");
  return `\n<!-- bd:inline-img hash=${hash} -->\n![${safeAlt}](${url})\n<!-- /bd:inline-img -->\n`;
}

function findExistingInlineMarker(
  text: string,
  fromOffset: number,
): { start: number; end: number; hash: string; url: string } | null {
  const tail = text.slice(fromOffset);
  const m = /^(\s*\n)?<!-- bd:inline-img hash=([0-9a-f]+) -->\n!\[.*?\]\(([^)]+)\)\n<!-- \/bd:inline-img -->\n?/.exec(tail);
  if (!m) return null;
  return {
    start: fromOffset,
    end: fromOffset + m[0].length,
    hash: m[2]!,
    url: m[3]!,
  };
}

// ---------------------------------------------------------------------------
// Sidecar helpers (unchanged from pre-1.4.0)
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "diagram";
}

function altFromBlock(block: DiagramBlock, index: number): string {
  const titleMatch = /^\s*(?:title|%%\s*title:?)\s+([^\n]+)/im.exec(block.source);
  if (titleMatch) return titleMatch[1]!.trim().slice(0, 80);
  return `Diagram ${index + 1}`;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function toPosix(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

function ensureRelativePrefix(rel: string): string {
  if (rel.startsWith(".") || rel.startsWith("/")) return rel;
  return `./${rel}`;
}

function hasMarkerAfter(text: string, fromOffset: number, expectedHash: string): boolean {
  const tail = text.slice(fromOffset);
  const m = /^(\s*\n)?<!-- bd:img hash=([0-9a-f]+) -->/.exec(tail);
  return !!m && m[2] === expectedHash;
}

function canContain(targetAbs: string, rootAbs: string): boolean {
  try { assertWithinRoot(targetAbs, rootAbs); return true; } catch { return false; }
}

function removeOrphanAssets(
  assetsAbs: string,
  docSlug: string,
  keepFilenames: string[],
  dryRun: boolean,
): number {
  if (!existsSync(assetsAbs)) return 0;
  const keep = new Set(keepFilenames);
  let removed = 0;
  for (const name of readdirSync(assetsAbs)) {
    if (!name.startsWith(`${docSlug}-`)) continue;
    if (!name.endsWith(".svg")) continue;
    if (keep.has(name)) continue;
    if (!dryRun) {
      try { unlinkSync(path.join(assetsAbs, name)); } catch { continue; }
    }
    removed += 1;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// ProcessedDoc type
// ---------------------------------------------------------------------------

type ProcessedDoc = {
  file: string;
  rendered: number;
  skipped: number;
  cleaned: number;
};

// ---------------------------------------------------------------------------
// Inline mode processing for a single document
// ---------------------------------------------------------------------------

async function processInlineDoc(
  mdPath: string,
  original: string,
  baseUrl: string,
  theme: string | undefined,
  dryRun: boolean,
): Promise<{ doc: ProcessedDoc; exitCode: number }> {
  const blocks = parseDiagramBlocks(original);
  if (blocks.length === 0) {
    process.stderr.write(`${mdPath}: no diagram blocks found, skipping.\n`);
    return { doc: { file: mdPath, rendered: 0, skipped: 0, cleaned: 0 }, exitCode: 0 };
  }

  let docExitCode = 0;
  let rendered = 0;
  let skipped = 0;

  // We work on a mutable copy of the document text, walking from the END to
  // avoid offset drift from insertions made earlier in the document.
  let out = original;
  const blockCount = blocks.length;

  // Build the plan: index → action
  type BlockAction =
    | { kind: "skip-size"; byteLen: number; lineNum: number }
    | { kind: "inject"; hash: string; url: string; alt: string }
    | { kind: "no-change" };

  const plan: BlockAction[] = [];

  // We parse from the ORIGINAL text to get accurate line numbers for warnings,
  // then work backwards through the out string to apply mutations.
  const originalLines = original.split("\n");

  for (let i = 0; i < blockCount; i++) {
    const block = blocks[i]!;
    const byteLen = Buffer.byteLength(block.source, "utf8");

    if (byteLen > INLINE_SIZE_CAP) {
      // Find approximate 1-based line number from start offset.
      const lineNum = original.slice(0, block.start).split("\n").length;
      plan.push({ kind: "skip-size", byteLen, lineNum });
      docExitCode = 1;
      continue;
    }

    const hash = computeBlockHash(block);
    const url = buildInlineUrl(baseUrl, block.source, theme);
    const alt = altFromBlock(block, i);

    // Check if an up-to-date marker already exists (idempotency).
    const existingMarker = findExistingInlineMarker(original, block.end);
    if (existingMarker && existingMarker.hash === hash) {
      plan.push({ kind: "no-change" });
      skipped++;
      continue;
    }

    plan.push({ kind: "inject", hash, url, alt });
    rendered++;
  }

  // Print size-cap warnings (can do this before mutations).
  for (let i = 0; i < blockCount; i++) {
    const action = plan[i]!;
    if (action.kind === "skip-size") {
      const kb = (action.byteLen / 1024).toFixed(1);
      process.stderr.write(
        `[bd extract] Block at ${mdPath}:${action.lineNum} (${kb} KB) exceeds 5 KB inline embed limit.\n` +
        `  Skipped — to render this block:\n` +
        `    1. Use --assets-dir ./img to write local SVG instead, OR\n` +
        `    2. Manually save with \`bd share\` and reference the URL.\n`,
      );
    }
  }

  if (!dryRun) {
    // Apply from END to START to avoid offset drift.
    // Re-parse on updated text to get current offsets for each mutation step.
    for (let i = blockCount - 1; i >= 0; i--) {
      const action = plan[i]!;
      if (action.kind !== "inject") continue;

      // Re-parse to get current offsets after earlier (later-in-doc) mutations.
      const currentBlocks = parseDiagramBlocks(out);
      if (i >= currentBlocks.length) continue;
      const currentBlock = currentBlocks[i]!;
      const after = currentBlock.end;

      const existing = findExistingInlineMarker(out, after);
      const inject = renderInlineMarker(action.hash, action.url, action.alt);

      if (existing) {
        out = out.slice(0, existing.start) + inject + out.slice(existing.end);
      } else {
        out = out.slice(0, after) + inject + out.slice(after);
      }
    }

    if (out !== original) {
      writeFileAtomic(mdPath, out);
      process.stderr.write(`${mdPath}: updated.\n`);
    } else {
      process.stderr.write(`${mdPath}: unchanged.\n`);
    }
  } else {
    process.stderr.write(`${mdPath}: dry-run, no files written.\n`);
  }

  return {
    doc: { file: mdPath, rendered, skipped, cleaned: 0 },
    exitCode: docExitCode,
  };
}

// ---------------------------------------------------------------------------
// Sidecar mode processing for a single document (existing behaviour)
// ---------------------------------------------------------------------------

async function processSidecarDoc(
  mdPath: string,
  original: string,
  client: ApiClient,
  assetsDir: string,
  theme: string | undefined,
  dryRun: boolean,
  cleanOrphans: boolean,
  concurrency: number,
): Promise<{ doc: ProcessedDoc; exitCode: number }> {
  const blocks = parseDiagramBlocks(original);
  if (blocks.length === 0) {
    process.stderr.write(`${mdPath}: no diagram blocks found, skipping.\n`);
    return { doc: { file: mdPath, rendered: 0, skipped: 0, cleaned: 0 }, exitCode: 0 };
  }

  const docSlug = slugify(path.basename(mdPath, path.extname(mdPath)));
  const mdDir = path.dirname(path.resolve(mdPath));
  const assetsAbs = path.resolve(mdDir, assetsDir);

  const cwd = process.cwd();
  let assetsContained = false;
  try { assertWithinRoot(assetsAbs, mdDir); assetsContained = true; } catch { /* try cwd */ }
  if (!assetsContained) {
    try { assertWithinRoot(assetsAbs, cwd); assetsContained = true; } catch { /* fall through */ }
  }
  if (!assetsContained) {
    process.stderr.write(
      `error: --assets-dir resolves outside the markdown file's directory and the cwd: ${assetsAbs}\n`,
    );
    return { doc: { file: mdPath, rendered: 0, skipped: 0, cleaned: 0 }, exitCode: 1 };
  }

  const blockPlan = blocks.map((block, index) => {
    const hash = computeBlockHash(block);
    const filename = `${docSlug}-${hash}.svg`;
    const imageRel = path.posix.join(
      toPosix(path.relative(mdDir, assetsAbs)) || ".",
      filename,
    );
    const imageAbs = path.join(assetsAbs, filename);
    const alt = altFromBlock(block, index);
    const upToDate = existsSync(imageAbs)
      && hasMarkerAfter(original, block.end, hash);
    return { block, hash, filename, imageRel, imageAbs, alt, upToDate };
  });

  const toRender = blockPlan.filter((p) => !p.upToDate);
  process.stderr.write(
    `${mdPath}: ${blocks.length} block(s), ${toRender.length} to render, ${blockPlan.length - toRender.length} cached.\n`,
  );

  const newlyWritten: string[] = [];
  let renderError: Error | null = null;
  const renderResults = await pMap(
    toRender,
    async (item) => {
      const result = await exportOne(client, {
        source: item.block.source,
        sourceFormat: item.block.language,
        format: "svg",
        ...(theme ? { theme } : {}),
      });
      if (!dryRun) {
        mkdirSync(assetsAbs, { recursive: true });
        writeFileAtomic(item.imageAbs, result.text!);
        newlyWritten.push(item.imageAbs);
      }
      return item;
    },
    { concurrency, continueOnError: false },
  ).catch((err: Error) => {
    renderError = err;
    return [];
  });

  if (renderError) {
    for (const p of newlyWritten) {
      try { unlinkSync(p); } catch { /* swallow */ }
    }
    process.stderr.write(`${mdPath}: ${(renderError as Error).message}\n`);
    return { doc: { file: mdPath, rendered: 0, skipped: 0, cleaned: 0 }, exitCode: 1 };
  }
  void renderResults;

  const renders: RenderedImage[] = blockPlan.map((p) => ({
    block: p.block,
    hash: p.hash,
    imagePath: ensureRelativePrefix(p.imageRel),
    alt: p.alt,
  }));

  const updated = applyImageMarkers(original, renders);

  let cleaned = 0;
  if (cleanOrphans) {
    const cleanAllowed =
      canContain(assetsAbs, mdDir) || canContain(assetsAbs, cwd);
    if (!cleanAllowed) {
      process.stderr.write(
        `error: --clean refused: assets dir is outside allowed roots: ${assetsAbs}\n`,
      );
      return { doc: { file: mdPath, rendered: 0, skipped: 0, cleaned: 0 }, exitCode: 1 };
    }
    cleaned = removeOrphanAssets(assetsAbs, docSlug, blockPlan.map((p) => p.filename), dryRun);
  }

  if (dryRun) {
    process.stderr.write(`${mdPath}: dry-run, no files written.\n`);
  } else if (updated !== original) {
    writeFileAtomic(mdPath, updated);
    process.stderr.write(`${mdPath}: updated.\n`);
  } else {
    process.stderr.write(`${mdPath}: unchanged.\n`);
  }

  return {
    doc: { file: mdPath, rendered: toRender.length, skipped: blockPlan.length - toRender.length, cleaned },
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Main command entrypoint
// ---------------------------------------------------------------------------

export async function runExtractCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.positional.length === 0) {
    process.stderr.write("error: bd extract requires at least one Markdown file. See `bd help`.\n");
    return 2;
  }

  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const theme = getStringFlag(parsed, "theme");
  const rawAssetsDir = getStringFlag(parsed, "assets-dir");
  const dryRun = getBoolFlag(parsed, "dry-run");
  const cleanOrphans = getBoolFlag(parsed, "clean");
  const concurrency = parsePositiveInt(getStringFlag(parsed, "concurrency"), DEFAULT_CONCURRENCY);
  if (concurrency === null) {
    process.stderr.write("error: --concurrency must be a positive integer.\n");
    return 1;
  }

  // Mode dispatch: absence of --assets-dir → inline; presence → sidecar.
  const mode: "inline" | "sidecar" = rawAssetsDir !== undefined ? "sidecar" : "inline";
  const assetsDir = rawAssetsDir ?? "assets"; // only used in sidecar mode

  const client = mode === "sidecar"
    ? new ApiClient(cfg.baseUrl, cfg.apiKey)
    : null;

  const docs: ProcessedDoc[] = [];
  let exitCode = 0;
  let anyInlineSuccess = false;

  for (const mdPath of parsed.positional) {
    let original: string;
    try {
      original = readFileSync(mdPath, "utf8");
    } catch (err) {
      process.stderr.write(`error: cannot read ${mdPath}: ${(err as Error).message}\n`);
      exitCode = 1;
      continue;
    }

    if (mode === "inline") {
      const { doc, exitCode: docExit } = await processInlineDoc(
        mdPath,
        original,
        cfg.baseUrl,
        theme,
        dryRun,
      );
      docs.push(doc);
      if (docExit !== 0) exitCode = docExit;
      else anyInlineSuccess = true;
    } else {
      const { doc, exitCode: docExit } = await processSidecarDoc(
        mdPath,
        original,
        client!,
        assetsDir,
        theme,
        dryRun,
        cleanOrphans,
        concurrency,
      );
      docs.push(doc);
      if (docExit !== 0) exitCode = docExit;
    }
  }

  const totalRendered = docs.reduce((s, d) => s + d.rendered, 0);
  const totalSkipped = docs.reduce((s, d) => s + d.skipped, 0);
  const totalCleaned = docs.reduce((s, d) => s + d.cleaned, 0);
  const modeLabel = mode === "inline" ? "inline" : "sidecar";
  process.stderr.write(
    `\nbd extract (${modeLabel}): ${docs.length} doc(s), ${totalRendered} rendered, ${totalSkipped} cached${mode === "sidecar" && cleanOrphans ? `, ${totalCleaned} cleaned` : ""}.\n`,
  );

  // First-run hint: show once after a successful inline run.
  if (mode === "inline" && anyInlineSuccess && exitCode === 0) {
    const state = readBdState();
    if (!state.extractInlineHintShown) {
      process.stderr.write(
        "\n💡 New default: bd extract now produces inline embed URLs (anonymous, watermarked).\n" +
        "   For Pro/Premium plans wanting watermark-free output, use:\n" +
        "     bd extract <file> --assets-dir ./img\n" +
        "   to render local SVG files instead.\n" +
        "   (This message will not be shown again.)\n",
      );
      writeBdState({ ...state, extractInlineHintShown: true });
    }
  }

  return exitCode;
}
