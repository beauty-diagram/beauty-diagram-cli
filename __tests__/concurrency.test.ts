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
