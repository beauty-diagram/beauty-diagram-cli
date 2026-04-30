// packages/cli/src/commands/ai.ts
//
// `bd ai` subcommand. Today the only verb is `generate`: text prompt →
// diagram source (Mermaid for now). Everything else (visual styling,
// theme, render) goes through `bd beautify` so the AI command stays
// narrow.
//
// Why mermaid output (not SVG)?
//   - The first AI draft is rarely final. Users tweak labels, directions,
//     and node names before rendering — that round-trip only works if the
//     CLI gives them editable source, not a final image.
//   - Pipelines compose: `bd ai generate "..." | bd beautify -` is the
//     idiomatic combo, and it only works when generate emits text.
//
// Auth: API key is REQUIRED. The /v1/ai/* endpoints reject anonymous
// callers server-side; we duplicate that check here so we fail fast with
// a clearer message than HTTP 401.

import { ApiClient } from "../lib/api-client.js";
import { getStringFlag, parseArgs } from "../lib/args.js";
import { resolveConfig } from "../lib/config.js";
import { writeOutput } from "../lib/io.js";

interface GenerateMermaidResponse {
  ok: true;
  mermaid: string;
  diagramType: string;
  requestId: string;
  quota: { limit: number; used: number; resetsAt: string };
}

const HELP = `bd ai — AI-powered diagram generation

Usage:
  bd ai generate "<prompt>" [--out FILE] [--hint HINT]

Commands:
  generate <prompt>     Generate Mermaid source from a natural-language
                        prompt. Output is Mermaid text, not an image —
                        pipe into \`bd beautify\` to render an SVG.

Flags:
  --out FILE            Write Mermaid to FILE (default: stdout)
  --hint HINT           Optional shape hint passed to the model
                        (e.g. flowchart, sequence, state)

Auth:
  Requires an API key with the \`ai:write\` scope. AI is paid-only —
  free plans receive 403. Generate a key at /developers/api after
  signing in.

Examples:
  bd ai generate "user signup with email verification"
  bd ai generate "order pipeline" --out order.mmd
  bd ai generate "deploy flow" | bd beautify - --out deploy.svg
`;

export async function runAiCommand(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return sub ? 0 : 2;
  }

  switch (sub) {
    case "generate":
      return runAiGenerate(rest);
    default:
      process.stderr.write(`Unknown ai subcommand: ${sub}\n\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

async function runAiGenerate(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const prompt = parsed.positional.join(" ").trim();

  if (!prompt) {
    process.stderr.write(
      "error: `bd ai generate` requires a prompt.\n  bd ai generate \"user signup flow\"\n",
    );
    return 2;
  }

  const cfg = resolveConfig(
    getStringFlag(parsed, "api-key"),
    getStringFlag(parsed, "base-url"),
  );

  // Server enforces this too (401 not_authenticated), but failing in the
  // CLI gives a sharper message and keeps a stray prompt off the wire.
  if (!cfg.apiKey) {
    process.stderr.write(
      "error: `bd ai generate` requires an API key (AI is paid-only — anonymous demo not supported).\n",
    );
    process.stderr.write("  Run `bd auth login` or set BEAUTY_DIAGRAM_API_KEY.\n");
    return 1;
  }

  const out = getStringFlag(parsed, "out");
  const hint = getStringFlag(parsed, "hint");

  const client = new ApiClient(cfg.baseUrl, cfg.apiKey);
  const res = await client.postJson<GenerateMermaidResponse>(
    "/v1/ai/generate",
    {
      prompt,
      ...(hint ? { hint } : {}),
    },
  );

  writeOutput(res.mermaid, out);

  process.stderr.write(
    `✓ generated (${res.diagramType}) — quota ${res.quota.used} / ${res.quota.limit} (resets ${res.quota.resetsAt})\n`,
  );
  return 0;
}
