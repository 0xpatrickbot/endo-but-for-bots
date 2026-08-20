// @ts-check

/** @import { EndoMount } from '@endo/daemon' */
/** @import { GitRemote, ReadOnlyEndoGit, ReadWriteEndoGit } from '@endo/exo-git' */

import '@endo/init/debug.js';

import test from 'ava';

import { execFile } from 'node:child_process';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { E } from '@endo/eventual-send';

import {
  normalizeEndoProvisionSpec,
  provisionEndoGuest,
  reconstructEndoGuest,
} from '../provision.js';

import { makeProvisioningFixture } from './_provision-fixture.js';

const execFileAsync = promisify(execFile);

test.serial('daemon provisioning reconnects and survives restart', async t => {
  t.timeout(120_000);
  const fixture = await makeProvisioningFixture(t);
  const bareRemote = join(fixture.root, 'remote.git');
  await execFileAsync('git', ['init', '-q', '-b', 'main'], {
    cwd: fixture.workspace,
  });
  await execFileAsync('git', ['add', 'README.md'], {
    cwd: fixture.workspace,
  });
  await execFileAsync(
    'git',
    [
      '-c',
      'user.name=Provision Test',
      '-c',
      'user.email=provision@example.test',
      'commit',
      '-q',
      '-m',
      'initial',
    ],
    { cwd: fixture.workspace },
  );
  await execFileAsync('git', ['init', '--bare', '-q', bareRemote]);

  const host = await fixture.connectHost('provision-host');
  await E(host).makeDirectory(['tools']);
  const originalCalendar = await E(host).provideGuest(
    ['tools', 'calendar-handle'],
    { agentName: ['tools', 'calendar'] },
  );
  await E(originalCalendar).storeValue('original', 'value');
  const originalCalendarId = await E(host).identify('tools', 'calendar');
  const localRemote = fixture.trackSession(
    await provisionEndoGuest({
      scope: 'test',
      sessionId: 'local-remote',
      cwd: fixture.workspace,
      sockPath: fixture.sockPath,
      spec: {
        fs: 'readWrite',
        git: 'readWrite',
        gitRemotes: {
          origin: {
            url: new URL(`file://${bareRemote}`).href,
            allowedDirections: ['fetch', 'push'],
            fetchRefspecs: [
              'refs/heads/zeta:refs/remotes/origin/zeta',
              'refs/heads/main:refs/remotes/origin/main',
            ],
            defaultPullRef: 'refs/heads/main',
            allowedBranches: ['main'],
            allowLocalFileTransport: true,
          },
        },
        powers: {
          calendar: {
            from: ['tools', 'calendar'],
          },
        },
      },
    }),
  );
  t.true(Object.isFrozen(localRemote));
  t.true(Object.isFrozen(localRemote.persistence));

  const workspaceMount = /** @type {EndoMount} */ (
    await E(localRemote.guest).lookup('workspace')
  );
  t.is(await E(workspaceMount).readText('README.md'), 'initial\n');
  const localGit = /** @type {ReadWriteEndoGit} */ (
    await E(localRemote.guest).lookup('git')
  );
  await E(localGit).status();
  const origin = /** @type {GitRemote} */ (
    await E(localRemote.guest).lookup('origin')
  );
  const originPolicy = await E(origin).inspect();
  t.deepEqual(
    [...originPolicy.fetchRefspecs],
    [
      'refs/heads/zeta:refs/remotes/origin/zeta',
      'refs/heads/main:refs/remotes/origin/main',
    ],
  );
  t.is(originPolicy.defaultPullRef, 'refs/heads/main');
  const calendar = await E(localRemote.guest).lookup('calendar');
  t.is(await E(calendar).lookup('value'), 'original');

  const readOnlySession = fixture.trackSession(
    await provisionEndoGuest({
      scope: 'test',
      sessionId: 'read-only-git',
      cwd: fixture.workspace,
      sockPath: fixture.sockPath,
      spec: { git: 'readOnly' },
    }),
  );
  const readOnlyGit = /** @type {ReadOnlyEndoGit} */ (
    await E(readOnlySession.guest).lookup('git')
  );
  t.true(Array.isArray((await E(readOnlyGit).status()).entries));
  // eslint-disable-next-line no-underscore-dangle
  const readOnlyMethods = await E(
    /** @type {any} */ (readOnlyGit),
  ).__getMethodNames__();
  t.false(readOnlyMethods.includes('commit'));

  const controllerPath = localRemote.persistence.guestHandlePath.slice(0, -1);
  const controllerGrantId = await E(host).identify(
    ...controllerPath,
    'powers',
    'calendar',
  );
  t.is(controllerGrantId, originalCalendarId);
  const controllerWorkspaceId = await E(host).identify(
    ...controllerPath,
    'mounts',
    'workspace',
    'mount',
  );
  const guestGitId = await E(localRemote.guest).identify('git');
  t.is(
    await E(host).identify(...controllerPath, 'gits', 'git', 'git'),
    guestGitId,
  );
  t.truthy(controllerWorkspaceId);

  const answer = await E(localRemote.guest).evaluate(
    undefined,
    '40 + 2',
    [],
    [],
    ['answer'],
  );
  t.is(answer, 42);
  t.is(await E(localRemote.guest).lookup('answer'), 42);
  t.is(await E(host).identify('answer'), undefined);

  const reboundCalendar = await E(host).provideGuest(
    ['tools', 'calendar-rebound-handle'],
    { agentName: ['tools', 'calendar-rebound'] },
  );
  await E(reboundCalendar).storeValue('rebound', 'value');
  const reboundCalendarId = await E(host).identify('tools', 'calendar-rebound');
  await E(host).storeIdentifier(['tools', 'calendar'], reboundCalendarId);

  await localRemote.cleanup();
  const reconnected = fixture.trackSession(
    await reconstructEndoGuest({
      persistence: localRemote.persistence,
      sockPath: fixture.sockPath,
    }),
  );
  t.is(await E(reconnected.guest).identify('git'), guestGitId);
  t.is(await E(reconnected.guest).identify('calendar'), originalCalendarId);
  const reconnectedCalendar = await E(reconnected.guest).lookup('calendar');
  t.is(await E(reconnectedCalendar).lookup('value'), 'original');
  t.is(await E(reconnected.guest).lookup('answer'), 42);

  await fixture.restartDaemon();
  const restartedHost = await fixture.connectHost('provision-host-restart');
  const recovered = fixture.trackSession(
    await reconstructEndoGuest({
      persistence: localRemote.persistence,
      sockPath: fixture.sockPath,
    }),
  );
  t.is(await E(recovered.guest).identify('git'), guestGitId);
  t.is(await E(recovered.guest).identify('calendar'), originalCalendarId);
  const recoveredCalendar = await E(recovered.guest).lookup('calendar');
  t.is(await E(recoveredCalendar).lookup('value'), 'original');
  t.is(
    await E(restartedHost).identify(
      ...controllerPath,
      'mounts',
      'workspace',
      'mount',
    ),
    controllerWorkspaceId,
  );
  t.is(await E(recovered.guest).lookup('answer'), 42);
  const recoveredOrigin = /** @type {GitRemote} */ (
    await E(recovered.guest).lookup('origin')
  );
  t.is((await E(recoveredOrigin).inspect()).defaultPullRef, 'refs/heads/main');
});

test.serial(
  'a Git remote cannot substitute or expose the host persistence record',
  async t => {
    t.timeout(120_000);
    const fixture = await makeProvisioningFixture(t);
    const bareRemote = join(fixture.root, 'persistence-probe.git');
    await execFileAsync('git', ['init', '-q', '-b', 'main'], {
      cwd: fixture.workspace,
    });
    await execFileAsync('git', ['add', 'README.md'], {
      cwd: fixture.workspace,
    });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Provision Test',
        '-c',
        'user.email=provision@example.test',
        'commit',
        '-q',
        '-m',
        'initial',
      ],
      { cwd: fixture.workspace },
    );
    await execFileAsync('git', ['init', '--bare', '-q', bareRemote]);

    const host = await fixture.connectHost('persistence-probe-host');

    // A remote whose name collides with the host persistence sibling fails
    // closed at normalization; it never reaches realization where it could have
    // resolved to the stored record.
    await t.throwsAsync(
      () =>
        provisionEndoGuest({
          scope: 'test',
          sessionId: 'collide-persistence',
          cwd: fixture.workspace,
          sockPath: fixture.sockPath,
          spec: {
            fs: 'readWrite',
            git: 'readWrite',
            gitRemotes: {
              persistence: {
                url: new URL(`file://${bareRemote}`).href,
                allowLocalFileTransport: true,
              },
            },
          },
        }),
      { message: /non-reserved pet name/ },
    );

    // A legitimately named remote binds an actual GitRemote, not the trusted
    // persistence record, and the record stays out of the guest's reach.
    const session = fixture.trackSession(
      await provisionEndoGuest({
        scope: 'test',
        sessionId: 'persistence-probe',
        cwd: fixture.workspace,
        sockPath: fixture.sockPath,
        spec: {
          fs: 'readWrite',
          git: 'readWrite',
          gitRemotes: {
            origin: {
              url: new URL(`file://${bareRemote}`).href,
              allowLocalFileTransport: true,
            },
          },
        },
      }),
    );

    const origin = /** @type {GitRemote} */ (
      await E(session.guest).lookup('origin')
    );
    const originPolicy = await E(origin).inspect();
    t.is(originPolicy.url, new URL(`file://${bareRemote}`).href);
    // A GitRemote has no persistence-record fields.
    t.is(/** @type {any} */ (originPolicy).workspacePath, undefined);
    t.is(/** @type {any} */ (originPolicy).policy, undefined);

    // The guest holds no binding for the persistence record or any controller
    // infrastructure name, so no absolute host path or reconstruction record
    // is reachable through the guest.
    t.is(await E(session.guest).identify('persistence'), undefined);
    t.is(await E(session.guest).identify('remotes'), undefined);
    await t.throwsAsync(() => E(session.guest).lookup('persistence'));

    const controllerPath = session.persistence.guestHandlePath.slice(0, -1);
    // The remote is namespaced under its own container, a sibling of — never
    // the same path as — the persistence record.
    t.true(await E(host).has(...controllerPath, 'remotes', 'origin'));
    t.true(await E(host).has(...controllerPath, 'persistence'));
    t.false(await E(host).has(...controllerPath, 'origin'));
  },
);

test.serial(
  'daemon provisioning realizes a named Git grant through its selected mount',
  async t => {
    t.timeout(120_000);
    const fixture = await makeProvisioningFixture(t);
    const nestedPath = join(fixture.workspace, 'nested-repo');
    const nestedLink = join(fixture.workspace, 'nested-link');
    const outsidePath = join(fixture.root, 'outside-repo');
    await mkdir(nestedPath);
    await mkdir(outsidePath);
    await writeFile(join(nestedPath, 'inside.txt'), 'inside\n');
    await writeFile(join(outsidePath, 'outside.txt'), 'outside\n');
    await execFileAsync('git', ['init', '-q', '-b', 'main'], {
      cwd: nestedPath,
    });
    await execFileAsync('git', ['init', '-q', '-b', 'main'], {
      cwd: outsidePath,
    });
    await symlink(nestedPath, nestedLink, 'dir');

    const persistence = await normalizeEndoProvisionSpec(
      {
        mounts: {
          source: { path: fixture.workspace, mode: 'readWrite' },
        },
        gits: {
          nested: {
            mount: 'source',
            path: ['nested-link'],
            mode: 'readOnly',
          },
        },
      },
      {
        scope: 'test',
        sessionId: 'canonical-nested-host-realize',
        cwd: fixture.workspace,
      },
    );
    t.is(persistence.policy.gits?.nested.root, await realpath(nestedPath));
    t.is(persistence.policy.gits?.nested.mount, 'source');

    await rm(nestedLink, { force: true });
    await symlink(outsidePath, nestedLink, 'dir');

    const host = await fixture.connectHost('nested-git-host');
    const guest = await E(host).provision(persistence);
    const nestedGit = /** @type {ReadOnlyEndoGit} */ (
      await E(guest).lookup('nested')
    );
    const { entries: rows } = await E(nestedGit).status();
    t.deepEqual(
      rows.map(({ path }) => path),
      ['inside.txt'],
    );

    const controllerPath = persistence.guestHandlePath.slice(0, -1);
    t.true(await E(host).has(...controllerPath, 'gits', 'nested', 'git'));

    await fixture.restartDaemon();
    const recovered = fixture.trackSession(
      await reconstructEndoGuest({
        persistence,
        sockPath: fixture.sockPath,
      }),
    );
    const recoveredGit = /** @type {ReadOnlyEndoGit} */ (
      await E(recovered.guest).lookup('nested')
    );
    const { entries: recoveredRows } = await E(recoveredGit).status();
    t.deepEqual(
      recoveredRows.map(({ path }) => path),
      ['inside.txt'],
    );
  },
);

test.serial(
  'forked named powers retain the parent formula after source rebinding',
  async t => {
    t.timeout(120_000);
    const fixture = await makeProvisioningFixture(t);
    const host = await fixture.connectHost('fork-provision-host');
    await E(host).makeDirectory(['tools']);
    const original = await E(host).provideGuest(['tools', 'counter-handle'], {
      agentName: ['tools', 'counter'],
    });
    await E(original).storeValue('original', 'value');
    const parent = fixture.trackSession(
      await provisionEndoGuest({
        scope: 'test',
        sessionId: 'parent-session',
        cwd: fixture.workspace,
        sockPath: fixture.sockPath,
        spec: {
          powers: {
            counter: {
              from: ['tools', 'counter'],
            },
          },
        },
      }),
    );
    const parentControllerPath = parent.persistence.guestHandlePath.slice(
      0,
      -1,
    );
    const originalId = await E(host).identify(
      ...parentControllerPath,
      'powers',
      'counter',
    );
    const rebound = await E(host).provideGuest(
      ['tools', 'counter-rebound-handle'],
      { agentName: ['tools', 'counter-rebound'] },
    );
    await E(rebound).storeValue('rebound', 'value');
    const reboundId = await E(host).identify('tools', 'counter-rebound');
    await E(host).storeIdentifier(['tools', 'counter'], reboundId);

    const childPersistence = await normalizeEndoProvisionSpec(
      {
        powers: {
          counter: {
            from: ['tools', 'counter'],
          },
        },
      },
      { scope: 'test', sessionId: 'child-session', cwd: fixture.workspace },
    );
    const child = fixture.trackSession(
      await reconstructEndoGuest({
        persistence: childPersistence,
        forkFrom: parent.persistence,
        sockPath: fixture.sockPath,
      }),
    );
    const childControllerPath = child.persistence.guestHandlePath.slice(0, -1);
    const childControllerId = await E(host).identify(
      ...childControllerPath,
      'powers',
      'counter',
    );
    const childGuestId = await E(child.guest).identify('counter');

    t.notDeepEqual(
      child.persistence.guestHandlePath,
      parent.persistence.guestHandlePath,
    );
    t.is(childControllerId, originalId);
    t.is(childGuestId, originalId);
    t.not(childGuestId, reboundId);
    const childCounter = await E(child.guest).lookup('counter');
    t.is(await E(childCounter).lookup('value'), 'original');
  },
);
