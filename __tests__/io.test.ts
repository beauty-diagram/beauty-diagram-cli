import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertWithinRoot,
  assertNotSymlink,
  UnsafePathError,
  writeBinaryFileAtomic,
} from "../src/lib/io.js";
import { readFileSync } from "node:fs";

describe("assertWithinRoot", () => {
  const root = "/Users/me/project";

  it("accepts the root itself", () => {
    expect(() => assertWithinRoot(root, root)).not.toThrow();
  });

  it("accepts paths inside the root", () => {
    expect(() => assertWithinRoot(`${root}/sub/dir`, root)).not.toThrow();
  });

  it("rejects parent escape via ..", () => {
    expect(() => assertWithinRoot("/Users/me/other", root)).toThrow(UnsafePathError);
  });

  it("rejects unrelated absolute path", () => {
    expect(() => assertWithinRoot("/etc/passwd", root)).toThrow(UnsafePathError);
  });
});

describe("assertNotSymlink", () => {
  it("rejects a symlink", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bd-symlink-"));
    try {
      const target = path.join(dir, "target.mmd");
      const link = path.join(dir, "link.mmd");
      writeFileSync(target, "graph TD\nA-->B");
      symlinkSync(target, link);
      expect(() => assertNotSymlink(link)).toThrow(UnsafePathError);
      expect(() => assertNotSymlink(target)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeBinaryFileAtomic", () => {
  it("writes bytes atomically", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bd-bin-"));
    try {
      const target = path.join(dir, "out.bin");
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      writeBinaryFileAtomic(target, bytes);
      const read = readFileSync(target);
      expect(Array.from(read)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
