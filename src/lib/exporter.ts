// packages/cli/src/lib/exporter.ts
//
// Single per-diagram export pipeline used by `bd export`, `bd batch`,
// and `bd extract`. Keeps request body assembly + scale-clamp summary
// in one place so the three commands stay consistent.

import type { ApiClient } from "./api-client.js";

export type SourceFormat = "mermaid" | "plantuml";
export type OutputFormat = "svg" | "png";

// Quality tiers mirror the web export popover (standard / high / max).
// Internally each maps to the API's numeric `scale` (1× / 2× / 4×) which
// the server still clamps by plan tier.
export type ExportQuality = "standard" | "high" | "max";

export const QUALITY_SCALE: Record<ExportQuality, number> = {
  standard: 1,
  high: 2,
  max: 4,
};

const SCALE_TO_QUALITY: Record<number, ExportQuality> = {
  1: "standard",
  2: "high",
  4: "max",
};

export function scaleToQuality(scale: number | undefined): ExportQuality | null {
  if (scale === undefined) return null;
  return SCALE_TO_QUALITY[scale] ?? null;
}

export type ExportOpts = {
  source: string;
  sourceFormat: SourceFormat;
  format: OutputFormat;
  theme?: string;
  quality?: ExportQuality;
};

export type ExportResult = {
  format: OutputFormat;
  bytes?: Uint8Array;
  text?: string;
  headers: Record<string, string>;
};

export function buildExportRequest(opts: ExportOpts): Record<string, unknown> {
  return {
    source: opts.source,
    sourceFormat: opts.sourceFormat,
    format: opts.format,
    ...(opts.theme ? { theme: opts.theme } : {}),
    ...(opts.format === "png" && opts.quality
      ? { scale: QUALITY_SCALE[opts.quality] }
      : {}),
  };
}

export async function exportOne(
  client: ApiClient,
  opts: ExportOpts,
): Promise<ExportResult> {
  const body = buildExportRequest(opts);
  if (opts.format === "svg") {
    const { body: text, headers } = await client.postRaw("/v1/export", body);
    return { format: "svg", text, headers };
  }
  const { body: bytes, headers } = await client.postBinary("/v1/export", body);
  return { format: "png", bytes, headers };
}

export function formatExportSummary(
  result: ExportResult,
  label?: string,
): string {
  const h = result.headers;
  const diagramType = h["x-bd-diagram-type"] ?? result.format;
  const plan = h["x-bd-quota-plan"] ?? "unknown";
  const used = h["x-bd-quota-used"] ?? "?";
  const limit = h["x-bd-quota-limit"] ?? "?";
  const watermark = h["x-bd-watermark"] === "true" ? " (watermarked)" : "";
  const scale = h["x-bd-scale"];
  const scaleSuffix = scale ? `@${scale}x` : "";
  const prefix = label ? `${label}: ` : "";
  return `${prefix}✓ ${result.format}${scaleSuffix} (${diagramType})${watermark}. Quota: ${used}/${limit} (${plan})`;
}

export function isScaleClamped(result: ExportResult): boolean {
  return result.headers["x-bd-scale-clamped"] === "true";
}
