// packages/cli/src/commands/usage.ts

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";

type UsageResponse = {
  ok: true;
  plan: string;
  actor: string;
  exports: { plan: string; used: number; limit: number | null; resetsAt: string };
  // Older servers won't include `ai`. Treat absent as "feature not exposed",
  // not "no quota" — printing the block would mislead.
  ai?: {
    enabled: boolean;
    limit: number | null;
    used: number;
    resetsAt: string | null;
  };
};

export async function runUsageCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  if (!cfg.apiKey) {
    process.stderr.write("error: `bd usage` requires an API key.\n");
    return 1;
  }
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);
  const res = await client.getJson<UsageResponse>("/v1/usage");

  process.stdout.write(`plan: ${res.plan}\n`);
  process.stdout.write(
    `exports: ${res.exports.used} / ${res.exports.limit ?? "∞"}  (resets ${res.exports.resetsAt})\n`,
  );
  if (res.ai) {
    if (res.ai.enabled) {
      const limit = res.ai.limit ?? "∞";
      const reset = res.ai.resetsAt ? `  (resets ${res.ai.resetsAt})` : "";
      process.stdout.write(`ai:      ${res.ai.used} / ${limit}${reset}\n`);
    } else {
      process.stdout.write(`ai:      not available on plan '${res.plan}'\n`);
    }
  }
  return 0;
}
