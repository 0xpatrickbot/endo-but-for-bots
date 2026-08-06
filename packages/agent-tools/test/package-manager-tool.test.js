// @ts-check
/// <reference types="ses"/>

// eslint-disable-next-line import/order
import '@endo/init/debug.js';

import test from 'ava';
import { Far } from '@endo/pass-style';
import { makePackageManager } from '@endo/exo-package-manager';

import { makePackageManagerTools } from '../src/json-tools/package-manager.js';

const LINEAGE = harden({});

const makeFakeBackend = () => {
  /** @type {object[]} */
  const installCalls = [];
  /** @type {object[]} */
  const runCalls = [];
  /** @type {string[]} */
  const cancelCalls = [];

  // Leave the backend unhardened so test doubles can record calls under SES.
  return {
    installCalls,
    runCalls,
    cancelCalls,
    async inspectWorkspace({ displayPath }) {
      return harden({
        markers: { 'package-lock.json': true },
        scriptNames: ['lint', 'test'],
        packageName: 'fixture',
        displayPath,
      });
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
          args: ['npm', 'ci'],
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
      return harden({
        ok: true,
        operation: 'run',
        manager: input.manager,
        target: { displayPath: input.displayPath },
        command: {
          operation: 'run',
          manager: input.manager,
          args: ['npm', 'run', input.script],
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
      return true;
    },
  };
};

const makeMount = () => {
  /** @type {string[][]} */
  const entries = [];
  const mount = Far('EndoMount', {
    entry: async segments => {
      entries.push([...segments]);
      return Far('EndoMountEntry', {
        segments: async () => segments,
      });
    },
  });
  // Tracking lives outside the Far so pass-style stays method-only.
  return { mount, entries };
};

test('full capability exposes install/run plus detect/list tools', t => {
  const backend = makeFakeBackend();
  const { mount } = makeMount();
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: () => LINEAGE,
  });
  const tools = makePackageManagerTools(pm, { mount });
  const names = tools.map(tool => tool.name);
  t.deepEqual(names, [
    'detectPackageManager',
    'listPackageScripts',
    'installDependencies',
    'runPackageScript',
  ]);
  // Schemas must not advertise host path fields.
  for (const tool of tools) {
    const schema = /** @type {any} */ (tool.parameters);
    t.false(
      JSON.stringify(schema).includes('/home/'),
      `${tool.name} schema must not include host paths`,
    );
  }
});

test('read-only capability omits write tools', t => {
  const backend = makeFakeBackend();
  const { mount } = makeMount();
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: () => LINEAGE,
  });
  const tools = makePackageManagerTools(pm.readOnly(), { mount });
  const names = tools.map(tool => tool.name);
  t.deepEqual(names, ['detectPackageManager', 'listPackageScripts']);
  t.false(names.includes('installDependencies'));
  t.false(names.includes('runPackageScript'));
});

test('installDependencies resolves cwd through mount issuer', async t => {
  const backend = makeFakeBackend();
  const { mount, entries } = makeMount();
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: () => LINEAGE,
  });
  const tools = makePackageManagerTools(pm, { mount });
  const install = tools.find(tool => tool.name === 'installDependencies');
  t.truthy(install);
  const result = await install.invoke({
    cwd: 'packages/fixture',
    offline: true,
  });
  t.true(/** @type {any} */ (result).ok);
  t.deepEqual(entries, [['packages', 'fixture']]);
  t.is(backend.installCalls[0].displayPath, 'packages/fixture');
  t.true(backend.installCalls[0].offline);
});

test('runPackageScript bridges abort signal to cancel', async t => {
  const backend = makeFakeBackend();
  const { mount } = makeMount();
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: () => LINEAGE,
  });
  const tools = makePackageManagerTools(pm, { mount });
  const run = tools.find(tool => tool.name === 'runPackageScript');
  t.truthy(run);

  const controller = new AbortController();
  // Abort before invoke settles so the bridge fires cancel.
  const invokeP = run.invoke({ script: 'lint' }, { signal: controller.signal });
  controller.abort();
  await invokeP;
  t.true(backend.cancelCalls.length >= 1);
  t.true(backend.cancelCalls[0].startsWith('pm-'));
  t.is(backend.runCalls[0].script, 'lint');
  t.true(typeof backend.runCalls[0].operationId === 'string');
});

test('detectPackageManager returns structured detection', async t => {
  const backend = makeFakeBackend();
  const { mount } = makeMount();
  const pm = makePackageManager({
    mount,
    backend,
    lineageOf: () => LINEAGE,
  });
  const tools = makePackageManagerTools(pm, { mount });
  const detect = tools.find(tool => tool.name === 'detectPackageManager');
  const result = await detect.invoke({});
  t.is(/** @type {any} */ (result).manager, 'npm');
});
