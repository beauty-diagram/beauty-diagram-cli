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

  it("maps quality to scale only when format is png", () => {
    const standard = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "png", quality: "standard",
    });
    expect(standard).toMatchObject({ scale: 1 });

    const high = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "png", quality: "high",
    });
    expect(high).toMatchObject({ scale: 2 });

    const max = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "png", quality: "max",
    });
    expect(max).toMatchObject({ scale: 4 });

    const svg = buildExportRequest({
      source: "x", sourceFormat: "mermaid", format: "svg", quality: "high",
    });
    expect(svg).not.toHaveProperty("scale");
  });
});
