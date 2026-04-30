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
    const signUpUrl = new URL("/auth/signup", cfg.baseUrl).toString();
    process.stderr.write(
      "error: `bd share` requires an API key. Run `bd auth login` first.\n",
    );
    process.stderr.write(`  Sign up: ${signUpUrl}\n`);
    return 1;
  }
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);

  const source = readSourceFromFileOrStdin(file);
  const sourceFormat = inferFormatFromPath(file, getStringFlag(parsed, "format"));
  const title = getStringFlag(parsed, "title");
  const theme = getStringFlag(parsed, "theme");

  const res = await client.postJson<ShareResponse>("/v1/share", {
    source,
    sourceFormat,
    ...(title ? { title } : {}),
    ...(theme ? { theme } : {}),
  });

  // Resolve the share URL relative to the configured base URL, then validate
  // it before printing. A compromised or misconfigured server could otherwise
  // return `javascript:` / `data:` / `file:` URLs that would be dangerous to
  // paste into a browser or chat client. We only print real http(s) URLs.
  const rawUrl = res.shareUrl.startsWith("http")
    ? res.shareUrl
    : `${cfg.baseUrl.replace(/\/+$/, "")}${res.shareUrl}`;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    process.stderr.write(
      `error: server returned an invalid share URL: ${rawUrl}\n`,
    );
    return 1;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    process.stderr.write(
      `error: server returned a share URL with unsupported protocol '${parsedUrl.protocol}': ${rawUrl}\n`,
    );
    return 1;
  }

  process.stdout.write(`${parsedUrl.toString()}\n`);
  process.stderr.write(`✓ shared (${res.diagramType})\n`);
  return 0;
}
