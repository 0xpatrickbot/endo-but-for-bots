// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';

import {
  getPackageManagerErrorCode,
  getPackageManagerErrorDetails,
} from '../src/errors.js';
import {
  hasFrozenLockfile,
  managersFromMarkers,
  parsePackageManagerField,
  selectManager,
} from '../src/detect.js';

test('parsePackageManagerField accepts Corepack name@version', t => {
  t.deepEqual(parsePackageManagerField('pnpm@9.15.0'), {
    manager: 'pnpm',
    version: '9.15.0',
  });
  t.deepEqual(parsePackageManagerField('yarn@4.6.0'), {
    manager: 'yarn',
    version: '4.6.0',
  });
  t.deepEqual(parsePackageManagerField('npm'), { manager: 'npm' });
  t.is(parsePackageManagerField('bun@1.0.0'), undefined);
  t.is(parsePackageManagerField(undefined), undefined);
});

test('managersFromMarkers maps lockfile families', t => {
  t.deepEqual(managersFromMarkers(['package-lock.json']), ['npm']);
  t.deepEqual(managersFromMarkers(['pnpm-lock.yaml']), ['pnpm']);
  t.deepEqual(managersFromMarkers(['yarn.lock', '.yarnrc.yml']), ['yarn']);
  t.deepEqual(
    managersFromMarkers({
      'package-lock.json': true,
      'pnpm-lock.yaml': true,
    }),
    ['npm', 'pnpm'],
  );
});

test('selectManager prefers explicit then manifest then lockfile', t => {
  t.like(
    selectManager({
      explicit: 'npm',
      markers: ['package-lock.json'],
    }),
    { manager: 'npm', source: 'explicit' },
  );
  t.like(
    selectManager({
      packageManagerField: 'pnpm@9.0.0',
      markers: ['pnpm-lock.yaml'],
    }),
    { manager: 'pnpm', source: 'manifest', versionRequest: '9.0.0' },
  );
  t.like(
    selectManager({ markers: ['yarn.lock'] }),
    { manager: 'yarn', source: 'lockfile' },
  );
  t.like(
    selectManager({ defaultManager: 'npm' }),
    { manager: 'npm', source: 'default' },
  );
});

test('selectManager throws manager-undetected without evidence', t => {
  const err = t.throws(() => selectManager({ markers: [] }));
  t.is(getPackageManagerErrorCode(err), 'manager-undetected');
  t.regex(/** @type {Error} */ (err).message, /manager-undetected/);
});

test('selectManager throws manager-ambiguous for multi-lockfile auto', t => {
  const err = t.throws(() =>
    selectManager({
      markers: ['package-lock.json', 'yarn.lock'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-ambiguous');
  t.deepEqual(getPackageManagerErrorDetails(err)?.candidates, ['npm', 'yarn']);
});

test('selectManager throws manager-mismatch for explicit vs lockfile', t => {
  const err = t.throws(() =>
    selectManager({
      explicit: 'npm',
      markers: ['pnpm-lock.yaml'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-mismatch');
});

test('selectManager throws manager-mismatch for explicit vs multi-lockfile', t => {
  const err = t.throws(() =>
    selectManager({
      explicit: 'npm',
      markers: ['package-lock.json', 'pnpm-lock.yaml'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-mismatch');
});

test('selectManager throws manager-mismatch for manifest vs lockfile', t => {
  const err = t.throws(() =>
    selectManager({
      packageManagerField: 'yarn@1.22.0',
      markers: ['package-lock.json'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-mismatch');
});

test('selectManager throws manager-mismatch for explicit vs packageManager', t => {
  const err = t.throws(() =>
    selectManager({
      explicit: 'npm',
      packageManagerField: 'pnpm@9.0.0',
      markers: ['package-lock.json'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-mismatch');
});

test('selectManager respects allowedManagers policy', t => {
  const err = t.throws(() =>
    selectManager({
      explicit: 'npm',
      markers: ['package-lock.json'],
      allowedManagers: ['pnpm'],
    }),
  );
  t.is(getPackageManagerErrorCode(err), 'manager-mismatch');
});

test('hasFrozenLockfile distinguishes install lockfiles from workspace markers', t => {
  t.true(hasFrozenLockfile('npm', ['package-lock.json']));
  t.true(hasFrozenLockfile('pnpm', ['pnpm-lock.yaml']));
  t.false(hasFrozenLockfile('pnpm', ['pnpm-workspace.yaml']));
  t.true(hasFrozenLockfile('yarn', ['yarn.lock']));
  t.false(hasFrozenLockfile('yarn', ['.yarnrc.yml']));
});
