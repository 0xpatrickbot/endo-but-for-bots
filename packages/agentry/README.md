# @endo/agentry

Shared infrastructure for building agentic harnesses across endo packages.

The package is intended to grow as a small library of capabilities that more
than one agent harness in the monorepo needs.
Each surface is opt-in via its own subpath export.

## Current surfaces

- `@endo/agentry/optimizer/*` — an Ax-backed prompt-optimization harness
  (`ax-harness`, `trace-metric`, `model-matrix`,
  `check-prompt-baseline`, `optimize-prompt`, `init`).
  Each consumer supplies its own trial runner, examples, baseline, and system
  prompt; agentry owns the AxGen + AxGEPA / AxACE / AxBootstrapFewShot
  plumbing, the trace-distance scoring rubric, and the SHA256 baseline lint.
- `@endo/agentry/smallcaps` — generic SmallCaps helpers (today: the
  per-field BigInt-literal coercion used by tools whose argument schema
  declares bigint-typed fields; see [`./src/smallcaps/index.js`](./src/smallcaps/index.js)).

## Intended buckets (not yet populated)

- captp helpers — generic CapTP tool-translation utilities, once a clear
  duplicate pattern emerges across the harnesses.
- prompt snippets — reusable building blocks for system prompts.
- provider mocks — shared mocks for `@mariozechner/pi-agent-core` and
  related provider adapters.

## Status

This package is private to the endo monorepo; the consumers today are
`@endo/lal` (optimizer + smallcaps) with `@endo/fae` expected to follow.
The API is best-effort stable but pre-1.0 — breaking changes in this
package can land in the same PR as their workspace consumers.
