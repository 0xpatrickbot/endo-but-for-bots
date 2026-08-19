// @ts-check
/// <reference types="ses"/>

/** @import { EndoProvisionPersistence, EndoProvisionSpec, NormalizeEndoProvisionOptions } from './code-mode-provisioning-types.js' */
/** @import { EndoProvisionPersistence as DaemonProvisionPersistence, EndoProvisionSpec as DaemonProvisionSpec } from '@endo/daemon/grants.js' */

import {
  normalizeEndoProvisionSpec as normalizeDaemonProvisionSpec,
  validateEndoProvisionPersistence as validateDaemonProvisionPersistence,
} from '@endo/daemon/grants.js';
import { isPetName } from '@endo/daemon/pet-name.js';
import { makeError, q, X } from '@endo/errors';

const CODE_MODE_FIELDS = harden(['piTools', 'grants']);
const GRANT_FIELDS = harden(['from', 'description']);
const HARNESS_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/u;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
const requirePlainRecord = (value, label) => {
  if (!isPlainRecord(value)) {
    throw makeError(X`${q(label)} must be a plain object`);
  }
  return value;
};

/**
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} fields
 * @param {string} label
 */
const assertKnownFields = (record, fields, label) => {
  for (const field of Object.keys(record)) {
    if (!fields.includes(field)) {
      throw makeError(X`${q(label)} has unknown field ${q(field)}`);
    }
  }
};

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export const equalEndoProvisionPersistence = (left, right) => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        equalEndoProvisionPersistence(value, right[index]),
      )
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      key =>
        Object.hasOwn(right, key) &&
        equalEndoProvisionPersistence(left[key], right[key]),
    )
  );
};
harden(equalEndoProvisionPersistence);

/**
 * @param {unknown} grantsValue
 * @returns {{ grants?: Record<string, { from: string[], description?: string }>, powers?: Record<string, { from: string[] }> }}
 */
const normalizeCodeModeGrants = grantsValue => {
  if (grantsValue === undefined) {
    return harden({});
  }
  const record = requirePlainRecord(grantsValue, 'EndoProvisionSpec.grants');
  /** @type {Array<[string, { from: string[], description?: string }]>} */
  const grants = [];
  /** @type {Array<[string, { from: string[] }]>} */
  const powers = [];
  for (const name of Object.keys(record).sort()) {
    const grant = requirePlainRecord(record[name], `grants.${name}`);
    assertKnownFields(grant, GRANT_FIELDS, `grants.${name}`);
    const description = grant.description;
    if (
      description !== undefined &&
      (typeof description !== 'string' || description.length === 0)
    ) {
      throw makeError(
        X`${q(`grants.${name}.description`)} must be a non-empty string`,
      );
    }
    if (typeof description === 'string' && /\x60{3,}/u.test(description)) {
      throw makeError(
        X`grants.${q(name)}.description must not contain a run of three or more backticks because it would break the TypeScript prompt fence`,
      );
    }
    const from = grant.from;
    if (!Array.isArray(from)) {
      throw makeError(X`grants.${q(name)}.from must be an array of strings`);
    }
    if (
      from.length === 0 ||
      !from.every(segment => typeof segment === 'string' && isPetName(segment))
    ) {
      throw makeError(
        X`grants.${q(name)}.from must be a non-empty host pet-name path`,
      );
    }
    const normalizedFrom = harden([...from]);
    const normalizedGrant = harden({
      from: normalizedFrom,
      ...(description === undefined ? {} : { description }),
    });
    grants.push([name, normalizedGrant]);
    powers.push([name, harden({ from: normalizedFrom })]);
  }
  return harden({
    grants: harden(Object.fromEntries(grants)),
    powers: harden(Object.fromEntries(powers)),
  });
};

/**
 * @param {EndoProvisionPersistence} persistence
 * @returns {DaemonProvisionPersistence}
 */
export const projectDaemonProvisionPersistence = persistence => {
  const { piTools: _piTools, grants, ...daemonPolicy } = persistence.policy;
  const { powers } = normalizeCodeModeGrants(grants);
  return harden({
    version: /** @type {1} */ (1),
    guestHandlePath: harden([...persistence.guestHandlePath]),
    workspacePath: persistence.workspacePath,
    policy: harden({
      ...daemonPolicy,
      ...(powers === undefined ? {} : { powers }),
    }),
  });
};
harden(projectDaemonProvisionPersistence);

/**
 * @param {DaemonProvisionPersistence} daemonPersistence
 * @param {'preserve' | undefined} piTools
 * @param {Record<string, { from: string[], description?: string }> | undefined} grants
 * @returns {EndoProvisionPersistence}
 */
const makeCodeModePersistence = (daemonPersistence, piTools, grants) => {
  const { powers: _powers, ...daemonPolicy } = daemonPersistence.policy;
  return harden({
    version: /** @type {3} */ (3),
    guestHandlePath: harden([...daemonPersistence.guestHandlePath]),
    workspacePath: daemonPersistence.workspacePath,
    policy: harden({
      ...(piTools === undefined ? {} : { piTools }),
      ...daemonPolicy,
      ...(grants === undefined ? {} : { grants }),
    }),
  });
};

/**
 * @param {EndoProvisionSpec | undefined} spec
 * @param {NormalizeEndoProvisionOptions} options
 * @returns {Promise<EndoProvisionPersistence>}
 */
export const normalizeEndoProvisionSpec = async (spec, options) => {
  if (
    typeof options?.harness !== 'string' ||
    !HARNESS_KEY_RE.test(options.harness)
  ) {
    throw makeError(X`harness must match /^[a-z][a-z0-9-]{0,31}$/`);
  }
  const root = requirePlainRecord(spec ?? {}, 'EndoProvisionSpec');
  const piTools = root.piTools;
  if (piTools !== undefined && piTools !== 'preserve') {
    throw makeError(X`EndoProvisionSpec.piTools must be preserve`);
  }
  const { grants, powers } = normalizeCodeModeGrants(root.grants);
  const daemonSpec = /** @type {DaemonProvisionSpec} */ (
    Object.fromEntries(
      Object.entries(root).filter(([name]) => !CODE_MODE_FIELDS.includes(name)),
    )
  );
  const daemonPersistence = await normalizeDaemonProvisionSpec(
    harden({ ...daemonSpec, ...(powers === undefined ? {} : { powers }) }),
    {
      scope: options?.harness,
      sessionId: options?.sessionId,
      cwd: options?.cwd,
    },
  );
  return makeCodeModePersistence(
    daemonPersistence,
    /** @type {'preserve' | undefined} */ (piTools),
    grants,
  );
};
harden(normalizeEndoProvisionSpec);

/** @param {EndoProvisionPersistence} persistence */
export const projectEndoProvisionRuntimeAuthority = persistence => {
  const { policy } = persistence;
  const gits =
    policy.gits === undefined
      ? undefined
      : harden(
          Object.fromEntries(
            Object.entries(policy.gits).map(([name, grant]) => [
              name,
              harden({ ...grant, path: [] }),
            ]),
          ),
        );
  const grants =
    policy.grants === undefined
      ? undefined
      : harden(
          Object.fromEntries(
            Object.entries(policy.grants).map(([name, grant]) => [
              name,
              harden({ from: harden([...grant.from]) }),
            ]),
          ),
        );
  return harden({
    workspacePath: persistence.workspacePath,
    policy: harden({
      ...policy,
      ...(gits === undefined ? {} : { gits }),
      ...(grants === undefined ? {} : { grants }),
    }),
  });
};
harden(projectEndoProvisionRuntimeAuthority);

/** @param {EndoProvisionPersistence} persistence */
export const projectEndoProvisionContext = persistence => {
  const { policy } = persistence;
  const grants =
    policy.grants === undefined
      ? undefined
      : harden(
          Object.fromEntries(
            Object.entries(policy.grants).map(([name, grant]) => [
              name,
              grant.description === undefined
                ? harden({})
                : harden({ description: grant.description }),
            ]),
          ),
        );
  return harden({
    ...(policy.piTools === undefined ? {} : { piTools: policy.piTools }),
    ...(grants === undefined ? {} : { grants }),
  });
};
harden(projectEndoProvisionContext);

/**
 * @param {unknown} value
 * @returns {Promise<EndoProvisionPersistence>}
 */
export const validateEndoProvisionPersistence = async value => {
  const record = requirePlainRecord(value, 'Endo provision persistence');
  assertKnownFields(
    record,
    harden(['version', 'guestHandlePath', 'workspacePath', 'policy']),
    'Endo provision persistence',
  );
  if (record.version !== 3) {
    throw makeError(
      X`Endo code-mode provision persistence version must be 3; version 2 sessions must be reprovisioned`,
    );
  }
  const policy = requirePlainRecord(
    record.policy,
    'Endo provision persistence.policy',
  );
  const piTools = policy.piTools;
  if (piTools !== undefined && piTools !== 'preserve') {
    throw makeError(X`EndoProvisionSpec.piTools must be preserve`);
  }
  const { grants } = normalizeCodeModeGrants(policy.grants);
  const candidate = /** @type {EndoProvisionPersistence} */ (record);
  const daemonPersistence = await validateDaemonProvisionPersistence(
    projectDaemonProvisionPersistence(candidate),
  );
  const normalized = makeCodeModePersistence(
    daemonPersistence,
    /** @type {'preserve' | undefined} */ (piTools),
    grants,
  );
  if (!equalEndoProvisionPersistence(normalized, record)) {
    throw makeError(X`Endo provision persistence is not in normalized form`);
  }
  return normalized;
};
harden(validateEndoProvisionPersistence);
