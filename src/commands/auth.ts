// packages/cli/src/commands/auth.ts

import { createInterface } from "node:readline/promises";

import {
  clearSavedConfig,
  readSavedConfig,
  resolveConfig,
  writeSavedConfig,
} from "../lib/config.js";

export async function runAuthCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === "login") return runLogin();
  if (sub === "logout") return runLogout();
  if (sub === "status") return runStatus();
  process.stderr.write("usage: bd auth (login|logout|status)\n");
  return 2;
}

async function runLogin(): Promise<number> {
  let key = process.env.BEAUTY_DIAGRAM_API_KEY ?? "";

  if (!key) {
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      key = (await rl.question("Paste your API key (bd_live_...): ")).trim();
      rl.close();
    } else {
      key = (await readAllStdin()).trim();
    }
  }

  if (!key.startsWith("bd_live_")) {
    process.stderr.write(
      "error: API key should start with 'bd_live_' (create one at /account/api-keys)\n",
    );
    return 1;
  }

  const existing = readSavedConfig();
  writeSavedConfig({ ...existing, apiKey: key });
  const masked = `${key.slice(0, 12)}…`;
  process.stderr.write(`✓ saved key ${masked}\n`);
  return 0;
}

function runLogout(): number {
  clearSavedConfig();
  process.stderr.write("✓ removed saved key\n");
  return 0;
}

function runStatus(): number {
  const cfg = resolveConfig();
  if (!cfg.apiKey) {
    process.stdout.write(`base url: ${cfg.baseUrl}\n`);
    process.stdout.write("auth: anonymous (no key)\n");
    return 0;
  }
  const masked = `${cfg.apiKey.slice(0, 12)}…`;
  process.stdout.write(`base url: ${cfg.baseUrl}\n`);
  process.stdout.write(`auth: ${cfg.source} (${masked})\n`);
  return 0;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
