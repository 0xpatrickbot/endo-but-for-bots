# Fixer state

- Deliverable: replace the sandbox lifecycle wall-clock assertion with a deterministic bounded-drain regression test, verify the sandbox checks, and open a draft PR targeting `llm`.
- Strip owner: the final fixer step removes `STATE.md` and verifies it is absent from the outgoing PR diff before opening the draft PR.
- Branch: detached worktree at the current `llm` tip `39466878eb5c5366a29d15481471d2ffa2068cd`.
- Commits: `d7f16816e` and `d420cf018` are lifecycle fixups; `cd990fd9c` and `3ef0e2731` record this state file.
- Decisions: preserve `DRAIN_GRACE_MS = 250`; use a narrowly scoped factory test seam whose default is the existing real timer.
- Verification: full lifecycle tests passed in all four SES variants; package lint and typecheck, format, composite config validation, clean build/docs, and both grep gates passed. The reversible break failed with `actual 'wait'` versus `expected 'drain'` in all four variants.
- Pending work: remove this file; push and open the required draft PR.
- Hazards: do not alter Podman, CI, containment policy, or production drain timing.
