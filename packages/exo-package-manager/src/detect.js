// @ts-check
/// <reference types="ses"/>

import { makePackageManagerError } from './errors.js';

/**
 * @typedef {'npm' | 'pnpm' | 'yarn'} PackageManagerName
 * @typedef {'auto' | PackageManagerName} PackageManagerChoice
 */

/** @type {readonly PackageManagerName[]} */
export const MANAGER_NAMES = harden(/** @type {const} */ (['npm', 'pnpm', 'yarn']));

/**
 * Lockfile / marker files that indicate a manager at an effective project root.
 * Presence of any marker for a manager counts as evidence for that manager.
 *
 * @type {Readonly<Record<PackageManagerName, readonly string[]>>}
 */
export const LOCKFILE_MARKERS = harden({
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  yarn: ['yarn.lock', '.yarnrc.yml', '.pnp.cjs'],
});

/**
 * Lockfiles required for frozen installs (workspace-only markers do not count).
 *
 * @type {Readonly<Record<PackageManagerName, readonly string[]>>}
 */
export const FROZEN_LOCKFILES = harden({
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
});

/**
 * Parse `package.json#packageManager` (Corepack form `name@version`).
 *
 * @param {unknown} field
 * @returns {{ manager: PackageManagerName, version?: string } | undefined}
 */
export const parsePackageManagerField = field => {
  if (typeof field !== 'string' || field.length === 0) {
    return undefined;
  }
  const at = field.indexOf('@');
  const name = at === -1 ? field : field.slice(0, at);
  const version = at === -1 || at === field.length - 1 ? undefined : field.slice(at + 1);
  if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    return version === undefined
      ? harden({ manager: name })
      : harden({ manager: name, version });
  }
  return undefined;
};
harden(parsePackageManagerField);

/**
 * Collect managers evidenced by marker presence at one effective root.
 *
 * @param {Readonly<Record<string, boolean>> | ReadonlySet<string> | readonly string[]} markersPresent
 * @returns {PackageManagerName[]}
 */
export const managersFromMarkers = markersPresent => {
  /** @type {Set<string>} */
  const present =
    markersPresent instanceof Set
      ? markersPresent
      : Array.isArray(markersPresent)
        ? new Set(markersPresent)
        : new Set(
            Object.entries(markersPresent)
              .filter(([, v]) => v)
              .map(([k]) => k),
          );

  /** @type {PackageManagerName[]} */
  const found = [];
  for (const manager of MANAGER_NAMES) {
    if (LOCKFILE_MARKERS[manager].some(name => present.has(name))) {
      found.push(manager);
    }
  }
  return found;
};
harden(managersFromMarkers);

/**
 * Whether the selected manager has a frozen-mode lockfile present.
 *
 * @param {PackageManagerName} manager
 * @param {Readonly<Record<string, boolean>> | ReadonlySet<string> | readonly string[]} markersPresent
 * @returns {boolean}
 */
export const hasFrozenLockfile = (manager, markersPresent) => {
  const present =
    markersPresent instanceof Set
      ? markersPresent
      : Array.isArray(markersPresent)
        ? new Set(markersPresent)
        : new Set(
            Object.entries(markersPresent)
              .filter(([, v]) => v)
              .map(([k]) => k),
          );
  return FROZEN_LOCKFILES[manager].some(name => present.has(name));
};
harden(hasFrozenLockfile);

/**
 * @typedef {object} SelectManagerInput
 * @property {PackageManagerChoice} [explicit] Requested manager (`auto` or named).
 * @property {unknown} [packageManagerField] `package.json#packageManager`.
 * @property {Readonly<Record<string, boolean>> | ReadonlySet<string> | readonly string[]} [markers]
 *   Marker filenames present at the effective project root.
 * @property {readonly PackageManagerName[]} [allowedManagers] Host policy allowlist.
 * @property {PackageManagerName} [defaultManager] Host policy default when no markers.
 */

/**
 * @typedef {object} ManagerSelection
 * @property {PackageManagerName} manager
 * @property {string} [versionRequest]
 * @property {'explicit' | 'manifest' | 'lockfile' | 'default'} source
 * @property {PackageManagerName[]} markerManagers
 * @property {string[]} markersPresent
 */

/**
 * Deterministic manager selection.
 *
 * Precedence: explicit request (when not `auto`) → `packageManager` field →
 * lockfile markers → host policy default. Contradictions throw structured
 * errors rather than silent priority tie-breaks.
 *
 * @param {SelectManagerInput} input
 * @returns {ManagerSelection}
 */
export const selectManager = input => {
  const {
    explicit = 'auto',
    packageManagerField,
    markers = {},
    allowedManagers,
    defaultManager,
  } = input;

  if (
    explicit !== 'auto' &&
    explicit !== 'npm' &&
    explicit !== 'pnpm' &&
    explicit !== 'yarn'
  ) {
    throw makePackageManagerError(
      'manager-mismatch',
      `unsupported manager choice ${String(explicit)}`,
    );
  }

  const markerManagers = managersFromMarkers(markers);
  const markersPresent = Array.isArray(markers)
    ? [...markers]
    : markers instanceof Set
      ? [...markers]
      : Object.entries(markers)
          .filter(([, v]) => v)
          .map(([k]) => k);

  const allowed =
    allowedManagers === undefined
      ? undefined
      : new Set(allowedManagers);

  const assertAllowed = (/** @type {PackageManagerName} */ manager) => {
    if (allowed !== undefined && !allowed.has(manager)) {
      throw makePackageManagerError(
        'manager-mismatch',
        `manager ${manager} is not in the host allowedManagers policy`,
        { manager, allowedManagers: [...(allowedManagers || [])] },
      );
    }
  };

  const fromManifest = parsePackageManagerField(packageManagerField);

  // Multiple incompatible lockfiles at one root are always a conflict when
  // detection must choose among them (auto or marker-driven).
  if (markerManagers.length > 1) {
    // Explicit or manifest that uniquely names one of them still requires
    // agreement with every present lockfile family, else mismatch.
    const preferred =
      explicit !== 'auto'
        ? explicit
        : fromManifest !== undefined
          ? fromManifest.manager
          : undefined;
    if (preferred === undefined) {
      throw makePackageManagerError(
        'manager-ambiguous',
        `multiple package-manager markers at one root: ${markerManagers.join(', ')}`,
        { candidates: markerManagers, markersPresent },
      );
    }
    if (!markerManagers.includes(preferred)) {
      throw makePackageManagerError(
        'manager-mismatch',
        `selected manager ${preferred} disagrees with lockfile markers for ${markerManagers.join(', ')}`,
        { selected: preferred, candidates: markerManagers, markersPresent },
      );
    }
    // Preferred is one of the marker managers, but another family is also
    // present — that is still ambiguous/mismatched evidence.
    if (markerManagers.some(m => m !== preferred)) {
      throw makePackageManagerError(
        'manager-mismatch',
        `manager ${preferred} coexists with conflicting markers for ${markerManagers.filter(m => m !== preferred).join(', ')}`,
        { selected: preferred, candidates: markerManagers, markersPresent },
      );
    }
  }

  /** @type {ManagerSelection | undefined} */
  let selection;

  if (explicit !== 'auto') {
    if (fromManifest !== undefined && fromManifest.manager !== explicit) {
      throw makePackageManagerError(
        'manager-mismatch',
        `explicit manager ${explicit} disagrees with packageManager field ${String(packageManagerField)}`,
        {
          explicit,
          manifest: fromManifest.manager,
          markersPresent,
        },
      );
    }
    if (markerManagers.length === 1 && markerManagers[0] !== explicit) {
      throw makePackageManagerError(
        'manager-mismatch',
        `explicit manager ${explicit} disagrees with lockfile markers for ${markerManagers[0]}`,
        {
          explicit,
          candidates: markerManagers,
          markersPresent,
        },
      );
    }
    selection = {
      manager: explicit,
      source: 'explicit',
      markerManagers,
      markersPresent,
      ...(fromManifest?.version !== undefined
        ? { versionRequest: fromManifest.version }
        : {}),
    };
  } else if (fromManifest !== undefined) {
    if (markerManagers.length === 1 && markerManagers[0] !== fromManifest.manager) {
      throw makePackageManagerError(
        'manager-mismatch',
        `packageManager field ${fromManifest.manager} disagrees with lockfile markers for ${markerManagers[0]}`,
        {
          manifest: fromManifest.manager,
          candidates: markerManagers,
          markersPresent,
        },
      );
    }
    selection = {
      manager: fromManifest.manager,
      source: 'manifest',
      markerManagers,
      markersPresent,
      ...(fromManifest.version !== undefined
        ? { versionRequest: fromManifest.version }
        : {}),
    };
  } else if (markerManagers.length === 1) {
    selection = {
      manager: markerManagers[0],
      source: 'lockfile',
      markerManagers,
      markersPresent,
    };
  } else if (defaultManager !== undefined) {
    selection = {
      manager: defaultManager,
      source: 'default',
      markerManagers,
      markersPresent,
    };
  } else {
    throw makePackageManagerError(
      'manager-undetected',
      'no explicit, packageManager field, lockfile marker, or policy default manager',
      { markersPresent },
    );
  }

  assertAllowed(selection.manager);
  return harden(selection);
};
harden(selectManager);
