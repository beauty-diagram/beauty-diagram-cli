// packages/cli/src/commands/export.ts
//
// `bd export` — POSTs to /v1/export and writes the resulting file.
//
// Output format is selected with `--format svg|png` (default svg) and
// matches the README. The source format is auto-detected from the file
// extension (`.mmd` / `.puml` etc.) and can be overridden with
// `--source-format mermaid|plantuml` for stdin pipelines.
//
// PNG resolution is requested via `--scale 1|2|4`. The server caps the
// effective scale by plan tier — values above the cap are silently clamped
// and the response carries `X-BD-Scale-Clamped: true` so we can warn.

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import {
  inferFormatFromPath,
  readSourceFromFileOrStdin,
  writeBinaryOutput,
  writeOutput,
} from "../lib/io.js";

type OutputFormat = "svg" | "png";

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
  const sourceFormat = inferFormatFromPath(
    file,
    getStringFlag(parsed, "source-format"),
  );

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

  const requestBody = {
    source,
    sourceFormat,
    format: fmt,
    ...(theme ? { theme } : {}),
    ...(fmt === "png" && scale !== null ? { scale } : {}),
  };

  if (fmt === "svg") {
    const { body, headers } = await client.postRaw("/v1/export", requestBody);
    writeOutput(body, out);
    printSummary(headers, "svg");
    return 0;
  }

  const { body, headers } = await client.postBinary("/v1/export", requestBody);
  writeBinaryOutput(body, out);
  printSummary(headers, "png");
  return 0;
}

function printSummary(headers: Record<string, string>, fmt: OutputFormat) {
  const diagramType = headers["x-bd-diagram-type"] ?? fmt;
  const plan = headers["x-bd-quota-plan"] ?? "unknown";
  const used = headers["x-bd-quota-used"] ?? "?";
  const limit = headers["x-bd-quota-limit"] ?? "?";
  const watermark = headers["x-bd-watermark"] === "true" ? " (watermarked)" : "";
  const scale = headers["x-bd-scale"];
  const clamped = headers["x-bd-scale-clamped"] === "true";
  const scaleSuffix = scale ? `@${scale}x` : "";
  process.stderr.write(
    `✓ exported ${fmt}${scaleSuffix} (${diagramType})${watermark}. Quota: ${used}/${limit} (${plan})\n`,
  );
  if (clamped) {
    process.stderr.write(
      `  note: requested scale was clamped to ${scale}x by your plan. Upgrade for higher resolutions.\n`,
    );
  }
}
