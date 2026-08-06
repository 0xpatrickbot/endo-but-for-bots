# `@endo/exo-package-manager`

Portable `EndoPackageManager` capability for confined npm, pnpm, and Yarn
dependency installation and named package scripts.

This package holds the remotable exo surface, pure manager selection, fixed
argv translators, and structured policy errors. Pair it with
`@endo/package-manager` for the Node-side sandbox backend.

It does **not** extend `@endo/exo-npm` (registry resolution). It does not
spawn host package managers or accept shell command strings.

## Methods

- `help`, `detect`, `scripts` — metadata (available on `readOnly()`)
- `install`, `run`, `cancel` — mutating / execution (fail closed when read-only)
- `readOnly()` — attenuate to metadata methods

## Design

See the garden design note `projects/endo-but-for-bots/exo-package-manager.md`.
