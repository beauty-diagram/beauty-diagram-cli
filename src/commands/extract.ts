// packages/cli/src/commands/extract.ts
//
// `bd extract <markdown-files...>` — find Mermaid/PlantUML fenced blocks in
// each Markdown file, render them to SVG sidecar files, and inject (or
// update) marker-wrapped image references right after each fence.
//
// Idempotency strategy: each rendered block carries an 8-char content hash.
// On re-run we re-hash, compare with the marker, and skip rendering when
// unchanged. The marker syntax is `<!-- bd:img hash=… -->` which survives
// every Markdown renderer we care about.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "diagram";
}

function altFromBlock(block: DiagramBlock, index: number): string {
  const titleMatch = /(?:^|\n)\s*(?:title|%%\s*title:?)\s*([^\n]+)/i.exec(block.source);
  if (titleMatch) return titleMatch[1]!.trim().slice(0, 80);
  return `Diagram ${index + 1}`;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

type ProcessedDoc = {
  file: string;
  rendered: number;
  skipped: number;
  cleaned: number;
};

export async function runExtractCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.positional.length === 0) {
    process.stderr.write("error: bd extract requires at least one Markdown file. See `bd help`.\n");
    return 2;
  }

  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);
  const theme = getStringFlag(parsed, "theme");
  const assetsDir = getStringFlag(parsed, "assets-dir") ?? "assets";
  const dryRun = getBoolFlag(parsed, "dry-run");
  const cleanOrphans = getBoolFlag(parsed, "clean");
  const concurrency = parsePositiveInt(getStringFlag(parsed, "concurrency"), DEFAULT_CONCURRENCY);
  if (concurrency === null) {
    process.stderr.write("error: --concurrency must be a positive integer.\n");
    return 1;
  }

  const docs: ProcessedDoc[] = [];
  let exitCode = 0;

  for (const mdPath of parsed.positional) {
    let original: string;
    try {
      original = readFileSync(mdPath, "utf8");
    } catch (err) {
      process.stderr.write(`error: cannot read ${mdPath}: ${(err as Error).message}\n`);
      exitCode = 1;
      continue;
    }

    const blocks = parseDiagramBlocks(original);
    if (blocks.length === 0) {
      process.stderr.write(`${mdPath}: no diagram blocks found, skipping.\n`);
      continue;
    }

    const docSlug = slugify(path.basename(mdPath, path.extname(mdPath)));
    const mdDir = path.dirname(path.resolve(mdPath));
    const assetsAbs = path.resolve(mdDir, assetsDir);

    // Containment: --assets-dir MUST resolve within either the markdown
    // file's directory or cwd. Defends against `--assets-dir=../../etc/`.
    // Checked once per doc since mdDir varies; the `--clean` codepath
    // re-checks defensively via assetsRootAllowed below.
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
      return 1;
    }

    // Determine which blocks already have an up-to-date marker.
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

    // Per-doc atomicity contract: if any block render fails mid-doc, we do
    // NOT rewrite the Markdown file (leaving the user's source untouched),
    // AND we unlink any sibling SVGs newly written during this run. Cached
    // SVGs from previous runs are kept. This avoids leaving the doc half-
    // injected with a mix of stale and fresh sidecars.
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
      // Best-effort cleanup of newly-written sidecars.
      for (const p of newlyWritten) {
        try { unlinkSync(p); } catch { /* swallow */ }
      }
      process.stderr.write(`${mdPath}: ${(renderError as Error).message}\n`);
      exitCode = 1;
      continue;
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
      // Defence in depth: refuse to delete from a directory that escaped
      // both safe roots, even though the entry-level check above already
      // covers this. Cheap insurance against future refactors.
      const cleanAllowed =
        canContain(assetsAbs, mdDir) || canContain(assetsAbs, cwd);
      if (!cleanAllowed) {
        process.stderr.write(
          `error: --clean refused: assets dir is outside allowed roots: ${assetsAbs}\n`,
        );
        return 1;
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

    docs.push({
      file: mdPath,
      rendered: toRender.length,
      skipped: blockPlan.length - toRender.length,
      cleaned,
    });
  }

  const totalRendered = docs.reduce((s, d) => s + d.rendered, 0);
  const totalSkipped = docs.reduce((s, d) => s + d.skipped, 0);
  const totalCleaned = docs.reduce((s, d) => s + d.cleaned, 0);
  process.stderr.write(
    `\nbd extract: ${docs.length} doc(s), ${totalRendered} rendered, ${totalSkipped} cached${cleanOrphans ? `, ${totalCleaned} cleaned` : ""}.\n`,
  );
  return exitCode;
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
