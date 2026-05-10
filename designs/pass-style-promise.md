# Pass-Style Promise

| | |
|---|---|
| **Created** | 2026-05-10 |
| **Author** | Kris Kowal (prompted) |
| **Status** | Proposed |
| **Source** | [endojs/endo-but-for-bots#168](https://github.com/endojs/endo-but-for-bots/issues/168) |

## What is the Problem Being Solved?

Endo's marshal layer recognizes only one shape as a `'promise'` pass
style: a frozen native `Promise` that satisfies `isSafePromise`.
Every other passable cap is opaque to the surrounding code (a
`'remotable'` is a `makeExo`/`Far` object whose internals belong to its
host); only `'promise'` is special-cased to require a thenable that the
host platform's `await` machinery can directly synchronize on.

That conflation has two costs.

1. **`await` is implicit synchronization.**
   A pass-style value with a `then` method silently turns `await
   somePromise` and `return somePromise` into a synchronization across
   the cap-protocol boundary.
   Issue [endojs/endo#2869](https://github.com/endojs/endo/issues/2869)
   names this the "then-pinhole" footgun: every `EProxy` that returns a
   pass-style value risks an unintended "follow this promise to
   settlement on the local turn" moment, with no syntactic warning to
   the caller and no safe way for the receiving code to opt out.
   The intuition behind the existing pass-style remotable applies
   equally here: the cap-system layer should hand the application an
   opaque token, and synchronization should be an explicit operation.

2. **Marshal cannot round-trip a promise without a real `Promise`.**
   Issue [endojs/endo#1312](https://github.com/endojs/endo/issues/1312)
   describes the agoric-sdk kernel's need to transform marshaled
   messages while respecting their encoding, including any promise
   slots they carry.
   Today the only object that satisfies `passStyleOf(x) === 'promise'`
   is a real `Promise` instance, which forces the kernel to manage a
   `WeakMap<Promise, kref>` and to manufacture genuine native promises
   purely to act as opaque tokens.
   FUDCo's example in the issue thread is the motivating case.

A pass-style "promise stand-in" addresses both problems at once: a
non-thenable object that `passStyleOf` recognizes as a `'promise'`,
that `E` and an explicit settle/when operation interoperate with, and
that liveSlots can adopt as it adopts a remotable.

## Convergence in the upstream discussion

The 2022 thread on
[endojs/endo#1312](https://github.com/endojs/endo/issues/1312)
converged on three points across @gibson042, @erights, @mhofman, and
@FUDCo.

1. **Non-thenable.**
   The pass-style promise must not have a `then` method (in any form
   reachable through the regular `then` lookup).
   `await x` and `Promise.resolve(x)` must not synchronize on it.
2. **Binding requirement.**
   For any `x` such that `passStyleOf(x) === 'promise'`, the operations
   `E(x).foo()`, `E.when(x, ...)`, and liveSlots' inbound/outbound
   handling must work.
3. **No carried state.**
   The most restrictive shape (no own properties beyond `PASS_STYLE` and
   `Symbol.toStringTag`) is the right starting point.
   Settlement state is private to the producer (the analogue of a
   remotable's private fields).

The matching synchronization design appears in
[endojs/endo#1652](https://github.com/endojs/endo/issues/1652)
("Plan for an improved `eventual-send`").
That plan introduces `WrappedPromise<T>` (a `RemotableBrand` with no
`then`) and the static methods `Promise._wrap`, `Promise.shorten`, and
`Promise.settle` on a `HandledPromise`-like constructor.
`Promise.settle(wp)` is the explicit conversion from the wrapped
(non-thenable) promise back to a platform `Promise<Awaited<T>>` that
`await` can consume.

This design is the synthesis of those two threads, with the most
restrictive `passStyleOf` shape from #1312 and the `Promise.settle`
synchronization shape from #1652.

## Design

### The pass-style shape

A pass-style promise is a frozen object with exactly the following own
properties.

| Property | Value | Notes |
|---|---|---|
| `PASS_STYLE` | `'promise'` | Symbol-keyed; non-enumerable, non-writable, non-configurable. |
| `Symbol.toStringTag` | `'Promise'` (or any string starting with `'Promise'`) | Symbol-keyed; non-enumerable data property. |

The prototype is `Object.prototype` (or `null`).
There is no `then` method.
There is no `catch`, `finally`, `constructor`, or any other own or
inherited property reachable through normal property access.
There is no settlement state observable from outside the producer.

`passStyleOf(x) === 'promise'` is true for two cases.

1. A frozen native `Promise` that passes `isSafePromise` (the existing
   case).
2. A frozen object whose `[PASS_STYLE]` is the string `'promise'` and
   that satisfies the shape table above (the new case).

This matches the most restrictive option proposed in PR
[endojs/endo#1313](https://github.com/endojs/endo/pull/1313) and
addresses the @erights review note that converged on "no carried
state, no `then`".

### Constructor surface

The pass-style/marshal package exports a single constructor, exposed in
`@endo/pass-style`.

```js
/**
 * Returns a frozen non-thenable object x for which
 * `passStyleOf(x) === 'promise'`.
 * The returned object carries no settlement state.
 * Producers that need to track settlement do so in their own closure
 * over the returned token.
 *
 * @returns {PassStylePromise}
 */
export const makePassStylePromise = () => { /* ... */ };
```

`PassStylePromise` is an opaque type alias; from the outside it is
simply a passable value with `passStyleOf` of `'promise'`.

### Synchronization: `Promise.settle`

The eventual-send package gains `HandledPromise.settle` (a free-standing
companion to `HandledPromise.resolve`):

```js
/**
 * Returns a native Promise that fulfills with the eventual settlement
 * value (or rejects with the eventual rejection reason) of `x`.
 *
 * For a pass-style promise that the local liveSlots-equivalent has
 * adopted, this is the moment of explicit synchronization across the
 * cap boundary.
 *
 * For a native Promise, `settle(p)` is the same as `Promise.resolve(p)`
 * (modulo the native-promise reentrancy hardening from #1181).
 *
 * For any other passable, `settle(v)` resolves immediately to `v`.
 *
 * @template T
 * @param {T} x
 * @returns {Promise<UnwrapAwaited<T>>}
 */
HandledPromise.settle = x => { /* ... */ };
```

`E.when(x, onFulfilled, onRejected)` is implemented in terms of
`HandledPromise.settle(x).then(onFulfilled, onRejected)`.
The existing `E.when` API remains the supported way for application
code to react to a settlement; `HandledPromise.settle` is the lower-level
primitive that composes with `await`.

This is the point at issue
[endojs/endo#1652](https://github.com/endojs/endo/issues/1652) names
`Promise.settle`.
The name on the public API is open; `HandledPromise.settle` reads
naturally because it is the operation paired with `HandledPromise.resolve`.

### `E` integration

`E(x)` already accepts any value as its target; the proxy invokes
`HandledPromise.applyMethod` and the underlying handler dispatches.
For a pass-style promise, the dispatch path is the same as for a
remotable that the local side has not adopted: the pending handler
forwards the message to whoever ends up owning the resolution.

In a CapTP setting, the pass-style promise's slot id is what the local
side sends across the wire; the remote side resolves the slot through
the usual promise-resolution machinery.
`captp.js` already distinguishes `'p'`-prefixed slots for promises;
that distinction is unaffected.

### liveSlots integration

LiveSlots (in agoric-sdk) and any liveSlots-equivalent in Endo (the
captp slot tables, the OCapN encoder/decoder) currently identify a
promise by `isPromise`.
The new contract is "an inbound passable that `passStyleOf` reports as
`'promise'`".
This is exactly the substitution FUDCo's example in #1312 illustrates:

```js
// Before (today)
const promiseRefMap = new WeakMap();
export const kslot = (kref, iface) => {
  if (isPromiseRef(kref)) {
    const p = new Promise(() => undefined);  // never settles
    promiseRefMap.set(p, kref);
    return harden(p);
  }
  return Far(iface, { toString: () => `${kref}` });
};

// After (this design)
export const kslot = (kref, iface) => {
  if (isPromiseRef(kref)) {
    return makePassStylePromise();  // no WeakMap; the token is opaque
  }
  return Far(iface, { toString: () => `${kref}` });
};
```

The `WeakMap<Promise, kref>` goes away; the kslot/krefOf pair becomes
symmetric in shape with the remotable case.

### Marshal codec changes

`encodeToCapData` and `encodeToSmallcaps` already special-case
`passStyleOf(val) === 'promise'` to call the user's promise encoder,
which produces a slot.
Both codecs are `passStyleOf`-driven; once `passStyleOf` returns
`'promise'` for the new shape, the codecs need no further change.
The decoder side is similarly unaffected: it asks the user's
`convertSlotToVal` for a value, and the user is now free to return
either a native `Promise` (the legacy path) or a pass-style promise
token (the new path).

### Type narrowing

`packages/pass-style/src/types.d.ts` defines `PassStyleOf` with the
overload `(p: Promise<any>): 'promise'`.
The new case adds an overload `(p: PassStylePromise): 'promise'`.
The existing `PassableCap` union of "remotable | promise" is unchanged;
the union member `Promise<Passable>` is widened (in TypeScript terms)
to `Promise<Passable> | PassStylePromise`.

This interacts with the typing tightening proposed by
[endojs/endo#3068](https://github.com/endojs/endo/issues/3068)
(only `Promise<Passable>` is passable) and
[endojs/endo#2421](https://github.com/endojs/endo/issues/2421)
(promise-for-non-passable typing).
Both of those tighten the value parameter of `Promise<...>`; they do
not constrain the carrier shape, so they compose orthogonally with the
new `PassStylePromise` member.

## Dependencies

| Issue or design | Relationship |
|---|---|
| [endojs/endo#1312](https://github.com/endojs/endo/issues/1312) | Primary upstream issue; this design synthesizes its 16-comment thread. |
| [endojs/endo#1313](https://github.com/endojs/endo/pull/1313) | 2022 draft PR; this design picks the most-restrictive shape and replaces the draft's `then`-allowing variant. |
| [endojs/endo#1652](https://github.com/endojs/endo/issues/1652) | Source of `Promise.settle`/`WrappedPromise`; the synchronization half. |
| [endojs/endo#2869](https://github.com/endojs/endo/issues/2869) | The "then-pinhole" footgun this design closes. |
| [endojs/endo#1181](https://github.com/endojs/endo/issues/1181) | Reentrancy in `await`/`Promise.resolve`; orthogonal but settled in the same code path as `Promise.settle`. |
| [endojs/endo#1587](https://github.com/endojs/endo/issues/1587) | OCapN's promise-vs-remotable distinction; the new shape carries cleanly across OCapN. |
| [endojs/endo#3068](https://github.com/endojs/endo/issues/3068) | Type tightening for `Promise<Passable>`; orthogonal. |
| [endojs/endo#2421](https://github.com/endojs/endo/issues/2421) | `Promise<non-Passable>` typing; orthogonal. |

## Phases

### Phase 1: pass-style classification (S)

- Add a `PromiseHelper` to `packages/pass-style/src/` modeled on
  `RemotableHelper`, recognizing the `[PASS_STYLE]: 'promise'` shape.
- Wire the helper into `passStyleOf`'s `HelperTable` and the
  fallthrough loop in `passStyleOfInternal`.
- Add the `PassStylePromise` type to `types.d.ts` and broaden
  `PassStyleOf` accordingly.
- Export `makePassStylePromise` from `@endo/pass-style`.

This phase is self-contained; PR
[endojs/endo#1313](https://github.com/endojs/endo/pull/1313) is the
template (and a useful starting commit), with the simplification that
the new shape forbids `then` rather than admitting both variants.

### Phase 2: marshal codec compatibility (XS)

The codecs are already `passStyleOf`-driven and need no source change.
This phase is a test-coverage phase: round-trip a pass-style promise
through `capdata` and `smallcaps` (the test cases in PR #1313 are the
template).

### Phase 3: eventual-send integration (M)

- Add `HandledPromise.settle(x)` with the semantics described above.
- Re-implement `E.when` in terms of `HandledPromise.settle`.
- Confirm `E(x).method(...)` dispatches correctly for a pass-style
  promise target (the existing `applyMethod` path already covers
  arbitrary thenable-or-not values; this is mostly a test pass).

### Phase 4: CapTP integration (M)

- `convertValToSlot` allocates a `'p'`-prefixed slot id for a
  pass-style promise, the same as for a native promise.
- `convertSlotToVal` returns a fresh `makePassStylePromise()` for an
  inbound `'p'`-prefixed slot when the local side has no native
  promise to bind.
- Settle-resolution from the remote side updates the producer's
  internal state; downstream `HandledPromise.settle` callers observe
  the resolution.

### Phase 5: documentation and migration (S)

- A `NEWS.md` entry under `@endo/pass-style` and `@endo/eventual-send`.
- A short migration note for liveSlots-style consumers: the
  `WeakMap<Promise, kref>` pattern can collapse into a direct
  `makePassStylePromise()`/slot mapping.
- Cross-link from `@endo/marshal`'s README to the new
  `Promise.settle` operation.

### Phase 6: agoric-sdk uptake (XL, downstream)

This is out of scope for the Endo PR but is the user-visible payoff:
agoric-sdk's liveSlots stops manufacturing native promises as opaque
tokens and adopts `makePassStylePromise` as its kref carrier.
Tracked separately in the agoric-sdk repo once Phases 1 to 5 land
upstream.

## Open Questions

1. **`Promise.settle` API surface.**
   Should the synchronization operation live on `HandledPromise.settle`
   (paired with `HandledPromise.resolve`), on `E.settle`, or on a new
   global similar to the `Promise.settle` proposal in #1652?
   A new global is the cleanest user-facing name; `HandledPromise.settle`
   is the lowest-friction internal name.

2. **`Symbol.toStringTag` exact value.**
   PR #1313 used `'Pseudo-promise'`.
   The pass-style handler today tolerates any string starting with
   `'Promise'` for native promises (`safe-promise.js`).
   Should pass-style promises use the same convention (`'Promise'` or a
   `'Promise '`-prefixed string), or a distinct tag?
   A distinct tag (`'Pseudo-promise'`, or perhaps `'PassStylePromise'`)
   makes the kind visible in console output and stack traces; the same
   tag as native makes the substitution truly transparent.
   The hardened-text-codecs precedent (transparency by default) leans
   toward the same tag.

3. **`for await` and `Promise.all` interop.**
   `for await (const x of asyncIter)` calls `await` internally; passing
   a pass-style promise through that path turns it into a value
   immediately (no settlement, just the token).
   Same for `Promise.all([passStylePromise])`: the array element is
   the token, not its eventual fulfillment.
   The design is that this is the correct behavior (the user must call
   `HandledPromise.settle` explicitly), but it deserves an explicit
   call-out in the docs and a test case.

4. **Opt-in vs. universal.**
   Every existing pass-style consumer that switches on
   `passStyleOf(x)` and currently has no `case 'promise'` arm is
   already broken on a native promise; the new shape does not change
   that.
   But every consumer that has a `case 'promise'` arm and assumes the
   value is a thenable native `Promise` (`x.then(...)`,
   `await x` inside the arm) breaks under the new shape.
   The migration is to call `HandledPromise.settle(x)` first.
   We should grep the upstream tree for `case 'promise'` and the
   downstream tree (agoric-sdk) for the same and audit each call site.

5. **Why did PR #1313 stall in 2022?**
   The @erights review at the time withheld approval on two grounds:
   (a) the requested `checkTagRecord`-based validation, and (b) the
   discomfort of introducing a `passStyleOf === 'promise'` value that
   `E` and `E.when` did not yet work with.
   This design addresses (b) directly by sequencing Phase 3 alongside
   Phase 1 (the eventual-send integration is part of the same delivery,
   not a deferred follow-up).
   Phase 1's helper picks up (a) by reusing the modern `confirmCanBeValid`
   /`assertRestValid` shape.

6. **Settlement state for liveSlots adoption.**
   The 2022 thread surfaced @erights's "forwarded" / "unresolved"
   states as a possible bridge to virtual/durable promises.
   This design intentionally does NOT carry settlement state on the
   pass-style promise itself.
   The producer (liveSlots, captp's slot table, an agoric-sdk vat)
   keeps the state in its own closure.
   A later design can layer durable settlement state on top once the
   non-stateful base is in place.

## Alternatives Considered

### Allow `then` on the pass-style promise

The 2022 PR #1313 began with the most-restrictive shape (no own
properties), and the design discussion considered relaxing to allow a
`then` method.
**Rejected.**
Allowing `then` reintroduces the implicit-synchronization footgun that
issue #2869 names.
The non-thenable shape is the maintainer's stated framing in the
prompt and aligns with the @erights / @mhofman / @FUDCo convergence in
#1312.

### Use a `Far`-style remotable as the promise carrier

A pass-style promise could be expressed as a remotable with a marker
method (e.g., `__isPromise__`).
**Rejected.**
This conflates two distinct passable cap kinds at the marshal layer,
breaks `passStyleOf(x) === 'promise'` as a discriminator, and makes the
CapTP slot-id distinction (`'p'` vs. `'o'` prefix) impossible to
maintain.
The whole point of the pass-style promise is that it is a distinct
kind in the passable taxonomy.

### Defer until virtual/durable promises

@erights's January 2024 follow-up on #1312 asked whether the work
should wait for virtual/durable promise persistence.
**Rejected.**
The non-thenable, no-state base is a prerequisite for virtual/durable
promises (the state lives in the durable storage layer; the in-memory
carrier is the pass-style promise).
Landing the base now unblocks both the agoric-sdk kernel use case
(FUDCo) and the durable-promise design (mhofman) without committing to
the durability model in this PR.

## Test Plan

Tests live under `packages/pass-style/test/`,
`packages/marshal/test/`, `packages/eventual-send/test/`, and
`packages/captp/test/`.

1. **Recognition.**
   `passStyleOf(makePassStylePromise()) === 'promise'`.
2. **Non-thenability.**
   The token has no `then` (own or inherited beyond `Object.prototype`).
   `await passStylePromise` resolves to the token itself, not to a
   settlement value.
3. **Frozen.**
   `Object.isFrozen(passStylePromise) === true`.
4. **Rejected shapes.**
   - With a `then` method: `passStyleOf` throws.
   - With an extra own property: throws.
   - With the wrong `[PASS_STYLE]` value: throws.
   - With an enumerable or accessor `[PASS_STYLE]` descriptor: throws.
5. **Capdata round-trip.**
   `serialize(token)` produces a `slot` encoding; `unserialize` calls
   the user's `convertSlotToVal` and accepts whatever it returns.
6. **Smallcaps round-trip.**
   Same as above through the smallcaps codec (the `&N` shape).
7. **`HandledPromise.settle` on a pass-style promise.**
   The producer side's resolution is observable through
   `await HandledPromise.settle(token)`.
8. **`E.when` on a pass-style promise.**
   The callback fires on the producer's resolution.
9. **`E(token).method(...)` dispatch.**
   The pending-handler path forwards the call.
10. **CapTP round-trip.**
    Send a pass-style promise across a CapTP loopback; the remote side
    receives a fresh pass-style promise that settles when the local
    producer settles.
11. **Existing-consumer regression.**
    Run the existing `pass-style` and `marshal` test suites unchanged;
    no test that passes a native `Promise` should regress.

## Self-Improvement and Bots-Side Note

This design lives in the `endojs/endo-but-for-bots` mirror (per the
prompt at issue #168).
The eventual implementation will land as a PR against `endojs/endo`
(or as a contribution back to the existing draft
[endojs/endo#1313](https://github.com/endojs/endo/pull/1313)),
delivered through the cross-mirror dispatch flow.
This document is the design input to that work; it is not itself the
implementation.

## Prompt

Reproduced from the maintainer comment on
[endojs/endo-but-for-bots#168](https://github.com/endojs/endo-but-for-bots/issues/168#issuecomment-4413989795):

> Please dispatch a designer to synthesize an implementation plan from
> the above resources.

The "above resources" refer to the prior researcher comment at
[endojs/endo-but-for-bots#168 (comment)](https://github.com/endojs/endo-but-for-bots/issues/168#issuecomment-4413986952),
which surfaced the upstream issues and PRs cited above.

The originating issue body for #168:

> Please find the issue on actual endo pertaining to the creation of a
> pass-style variant of promise and a "when" operation on handled
> promises.
> This would introduce a promise type that is not thenable, so would
> not be converted to a native promise and implicitly synchronized on
> await or return.
