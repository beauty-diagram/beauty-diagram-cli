#!/usr/bin/env node
// packages/cli/src/index.ts
//
// Entry point for the `bd` binary.
//
// Design rules:
//   - No business logic in here. Each command is a thin function that
//     resolves config, calls the public API, writes output.
//   - The CLI is a *thin client*: never imports from beauty-diagram-engine.
//     If a workflow needs the engine, it goes via /v1/*.

import { runAiCommand } from "./commands/ai.js";
import { runAuthCommand } from "./commands/auth.js";
import { runBatchCommand } from "./commands/batch.js";
import { runBeautifyCommand } from "./commands/beautify.js";
import { runEmbedUrl } from "./commands/embed-url.js";
import { runExportCommand } from "./commands/export.js";
import { runExtractCommand } from "./commands/extract.js";
import { requestShare, runShareCommand } from "./commands/share.js";
import { runThemesCommand } from "./commands/themes.js";
import { runUsageCommand } from "./commands/usage.js";
import { ApiClient, isApiError } from "./lib/api-client.js";
import { getStringFlag, getBoolFlag, parseArgs } from "./lib/args.js";
import { resolveConfig } from "./lib/config.js";
import { readSourceFromFileOrStdin, inferFormatFromPath } from "./lib/io.js";

const HELP = `bd — Beauty Diagram CLI

Usage:
  bd <command> [options]

Commands:
  auth login                       Save an API key from stdin or prompt
  auth logout                      Remove the saved API key
  auth status                      Show current key state and base URL
  themes                           List available themes
  beautify <file> [--theme T] [--out O] [--format mermaid|plantuml]
  export   <file> [--theme T] [--format svg|png] [--out O]
  batch    <paths...> [--out-dir D] [--format svg|png] [--theme T] [--concurrency N] [--stop-on-error]
                                   Render many diagram files in parallel
  extract  <markdown...> [--assets-dir D] [--theme T] [--concurrency N] [--dry-run] [--clean]
                                   Render Mermaid/PlantUML blocks inside Markdown to sidecar SVGs
  share    <file> [--title T] [--theme T]
  embed-url <file> [--theme T] [--share]
                                   Print embed URL(s) for a diagram source
  ai generate "<prompt>" [--out O] [--hint H]
                                   Generate Mermaid source via AI (paid plans only)
  usage                            Show plan, export and AI counters
  help                             Show this help

Global flags:
  --api-key KEY                    Override BEAUTY_DIAGRAM_API_KEY
  --base-url URL                   Override default https://api.beauty-diagram.com

Files:
  Pass "-" or omit <file> to read from stdin.
  Pass "--out -" to write to stdout (default writes to a file).

Auth precedence:
  1. --api-key flag
  2. BEAUTY_DIAGRAM_API_KEY env
  3. Saved config (bd auth login)
  4. Anonymous demo (rate limited, watermarked SVG only)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  switch (command) {
    case "auth":
      return runAuthCommand(rest);
    case "themes":
      return runThemesCommand(rest);
    case "beautify":
      return runBeautifyCommand(rest);
    case "export":
      return runExportCommand(rest);
    case "batch":
      return runBatchCommand(rest);
    case "extract":
      return runExtractCommand(rest);
    case "share":
      return runShareCommand(rest);
    case "embed-url": {
      const parsed = parseArgs(rest);
      const file = parsed.positional[0];
      const cfg = resolveConfig(getStringFlag(parsed, "api-key"), getStringFlag(parsed, "base-url"));
      const sourceText = readSourceFromFileOrStdin(file);
      const theme = getStringFlag(parsed, "theme");
      const share = getBoolFlag(parsed, "share");

      await runEmbedUrl({
        file: file ?? "-",
        sourceText,
        theme,
        share,
        apiBaseUrl: cfg.baseUrl,
        runShare: async ({ file: f, sourceText: src }) => {
          if (!cfg.apiKey) {
            const signUpUrl = new URL("/auth/signup", cfg.baseUrl).toString();
            process.stderr.write(
              "error: `bd embed-url --share` requires an API key. Run `bd auth login` first.\n",
            );
            process.stderr.write(`  Sign up: ${signUpUrl}\n`);
            throw new Error("api key required for --share");
          }
          const client = new ApiClient(cfg.baseUrl, cfg.apiKey);
          const sourceFormat = inferFormatFromPath(f, undefined);
          const res = await requestShare({ client, sourceText: src, sourceFormat });
          return { shareToken: res.shareToken };
        },
        log: (line) => process.stdout.write(`${line}\n`),
      });
      return 0;
    }
    case "usage":
      return runUsageCommand(rest);
    case "ai":
      return runAiCommand(rest);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (isApiError(err)) {
      process.stderr.write(`error: ${err.apiError.code} (HTTP ${err.apiError.status})\n`);
      process.stderr.write(`  ${err.apiError.message}\n`);
      if (err.apiError.signUpUrl) {
        process.stderr.write(`  Sign up: ${err.apiError.signUpUrl}\n`);
      }
      if (err.apiError.upgradeUrl) {
        process.stderr.write(`  Upgrade: ${err.apiError.upgradeUrl}\n`);
      }
    } else if (err instanceof Error) {
      process.stderr.write(`error: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${String(err)}\n`);
    }
    process.exitCode = 1;
  });
