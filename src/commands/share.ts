// packages/cli/src/commands/share.ts

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { inferFormatFromPath, readSourceFromFileOrStdin } from "../lib/io.js";

type ShareResponse = {
  ok: true;
  diagramId: string;
  shareToken: string;
  sharePath: string;
  shareUrl: string;
  title: string | null;
  diagramType: string;
};

export async function runShareCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const file = parsed.positional[0];
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  if (!cfg.apiKey) {
    process.stderr.write(
      "error: `bd share` requires an API key. Run `bd auth login` first.\n",
    );
    return 1;
  }
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "format"));
  const title = getStringFlag(parsed, "title");
  const theme = getStringFlag(parsed, "theme");

  const res = await client.postJson<ShareResponse>("/api/v1/share", {
    source,
    sourceFormat,
    ...(title ? { title } : {}),
    ...(theme ? { theme } : {}),
  });

  // Resolve the share URL relative to the configured base URL.
  const fullUrl = res.shareUrl.startsWith("http")
    ? res.shareUrl
    : `${cfg.baseUrl.replace(/\/+$/, "")}${res.shareUrl}`;

  process.stdout.write(`${fullUrl}\n`);
  process.stderr.write(`✓ shared (${res.diagramType})\n`);
  return 0;
}
