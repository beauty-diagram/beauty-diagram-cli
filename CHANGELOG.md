# Changelog

All notable changes to `@beauty-diagram/cli` are documented here.

## [1.4.0] - 2026-05-05

### Breaking default change

- `bd extract` now defaults to **inline embed URLs** instead of sidecar SVG files.
  - To preserve previous behavior, pass `--assets-dir ./img` (or any path).
  - Inline mode produces `<img src="https://api.beauty-diagram.com/v1/beautify.svg?source=...">` references with no API calls during extract, no files written, and no quota consumption — but every URL carries a "Powered by Beauty Diagram" watermark (anonymous endpoint contract).
  - Sidecar mode (`--assets-dir`) remains plan-aware via `/v1/export`: Pro/Premium plans get watermark-free output, free plan gets watermarked output, and quota applies.
  - Blocks larger than 5 KB UTF-8 are skipped in inline mode (URL length cap); use sidecar mode for those.

### Why

`/v1/export` quota was too tight for anonymous and free plan users to finish even one README of fenced blocks, blocking new-user first-run UX. Inline embed mode requires no quota and works for any plan (with watermark trade-off for free).

### Other changes

- `bd extract` prints a one-time first-run hint (via `~/.config/bd/state.json`) directing sidecar-wanting users to `--assets-dir`.
- Blocks exceeding the 5 KB inline cap print a per-block warning and cause exit code 1 (partial failure); other blocks in the same file are still processed.
- Summary line now reports the active mode: `bd extract (inline): ...` or `bd extract (sidecar): ...`.
