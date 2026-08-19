// @ts-check
/// <reference types="ses"/>

/** @import { EndoConnectionFailureObserver, EndoProvisionForkOptions, EndoProvisionPersistence, EndoProvisionResult, ProvisionEndoCodeModeOptions, ReconstructEndoCodeModeOptions } from './code-mode-provisioning-types.js' */

import { reconstructEndoGuest } from '@endo/daemon/grants.js';
import { makeError, X } from '@endo/errors';

import { makeEndoProvisionGrants } from './code-mode-provision-globals.js';
import {
  codeModeGrantGlobals,
  registerProvisionedGuest,
} from './code-mode-grants.js';
import {
  equalEndoProvisionPersistence,
  normalizeEndoProvisionSpec,
  projectDaemonProvisionPersistence,
  projectEndoProvisionContext,
  validateEndoProvisionPersistence,
} from './code-mode-provision-policy.js';

/**
 * Build the scoped CapTP presentation policy used by code-mode hosts.
 * Promise-delivered application failures remain owned by their awaiting
 * caller; only connection failures cross this host-owned observer boundary.
 *
 * Exported for focused policy tests, but intentionally omitted from the
 * package's public provisioning thunk.
 *
 * @param {EndoConnectionFailureObserver} onConnectionFailure
 */
export const makeCodeModeCapTpOptions = onConnectionFailure =>
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
harden(makeCodeModeCapTpOptions);

/**
 * @param {EndoProvisionPersistence} persistence
 * @param {string | undefined} sockPath
 * @param {EndoConnectionFailureObserver | undefined} onConnectionFailure
 * @param {EndoProvisionForkOptions} [forkOptions]
 * @returns {Promise<EndoProvisionResult>}
 */
const connectAndProject = async (
  persistence,
  sockPath,
  onConnectionFailure,
  forkOptions,
) => {
  const daemonSession = await reconstructEndoGuest({
    persistence: projectDaemonProvisionPersistence(persistence),
    ...(sockPath === undefined ? {} : { sockPath }),
    ...(onConnectionFailure === undefined ? {} : { onConnectionFailure }),
    ...(forkOptions?.forkFrom === undefined
      ? {}
      : {
          forkFrom: projectDaemonProvisionPersistence(forkOptions.forkFrom),
        }),
  });
  try {
    const powers = daemonSession.guest;
    registerProvisionedGuest(powers);
    const grants = await makeEndoProvisionGrants(powers, persistence);
    return harden({
      powers,
      grants,
      globals: codeModeGrantGlobals(grants),
      persistence,
      cleanup: daemonSession.cleanup,
    });
  } catch (error) {
    await daemonSession.cleanup();
    throw error;
  }
};

/**
 * Provision or recover one deterministic retained daemon guest, then project
 * its powers into trusted code-mode grants and prompt globals.
 *
 * @param {ProvisionEndoCodeModeOptions} options
 * @returns {Promise<EndoProvisionResult>}
 */
export const provisionEndoCodeMode = async options => {
  const persistence = await normalizeEndoProvisionSpec(options?.spec, {
    harness: options?.harness,
    sessionId: options?.sessionId,
    cwd: options?.cwd,
  });
  return connectAndProject(
    persistence,
    options?.sockPath,
    options?.onConnectionFailure,
  );
};
harden(provisionEndoCodeMode);

/**
 * Reconnect to a retained code-mode guest after validating both the daemon
 * authority record and the separate prompt context.
 *
 * @param {ReconstructEndoCodeModeOptions} options
 * @returns {Promise<EndoProvisionResult>}
 */
export const reconstructEndoCodeMode = async options => {
  const persistence = await validateEndoProvisionPersistence(
    options?.persistence,
  );
  const forkFrom =
    options?.forkFrom === undefined
      ? undefined
      : await validateEndoProvisionPersistence(options.forkFrom);
  if (
    forkFrom !== undefined &&
    !equalEndoProvisionPersistence(
      projectEndoProvisionContext(forkFrom),
      projectEndoProvisionContext(persistence),
    )
  ) {
    throw makeError(X`Fork provision policies have different session context`);
  }
  return connectAndProject(
    persistence,
    options?.sockPath,
    options?.onConnectionFailure,
    forkFrom === undefined ? undefined : { forkFrom },
  );
};
harden(reconstructEndoCodeMode);
