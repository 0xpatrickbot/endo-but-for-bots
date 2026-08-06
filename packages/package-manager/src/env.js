// @ts-check
/// <reference types="ses"/>

/**
 * Build the explicit child environment allowlist for a package-manager
 * sandbox slice. Never inherits NPM_TOKEN, SSH_AUTH_SOCK, cloud keys, or
 * ambient ENDO_* values from the worker.
 *
 * @param {object} opts
 * @param {string} [opts.homeInnerPath] Inner HOME path (scratch).
 * @param {string} [opts.tmpInnerPath] Inner TMPDIR path (scratch).
 * @param {string} [opts.pathValue] PATH inside the rootfs.
 * @param {Record<string, string>} [opts.managerCacheEnv] Manager-specific cache vars.
 * @param {Record<string, string>} [opts.extra] Host-policy extras (proxy, CA paths).
 * @returns {Record<string, string>}
 */
export const buildPackageManagerEnv = (opts = {}) => {
  const {
    homeInnerPath = '/scratch/home',
    tmpInnerPath = '/scratch/tmp',
    pathValue = '/usr/local/bin:/usr/bin:/bin',
    managerCacheEnv = {},
    extra = {},
  } = opts;

  /** @type {Record<string, string>} */
  const env = {
    PATH: pathValue,
    HOME: homeInnerPath,
    TMPDIR: tmpInnerPath,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    CI: '1',
    // Discourage interactive prompts.
    npm_config_yes: 'true',
  };

  for (const [k, v] of Object.entries(managerCacheEnv)) {
    if (typeof k === 'string' && typeof v === 'string') {
      env[k] = v;
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    if (typeof k === 'string' && typeof v === 'string') {
      // Refuse secret-looking keys even if a host policy tries to inject them
      // as ordinary guest env (credentials must use a capability-safe channel).
      if (/token|password|secret|auth|credential/i.test(k)) {
        throw new Error(
          `package-manager env refuses secret-looking key ${k}`,
        );
      }
      env[k] = v;
    }
  }
  return harden(env);
};
harden(buildPackageManagerEnv);
