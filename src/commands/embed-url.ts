// src/commands/embed-url.ts
//
// `bd embed-url <file>` — print embed URLs for a diagram source.
//
// Default: prints the inline (anonymous, watermarked) URL plus a hint pointing
// users at `bd share` if they want clean output.
// With --share: runs the share flow first and prints only the share URL.

export interface EmbedUrlOptions {
  file: string;
  sourceText: string;
  theme: string | undefined;
  share: boolean;
  apiBaseUrl: string;
  runShare: (input: { file: string; sourceText: string }) => Promise<{ shareToken: string }>;
  log: (line: string) => void;
}

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function runEmbedUrl(opts: EmbedUrlOptions): Promise<void> {
  if (opts.share) {
    const result = await opts.runShare({ file: opts.file, sourceText: opts.sourceText });
    if (!SHARE_TOKEN_PATTERN.test(result.shareToken)) {
      throw new Error(`Invalid share token format: ${JSON.stringify(result.shareToken)}`);
    }
    opts.log(`${opts.apiBaseUrl}/v1/share/${result.shareToken}.svg`);
    return;
  }

  const encoded = Buffer.from(opts.sourceText, "utf8").toString("base64url");
  const themeQuery = opts.theme ? `&theme=${encodeURIComponent(opts.theme)}` : "";
  const inlineUrl = `${opts.apiBaseUrl}/v1/beautify.svg?source=${encoded}${themeQuery}`;

  opts.log("Inline embed (anonymous, watermarked):");
  opts.log(`  ${inlineUrl}`);
  opts.log("");
  opts.log("Saved share embed (clean output if you have Pro):");
  opts.log("  Run `bd share <file>` first, then use:");
  opts.log(`  ${opts.apiBaseUrl}/v1/share/<id>.svg`);
}
