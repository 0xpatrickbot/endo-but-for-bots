// @ts-check
/// <reference types="ses"/>

import { makeError, q, X } from '@endo/errors';
import { E } from '@endo/eventual-send';
import { makeExo } from '@endo/exo';

import { hasFrozenLockfile, selectManager } from './detect.js';
import { makePackageManagerError } from './errors.js';
import { PackageManagerInterface } from './interfaces.js';

/**
 * @import {
 *   EndoPackageManager,
 *   PackageCommandResult,
 *   PackageInstallInput,
 *   PackageManagerDetection,
 *   PackageManagerPolicy,
 *   PackageScripts,
 *   PackageScriptRunInput,
 *   PackageWorkspaceInput,
 *   PackageManagerBackend,
 * } from './types.js'
 */

/** @type {WeakMap<object, boolean>} */
const packageManagerReadOnly = new WeakMap();

/**
 * Host-private accessor: whether a minted package-manager exo is read-only.
 *
 * @param {unknown} pm
 * @returns {boolean | undefined}
 */
export const isPackageManagerReadOnly = pm =>
  packageManagerReadOnly.get(/** @type {object} */ (pm));
harden(isPackageManagerReadOnly);

const HELP_TEXT = harden({
  '':
    'EndoPackageManager: confined npm/pnpm/yarn install and named-script run. ' +
    'Methods: help, detect, scripts, install, run, cancel, readOnly.',
  help: 'help(method?): short description of the capability or a named method.',
  detect:
    'detect(input?): select npm/pnpm/yarn from explicit choice, packageManager field, lockfiles, and policy without spawning.',
  scripts:
    'scripts(input?): list declared package.json script names for the selected package target.',
  install:
    'install(input): hydrate declared dependencies with fixed manager argv (frozen default). No add-package path.',
  run: 'run(input): run a declared package.json script with fixed manager argv. Not a general shell.',
  cancel: 'cancel(operationId): request cancellation of an in-flight install or run.',
  readOnly:
    'readOnly(): attenuate to metadata methods only; install/run/cancel fail closed.',
});

/**
 * @param {string} [method]
 * @returns {string}
 */
const helpFor = method => {
  if (method === undefined || method === '') {
    return HELP_TEXT[''];
  }
  return HELP_TEXT[method] || `Unknown method ${method}`;
};

/**
 * Resolve a workspace cwd entry to mount-relative segments after lineage check.
 *
 * @param {object} powers
 * @param {object} powers.mount
 * @param {(value: unknown) => object | undefined} powers.lineageOf
 * @param {object | undefined} [cwd]
 * @returns {Promise<{ segments: string[], displayPath: string }>}
 */
const resolveCwd = async ({ mount, lineageOf }, cwd) => {
  const mountLineage = lineageOf(mount);
  if (cwd === undefined) {
    return { segments: [], displayPath: '.' };
  }
  const otherLineage = lineageOf(cwd);
  if (otherLineage === undefined) {
    throw makePackageManagerError(
      'workspace-invalid',
      'cwd is not an EndoMountEntry minted by this daemon',
    );
  }
  if (otherLineage !== mountLineage) {
    throw makePackageManagerError(
      'workspace-invalid',
      'cwd was minted by a different mount lineage',
    );
  }
  const segments = await E(cwd).segments();
  if (!Array.isArray(segments)) {
    throw makePackageManagerError(
      'workspace-invalid',
      'cwd.segments() did not return an array',
    );
  }
  const clean = segments.filter(s => typeof s === 'string' && s !== '' && s !== '.');
  return {
    segments: clean,
    displayPath: clean.length === 0 ? '.' : clean.join('/'),
  };
};

/**
 * Construct the public PackageManager capability exo.
 *
 * The portable package does not import Node built-ins, read host paths, or
 * spawn processes. I/O and sandbox spawn live in the injected backend.
 *
 * @param {object} args
 * @param {object} args.mount Workspace mount carrying path authority.
 * @param {PackageManagerBackend} args.backend
 * @param {PackageManagerPolicy} [args.policy]
 * @param {boolean} [args.readOnly]
 * @param {(value: unknown) => object | undefined} args.lineageOf
 * @returns {EndoPackageManager}
 */
export const makePackageManager = ({
  mount,
  backend,
  policy = harden({}),
  readOnly = false,
  lineageOf,
}) => {
  if (typeof lineageOf !== 'function') {
    throw makeError(X`makePackageManager requires lineageOf`);
  }
  if (backend === undefined || backend === null) {
    throw makeError(X`makePackageManager requires a backend`);
  }
  if (mount === undefined || mount === null) {
    throw makeError(X`makePackageManager requires a mount`);
  }

  const {
    allowedManagers,
    defaultManager,
    allowLockfileUpdate = false,
    allowLifecycleScripts = false,
    defaultTimeoutMs = 600_000,
    maxOutputBytes = 1_048_576,
  } = policy;

  const assertWritable = methodName => {
    if (readOnly) {
      throw makePackageManagerError(
        'read-only',
        `PackageManager.${methodName} is not permitted on a read-only capability`,
      );
    }
  };

  /**
   * @param {PackageWorkspaceInput} [input]
   */
  const resolveSelection = async (input = {}) => {
    const { cwd, manager: explicit = 'auto' } = input;
    const { segments, displayPath } = await resolveCwd(
      { mount, lineageOf },
      cwd,
    );
    const snapshot = await backend.inspectWorkspace({
      segments,
      displayPath,
    });
    if (snapshot === undefined || snapshot === null) {
      throw makePackageManagerError(
        'workspace-invalid',
        `workspace at ${displayPath} is not a usable package directory`,
      );
    }
    const selection = selectManager({
      explicit,
      packageManagerField: snapshot.packageManagerField,
      markers: snapshot.markers,
      allowedManagers,
      defaultManager,
    });
    return harden({
      selection,
      snapshot,
      segments,
      displayPath,
    });
  };

  /** @type {EndoPackageManager} */
  let selfExo;

  const methods = {
    help(method) {
      return helpFor(method);
    },

    /**
     * @param {PackageWorkspaceInput} [input]
     * @returns {Promise<PackageManagerDetection>}
     */
    async detect(input = {}) {
      const { selection, snapshot, displayPath } = await resolveSelection(input);
      return harden({
        manager: selection.manager,
        source: selection.source,
        markerManagers: selection.markerManagers,
        markersPresent: selection.markersPresent,
        displayPath,
        ...(selection.versionRequest !== undefined
          ? { versionRequest: selection.versionRequest }
          : {}),
        ...(snapshot.workspaceName !== undefined
          ? { workspaceName: snapshot.workspaceName }
          : {}),
        hasFrozenLockfile: hasFrozenLockfile(
          selection.manager,
          snapshot.markers,
        ),
      });
    },

    /**
     * @param {PackageWorkspaceInput} [input]
     * @returns {Promise<PackageScripts>}
     */
    async scripts(input = {}) {
      const { selection, snapshot, displayPath } = await resolveSelection(input);
      const scriptNames = Array.isArray(snapshot.scriptNames)
        ? [...snapshot.scriptNames]
        : [];
      return harden({
        scriptNames,
        displayPath,
        manager: selection.manager,
        ...(snapshot.workspaceName !== undefined
          ? { workspaceName: snapshot.workspaceName }
          : {}),
      });
    },

    /**
     * @param {PackageInstallInput} input
     * @returns {Promise<PackageCommandResult>}
     */
    async install(input = {}) {
      assertWritable('install');
      const {
        lockfileMode = 'frozen',
        offline = false,
        lifecycleScripts = 'disabled',
        production = false,
        timeoutMs,
        operationId,
        ...workspaceInput
      } = input;

      if (lockfileMode === 'update' && !allowLockfileUpdate) {
        throw makePackageManagerError(
          'policy-denied',
          'lockfileMode update is not permitted by host policy',
        );
      }
      if (lifecycleScripts === 'enabled' && !allowLifecycleScripts) {
        throw makePackageManagerError(
          'policy-denied',
          'lifecycleScripts enabled is not permitted by host policy',
        );
      }

      const { selection, snapshot, segments, displayPath } =
        await resolveSelection(workspaceInput);

      if (
        lockfileMode === 'frozen' &&
        !hasFrozenLockfile(selection.manager, snapshot.markers)
      ) {
        throw makePackageManagerError(
          'lockfile-missing',
          `frozen install requires a lockfile for ${selection.manager}`,
          { manager: selection.manager, markersPresent: selection.markersPresent },
        );
      }

      const effectiveTimeoutMs =
        timeoutMs !== undefined && timeoutMs > 0
          ? Math.min(defaultTimeoutMs, timeoutMs)
          : defaultTimeoutMs;

      return backend.install(
        harden({
          manager: selection.manager,
          versionRequest: selection.versionRequest,
          segments,
          displayPath,
          workspaceName: snapshot.workspaceName,
          yarnMajorVersion: snapshot.yarnMajorVersion,
          lockfileMode,
          offline,
          lifecycleScripts,
          production,
          timeoutMs: effectiveTimeoutMs,
          maxOutputBytes,
          operationId,
        }),
      );
    },

    /**
     * @param {PackageScriptRunInput} input
     * @returns {Promise<PackageCommandResult>}
     */
    async run(input) {
      assertWritable('run');
      const {
        script,
        args = [],
        timeoutMs,
        operationId,
        ...workspaceInput
      } = input;
      if (typeof script !== 'string' || script.length === 0) {
        throw makePackageManagerError(
          'script-not-declared',
          'run requires a non-empty script name',
        );
      }

      const { selection, snapshot, segments, displayPath } =
        await resolveSelection(workspaceInput);

      const scriptNames = Array.isArray(snapshot.scriptNames)
        ? snapshot.scriptNames
        : [];
      if (!scriptNames.includes(script)) {
        throw makePackageManagerError(
          'script-not-declared',
          `script ${q(script)} is not declared in package.json`,
          { script, scriptNames },
        );
      }

      const effectiveTimeoutMs =
        timeoutMs !== undefined && timeoutMs > 0
          ? Math.min(defaultTimeoutMs, timeoutMs)
          : defaultTimeoutMs;

      return backend.run(
        harden({
          manager: selection.manager,
          versionRequest: selection.versionRequest,
          segments,
          displayPath,
          workspaceName: snapshot.workspaceName,
          yarnMajorVersion: snapshot.yarnMajorVersion,
          script,
          args: [...args],
          timeoutMs: effectiveTimeoutMs,
          maxOutputBytes,
          operationId,
        }),
      );
    },

    /**
     * @param {string} operationId
     * @returns {Promise<boolean>}
     */
    async cancel(operationId) {
      assertWritable('cancel');
      if (typeof operationId !== 'string' || operationId.length === 0) {
        throw makeError(X`cancel requires a non-empty operationId`);
      }
      return backend.cancel(operationId);
    },

    readOnly() {
      if (readOnly) {
        return selfExo;
      }
      return makePackageManager({
        mount,
        backend,
        policy,
        readOnly: true,
        lineageOf,
      });
    },
  };

  selfExo = makeExo('PackageManager', PackageManagerInterface, methods);
  packageManagerReadOnly.set(selfExo, readOnly);
  return selfExo;
};
harden(makePackageManager);
