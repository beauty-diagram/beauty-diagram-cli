// __tests__/commands/extract.test.ts
//
// Tests for `bd extract` covering both inline (default) and sidecar modes.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that transitively
// load the mocked modules.
// ---------------------------------------------------------------------------

// Shared postRaw mock so sidecar tests can spy on calls.
const mockPostRaw = vi.fn().mockResolvedValue({ body: "<svg>mock</svg>", headers: {} });

// Mock the API client so sidecar tests never hit the network.
// Must use a real class (not arrow fn) so `new ApiClient(...)` works.
vi.mock("../../src/lib/api-client.js", () => {
  class ApiClient {
    postRaw: ReturnType<typeof vi.fn>;
    postBinary: ReturnType<typeof vi.fn>;
    constructor() {
      this.postRaw = mockPostRaw;
      this.postBinary = vi.fn().mockResolvedValue({ body: new Uint8Array(), headers: {} });
    }
  }
  return {
    ApiClient,
    isApiError: vi.fn().mockReturnValue(false),
  };
});

// Mock state file helpers to avoid touching the real ~/.config/bd/state.json.
vi.mock("../../src/commands/extract.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/extract.js")>();
  return {
    ...actual,
    readBdState: vi.fn().mockReturnValue({}),
    writeBdState: vi.fn(),
  };
});

import { runExtractCommand, buildInlineUrl, parseInlineUrlSource, readBdState, writeBdState } from "../../src/commands/extract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "bd-extract-test-"));
}

function writeMd(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

const SIMPLE_MD = `# Hello

\`\`\`mermaid
graph TD
A-->B
\`\`\`

Some text.
`;

const TWO_BLOCK_MD = `# Hello

\`\`\`mermaid
graph TD
A-->B
\`\`\`

Middle text.

\`\`\`plantuml
@startuml
A->B
@enduml
\`\`\`
`;

// A source string that exceeds 5 KB when UTF-8 encoded.
const LARGE_SOURCE = "graph TD\n" + "A-->B\n".repeat(1000); // well over 5 KB

const LARGE_MD = `# Big

\`\`\`mermaid
${LARGE_SOURCE}
\`\`\`
`;

// ---------------------------------------------------------------------------
// buildInlineUrl + parseInlineUrlSource unit tests
// ---------------------------------------------------------------------------

describe("buildInlineUrl", () => {
  it("encodes source as base64url in the URL", () => {
    const url = buildInlineUrl("https://api.beauty-diagram.com", "graph TD\nA-->B", undefined);
    expect(url).toContain("https://api.beauty-diagram.com/v1/beautify.svg?source=");
    const match = url.match(/source=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match![1]!, "base64url").toString("utf8");
    expect(decoded).toBe("graph TD\nA-->B");
  });

  it("appends theme query param when theme is provided", () => {
    const url = buildInlineUrl("https://api.beauty-diagram.com", "graph TD\nA-->B", "atlas");
    expect(url).toContain("&theme=atlas");
  });

  it("omits theme query param when theme is undefined", () => {
    const url = buildInlineUrl("https://api.beauty-diagram.com", "graph TD\nA-->B", undefined);
    expect(url).not.toContain("theme=");
  });

  it("is deterministic for the same source", () => {
    const a = buildInlineUrl("https://api.beauty-diagram.com", "graph TD\nA-->B", "modern");
    const b = buildInlineUrl("https://api.beauty-diagram.com", "graph TD\nA-->B", "modern");
    expect(a).toBe(b);
  });
});

describe("parseInlineUrlSource", () => {
  it("round-trips with buildInlineUrl", () => {
    const src = "graph TD\nA-->B";
    const url = buildInlineUrl("https://api.beauty-diagram.com", src, undefined);
    expect(parseInlineUrlSource(url)).toBe(src);
  });

  it("returns null for a non-beautify URL", () => {
    expect(parseInlineUrlSource("https://example.com/foo")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inline mode — default (no --assets-dir)
// ---------------------------------------------------------------------------

describe("bd extract — inline mode (default)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("injects an inline embed URL after the fence (no --assets-dir)", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    const code = await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    expect(code).toBe(0);

    const result = readFileSync(mdPath, "utf8");
    expect(result).toContain("https://api.beauty-diagram.com/v1/beautify.svg?source=");
    expect(result).toContain("<!-- bd:inline-img hash=");
    expect(result).toContain("<!-- /bd:inline-img -->");
  });

  it("does NOT call /v1/export in inline mode", async () => {
    // mockPostRaw is the shared spy from the module-level ApiClient mock.
    // Inline mode must not touch it at all.
    mockPostRaw.mockClear();
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    expect(mockPostRaw).not.toHaveBeenCalled();
  });

  it("does NOT write any SVG files in inline mode", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(tmp);
    const svgFiles = files.filter((f) => f.endsWith(".svg"));
    expect(svgFiles).toHaveLength(0);
  });

  it("theme is reflected in the inline URL", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    await runExtractCommand([mdPath, "--theme", "atlas", "--base-url", "https://api.beauty-diagram.com"]);

    const result = readFileSync(mdPath, "utf8");
    expect(result).toContain("theme=atlas");
  });

  it("is idempotent — second run produces no diff", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    const afterFirst = readFileSync(mdPath, "utf8");

    await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    const afterSecond = readFileSync(mdPath, "utf8");

    expect(afterSecond).toBe(afterFirst);
  });

  it("processes multiple blocks in a single file", async () => {
    const mdPath = writeMd(tmp, "README.md", TWO_BLOCK_MD);
    const code = await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    expect(code).toBe(0);

    const result = readFileSync(mdPath, "utf8");
    const matches = result.match(/<!-- bd:inline-img hash=/g);
    expect(matches).toHaveLength(2);
  });

  it("dry-run does not write files", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    const originalContent = SIMPLE_MD;
    await runExtractCommand([mdPath, "--dry-run", "--base-url", "https://api.beauty-diagram.com"]);

    const result = readFileSync(mdPath, "utf8");
    expect(result).toBe(originalContent);
  });
});

// ---------------------------------------------------------------------------
// 5 KB cap — inline mode
// ---------------------------------------------------------------------------

describe("bd extract — 5 KB block cap (inline mode)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("skips blocks > 5 KB and exits with code 1", async () => {
    const mdPath = writeMd(tmp, "README.md", LARGE_MD);
    const code = await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    expect(code).toBe(1);
  });

  it("does not inject a URL for the oversized block", async () => {
    const mdPath = writeMd(tmp, "README.md", LARGE_MD);
    await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);

    const result = readFileSync(mdPath, "utf8");
    expect(result).not.toContain("bd:inline-img");
    expect(result).not.toContain("/v1/beautify.svg");
  });

  it("still processes small blocks when a large block is also present", async () => {
    const mixedMd = `# Mixed

\`\`\`mermaid
graph TD
A-->B
\`\`\`

\`\`\`mermaid
${LARGE_SOURCE}
\`\`\`
`;
    const mdPath = writeMd(tmp, "README.md", mixedMd);
    const code = await runExtractCommand([mdPath, "--base-url", "https://api.beauty-diagram.com"]);
    expect(code).toBe(1); // partial failure

    const result = readFileSync(mdPath, "utf8");
    // Small block got a URL
    expect(result).toContain("bd:inline-img");
    // Large block did NOT get a URL — there should be only one marker pair
    const markers = result.match(/<!-- bd:inline-img/g);
    expect(markers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Sidecar mode — --assets-dir preserves existing behaviour
// ---------------------------------------------------------------------------

describe("bd extract — sidecar mode (--assets-dir)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("calls /v1/export (sidecar) and writes an SVG file", async () => {
    // mockPostRaw is the shared spy from the module-level ApiClient mock.
    mockPostRaw.mockClear();
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    const imgDir = path.join(tmp, "img");
    const code = await runExtractCommand([mdPath, "--assets-dir", imgDir]);
    expect(code).toBe(0);
    expect(mockPostRaw).toHaveBeenCalled();
  });

  it("injects a sidecar (bd:img) marker, not an inline-img marker", async () => {
    const mdPath = writeMd(tmp, "README.md", SIMPLE_MD);
    const imgDir = path.join(tmp, "img");
    await runExtractCommand([mdPath, "--assets-dir", imgDir]);

    const result = readFileSync(mdPath, "utf8");
    expect(result).toContain("<!-- bd:img hash=");
    expect(result).not.toContain("bd:inline-img");
  });
});

// ---------------------------------------------------------------------------
// State file helpers — unit tests
// ---------------------------------------------------------------------------

describe("readBdState / writeBdState (mocked)", () => {
  it("readBdState returns {} when the mock returns empty object", () => {
    // The module-level mock returns {} for readBdState
    const state = readBdState();
    expect(state).toEqual({});
  });

  it("writeBdState is callable without throwing", () => {
    expect(() => writeBdState({ extractInlineHintShown: true })).not.toThrow();
  });
});
