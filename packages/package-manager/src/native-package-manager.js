// @ts-check
/// <reference types="ses"/>
/* global setTimeout, clearTimeout, crypto */

import { makeError, q, X } from '@endo/errors';
import { E } from '@endo/eventual-send';
import {
  buildInstallArgv,
  buildRunArgv,
  makePackageManagerError,
} from '@endo/exo-package-manager';

import { drainBounded } from './collect-streams.js';
import { buildPackageManagerEnv } from './env.js';

/**
 * Invoke a method on a local object or ERef without requiring the target to
 * be a Far remotable. Prefer the local method when present so plain test
 * doubles and injected handles work under SES lockdown.
 *
 * @param {any} target
 * @param {string} method
 * @param {unknown[]} args
 */
const invoke = (target, method, args = []) => {
  if (
    target !== null &&
    target !== undefined &&
    typeof target[method] === 'function'
  ) {
    return target[method](...args);
  }
  return E(target)[method](...args);
};

/**
 * @typedef {import('@endo/exo-package-manager').PackageCommandResult} PackageCommandResult
 * @typedef {import('@endo/exo-package-manager').PackageManagerBackend} PackageManagerBackend
 * @typedef {import('@endo/exo-package-manager').InstallBackendInput} InstallBackendInput
 * @typedef {import('@endo/exo-package-manager').RunBackendInput} RunBackendInput
 * @typedef {import('@endo/exo-package-manager').WorkspaceSnapshot} WorkspaceSnapshot
 */

const DEFAULT_KILL_GRACE_MS = 2000;
const DEFAULT_WORKSPACE_INNER = '/workspace';

/**
 * @typedef {object} SandboxProcessHandle
 * @property {() => Promise<{ code: number | null, signal: string | null }>} wait
 * @property {(signal?: string | number) => Promise<void>} kill
 * @property {() => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>} [stdout]
 * @property {() => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>} [stderr]
 */

/**
 * @typedef {object} SandboxHandle
 * @property {(argv: string[], opts?: object) => Promise<SandboxProcessHandle>} spawn
 * @property {() => Promise<void>} [dispose]
 */

/**
 * @typedef {object} SandboxFactory
 * @property {(opts: object) => Promise<SandboxHandle>} make
 */

/**
 * @typedef {object} WorkspaceReader
 * @property {(segments: string[], name: string) => Promise<string | undefined>} readText
 * @property {(segments: string[], name: string) => Promise<boolean>} exists
 */

/**
 * @typedef {object} NativePackageManagerOptions
 * @property {SandboxHandle} [sandbox] Pre-made session-scoped sandbox slice.
 * @property {SandboxFactory} [sandboxFactory] Factory used when `sandbox` is omitted.
 * @property {object} [sandboxMakeOpts] Options for `sandboxFactory.make`.
 * @property {WorkspaceReader} workspaceReader Reads package metadata from the
 *   granted workspace (host-side or mount-backed). Never ambient host npm.
 * @property {string} [workspaceInnerPath] Inner mount path of the workspace.
 * @property {'none' | 'private'} [installNetwork] Network profile for online install.
 * @property {number} [killGraceMs]
 * @property {Record<string, string>} [envExtra]
 * @property {Record<string, string>} [managerCacheEnv]
 * @property {(id: string) => void} [onOperationStart]
 * @property {(id: string) => void} [onOperationEnd]
 */

/**
 * Redact secret-looking option values in the normalized command view.
 *
 * @param {string[]} argv
 * @returns {{ args: string[], redacted: boolean }}
 */
export const redactArgv = argv => {
  let redacted = false;
  const args = argv.map((arg, i) => {
    const prev = i > 0 ? argv[i - 1] : '';
    if (
      /token|password|secret|auth|registry.*=/i.test(arg) ||
      /token|password|secret|auth/i.test(prev)
    ) {
      redacted = true;
      if (arg.includes('=')) {
        const eq = arg.indexOf('=');
        return `${arg.slice(0, eq + 1)}***`;
      }
      return '***';
    }
    return arg;
  });
  return harden({ args, redacted });
};
harden(redactArgv);

/**
 * @param {NativePackageManagerOptions} options
 * @returns {PackageManagerBackend & { dispose?: () => Promise<void> }}
 */
export const makeNativePackageManagerBackend = options => {
  const {
    sandbox: providedSandbox,
    sandboxFactory,
    sandboxMakeOpts,
    workspaceReader,
    workspaceInnerPath = DEFAULT_WORKSPACE_INNER,
    installNetwork = 'private',
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    envExtra = {},
    managerCacheEnv = {},
  } = options;

  if (workspaceReader === undefined || workspaceReader === null) {
    throw makeError(X`makeNativePackageManagerBackend requires workspaceReader`);
  }
  if (providedSandbox === undefined && sandboxFactory === undefined) {
    throw makeError(
      X`makeNativePackageManagerBackend requires sandbox or sandboxFactory`,
    );
  }

  /** @type {Promise<SandboxHandle> | undefined} */
  let sandboxP;
  const getSandbox = () => {
    if (sandboxP === undefined) {
      if (providedSandbox !== undefined) {
        sandboxP = Promise.resolve(providedSandbox);
      } else {
        sandboxP = Promise.resolve(
          invoke(sandboxFactory, 'make', [
            sandboxMakeOpts || {
              rootfs: { kind: 'minimal' },
              network: 'none',
              cwd: workspaceInnerPath,
            },
          ]),
        );
      }
    }
    return sandboxP;
  };

  /**
   * In-flight operations for cancel(operationId).
   *
   * @type {Map<string, { kill: (sig?: string) => Promise<void>, cancelled: boolean }>}
   */
  const operations = new Map();

  const childEnv = buildPackageManagerEnv({
    managerCacheEnv,
    extra: envExtra,
  });

  /**
   * @param {string[]} segments
   * @returns {Promise<WorkspaceSnapshot>}
   */
  const inspectWorkspace = async ({ segments, displayPath }) => {
    const packageJsonText = await workspaceReader.readText(
      segments,
      'package.json',
    );
    if (packageJsonText === undefined) {
      throw makePackageManagerError(
        'workspace-invalid',
        `no package.json at ${displayPath}`,
      );
    }
    /** @type {any} */
    let pkg;
    try {
      pkg = JSON.parse(packageJsonText);
    } catch (err) {
      throw makePackageManagerError(
        'workspace-invalid',
        `package.json at ${displayPath} is not valid JSON`,
      );
    }
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
      throw makePackageManagerError(
        'workspace-invalid',
        `package.json at ${displayPath} is not an object`,
      );
    }

    const markerNames = [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'yarn.lock',
      '.yarnrc.yml',
      '.pnp.cjs',
    ];
    /** @type {Record<string, boolean>} */
    const markers = {};
    await Promise.all(
      markerNames.map(async name => {
        markers[name] = await workspaceReader.exists(segments, name);
      }),
    );

    const scriptNames =
      pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
        ? Object.keys(pkg.scripts)
        : [];

    let yarnMajorVersion = 2;
    if (typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('yarn@')) {
      const ver = pkg.packageManager.slice('yarn@'.length);
      const major = Number.parseInt(ver, 10);
      if (Number.isFinite(major)) {
        yarnMajorVersion = major;
      }
    } else if (markers['.yarnrc.yml'] || markers['.pnp.cjs']) {
      yarnMajorVersion = 2;
    }

    return harden({
      packageManagerField:
        typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined,
      markers,
      scriptNames,
      workspaceName: typeof pkg.name === 'string' ? pkg.name : undefined,
      yarnMajorVersion,
      displayPath,
    });
  };

  /**
   * @param {object} args
   * @param {'install' | 'run'} args.operation
   * @param {string[]} args.argv
   * @param {string} args.manager
   * @param {string} args.displayPath
   * @param {string} [args.workspaceName]
   * @param {string[]} args.segments
   * @param {number} args.timeoutMs
   * @param {number} args.maxOutputBytes
   * @param {string} [args.operationId]
   * @param {'none' | 'private'} args.network
   * @returns {Promise<PackageCommandResult>}
   */
  const runArgv = async ({
    operation,
    argv,
    manager,
    displayPath,
    workspaceName,
    segments,
    timeoutMs,
    maxOutputBytes,
    operationId,
    network,
  }) => {
    const started = Date.now();
    const opId =
      operationId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `op-${started}-${Math.random().toString(16).slice(2)}`);

    let sandbox;
    try {
      sandbox = await getSandbox();
    } catch (err) {
      throw makePackageManagerError(
        'sandbox-unavailable',
        `sandbox slice unavailable: ${/** @type {Error} */ (err).message || err}`,
      );
    }

    // Offline / run always use network none; install may use private only when
    // not offline. Call record cannot widen past construction policy.
    const effectiveNetwork = network;

    const relativeCwd =
      segments.length === 0
        ? workspaceInnerPath
        : `${workspaceInnerPath}/${segments.join('/')}`;

    const { args: redactedArgs, redacted } = redactArgv(argv);

    let proc;
    try {
      // Copy argv into a fresh mutable array so a hardened guest argv cannot
      // confuse local doubles or drivers that reindex arguments.
      const spawnArgv = [...argv];
      proc = await invoke(sandbox, 'spawn', [
        spawnArgv,
        {
          cwd: relativeCwd,
          env: { ...childEnv },
          captureStdout: true,
          captureStderr: true,
          // Drivers that understand network per-spawn may honor this; session
          // slice construction already pins the default profile.
          network: effectiveNetwork,
        },
      ]);
    } catch (err) {
      throw makePackageManagerError(
        'sandbox-unavailable',
        `sandbox spawn failed: ${/** @type {Error} */ (err).message || err}`,
      );
    }

    let cancelled = false;
    let timedOut = false;
    let outputLimited = false;

    const killProc = async (sig = 'SIGTERM') => {
      try {
        await invoke(proc, 'kill', [sig]);
      } catch {
        // best-effort
      }
    };

    operations.set(opId, {
      kill: killProc,
      get cancelled() {
        return cancelled;
      },
      set cancelled(v) {
        cancelled = v;
      },
    });

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let graceTimer;
    timer = setTimeout(() => {
      timedOut = true;
      void killProc('SIGTERM');
      graceTimer = setTimeout(() => {
        void killProc('SIGKILL');
      }, killGraceMs);
    }, timeoutMs);

    const stdoutStream = proc.stdout
      ? await invoke(proc, 'stdout', [])
      : undefined;
    const stderrStream = proc.stderr
      ? await invoke(proc, 'stderr', [])
      : undefined;

    const [stdoutResult, stderrResult, waitResult] = await Promise.all([
      drainBounded(stdoutStream, maxOutputBytes),
      drainBounded(stderrStream, maxOutputBytes),
      Promise.resolve(invoke(proc, 'wait', [])).catch(() => ({
        code: null,
        signal: null,
      })),
    ]);

    if (timer !== undefined) clearTimeout(timer);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    // Read cancel flag before removing the op table entry. The cancel()
    // method mutates the closed-over `cancelled` let via the op setter.
    operations.delete(opId);

    if (stdoutResult.truncated || stderrResult.truncated) {
      outputLimited = true;
      await killProc('SIGTERM');
    }

    /** @type {PackageCommandResult['termination']} */
    let termination = 'exit';
    // Prefer cancelled over timeout when both fire (caller abort wins).
    if (cancelled) {
      termination = 'cancelled';
    } else if (timedOut) {
      termination = 'timeout';
    } else if (outputLimited) {
      termination = 'output-limit';
    }

    const exitCode =
      waitResult && typeof waitResult.code === 'number'
        ? waitResult.code
        : waitResult?.code === null
          ? null
          : null;
    const signal =
      waitResult && typeof waitResult.signal === 'string'
        ? waitResult.signal
        : null;

    const ok =
      termination === 'exit' && exitCode === 0 && !stdoutResult.truncated &&
      !stderrResult.truncated;

    return harden({
      ok,
      operation,
      manager: /** @type {any} */ (manager),
      target: {
        displayPath,
        ...(workspaceName !== undefined ? { workspaceName } : {}),
      },
      command: {
        operation,
        manager: /** @type {any} */ (manager),
        args: redactedArgs,
        redacted,
      },
      exitCode,
      signal,
      termination,
      durationMs: Date.now() - started,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      truncated: {
        stdout: stdoutResult.truncated,
        stderr: stderrResult.truncated,
      },
      changed: {
        packageJson: false,
        lockfile: false,
        // Install may hydrate node_modules; without pre/post stat we report
        // conservatively for frozen success as dependencyTree possibly true.
        dependencyTree: operation === 'install' && ok,
      },
    });
  };

  const backend = {
    inspectWorkspace,

    /**
     * @param {InstallBackendInput} input
     * @returns {Promise<PackageCommandResult>}
     */
    async install(input) {
      const argv = buildInstallArgv({
        manager: input.manager,
        lockfileMode: input.lockfileMode,
        offline: input.offline,
        lifecycleScripts: input.lifecycleScripts,
        production: input.production,
        yarnMajorVersion: input.yarnMajorVersion,
      });
      const network = input.offline ? 'none' : installNetwork;
      if (network !== 'none' && network !== 'private') {
        throw makePackageManagerError(
          'policy-denied',
          `install network profile ${q(network)} is not allowed`,
        );
      }
      return runArgv({
        operation: 'install',
        argv: [...argv],
        manager: input.manager,
        displayPath: input.displayPath,
        workspaceName: input.workspaceName,
        segments: input.segments,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes,
        operationId: input.operationId,
        network,
      });
    },

    /**
     * @param {RunBackendInput} input
     * @returns {Promise<PackageCommandResult>}
     */
    async run(input) {
      const argv = buildRunArgv({
        manager: input.manager,
        script: input.script,
        args: input.args,
        workspaceName: input.workspaceName,
      });
      // Named scripts default to no network.
      return runArgv({
        operation: 'run',
        argv: [...argv],
        manager: input.manager,
        displayPath: input.displayPath,
        workspaceName: input.workspaceName,
        segments: input.segments,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes,
        operationId: input.operationId,
        network: 'none',
      });
    },

    /**
     * @param {string} operationId
     * @returns {Promise<boolean>}
     */
    async cancel(operationId) {
      const op = operations.get(operationId);
      if (op === undefined) {
        return false;
      }
      /** @type {any} */ (op).cancelled = true;
      await op.kill('SIGTERM');
      setTimeout(() => {
        void op.kill('SIGKILL');
      }, killGraceMs);
      return true;
    },

    async dispose() {
      for (const op of operations.values()) {
        // eslint-disable-next-line no-await-in-loop
        await op.kill('SIGKILL');
      }
      operations.clear();
      if (sandboxP !== undefined) {
        const sandbox = await sandboxP;
        if (sandbox.dispose) {
          await invoke(sandbox, 'dispose', []);
        }
      }
    },
  };

  return harden(backend);
};
harden(makeNativePackageManagerBackend);
