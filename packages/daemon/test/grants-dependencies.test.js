// @ts-check

import '@endo/init/debug.js';

import {
  provisionEndoGuest,
  reconstructEndoGuest,
} from '@endo/daemon/grants.js';
import test from 'ava';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const daemonRoot = new URL('../', import.meta.url);
const importPattern =
  /\b(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(['"])([^'"]+)\1/gu;

test('daemon grants have no agentry or agent-tools runtime dependency', async t => {
  await null;
  t.is(typeof provisionEndoGuest, 'function');
  t.is(typeof reconstructEndoGuest, 'function');
  const manifest = JSON.parse(
    await readFile(new URL('package.json', daemonRoot), 'utf8'),
  );
  t.false(Object.hasOwn(manifest.dependencies, '@endo/agentry'));
  t.false(Object.hasOwn(manifest.dependencies, '@endo/agent-tools'));

  /** @type {URL[]} */
  const pending = [new URL('grants.js', daemonRoot)];
  const visited = new Set();
  while (pending.length > 0) {
    const moduleUrl = pending.shift();
    if (moduleUrl !== undefined && !visited.has(moduleUrl.href)) {
      visited.add(moduleUrl.href);
      // eslint-disable-next-line no-await-in-loop
      const source = await readFile(moduleUrl, 'utf8');
      const runtimeSource = source
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/^\s*\/\/.*$/gmu, '');
      for (const match of runtimeSource.matchAll(importPattern)) {
        const specifier = match[2];
        t.false(
          specifier === '@endo/agentry' ||
            specifier.startsWith('@endo/agentry/') ||
            specifier === '@endo/agent-tools' ||
            specifier.startsWith('@endo/agent-tools/'),
          `${fileURLToPath(moduleUrl)} stays harness-independent`,
        );
        if (specifier.startsWith('.')) {
          pending.push(new URL(specifier, moduleUrl));
        }
      }
    }
  }
});
