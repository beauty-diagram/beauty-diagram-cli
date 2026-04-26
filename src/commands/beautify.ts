// packages/cli/src/commands/beautify.ts

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import {
  inferFormatFromPath,
  readSourceFromFileOrStdin,
  writeOutput,
} from "../lib/io.js";

type BeautifyResponse = {
  ok: true;
  diagramType: string;
  svg: string;
  meta: {
    theme: string;
    width: number;
    height: number;
    hasWatermark: boolean;
  };
  usage: { used: number; limit: number | null };
};

export async function runBeautifyCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const file = parsed.positional[0];
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "format"));
  const theme = getStringFlag(parsed, "theme");
  const out = getStringFlag(parsed, "out");

  const res = await client.postJson<BeautifyResponse>("/api/v1/beautify", {
    source,
    sourceFormat,
    ...(theme ? { theme } : {}),
  });

  writeOutput(res.svg, out);

  if (!cfg.apiKey) {
    process.stderr.write(
      "✓ rendered (anonymous demo: watermarked, IP rate-limited). Run `bd auth login` for full output.\n",
    );
  } else if (res.meta.hasWatermark) {
    process.stderr.write(
      `✓ rendered (${res.diagramType}, ${res.meta.theme}) — free plan watermark applied. Upgrade to remove.\n`,
    );
  } else {
    process.stderr.write(`✓ rendered (${res.diagramType}, ${res.meta.theme})\n`);
  }
  return 0;
}
