// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';
import { Far } from '@endo/pass-style';

import { makePackageManager } from '../src/package-manager.js';

const LINEAGE = harden({});

/**
 * @param {object} [snapshot]
 */
const makeFakeBackend = (snapshot = {}) => {
  // Tracking arrays stay mutable and outside harden() so SES cannot freeze them.
  /** @type {object[]} */
  const installCalls = [];
  /** @type {object[]} */
  const runCalls = [];
  /** @type {string[]} */
  const cancelCalls = [];
  /** @type {Map<string, { cancel: () => void }>} */
  const ops = new Map();

  const defaultSnapshot = {
    packageManagerField: undefined,
    markers: { 'package-lock.json': true },
    scriptNames: ['lint', 'test'],
    workspaceName: undefined,
    yarnMajorVersion: 2,
    ...snapshot,
  };

  const backend = {
    installCalls,
    runCalls,
    cancelCalls,
    ops,
    async inspectWorkspace() {
      return harden({ ...defaultSnapshot });
    },
    async install(input) {
      installCalls.push(input);
      return harden({
        ok: true,
        operation: 'install',
        manager: input.manager,
        target: { displayPath: input.displayPath },
        command: {
          operation: 'install',
          manager: input.manager,
          args: [input.manager, 'ci'],
          redacted: false,
        },
        exitCode: 0,
        signal: null,
        termination: 'exit',
        durationMs: 1,
        stdout: '',
        stderr: '',
        truncated: { stdout: false, stderr: false },
        changed: {
          packageJson: false,
          lockfile: false,
          dependencyTree: true,
        },
      });
    },
    async run(input) {
      runCalls.push(input);
      if (input.operationId) {
        ops.set(input.operationId, { cancel: () => {} });
      }
      return harden({
        ok: true,
        operation: 'run',
        manager: input.manager,
        target: { displayPath: input.displayPath },
        command: {
          operation: 'run',
          manager: input.manager,
          args: [input.manager, 'run', input.script],
          redacted: false,
        },
        exitCode: 0,
        signal: null,
        termination: 'exit',
        durationMs: 1,
        stdout: 'ok',
        stderr: '',
        truncated: { stdout: false, stderr: false },
        changed: {
          packageJson: false,
          lockfile: false,
          dependencyTree: false,
        },
      });
    },
    async cancel(operationId) {
      cancelCalls.push(operationId);
      return ops.has(operationId);
    },
  };
  return backend;
};

const makeMount = () => {
  const mount = Far('EndoMount', {
    entry: async segments =>
      Far('EndoMountEntry', {
        segments: async () => segments,
      }),
  });
  return mount;
};

const lineageOf = value => {
  if (value === undefined || value === null) return undefined;
  return LINEAGE;
};

test('detect selects npm from lockfile via shipped makePackageManager', async t => {
  const backend = makeFakeBackend();
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  const detection = await pm.detect();
  t.is(detection.manager, 'npm');
  t.is(detection.source, 'lockfile');
  t.true(detection.hasFrozenLockfile);
});

test('scripts lists declared names only', async t => {
  const backend = makeFakeBackend({ scriptNames: ['lint', 'test', 'build'] });
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  const scripts = await pm.scripts();
  t.deepEqual(scripts.scriptNames, ['lint', 'test', 'build']);
  t.is(scripts.manager, 'npm');
});

test('install rejects update without policy and missing lockfile for frozen', async t => {
  const backend = makeFakeBackend({ markers: {} });
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    policy: harden({ defaultManager: 'npm' }),
    lineageOf,
  });
  await t.throwsAsync(pm.install({ lockfileMode: 'update' }), {
    message: /policy-denied/,
  });
  await t.throwsAsync(pm.install({ lockfileMode: 'frozen' }), {
    message: /lockfile-missing/,
  });
});

test('install rejects lifecycleScripts enabled without policy', async t => {
  const backend = makeFakeBackend();
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  await t.throwsAsync(pm.install({ lifecycleScripts: 'enabled' }), {
    message: /policy-denied/,
  });
});

test('install forwards frozen default to backend', async t => {
  const backend = makeFakeBackend();
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  const result = await pm.install({});
  t.true(result.ok);
  t.is(backend.installCalls.length, 1);
  t.is(backend.installCalls[0].lockfileMode, 'frozen');
  t.is(backend.installCalls[0].manager, 'npm');
  t.is(backend.installCalls[0].lifecycleScripts, 'disabled');
});

test('run rejects undeclared scripts before backend', async t => {
  const backend = makeFakeBackend({ scriptNames: ['lint'] });
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  await t.throwsAsync(pm.run({ script: 'test' }), {
    message: /script-not-declared/,
  });
  t.is(backend.runCalls.length, 0);
});

test('run accepts declared scripts', async t => {
  const backend = makeFakeBackend();
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  const result = await pm.run({ script: 'lint', args: ['--fix'] });
  t.true(result.ok);
  t.is(backend.runCalls[0].script, 'lint');
  t.deepEqual(backend.runCalls[0].args, ['--fix']);
});

test('readOnly keeps metadata and fails closed on mutators', async t => {
  const backend = makeFakeBackend();
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  const ro = pm.readOnly();
  t.regex(ro.help(), /EndoPackageManager/);
  t.is((await ro.detect()).manager, 'npm');
  t.deepEqual((await ro.scripts()).scriptNames, ['lint', 'test']);
  await t.throwsAsync(ro.install({}), { message: /read-only/ });
  await t.throwsAsync(ro.run({ script: 'lint' }), { message: /read-only/ });
  await t.throwsAsync(ro.cancel('op-1'), { message: /read-only/ });
  t.is(backend.installCalls.length, 0);
  t.is(backend.runCalls.length, 0);
});

test('foreign cwd fails workspace-invalid before backend install', async t => {
  const backend = makeFakeBackend();
  const otherLineage = harden({});
  const mount = makeMount();
  const foreign = Far('ForeignEntry', {
    segments: async () => ['pkg'],
  });
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: value => {
      if (value === foreign) return otherLineage;
      if (value === mount) return LINEAGE;
      return LINEAGE;
    },
  });
  // Override lineageOf so mount has LINEAGE but foreign has otherLineage
  const pm2 = makePackageManager({
    mount,
    backend,
    lineageOf: value => {
      if (value === foreign) return otherLineage;
      return LINEAGE;
    },
  });
  await t.throwsAsync(pm2.install({ cwd: foreign }), {
    message: /workspace-invalid/,
  });
  t.is(backend.installCalls.length, 0);
});

test('cancel delegates to backend', async t => {
  const backend = makeFakeBackend();
  backend.ops.set('op-9', { cancel: () => {} });
  const pm = makePackageManager({
    mount: makeMount(),
    backend,
    lineageOf,
  });
  t.true(await pm.cancel('op-9'));
  t.deepEqual(backend.cancelCalls, ['op-9']);
});
