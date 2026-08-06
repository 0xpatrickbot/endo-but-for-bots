// @ts-check
/// <reference types="ses"/>

/** @import { ERef } from '@endo/eventual-send' */
/** @import { ToolInvocationContext, ToolRecord } from '../types.js' */

import { E } from '@endo/eventual-send';
import { isPackageManagerReadOnly } from '@endo/exo-package-manager';

import { makeTool } from '../tool.js';

/**
 * @typedef {object} PackageManagerToolCapability
 * @property {(input?: object) => Promise<object>} detect
 * @property {(input?: object) => Promise<object>} scripts
 * @property {(input: object) => Promise<object>} install
 * @property {(input: object) => Promise<object>} run
 * @property {(operationId: string) => Promise<boolean>} cancel
 * @property {() => PackageManagerToolCapability} [readOnly]
 */

/**
 * @typedef {object} PackageManagerToolsOptions
 * @property {ERef<{ entry: (segments: string[]) => Promise<object> }>} [mount]
 *   Mount issuer used to resolve mount-relative path strings to PathEntry
 *   remotables. Required when tools accept a `cwd` path string.
 * @property {boolean} [includeReadTools] When true (default), emit
 *   `detectPackageManager` and `listPackageScripts`.
 */

/**
 * Split a mount-relative path into entry segments.
 *
 * @param {string} path
 * @returns {string[]}
 */
const pathToSegments = path =>
  path.split('/').filter(segment => segment !== '' && segment !== '.');

/**
 * @param {ERef<{ entry: (segments: string[]) => Promise<object> }>} mount
 * @param {unknown} cwdPath
 * @returns {Promise<object | undefined>}
 */
const resolveCwdEntry = async (mount, cwdPath) => {
  if (cwdPath === undefined || cwdPath === null) {
    return undefined;
  }
  if (typeof cwdPath !== 'string') {
    throw new Error('cwd must be a mount-relative path string');
  }
  if (cwdPath === '' || cwdPath === '.') {
    return undefined;
  }
  const segments = pathToSegments(cwdPath);
  if (segments.length === 0) {
    return undefined;
  }
  return E(mount).entry(segments);
};

/**
 * Generate a stable-enough operation id for cancel bridging.
 *
 * @returns {string}
 */
const newOperationId = () =>
  `pm-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

/**
 * Bridge an AbortSignal to package-manager cancel(operationId).
 *
 * @param {ERef<PackageManagerToolCapability>} pmCap
 * @param {string} operationId
 * @param {AbortSignal | undefined} signal
 * @returns {() => void} cleanup
 */
const bridgeSignalToCancel = (pmCap, operationId, signal) => {
  if (signal === undefined || signal === null) {
    return () => {};
  }
  if (signal.aborted) {
    void E(pmCap).cancel(operationId);
    return () => {};
  }
  const onAbort = () => {
    void E(pmCap).cancel(operationId);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
};

const managerChoiceProp = harden({
  type: 'string',
  enum: ['auto', 'npm', 'pnpm', 'yarn'],
  description: 'Package manager selection; auto uses manifest and lockfiles.',
});

const cwdProp = harden({
  type: 'string',
  description:
    'Mount-relative path to the package directory (default: mount root). ' +
    'Resolved through the mount issuer; host paths are not accepted.',
});

/**
 * Build agent tools over a confined EndoPackageManager capability.
 *
 * The surface is install of declared dependencies and run of named package.json
 * scripts (plus detect/list metadata). It is a peer grant next to git/fs/shell,
 * not a general shell substitute, not a polyglot toolchain, and not a
 * substitute for registry resolve+import.
 *
 * Write tools (`installDependencies`, `runPackageScript`) are omitted when the
 * capability is read-only. Path strings in tool schemas never include host
 * paths; they are resolved to mount entries locally.
 *
 * @param {ERef<PackageManagerToolCapability>} pmCap
 * @param {PackageManagerToolsOptions} [options]
 * @returns {ToolRecord[]}
 */
export const makePackageManagerTools = (pmCap, options = {}) => {
  const { mount, includeReadTools = true } = options;
  const readOnly = isPackageManagerReadOnly(pmCap) === true;

  /** @type {ToolRecord[]} */
  const tools = [];

  if (includeReadTools) {
    tools.push(
      makeTool({
        name: 'detectPackageManager',
        description:
          'Detect the package manager (npm/pnpm/yarn) for a package directory ' +
          'from explicit choice, packageManager field, and lockfile markers.',
        parameters: harden({
          type: 'object',
          properties: {
            cwd: cwdProp,
            manager: managerChoiceProp,
          },
          required: [],
          additionalProperties: false,
        }),
        execute: async args => {
          const input = /** @type {{ cwd?: string, manager?: string }} */ (args);
          /** @type {Record<string, unknown>} */
          const payload = {};
          if (input.manager !== undefined) {
            payload.manager = input.manager;
          }
          if (input.cwd !== undefined) {
            if (mount === undefined) {
              throw new Error(
                'detectPackageManager cwd requires a mount issuer',
              );
            }
            const entry = await resolveCwdEntry(mount, input.cwd);
            if (entry !== undefined) {
              payload.cwd = entry;
            }
          }
          return E(pmCap).detect(harden(payload));
        },
      }),
    );

    tools.push(
      makeTool({
        name: 'listPackageScripts',
        description:
          'List declared package.json script names for the selected package.',
        parameters: harden({
          type: 'object',
          properties: {
            cwd: cwdProp,
            manager: managerChoiceProp,
          },
          required: [],
          additionalProperties: false,
        }),
        execute: async args => {
          const input = /** @type {{ cwd?: string, manager?: string }} */ (args);
          /** @type {Record<string, unknown>} */
          const payload = {};
          if (input.manager !== undefined) {
            payload.manager = input.manager;
          }
          if (input.cwd !== undefined) {
            if (mount === undefined) {
              throw new Error(
                'listPackageScripts cwd requires a mount issuer',
              );
            }
            const entry = await resolveCwdEntry(mount, input.cwd);
            if (entry !== undefined) {
              payload.cwd = entry;
            }
          }
          return E(pmCap).scripts(harden(payload));
        },
      }),
    );
  }

  if (!readOnly) {
    tools.push(
      makeTool({
        name: 'installDependencies',
        description:
          'Install declared package dependencies with the selected manager. ' +
          'Frozen lockfile mode is the default. Does not add packages.',
        parameters: harden({
          type: 'object',
          properties: {
            cwd: cwdProp,
            manager: managerChoiceProp,
            lockfileMode: {
              type: 'string',
              enum: ['frozen', 'update'],
              description:
                'frozen (default) requires a lockfile and does not change it; ' +
                'update requires host policy allowance.',
            },
            offline: {
              type: 'boolean',
              description: 'Use only granted caches; network none.',
            },
            production: {
              type: 'boolean',
              description: 'Omit dev dependencies when supported.',
            },
            lifecycleScripts: {
              type: 'string',
              enum: ['disabled', 'enabled'],
              description:
                'Whether to run install lifecycle scripts (default disabled; ' +
                'enabled requires host policy).',
            },
            timeoutMs: {
              type: 'number',
              description: 'Per-call timeout; may only narrow host policy.',
            },
          },
          required: [],
          additionalProperties: false,
        }),
        /**
         * @param {Record<string, unknown>} args
         * @param {ToolInvocationContext} [context]
         */
        execute: async (args, context) => {
          const input =
            /** @type {{
             *   cwd?: string,
             *   manager?: string,
             *   lockfileMode?: string,
             *   offline?: boolean,
             *   production?: boolean,
             *   lifecycleScripts?: string,
             *   timeoutMs?: number,
             * }} */ (args);
          const operationId = newOperationId();
          /** @type {Record<string, unknown>} */
          const payload = { operationId };
          for (const key of [
            'manager',
            'lockfileMode',
            'offline',
            'production',
            'lifecycleScripts',
            'timeoutMs',
          ]) {
            if (input[key] !== undefined) {
              payload[key] = input[key];
            }
          }
          if (input.cwd !== undefined) {
            if (mount === undefined) {
              throw new Error(
                'installDependencies cwd requires a mount issuer',
              );
            }
            const entry = await resolveCwdEntry(mount, input.cwd);
            if (entry !== undefined) {
              payload.cwd = entry;
            }
          }
          const cleanup = bridgeSignalToCancel(
            pmCap,
            operationId,
            context?.signal,
          );
          try {
            return await E(pmCap).install(harden(payload));
          } finally {
            cleanup();
          }
        },
      }),
    );

    tools.push(
      makeTool({
        name: 'runPackageScript',
        description:
          'Run a declared package.json script with the selected manager. ' +
          'Not a general shell or arbitrary package-manager subcommand.',
        parameters: harden({
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'Declared script name from package.json#scripts.',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Arguments forwarded after the script name.',
            },
            cwd: cwdProp,
            manager: managerChoiceProp,
            timeoutMs: {
              type: 'number',
              description: 'Per-call timeout; may only narrow host policy.',
            },
          },
          required: ['script'],
          additionalProperties: false,
        }),
        /**
         * @param {Record<string, unknown>} args
         * @param {ToolInvocationContext} [context]
         */
        execute: async (args, context) => {
          const input =
            /** @type {{
             *   script: string,
             *   args?: string[],
             *   cwd?: string,
             *   manager?: string,
             *   timeoutMs?: number,
             * }} */ (args);
          const operationId = newOperationId();
          /** @type {Record<string, unknown>} */
          const payload = {
            operationId,
            script: input.script,
          };
          if (input.args !== undefined) {
            payload.args = input.args;
          }
          if (input.manager !== undefined) {
            payload.manager = input.manager;
          }
          if (input.timeoutMs !== undefined) {
            payload.timeoutMs = input.timeoutMs;
          }
          if (input.cwd !== undefined) {
            if (mount === undefined) {
              throw new Error(
                'runPackageScript cwd requires a mount issuer',
              );
            }
            const entry = await resolveCwdEntry(mount, input.cwd);
            if (entry !== undefined) {
              payload.cwd = entry;
            }
          }
          const cleanup = bridgeSignalToCancel(
            pmCap,
            operationId,
            context?.signal,
          );
          try {
            return await E(pmCap).run(harden(payload));
          } finally {
            cleanup();
          }
        },
      }),
    );
  }

  return harden(tools);
};
harden(makePackageManagerTools);
