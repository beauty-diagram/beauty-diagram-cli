# @beauty-diagram/cli

Beauty Diagram command-line interface — `bd`.

Render Mermaid / PlantUML to presentation-ready SVG, share a public link, or run
AI refinements straight from the terminal. Talks to the public API at
`https://api.beauty-diagram.com/v1/*` (or any URL you set via `--base-url`).

## Install

```bash
# Run without installing
npx @beauty-diagram/cli beautify flow.mmd --out flow.svg

# Or install globally
npm install -g @beauty-diagram/cli
bd beautify flow.mmd --out flow.svg
```

The package has zero runtime dependencies; cold start under `npx` should be
sub-second.

## Authentication

Three modes, lowest-friction first:

1. **Anonymous demo** — no setup. Watermarked SVG, IP rate limited. Great for
   the first run or for quick `npx` smoke tests.
2. **`BEAUTY_DIAGRAM_API_KEY` env** — for CI / scripts. The CLI never logs the
   raw key.
3. **`bd auth login`** — saves a key to your OS config dir
   (`~/.config/beauty-diagram/config.json` or the Windows equivalent).

```bash
# Save a key
bd auth login                     # paste when prompted
echo bd_live_... | bd auth login  # or pipe it in

# Or pass per-invocation
bd beautify flow.mmd --api-key bd_live_... --out flow.svg

# Inspect
bd auth status
```

Create keys at [`/account/api-keys`](https://www.beauty-diagram.com/account/api-keys).
Pick the smallest scope set that covers your workflow.

## Commands

```bash
bd themes
bd beautify flow.mmd [--theme modern] [--out flow.svg]
bd export   flow.mmd [--theme modern] [--format svg|png] [--quality standard|high|max] [--out flow.svg]
bd batch    <paths...>     [--out-dir DIR] [--format svg|png] [--concurrency N] [--stop-on-error]
bd extract  <markdown...>  [--assets-dir DIR] [--concurrency N] [--dry-run] [--clean]
bd share    flow.mmd [--title "Release flow"] [--theme modern]
bd ai generate "<prompt>" [--hint flowchart|sequence|...] [--out flow.mmd]
bd usage
```

`bd export --format png --quality max` requests a max-tier (4×) PNG. Quality
maps to internal scale (`standard` = 1×, `high` = 2×, `max` = 4×) and the
server caps the effective tier by plan (anonymous / free = standard, pro =
high, premium = max); when clamping happens the CLI prints a one-line note
pointing at the upgrade path. CJK labels in PNGs render as tofu boxes today
— use `--format svg` for diagrams with Chinese / Japanese / Korean text.

### File handling

- Pass `-` or omit `<file>` to read source from stdin.
- Pass `--out -` to write to stdout (binary bytes for PNG; safe to redirect to a file).
- File-extension hints set the source format: `.mmd`/`.mermaid` → mermaid, `.puml`/`.plantuml`/`.pu` → plantuml. Override with `--source-format mermaid|plantuml`.

### Agent-friendly examples

```bash
# Pipe agent-generated mermaid into the CLI without an intermediate file
echo "$mmd_from_agent" | bd beautify --theme modern --out diagrams/release.svg

# Share, then capture the URL for the agent to paste back to the user
url=$(bd share flow.mmd --title "Release flow")
echo "Diagram: $url"
```

## Batch render

Render many diagrams in parallel — one `/v1/export` request per file.

```bash
bd batch ./diagrams                          # recurse a directory
bd batch ./diagrams --out-dir ./svg          # write SVGs to ./svg/, preserving relative paths
bd batch a.mmd b.puml                        # explicit files
bd batch "diagrams/*.mmd" --format png       # single-segment glob (quote it)
bd batch ./d --concurrency 8 --theme neon
bd batch ./d --stop-on-error                 # abort on first failure (default: continue)
```

- Recurses directories looking for `.mmd`, `.puml`, `.plantuml`, `.pu`. Other files are ignored unless listed explicitly.
- Default concurrency is `4`. Each file becomes one independent request, so quota / rate limits behave the same as `bd export`.
- Default failure mode is **continue-on-error**: a per-file `✗` line is printed, the rest of the batch finishes, and the command exits `1` if any file failed.
- `--out-dir` must resolve inside the current working directory — paths that escape (e.g. `--out-dir ../../tmp`) are rejected for safety.

## Embed diagrams in Markdown

`bd extract` finds every ```` ```mermaid ```` / ```` ```plantuml ```` fenced
block in your Markdown files, renders each to a sidecar SVG, and injects an
image reference just below the block. Re-running is **idempotent** —
content-hashed filenames mean unchanged blocks are skipped.

```bash
bd extract README.md
bd extract docs/*.md --assets-dir ./img --concurrency 4
bd extract README.md --dry-run        # preview without writing
bd extract README.md --clean          # also delete orphaned SVGs left from old hashes
```

The injected block looks like this and is recognized on subsequent runs:

```
<!-- bd:img hash=a3f9c2b1 -->
![Diagram 1](./assets/readme-a3f9c2b1.svg)
<!-- /bd:img -->
```

- Markdown files with no diagram blocks are reported and skipped (exit 0).
- `--assets-dir` defaults to `./assets/` next to the Markdown file. It must resolve inside either the Markdown's directory or the cwd — paths that escape are rejected.
- If a single block fails to render, sidecar SVGs already written for that document in the same run are cleaned up so the Markdown is never left half-injected.
- Why sidecar files instead of inline `<svg>`? GitHub, GitLab, and most static-site renderers strip raw `<svg>` from Markdown for safety, so the only reliable embed is `![](path)`.

## Configuration precedence

For each request, the CLI resolves the API key in this order:

1. `--api-key` flag
2. `BEAUTY_DIAGRAM_API_KEY` env var
3. Saved config (set via `bd auth login`)
4. None — falls through to anonymous demo

The base URL follows the same precedence with `--base-url` /
`BEAUTY_DIAGRAM_API_BASE_URL` / saved / `https://api.beauty-diagram.com`.

## Errors

The CLI exits with `1` on any non-2xx response and prints the API error code
plus message to stderr. Common codes:

| Code | Meaning |
|---|---|
| `not_authenticated` | No key, no session — sign in or use `bd auth login`. |
| `scope_missing` | Key lacks the scope the endpoint needs (e.g. `ai:write` for `bd ai generate`). Recreate the key with the missing scope. |
| `plan_not_allowed` | Plan does not include this capability. |
| `parse_failed` | Source did not parse as the declared format. |
| `quota_exhausted` | Plan limit reached for this period. |
| `rate_limited` | Anonymous IP bucket is full — wait or sign in. |
| `output_too_large` | Rasterized PNG exceeds the 8192 px ceiling. Lower `--quality` or simplify the diagram. |
| `not_yet_supported` | Reserved for endpoints that ship in later phases. |

## Privacy

Per-request privacy follows the API:

- Source is never persisted unless you explicitly call `bd share`.
- API logs store hashes / lengths / format — never the raw source or
  instruction text.

## Development

```bash
cd beauty-diagram-cli
npm install                          # one-time
npm run build                        # tsc → dist/
node dist/index.js help
```

Tests:

```bash
npm test
```
