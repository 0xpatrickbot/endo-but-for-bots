// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { gitClone, makeNativeGitBackend } from '../src/index.js';

const execFileAsync = promisify(execFile);

test('gitClone rejects unsafe clone boundaries before transport', async t => {
  const nonEmptyDestination = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'git-clone-nonempty-'),
  );
  t.teardown(() =>
    fs.promises.rm(nonEmptyDestination, { recursive: true, force: true }),
  );
  await fs.promises.writeFile(path.join(nonEmptyDestination, 'occupied'), '');

  await t.throwsAsync(
    gitClone({
      url: 'http://github.com/example/repo.git',
      destPath: '/tmp/unused-clone',
    }),
    { message: /HTTP remotes are not supported/ },
  );
  await t.throwsAsync(
    gitClone({
      url: 'https://token@github.com/example/repo.git',
      destPath: '/tmp/unused-clone',
    }),
    { message: /must not include embedded credentials/ },
  );
  await t.throwsAsync(
    gitClone({
      url: 'file:///tmp/repo.git',
      destPath: '/tmp/unused-clone',
      allowLocalFileTransport: true,
      credential: { kind: 'bearer', material: { token: 'test-token' } },
    }),
    { message: /credentials require https remotes/ },
  );
  await t.throwsAsync(
    gitClone({
      url: 'file:///tmp/repo.git',
      destPath: '/tmp/unused-clone',
    }),
    { message: /file transport requires allowLocalFileTransport/ },
  );
  await t.throwsAsync(
    gitClone({
      url: 'file:///tmp/repo.git',
      destPath: nonEmptyDestination,
      allowLocalFileTransport: true,
    }),
    { message: /destination mount must be empty/ },
  );
});

/**
 * A repository root the backend accepts, so `remotePush` reaches its argv
 * construction. Every assertion below rejects before any transport runs.
 *
 * @param {import('ava').ExecutionContext} t
 */
const provisionRepoRoot = async t => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'native-git-backend-'),
  );
  t.teardown(() => fs.promises.rm(root, { recursive: true, force: true }));
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  const backend = makeNativeGitBackend({ repoRoot: root });
  await backend.assertRepositoryRoot();
  return backend;
};

const LEASE_URL = 'https://github.com/example/repo.git';
const LEASE_OID = '0123456789abcdef0123456789abcdef01234567';

const provisionCommittedRepo = async t => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'native-git-worktree-'),
  );
  t.teardown(() => fs.promises.rm(root, { recursive: true, force: true }));
  await execFileAsync('git', ['init', '-q', '-b', 'main', root]);
  await execFileAsync('git', [
    '-C',
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'root',
  ]);
  return root;
};

test('worktreeList parses locked, detached, prunable, and bare records', async t => {
  const root = await provisionCommittedRepo(t);
  const parent = path.dirname(root);
  const detached = path.join(parent, 'native-git-worktree-detached');
  const locked = path.join(parent, 'native-git-worktree-locked');
  const prunable = path.join(parent, 'native-git-worktree-prunable');
  t.teardown(() =>
    Promise.all(
      [detached, locked, prunable].map(worktree =>
        fs.promises.rm(worktree, { recursive: true, force: true }),
      ),
    ),
  );
  await execFileAsync('git', [
    '-C',
    root,
    'worktree',
    'add',
    '-q',
    '--detach',
    detached,
    'HEAD',
  ]);
  await execFileAsync('git', [
    '-C',
    root,
    'worktree',
    'add',
    '-q',
    '-b',
    'locked-branch',
    locked,
    'HEAD',
  ]);
  await execFileAsync('git', [
    '-C',
    root,
    'worktree',
    'lock',
    '--reason',
    'test lock',
    locked,
  ]);
  await execFileAsync('git', [
    '-C',
    root,
    'worktree',
    'add',
    '-q',
    '-b',
    'prunable-branch',
    prunable,
    'HEAD',
  ]);
  await fs.promises.rm(prunable, { recursive: true, force: true });

  const backend = makeNativeGitBackend({ repoRoot: root });
  const records = await backend.worktreeList();
  t.is(records.length, 4);
  const mainRecord = records.find(
    ({ path: recordPath }) => recordPath === root,
  );
  t.truthy(mainRecord);
  t.truthy(mainRecord?.head);
  t.like(mainRecord, {
    branch: 'refs/heads/main',
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
  });
  const detachedRecord = records.find(
    ({ path: recordPath }) => recordPath === detached,
  );
  t.truthy(detachedRecord);
  t.truthy(detachedRecord?.head);
  t.like(detachedRecord, {
    bare: false,
    detached: true,
    locked: false,
    prunable: false,
  });
  t.like(
    records.find(({ path: recordPath }) => recordPath === locked),
    {
      branch: 'refs/heads/locked-branch',
      bare: false,
      detached: false,
      locked: true,
      prunable: false,
    },
  );
  t.like(
    records.find(({ path: recordPath }) => recordPath === prunable),
    {
      branch: 'refs/heads/prunable-branch',
      bare: false,
      detached: false,
      locked: false,
      prunable: true,
    },
  );

  const bare = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'native-git-worktree-bare-'),
  );
  t.teardown(() => fs.promises.rm(bare, { recursive: true, force: true }));
  await execFileAsync('git', ['clone', '-q', '--bare', root, bare]);
  const bareCheckout = path.join(parent, 'native-git-worktree-bare-checkout');
  t.teardown(() =>
    fs.promises.rm(bareCheckout, { recursive: true, force: true }),
  );
  await execFileAsync('git', [
    '--git-dir',
    bare,
    'worktree',
    'add',
    '-q',
    '--detach',
    bareCheckout,
    'main',
  ]);
  const bareBackend = makeNativeGitBackend({ repoRoot: bare });
  const bareRecords = await bareBackend.worktreeList();
  t.like(
    bareRecords.find(({ path: recordPath }) => recordPath === bare),
    {
      bare: true,
      detached: false,
      locked: false,
      prunable: false,
    },
  );
  t.like(
    bareRecords.find(({ path: recordPath }) => recordPath === bareCheckout),
    { bare: false, detached: true },
  );
});

test('worktreeAdd creates a derived checkout and rejects escaped destinations', async t => {
  const root = await provisionCommittedRepo(t);
  const backend = makeNativeGitBackend({ repoRoot: root });
  await fs.promises.mkdir(path.join(root, 'checkouts'));
  const derived = await backend.worktreeAdd(['checkouts', 'feature'], {
    ref: 'HEAD',
    newBranch: 'feature',
  });
  t.deepEqual(await derived.currentBranch(), {
    name: 'feature',
    kind: 'branch',
  });
  t.deepEqual(await derived.status(), []);

  const outside = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'native-git-worktree-outside-'),
  );
  t.teardown(() => fs.promises.rm(outside, { recursive: true, force: true }));
  await fs.promises.symlink(outside, path.join(root, 'escape'));
  await t.throwsAsync(
    backend.worktreeAdd(['escape', 'feature'], { ref: 'HEAD' }),
    { message: /outside the repository mount/ },
  );
  await t.throwsAsync(backend.worktreeAdd(['..', 'outside'], { ref: 'HEAD' }), {
    message: /single mount-relative segment/,
  });
});

test('worktreeAdd refuses a linked checkout whose administrative directory is outside its mount', async t => {
  const root = await provisionCommittedRepo(t);
  const linked = path.join(path.dirname(root), 'native-git-worktree-linked');
  t.teardown(() => fs.promises.rm(linked, { recursive: true, force: true }));
  await execFileAsync('git', [
    '-C',
    root,
    'worktree',
    'add',
    '-q',
    '--detach',
    linked,
    'HEAD',
  ]);
  const backend = makeNativeGitBackend({ repoRoot: linked });
  await backend.assertRepositoryRoot();
  await t.throwsAsync(backend.worktreeAdd(['new-checkout'], { ref: 'HEAD' }), {
    message: /outside the repository mount/,
  });
});

test('remotePush rejects a malformed force-with-lease before transport', async t => {
  const backend = await provisionRepoRoot(t);
  const push = forceWithLease =>
    backend.remotePush({
      url: LEASE_URL,
      refspecs: ['refs/heads/topic:refs/heads/topic'],
      forceWithLease,
    });

  // The exo never emits a malformed record, but `@endo/git` is importable
  // without the policy layer above it, so these branches are the boundary a
  // direct caller meets. Each is unreachable from the exo and therefore has no
  // other test standing behind it.
  await Promise.all(
    ['a string', 42, true, [], [LEASE_OID]].map(notARecord =>
      t.throwsAsync(push(notARecord), {
        message: /forceWithLease must be a record/,
      }),
    ),
  );
  await t.throwsAsync(push(null), {
    message: /forceWithLease must be a record/,
  });

  await t.throwsAsync(push({ expectedOid: LEASE_OID }), {
    message: /forceWithLease\.ref/,
  });
  await t.throwsAsync(
    push({ ref: '--upload-pack=evil', expectedOid: LEASE_OID }),
    { message: /forceWithLease\.ref/ },
  );
  await t.throwsAsync(push({ ref: 'refs/heads/topic' }), {
    message: /forceWithLease\.expectedOid/,
  });

  // The OID length boundary, either side, plus a non-hex digit.
  await Promise.all(
    [
      LEASE_OID.slice(0, 39),
      `${LEASE_OID}0`,
      LEASE_OID.replace(/.$/u, 'g'),
    ].map(badOid =>
      t.throwsAsync(push({ ref: 'refs/heads/topic', expectedOid: badOid }), {
        message: /40-character hexadecimal object ID/,
      }),
    ),
  );

  // Git reads a null-OID lease as "expect this ref NOT to exist" — create-only,
  // the inverse of the option's meaning. The schema, the exo, and this backend
  // must accept exactly the same domain, so this layer rejects it too.
  await t.throwsAsync(
    push({ ref: 'refs/heads/topic', expectedOid: '0'.repeat(40) }),
    { message: /must not be the null object ID/ },
  );

  // `--force-with-lease=<ref>:<oid>` is split at the LAST colon, so a ref
  // carrying its own colon does not round-trip and the lease binds to a ref
  // nobody named. `requireRevision` permits a colon, and the policy layer that
  // rejects one is not in a direct caller's path.
  await t.throwsAsync(push({ ref: 'refs/heads/a:b', expectedOid: LEASE_OID }), {
    message: /must not contain a colon/,
  });
});

test('remotePush refuses a force refspec alongside a force-with-lease', async t => {
  const backend = await provisionRepoRoot(t);

  // A `+` refspec carries its own force, and git lets that force turn a
  // stale-lease rejection into a forced update — so the pair does not error,
  // it silently VOIDS the lease. That is the one lease precondition whose
  // breach is an authority escalation rather than a diagnostic, which is why
  // it is re-asserted here rather than only at the policy layer.
  await t.throwsAsync(
    backend.remotePush({
      url: LEASE_URL,
      refspecs: ['+refs/heads/alt:refs/heads/topic'],
      forceWithLease: { ref: 'refs/heads/topic', expectedOid: LEASE_OID },
    }),
    { message: /must not accompany a force refspec/ },
  );

  // The same refspec without a lease is untouched by the new guard.
  await t.notThrowsAsync(
    backend
      .remotePush({
        url: LEASE_URL,
        refspecs: ['+refs/heads/alt:refs/heads/topic'],
      })
      .then(
        () => undefined,
        error => {
          // Transport is expected to fail (there is no such remote); the guard
          // must not be what rejected it.
          t.notRegex(String(error.message), /force refspec/u);
        },
      ),
  );
});
