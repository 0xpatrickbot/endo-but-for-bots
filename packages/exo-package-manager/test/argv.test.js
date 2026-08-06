// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';

import { buildInstallArgv, buildRunArgv } from '../src/argv.js';

test('buildInstallArgv npm frozen uses ci and ignore-scripts by default', t => {
  t.deepEqual(buildInstallArgv({ manager: 'npm' }), [
    'npm',
    'ci',
    '--ignore-scripts',
  ]);
  t.deepEqual(
    buildInstallArgv({
      manager: 'npm',
      lockfileMode: 'update',
      offline: true,
      production: true,
      lifecycleScripts: 'enabled',
    }),
    ['npm', 'install', '--offline', '--omit=dev'],
  );
});

test('buildInstallArgv pnpm frozen uses --frozen-lockfile', t => {
  t.deepEqual(buildInstallArgv({ manager: 'pnpm' }), [
    'pnpm',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  t.deepEqual(
    buildInstallArgv({
      manager: 'pnpm',
      lockfileMode: 'update',
      offline: true,
      production: true,
    }),
    ['pnpm', 'install', '--ignore-scripts', '--offline', '--prod'],
  );
});

test('buildInstallArgv yarn uses version-appropriate frozen flags', t => {
  t.deepEqual(buildInstallArgv({ manager: 'yarn', yarnMajorVersion: 1 }), [
    'yarn',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  t.deepEqual(buildInstallArgv({ manager: 'yarn', yarnMajorVersion: 4 }), [
    'yarn',
    'install',
    '--immutable',
    '--mode=skip-builds',
  ]);
});

test('buildRunArgv maps workspace selectors per manager', t => {
  t.deepEqual(
    buildRunArgv({ manager: 'npm', script: 'test', args: ['--watch'] }),
    ['npm', 'run', 'test', '--', '--watch'],
  );
  t.deepEqual(
    buildRunArgv({
      manager: 'npm',
      script: 'lint',
      workspaceName: '@scope/pkg',
    }),
    ['npm', 'run', 'lint', '--workspace=@scope/pkg'],
  );
  t.deepEqual(
    buildRunArgv({
      manager: 'pnpm',
      script: 'test',
      workspaceName: 'pkg',
      args: ['a'],
    }),
    ['pnpm', '--filter=pkg', 'run', 'test', '--', 'a'],
  );
  t.deepEqual(
    buildRunArgv({
      manager: 'yarn',
      script: 'build',
      workspaceName: 'pkg',
      args: ['--mode', 'production'],
    }),
    ['yarn', 'workspace', 'pkg', 'run', 'build', '--mode', 'production'],
  );
});
