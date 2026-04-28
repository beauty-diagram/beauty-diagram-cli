// packages/cli/src/commands/themes.ts

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";

type ThemesResponse = {
  ok: true;
  themes: Array<{ id: string; name: string; tone: string; description?: string }>;
};

export async function runThemesCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);
  const result = await client.getJson<ThemesResponse>("/v1/themes");

  for (const t of result.themes) {
    const desc = t.description ? ` — ${t.description}` : "";
    process.stdout.write(`${t.id.padEnd(12)}${t.name.padEnd(14)}${t.tone.padEnd(10)}${desc}\n`);
  }
  return 0;
}
