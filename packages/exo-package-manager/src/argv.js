// @ts-check
/// <reference types="ses"/>

/**
 * @typedef {'npm' | 'pnpm' | 'yarn'} PackageManagerName
 * @typedef {'frozen' | 'update'} LockfileMode
 * @typedef {'disabled' | 'enabled'} LifecycleScriptsMode
 */

/**
 * @typedef {object} InstallArgvInput
 * @property {PackageManagerName} manager
 * @property {LockfileMode} [lockfileMode]
 * @property {boolean} [offline]
 * @property {LifecycleScriptsMode} [lifecycleScripts]
 * @property {boolean} [production]
 * @property {number} [yarnMajorVersion] Yarn major (1 vs 2+); default 2.
 */

/**
 * @typedef {object} RunArgvInput
 * @property {PackageManagerName} manager
 * @property {string} script
 * @property {string[]} [args]
 * @property {string} [workspaceName]
 */

/**
 * Build fixed install argv for the selected manager. Never accepts free-form
 * manager flags; every option maps to a known flag.
 *
 * @param {InstallArgvInput} input
 * @returns {string[]}
 */
export const buildInstallArgv = input => {
  const {
    manager,
    lockfileMode = 'frozen',
    offline = false,
    lifecycleScripts = 'disabled',
    production = false,
    yarnMajorVersion = 2,
  } = input;

  /** @type {string[]} */
  const argv = [manager];

  if (manager === 'npm') {
    argv.push(lockfileMode === 'frozen' ? 'ci' : 'install');
    if (lifecycleScripts === 'disabled') {
      argv.push('--ignore-scripts');
    }
    if (offline) {
      argv.push('--offline');
    }
    if (production) {
      argv.push('--omit=dev');
    }
    return harden(argv);
  }

  if (manager === 'pnpm') {
    argv.push('install');
    if (lockfileMode === 'frozen') {
      argv.push('--frozen-lockfile');
    }
    if (lifecycleScripts === 'disabled') {
      argv.push('--ignore-scripts');
    }
    if (offline) {
      argv.push('--offline');
    }
    if (production) {
      argv.push('--prod');
    }
    return harden(argv);
  }

  // yarn
  argv.push('install');
  if (lockfileMode === 'frozen') {
    if (yarnMajorVersion <= 1) {
      argv.push('--frozen-lockfile');
    } else {
      argv.push('--immutable');
    }
  }
  if (lifecycleScripts === 'disabled') {
    if (yarnMajorVersion <= 1) {
      argv.push('--ignore-scripts');
    } else {
      argv.push('--mode=skip-builds');
    }
  }
  if (offline) {
    // Yarn Berry: --offline; Yarn 1 also accepts --offline.
    argv.push('--offline');
  }
  if (production) {
    argv.push('--production');
  }
  return harden(argv);
};
harden(buildInstallArgv);

/**
 * Build fixed named-script run argv. `args` are individual argv elements
 * after `--` where the manager requires it. Never accepts arbitrary
 * package-manager subcommands or a shell string.
 *
 * @param {RunArgvInput} input
 * @returns {string[]}
 */
export const buildRunArgv = input => {
  const { manager, script, args = [], workspaceName } = input;
  if (typeof script !== 'string' || script.length === 0) {
    throw new Error('buildRunArgv requires a non-empty script name');
  }

  /** @type {string[]} */
  const argv = [manager];

  if (manager === 'npm') {
    argv.push('run', script);
    if (workspaceName !== undefined) {
      argv.push(`--workspace=${workspaceName}`);
    }
    if (args.length > 0) {
      argv.push('--', ...args);
    }
    return harden(argv);
  }

  if (manager === 'pnpm') {
    if (workspaceName !== undefined) {
      argv.push(`--filter=${workspaceName}`);
    }
    argv.push('run', script);
    if (args.length > 0) {
      argv.push('--', ...args);
    }
    return harden(argv);
  }

  // yarn
  if (workspaceName !== undefined) {
    argv.push('workspace', workspaceName);
  }
  argv.push('run', script);
  if (args.length > 0) {
    // Yarn passes script args directly; no `--` separator required.
    argv.push(...args);
  }
  return harden(argv);
};
harden(buildRunArgv);
