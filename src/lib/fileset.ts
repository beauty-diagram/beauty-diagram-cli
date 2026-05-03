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
