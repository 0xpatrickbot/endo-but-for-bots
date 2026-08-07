// @ts-check

import test from '@endo/ses-ava/prepare-endo.js';

import { makeWorkspaceGlobal } from '@endo/agent-tools/code-mode-globals/fs.js';
import { makeGitGlobal } from '@endo/agent-tools/code-mode-globals/git.js';
import { makeGitRemoteGlobal } from '@endo/agent-tools/code-mode-globals/git-remote.js';

import { makeCodeModeSystemPrompt } from '../src/code-mode.js';
import { makeEndoProvisionGlobals } from '../src/code-mode-provision-globals.js';

/** @param {Record<string, unknown>} policy */
const makePersistence = policy =>
  harden(
    /** @type {any} */ ({
      version: 2,
      guestHandlePath: ['code-mode', 'test', 'session-test', 'guest-handle'],
      workspacePath: '/workspace',
      policy: {
        mounts: {},
        ...policy,
      },
    }),
  );

test('globals match filesystem and Git authority modes', t => {
  const cases = [
    [makePersistence({}), []],
    [
      makePersistence({
        mounts: {
          workspace: {
            root: '/workspace',
            mode: 'readOnly',
            deniedSegments: [],
            guestBinding: true,
          },
        },
      }),
      [makeWorkspaceGlobal({ name: 'workspace' })],
    ],
    [
      makePersistence({
        mounts: {
          workspace: {
            root: '/workspace',
            mode: 'readWrite',
            deniedSegments: [],
            guestBinding: true,
          },
        },
      }),
      [makeWorkspaceGlobal({ name: 'workspace' })],
    ],
    [
      makePersistence({
        gits: {
          git: {
            mount: 'workspace',
            path: [],
            root: '/workspace',
            mode: 'readOnly',
          },
        },
      }),
      [makeGitGlobal({ name: 'git', readOnly: true })],
    ],
    [
      makePersistence({
        gits: {
          git: {
            mount: 'workspace',
            path: [],
            root: '/workspace',
            mode: 'readWrite',
          },
        },
      }),
      [makeGitGlobal({ name: 'git' })],
    ],
    [
      makePersistence({
        gits: {
          git: {
            mount: 'workspace',
            path: [],
            root: '/workspace',
            mode: 'historyRewrite',
          },
        },
      }),
      [makeGitGlobal({ name: 'git', historyRewrite: true })],
    ],
    [
      makePersistence({
        mounts: {
          workspace: {
            root: '/workspace',
            mode: 'readWrite',
            deniedSegments: [],
            guestBinding: true,
          },
        },
        gits: {
          git: {
            mount: 'workspace',
            path: [],
            root: '/workspace',
            mode: 'historyRewrite',
          },
        },
      }),
      [
        makeWorkspaceGlobal({ name: 'workspace' }),
        makeGitGlobal({ name: 'git', historyRewrite: true }),
      ],
    ],
  ];

  for (const [persistence, expected] of cases) {
    t.deepEqual(
      makeEndoProvisionGlobals(/** @type {any} */ (persistence)),
      expected,
    );
  }
});

test('remote globals are sorted and hardened', t => {
  const globals = makeEndoProvisionGlobals(
    makePersistence({
      gits: {
        git: {
          mount: 'workspace',
          path: [],
          root: '/workspace',
          mode: 'readWrite',
        },
      },
      gitRemotes: {
        zebra: {},
        alpha: {},
      },
    }),
  );

  t.deepEqual(globals, [
    makeGitGlobal({ name: 'git' }),
    makeGitRemoteGlobal({ name: 'alpha' }),
    makeGitRemoteGlobal({ name: 'zebra' }),
  ]);
  t.true(Object.isFrozen(globals));
  t.true(globals.every(Object.isFrozen));
});

test('nested Git globals each appear in the system prompt', t => {
  const globals = makeEndoProvisionGlobals(
    makePersistence({
      gits: {
        zeta: {
          mount: 'workspace',
          path: ['zeta'],
          root: '/workspace/zeta',
          mode: 'historyRewrite',
        },
        ebfb: {
          mount: 'workspace',
          path: ['ebfb'],
          root: '/workspace/ebfb',
          mode: 'readWrite',
        },
        inspect: {
          mount: 'workspace',
          path: ['inspect'],
          root: '/workspace/inspect',
          mode: 'readOnly',
        },
      },
    }),
  );

  t.deepEqual(
    globals.map(({ name }) => name),
    ['ebfb', 'inspect', 'zeta'],
  );
  const prompt = makeCodeModeSystemPrompt(globals);
  t.true(prompt.includes('declare const ebfb: WritableEndoGit;'));
  t.true(prompt.includes('declare const inspect: ReadOnlyEndoGit;'));
  t.true(prompt.includes('declare const zeta: EndoGitHistory;'));
});
