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
