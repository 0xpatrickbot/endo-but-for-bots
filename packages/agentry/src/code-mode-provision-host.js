// @ts-check
/// <reference types="ses"/>

/** @import { EndoGuest, EndoHost } from '@endo/daemon' */
/** @import { EndoProvisionForkOptions, EndoProvisionPersistence } from './code-mode-provisioning-types.js' */

import {
  EndoCredentialUnavailableError,
  realizeEndoProvisionOnHost as realizeDaemonProvisionOnHost,
} from '@endo/daemon/grants.js';
import { makeError, X } from '@endo/errors';

import {
  equalEndoProvisionPersistence,
  projectDaemonProvisionPersistence,
  projectEndoProvisionContext,
  validateEndoProvisionPersistence,
} from './code-mode-provision-policy.js';
import { registerProvisionedGuest } from './code-mode-grants.js';

export { EndoCredentialUnavailableError };

/**
 * Adapt code-mode persistence into the daemon-owned provisioning lifecycle.
 * Prompt context is checked here and never enters the daemon policy record.
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
  const guest = await realizeDaemonProvisionOnHost(
    host,
    projectDaemonProvisionPersistence(normalized),
    forkFrom === undefined
      ? undefined
      : { forkFrom: projectDaemonProvisionPersistence(forkFrom) },
  );
  registerProvisionedGuest(guest);
  return guest;
};
harden(realizeEndoProvisionOnHost);
