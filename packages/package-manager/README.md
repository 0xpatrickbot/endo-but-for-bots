# `@endo/package-manager`

Node-side sandbox backend for `EndoPackageManager`.

Inject a `SandboxHandle` or `SandboxFactory` from `@endo/sandbox`, a workspace
reader for package metadata, and optional cache/env policy. The backend builds
fixed npm/pnpm/yarn argv (never shell strings), spawns inside the session
slice, collects bounded stdout/stderr, and supports `cancel(operationId)`.

Pair with `@endo/exo-package-manager` for the portable exo surface. This package
does not use the worker's ambient `npm`/`pnpm`/`yarn` as the acceptance path.
