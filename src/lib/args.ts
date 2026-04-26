// packages/cli/src/lib/args.ts
//
// Minimal arg parser. We deliberately avoid yargs/commander: this CLI has
// few flags and we'd rather keep zero runtime dependencies for fast `npx`
// cold start.

export type ParsedArgs = {
  positional: string[];
  flags: Map<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(a.slice(2), next);
          i += 1;
        } else {
          flags.set(a.slice(2), true);
        }
      }
    } else {
      positional.push(a);
    }
  }

  return { positional, flags };
}

export function getStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const v = parsed.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

export function getBoolFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}
