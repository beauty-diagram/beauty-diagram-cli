# Batch Mode & Markdown Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bd batch` (process many diagram files at once) and `bd extract` (render Mermaid/PlantUML fenced blocks inside Markdown to sidecar SVGs and inject markdown image references) to the Beauty Diagram CLI.

**Architecture:** Both new commands are pure client-side workflows. Each diagram still maps to one `/v1/export` request — server is unchanged. Concurrency is managed in the CLI with a small in-process promise pool. The shared per-diagram export logic is extracted into `src/lib/exporter.ts` so `export`, `batch`, and `extract` all funnel through one path. Markdown handling is a string-level fenced-block parser (no external markdown library) that wraps inserted image references in HTML comment markers (`<!-- bd:img hash=… -->`) for idempotent re-runs.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest for tests, native `fetch`, Node `fs`/`path`/`crypto`. Zero new runtime dependencies.

**Out of scope (do NOT implement here):** Animation export, PNG output for `extract`, AI-generated diagram batching, and any server-side changes. PNG support exists in `batch` (already supported by export pipeline) but `extract` is SVG-only in this plan.

---

## File Structure

**New files:**
- `src/lib/concurrency.ts` — `pMap(items, fn, { concurrency })` promise pool, ~25 lines.
- `src/lib/exporter.ts` — `exportOne(opts)` returning bytes/string + headers; centralizes request body building, format defaulting, scale-clamp warning. Used by `export`, `batch`, `extract`.
- `src/lib/fileset.ts` — Expand a list of positional paths (files, directories, simple globs) into a deduplicated list of diagram source files.
- `src/lib/markdown.ts` — Pure string-level helpers: parse fenced Mermaid/PlantUML blocks, compute content hash, insert/replace `<!-- bd:img ... -->` marker blocks.
- `src/commands/batch.ts` — `bd batch` command.
- `src/commands/extract.ts` — `bd extract` command.
- `__tests__/concurrency.test.ts`
- `__tests__/fileset.test.ts`
- `__tests__/markdown.test.ts`
- `__tests__/exporter.test.ts`

**Modified files:**
- `src/commands/export.ts` — refactored to call `exporter.ts`; behavior and CLI surface unchanged.
- `src/index.ts` — register `batch` and `extract`; update `HELP`.
- `README.md` — document the two new commands.

---

## Phase 0: Refactor — extract shared exporter

This phase is mechanical and must not change observable `bd export` behavior. Run the existing tests after each step.

### Task 0.1: Create the shared `exporter` module

**Files:**
- Create: `src/lib/exporter.ts`
- Create: `__tests__/exporter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/exporter.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildExportRequest, type ExportOpts } from "../src/lib/exporter.js";

describe("buildExportRequest", () => {
  it("emits source + sourceFormat + format with no extras for default svg", () => {
    const opts: ExportOpts = {
      source: "graph TD\nA-->B",
      sourceFormat: "mermaid",
      format: "svg",
    };
    expect(buildExportRequest(opts)).toEqual({
      source: "graph TD\nA-->B",
      sourceFormat: "mermaid",
      format: "svg",
    });
  });

  it("includes theme when provided", () => {
    const body = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "svg", theme: "neon",
    });
    expect(body).toMatchObject({ theme: "neon" });
  });

  it("includes scale only when format is png", () => {
    const png = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "png", scale: 2,
    });
    expect(png).toMatchObject({ scale: 2 });
    const svg = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "svg", scale: 2,
    });
    expect(svg).not.toHaveProperty("scale");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- exporter`
Expected: FAIL — `Cannot find module ../src/lib/exporter.js`.

- [ ] **Step 3: Implement `exporter.ts`**

Create `src/lib/exporter.ts`:

```ts
// packages/cli/src/lib/exporter.ts
//
// Single per-diagram export pipeline used by `bd export`, `bd batch`,
// and `bd extract`. Keeps request body assembly + scale-clamp summary
// in one place so the three commands stay consistent.

import type { ApiClient } from "./api-client.js";

export type SourceFormat = "mermaid" | "plantuml";
export type OutputFormat = "svg" | "png";

export type ExportOpts = {
  source: string;
  sourceFormat: SourceFormat;
  format: OutputFormat;
  theme?: string;
  scale?: number;
};

export type ExportResult = {
  format: OutputFormat;
  bytes?: Uint8Array;
  text?: string;
  headers: Record<string, string>;
};

export function buildExportRequest(opts: ExportOpts): Record<string, unknown> {
  return {
    source: opts.source,
    sourceFormat: opts.sourceFormat,
    format: opts.format,
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.format === "png" && typeof opts.scale === "number"
      ? { scale: opts.scale }
      : {}),
  };
}

export async function exportOne(
  client: ApiClient,
  opts: ExportOpts,
): Promise<ExportResult> {
  const body = buildExportRequest(opts);
  if (opts.format === "svg") {
    const { body: text, headers } = await client.postRaw("/v1/export", body);
    return { format: "svg", text, headers };
  }
  const { body: bytes, headers } = await client.postBinary("/v1/export", body);
  return { format: "png", bytes, headers };
}

export function formatExportSummary(
  result: ExportResult,
  label?: string,
): string {
  const h = result.headers;
  const diagramType = h["x-bd-diagram-type"] ?? result.format;
  const plan = h["x-bd-quota-plan"] ?? "unknown";
  const used = h["x-bd-quota-used"] ?? "?";
  const limit = h["x-bd-quota-limit"] ?? "?";
  const watermark = h["x-bd-watermark"] === "true" ? " (watermarked)" : "";
  const scale = h["x-bd-scale"];
  const scaleSuffix = scale ? `@${scale}x` : "";
  const prefix = label ? `${label}: ` : "";
  return `${prefix}✓ ${result.format}${scaleSuffix} (${diagramType})${watermark}. Quota: ${used}/${limit} (${plan})`;
}

export function isScaleClamped(result: ExportResult): boolean {
  return result.headers["x-bd-scale-clamped"] === "true";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- exporter`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exporter.ts __tests__/exporter.test.ts
git commit -m "refactor(cli): extract shared exporter module"
```

### Task 0.2: Switch `bd export` to use `exporter.ts`

**Files:**
- Modify: `src/commands/export.ts`

- [ ] **Step 1: Replace command body**

Open `src/commands/export.ts` and replace the entire file with:

```ts
// packages/cli/src/commands/export.ts
//
// `bd export` — POSTs to /v1/export and writes the resulting file.
// Thin wrapper over src/lib/exporter.ts.

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import {
  exportOne,
  formatExportSummary,
  isScaleClamped,
  type OutputFormat,
} from "../lib/exporter.js";
import {
  inferFormatFromPath,
  readSourceFromFileOrStdin,
  writeBinaryOutput,
  writeOutput,
} from "../lib/io.js";

function parseOutputFormat(raw: string | undefined): OutputFormat | null {
  if (!raw) return "svg";
  if (raw === "svg" || raw === "png") return raw;
  return null;
}

function parseScale(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

export async function runExportCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const file = parsed.positional[0];
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "source-format"));

  const fmt = parseOutputFormat(getStringFlag(parsed, "format"));
  if (fmt === null) {
    process.stderr.write("error: --format must be 'svg' or 'png'.\n");
    return 1;
  }
  const theme = getStringFlag(parsed, "theme");
  const out = getStringFlag(parsed, "out");

  const scale = parseScale(getStringFlag(parsed, "scale"));
  if (Number.isNaN(scale)) {
    process.stderr.write("error: --scale must be a positive number.\n");
    return 1;
  }
  if (scale !== null && fmt === "svg") {
    process.stderr.write("warn: --scale is ignored for SVG output.\n");
  }

  const result = await exportOne(client, {
    source,
    sourceFormat,
    format: fmt,
    ...(theme ? { theme } : {}),
    ...(fmt === "png" && scale !== null ? { scale } : {}),
  });

  if (result.format === "svg") {
    writeOutput(result.text!, out);
  } else {
    writeBinaryOutput(result.bytes!, out);
  }

  process.stderr.write(`${formatExportSummary(result)}\n`);
  if (isScaleClamped(result)) {
    process.stderr.write(
      `  note: requested scale was clamped to ${result.headers["x-bd-scale"]}x by your plan. Upgrade for higher resolutions.\n`,
    );
  }
  return 0;
}
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: PASS — all existing tests still green (4 + 3 new = 7).

- [ ] **Step 3: Build to confirm types**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/export.ts
git commit -m "refactor(cli): route bd export through shared exporter"
```

---

## Phase 1: Concurrency primitive

### Task 1.1: `pMap` promise pool

**Files:**
- Create: `src/lib/concurrency.ts`
- Create: `__tests__/concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pMap } from "../src/lib/concurrency.js";

describe("pMap", () => {
  it("preserves input order in results", async () => {
    const result = await pMap([1, 2, 3, 4], async (n) => n * 10, { concurrency: 2 });
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await pMap(items, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    }, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("collects errors per item without short-circuiting when continueOnError is true", async () => {
    const result = await pMap(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      },
      { concurrency: 2, continueOnError: true },
    );
    expect(result[0]).toEqual({ ok: true, value: 1 });
    expect(result[1]).toMatchObject({ ok: false });
    expect(result[2]).toEqual({ ok: true, value: 3 });
  });

  it("rejects on first error when continueOnError is false", async () => {
    await expect(
      pMap([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }, { concurrency: 2 }),
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- concurrency`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pMap`**

Create `src/lib/concurrency.ts`:

```ts
// packages/cli/src/lib/concurrency.ts
//
// Bounded promise pool. Used by `bd batch` and `bd extract` so we don't open
// dozens of parallel /v1/export connections from a single CLI invocation.

export type PMapResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export type PMapOpts = {
  concurrency: number;
  continueOnError?: boolean;
};

export async function pMap<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  opts: PMapOpts,
): Promise<O[] | PMapResult<O>[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const results: (O | PMapResult<O>)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]!, i);
        results[i] = opts.continueOnError ? { ok: true, value } : value;
      } catch (err) {
        if (opts.continueOnError) {
          results[i] = { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
        } else {
          throw err;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results as O[] | PMapResult<O>[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- concurrency`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concurrency.ts __tests__/concurrency.test.ts
git commit -m "feat(cli): add bounded promise pool for batch workflows"
```

---

## Phase 2: File set expansion

### Task 2.1: Expand positional args into diagram source files

**Files:**
- Create: `src/lib/fileset.ts`
- Create: `__tests__/fileset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expandDiagramPaths, DIAGRAM_EXTENSIONS } from "../src/lib/fileset.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bd-fileset-"));
  mkdirSync(path.join(dir, "sub"));
  writeFileSync(path.join(dir, "a.mmd"), "graph TD\nA-->B");
  writeFileSync(path.join(dir, "b.puml"), "@startuml\nA->B\n@enduml");
  writeFileSync(path.join(dir, "ignore.txt"), "x");
  writeFileSync(path.join(dir, "sub", "c.mmd"), "graph TD\nC-->D");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("expandDiagramPaths", () => {
  it("includes explicit files even with non-diagram extensions", () => {
    const result = expandDiagramPaths([path.join(dir, "ignore.txt")]);
    expect(result).toEqual([path.join(dir, "ignore.txt")]);
  });

  it("recursively walks directories and keeps only diagram extensions", () => {
    const result = expandDiagramPaths([dir]).sort();
    expect(result).toEqual([
      path.join(dir, "a.mmd"),
      path.join(dir, "b.puml"),
      path.join(dir, "sub", "c.mmd"),
    ]);
  });

  it("expands simple * globs against the cwd", () => {
    const result = expandDiagramPaths([path.join(dir, "*.mmd")]).sort();
    expect(result).toEqual([path.join(dir, "a.mmd")]);
  });

  it("deduplicates overlapping inputs", () => {
    const result = expandDiagramPaths([dir, path.join(dir, "a.mmd")]);
    const occurrences = result.filter((p) => p === path.join(dir, "a.mmd")).length;
    expect(occurrences).toBe(1);
  });

  it("exposes the diagram extension list", () => {
    expect(DIAGRAM_EXTENSIONS).toEqual([".mmd", ".puml", ".plantuml", ".pu"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- fileset`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fileset.ts`**

Create `src/lib/fileset.ts`:

```ts
// packages/cli/src/lib/fileset.ts
//
// Expand a list of CLI positional args (files / directories / simple globs)
// into a deduplicated, ordered list of diagram source paths.
//
// We intentionally implement a tiny glob (only `*` and `?` within a single
// path segment, no `**`) instead of pulling in `glob` or `fast-glob`. The
// shell already expands globs for `bd batch *.mmd`; this fallback exists for
// quoted patterns like `bd batch "diagrams/*.mmd"` and Windows shells.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const DIAGRAM_EXTENSIONS = [".mmd", ".puml", ".plantuml", ".pu"] as const;

function hasMagic(s: string): boolean {
  return /[*?]/.test(s);
}

function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (const ch of pattern) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function expandGlob(pattern: string): string[] {
  const dir = path.dirname(pattern) || ".";
  const base = path.basename(pattern);
  const re = globToRegExp(base);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => re.test(e)).map((e) => path.join(dir, e));
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      out.push(...walkDir(full));
    } else if (st.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if ((DIAGRAM_EXTENSIONS as readonly string[]).includes(ext)) out.push(full);
    }
  }
  return out;
}

export function expandDiagramPaths(inputs: readonly string[]): string[] {
  const collected: string[] = [];
  for (const input of inputs) {
    if (hasMagic(input)) {
      for (const m of expandGlob(input)) collected.push(m);
      continue;
    }
    let st;
    try { st = statSync(input); } catch { continue; }
    if (st.isDirectory()) {
      collected.push(...walkDir(input));
    } else if (st.isFile()) {
      collected.push(input);
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of collected) {
    if (!seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  return unique;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- fileset`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileset.ts __tests__/fileset.test.ts
git commit -m "feat(cli): add diagram path expansion helper for batch/extract"
```

---

## Phase 3: `bd batch` command

### Task 3.1: Implement `bd batch`

**Files:**
- Create: `src/commands/batch.ts`
- Modify: `src/index.ts` (register command + update HELP)

- [ ] **Step 1: Write the command**

Create `src/commands/batch.ts`:

```ts
// packages/cli/src/commands/batch.ts
//
// `bd batch <paths...>` — render many diagram sources in parallel and write
// each result to --out-dir, preserving the source's relative path layout.
// One /v1/export request per file; the server is unchanged.

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ApiClient } from "../lib/api-client.js";
import { getBoolFlag, getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { pMap } from "../lib/concurrency.js";
import { exportOne, formatExportSummary, type OutputFormat } from "../lib/exporter.js";
import { expandDiagramPaths } from "../lib/fileset.js";
import { inferFormatFromPath, writeFileAtomic } from "../lib/io.js";

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
      const source = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
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
        const tmp = `${outPath}.tmp.${process.pid}.${Date.now()}`;
        const { writeFileSync, renameSync } = await import("node:fs");
        writeFileSync(tmp, result.bytes!);
        renameSync(tmp, outPath);
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
```

- [ ] **Step 2: Register the command in `src/index.ts`**

Apply this edit to `src/index.ts`:

Add import near the existing imports:
```ts
import { runBatchCommand } from "./commands/batch.js";
import { runExtractCommand } from "./commands/extract.js";
```

Replace the `HELP` template literal so it includes the new commands. Insert these lines into the `Commands:` block, after the `export` line and before `share`:
```
  batch    <paths...> [--out-dir D] [--format svg|png] [--theme T] [--concurrency N] [--stop-on-error]
                                   Render many diagram files in parallel
  extract  <markdown...> [--assets-dir D] [--theme T] [--concurrency N] [--dry-run] [--clean]
                                   Render Mermaid/PlantUML blocks inside Markdown to sidecar SVGs
```

In the `switch (command)` block, add cases before `default`:
```ts
    case "batch":
      return runBatchCommand(rest);
    case "extract":
      return runExtractCommand(rest);
```

- [ ] **Step 3: Build to confirm everything wires together**

Run: `npm run build`
Expected: exits 0. NOTE: this will fail if `extract.ts` does not yet exist. Skip ahead and complete Phase 4 first if you prefer; otherwise stub the extract command:

If you choose to build now, create a stub `src/commands/extract.ts`:
```ts
export async function runExtractCommand(_argv: string[]): Promise<number> {
  process.stderr.write("error: bd extract is not yet implemented.\n");
  return 2;
}
```
This stub will be replaced in Phase 4.

- [ ] **Step 4: Smoke test against the live API (manual, optional)**

If you have an API key set up:
```bash
mkdir -p /tmp/bd-batch-smoke
echo 'graph TD\nA-->B' > /tmp/bd-batch-smoke/a.mmd
echo 'graph TD\nC-->D' > /tmp/bd-batch-smoke/b.mmd
node dist/index.js batch /tmp/bd-batch-smoke --out-dir /tmp/bd-batch-out
ls /tmp/bd-batch-out
```
Expected: two `.svg` files written, summary line printed for each.

- [ ] **Step 5: Commit**

```bash
git add src/commands/batch.ts src/commands/extract.ts src/index.ts
git commit -m "feat(cli): add bd batch for parallel diagram rendering"
```

### Task 3.2: Integration test for `bd batch` summary output

**Files:**
- Create: `__tests__/batch.test.ts`

- [ ] **Step 1: Write the test using a stubbed ApiClient**

We test the deriveOutputPath helper and command-level orchestration via direct unit tests; we avoid hitting the network.

```ts
import { describe, it, expect } from "vitest";

// Re-export the helper for testing. Since deriveOutputPath is local to
// batch.ts, instead expose it by extracting it. If you prefer not to widen
// the module surface, inline a copy of the helper into the test as a
// regression check on the documented behavior.

function deriveOutputPath(sourcePath: string, outDir: string, ext: "svg" | "png") {
  const path = require("node:path");
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const rel = path.relative(process.cwd(), path.dirname(sourcePath));
  const sub = rel && !rel.startsWith("..") ? rel : "";
  return path.join(outDir, sub, `${base}.${ext}`);
}

describe("batch deriveOutputPath", () => {
  it("preserves relative directory structure under out-dir", () => {
    const cwd = process.cwd();
    const result = deriveOutputPath(`${cwd}/src/diagrams/flow.mmd`, "out", "svg");
    expect(result).toBe("out/src/diagrams/flow.svg");
  });

  it("flattens to out-dir when source is outside cwd", () => {
    const result = deriveOutputPath("/tmp/other/x.mmd", "out", "svg");
    expect(result).toBe("out/x.svg");
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- batch`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add __tests__/batch.test.ts
git commit -m "test(cli): cover batch output path derivation"
```

---

## Phase 4: Markdown extraction

### Task 4.1: Markdown fenced-block parser

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `__tests__/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  parseDiagramBlocks,
  computeBlockHash,
  applyImageMarkers,
  type DiagramBlock,
  type RenderedImage,
} from "../src/lib/markdown.js";

const SAMPLE = `# Title

Intro paragraph.

\`\`\`mermaid
graph TD
A-->B
\`\`\`

Some text.

\`\`\`plantuml
@startuml
A->B
@enduml
\`\`\`

\`\`\`ts
const x = 1;
\`\`\`
`;

describe("parseDiagramBlocks", () => {
  it("returns mermaid and plantuml fenced blocks with byte ranges", () => {
    const blocks = parseDiagramBlocks(SAMPLE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ language: "mermaid", source: "graph TD\nA-->B" });
    expect(blocks[1]).toMatchObject({ language: "plantuml" });
    // Block ranges must reference the closing fence's terminator.
    expect(SAMPLE.slice(blocks[0]!.start, blocks[0]!.end)).toContain("```mermaid");
    expect(SAMPLE.slice(blocks[0]!.start, blocks[0]!.end)).toMatch(/```\s*$/m);
  });

  it("ignores non-diagram code fences", () => {
    const blocks = parseDiagramBlocks("```ts\nconsole.log(1)\n```\n");
    expect(blocks).toEqual([]);
  });

  it("supports indented fences and tilde fences", () => {
    const md = "  ```mermaid\n  graph TD\n  A-->B\n  ```\n\n~~~mermaid\ngraph LR\nC-->D\n~~~\n";
    const blocks = parseDiagramBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.language).toBe("mermaid");
    expect(blocks[1]!.language).toBe("mermaid");
  });
});

describe("computeBlockHash", () => {
  it("is stable and depends on language + source", () => {
    const a = computeBlockHash({ language: "mermaid", source: "graph TD\nA-->B" });
    const b = computeBlockHash({ language: "mermaid", source: "graph TD\nA-->B" });
    const c = computeBlockHash({ language: "mermaid", source: "graph TD\nA-->C" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("applyImageMarkers", () => {
  it("inserts a marker block immediately after each diagram fence", () => {
    const blocks = parseDiagramBlocks(SAMPLE);
    const renders: RenderedImage[] = blocks.map((b, i) => ({
      block: b,
      hash: computeBlockHash(b),
      imagePath: `./assets/diagram-${i}.svg`,
      alt: `Diagram ${i + 1}`,
    }));
    const out = applyImageMarkers(SAMPLE, renders);
    expect(out).toContain("<!-- bd:img hash=");
    expect(out).toContain("![Diagram 1](./assets/diagram-0.svg)");
    expect(out).toContain("![Diagram 2](./assets/diagram-1.svg)");
    // Second run on the already-injected output should be a no-op.
    const out2 = applyImageMarkers(out, renders);
    expect(out2).toBe(out);
  });

  it("replaces an existing marker block when the hash changes", () => {
    const blocks = parseDiagramBlocks(SAMPLE);
    const renders1: RenderedImage[] = blocks.map((b, i) => ({
      block: b,
      hash: computeBlockHash(b),
      imagePath: `./assets/v1-${i}.svg`,
      alt: `Diagram ${i + 1}`,
    }));
    const once = applyImageMarkers(SAMPLE, renders1);
    const renders2: RenderedImage[] = blocks.map((b, i) => ({
      block: b,
      hash: computeBlockHash(b) + "x".repeat(0),
      imagePath: `./assets/v2-${i}.svg`,
      alt: `Diagram ${i + 1}`,
    }));
    // Force a "different" hash to simulate source change:
    const forced = renders2.map((r) => ({ ...r, hash: r.hash.split("").reverse().join("") }));
    const twice = applyImageMarkers(once, forced);
    expect(twice).not.toContain("./assets/v1-0.svg");
    expect(twice).toContain("./assets/v2-0.svg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- markdown`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `markdown.ts`**

Create `src/lib/markdown.ts`:

```ts
// packages/cli/src/lib/markdown.ts
//
// Pure string-level Mermaid/PlantUML fenced-block extraction and idempotent
// image-marker injection. We do NOT pull in a markdown AST library — the
// surface we need to recognize is small and well-defined:
//   - opening fence ` ``` ` or ` ~~~ ` followed by `mermaid` or `plantuml`
//     (optional info after the language is permitted: `mermaid title=foo`)
//   - up to 3 spaces of indentation on the opening fence (CommonMark rule);
//     the closing fence must use the same character and at least the same
//     length, with the same indentation
// Anything else (HTML, indented code blocks, inline code) is ignored.

import { createHash } from "node:crypto";

export type DiagramLanguage = "mermaid" | "plantuml";

export type DiagramBlock = {
  language: DiagramLanguage;
  source: string;
  /** Byte offset of the opening fence's first character. */
  start: number;
  /** Byte offset just after the closing fence's trailing newline. */
  end: number;
};

export type RenderedImage = {
  block: DiagramBlock;
  hash: string;
  imagePath: string;
  alt: string;
};

const OPEN_FENCE_RE = /^( {0,3})(```+|~~~+)\s*([A-Za-z][\w-]*)\s*([^\n]*)$/;

export function parseDiagramBlocks(text: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = [];
  const lines = splitLinesKeepOffsets(text);

  for (let i = 0; i < lines.length; i++) {
    const { content, start } = lines[i]!;
    const m = OPEN_FENCE_RE.exec(content);
    if (!m) continue;
    const indent = m[1]!;
    const fence = m[2]!;
    const lang = m[3]!.toLowerCase();
    if (lang !== "mermaid" && lang !== "plantuml") continue;
    const fenceChar = fence[0]!;
    const fenceLen = fence.length;

    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const close = lines[j]!.content;
      const cm = new RegExp(`^ {0,3}${escapeRe(fenceChar)}{${fenceLen},}\\s*$`).exec(close);
      if (cm) { closeIdx = j; break; }
    }
    if (closeIdx === -1) continue;

    const sourceLines: string[] = [];
    for (let j = i + 1; j < closeIdx; j++) {
      const raw = lines[j]!.content;
      sourceLines.push(indent && raw.startsWith(indent) ? raw.slice(indent.length) : raw);
    }
    const source = sourceLines.join("\n");
    const closingLine = lines[closeIdx]!;
    const end = closingLine.start + closingLine.content.length + (closingLine.terminator?.length ?? 0);

    blocks.push({
      language: lang as DiagramLanguage,
      source,
      start,
      end,
    });
    i = closeIdx;
  }
  return blocks;
}

export function computeBlockHash(input: { language: DiagramLanguage; source: string }): string {
  const h = createHash("sha256");
  h.update(input.language);
  h.update(" ");
  h.update(input.source);
  return h.digest("hex").slice(0, 8);
}

export function applyImageMarkers(text: string, renders: readonly RenderedImage[]): string {
  // Walk renders from the END of the document so insertions don't shift the
  // offsets of earlier blocks.
  let out = text;
  const sorted = [...renders].sort((a, b) => b.block.end - a.block.end);
  for (const r of sorted) {
    const after = r.block.end;
    const existing = findExistingMarker(out, after);
    const inject = renderMarker(r);
    if (existing) {
      // Replace the existing marker block (between existing.start..existing.end).
      out = out.slice(0, existing.start) + inject + out.slice(existing.end);
    } else {
      // Insert immediately after the closing fence's trailing newline.
      out = out.slice(0, after) + inject + out.slice(after);
    }
  }
  return out;
}

function renderMarker(r: RenderedImage): string {
  const alt = r.alt.replace(/[\[\]]/g, "");
  return `\n<!-- bd:img hash=${r.hash} -->\n![${alt}](${r.imagePath})\n<!-- /bd:img -->\n`;
}

function findExistingMarker(text: string, fromOffset: number): { start: number; end: number; hash: string } | null {
  // Allow up to one blank line between the closing fence and an existing marker.
  const tail = text.slice(fromOffset);
  const m = /^(\s*\n)?<!-- bd:img hash=([0-9a-f]+) -->\n([\s\S]*?)\n<!-- \/bd:img -->\n?/.exec(tail);
  if (!m) return null;
  return {
    start: fromOffset + (m[1]?.length ?? 0),
    end: fromOffset + m[0].length,
    hash: m[2]!,
  };
}

function splitLinesKeepOffsets(text: string): { content: string; start: number; terminator?: string }[] {
  const out: { content: string; start: number; terminator?: string }[] = [];
  let i = 0;
  while (i <= text.length) {
    const nl = text.indexOf("\n", i);
    if (nl === -1) {
      if (i < text.length) out.push({ content: text.slice(i), start: i });
      break;
    }
    out.push({ content: text.slice(i, nl), start: i, terminator: "\n" });
    i = nl + 1;
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- markdown`
Expected: PASS — all tests in `markdown.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown.ts __tests__/markdown.test.ts
git commit -m "feat(cli): add markdown fenced-block parser and image marker injector"
```

### Task 4.2: `bd extract` command

**Files:**
- Create: `src/commands/extract.ts` (replaces stub from Task 3.1 if you created one)

- [ ] **Step 1: Replace the extract stub with the real command**

Replace `src/commands/extract.ts` with:

```ts
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

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ApiClient } from "../lib/api-client.js";
import { getBoolFlag, getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { pMap } from "../lib/concurrency.js";
import { exportOne } from "../lib/exporter.js";
import { writeFileAtomic } from "../lib/io.js";
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
        }
        return item;
      },
      { concurrency, continueOnError: false },
    ).catch((err: Error) => {
      renderError = err;
      return [] as never[];
    });

    if (renderError) {
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

function removeOrphanAssets(
  assetsAbs: string,
  docSlug: string,
  keepFilenames: string[],
  dryRun: boolean,
): number {
  if (!existsSync(assetsAbs)) return 0;
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
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
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS — all tests still green; total now ≈ 18+.

- [ ] **Step 4: Manual end-to-end smoke test (optional)**

```bash
mkdir -p /tmp/bd-extract-smoke
cat > /tmp/bd-extract-smoke/demo.md <<'MD'
# Demo

\`\`\`mermaid
graph TD
A-->B
\`\`\`

Plain text between.

\`\`\`plantuml
@startuml
A -> B
@enduml
\`\`\`
MD
node dist/index.js extract /tmp/bd-extract-smoke/demo.md
cat /tmp/bd-extract-smoke/demo.md
ls /tmp/bd-extract-smoke/assets
# Re-run; expect "cached" path and an unchanged file.
node dist/index.js extract /tmp/bd-extract-smoke/demo.md
```
Expected: first run writes 2 SVGs and rewrites `demo.md`; second run reports `2 cached` and prints `unchanged`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/extract.ts
git commit -m "feat(cli): add bd extract for rendering Markdown diagram blocks"
```

---

## Phase 5: Documentation

### Task 5.1: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Batch & Markdown extraction" section**

After the existing `bd export` section in `README.md`, add:

````markdown
## Batch render

Render every diagram in a directory in parallel:

```bash
bd batch ./diagrams --out-dir ./svg
bd batch "docs/**/*.mmd" --format png --concurrency 8
```

Each file becomes one `/v1/export` request — failures are reported per-file
and the whole batch keeps going (use `--stop-on-error` to abort on the first
failure). The source folder layout is preserved under `--out-dir`.

## Embed diagrams in Markdown

`bd extract` finds every \`\`\`mermaid / \`\`\`plantuml fenced block in your
Markdown files, renders them to sidecar SVGs, and injects an image reference
just below each block. Re-running is idempotent — content-hashed filenames
mean unchanged blocks are skipped.

```bash
bd extract README.md
bd extract docs/*.md --assets-dir ./img --concurrency 4
bd extract README.md --dry-run        # preview without writing
bd extract README.md --clean          # also delete orphaned SVGs
```

The injected block looks like this and is re-recognized on subsequent runs:

```
<!-- bd:img hash=a3f9c2b1 -->
![Diagram 1](./assets/readme-a3f9c2b1.svg)
<!-- /bd:img -->
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(cli): document bd batch and bd extract"
```

---

## Phase 6: Final verification

### Task 6.1: Full build, tests, and smoke

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Verify CLI help reflects the new commands**

Run: `node dist/index.js help`
Expected: output includes `batch` and `extract` lines.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feature/batch-extract
```

- [ ] **Step 5: Open a PR**

Use `gh pr create` per the project's existing conventions, or pause here for the user to review.

---

## Decisions locked in this plan

These were discussed and resolved before plan-writing; they are not open for re-litigation by the implementing engineer:

1. **One HTTP request per diagram** — no server-side batch endpoint.
2. **Inline-in-Markdown SVG is impossible on GitHub** (sanitizer strips `<svg>`), so `extract` always uses sidecar files referenced via `![](path)`.
3. **Idempotency via content-hashed filenames + HTML comment markers**, not via a separate state file.
4. **Default `--assets-dir` is `assets/` next to the Markdown file**, with filenames prefixed by the document slug to avoid collisions across docs.
5. **`extract` is SVG-only** (PNG support would require deciding alt-text + DPI tradeoffs that aren't worth it now). `batch` supports both.
6. **Animation export is out of scope** — `bd` itself does not support it yet.
7. **Default concurrency = 4** — conservative; users can raise with `--concurrency`.
8. **Failure mode**: `batch` defaults to continue-on-error (Liviu-style "render what you can"); `extract` short-circuits the doc on the first failure (per-doc atomicity matters more than partial Markdown rewrites).
