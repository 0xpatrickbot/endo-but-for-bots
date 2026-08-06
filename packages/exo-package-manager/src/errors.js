// @ts-check
/// <reference types="ses"/>

import { makeError, q, X } from '@endo/errors';

/**
 * Structured error codes for package-manager preflight and policy failures.
 * Setup and policy errors throw before spawn; process outcomes live in
 * `PackageCommandResult`.
 *
 * Under SES, Error instances from `makeError` are hardened, so codes are kept
 * in a host-private WeakMap rather than own-properties on the Error.
 *
 * @typedef {'manager-undetected'
 *   | 'manager-ambiguous'
 *   | 'manager-mismatch'
 *   | 'lockfile-missing'
 *   | 'manager-unavailable'
 *   | 'workspace-invalid'
 *   | 'script-not-declared'
 *   | 'policy-denied'
 *   | 'sandbox-unavailable'
 *   | 'read-only'} PackageManagerErrorCode
 */

/**
 * @type {WeakMap<object, { code: PackageManagerErrorCode, details?: Record<string, unknown> }>}
 */
const packageManagerErrorData = new WeakMap();

/**
 * @param {PackageManagerErrorCode} code
 * @param {string} detail
 * @param {Record<string, unknown>} [extra]
 * @returns {Error}
 */
export const makePackageManagerError = (code, detail, extra = undefined) => {
  const err = makeError(X`${q(code)}: ${detail}`);
  packageManagerErrorData.set(
    err,
    harden({
      code,
      ...(extra !== undefined ? { details: harden(extra) } : {}),
    }),
  );
  return err;
};
harden(makePackageManagerError);

/**
 * @param {unknown} err
 * @returns {PackageManagerErrorCode | undefined}
 */
export const getPackageManagerErrorCode = err => {
  if (err === null || typeof err !== 'object') {
    return undefined;
  }
  const data = packageManagerErrorData.get(/** @type {object} */ (err));
  return data?.code;
};
harden(getPackageManagerErrorCode);

/**
 * @param {unknown} err
 * @returns {Record<string, unknown> | undefined}
 */
export const getPackageManagerErrorDetails = err => {
  if (err === null || typeof err !== 'object') {
    return undefined;
  }
  const data = packageManagerErrorData.get(/** @type {object} */ (err));
  return data?.details;
};
harden(getPackageManagerErrorDetails);
