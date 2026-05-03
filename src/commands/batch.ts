// packages/cli/src/commands/batch.ts
//
// `bd batch <paths...>` — render many diagram sources in parallel and write
// each result to --out-dir, preserving the source's relative path layout.
// One /v1/export request per file; the server is unchanged.
//
// Symlinked source files are rejected (via readDiagramFile -> assertNotSymlink)
// for the same reason as `bd export`: a symlinked input could trick the CLI
// into uploading the contents of an unrelated sensitive file to the API.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { ApiClient } from "../lib/api-client.js";
import { getBoolFlag, getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { pMap } from "../lib/concurrency.js";
import { exportOne, formatExportSummary, type OutputFormat } from "../lib/exporter.js";
import { expandDiagramPaths } from "../lib/fileset.js";
import {
  assertWithinRoot,
  inferFormatFromPath,
  readDiagramFile,
  UnsafePathError,
  writeBinaryFileAtomic,
  writeFileAtomic,
} from "../lib/io.js";

const DEFAULT_CONCURRENCY = 4;

function parseFormat(raw: string | undefined): OutputFormat | null {
  if (!raw) return "svg";
  return raw === "svg" || raw === "png" ? raw : null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function deriveOutputPath(
  sourcePath: string,
  outDir: string,
  ext: OutputFormat,
): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const rel = path.relative(process.cwd(), path.dirname(sourcePath));
  const sub = rel && !rel.startsWith("..") ? rel : "";
  return path.join(outDir, sub, `${base}.${ext}`);
}

export async function runBatchCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.positional.length === 0) {
    process.stderr.write("error: bd batch requires at least one path. See `bd help`.\n");
    return 2;
  }

  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const fmt = parseFormat(getStringFlag(parsed, "format"));
  if (fmt === null) {
    process.stderr.write("error: --format must be 'svg' or 'png'.\n");
    return 1;
  }
  const theme = getStringFlag(parsed, "theme");
  const outDir = getStringFlag(parsed, "out-dir") ?? ".";
  // Containment check: --out-dir MUST resolve within cwd. Done once at
  // command entry rather than per-file. Defends against `--out-dir=../../etc`.
  const outDirAbs = path.resolve(outDir);
  try {
    assertWithinRoot(outDirAbs, process.cwd());
  } catch (err) {
    if (err instanceof UnsafePathError) {
      process.stderr.write(
        `error: --out-dir resolves outside the cwd: ${outDirAbs}\n`,
      );
      return 1;
    }
    throw err;
  }
  const concurrency = parsePositiveInt(getStringFlag(parsed, "concurrency"), DEFAULT_CONCURRENCY);
  if (concurrency === null) {
    process.stderr.write("error: --concurrency must be a positive integer.\n");
    return 1;
  }
  const stopOnError = getBoolFlag(parsed, "stop-on-error");

  const files = expandDiagramPaths(parsed.positional);
  if (files.length === 0) {
    process.stderr.write("error: no diagram files matched.\n");
    return 1;
  }
  process.stderr.write(`bd batch: ${files.length} file(s), concurrency=${concurrency}\n`);

  const results = await pMap(
    files,
    async (file) => {
      const source = readDiagramFile(file);
      const sourceFormat = inferFormatFromPath(file, undefined);
      const result = await exportOne(client, {
        source,
        sourceFormat,
        format: fmt,
        ...(theme ? { theme } : {}),
      });
      const outPath = deriveOutputPath(file, outDir, fmt);
      mkdirSync(path.dirname(outPath), { recursive: true });
      if (result.format === "svg") {
        writeFileAtomic(outPath, result.text!);
      } else {
        writeBinaryFileAtomic(outPath, result.bytes!);
      }
      process.stderr.write(`${formatExportSummary(result, file)} → ${outPath}\n`);
      return outPath;
    },
    { concurrency, continueOnError: !stopOnError },
  );

  if (stopOnError) {
    process.stderr.write(`✓ ${files.length} file(s) exported.\n`);
    return 0;
  }

  let succeeded = 0;
  let failed = 0;
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] as { ok: boolean; error?: Error };
    if (r.ok) succeeded++;
    else {
      failed++;
      failures.push(`  ✗ ${files[i]}: ${r.error?.message ?? "unknown error"}`);
    }
  }
  process.stderr.write(`\nbd batch: ${succeeded} succeeded, ${failed} failed.\n`);
  if (failed > 0) {
    process.stderr.write(failures.join("\n") + "\n");
    return 1;
  }
  return 0;
}
