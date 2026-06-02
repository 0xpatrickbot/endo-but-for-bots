# Agent Tools: EndoMount-backed Filesystem Tool Group

| | |
|---|---|
| **Created** | 2026-06-01 |
| **Author** | 0xPatrick (prompted) |
| **Status** | Not Started |

## What is the Problem Being Solved?

[endo-gateway-mcp](endo-gateway-mcp.md) proposes `@endo/agent-tools`, a
provider-independent package that lifts Lal's tool catalog out of
`packages/lal/agent.js` into `makeAgentTools(powers, { extra } = {})`
returning `{ tools, executeTool, processToolCalls }`.
It leaves an explicit seam — the `extra` option — where capability-scoped
filesystem, shell, and git tools plug in "as `Dir` / `Shell` / `Git` come
online".
[daemon-agent-tools](daemon-agent-tools.md) is the conceptual parent for
that capability-tool model; its 2026-05-18 revision routes local
filesystem and git authority through `EndoMount`.

Neither design says *how* an `EndoMount`-backed filesystem tool group is
constructed, what its `schema` / `execute` records look like, how it
slots into the `extra` array, or what happens when the underlying mount
is revoked mid-session.
This design fills that gap.
It does **not** re-spec `@endo/agent-tools`; it builds on the package's
`extra` seam and on the already-landed `EndoMount` capability
(`packages/daemon/src/mount.js`, shipped via #339 / #364 / #374).

The motivating property is least authority.
Today Fae's filesystem tools
(`packages/fae/tools/read-file.js`, `packages/fae/src/tool-makers.js`)
reach the disk through ambient `fs.promises` / `child_process.exec`
rooted at a `cwd` *string*, guarded only by a `resolved.startsWith(cwd)`
prefix check.
That tool holds the full ambient filesystem authority of the process it
runs in; the path string is advice, not a boundary.
A prompt-injected instruction that reaches `execute` can read anything
the process can read.
The capability analog confines the tool structurally: it holds an
`EndoMount` over a single subtree, cannot name a path outside it, and
when the mount is revoked the tool's next call rejects and fails closed.

## Background

Three pieces of landed and in-flight code frame the design.

**`EndoMount` (landed).**
`packages/daemon/src/mount.js` exposes a live, mutable, confined
filesystem capability minted by `E(host).provideMount(path, petName,
{ readOnly })` or `E(host).provideScratchMount(petName)`.
Its surface (per `MountInterface` in
`packages/daemon/src/interfaces.js`):
`has`, `list`, `lookup`, `entry`, `stat`, `readText`, `maybeReadText`,
`writeText`, `makeDirectory`, `makeFile`, `remove`, `move`, `write`,
`copy`, `readOnly`, `snapshot`, `help`.
Path arguments accept `string | string[] | EndoMountEntry`.
Confinement is structural and enforced inside the exo: `resolveSegments`
clamps `..` at the mount root, and every I/O method calls
`assertConfined` / `assertConfinedOrAncestor`, which `realPath`-resolve
the candidate (following symlinks) and reject anything that escapes the
confinement root.
`mount.readOnly()` returns a *structurally narrowed* `ReadableTree`
view — only `has` / `list` / `lookup` are present, and the mutating
methods are not on the exo at all, not merely guarded.
`mount.lookup(subpath)` returns a sub-mount (or a mount file) inheriting
the parent's `readOnly` flag and confinement root, so a subtree handle
is itself an attenuated capability.

**`@endo/agent-tools` (proposed, not yet landed).**
Per [endo-gateway-mcp](endo-gateway-mcp.md) §"Package shape", the
package exports `makeAgentTools(powers, { extra } = {})`.
`tools` is an array of OpenAI-format tool schemas (`{ type: 'function',
function: { name, description, parameters } }`), `executeTool(name,
args)` is the dispatcher, and `extra` is an array of additional tool
contributions composed in alongside the built-ins.

**Fae's ambient filesystem tools (the "before").**
`makeReadFileTool(cwd)` in `packages/fae/src/tool-makers.js` returns
`{ schema, execute, help }` where `execute` calls
`fs.promises.readFile(resolveSafe(filePath, cwd))`.
`resolveSafe` is a `path.resolve` plus a `startsWith(cwd)` string check.
This is the anti-pattern the capability tools replace.

## Design

### What a mount-backed tool group is

A *tool group* is a function that takes a capability and returns one or
more tool contributions shaped to drop into `makeAgentTools`' `extra`
array.
A single contribution is the same record shape `@endo/agent-tools`
already uses internally and that Fae already uses today
(`schema()` returning an OpenAI-format schema, `execute(args)` returning
a result), so no new wire contract is introduced.

```mermaid
flowchart LR
    host["EndoHost"] -- "provideMount(path, {readOnly:true})" --> mount["EndoMount<br/>(read-only view)"]
    mount -- "makeMountReadTool(mount)" --> tool["tool contribution<br/>{ schema, execute }"]
    tool -- "extra: [tool]" --> at["makeAgentTools(powers, {extra})"]
    at --> tools["tools[] + executeTool"]
    tools --> harness["Lal / Gateway MCP adapter"]
```

The group's `execute` closes over the `EndoMount` capability, not a path
string.
Every filesystem operation is an `E(mount).<method>(...)` eventual-send.
The tool never holds `fs`, never resolves an absolute path, and cannot
construct a reference to anything the mount does not already reach.

### Composition into the `extra` seam

`makeAgentTools` composes built-in tools with the `extra` array.
A mount-backed group is one entry (or a small flat set of entries) in
that array:

```js
import { makeMountReadTool } from '@endo/agent-tools/mount-fs.js';

const projectMount = await E(powers).lookup('project'); // an EndoMount
const { tools, executeTool } = makeAgentTools(powers, {
  extra: [makeMountReadTool(E(projectMount).readOnly())],
});
```

The contribution participates in `tools` (its `schema()` is projected
into the catalog) and in `executeTool` (a call with its tool name routes
to its `execute`).
The capability-scoped tools and the built-in namespace / mail tools are
peers in the same flat catalog; the LLM sees one tool list.

Two seam questions [endo-gateway-mcp](endo-gateway-mcp.md) §Open
Questions §1 explicitly left open are answered narrowly here for the
filesystem group and surfaced for the maintainer in Open Questions:

- **Name collisions.** The mount-read tool is named `mountReadText`
  (not `readText`) so it does not collide with Lal's built-in `readText`
  (which reads from the *petname* namespace, a different surface). The
  built-in keeps its name; the capability tool takes a distinct one.
- **Absent capability.** A mount-backed group is only added to `extra`
  when the caller already holds the mount. There is no "always-fail
  hidden tool" — if no mount is granted, the group is simply not in
  `extra` and the tool does not appear in the catalog (the same
  conditional-registration shape `daemon-agent-tools` §"Agent tool
  discovery" describes).

### The thinnest first slice: `makeMountReadTool`

The first contribution is read-only and single-method — the capability
analog of Fae's `read-file`:

```js
// packages/agent-tools/mount-fs.js
// @ts-check
import { E } from '@endo/far';

const MAX_TEXT_CHARS = 50_000;

/**
 * A read-only filesystem tool backed by an EndoMount (or a readOnly()
 * ReadableTree view of one). Reads a single text file by mount-relative
 * path. Confinement, symlink-escape rejection, and revocation are the
 * mount's job, not this tool's.
 *
 * @param {import('@endo/far').ERef<{
 *   readText: (path: string | string[]) => Promise<string>
 * }>} mount
 * @returns {{
 *   schema: () => object,
 *   execute: (args: Record<string, unknown>) => Promise<string>,
 *   help: () => string,
 * }}
 */
export const makeMountReadTool = mount => {
  const schema = harden({
    type: 'function',
    function: {
      name: 'mountReadText',
      description:
        'Read a UTF-8 text file from the mounted project directory. ' +
        'Path is relative to the mount root; "../" escapes are rejected.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Mount-relative path to the file to read.',
          },
        },
        required: ['path'],
      },
    },
  });
  return harden({
    schema: () => schema,
    async execute(args) {
      const { path } = /** @type {{ path: string }} */ (args);
      if (!path) {
        throw new Error('path is required');
      }
      const content = await E(mount).readText(path);
      if (content.length > MAX_TEXT_CHARS) {
        return `${content.slice(0, MAX_TEXT_CHARS)}\n\n... (truncated, ${content.length} chars total)`;
      }
      return content;
    },
    help: () =>
      'Read a text file from the mounted project directory (read-only).',
  });
};
harden(makeMountReadTool);
```

What it needs that **already ships**: `EndoMount.readText(path)` and
`EndoMount.readOnly()` are both live in `packages/daemon/src/mount.js`.
The confinement (`assertConfined` + `realPath` symlink resolution) and
the `..`-clamp (`resolveSegments`) are enforced inside the mount exo, so
the tool carries *no* path-safety logic of its own — that is the whole
point of the capability shape.
What it needs that does **not** yet ship: `@endo/agent-tools` itself
(its Phase-1 extraction) and the post-#290 tool seam (below).

The truncation cap mirrors Fae's existing 50 000-char behavior so the
read-only slice is a behavior-preserving swap of the *substrate*, not a
change in the tool's contract to the LLM.

### Attenuation model

Authority on a mount tool is shaped by attenuating the *mount* handed to
the maker, never by the tool gating itself:

- **Read-only.** Pass `E(mount).readOnly()`. The returned view is a
  `ReadableTree` with only `has` / `list` / `lookup`; it has no
  `readText` extension, so a read tool over the narrowed view reads
  through `lookup(path)` → mount-file `text()` rather than the mount's
  `readText`. (`makeMountReadTool` above is written against the
  mount-extension `readText`; a `ReadableTree`-only variant uses
  `E(E(view).lookup(path)).text()`. Either is read-only; the
  `ReadableTree` narrowing is the stronger structural guarantee because
  the mutating methods are absent from the exo entirely.) Open
  Questions §1 names which surface the first slice binds to.
- **Subtree scoping.** Pass `await E(mount).lookup('subdir')` to hand
  the tool a sub-mount confined to a subtree. The sub-mount inherits the
  parent's confinement root and `readOnly` flag; a tool over it cannot
  name a sibling of `subdir`.
- **Destructive-op gating.** Write / move / remove tools are deferred
  past the first slice. When they land they are *separate* makers
  (`makeMountWriteTool`, etc.) added to `extra` only when a writable
  mount is granted; a read-only deployment simply never includes them.
  Gating is by which makers the caller composes, not by a runtime flag
  inside a single omnibus tool. This keeps the authority of the tool set
  legible from the `extra` array alone.

### Revocation: fail closed, no restart

A mount is a daemon formula. When the formula is cancelled
(`E(host).cancel(petName)`) or garbage-collected (the mount becomes
unreachable from any retained formula), the daemon tears down the exo.
The tool holds an `ERef` to that exo, so the *next* `E(mount).readText(...)`
after revocation rejects — the eventual-send resolves to a rejection
because the target no longer resolves.

Three properties follow, and they are the security payoff:

1. **No ambient fallback.** Unlike the Fae tool, there is no `fs` to
   fall back to. A revoked mount tool cannot read anything; it can only
   reject. The blast radius of a compromised or injected agent loop is
   bounded by the mount, and revoking the mount closes it immediately.
2. **No restart needed.** Revocation is observed at call time as a
   rejected promise; the agent loop sees a failed tool call and reports
   it like any other error. The harness does not need to be restarted to
   drop the authority. This is the live-revocation property ocap
   capabilities give for free.
3. **Stale handles do not re-acquire authority.** Because the tool
   closes over the capability reference (not a path), a re-minted mount
   at the same path under a new formula id is a *different* capability;
   the old tool's reference does not silently start working again. Re-
   granting is an explicit re-composition of `extra` with the new mount.

The tool maker itself does nothing special for revocation — it neither
catches nor retries. Failing closed is the default behavior of an
eventual-send to a revoked target; the design's job is to *not* defeat
it (e.g. by caching reads or holding a host-path string alongside the
capability).

### Before / after contrast

| | Fae `read-file` (ambient) | `makeMountReadTool` (capability) |
|---|---|---|
| Authority held | process-wide `fs.promises` | one `EndoMount` over one subtree |
| Path boundary | `resolved.startsWith(cwd)` string check | structural: `assertConfined` + `realPath` symlink resolution inside the exo |
| `../` escape | blocked only if the string prefix check holds | clamped at mount root by `resolveSegments` |
| Symlink escape | not checked (a symlink under `cwd` pointing out is followed) | rejected (`assertConfined` resolves the physical path) |
| Revocation | none — the tool always works while the process lives | next call rejects when the mount formula is cancelled / GC'd |
| Blast radius of injection | whatever the process can read | the mount subtree only |
| Construction input | a `cwd` string | an `EndoMount` capability reference |

### Package placement

The mount-fs group lives in `@endo/agent-tools` as a sibling module to
the built-in catalog, since it is the canonical first `extra`
contribution and the package is the agreed home for the tool-catalog
shape:

```
packages/agent-tools/
  mount-fs.js        # makeMountReadTool (this design); write/list/stat siblings later
  test/
    mount-fs.test.js
```

It depends only on `@endo/far` (`E`) and the `EndoMount` *shape* (it
does not import `packages/daemon` — it is handed a capability reference
at call time), keeping `@endo/agent-tools` free of a daemon dependency,
consistent with the package's provider-independent intent.

## Test plan

`packages/agent-tools/test/mount-fs.test.js`. The mount under test is a
real `makeMount({ rootPath, readOnly, filePowers })` over a `mkdtemp`
directory (teardown registered per the project AVA conventions), so the
tests exercise the actual confinement and revocation behavior, not a
stub.

1. **Happy path.** Mount a temp dir containing `a.txt`; assert
   `execute({ path: 'a.txt' })` returns its contents. Assert the
   >50 000-char truncation branch on a large file.
2. **Structural out-of-mount access failure.** Assert
   `t.throwsAsync(() => execute({ path: '../secret' }), { message:
   /escapes mount root|root/ })` — the `..` is clamped / rejected by the
   mount, not by the tool. Add a symlink inside the mount pointing
   outside it and assert reading through it rejects, proving the guard
   is the mount's `realPath` resolution and not a string prefix check.
3. **Revoke-then-call fails closed.** Construct the tool over a mount,
   confirm one successful read, then revoke the mount (cancel its
   formula in a daemon-backed test, or in a unit test drop the only
   reference and force the exo's backing to reject) and assert the next
   `execute` rejects rather than returning stale or ambient content.
   Assert the rejection is *not* satisfiable by any on-disk file — there
   is no ambient fallback path.
4. **`extra`-seam integration.** Once `@endo/agent-tools` Phase 1 is
   landed: assert `makeAgentTools(powers, { extra: [makeMountReadTool(
   mount)] })` surfaces `mountReadText` in `tools` and that
   `executeTool('mountReadText', { path })` routes to the group's
   `execute`. This test is gated on Phase 1 and may land with the
   integration, not the first slice.

## Sequencing and dependencies

This work has two hard predecessors, stated plainly:

1. **#290 must merge first.** PR #290 (`feat/lal-pi-harness`) swaps Lal's
   harness for `@endo/genie`'s pi-based one while preserving the tool
   surface by name and cleanly separating the LLM loop from the tools.
   Until it lands, Lal's tool catalog and `executeTool` switch are still
   entangled with the pre-pi harness in `packages/lal/agent.js`. Building
   the `extra`-seam consumer against the pre-#290 file would mean writing
   against a tool seam that #290 reshapes. The mount-fs maker itself does
   not import Lal, so it can be *written* independently, but its
   integration test (test 4) and the Lal-side composition example assume
   the post-#290 separated seam.

2. **`@endo/agent-tools` Phase 1 must land.** Per
   [endo-gateway-mcp](endo-gateway-mcp.md) §"Phase 1: extract
   `@endo/agent-tools`", the tool catalog, SmallCaps decoder,
   `executeTool`, and `processToolCalls` move out of `packages/lal/agent.js`
   into the new package, and `makeAgentTools(powers, { extra })` becomes
   the construction point. The `extra` array is the slot this group
   plugs into; without it there is no seam to target. Phase 1 is the
   refactor; this design is the first thing that uses the seam Phase 1
   opens.

Ordering: **#290 → `@endo/agent-tools` Phase 1 → this design's
`makeMountReadTool`**. The maker module and its unit tests (tests 1–3)
can be drafted in parallel with Phase 1 because they depend only on the
landed `EndoMount`; the integration test (test 4) and the catalog wiring
wait for Phase 1.

The capability itself (`EndoMount`, `provideMount`, `readOnly()`) is
**already landed** and is not a blocker.

## Dependencies

| Design | Relationship |
|--------|--------------|
| [endo-gateway-mcp](endo-gateway-mcp.md) | Defines `@endo/agent-tools` and the `extra` seam this group plugs into. This design does not re-spec the package; it fills the "compose via `extra`" gap that design's Open Questions §1 leaves open for filesystem tools. |
| [daemon-agent-tools](daemon-agent-tools.md) | Conceptual parent: the `Dir` / `Shell` / `Git` capability-tool model. Its 2026-05-18 revision routes fs authority through `EndoMount`; this design is the concrete first realization (Phase 1, filesystem, read slice) of that revised model. |
| [daemon-mount-capabilities](daemon-mount-capabilities.md) | The `EndoMount` capability (landed) this group is built over: `readText`, `readOnly()`, sub-mounts, and the `provideHostPath` host-only path accessor (which this group deliberately does **not** use — the tool holds the capability, not a path). |

## Design Decisions

1. **The tool holds a capability, not a path.** `execute` closes over an
   `EndoMount` `ERef` and does every operation via `E(mount).<method>`.
   This is the single decision from which confinement, symlink-escape
   rejection, and fail-closed revocation all follow for free.

2. **Attenuate the mount, not the tool.** Read-only and subtree scoping
   are expressed by handing the maker an already-attenuated mount
   (`readOnly()`, `lookup(subdir)`), and destructive operations are
   separate makers added to `extra` conditionally. The authority of a
   tool set is legible from its `extra` array; there is no per-tool
   runtime flag to audit.

3. **Distinct tool name to avoid collision.** `mountReadText` does not
   shadow Lal's built-in `readText` (which reads the petname namespace).
   This is the narrow, filesystem-group answer to the name-collision
   open question [endo-gateway-mcp](endo-gateway-mcp.md) §Open Questions
   §1 deferred.

4. **Read-only first slice.** The first contribution is one read method,
   mirroring Fae's `read-file`, to prove the seam and the
   confinement/revocation properties before any destructive operation is
   exposed. Considered and rejected: shipping a full `Dir` tool group
   (read + write + list + stat + glob) in one slice. Reason: the
   read-only slice is the smallest thing that demonstrates the
   capability substitution end to end, and write/move/remove each carry
   their own destructive-op gating decisions better made once the read
   slice is in review.

5. **No daemon dependency in `@endo/agent-tools`.** The maker imports
   only `@endo/far` and is handed the mount capability at call time, so
   the package stays provider- and daemon-independent, matching the
   package's stated intent.

## Open Questions

1. **Which mount surface does the first slice bind to —
   `EndoMount.readText` or the `readOnly()` `ReadableTree` view's
   `lookup(path)` → `text()`?** Both are read-only. `readText` is one
   round-trip and simpler; the `ReadableTree` view is the stronger
   structural guarantee (the mutating methods are absent from the exo,
   not merely unused). The design shows the `readText` form and notes
   the `ReadableTree` alternative; the maintainer decides whether the
   first slice should bind to the narrowed view for the stronger
   property at the cost of a second eventual-send per read.

2. **Where does the granted mount come from in the Lal/Fae integration
   — a fixed petname (e.g. `project`) the host grants, or the
   form-based provisioning of
   [daemon-agent-tools](daemon-agent-tools.md) §"Form-based capability
   provisioning"?** This design assumes the caller already holds the
   mount and is concerned only with turning it into a tool; the grant
   mechanism (petname lookup vs. provisioning form) is a separate
   integration decision the maintainer can route to the agent-tools
   integration PR.

## Prompt

> Write a focused technical design for the EndoMount-backed capability
> filesystem tool group as the first `extra`-slot contribution to
> `@endo/agent-tools`, with `makeMountReadTool(mount)` over a
> `readOnly()` `EndoMount` as the thinnest first slice (the capability
> analog of fae's ambient `read-file`). Build on `endo-gateway-mcp` and
> `daemon-agent-tools` rather than re-speccing `@endo/agent-tools`; fill
> the gap of how the EndoMount-backed tool group composes into the
> `extra` seam. Cover construction from a real `EndoMount`, the
> tool-schema/`executeTool` shape, the attenuation model, fail-closed
> revocation, the first slice, a before/after contrast vs fae's ambient
> `read-file.js`, a test plan, and the sequencing on #290 plus the
> agent-tools Phase-1 extraction.
</content>
</invoke>
