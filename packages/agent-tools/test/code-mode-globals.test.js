// @ts-check
/// <reference types="ses"/>

import test from '@endo/ses-ava/prepare-endo.js';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/pass-style';

import { makeCompartmentEvaluate } from '../src/code-mode/compartment.js';
import { formatGlobalDeclarations } from '../src/code-mode/declarations.js';
import { makeGitGlobal } from '../src/code-mode-globals/git.js';
import { makeGitRemoteGlobal } from '../src/code-mode-globals/git-remote.js';
import { makeHttpGlobal } from '../src/code-mode-globals/http.js';
import { makeShellGlobal } from '../src/code-mode-globals/shell.js';

test('capability global factories preserve custom lexical names and pet paths', t => {
  const globals = [
    makeShellGlobal({ name: 'builderShell', petName: ['repo', 'shell'] }),
    makeHttpGlobal({ name: 'network', petName: 'http-client' }),
    makeGitRemoteGlobal({ name: 'upstream', petName: ['repo', 'origin'] }),
  ];

  t.like(globals[0], { name: 'builderShell' });
  t.like(globals[1], { name: 'network' });
  t.like(globals[2], { name: 'upstream' });
  t.true(globals[0].declaration?.body.includes('exec:'));
  t.true(globals[1].declaration?.body.includes('fetch:'));
  t.true(globals[2].declaration?.body.includes('push:'));

  const prompt = formatGlobalDeclarations(globals);
  t.true(prompt.includes('declare const builderShell: {'));
  t.true(prompt.includes('declare const network: {'));
  t.true(prompt.includes('declare const upstream: {'));
});

test('custom Git names rewrite recursive declaration references', t => {
  const global = makeGitGlobal({ name: 'repoGit' });

  t.true(global.declaration?.body.includes('typeof repoGit'));
  t.false(global.declaration?.body.includes('typeof git'));

  const prompt = formatGlobalDeclarations([global]);
  t.true(prompt.includes('declare const repoGit: {'));
  t.true(prompt.includes('typeof repoGit'));
});

test('history Git global explains rebase control and conflict recovery', t => {
  const global = makeGitGlobal({
    name: 'git',
    historyRewrite: true,
  });
  const { description } = global;
  if (description === undefined) {
    throw new Error('history Git global must include a description');
  }
  for (const phrase of [
    'start',
    'continue',
    'abort',
    'skip',
    'conflicts',
    'stage 2',
    'stage 3',
    'inverted',
  ]) {
    t.true(description.includes(phrase));
  }
  const { declaration } = global;
  if (declaration === undefined) {
    throw new Error('history Git global must include a declaration');
  }
  t.false(description.includes('status('));
  t.false(declaration.aux?.includes('status:') ?? false);
  t.false(declaration.body.includes('status:'));
});

test('a compartment can evaluate code against fake capability globals', async t => {
  // Build the descriptors with the real factories under test, so this test
  // fails (rather than passing unaffected) if a factory is deleted, renamed,
  // or emits the wrong lexical name or declaration.
  const shellGlobal = makeShellGlobal({ name: 'shell' });
  const httpGlobal = makeHttpGlobal({ name: 'http' });
  const remoteGlobal = makeGitRemoteGlobal({ name: 'remote' });
  const globals = [shellGlobal, httpGlobal, remoteGlobal];

  const prompt = formatGlobalDeclarations(globals);
  t.true(prompt.includes('declare const shell: {'));
  t.true(prompt.includes('declare const http: {'));
  t.true(prompt.includes('declare const remote: {'));

  const shell = Far('FakeShell', {
    exec: async (command, args) =>
      harden({ stdout: `${command}:${args.join(',')}`, exitCode: 0 }),
  });
  const response = Far('FakeHttpResponse', {
    status: () => 200,
  });
  const http = Far('FakeHttpClient', {
    fetch: async () => response,
  });
  const remote = Far('FakeGitRemote', {
    inspect: async () => harden({ name: 'origin' }),
  });
  const evaluate = makeCompartmentEvaluate({
    endowments: {
      E,
      [shellGlobal.name]: shell,
      [httpGlobal.name]: http,
      [remoteGlobal.name]: remote,
    },
  });

  const result = await evaluate({
    source: `(async () => {
  const response = await E(http).fetch('https://example.com');
  return {
    shell: await E(shell).exec('echo', ['ok']),
    status: await E(response).status(),
    remote: await E(remote).inspect(),
  };
})()`,
    globals,
  });

  t.deepEqual(result, {
    shell: { stdout: 'echo:ok', exitCode: 0 },
    status: 200,
    remote: { name: 'origin' },
  });
});
