// @ts-check

/**
 * @file `@endo/gateway` package entrypoint.
 *
 * Exposes the `makeGateway({ powers, config })` factory the
 * design's Package Shape section names. The phase-1 skeleton
 * returns a hardened gateway exo whose `start` / `stop` are
 * lifecycle no-ops and whose `getApps` returns an in-memory
 * `AppsNameHub`; the network surface and the feature subsystems
 * land in follow-on PRs.
 *
 * The factory is named `makeGateway` rather than `make` so that
 * downstream consumers (`@endo/daemon`, the Familiar shell, the
 * future `@endo/gateway-daemon` wrapper) can import it under a
 * descriptive name without renaming at the call site.
 */

import { makeExo } from '@endo/exo';
import { M } from '@endo/patterns';
import { makeError, X } from '@endo/errors';

import {
  mergeGatewayConfig,
  parseBindAddress,
  bindAddressFromEnv,
} from './src/config.js';
import { makeAppsNameHub } from './src/vhost.js';
import { makeGatewayBootstrap } from './src/bootstrap.js';
import { makeGatewayAdmin } from './src/admin.js';
import { makeOcapnWebSocketHandler } from './src/ocapn-ws.js';
import { makeGitHttpHandler } from './src/git-http.js';

export {
  DEFAULT_BIND_ADDRESS,
  defaultFeatureToggles,
  defaultGatewayConfig,
  parseBindAddress,
  mergeGatewayConfig,
  bindAddressFromEnv,
} from './src/config.js';

export { normalizeVirtualHostName, makeAppsNameHub } from './src/vhost.js';

export {
  NONCE_DOMAIN_SEPARATION_PREFIX,
  NONCE_BYTE_LENGTH,
  DEFAULT_NONCE_TTL_MS,
  hashNonceForSigning,
  constantTimeEqual,
  makeNonceRegistry,
} from './src/proof-of-possession.js';

export {
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  makeGatewayBootstrap,
} from './src/bootstrap.js';

export { makeGatewayAdmin } from './src/admin.js';

export {
  OCAPN_WEBSOCKET_PATH,
  OCAPN_WEBSOCKET_LEGACY_PATH,
  OCAPN_INTENDED_RESPONDER_PREFIX_LENGTH,
  isOcapnWebSocketPath,
  makeOcapnWebSocketHandler,
} from './src/ocapn-ws.js';

export {
  GIT_HTTP_PATH_PREFIX,
  GIT_SERVICES,
  isGitHttpPath,
  parseAuthorizationHeader,
  parseGitHttpPath,
  parseServiceQuery,
  readerFromBuffer,
  makeGitHttpHandler,
} from './src/git-http.js';

export {
  DEFAULT_RELAY_POLICY,
  RELAY_POLICIES,
  checkRelayPolicy,
  isInboundSessionAllowed,
  makeRelayPolicyEntry,
  addCallerPublicKey,
  removeCallerPublicKey,
  listCallerAllowlist,
  setRelayPolicy,
} from './src/relay-policy.js';

export {
  resolveBootstrapSocketPath,
  BOOTSTRAP_SOCKET_BASENAME,
  BOOTSTRAP_PIPE_WINDOWS,
  SYSTEM_RUNTIME_DIR_LINUX,
  USER_RUNTIME_SUBDIR,
} from './src/uds-paths.js';

/** @import { GatewayConfig, FeatureToggles, BindAddress } from './src/config.js' */
/** @import { AppsNameHub } from './src/vhost.js' */
/** @import { GatewayBootstrap } from './src/bootstrap.js' */
/** @import { GatewayAdmin, ResourceLedger } from './src/admin.js' */
/** @import { OcapnWebSocketHandler } from './src/ocapn-ws.js' */
/** @import { GitHttpHandler, ResolveRepo } from './src/git-http.js' */
/** @import { CryptoPowers, ClockPowers } from './src/proof-of-possession.js' */

const GatewayInterface = M.interface('Gateway', {
  start: M.call().returns(M.promise()),
  stop: M.call().returns(M.promise()),
  getBindAddress: M.call().returns(M.promise()),
  getApps: M.call().returns(M.promise()),
  getConfig: M.call().returns(M.promise()),
  getBootstrap: M.call().returns(M.promise()),
  getAdmin: M.call().returns(M.promise()),
  getOcapnHandler: M.call().returns(M.promise()),
  getGitHttpHandler: M.call().returns(M.promise()),
});
harden(GatewayInterface);

/**
 * @typedef {object} GatewayPowers The host-supplied powers the
 *   gateway needs to listen on the network and read the
 *   environment. The phase-1 skeleton uses only `env`; phase 2
 *   adds `crypto` and `clock` for the bootstrap registrar; later
 *   phases add `net` and `fs`.
 * @property {{[name: string]: string | undefined}} [env]
 * @property {CryptoPowers} [crypto] Required when
 *   `udsBootstrap` is enabled. The bootstrap registrar needs
 *   `randomBytes`, `sha256`, and `verifyEd25519`.
 * @property {ClockPowers} [clock] Required when `udsBootstrap` is
 *   enabled. The nonce registry consumes `now()` for TTL.
 * @property {ResourceLedger} [resourceLedger] Optional Feature 1
 *   resource ledger. When `adminDaemon` is on and a ledger is
 *   supplied, `GatewayAdmin.getResourceBalances` reads through
 *   this. When omitted, the admin facet still works but
 *   `getResourceBalances` returns an empty list. Feature 1's
 *   ledger implementation lands with the Chat-hosting phase;
 *   until then, embedders that want admin reads supply a stub.
 * @property {ResolveRepo} [resolveRepo] Required when `gitHttp` is
 *   enabled. The bearer-token-plus-repo-id resolver the Git
 *   smart-HTTP handler calls per request; see
 *   `src/git-http.js` § ResolveRepo. The embedder wires this in
 *   from the daemon's formula table (so the resolver looks up the
 *   token's formula identifier, checks whether it grants access to
 *   the repo formula identified by the URL `<repo-id>`, and returns
 *   the corresponding repo capability). Until the daemon-side
 *   wiring lands, tests inject a stub resolver and embedders that
 *   want git off entirely set `enableFeatures.gitHttp = false`.
 */

/**
 * @typedef {object} Gateway
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {() => Promise<string>} getBindAddress The address
 *   the gateway is bound to, in `host:port` form. Before
 *   `start()`, the configured value; after `start()`, the
 *   resolved address (which differs from the configured value
 *   when the configured port is `0`).
 * @property {() => Promise<AppsNameHub>} getApps
 * @property {() => Promise<GatewayConfig>} getConfig
 * @property {() => Promise<GatewayBootstrap>} getBootstrap Throws
 *   when `udsBootstrap` is disabled in the gateway's feature
 *   toggles. The returned exo is also the entry capability a UDS
 *   (or named-pipe) listener serves to incoming CapTP connections;
 *   a process embedding the gateway in-realm calls `getBootstrap`
 *   directly.
 * @property {() => Promise<GatewayAdmin>} getAdmin Returns the
 *   `GatewayAdmin` exo (Feature 7). Throws when the `adminDaemon`
 *   feature toggle is off, or when `udsBootstrap` is off (admin
 *   depends on the UDS bootstrap for its access channel, and the
 *   config validator already rejects `adminDaemon=true` with
 *   `udsBootstrap=false`; the in-process accessor mirrors the
 *   surface contract: there is no admin authority without a UDS
 *   bootstrap to gate it). The admin facet is **never** served on
 *   the gateway's public HTTP / WS surface; it is reachable only
 *   in-process (this method) and through the UDS bootstrap's
 *   `getAdmin`.
 * @property {() => Promise<OcapnWebSocketHandler>} getOcapnHandler
 *   Returns the `OcapnWebSocketHandler` exo (Feature 8) that an
 *   embedder feeds upgraded `/ocapn-cbor-np` WebSocket connections
 *   to. The exo's `handleConnection({ reader, writer })` reads the
 *   first frame's intended-responder prefix, looks up the
 *   registration that owns the key (via the bootstrap registrar's
 *   table), and hands the stream pair off to the registered
 *   daemon's `handleOcapnSession`. Throws when the `ocapnWebSocket`
 *   feature toggle is off, or when `udsBootstrap` is off (the
 *   handler depends on the registration table the bootstrap owns;
 *   without it there is no daemon to forward to). The HTTP
 *   listener that performs the WS upgrade is the embedder's, not
 *   the gateway's; see `src/ocapn-ws.js` for the contract.
 * @property {() => Promise<GitHttpHandler>} getGitHttpHandler
 *   Returns the `GitHttpHandler` exo (Feature 3) that an embedder
 *   feeds `/git/<repo-id>/...` HTTP requests to. The exo's
 *   `handleRequest({ method, path, query, headers, body })` parses
 *   the Authorization header, validates the URL path, resolves the
 *   (bearer-token, repo-id) pair via the embedder-supplied
 *   `resolveRepo` adapter, and forwards the smart-HTTP RPC to the
 *   resolved repo capability's `infoRefs` / `gitUploadPack` /
 *   `gitReceivePack` methods. Throws when the `gitHttp` feature
 *   toggle is off; the HTTP listener that routes `/git/` requests
 *   to the handler is the embedder's, not the gateway's; see
 *   `src/git-http.js` for the contract.
 */

/**
 * Create a hardened gateway exo. See `designs/gateway-package.md`
 * § Package Shape for the long-form contract.
 *
 * @param {object} args
 * @param {GatewayPowers} [args.powers]
 * @param {Partial<GatewayConfig>} [args.config]
 * @returns {Gateway}
 */
export const makeGateway = ({ powers = {}, config: configIn = {} } = {}) => {
  const env = powers.env ?? {};
  // Environment beats config for the bind address, per the
  // design's three-layer Configuration Model.
  const mergedConfig = mergeGatewayConfig(
    harden({
      ...configIn,
      bindAddress: bindAddressFromEnv(env, configIn.bindAddress),
    }),
  );

  /** @type {'unstarted' | 'starting' | 'started' | 'stopped'} */
  let lifecycle = 'unstarted';
  /** @type {BindAddress} */
  const resolvedBind = parseBindAddress(mergedConfig.bindAddress);
  const apps = makeAppsNameHub();

  const renderBindAddress = () =>
    `${resolvedBind.kind === 'ipv6' ? `[${resolvedBind.host}]` : resolvedBind.host}:${resolvedBind.port}`;

  // The bootstrap registrar (Feature 4) is wired in iff the
  // udsBootstrap feature toggle is on AND the caller supplied
  // crypto + clock powers. The toggle gates the policy; the powers
  // are the platform-bound primitives. A toggle-on but no-powers
  // configuration is treated as a startup error because it would
  // otherwise silently behave like toggle-off.
  /** @type {ReturnType<typeof makeGatewayBootstrap> | undefined} */
  let bootstrapHandle;
  /** @type {GatewayAdmin | undefined} */
  let adminFacet;
  /** @type {OcapnWebSocketHandler | undefined} */
  let ocapnHandler;
  /** @type {GitHttpHandler | undefined} */
  let gitHttpHandler;
  if (mergedConfig.enableFeatures.udsBootstrap) {
    if (powers.crypto === undefined) {
      throw makeError(
        X`udsBootstrap requires powers.crypto; supply a CryptoPowers adapter or disable the feature toggle`,
      );
    }
    if (powers.clock === undefined) {
      throw makeError(
        X`udsBootstrap requires powers.clock; supply a ClockPowers adapter or disable the feature toggle`,
      );
    }
    // The admin facet (Feature 7) is wired in iff both the
    // udsBootstrap and adminDaemon toggles are on; the config
    // validator already rejects `adminDaemon=true` with
    // `udsBootstrap=false`, so the only path here that creates an
    // admin facet is the both-on path. We pass a forward-reference
    // `getAdmin` thunk to the bootstrap because the bootstrap is
    // the holder for the in-process admin backplane (the second
    // return value); the admin facet itself is constructed below
    // with that backplane in hand.
    bootstrapHandle = makeGatewayBootstrap({
      crypto: powers.crypto,
      clock: powers.clock,
      apps,
      getBindAddress: renderBindAddress,
      getAdmin: mergedConfig.enableFeatures.adminDaemon
        ? () => {
            // adminFacet is assigned immediately below; the thunk
            // is only ever invoked after `makeGateway` returns.
            if (adminFacet === undefined) {
              throw makeError(X`Admin facet was not constructed`);
            }
            return adminFacet;
          }
        : undefined,
    });
    if (mergedConfig.enableFeatures.adminDaemon) {
      adminFacet = makeGatewayAdmin({
        backplane: {
          listRegistrations: bootstrapHandle.listRegistrations,
          deregisterByPublicKey: bootstrapHandle.deregisterByPublicKey,
          setRelayPolicyByPublicKey: bootstrapHandle.setRelayPolicyByPublicKey,
          addRelayCallerByPublicKey: bootstrapHandle.addRelayCallerByPublicKey,
          removeRelayCallerByPublicKey:
            bootstrapHandle.removeRelayCallerByPublicKey,
          pendingNonces: bootstrapHandle.pendingNonces,
        },
        apps,
        resourceLedger: powers.resourceLedger,
      });
    }
    // The OCapN-WS handler (Feature 8) reads from the same
    // registration table the bootstrap owns. The config validator
    // already rejects `ocapnWebSocket=true` with
    // `udsBootstrap=false`, so we only reach this branch with both
    // toggles on. The handler is total over the lookup function;
    // wiring is just plumbing.
    if (mergedConfig.enableFeatures.ocapnWebSocket) {
      ocapnHandler = makeOcapnWebSocketHandler({
        lookupRegistrationByPublicKey:
          bootstrapHandle.lookupRegistrationByPublicKey,
      });
    }
  }

  // The Git smart-HTTP handler (Feature 3) is independent of every
  // other gateway feature (the design's Configuration Model
  // explicitly names it as independent). It only needs the
  // embedder-supplied `resolveRepo` adapter that maps the bearer
  // token plus URL repo-id to a repo capability. When `gitHttp` is
  // on but no adapter is supplied, the gateway throws at
  // construction time (the design's invariant: a toggle-on but
  // no-adapter configuration would silently 401 every request,
  // which is worse than a startup error).
  if (mergedConfig.enableFeatures.gitHttp) {
    if (powers.resolveRepo === undefined) {
      throw makeError(
        X`gitHttp requires powers.resolveRepo; supply a ResolveRepo adapter or disable the feature toggle`,
      );
    }
    gitHttpHandler = makeGitHttpHandler({
      resolveRepo: powers.resolveRepo,
    });
  }

  const exo = makeExo(
    'Gateway',
    GatewayInterface,
    /** @type {any} */ ({
      async start() {
        if (lifecycle === 'started') {
          return;
        }
        if (lifecycle === 'stopped') {
          throw makeError(X`Gateway has been stopped and cannot restart`);
        }
        lifecycle = 'starting';
        // The phase-1 skeleton has no network surface; later
        // phases attach the HTTP listener, the WebSocket server,
        // the UDS bootstrap listener, and the OCapN relay here.
        // Phase 2 lands the semantic core of the bootstrap (the
        // GatewayBootstrap exo, the nonce registry, the
        // registration table); the actual UDS listener is a
        // follow-on PR.
        lifecycle = 'started';
      },
      async stop() {
        if (lifecycle === 'unstarted' || lifecycle === 'stopped') {
          lifecycle = 'stopped';
          return;
        }
        // Later phases close listeners and pending connections
        // here.
        lifecycle = 'stopped';
      },
      async getBindAddress() {
        return renderBindAddress();
      },
      async getApps() {
        return apps;
      },
      async getConfig() {
        return mergedConfig;
      },
      async getBootstrap() {
        if (bootstrapHandle === undefined) {
          throw makeError(
            X`Gateway bootstrap is disabled (set enableFeatures.udsBootstrap=true)`,
          );
        }
        return bootstrapHandle.bootstrap;
      },
      async getAdmin() {
        // Per Feature 7: admin authority is reachable in-process
        // and over the UDS bootstrap, never over the network. The
        // two `disabled` errors below preserve that contract by
        // refusing to hand out the facet when either toggle is
        // off; a refactor that quietly relaxed this would put
        // admin authority on the public surface.
        if (!mergedConfig.enableFeatures.adminDaemon) {
          throw makeError(
            X`Gateway admin is disabled (set enableFeatures.adminDaemon=true)`,
          );
        }
        if (!mergedConfig.enableFeatures.udsBootstrap) {
          // The config validator rejects this combination, so
          // reaching this branch implies a refactor that loosened
          // the validator. We keep the local check as
          // defense-in-depth.
          throw makeError(
            X`Gateway admin requires udsBootstrap; set enableFeatures.udsBootstrap=true`,
          );
        }
        if (adminFacet === undefined) {
          // Unreachable in normal use; both toggles are on yet
          // construction did not produce a facet. We surface the
          // wiring bug loudly rather than returning undefined.
          throw makeError(X`Gateway admin facet is not wired`);
        }
        return adminFacet;
      },
      async getOcapnHandler() {
        // Symmetric with getAdmin: the handler is reachable only
        // when both toggles are on. Either off is a clear error
        // (rather than a silent no-op) so an embedder wiring up an
        // HTTP server discovers the configuration gap immediately.
        if (!mergedConfig.enableFeatures.ocapnWebSocket) {
          throw makeError(
            X`OCapN WebSocket handler is disabled (set enableFeatures.ocapnWebSocket=true)`,
          );
        }
        if (!mergedConfig.enableFeatures.udsBootstrap) {
          // The config validator rejects this combination; the
          // local check is defense-in-depth.
          throw makeError(
            X`OCapN WebSocket handler requires udsBootstrap; set enableFeatures.udsBootstrap=true`,
          );
        }
        if (ocapnHandler === undefined) {
          throw makeError(X`OCapN WebSocket handler is not wired`);
        }
        return ocapnHandler;
      },
      async getGitHttpHandler() {
        // Symmetric with getOcapnHandler. The git surface is the
        // only Feature 3 surface; the embedder routes `/git/...`
        // requests here. We do not gate on udsBootstrap because the
        // git handler does not read from the registration table;
        // it consults the embedder's `resolveRepo` adapter directly.
        if (!mergedConfig.enableFeatures.gitHttp) {
          throw makeError(
            X`Git smart-HTTP handler is disabled (set enableFeatures.gitHttp=true)`,
          );
        }
        if (gitHttpHandler === undefined) {
          throw makeError(X`Git smart-HTTP handler is not wired`);
        }
        return gitHttpHandler;
      },
    }),
  );

  // Hint to the type checker; the makeExo return is `Far`-shaped
  // and matches our local Gateway type.
  return /** @type {Gateway} */ (/** @type {unknown} */ (exo));
};
harden(makeGateway);
