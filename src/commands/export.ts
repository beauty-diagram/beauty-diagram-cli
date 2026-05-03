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

function parseScale(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
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

  const scale = parseScale(getStringFlag(parsed, "scale"));
  if (Number.isNaN(scale)) {
    process.stderr.write("error: --scale must be a positive number.\n");
    return 1;
  }
  if (scale !== null && fmt === "svg") {
    process.stderr.write("warn: --scale is ignored for SVG output.\n");
  }

  const result = await exportOne(client, {
    source,
    sourceFormat,
    format: fmt,
    ...(theme ? { theme } : {}),
    ...(fmt === "png" && scale !== null ? { scale } : {}),
  });

  if (result.format === "svg") {
    writeOutput(result.text!, out);
  } else {
    writeBinaryOutput(result.bytes!, out);
  }

  process.stderr.write(`${formatExportSummary(result)}\n`);
  if (isScaleClamped(result)) {
    process.stderr.write(
      `  note: requested scale was clamped to ${result.headers["x-bd-scale"]}x by your plan. Upgrade for higher resolutions.\n`,
    );
  }
  return 0;
}
