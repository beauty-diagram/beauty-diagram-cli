// packages/cli/src/lib/config.ts
//
// Token + base-URL config. Resolution order (highest priority first):
//   1. Explicit `--api-key` / `--base-url` flag.
//   2. Env vars (BEAUTY_DIAGRAM_API_KEY / BEAUTY_DIAGRAM_API_BASE_URL).
//   3. Saved config (~/.config/beauty-diagram/config.json on Linux/macOS;
//      %APPDATA%\beauty-diagram\config.json on Windows).

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://api.beauty-diagram.com";

export type CliConfig = {
  apiKey?: string;
  baseUrl?: string;
};

function configDir(): string {
  if (platform() === "win32") {
    const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
    return path.join(appdata, "beauty-diagram");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return path.join(xdg, "beauty-diagram");
}

function configFile(): string {
  return path.join(configDir(), "config.json");
}

export function readSavedConfig(): CliConfig {
  const file = configFile();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as CliConfig;
    return parsed;
  } catch {
    return {};
  }
}

export function writeSavedConfig(config: CliConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(configFile(), JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearSavedConfig(): void {
  const file = configFile();
  if (existsSync(file)) unlinkSync(file);
}

export type ResolvedConfig = {
  apiKey: string | null;
  baseUrl: string;
  source: "flag" | "env" | "saved" | "default";
};

export function resolveConfig(flagKey?: string, flagBaseUrl?: string): ResolvedConfig {
  const saved = readSavedConfig();

  let apiKey: string | null = null;
  let source: ResolvedConfig["source"] = "default";

  if (flagKey) {
    apiKey = flagKey;
    source = "flag";
  } else if (process.env.BEAUTY_DIAGRAM_API_KEY) {
    apiKey = process.env.BEAUTY_DIAGRAM_API_KEY;
    source = "env";
  } else if (saved.apiKey) {
    apiKey = saved.apiKey;
    source = "saved";
  }

  const baseUrl =
    flagBaseUrl ??
    process.env.BEAUTY_DIAGRAM_API_BASE_URL ??
    saved.baseUrl ??
    DEFAULT_BASE_URL;

  return { apiKey, baseUrl, source };
}
