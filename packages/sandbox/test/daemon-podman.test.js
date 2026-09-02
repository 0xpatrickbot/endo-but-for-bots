// @ts-check

/** @import { PassableBytesReader } from '@endo/exo-stream' */
/** @import { SandboxFactory, SandboxHandle } from '../src/types.js' */

import test from '@endo/ses-ava/prepare-endo.js';
import { makeCancelKit } from '@endo/cancel';
import { makeEndoClient, purge, start, stop } from '@endo/daemon';
import { E } from '@endo/eventual-send';
import { iterateBytesReader } from '@endo/exo-stream/iterate-bytes-reader.js';

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { makePodmanDriver } from '../src/drivers/podman.js';

const ALPINE_REF = 'docker.io/library/alpine:3.19';
const PODMAN_OWNER = 'sandbox-daemon-podman-scenario';
const REQUIRE_PODMAN = process.env.ENDO_SANDBOX_REQUIRE_PODMAN === '1';
const sandboxSpecifier = new URL('../src/agent.js', import.meta.url).href;
const execFileAsync = promisify(execFile);

/**
 * @param {PassableBytesReader} reader
 * @returns {Promise<string>}
 */
const readText = async reader => {
  await null;
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of iterateBytesReader(reader)) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
};

const alpineImageIsPresent = async () => {
  await null;
  try {
    await execFileAsync('podman', ['image', 'exists', ALPINE_REF]);
    return true;
  } catch (_err) {
    return false;
  }
};

test.serial(
  'daemon-provisioned guest mount is readable through a podman slice',
  async t => {
    t.timeout(120_000);

    const preflight = await makePodmanDriver({
      env: {},
      ownerId: PODMAN_OWNER,
    }).probe();
    const imagePresent = preflight.available && (await alpineImageIsPresent());
    if (!preflight.available || !imagePresent) {
      const reason = preflight.available
        ? `${ALPINE_REF} is not present`
        : (preflight.reason ?? 'podman is unavailable');
      if (REQUIRE_PODMAN) {
        t.fail(`required podman scenario is unavailable: ${reason}`);
      } else {
        t.pass(`podman scenario not available: ${reason}`);
      }
      return;
    }

    const root = await mkdtemp(join(tmpdir(), 'endo-sandbox-podman-daemon-'));
    const workspace = join(root, 'workspace');
    const config = {
      statePath: join(root, 'state'),
      ephemeralStatePath: join(root, 'run'),
      cachePath: join(root, 'cache'),
      sockPath: join(root, 'endo.sock'),
      address: '127.0.0.1:0',
      gcEnabled: false,
      pets: new Map(),
      values: new Map(),
    };
    const { cancelled, cancel } = makeCancelKit();
    cancelled.catch(() => {});
    let daemonStarted = false;
    /** @type {Awaited<ReturnType<typeof makeEndoClient>> | undefined} */
    let client;
    /** @type {SandboxHandle | undefined} */
    let slice;

    t.teardown(async () => {
      await null;
      /** @type {unknown[]} */
      const errors = [];
      if (slice !== undefined) {
        try {
          await E(slice).dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (daemonStarted) {
        try {
          await stop(config);
        } catch (error) {
          errors.push(error);
        }
      }
      cancel(Error('daemon podman scenario closed'));
      if (client !== undefined) {
        await client.closed.catch(() => {});
      }
      try {
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw errors[0];
      }
    });

    await mkdir(workspace);
    await writeFile(join(workspace, 'scenario.txt'), 'daemon to podman\n');
    await purge(config);
    await start(config);
    daemonStarted = true;

    client = await makeEndoClient(
      'sandbox-daemon-podman-test',
      config.sockPath,
      cancelled,
    );
    client.closed.catch(() => {});
    const bootstrap = await client.getBootstrap();
    const host = await E(bootstrap).host();

    await E(host).makeUnconfined('@main', sandboxSpecifier, {
      powersName: '@agent',
      resultName: 'sandbox-factory',
      env: harden({ ENDO_SANDBOX_OWNER_ID: PODMAN_OWNER }),
    });

    const guest = await E(host).provideGuest('podman-scenario', {
      authority: harden({
        mount: {
          workspace: {
            path: workspace,
            readOnly: true,
          },
        },
      }),
      introducedNames: harden({
        'sandbox-factory': 'sandboxFactory',
      }),
    });
    const workspaceMount = await E(guest).lookup('workspace');
    const sandboxFactory = /** @type {SandboxFactory} */ (
      await E(guest).lookup('sandboxFactory')
    );

    const backends = await E(sandboxFactory).listBackends();
    const podman = backends.find(backend => backend.name === 'podman');
    t.true(podman?.available, podman?.reason ?? 'podman backend unavailable');

    const activeSlice = await E(sandboxFactory).make(
      harden({
        rootfs: { kind: 'oci', ref: ALPINE_REF },
        mounts: [
          {
            cap: workspaceMount,
            innerPath: '/workspace',
            mode: 'ro',
          },
        ],
        network: 'none',
        backend: 'podman',
      }),
    );
    slice = activeSlice;

    const proc = await E(activeSlice).spawn(
      harden(['/bin/cat', '/workspace/scenario.txt']),
    );
    const stdout = readText(await E(proc).stdout());
    const stderr = readText(await E(proc).stderr());
    const exit = await E(proc).wait();
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);

    t.is(exit.code, 0, stderrText);
    t.is(exit.signal, null);
    t.is(stdoutText, 'daemon to podman\n');

    await E(activeSlice).dispose();
    slice = undefined;
  },
);
