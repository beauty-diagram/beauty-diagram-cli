import { describe, expect, it } from "vitest";
import { getBoolFlag, getStringFlag, parseArgs } from "../src/lib/args.js";

describe("parseArgs", () => {
  it("collects positional arguments in order", () => {
    const r = parseArgs(["foo", "bar", "baz"]);
    expect(r.positional).toEqual(["foo", "bar", "baz"]);
  });

  it("supports --flag value", () => {
    const r = parseArgs(["beautify", "--theme", "modern", "--out", "x.svg"]);
    expect(r.positional).toEqual(["beautify"]);
    expect(getStringFlag(r, "theme")).toBe("modern");
    expect(getStringFlag(r, "out")).toBe("x.svg");
  });

  it("supports --flag=value", () => {
    const r = parseArgs(["beautify", "--theme=modern"]);
    expect(getStringFlag(r, "theme")).toBe("modern");
  });

  it("treats lone --flag as boolean true", () => {
    const r = parseArgs(["import", "--ai"]);
    expect(getBoolFlag(r, "ai")).toBe(true);
  });
});
