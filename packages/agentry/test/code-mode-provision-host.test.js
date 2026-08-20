// @ts-check

/** @import { EndoGuest, EndoHost } from '@endo/daemon' */

import test from '@endo/ses-ava/prepare-endo.js';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeEndoProvisionSpec } from '../src/code-mode-provision-policy.js';
import {
  EndoCredentialUnavailableError,
  realizeEndoProvisionOnHost,
} from '../src/code-mode-provision-host.js';
import { provisionedGuestAuthorityOf } from '../src/code-mode-grants.js';

/**
 * The host adapter only needs the daemon host's `provision` exo method; all
 * realization internals (alias pinning, retained-policy checks, recovery)
 * are daemon-owned and covered by the daemon's own tests.
 *
 * @param {{ provision?: (persistence: unknown, forkOptions?: unknown) => Promise<unknown> }} [overrides]
 */
const makeHost = (overrides = {}) => {
  /** @type {Array<{ persistence: any, forkOptions: any }>} */
  const provisionCalls = [];
  const guest = /** @type {EndoGuest} */ (
    /** @type {unknown} */ (harden({ fake: 'guest' }))
  );
  const host = /** @type {EndoHost} */ (
    /** @type {unknown} */ ({
      provision: async (persistence, forkOptions) => {
        provisionCalls.push({ persistence, forkOptions });
        return guest;
      },
      ...overrides,
    })
  );
  return { host, guest, provisionCalls };
};

/** @param {import('ava').ExecutionContext} t */
const makeWorkspace = async t => {
  const root = await mkdtemp(join(tmpdir(), 'endo-provision-host-'));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('provision projects daemon policy and registers the returned guest', async t => {
  const root = await makeWorkspace(t);
  const fixture = makeHost();
  const persistence = await normalizeEndoProvisionSpec(
    {
      grants: {
        calendar: {
          from: ['tools', 'calendar'],
          description: 'A calendar service',
        },
      },
    },
    { harness: 'test', sessionId: 'pinned-grant', cwd: root },
  );

  const guest = await realizeEndoProvisionOnHost(fixture.host, persistence);

  t.is(guest, fixture.guest);
  t.not(provisionedGuestAuthorityOf(guest), undefined);
  t.is(fixture.provisionCalls.length, 1);
  const [{ persistence: daemonPersistence, forkOptions }] =
    fixture.provisionCalls;
  t.is(forkOptions, undefined);
  t.is(daemonPersistence.version, 1);
  t.deepEqual(daemonPersistence.guestHandlePath, persistence.guestHandlePath);
  t.deepEqual(daemonPersistence.policy.powers, {
    calendar: { from: ['tools', 'calendar'] },
  });
  // Code-mode prompt context never enters the daemon policy record.
  t.false(Object.hasOwn(daemonPersistence.policy, 'grants'));
  t.false(Object.hasOwn(daemonPersistence.policy, 'piTools'));
});

test('fork options project the parent record and pin session context', async t => {
  const root = await makeWorkspace(t);
  const fixture = makeHost();
  const spec = {
    grants: {
      calendar: {
        from: ['tools', 'calendar'],
        description: 'A calendar service',
      },
    },
  };
  const parent = await normalizeEndoProvisionSpec(spec, {
    harness: 'test',
    sessionId: 'fork-parent',
    cwd: root,
  });
  const child = await normalizeEndoProvisionSpec(spec, {
    harness: 'test',
    sessionId: 'fork-child',
    cwd: root,
  });

  await realizeEndoProvisionOnHost(fixture.host, child, { forkFrom: parent });
  t.is(fixture.provisionCalls.length, 1);
  const [{ forkOptions }] = fixture.provisionCalls;
  t.is(forkOptions.forkFrom.version, 1);
  t.deepEqual(forkOptions.forkFrom.guestHandlePath, parent.guestHandlePath);

  const reContexted = await normalizeEndoProvisionSpec(
    {
      grants: {
        calendar: {
          from: ['tools', 'calendar'],
          description: 'A different prompt context',
        },
      },
    },
    { harness: 'test', sessionId: 'fork-parent', cwd: root },
  );
  await t.throwsAsync(
    () =>
      realizeEndoProvisionOnHost(fixture.host, child, {
        forkFrom: reContexted,
      }),
    { message: /different session context/ },
  );
});

test('in-process credential failures keep their class identity', async t => {
  const root = await makeWorkspace(t);
  const failure = new EndoCredentialUnavailableError('origin', [
    'credentials',
    'origin',
  ]);
  const fixture = makeHost({
    provision: async () => {
      throw failure;
    },
  });
  const persistence = await normalizeEndoProvisionSpec(undefined, {
    harness: 'test',
    sessionId: 'in-process-credential',
    cwd: root,
  });

  const error = await t.throwsAsync(
    () => realizeEndoProvisionOnHost(fixture.host, persistence),
    { instanceOf: EndoCredentialUnavailableError },
  );
  // Eventual send to an in-process host delivers the original error object.
  t.is(error, failure);
  t.is(/** @type {any} */ (error).remoteName, 'origin');
});

test('marshalled credential failures are re-branded by sentinel', async t => {
  const root = await makeWorkspace(t);
  // A rejection that crossed CapTP arrives as a plain Error carrying only
  // the message; the adapter restores class identity and the error code.
  const marshalled = Error(
    'Git credential ["credentials","origin"] for remote "origin" is unavailable; reprovision the credential on the host and retry',
  );
  const fixture = makeHost({
    provision: async () => {
      throw marshalled;
    },
  });
  const persistence = await normalizeEndoProvisionSpec(undefined, {
    harness: 'test',
    sessionId: 'marshalled-credential',
    cwd: root,
  });

  const error = await t.throwsAsync(
    () => realizeEndoProvisionOnHost(fixture.host, persistence),
    { instanceOf: EndoCredentialUnavailableError },
  );
  t.is(/** @type {any} */ (error).code, 'ENDO_CREDENTIAL_UNAVAILABLE');
  t.is(error?.message, marshalled.message);

  // Unrelated failures pass through untouched.
  const unrelated = Error('daemon rejected the record');
  const failing = makeHost({
    provision: async () => {
      throw unrelated;
    },
  });
  const passedThrough = await t.throwsAsync(() =>
    realizeEndoProvisionOnHost(failing.host, persistence),
  );
  t.is(passedThrough, unrelated);
});
