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
