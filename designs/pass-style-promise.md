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

The shared-`'promise'`-tag formulation above is provisional; whether
the new shape gets its own tag (e.g. `'pseudoPromise'`) is Open
Question 4 below.
The non-thenable contract and the pass-through preservation of
native promises are independent of that choice.

### Constructor surface

The carrier shape AND the producer-side construction live in
`@endo/pass-style`.
The package exports a single constructor that hands back both a
non-thenable carrier and a private resolver paired with it.

```js
/**
 * Returns a kit containing a frozen non-thenable carrier `promise`
 * (for which `passStyleOf(promise) === 'promise'`) and a private
 * `resolver` that the producer holds in its own closure.
 *
 * The carrier itself carries no settlement state.
 * The resolver is the only handle that can drive the carrier's
 * resolution; passing the carrier to a third party does not pass
 * the ability to settle it.
 *
 * @param {object} [options]
 * @param {() => void} [options.onFirstSubscribe]
 *   Invoked exactly once, on the next turn after the first
 *   subscriber attaches via `HandledPromise.subscribe(promise, …)`,
 *   `HandledPromise.settle(promise)`, or `E.when(promise, …)`.
 *   If the producer rejects or resolves before any subscriber
 *   arrives, `onFirstSubscribe` still fires (on the next turn after
 *   the first subscriber arrives, even though settlement is already
 *   recorded).
 *   If `onFirstSubscribe` is omitted, no first-subscribe
 *   notification is delivered.
 *   See "Producer-side first-subscribe notification" below.
 * @returns {{ promise: PassStylePromise, resolver: Resolver }}
 */
export const makePromise = (options) => { /* ... */ };
```

`PassStylePromise` is an opaque type alias; from the outside it is
simply a passable value with `passStyleOf` of `'promise'`.
`Resolver` exposes `resolve(target)` and `reject(reason)` operations
that the producer alone may invoke.

The package boundary is deliberate: the shape of a pass-style promise
is the purview of `@endo/pass-style`, so the construction primitive
lives there too.
`@endo/eventual-send` consumes carriers (via `subscribe` and `settle`,
and by registering them with `HandledPromise`); it does not construct
them.
This is the dependency-direction-correct factoring (`eventual-send`
already depends on `pass-style`, not the other way around).
Earlier drafts placed the producer-side kit in `eventual-send` and
forced the builder to re-derive the carrier shape locally; that
indirection is what motivated this revision.

### Producer-side first-subscribe notification

`makePromise(options)` accepts an `onFirstSubscribe` callback in its
`options` bag.
The callback fires exactly once, on the next turn after the first
subscriber attaches to the carrier through any of the supported
subscription paths (`HandledPromise.subscribe(promise, …)`,
`HandledPromise.settle(promise)`, or `E.when(promise, …)`).
If the producer omits `onFirstSubscribe`, no notification is
delivered and the carrier behaves exactly as in the bare
`makePromise()` case.

The motivating use case is a producer that wants to defer computing
the resolution value until a consumer actually asks for it.
A pass-style promise can travel through the cap-system layer (carried
across several messages, retained in tables, encoded and decoded by
the marshal codecs) before any consumer subscribes.
A producer that did all the work to compute its resolution eagerly
would be doing work whose results may never be observed.
The first-subscribe hook lets the producer wait until at least one
consumer has expressed interest before doing the work.

Fire-once semantics: the callback is invoked at most once per
carrier, on the next turn after the first subscriber arrives.
Settlement state is independent of subscription state.
If the producer rejects or resolves before any subscriber arrives,
the rejection or resolution is recorded on the producer's record
(per the rejection-retention principle below).
`onFirstSubscribe` still fires when the first subscriber eventually
attaches, even though the settlement is already in hand; the
producer may use the hook for diagnostics or telemetry that is only
meaningful once a consumer has shown up.

Scope rationale.
The `onFirstSubscribe` hook is **only available on
PassStylePromise**.
There is no equivalent on a native `Promise` (the platform exposes
no producer-side hook for subscriber arrival; a native promise's
resolver is closed over at construction and is not reachable from
the outside).
There is no equivalent on a `HandledPromise` either: a
HandledPromise's handler protocol exists for the *consumer* side
(`applyMethod`, `get`, etc.), not the producer side, and its
handler is invoked on message dispatch rather than on subscriber
arrival.
A future generic `HandledPromise.onFirstSubscribe(p, cb)` op
(Option B in the upstream discussion) was considered and
deferred; if added, it would error early on any non-PassStylePromise
input, for the same reason.
The producer-side scope is a deliberate factoring (the producer
owns the resolver; the resolver is where the notification belongs),
not an arbitrary limitation.

Interaction with rejection retention.
The "do not surface rejections to unsubscribed promises" principle
in the next section says a rejection on a carrier with no
subscribers is held until the first subscriber arrives, not
emitted eagerly to the host's unhandled-rejection path.
`onFirstSubscribe` composes naturally with that principle: a
producer can use the hook to implement lazy diagnostics (record a
debug breadcrumb when the rejection happens, defer the log line
until a subscriber arrives and the rejection is about to be
delivered).
The hook does not change the rejection-retention contract; it
gives the producer a place to react when the held rejection is
about to start moving.

Worked example: a lazy-computation producer.

```js
const { promise, resolver } = makePromise({
  onFirstSubscribe: () => {
    // Defer the expensive computation until a consumer asks.
    computeAnswer().then(
      answer => resolver.resolve(answer),
      err => resolver.reject(err),
    );
  },
});
// `promise` may travel through several message hops before any
// consumer subscribes; `computeAnswer` does not run until one
// does.
return promise;
```

A consumer that calls `await HandledPromise.settle(promise)` (or
`E.when(promise, …)`, or `HandledPromise.subscribe(promise, cb)`)
triggers `onFirstSubscribe` on the next turn, which in turn starts
`computeAnswer()`.
A consumer that never subscribes leaves the producer's work
undone, which is the intended laziness.

### Subscription: `HandledPromise.subscribe`

`subscribe` is the lower-level callback-based primitive on which the
promise-returning `HandledPromise.settle` (below) composes.
It is the single explicit way to observe a pass-style promise's
eventual resolution; because the carrier itself has no `then` method,
`await` cannot do this implicitly.

```js
/**
 * Registers `callback` to fire exactly once when `x` settles.
 * The callback receives the settlement target as its only argument.
 *
 * The settlement target is the value the producer resolved the
 * pass-style promise to. It is one of four shapes:
 *
 *   1. A final concrete Passable (a primitive, a record, an array, a
 *      remotable, or `undefined` for a void resolution).
 *   2. A native `Promise` that itself settles later. The subscriber
 *      is responsible for synchronizing on it (e.g. via
 *      `HandledPromise.settle` or by awaiting it directly, which is
 *      safe because a native Promise is thenable).
 *   3. A `HandledPromise` whose handler will dispatch on it.
 *   4. Another pass-style promise; the subscriber re-subscribes to
 *      that one to chase the chain to its eventual ground value.
 *
 * The four targets are distinguishable by `passStyleOf` and a
 * platform `isPromise` check:
 *   - `passStyleOf(target) !== 'promise'` → case 1 (final value).
 *   - `passStyleOf(target) === 'promise'` and the target is a frozen
 *     native Promise (`isSafePromise(target)`) → case 2 or 3
 *     (a HandledPromise satisfies `isSafePromise`).
 *   - `passStyleOf(target) === 'promise'` and the target is not a
 *     native Promise → case 4 (another pass-style promise).
 *
 * `subscribe` is fire-once: settlement is final on the underlying
 * carrier, and a second resolution by the producer is a contract
 * violation that the implementation MAY enforce. Subscribers added
 * after a settlement has already occurred fire on the next turn with
 * the recorded target.
 *
 * Rejections are surfaced through a separate `onRejected` argument
 * (analogous to `Promise.prototype.then`'s second argument) so that
 * the subscriber callback's signature distinguishes "the producer
 * fulfilled with this target" from "the producer rejected with this
 * reason". An omitted `onRejected` rethrows on the next turn into the
 * unhandled-rejection path of the host.
 *
 * @template T
 * @param {T} x  A pass-style promise, native Promise, HandledPromise,
 *               or any other passable.
 * @param {(target: SubscribeTarget) => void} onFulfilled
 * @param {(reason: any) => void} [onRejected]
 * @returns {void}
 */
HandledPromise.subscribe = (x, onFulfilled, onRejected) => { /* ... */ };
```

`SubscribeTarget` is the union of "any Passable that is not a
pass-style promise" with "Promise | HandledPromise | PassStylePromise".
The subscriber that wants the ground value, not just the next link in
the chain, walks the chain itself by re-subscribing on each
pass-style-promise hop and awaiting any thenable hop.

This callback shape is deliberate.
A subscriber that wants a Promise can build one with
`new Promise((resolve, reject) => HandledPromise.subscribe(x, resolve, reject))`,
which is exactly what `HandledPromise.settle` does (see below).
Going the other direction (deriving subscribe-shape from a
promise-returning primitive) is also possible but introduces an
unconditional microtask hop and forecloses the optimization where the
producer can synchronously deliver a target that is already known at
subscription time.

`subscribe` is **not** triggered by `await`.
The pass-style promise has no `then` method, by design (per the
non-thenable contract above), so `await passStylePromise` resolves to
the carrier itself, never to its settlement target.
A consumer that wants to observe settlement must call `subscribe` (or
`HandledPromise.settle`) explicitly.

#### Principle: do not surface rejections to unsubscribed promises

When a producer rejects a pass-style promise that has no subscribers
yet, the rejection is retained on the producer's record.
It is delivered to the first subscriber that arrives, not eagerly
thrown to the host's unhandled-rejection path.

This principle generalizes beyond pass-style promises.
A promise (native or pass-style) sometimes travels before it is
subscribed.
Eagerly surfacing a rejection that no consumer has had the chance to
handle yet produces spurious noise; swallowing it produces silent
failures.
Both are bad answers to a false dichotomy.
The right answer for a chain like:

```js
const a = makePromise();
const b = makePromise();
a.resolver.resolve(b.promise);
b.resolver.reject(new Error('boom'));
```

is that `b`'s rejection rides through `a`'s eventual subscriber, not
that the host emits an unhandled-rejection event for `b` before any
subscriber has had a turn.

The forward-looking direction (out of scope for this design, captured
here for the next iteration): a debug-view ring buffer of recent
long-pending, forever-pending, and unsubscribed-rejection promises,
inspectable while debugging without producing noise in production.
Promises sometimes travel before they are subscribed; the debugger
should be able to see them in transit without forcing a production
log line on every hop.
This is a separate design and is not blocked by the present one.

### Synchronization: `Promise.settle`

`HandledPromise.settle` is the promise-returning convenience layered
on top of `subscribe`.
It returns a native Promise so that callers using `await` can
synchronize on the eventual resolution.

```js
/**
 * Returns a native Promise that fulfills with the eventual settlement
 * value (or rejects with the eventual rejection reason) of `x`,
 * recursively walking through any chain of pass-style promises,
 * native Promises, or HandledPromises until a non-promise Passable
 * is reached.
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
 * The reference implementation is roughly:
 *
 *     HandledPromise.settle = x => new Promise((resolve, reject) => {
 *       const onFulfilled = target => {
 *         if (passStyleOf(target) === 'promise' || isPromise(target)) {
 *           HandledPromise.subscribe(target, onFulfilled, reject);
 *         } else {
 *           resolve(target);
 *         }
 *       };
 *       HandledPromise.subscribe(x, onFulfilled, reject);
 *     });
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
code to react to a settlement; `HandledPromise.settle` is the
intermediate-level primitive that composes with `await`; `subscribe`
is the lowest-level primitive that the other two compose on.

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

The integration is not, however, a pure test pass.
The implementation needed two specific changes that earlier framings
of this design underestimated.

1. **`HandledPromise.resolve(carrier)` recognizes pass-style carriers
   and routes through `HandledPromise.settle(carrier)`.**
   Without this, `HandledPromise.resolve(carrier)` falls through the
   "this is not a thenable, treat it as a fulfilled value" branch and
   produces a native promise fulfilled with the carrier itself.
   Subsequent `E(carrier).method(...)` then dispatches against the
   carrier (which has no methods) instead of routing to the eventual
   target.
   Routing `resolve` through `settle` for the carrier shape unwinds
   the chain to the actual target before any dispatch fires.

2. **The contestant-race in `handle()` skips the synchronous-target
   optimization for pass-style carriers.**
   `handle()` races two contestants when dispatching a method: the
   handler's eventual answer and a synchronous fallback that fires
   if the target is already a settled native value.
   For a pass-style carrier the synchronous fallback is wrong: the
   carrier is opaque, the second contestant wins immediately, and
   the dispatch lands against the carrier itself rather than against
   the eventual target.
   The fix is a `passStyleOf(target) === 'promise' &&
   !isPromise(target)` guard at the contestant-race site that defers
   to the asynchronous dispatch path for pass-style carriers.

These two integration points are minimal, but each prevents a
specific failure mode the implementation discovered: the first
prevents `E(carrier).method()` from dispatching against the carrier
instead of the target; the second prevents the same failure mode
showing up via the contestant-race even when `resolve` routes
correctly.

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
    const { promise, resolver } = makePromise();
    // The producer keeps `resolver` in its own table keyed by kref;
    // only `promise` (the opaque carrier) escapes to callers.
    rememberResolver(kref, resolver);
    return promise;
  }
  return Far(iface, { toString: () => `${kref}` });
};
```

The `WeakMap<Promise, kref>` goes away; the kslot/krefOf pair becomes
symmetric in shape with the remotable case.
The producer-side resolver replaces the never-settling-Promise + WeakMap
plumbing with an explicit handle the producer holds privately.

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

## Constraints

The following are non-negotiable contracts on the design.
They override any convenience or implementation-shortcut they conflict
with.

### Not a `Promise` subclass or instance

A pass-style promise carrier MUST NOT be a `Promise` subclass or a
`Promise` instance.
Specifically:

- `makePromise()` returns a kit `{ promise, resolver }` whose
  `promise` is a fresh object whose prototype chain does not include
  the JS `Promise.prototype`.
- `passStylePromise instanceof Promise === false` is part of the
  contract.
- The implementation MUST NOT use `class PassStylePromise extends
  Promise`, MUST NOT monkey-patch a `Promise` instance, and MUST NOT
  install the carrier's hidden state on a backing `Promise` that the
  carrier delegates to.
  The implementation has to reimplement what it needs from
  `Promise`'s helpers (typically a single fire-once subscriber list);
  it cannot inherit them.

Why this matters:

- A `Promise` subclass inherits `then`, `catch`, and `finally`
  through the prototype chain, which reintroduces the implicit
  `await`-synchronization footgun that the non-thenable contract
  exists to close.
  Even an own-property `then: undefined` does not help, because
  `Promise.resolve(x)` and the host's `await` machinery walk the
  prototype chain in some paths and use internal slots in others.
- Static methods on `Promise` (`Promise.all`, `Promise.race`,
  `Promise.allSettled`, `Promise.any`) auto-coerce their arguments
  through the platform's promise-resolution algorithm.
  If the carrier is a `Promise` (subclass or instance), those
  algorithms recognize it as one and synchronize on it.
  A non-`Promise` carrier is opaque to all of them; it appears in the
  result array as the token, never as its eventual fulfillment.
- The "no carried state on the carrier" convergence from #1312 is
  easier to enforce on a plain frozen object than on a `Promise`
  subclass; subclassing forces the implementer to reason about which
  inherited slots are observable from the outside.

### Native `Promise` instances remain passable

The new pass-style promise kind is **additive**.
Existing native `Promise` instances continue to be passable through
the marshal codecs and CapTP exactly as they are today; their
semantics do not change.

- `passStyleOf(nativePromise)` continues to return `'promise'` (or
  whatever tag is settled in Open Question 4 below).
- The codecs continue to special-case native promises through the
  user's `convertValToSlot` pathway; no native-promise call site
  needs to migrate.
- `await nativePromise` continues to synchronize on the native
  promise, as it always has.

The new pass-style kind is opt-in: callers who want the non-thenable,
no-implicit-`await` semantics call `makePromise()`
explicitly.
Callers who do not opt in see no change.

This rules out any "lockdown removes native Promise from the
passable set" framing.
The non-thenable contract is a new option, not a replacement.

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

### Phase 1: pass-style classification and producer kit (M)

- Add a `PromiseHelper` to `packages/pass-style/src/` modeled on
  `RemotableHelper`, recognizing the `[PASS_STYLE]: 'promise'` shape.
- Wire the helper into `passStyleOf`'s `HelperTable` and the
  fallthrough loop in `passStyleOfInternal`.
- Add the `PassStylePromise` type to `types.d.ts` and broaden
  `PassStyleOf` accordingly.
- Export `makePromise` from `@endo/pass-style`. The export returns
  the `{ promise, resolver }` kit described in "Constructor surface"
  above; the resolver is the producer-side handle that drives
  subscriber notification once `@endo/eventual-send` registers the
  carrier with `HandledPromise` in Phase 3.

PR [endojs/endo#1313](https://github.com/endojs/endo/pull/1313) is
the template for the helper and the type changes (with the
simplification that the new shape forbids `then` rather than
admitting both variants).
The producer-side resolver kit is new to this design; PR #1313 did
not include it.
Hosting the kit in pass-style (rather than in eventual-send) keeps
the dependency direction correct: eventual-send already depends on
pass-style.

### Phase 2: marshal codec compatibility (XS)

The codecs are already `passStyleOf`-driven and need no source change.
This phase is a test-coverage phase: round-trip a pass-style promise
through `capdata` and `smallcaps` (the test cases in PR #1313 are the
template).

### Phase 3: eventual-send integration (M)

`@endo/eventual-send` hosts only `subscribe`, `settle`, and the
HandledPromise registration of pass-style carriers; it does not host
the producer-side construction (that lives in `@endo/pass-style` per
Phase 1).

- Add `HandledPromise.subscribe(x, onFulfilled, onRejected?)` as the
  fire-once, callback-based primitive that observes a pass-style
  promise's resolution. The producer-side resolver from `@endo/pass-style`'s
  `makePromise()` kit drives subscriber notification.
- Add `HandledPromise.settle(x)` layered on `subscribe`, walking
  chains of pass-style promises / native Promises / HandledPromises
  to a non-promise ground value.
- Register pass-style carriers with `HandledPromise` so that
  `HandledPromise.resolve(carrier)` routes through `settle(carrier)`
  and the contestant-race in `handle()` skips the synchronous-target
  optimization for pass-style carriers (see "E integration" above).
- Re-implement `E.when` in terms of `HandledPromise.settle`.
- Confirm `E(x).method(...)` dispatches correctly for a pass-style
  promise target.

`subscribe` and `settle` ship together.
`subscribe` cannot land before `settle` because `E.when` (and any
existing `await`-driven consumer migrating to the new shape) needs
the promise-returning form.
`settle` cannot land before `subscribe` because `subscribe` is the
primitive `settle` uses to walk pass-style-promise chains without
introducing an extra `then`-pinhole on each hop.

### Phase 3.5: SES permits (XS)

`HandledPromise.subscribe` and `HandledPromise.settle` are new
properties on the existing `HandledPromise` intrinsic.
SES's permits enumerate the properties allowed on each well-known
intrinsic; an unenumerated property is removed during lockdown.
The new methods MUST therefore be added to the `HandledPromise`
permit entry in `packages/ses/src/permits.js` (the existing entry
that already lists `apply`, `applyFunction`, `applyMethod`, `get`,
`resolve`, etc.), NOT introduced as new top-level intrinsics.

This is a small but load-bearing change: omitting it leaves the new
methods present pre-lockdown and absent post-lockdown, which produces
a confusing failure mode where a test that imports `@endo/init` sees
`HandledPromise.subscribe` go from `function` to `undefined`.

The permits live alongside other HandledPromise properties; the
diff is a two-line addition to an existing permit object, not a new
permits section.

### Phase 4: CapTP integration (M)

- `convertValToSlot` allocates a `'p'`-prefixed slot id for a
  pass-style promise, the same as for a native promise.
- `convertSlotToVal` calls `makePromise()` for an inbound
  `'p'`-prefixed slot when the local side has no native promise to
  bind, returning the kit's `promise` to the caller and retaining
  the kit's `resolver` in the slot table keyed by slot id.
  This path is gated on the feature flag below.
- Settle-resolution from the remote side invokes the retained
  resolver; downstream `HandledPromise.settle` callers observe
  the resolution through the standard subscriber path.

#### Feature flag: env-option

The inbound substitution of pass-style carriers for native promises
on a `'p'`-prefixed slot is gated by an env-option, so that downstream
consumers can opt in incrementally and so that a regression in the
new path can be diagnosed by toggling the flag off.

The flag uses the existing `@endo/env-options` pattern (the same
mechanism `TRACK_TURNS`, `DEBUG`, and the marshal message-breakpoints
options use):

```js
import { getEnvironmentOption } from '@endo/env-options';

const PROMISE_DELEGATES_INBOUND =
  /** @type {'disabled' | 'enabled'} */
  (getEnvironmentOption(
    'ENDO_PROMISE_DELEGATES',
    'disabled',
    ['enabled'],
  )) === 'enabled';
```

The flag's spelling reflects the future-standard direction: `Promise.delegate`
is the proposed TC39 name for the same concept, and the design
anticipates exposing the functionality as `Promise[Symbol.for('delegate')]`
in a follow-up (see [issue
#172](https://github.com/endojs/endo-but-for-bots/issues/172)).
Naming the flag after `delegate` rather than after the local
implementation term (`carrier`, `pass-style-promise`) lines up the
opt-in name with the concept it gates.

A subsequent default-flip (changing the default from `'disabled'` to
`'enabled'`) and a deprecation cycle for the legacy native-promise
inbound path is its own follow-up phase, not part of this design's
scope.

### Phase 5: documentation and migration (S)

- A `NEWS.md` entry under `@endo/pass-style` and `@endo/eventual-send`.
- A short migration note for liveSlots-style consumers: the
  `WeakMap<Promise, kref>` pattern can collapse into a direct
  `makePromise()`/slot mapping.
- Cross-link from `@endo/marshal`'s README to the new
  `Promise.settle` operation.

### Phase 6: agoric-sdk uptake (XL, downstream)

This is out of scope for the Endo PR but is the user-visible payoff:
agoric-sdk's liveSlots stops manufacturing native promises as opaque
tokens and adopts `makePromise` as its kref carrier.
Tracked separately in the agoric-sdk repo once Phases 1 to 5 land
upstream.

## Out of Scope, Future Work

The following directions are deliberately not in scope for this design,
but are recorded so the next iteration has a starting point.

### HandledPromise shimming and `Promise[Symbol.for('delegate')]`

[Issue endojs/endo-but-for-bots#172](https://github.com/endojs/endo-but-for-bots/issues/172)
tracks the follow-up of giving `HandledPromise` (and the new
`subscribe`/`settle` machinery) a race-to-install ponyfill at
`Promise[Symbol.for('delegate')]`, modeled on the
`Object[Symbol.for('harden')]` pattern that `@endo/harden` uses.

The pattern:

- Library races to install at the registered-symbol slot.
  If the library installs first, lockdown will fail loudly if it
  tries to install a conflicting implementation.
  If lockdown installs first, the library leaves it alone and
  provides a ponyfill that calls through to the global.
- The registered-symbol slot is realm-wide, so child compartments
  inherit it.
- The future-standard direction is `Promise.delegate` as a TC39
  proposal; installing at `Promise[Symbol.for('delegate')]` rather
  than `Promise.delegate` directly avoids stepping on the standard's
  eventual shape.

This is not in the present design's scope (which is the pass-style
shape and its eventual-send integration), but it is the natural
follow-up once `HandledPromise.subscribe` and `HandledPromise.settle`
are stable.

### Debug view for long-pending and unsubscribed-rejection promises

Per the rejection-retention principle in the Subscription section,
the right answer to "rejections in transit before any subscriber"
is neither swallow nor eagerly throw.
A future debug-view direction is a ring buffer of recent
long-pending, forever-pending, and unsubscribed-rejection promises,
inspectable while debugging without producing noise in production.
This is its own design and is not blocked by the present one.

## Open Questions

1. **`Promise.settle` and `Promise.subscribe` API surface.**
   Should the explicit synchronization operations live on
   `HandledPromise.settle` / `HandledPromise.subscribe` (paired with
   `HandledPromise.resolve`), on `E.settle` / `E.subscribe`, or on a
   new global similar to the `Promise.settle` proposal in #1652?
   A new global is the cleanest user-facing name;
   `HandledPromise.{settle,subscribe}` is the lowest-friction internal
   name.
   The two should land at the same level of the API surface so that the
   primitive (`subscribe`) is reachable from anywhere the convenience
   (`settle`) is.

   [Resolved 2026-05-10 per kriskowal review on
   [#169](https://github.com/endojs/endo-but-for-bots/pull/169#issuecomment-4414533060):
   `HandledPromise.subscribe` and `HandledPromise.settle` are the
   chosen home, with the SES permits added to the `HandledPromise`
   intrinsic per Phase 3.5.
   The future-standard direction is `Promise[Symbol.for('delegate')]`
   per [#172](https://github.com/endojs/endo-but-for-bots/issues/172),
   not a new global on `Promise` directly.]

2. **`subscribe` as a static vs. an instance method.**
   The design above places `subscribe` as a static on `HandledPromise`
   (`HandledPromise.subscribe(x, cb, errCb)`) so that it works
   uniformly across the four argument shapes (pass-style promise,
   native Promise, HandledPromise, plain Passable). A pass-style
   promise carrier has no own methods (per the "no carried state"
   rule), so an instance form (`passStylePromise.subscribe(cb)`) would
   require either widening the carrier shape (in tension with the
   most-restrictive shape from #1312) or introducing a separate
   subscriber-handle object that the producer hands out alongside
   the carrier. The static form keeps the carrier opaque and
   property-free; the instance form is more discoverable. The
   maintainer's prompt cited both shapes ("`passStylePromise.subscribe(callback)`
   or as a static `Promise.subscribe(passStylePromise, callback)`")
   and asked to capture the choice as an open question.

3. **Subscriber lifecycle: fire-once vs. fire-many.**
   The design above commits to fire-once: settlement is final on the
   carrier, subscribers fire exactly once, and a producer that tries
   to settle twice is in violation. This matches the native-Promise
   model and the @erights / @mhofman / @FUDCo convergence on "no
   carried state on the carrier" (a settled-then-resettled carrier
   would carry mutable state visible to subscribers).
   An alternative would be a multi-fire "channel" semantics where the
   producer pumps multiple values through the same carrier; that is
   a different abstraction (a stream or a publisher) and should not
   borrow the `'promise'` pass style.

4. **`passStyleOf` tag: shared `'promise'` or a distinct kind?**
   The "Native promises remain passable" constraint above commits to
   keeping native `Promise` instances passable.
   The open question is whether the new pass-style carrier shares the
   `'promise'` pass-style tag with native promises or gets a distinct
   tag (e.g. `'pseudoPromise'`, the spelling kriskowal used in the
   GitHub label on this PR).

   The shared-tag option:
   `passStyleOf(nativePromise) === 'promise'` and
   `passStyleOf(passStylePromise) === 'promise'`.
   Existing `case 'promise'` consumers see both shapes through one
   arm; they discriminate further (if they need to) with an
   `isPromise(x)` check.
   This is the migration-friendly option: no new arm to add anywhere.

   The distinct-tag option:
   `passStyleOf(nativePromise) === 'promise'` (unchanged) and
   `passStyleOf(passStylePromise) === 'pseudoPromise'` (or some other
   new tag).
   Consumers that want the non-thenable contract can switch on tag
   alone; consumers that want "any promise-shaped carrier" check
   `tag === 'promise' || tag === 'pseudoPromise'`.
   This is the migration-rigorous option: every existing `case
   'promise'` is forced to decide explicitly whether it handles the
   new shape, the codec slot-id ('p' vs. a new prefix) is forced to
   decide too, and the marshal smallcaps `&N` shape gets a sibling.

   The CapTP slot prefix (`'p'`) interacts with this choice: a
   distinct tag at the pass-style layer wants a distinct slot prefix
   at the wire layer; a shared tag keeps the wire layer unchanged.

5. **`Symbol.toStringTag` exact value.**
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
   This question is downstream of the previous one: a distinct
   `passStyleOf` tag almost certainly wants a distinct
   `Symbol.toStringTag`; a shared `passStyleOf` tag may still pick
   either depending on console-output preferences.

6. **`for await` and `Promise.all` interop.**
   `for await (const x of asyncIter)` calls `await` internally; passing
   a pass-style promise through that path turns it into a value
   immediately (no settlement, just the token).
   Same for `Promise.all([passStylePromise])`: the array element is
   the token, not its eventual fulfillment.
   The design is that this is the correct behavior (the user must call
   `HandledPromise.settle` explicitly), but it deserves an explicit
   call-out in the docs and a test case.

7. **Opt-in vs. universal.**
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

   [Resolved 2026-05-10 per kriskowal review on
   [#169](https://github.com/endojs/endo-but-for-bots/pull/169#issuecomment-4414533060):
   the inbound CapTP substitution is gated by an env-option
   (`ENDO_PROMISE_DELEGATES`, per Phase 4) so consumers opt in
   incrementally.
   The grep-and-audit step still applies for the eventual default
   flip, but the universal-day-one option is off the table.]

8. **Why did PR #1313 stall in 2022?**
   The @erights review at the time withheld approval on two grounds:
   (a) the requested `checkTagRecord`-based validation, and (b) the
   discomfort of introducing a `passStyleOf === 'promise'` value that
   `E` and `E.when` did not yet work with.
   This design addresses (b) directly by sequencing Phase 3 alongside
   Phase 1 (the eventual-send integration is part of the same delivery,
   not a deferred follow-up).
   Phase 1's helper picks up (a) by reusing the modern `confirmCanBeValid`
   /`assertRestValid` shape.

9. **Settlement state for liveSlots adoption.**
   The 2022 thread surfaced @erights's "forwarded" / "unresolved"
   states as a possible bridge to virtual/durable promises.
   This design intentionally does NOT carry settlement state on the
   pass-style promise itself.
   The producer (liveSlots, captp's slot table, an agoric-sdk vat)
   keeps the state in its own closure.
   A later design can layer durable settlement state on top once the
   non-stateful base is in place.

10. **Producer-side first-subscribe notification: option A vs.
    option B.**
    Option A is a callback in the `makePromise()` options bag
    (`onFirstSubscribe`), invoked on the next turn after the first
    subscriber attaches; the producer holds the hook through the
    same closure that holds the resolver.
    Option B is a separate static op
    (`HandledPromise.onFirstSubscribe(p, cb)`) that any holder of
    the carrier could call, with an early error on any
    non-PassStylePromise input.

    [Resolved 2026-05-10 per @kumavis on
    [#170](https://github.com/endojs/endo/pull/170#discussion_r4416253020)
    and the v1 greenlight on
    [#170](https://github.com/endojs/endo/pull/170#discussion_r4416544308):
    Option A ships in v1; the producer-side scope matches who
    actually owns the resolver and avoids exposing a
    subscription-arrival signal to arbitrary holders of the
    carrier.
    Option B is deferred; if a future need surfaces (e.g. a
    consumer-side debugger that wants to instrument arrival), it
    can be layered on top without changing the v1 contract.]

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
   `passStyleOf(makePromise().promise) === 'promise'`.
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
7. **`HandledPromise.subscribe` fire-once.**
   `HandledPromise.subscribe(token, cb)` invokes `cb` exactly once
   when the producer resolves, with the resolution target as the only
   argument. A second producer resolution is rejected (or asserted
   against) by the implementation; subscribers added after settlement
   fire on the next turn with the recorded target.
8. **`HandledPromise.subscribe` resolution-target shapes.**
   The four target cases (final Passable, native Promise,
   HandledPromise, another pass-style promise) are each delivered
   verbatim to the subscriber and are distinguishable by
   `passStyleOf(target)` plus an `isPromise(target)` check. A test
   resolves four separate carriers, one per shape, and asserts the
   subscriber receives the expected target each time.
9. **`HandledPromise.settle` walks chains.**
   A pass-style promise resolved to another pass-style promise (which
   in turn is resolved to a native Promise that fulfills with a
   Passable) settles to the ground Passable through a single
   `await HandledPromise.settle(token)` call.
10. **`E.when` on a pass-style promise.**
    The callback fires on the producer's resolution. Verifies that
    `E.when`'s reimplementation in terms of `HandledPromise.settle`
    preserves the prior contract.
11. **`E(token).method(...)` dispatch.**
    The pending-handler path forwards the call.
12. **`await passStylePromise` does NOT settle.**
    The carrier is not thenable, so `await passStylePromise` resolves
    to the carrier itself, not to its eventual target. This is the
    regression guard for the non-thenable contract; observing the
    target requires an explicit `subscribe` or `settle` call.
13. **CapTP round-trip.**
    Send a pass-style promise across a CapTP loopback; the remote side
    receives a fresh pass-style promise that settles when the local
    producer settles.
14. **Existing-consumer regression.**
    Run the existing `pass-style` and `marshal` test suites unchanged;
    no test that passes a native `Promise` should regress.
15. **`E(carrier).method(...)` integration via `HandledPromise.resolve`.**
    A test that calls `HandledPromise.resolve(carrier)` then dispatches
    a method through `E(...)` confirms the resolve-through-settle
    routing reaches the actual target's method (not the carrier's
    nonexistent method). Without the routing fix, this test fails with
    a "no such method" or equivalent against the carrier.
16. **Contestant-race skip for pass-style carriers.**
    A test that exercises `handle()`'s contestant race with a
    pass-style carrier as the target confirms the synchronous
    fallback is skipped and the dispatch lands on the eventual
    target. The regression guard is that without the guard, the
    second contestant wins immediately and the dispatch lands on the
    carrier itself.
17. **Rejection retention without subscriber.**
    A producer that calls `resolver.reject(reason)` before any
    subscriber registers MUST NOT cause a host-level
    unhandled-rejection event. The first subscriber that arrives
    receives the recorded rejection on the next turn. A second-stage
    test confirms a chain (`a.resolver.resolve(b.promise);
    b.resolver.reject(err)`) delivers `err` through `a`'s subscriber
    without intermediate noise.
18. **Env-flag gating of the inbound CapTP path.**
    With `ENDO_PROMISE_DELEGATES` unset (the default), inbound
    `'p'`-prefixed slots produce native promises (the legacy path).
    With `ENDO_PROMISE_DELEGATES=enabled`, inbound `'p'`-prefixed
    slots produce pass-style carriers. The flag's parse honors the
    `@endo/env-options` convention (`'enabled'` is the only
    non-default value).
19. **SES permits.**
    After `@endo/init` (i.e. post-lockdown), `HandledPromise.subscribe`
    and `HandledPromise.settle` are still callable. Without the
    permits entry, both go to `undefined` and the test fails
    closed.

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
