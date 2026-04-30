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
bd export   flow.mmd [--theme modern] [--format svg|png] [--scale 1|2|4] [--out flow.svg]
bd share    flow.mmd [--title "Release flow"] [--theme modern]
bd ai generate "<prompt>" [--hint flowchart|sequence|...] [--out flow.mmd]
bd usage
```

`bd export --format png --scale 4` requests a 4x PNG. The server caps the
effective scale by plan tier (anonymous / free = 1x, pro = 2x, premium = 4x);
when clamping happens the CLI prints a one-line note pointing at the upgrade
path. CJK labels in PNGs render as tofu boxes today — use `--format svg` for
diagrams with Chinese / Japanese / Korean text.

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
| `output_too_large` | Rasterized PNG exceeds the 8192 px ceiling. Lower `--scale` or simplify the diagram. |
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
