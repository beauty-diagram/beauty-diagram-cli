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

// The trailing `[^\n]*` after the language captures the CommonMark "info
// string" tail (e.g. ` ```mermaid title=foo `). We accept and ignore it —
// fence-info attributes are renderer-specific and not relevant to which
// blocks we treat as diagrams. Only the first word (the language) matters.
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
  h.update(" ");
  h.update(input.source);
  return h.digest("hex").slice(0, 8);
}

export function applyImageMarkers(text: string, renders: readonly RenderedImage[]): string {
  // Re-parse blocks against the *current* text so we use up-to-date byte
  // offsets. The caller's `renders` may have been derived from an earlier
  // version of the text (e.g. a re-run on already-injected output), in which
  // case their `block.end` values are stale. Fenced blocks are not introduced
  // by our HTML-comment marker, so the count and order are preserved across
  // runs and we can pair renders to current blocks positionally.
  let out = text;
  const current = parseDiagramBlocks(text);
  const indexed = renders
    .map((r, originalIndex) => ({ r, originalIndex }))
    .filter(({ originalIndex }) => originalIndex < current.length)
    // Walk renders from the END of the document so insertions don't shift the
    // offsets of earlier blocks.
    .sort((a, b) => current[b.originalIndex]!.end - current[a.originalIndex]!.end);

  for (const { r, originalIndex } of indexed) {
    const block = current[originalIndex]!;
    const after = block.end;
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
    start: fromOffset,
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
