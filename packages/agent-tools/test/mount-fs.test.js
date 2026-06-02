// @ts-check

// Establish a SES perimeter (provides the `harden` global).
// eslint-disable-next-line import/order
import '@endo/init/debug.js';

import test from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { E, Far } from '@endo/far';

// The maker is daemon-independent: it imports only `@endo/far` and is
// handed an `EndoMount` capability at call time. The *test*, however,
// exercises the real confinement and revocation behavior, so it builds a
// genuine `EndoMount` over a `mkdtemp` directory using the daemon's
// public mount maker and file powers (a devDependency only; the shipped
// package keeps no daemon dependency).
import { makeMount } from '@endo/daemon/src/mount.js';
import { makeFilePowers } from '@endo/daemon/src/daemon-node-powers.js';

import { makeMountReadTool } from '../mount-fs.js';

const filePowers = makeFilePowers({ fs, path });

/**
 * @param {import('ava').ExecutionContext} t
 * @returns {string}
 */
const makeTempRoot = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-mount-'));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// --- 1. Happy path ---

test('reads a text file inside the mount', async t => {
  const rootPath = makeTempRoot(t);
  fs.writeFileSync(path.join(rootPath, 'a.txt'), 'hello mount');
  // Read-only attenuation for the readText-binding maker is a mount
  // minted with readOnly:true (its mutating methods reject, but readText
  // is still present). The readOnly() ReadableTree view is the
  // alternative binding (lookup -> text) and structurally omits
  // readText, so it is not handed to this maker.
  const mount = makeMount({ rootPath, readOnly: true, filePowers });

  const tool = makeMountReadTool(mount);
  await null;
  t.is(await tool.execute({ path: 'a.txt' }), 'hello mount');
});

test('reads a file in a subdirectory by relative path', async t => {
  await null;
  const rootPath = makeTempRoot(t);
  fs.mkdirSync(path.join(rootPath, 'sub'));
  fs.writeFileSync(path.join(rootPath, 'sub', 'b.txt'), 'nested');
  const mount = makeMount({ rootPath, readOnly: true, filePowers });

  const tool = makeMountReadTool(mount);
  t.is(await tool.execute({ path: 'sub/b.txt' }), 'nested');
});

test('truncates content beyond the 50k-char cap', async t => {
  const rootPath = makeTempRoot(t);
  const big = 'x'.repeat(50_001);
  fs.writeFileSync(path.join(rootPath, 'big.txt'), big);
  const mount = makeMount({ rootPath, readOnly: true, filePowers });

  const tool = makeMountReadTool(mount);
  const result = await tool.execute({ path: 'big.txt' });
  t.true(result.startsWith('x'.repeat(50_000)));
  t.true(result.includes('truncated, 50001 chars total'));
  // The kept prefix is exactly the cap, not the whole file.
  t.is(result.indexOf('\n\n... (truncated'), 50_000);
});

test('a readOnly:true mount still serves readText but rejects writes', async t => {
  // Confirms the attenuation the maker relies on: a readOnly mount keeps
  // readText (so the tool works) while its mutating surface fails closed.
  const rootPath = makeTempRoot(t);
  fs.writeFileSync(path.join(rootPath, 'a.txt'), 'ro');
  const mount = makeMount({ rootPath, readOnly: true, filePowers });
  const tool = makeMountReadTool(mount);

  await null;
  t.is(await tool.execute({ path: 'a.txt' }), 'ro');
  await t.throwsAsync(() => E(mount).writeText(['a.txt'], 'mutated'), {
    message: /read-only/,
  });
});

test('the documented ReadableTree alternative binding reads via lookup -> text', async t => {
  // Backs the alternative binding the maker's JSDoc names: over a
  // readOnly() ReadableTree view (which omits readText), a read goes
  // through lookup(segments) -> text(). This is the stronger structural
  // guarantee (the mutating methods are absent from the exo, not merely
  // guarded), at the cost of a second eventual-send.
  const rootPath = makeTempRoot(t);
  fs.mkdirSync(path.join(rootPath, 'sub'));
  fs.writeFileSync(path.join(rootPath, 'sub', 'b.txt'), 'via tree');
  const mount = makeMount({ rootPath, readOnly: true, filePowers });
  const view = E(mount).readOnly(); // a ReadableTree: has / list / lookup only

  const segments = 'sub/b.txt'.split('/');
  const file = await E(view).lookup(segments);
  t.is(await E(file).text(), 'via tree');
});

test('schema advertises the mountReadText tool name and a required path', t => {
  const rootPath = makeTempRoot(t);
  const mount = makeMount({ rootPath, readOnly: true, filePowers });
  const tool = makeMountReadTool(mount);

  const schema = tool.schema();
  t.is(schema.type, 'function');
  t.is(schema.function.name, 'mountReadText');
  t.deepEqual(schema.function.parameters.required, ['path']);
});

test('rejects a missing or empty path before any send', async t => {
  const rootPath = makeTempRoot(t);
  const mount = makeMount({ rootPath, readOnly: true, filePowers });
  const tool = makeMountReadTool(mount);

  await t.throwsAsync(() => tool.execute({}), {
    message: /non-empty string path/,
  });
  await t.throwsAsync(() => tool.execute({ path: '' }), {
    message: /non-empty string path/,
  });
});

// --- 2. Structural out-of-mount access failure ---
//
// These assert the read fails because *no capability names the target* —
// the rejection comes from the mount's structural confinement, not from
// any string check inside the tool (the tool has none).

test('rejects a "../" escape via the mount, not a string check', async t => {
  const outsideRoot = makeTempRoot(t);
  fs.writeFileSync(path.join(outsideRoot, 'secret'), 'TOP SECRET');
  // The mount root is a *subdirectory* of `outsideRoot`, so a literal
  // `../secret` names a real file that exists on disk just outside the
  // mount. The only thing stopping the read is the mount's `..`-clamp +
  // confinement assertion.
  const rootPath = path.join(outsideRoot, 'mounted');
  fs.mkdirSync(rootPath);
  fs.writeFileSync(path.join(rootPath, 'inside.txt'), 'ok');
  const mount = makeMount({ rootPath, readOnly: true, filePowers });

  const tool = makeMountReadTool(mount);
  // Sanity: the file genuinely exists one level up.
  t.is(
    fs.readFileSync(path.join(outsideRoot, 'secret'), 'utf-8'),
    'TOP SECRET',
  );
  // The escape clamps at the mount root, so '../secret' resolves to
  // '<root>/secret', which does not exist — the read rejects.
  await t.throwsAsync(() => tool.execute({ path: '../secret' }), {
    message: /does not exist|escapes mount root/,
  });
  // And the in-mount read still works, proving the mount itself is live.
  t.is(await tool.execute({ path: 'inside.txt' }), 'ok');
});

test('rejects reading through a symlink that escapes the mount', async t => {
  const outsideRoot = makeTempRoot(t);
  const outsideFile = path.join(outsideRoot, 'secret.txt');
  fs.writeFileSync(outsideFile, 'TOP SECRET');
  const rootPath = path.join(outsideRoot, 'mounted');
  fs.mkdirSync(rootPath);
  // A symlink *inside* the mount pointing at a file *outside* it. A
  // naive `startsWith(root)` prefix check on the logical path would pass
  // (the link lives under the root); only `realPath` resolution catches
  // the escape.
  fs.symlinkSync(outsideFile, path.join(rootPath, 'link-out'));
  const mount = makeMount({ rootPath, readOnly: true, filePowers });

  const tool = makeMountReadTool(mount);
  await t.throwsAsync(() => tool.execute({ path: 'link-out' }), {
    message: /escapes mount root/,
  });
});

// --- 3. Revoke-then-call fails closed ---
//
// A daemon mount is a formula; cancelling it tears down the backing exo,
// and an eventual-send to a revoked target rejects. There is no daemon
// in a unit test, so this models revocation the way the design's unit
// tier prescribes: wrap the real mount in a forwarder that delegates
// while live and rejects once revoked — the observable shape of a
// torn-down exo. The tool holds the forwarder ERef and never an `fs`
// handle or a path, so a revoked tool can only reject; it cannot fall
// back to ambient authority.

test('fails closed after the mount is revoked, with no ambient fallback', async t => {
  const rootPath = makeTempRoot(t);
  fs.writeFileSync(path.join(rootPath, 'a.txt'), 'live content');
  const realMount = makeMount({ rootPath, readOnly: true, filePowers });

  let revoked = false;
  const revocableMount = Far('RevocableMount', {
    /** @param {string | string[]} p */
    async readText(p) {
      if (revoked) {
        // Model a torn-down formula exo: the target no longer resolves.
        throw new Error('Mount has been revoked');
      }
      return E(realMount).readText(p);
    },
  });

  const tool = makeMountReadTool(revocableMount);

  await null;
  // One successful read while the mount is live.
  t.is(await tool.execute({ path: 'a.txt' }), 'live content');

  // Revoke (cancel the formula), then the next call rejects.
  revoked = true;
  await t.throwsAsync(() => tool.execute({ path: 'a.txt' }), {
    message: /revoked/,
  });

  // The rejection is not satisfiable by any on-disk file: the underlying
  // file still exists, yet the revoked tool cannot read it — there is no
  // ambient path the tool could fall back to.
  t.is(fs.readFileSync(path.join(rootPath, 'a.txt'), 'utf-8'), 'live content');
});
