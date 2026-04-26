// packages/cli/src/lib/io.ts
//
// File / stdin / stdout helpers used by the CLI commands.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

export function readSourceFromFileOrStdin(filePath?: string): string {
  if (filePath && filePath !== "-") {
    return normalizeSource(readFileSync(path.resolve(filePath), "utf8"));
  }
  // Read all of stdin synchronously. Acceptable: CLI input fits in memory.
  let buf = Buffer.alloc(0);
  try {
    // Use readFileSync of fd 0 (stdin) where supported.
    buf = readFileSync(0 as unknown as string);
  } catch {
    // Fallback: empty
  }
  return normalizeSource(buf.toString("utf8"));
}

// Editors on Windows / BOM-emitting tools leave a UTF-8 BOM at file start
// and write CRLF line endings. Both reach Mermaid / PlantUML parsers as
// part of node labels and silently make rendered text disappear.
// Normalize at the file-read boundary so every CLI command is immune.
function normalizeSource(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function inferFormatFromPath(
  filePath: string | undefined,
  override: string | undefined,
): "mermaid" | "plantuml" {
  if (override === "mermaid" || override === "plantuml") return override;
  if (!filePath) return "mermaid";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".puml" || ext === ".plantuml" || ext === ".pu") return "plantuml";
  return "mermaid";
}

export function writeFileAtomic(targetPath: string, contents: string): void {
  const resolved = path.resolve(targetPath);
  const tmp = `${resolved}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, resolved);
}

export function writeOutput(contents: string, outPath: string | undefined): void {
  if (!outPath || outPath === "-") {
    process.stdout.write(contents);
    if (!contents.endsWith("\n")) process.stdout.write("\n");
    return;
  }
  writeFileAtomic(outPath, contents);
}

export function writeBinaryOutput(
  bytes: Uint8Array,
  outPath: string | undefined,
): void {
  if (!outPath || outPath === "-") {
    // Raw bytes to stdout — gibberish in a terminal but `bd export ... > flow.png`
    // pipelines work correctly.
    process.stdout.write(bytes);
    return;
  }
  const resolved = path.resolve(outPath);
  const tmp = `${resolved}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, resolved);
}
