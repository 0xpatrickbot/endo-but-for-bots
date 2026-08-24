---
'@endo/daemon': minor
'@endo/agentry': minor
---

Add `@endo/daemon/provision.js` for retained, fail-closed filesystem and Git
provisioning without a coding harness.
The client normalizes an inert spec into a versioned non-secret persistence
record and realizes it with a single `E(host).provision(persistence,
forkOptions?)` call; the daemon host validates the record with `@endo/patterns`
shapes and introduces attenuated mounts, Git capabilities, remotes, and named
host powers into a retained guest.

Keep `@endo/agentry/code-mode-provisioning` as a compatibility adapter over the
daemon lifecycle; JavaScript identifier and reserved-binding policing for
compartment globals now lives in agentry rather than the daemon.
Code-mode persistence advances to version 3 so prompt context remains outside
the daemon authority record; version 2 sessions must be reprovisioned.

The provisioning spec now represents the guest-visible filesystem capability as
one `workspace` grant carrying its path, denied segments, and access mode.
An omitted workspace does not bind general filesystem authority, while Git may
still use an internal worktree mount for read-only access.
Writable Git remains capped by a writable guest-visible workspace or named
mount.
