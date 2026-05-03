import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
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

  it("skips symlinked entries when walking a directory", () => {
    const linkDir = mkdtempSync(path.join(tmpdir(), "bd-fileset-link-"));
    try {
      const realFile = path.join(dir, "a.mmd");
      const link = path.join(linkDir, "linked.mmd");
      symlinkSync(realFile, link);
      // Also create a real file so the directory isn't empty.
      writeFileSync(path.join(linkDir, "real.mmd"), "graph TD\nX-->Y");
      const result = expandDiagramPaths([linkDir]).sort();
      expect(result).toEqual([path.join(linkDir, "real.mmd")]);
      expect(result).not.toContain(link);
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
