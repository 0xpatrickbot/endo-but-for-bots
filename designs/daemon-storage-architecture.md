# Daemon Storage Architecture

| | |
|---|---|
| **Created** | 2026-06-02 |
| **Author** | 0xpatrickbot (prompted) |
| **Status** | Reference (describes current behavior) |

A map of where the Endo daemon keeps durable state today, and what lands in
each surface. This is a *reference* for the current implementation, not a
proposal. It exists to ground discussions that touch persistence — e.g. lal
conversation-continuity, the CAS-management roadmap, and any future
git-backed CAS substrate swap.

## Two surfaces

The daemon persists everything under `{statePath}/` in exactly two places:

1. **SQLite** — `{statePath}/endo.sqlite` (WAL mode). The **object graph** and
   all metadata: typed formula records, pet-name bindings, synced-store
   bookkeeping, and daemon-level key/value state.
2. **Content-addressed store (CAS)** — `{statePath}/store-sha256/{sha256}`.
   **Bulk byte payloads** keyed by SHA-256: blob content, source-directory
   trees, and XS worker heap snapshots. This is the one part of daemon state
   that deliberately did *not* migrate to SQLite, because streaming binary
   data is better served by filesystem I/O than SQLite blobs (see
   `packages/daemon/SQLITE-MIGRATION.md`).

The two surfaces **layer**: a SQLite formula of type `readable-blob` or
`readable-tree` holds a SHA-256 in its `body`, and the bytes that hash names
live in the CAS. Objects reference bytes by hash; bytes never reference
objects.

## How storage works currently

```mermaid
graph TD
    subgraph Guest["Guest caplet (lal / fae / genie)"]
        SV["E(powers).storeValue(passable, petName)"]
        SB["E(powers).storeBlob(reader, petName)"]
        LK["E(powers).lookup(petName)"]
    end

    subgraph SQLite["SQLite — {statePath}/endo.sqlite (WAL)"]
        PSE["pet_store_entry<br/>(store_number, store_type, name, formula_id)<br/><i>name → formula id binding</i>"]
        FORM["formula<br/>(number, type, body)<br/><i>one typed JSON record per object</i>"]
        SYNC["synced_store_entry / synced_store_meta<br/><i>replicated-store bookkeeping</i>"]
        DSTATE["daemon_state (key, value)<br/><i>root_nonce, public_key, private_key</i>"]
        SVER["schema_version"]
    end

    subgraph CAS["CAS — {statePath}/store-sha256/&lt;sha256&gt;"]
        BLOB["readable-blob bytes"]
        TREE["readable-tree<br/>(manifest hash + file blobs)"]
        SNAP["XS worker heap snapshots"]
    end

    SV -->|"marshal → formula row"| FORM
    SV -->|"bind name"| PSE
    SB -->|"stream bytes"| BLOB
    SB -->|"readable-blob formula<br/>(body = sha256)"| FORM
    SB -->|"bind name"| PSE
    PSE -->|formula_id| FORM
    FORM -. "body holds sha256<br/>for readable-blob / readable-tree" .-> CAS
    LK -->|resolve name| PSE
```

**Write paths from a guest's `powers`:**

- `storeValue(passable, petName)` — marshals the passable into a `formula`
  row (type `marshal`), then writes a `pet_store_entry` row binding the pet
  name to that formula id. Value lives entirely in SQLite. The shorter idiom
  for small structured records and capability handles.
- `storeBlob(reader, petName)` — streams the bytes into the CAS via
  `contentStore.store` (returns a SHA-256), creates a `readable-blob` formula
  whose `body` carries that hash, then binds the pet name to it. Bytes in CAS,
  pointer-record in SQLite (`formulateReadableBlob`, `packages/daemon/src/daemon.js`).

**Read path:** `lookup(petName)` resolves the name → formula id via
`pet_store_entry`, loads the `formula` row, and either returns the
unmarshalled passable (for `marshal`) or an `EndoReadable` over the CAS bytes
(for `readable-blob` / `readable-tree`, exposing `.sha256()` / `.text()` /
`.json()` / `.streamBase64()`).

At runtime `pet-store.js` loads all `pet_store_entry` rows into an in-memory
bidirectional multimap on boot and serves reads from memory; writes pass
through to SQLite.

## What goes in what

```mermaid
graph LR
    Root["Daemon durable state<br/>{statePath}/"]

    Root --> SQ["SQLite — endo.sqlite<br/><b>object graph + metadata</b>"]
    Root --> CA["CAS — store-sha256/<br/><b>bulk byte payloads</b>"]

    SQ --> O1["Formulas: evals, guests, hosts,<br/>lookups, mailboxes, caps"]
    SQ --> O2["Pet-name → formula-id bindings"]
    SQ --> O3["Mailbox message metadata"]
    SQ --> O4["readable-blob / readable-tree<br/>formula records<br/><i>(point at CAS by hash)</i>"]
    SQ --> O5["daemon_state: root_nonce,<br/>node keypair"]

    CA --> B1["readable-blob content<br/><i>bundles, files, stored blobs</i>"]
    CA --> B2["readable-tree content<br/><i>source-directory snapshots</i>"]
    CA --> B3["XS worker heap snapshots"]
```

| Axis | SQLite (formula + pet store) | CAS (`store-sha256/`) |
|---|---|---|
| Addressing | name → formula id → formula JSON | SHA-256 hash → bytes |
| Holds | object graph, capability handles, small structured records | binary blobs, source trees, heap snapshots |
| Mutability | a pet name can be rebound; a formula is immutable | content immutable by construction (new content → new hash) |
| Per-guest namespace | yes (pet stores are per-guest formulas) | flat; the daemon owns the hash space |
| Guest write API | `storeValue(passable, petName)` | `storeBlob(reader, petName)` |
| Guest read API | `lookup(petName)` → passable | `lookup(petName)` → `EndoReadable` |
| Lookup-by-hash from guest | n/a | not exposed (daemon-internal `contentStore.fetch`) |
| Reaped when | no formula transitively retains the pet name | no `readable-blob` / `readable-tree` formula retains the hash |
| Suitable for | references, small records | large / binary / de-dupable content |

## Worked example: lal conversation memory

Where an LLM worker's conversation transcript would live makes the layering
concrete. This is the surface the pi-harness migration (#290) regressed and
the candidates under discussion would restore.

```mermaid
graph TD
    PA["PiAgent.state.messages<br/><i>in-process only — lost on daemon restart (post-#290)</i>"]

    PA -. "candidate P / H:<br/>storeValue(messages, petName)" .-> SQ["SQLite formula<br/>(marshalled passable)"]
    PA -. "candidate C:<br/>storeBlob(json-bytes, petName)" .-> CA["CAS blob<br/>(JSON under store-sha256/)"]

    SQ --> R["spawn: lookup(petName)<br/>→ seed initialState.messages"]
    CA --> R

    R --> PA2["fresh PiAgent<br/>with restored context"]
```

- **Candidate P** — snapshot the whole `state.messages` to one pet name each
  turn; `storeValue` → SQLite formula. Smallest diff; O(N²) marshal churn on
  long conversations.
- **Candidate H** (recommended) — write only each turn's *delta* to
  `pi-turn-<inboxNumber>`; `storeValue` → SQLite formula; concat on spawn.
  O(1) per-turn writes, per-turn pruning possible.
- **Candidate C** — same shape via `storeBlob` → CAS bytes. Semantically
  isomorphic to P today; becomes attractive only once a **git-backed CAS**
  lands, where each per-turn blob commit yields a free `git log` of the
  agent's memory. The migration from an H-shaped `storeValue` writer to a
  CAS-blob `storeBlob` writer is a ~10-LOC substrate swap; the `pi-turn-<N>`
  naming is unchanged.

See the durable scoping note (garden journal,
`projects/endo-but-for-bots/lal-pi-harness-memory-regression.md`) for the full
candidate comparison.

## Related designs

- `designs/daemon-cas-management.md` — moving the CAS into the Rust supervisor
  with retain/release reference counting and mark-sweep GC.
- `designs/daemon-endo-rust-sqlite.md` — the Rust/SQLite persistence direction.
- `designs/daemon-endor-architecture.md` — the broader endor architecture.
- `designs/lal-reply-chain-transcripts.md` /
  `designs/lal-transcript-memory-management.md` — the pre-pi-harness durable
  transcript model the memory candidates re-express.
- `packages/daemon/SQLITE-MIGRATION.md` — the filesystem → SQLite migration,
  including why the CAS stayed on the filesystem.
