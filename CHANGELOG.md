# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-30

First public release.

### Added

- Fence matcher for user messages: renders ```` ``` ```` and `~~~` blocks the same
  way as code in an assistant reply
- Theme-aware syntax highlighting for python, js/ts, json, bash, go, rust, java,
  html/xml, sql and css. Colors come from the existing `--shiki-token-*`
  variables, so light and dark palettes switch automatically
- Language banner and a copy button in the block header
- Monochrome mode for terminal transcripts: `text`, `txt`, `plain`, `output`,
  `log`, `console`, `terminal`, `diff`, `patch`, `markdown`, `md`
- Built-in type and constant-name coloring, plus CSS property names
- A separate HTML/XML tag parser, so `<div class="x">` is not read as operators
- 40 tests and a CI matrix on Node 20/22/24 (Ubuntu and macOS)

### Notes

- An unclosed fence is never rendered as a block, and single backticks stay
  untouched
- No runtime dependencies and no build step: the browser half is a hand-written
  plain-JS module
