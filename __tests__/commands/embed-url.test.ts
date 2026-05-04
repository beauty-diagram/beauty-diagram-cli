import { describe, expect, it, vi } from "vitest";
import { runEmbedUrl } from "../../src/commands/embed-url.js";

describe("bd embed-url", () => {
  it("prints both inline URL and share-mode hint when --share is not set", async () => {
    const log = vi.fn();
    await runEmbedUrl({
      file: "/dev/stdin",
      sourceText: "graph TD\n  A-->B",
      theme: undefined,
      share: false,
      apiBaseUrl: "https://api.beauty-diagram.com",
      runShare: vi.fn(),
      log,
    });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("https://api.beauty-diagram.com/v1/beautify.svg?source=");
    expect(output).toContain("Saved share embed");
    expect(output).toContain("bd share");
  });

  it("includes theme query param when --theme is passed", async () => {
    const log = vi.fn();
    await runEmbedUrl({
      file: "/dev/stdin",
      sourceText: "graph TD\n  A-->B",
      theme: "atlas",
      share: false,
      apiBaseUrl: "https://api.beauty-diagram.com",
      runShare: vi.fn(),
      log,
    });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("&theme=atlas");
  });

  it("with --share, runs share flow and prints only the share URL", async () => {
    const log = vi.fn();
    const runShare = vi.fn().mockResolvedValue({ shareToken: "abc12345" });
    await runEmbedUrl({
      file: "/dev/stdin",
      sourceText: "graph TD\n  A-->B",
      theme: undefined,
      share: true,
      apiBaseUrl: "https://api.beauty-diagram.com",
      runShare,
      log,
    });
    expect(runShare).toHaveBeenCalledOnce();
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("https://api.beauty-diagram.com/v1/share/abc12345.svg");
    expect(output).not.toContain("Saved share embed (clean");
  });

  it("base64-encodes the source for inline URL", async () => {
    const log = vi.fn();
    await runEmbedUrl({
      file: "/dev/stdin",
      sourceText: "graph TD\n  A-->B",
      theme: undefined,
      share: false,
      apiBaseUrl: "https://api.beauty-diagram.com",
      runShare: vi.fn(),
      log,
    });
    const output = log.mock.calls.flat().join("\n");
    const match = output.match(/source=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match![1], "base64url").toString("utf8");
    expect(decoded).toContain("graph TD");
  });
});
