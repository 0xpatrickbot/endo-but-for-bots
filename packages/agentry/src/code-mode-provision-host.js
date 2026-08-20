// @ts-check
/// <reference types="ses"/>

/** @import { EndoGuest, EndoHost } from '@endo/daemon' */
/** @import { EndoProvisionForkOptions, EndoProvisionPersistence } from './code-mode-provisioning-types.js' */

import { EndoCredentialUnavailableError } from '@endo/daemon/provision.js';
import { makeError, X } from '@endo/errors';
import { E } from '@endo/eventual-send';

import {
  equalEndoProvisionPersistence,
  projectDaemonProvisionPersistence,
  projectEndoProvisionContext,
  validateEndoProvisionPersistence,
} from './code-mode-provision-policy.js';
import { registerProvisionedGuest } from './code-mode-grants.js';

export { EndoCredentialUnavailableError };

/**
 * Stable message fragment identifying a credential-unavailable failure. The
 * daemon's own client re-brands rejections on its socket path; this copy
 * covers the direct `E(host).provision(...)` path when `host` is a CapTP
 * presence, where class identity does not survive marshalling. It must stay
 * in sync with `CREDENTIAL_UNAVAILABLE_SENTINEL` in
 * `@endo/daemon/src/provision.js`, which the daemon does not export from its
 * public thunk.
 */
const CREDENTIAL_UNAVAILABLE_SENTINEL =
  'reprovision the credential on the host and retry';

/**
 * Restore `EndoCredentialUnavailableError` class identity for rejections
 * that crossed CapTP. In-process hosts reject with the original error, which
 * passes through untouched.
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
  // `EndoCredentialUnavailableError` as `new.target`, so the prototype chain
  // (and thus `instanceof`) is right without re-running the subclass
  // constructor, whose inputs did not survive marshalling.
  const rebranded = /** @type {EndoCredentialUnavailableError} */ (
    Reflect.construct(Error, [message], EndoCredentialUnavailableError)
  );
  rebranded.name = 'EndoCredentialUnavailableError';
  rebranded.code = 'ENDO_CREDENTIAL_UNAVAILABLE';
  return rebranded;
};

/**
 * Adapt code-mode persistence into the daemon-owned provisioning lifecycle.
 * Prompt context is checked here and never enters the daemon policy record;
 * realization itself is the host's own `provision` exo method.
 *
 * @param {EndoHost} host
 * @param {EndoProvisionPersistence} persistence
 * @param {EndoProvisionForkOptions} [options]
 * @returns {Promise<EndoGuest>}
 */
export const realizeEndoProvisionOnHost = async (
  host,
  persistence,
  options = {},
) => {
  const normalized = await validateEndoProvisionPersistence(persistence);
  const forkFrom =
    options.forkFrom === undefined
      ? undefined
      : await validateEndoProvisionPersistence(options.forkFrom);
  if (
    forkFrom !== undefined &&
    !equalEndoProvisionPersistence(
      projectEndoProvisionContext(forkFrom),
      projectEndoProvisionContext(normalized),
    )
  ) {
    throw makeError(X`Fork provision policies have different session context`);
  }
  const daemonPersistence = projectDaemonProvisionPersistence(normalized);
  const guest = await (forkFrom === undefined
    ? E(host).provision(daemonPersistence)
    : E(host).provision(daemonPersistence, {
        forkFrom: projectDaemonProvisionPersistence(forkFrom),
      })
  ).catch(error => {
    throw rebrandCredentialUnavailable(error);
  });
  registerProvisionedGuest(guest);
  return guest;
};
harden(realizeEndoProvisionOnHost);
