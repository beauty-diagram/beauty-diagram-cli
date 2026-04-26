// packages/cli/src/commands/export.ts
//
// `bd export` — POSTs to /api/v1/export and writes the binary response
// directly. The server returns Content-Type: image/svg+xml with metadata in
// X-BD-* headers (quota, watermark, theme, diagram type).

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import {
  inferFormatFromPath,
  readSourceFromFileOrStdin,
  writeOutput,
} from "../lib/io.js";

export async function runExportCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const file = parsed.positional[0];
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "format"));
  const fmt = getStringFlag(parsed, "format-out") ?? "svg";
  const theme = getStringFlag(parsed, "theme");
  const out = getStringFlag(parsed, "out");

  if (fmt !== "svg") {
    process.stderr.write(
      "error: PNG export is not yet supported via API. Track Phase 2.6c in docs.\n",
    );
    return 1;
  }

  const { body, headers } = await client.postRaw("/api/v1/export", {
    source,
    sourceFormat,
    format: "svg",
    ...(theme ? { theme } : {}),
  });

  writeOutput(body, out);

  const diagramType = headers["x-bd-diagram-type"] ?? "svg";
  const plan = headers["x-bd-quota-plan"] ?? "unknown";
  const used = headers["x-bd-quota-used"] ?? "?";
  const limit = headers["x-bd-quota-limit"] ?? "?";
  process.stderr.write(
    `✓ exported svg (${diagramType}). Quota: ${used}/${limit} (${plan})\n`,
  );
  return 0;
}
