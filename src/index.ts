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

import { runAuthCommand } from "./commands/auth.js";
import { runBeautifyCommand } from "./commands/beautify.js";
import { runExportCommand } from "./commands/export.js";
import { runShareCommand } from "./commands/share.js";
import { runThemesCommand } from "./commands/themes.js";
import { runUsageCommand } from "./commands/usage.js";
import { isApiError } from "./lib/api-client.js";

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
  share    <file> [--title T] [--theme T]
  usage                            Show plan and export counter
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
    case "share":
      return runShareCommand(rest);
    case "usage":
      return runUsageCommand(rest);
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
