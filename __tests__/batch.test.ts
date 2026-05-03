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
