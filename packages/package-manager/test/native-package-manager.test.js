// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';

import {
  makeNativePackageManagerBackend,
  redactArgv,
} from '../src/native-package-manager.js';
import { buildPackageManagerEnv } from '../src/env.js';

/**
 * Async iterable of UTF-8 text chunks.
 *
 * @param {string} text
 */
const textStream = text => {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
};

/**
 * @param {object} [opts]
 */
const makeFakeSandbox = (opts = {}) => {
  const {
    exitCode = 0,
    signal = null,
    stdout = 'installed\n',
    stderr = '',
    delayMs = 0,
    hang = false,
  } = opts;

  /** @type {object[]} */
  const spawns = [];
  /** @type {object[]} */
  const kills = [];

  // Do not harden the handle: tests need to mutate spawns/kills under SES.
  const handle = {
    spawns,
    kills,
    async spawn(argv, spawnOpts = {}) {
      spawns.push({ argv: [...argv], opts: { ...spawnOpts } });
      let killed = false;
      /** @type {(v: any) => void} */
      let resolveWait = () => {};
      const waitP = new Promise(resolve => {
        resolveWait = resolve;
      });

      if (!hang) {
        if (delayMs > 0) {
          setTimeout(() => {
            if (!killed) {
              resolveWait({ code: exitCode, signal });
            }
          }, delayMs);
        } else {
          queueMicrotask(() => {
            if (!killed) {
              resolveWait({ code: exitCode, signal });
            }
          });
        }
      }

      const proc = {
        async wait() {
          return waitP;
        },
        async kill(sig = 'SIGTERM') {
          killed = true;
          kills.push(sig);
          resolveWait({
            code: null,
            signal: typeof sig === 'string' ? sig : String(sig),
          });
        },
        stdout: () => textStream(stdout),
        stderr: () => textStream(stderr),
      };
      return proc;
    },
    async dispose() {},
  };
  return handle;
};

const makeReader = (files = {}) => {
  /** @type {Record<string, string>} */
  const map = { ...files };
  return harden({
    async readText(segments, name) {
      const key = [...segments, name].join('/');
      return map[key] ?? map[name];
    },
    async exists(segments, name) {
      const key = [...segments, name].join('/');
      return Object.prototype.hasOwnProperty.call(map, key) ||
        Object.prototype.hasOwnProperty.call(map, name);
    },
  });
};

test('redactArgv masks secret-looking option values', t => {
  const { args, redacted } = redactArgv([
    'npm',
    'config',
    'set',
    '//registry.npmjs.org/:_authToken=deadbeef',
  ]);
  t.true(redacted);
  t.true(args.some(a => a.includes('***')));
  t.false(args.some(a => a.includes('deadbeef')));
});

test('buildPackageManagerEnv refuses secret-looking keys', t => {
  t.throws(
    () => buildPackageManagerEnv({ extra: { NPM_TOKEN: 'x' } }),
    { message: /secret-looking/ },
  );
  const env = buildPackageManagerEnv({
    managerCacheEnv: { npm_config_cache: '/cache/npm' },
  });
  t.is(env.npm_config_cache, '/cache/npm');
  t.is(env.CI, '1');
  t.false(Object.prototype.hasOwnProperty.call(env, 'NPM_TOKEN'));
});

test('install uses fixed npm ci argv via fake sandbox (not host npm)', async t => {
  const sandbox = makeFakeSandbox({ stdout: 'ok\n' });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({
        name: 'fixture',
        scripts: { test: 'true' },
      }),
      'package-lock.json': '{}',
    }),
  });

  const snapshot = await backend.inspectWorkspace({
    segments: [],
    displayPath: '.',
  });
  t.true(snapshot.markers['package-lock.json']);

  const result = await backend.install({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    lockfileMode: 'frozen',
    offline: true,
    lifecycleScripts: 'disabled',
    production: false,
    timeoutMs: 5000,
    maxOutputBytes: 64_000,
  });

  t.true(result.ok);
  t.is(result.termination, 'exit');
  t.deepEqual(sandbox.spawns[0].argv, [
    'npm',
    'ci',
    '--ignore-scripts',
    '--offline',
  ]);
  t.is(sandbox.spawns[0].opts.network, 'none');
  t.false(
    JSON.stringify(result).includes('/home/'),
    'result must not leak host paths',
  );
});

test('install pnpm frozen-lockfile and yarn immutable argv', async t => {
  const sandbox = makeFakeSandbox();
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({ name: 'p' }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
    }),
  });
  await backend.install({
    manager: 'pnpm',
    segments: [],
    displayPath: '.',
    lockfileMode: 'frozen',
    offline: false,
    lifecycleScripts: 'disabled',
    production: false,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.deepEqual(sandbox.spawns[0].argv, [
    'pnpm',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  t.is(sandbox.spawns[0].opts.network, 'private');

  await backend.install({
    manager: 'yarn',
    segments: [],
    displayPath: '.',
    yarnMajorVersion: 4,
    lockfileMode: 'frozen',
    offline: false,
    lifecycleScripts: 'disabled',
    production: false,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.deepEqual(sandbox.spawns[1].argv, [
    'yarn',
    'install',
    '--immutable',
    '--mode=skip-builds',
  ]);
});

test('run uses plain named-script argv for single-package (no workspace flag from package name)', async t => {
  const sandbox = makeFakeSandbox({ stdout: 'lint ok\n' });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({
        name: 'pkg',
        scripts: { lint: 'eslint .' },
      }),
      'package-lock.json': '{}',
    }),
  });
  // packageName is metadata; must not become --workspace=
  const result = await backend.run({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    packageName: 'pkg',
    script: 'lint',
    args: [],
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.true(result.ok);
  t.deepEqual(sandbox.spawns[0].argv, ['npm', 'run', 'lint']);
  t.false(sandbox.spawns[0].argv.some(a => String(a).includes('--workspace')));
  t.is(sandbox.spawns[0].opts.network, 'none');
  // Result may still report package identity for audit.
  t.is(result.target.workspaceName, 'pkg');
});

test('run adds monorepo workspace selector only when workspaceSelector is set', async t => {
  const sandbox = makeFakeSandbox({ stdout: 'lint ok\n' });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({
        name: 'root',
        scripts: { lint: 'eslint .' },
      }),
      'package-lock.json': '{}',
    }),
  });
  const result = await backend.run({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    packageName: 'root',
    workspaceSelector: '@scope/pkg',
    script: 'lint',
    args: [],
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.true(result.ok);
  t.deepEqual(sandbox.spawns[0].argv, [
    'npm',
    'run',
    'lint',
    '--workspace=@scope/pkg',
  ]);
});

test('non-zero exit is a result not a setup throw', async t => {
  const sandbox = makeFakeSandbox({ exitCode: 7, stderr: 'boom\n' });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({ scripts: { test: 'false' } }),
      'package-lock.json': '{}',
    }),
  });
  const result = await backend.run({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    script: 'test',
    args: [],
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.false(result.ok);
  t.is(result.exitCode, 7);
  t.is(result.termination, 'exit');
  t.regex(result.stderr, /boom/);
});

test('cancel marks in-flight operation cancelled', async t => {
  const sandbox = makeFakeSandbox({ hang: true, stdout: '' });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({ scripts: { sleep: 'sleep 100' } }),
      'package-lock.json': '{}',
    }),
    killGraceMs: 10,
  });

  const runP = backend.run({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    script: 'sleep',
    args: [],
    timeoutMs: 60_000,
    maxOutputBytes: 1000,
    operationId: 'cancel-me',
  });

  // Allow spawn to register the operation.
  await new Promise(r => setTimeout(r, 20));
  const cancelled = await backend.cancel('cancel-me');
  t.true(cancelled);
  const result = await runP;
  t.is(result.termination, 'cancelled');
  t.true(sandbox.kills.length > 0);
});

test('timeout yields termination timeout', async t => {
  const sandbox = makeFakeSandbox({ hang: true });
  const backend = makeNativePackageManagerBackend({
    sandbox,
    workspaceReader: makeReader({
      'package.json': JSON.stringify({ scripts: { sleep: 'sleep 100' } }),
      'package-lock.json': '{}',
    }),
    killGraceMs: 5,
  });
  const result = await backend.run({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    script: 'sleep',
    args: [],
    timeoutMs: 30,
    maxOutputBytes: 1000,
    operationId: 'timeout-me',
  });
  t.is(result.termination, 'timeout');
  t.false(result.ok);
});

test('sandboxFactory.make is used when no pre-made sandbox', async t => {
  const sandbox = makeFakeSandbox();
  /** @type {object[]} */
  const makes = [];
  const factory = {
    async make(opts) {
      makes.push(opts);
      return sandbox;
    },
  };
  const backend = makeNativePackageManagerBackend({
    sandboxFactory: factory,
    sandboxMakeOpts: {
      rootfs: { kind: 'minimal' },
      network: 'none',
      cwd: '/workspace',
    },
    workspaceReader: makeReader({
      'package.json': JSON.stringify({ name: 'x' }),
      'package-lock.json': '{}',
    }),
  });
  await backend.install({
    manager: 'npm',
    segments: [],
    displayPath: '.',
    lockfileMode: 'frozen',
    offline: true,
    lifecycleScripts: 'disabled',
    production: false,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
  });
  t.is(makes.length, 1);
  t.deepEqual(sandbox.spawns[0].argv.slice(0, 2), ['npm', 'ci']);
});
