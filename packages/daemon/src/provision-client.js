// @ts-check
/// <reference types="ses"/>

/**
 * Client half of daemon guest provisioning.
 * This is the only provisioning module with `node:` imports.
 * It canonicalizes caller paths, derives the deterministic session key,
 * connects to the daemon socket, and hands the normalized persistence record
 * to the host's `provision` method in one call.
 */

/** @import { EndoConnectionFailureObserver, EndoProvisionForkOptions, EndoProvisionPersistence, EndoProvisionResult, EndoProvisionSpec, NormalizeEndoProvisionOptions, ProvisionEndoGuestOptions, ProvisionPathPowers, ReconstructEndoGuestOptions } from './provision-types.js' */
/** @import { EndoGuest, EndoHost } from './types.js' */

import { makeCancelKit } from '@endo/cancel';
import { makeError, q, X } from '@endo/errors';
import { E } from '@endo/eventual-send';
import { whereEndoSock } from '@endo/where';

import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { env, platform } from 'node:process';

import { makeEndoClient } from './client.js';
import {
  CREDENTIAL_UNAVAILABLE_SENTINEL,
  EndoCredentialUnavailableError,
  assertProvisionScope,
  makeProvisionPolicy,
} from './provision.js';

export { EndoCredentialUnavailableError };

/** @type {ProvisionPathPowers} */
const nodePathPowers = harden({
  realPath: path => realpath(path),
  isDirectory: async path => {
    await null;
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  resolvePath: (...segments) => resolve(...segments),
  relativePath: (from, to) => relative(from, to),
  isAbsolutePath: path => isAbsolute(path),
  pathSeparator: sep,
});

const {
  normalizePolicy,
  validateEndoProvisionPersistence: validatePersistence,
} = makeProvisionPolicy(nodePathPowers);

/**
 * Validate and re-normalize caller-held persistence before reconstruction.
 *
 * @param {unknown} value
 * @returns {Promise<EndoProvisionPersistence>}
 */
export const validateEndoProvisionPersistence = value =>
  validatePersistence(value);
harden(validateEndoProvisionPersistence);

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw makeError(X`${q(label)} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw makeError(X`${q(label)} must not contain NUL bytes`);
  }
  return value;
};

/**
 * Normalize plain provisioning intent into the versioned persistence record.
 * Canonical host roots are retained only in this trusted record; guest-facing
 * globals are generated from the capability graph without exposing them.
 *
 * @param {EndoProvisionSpec | undefined} spec
 * @param {NormalizeEndoProvisionOptions} options
 * @returns {Promise<EndoProvisionPersistence>}
 */
export const normalizeEndoProvisionSpec = async (spec, options) => {
  const scope = requireString(options?.scope, 'scope');
  assertProvisionScope(scope);
  const sessionId = requireString(options?.sessionId, 'sessionId');
  if (sessionId.length > 1024) {
    throw makeError(X`sessionId must be at most 1024 characters`);
  }
  const cwd = requireString(options?.cwd, 'cwd');
  const sessionKey = `session-${createHash('sha256').update(sessionId).digest('hex')}`;
  const { workspacePath, policy } = await normalizePolicy(spec, cwd);
  return harden({
    version: /** @type {1} */ (1),
    guestHandlePath: harden(['provision', scope, sessionKey, 'guest-handle']),
    workspacePath,
    policy,
  });
};
harden(normalizeEndoProvisionSpec);

/**
 * @param {string | undefined} sockPath
 * @returns {string}
 */
const selectSockPath = sockPath => {
  if (sockPath !== undefined) {
    return requireString(sockPath, 'sockPath');
  }
  const user = userInfo().username;
  return whereEndoSock(platform, env, {
    home: homedir(),
    user,
    temp: tmpdir(),
  });
};

/**
 * Build the scoped CapTP presentation policy used by provisioning clients.
 * Promise-delivered application failures remain owned by their awaiting
 * caller; only connection failures cross this host-owned observer boundary.
 *
 * Exported for focused policy tests, but intentionally omitted from the
 * package's public provisioning thunk.
 *
 * @param {EndoConnectionFailureObserver} onConnectionFailure
 */
export const makeProvisionCapTpOptions = onConnectionFailure =>
  harden({
    /**
     * @param {unknown} error
     * @param {{ kind: 'promise' | 'disconnect' | 'protocol' }} context
     */
    onReject: (error, context) => {
      if (context.kind === 'promise') {
        return;
      }
      onConnectionFailure(error, harden({ kind: context.kind }));
    },
  });
harden(makeProvisionCapTpOptions);

/**
 * Restore `EndoCredentialUnavailableError` class identity for rejections that
 * crossed CapTP.
 * Marshalling preserves the message but not the class, so callers'
 * `instanceof` checks would otherwise break.
 * The stable message sentinel identifies the failure.
 * The rebranded error keeps the original message and stack and regains the
 * `code` property.
 *
 * @param {unknown} error
 * @returns {unknown}
 */
const rebrandCredentialUnavailable = error => {
  if (error instanceof EndoCredentialUnavailableError) {
    return error;
  }
  const message =
    typeof error === 'object' && error !== null
      ? /** @type {{ message?: unknown }} */ (error).message
      : undefined;
  if (
    typeof message !== 'string' ||
    !message.includes(CREDENTIAL_UNAVAILABLE_SENTINEL)
  ) {
    return error;
  }
  // Construct an Error carrying the original message with
  // `EndoCredentialUnavailableError` as `new.target`, so the prototype
  // chain (and thus `instanceof`) is right without re-running the
  // subclass constructor, whose inputs did not survive marshalling.
  const rebranded = /** @type {EndoCredentialUnavailableError} */ (
    Reflect.construct(Error, [message], EndoCredentialUnavailableError)
  );
  rebranded.name = 'EndoCredentialUnavailableError';
  rebranded.code = 'ENDO_CREDENTIAL_UNAVAILABLE';
  return rebranded;
};

/**
 * @param {EndoProvisionPersistence} persistence
 * @param {string | undefined} sockPath
 * @param {EndoConnectionFailureObserver | undefined} onConnectionFailure
 * @param {EndoProvisionForkOptions} [forkOptions]
 * @returns {Promise<EndoProvisionResult>}
 */
const connectAndProvision = async (
  persistence,
  sockPath,
  onConnectionFailure,
  forkOptions,
) => {
  await null;
  const { cancelled, cancel } = makeCancelKit();
  /** @type {Promise<void> | undefined} */
  let closed;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    cancel(makeError(X`Provisioning session closed`));
    await closed?.catch(() => {});
  };

  try {
    const scope = persistence.guestHandlePath[1];
    const sessionKey = persistence.guestHandlePath[2];
    const capTpOptions =
      onConnectionFailure === undefined
        ? undefined
        : makeProvisionCapTpOptions(onConnectionFailure);
    const client = await makeEndoClient(
      `provision-${scope}-${sessionKey.slice('session-'.length, 'session-'.length + 12)}`,
      selectSockPath(sockPath),
      cancelled,
      undefined,
      capTpOptions,
    );
    closed = client.closed;
    closed.catch(() => {});
    const bootstrap = await client.getBootstrap();
    const host = /** @type {EndoHost} */ (await E(bootstrap).host());
    const guest = /** @type {EndoGuest} */ (
      await (
        forkOptions === undefined
          ? E(host).provision(persistence)
          : E(host).provision(persistence, forkOptions)
      ).catch(error => {
        throw rebrandCredentialUnavailable(error);
      })
    );
    return harden({
      guest,
      persistence,
      cleanup,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
};

/**
 * Provision or recover one deterministic retained daemon guest from inert
 * caller policy.
 * Filesystem and Git grants are selected independently.
 * A writable Git grant requires a writable filesystem grant.
 * The native Git backend writes the same working tree at the OS level, so a read-only
 * filesystem view cannot coexist with writable Git.
 *
 * @param {ProvisionEndoGuestOptions} options
 * @returns {Promise<EndoProvisionResult>}
 */
export const provisionEndoGuest = async options => {
  const persistence = await normalizeEndoProvisionSpec(options?.spec, {
    scope: options?.scope,
    sessionId: options?.sessionId,
    cwd: options?.cwd,
  });
  return connectAndProvision(
    persistence,
    options?.sockPath,
    options?.onConnectionFailure,
  );
};
harden(provisionEndoGuest);

/**
 * Reconnect to a retained guest from its normalized, non-secret persistence
 * record.
 * A host-retained copy of the original record is compared before any
 * capability is reused, so descriptor tampering cannot widen authority.
 *
 * @param {ReconstructEndoGuestOptions} options
 * @returns {Promise<EndoProvisionResult>}
 */
export const reconstructEndoGuest = async options => {
  const persistence = await validateEndoProvisionPersistence(
    options?.persistence,
  );
  return connectAndProvision(
    persistence,
    options?.sockPath,
    options?.onConnectionFailure,
    options?.forkFrom === undefined
      ? undefined
      : { forkFrom: options.forkFrom },
  );
};
harden(reconstructEndoGuest);
