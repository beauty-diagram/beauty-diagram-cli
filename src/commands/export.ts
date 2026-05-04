// packages/cli/src/commands/export.ts
//
// `bd export` — POSTs to /v1/export and writes the resulting file.
// Thin wrapper over src/lib/exporter.ts.

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import {
  exportOne,
  formatExportSummary,
  isScaleClamped,
  scaleToQuality,
  type ExportQuality,
  type OutputFormat,
} from "../lib/exporter.js";
import {
  inferFormatFromPath,
  readSourceFromFileOrStdin,
  writeBinaryOutput,
  writeOutput,
} from "../lib/io.js";

function parseOutputFormat(raw: string | undefined): OutputFormat | null {
  if (!raw) return "svg";
  if (raw === "svg" || raw === "png") return raw;
  return null;
}

const QUALITY_VALUES: readonly ExportQuality[] = ["standard", "high", "max"];

function parseQuality(raw: string | undefined): ExportQuality | null | "invalid" {
  if (raw === undefined) return null;
  return (QUALITY_VALUES as readonly string[]).includes(raw)
    ? (raw as ExportQuality)
    : "invalid";
}

export async function runExportCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const file = parsed.positional[0];
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "source-format"));

  const fmt = parseOutputFormat(getStringFlag(parsed, "format"));
  if (fmt === null) {
    process.stderr.write("error: --format must be 'svg' or 'png'.\n");
    return 1;
  }
  const theme = getStringFlag(parsed, "theme");
  const out = getStringFlag(parsed, "out");

  const quality = parseQuality(getStringFlag(parsed, "quality"));
  if (quality === "invalid") {
    process.stderr.write("error: --quality must be 'standard', 'high', or 'max'.\n");
    return 1;
  }
  if (quality !== null && fmt === "svg") {
    process.stderr.write("warn: --quality is ignored for SVG output.\n");
  }

  const result = await exportOne(client, {
    source,
    sourceFormat,
    format: fmt,
    ...(theme ? { theme } : {}),
    ...(fmt === "png" && quality !== null ? { quality } : {}),
  });

  if (result.format === "svg") {
    writeOutput(result.text!, out);
  } else {
    writeBinaryOutput(result.bytes!, out);
  }

  process.stderr.write(`${formatExportSummary(result)}\n`);
  if (isScaleClamped(result)) {
    const cappedScale = Number(result.headers["x-bd-scale"]);
    const cappedQuality = scaleToQuality(cappedScale) ?? `${cappedScale}x`;
    process.stderr.write(
      `  note: requested quality was clamped to '${cappedQuality}' by your plan. Upgrade for higher tiers.\n`,
    );
  }
  return 0;
}
