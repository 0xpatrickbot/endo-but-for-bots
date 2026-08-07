# Workspace state

- Deliverable: reshape PR #958 in place into a named-mount and per-mount Git
  authority model, preserve compatibility inputs, validate exact persistence,
  add focused coverage, and push the existing draft branch normally.
- Strip owner: this fixer removes `STATE.md` in the final branch-shaping step
  and verifies it is absent from the outgoing PR diff before the final push.
- Branch: detached worktree for `build/ebfb-provision-nested-git-grants`.
- Starting SHA: `8cc79e1892125b9c8987d2c23c81517635039d63`.

## Completed

- Read the fixer role and required garden skills.
- Drained the job inbox and prepared the project workspace.
- Re-read PR #958, its revised design comment, the current patch, and PR #960's
  public worktree seam.
- Confirmed the live PR remains draft and unmerged at the starting SHA.
- Replaced nested-only types and normalization with named mount grants and
  per-mount Git grants.
- Updated host realization to materialize every authorized named mount, bind
  only explicitly exposed mounts, and mint exact-root Git capabilities under
  selected-mount ceilings.
- Updated globals, PI reconstruction, persistence validation, and focused
  policy/persistence/globals/PI/daemon lifecycle coverage.

## Decisions

- Input `mounts` names explicit roots with `path`, `mode`, and optional denied
  segments.
- Input `gits` names Git grants with `mount`, `path`, and `mode`; omitted mount
  means the compatibility `workspace` mount.
- Compatibility `workspace`/`fs`/root `git` inputs desugar into the same
  normalized `mounts` and `gits` maps.
- Normalized Git grants retain selected mount, mount-relative segments, and a
  canonical resolved worktree root. Writable Git is capped by its selected
  mount, not by an unrelated filesystem posture.
- Host-only canonical roots stay in trusted policy/realization state and never
  enter guest globals or diagnostics.

## Pending work

- Run regression evidence and required project gates.
- Strip this file, verify final diff, commit, and push the branch.

## Hazards and verification

- Existing PR commits are reviewed history; follow-up commits must remain on
  top and must not amend them.
- PR #960 must remain untouched; only its public seam is a design constraint.
- No product-specific worktree directory may become implementation policy.
- Current uncommitted implementation needs its first semantic commit before
  broader gates; type checking and focused policy/PI/daemon tests are green.
