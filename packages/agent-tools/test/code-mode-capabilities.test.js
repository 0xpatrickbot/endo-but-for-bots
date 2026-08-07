// @ts-check

import test from '@endo/ses-ava/prepare-endo.js';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/pass-style';

import { makeCapabilityBank } from '../src/code-mode/capabilities.js';
import { makeCompartmentEvaluate } from '../src/code-mode/compartment.js';

test('capability bank preserves a Far and looks it up again', async t => {
  const preserved = [];
  const remembered = Far('Remembered', { value: () => 41 });
  const lookupPowers = Far('LookupPowers', {
    lookup: async petName => {
      t.is(petName, 'remembered');
      return remembered;
    },
  });
  const bank = makeCapabilityBank({
    lookupPowers,
    storeValue: (value, petName) => {
      preserved.push([value, petName]);
    },
  });
  const evaluate = makeCompartmentEvaluate({
    endowments: { E, Far, caps: bank },
  });

  const result = await evaluate({
    source: `(async () => {
      const made = Far('Made', { value: () => 1 });
      await caps.preserve(made, 'made');
      const found = await caps.lookup('remembered');
      return await E(found).value();
    })()`,
    globals: [],
  });

  t.is(result, 41);
  t.is(preserved.length, 1);
  t.is(preserved[0][1], 'made');
  t.deepEqual(await E(preserved[0][0]).value(), 1);
});

test('capability bank is omitted without a durable two-way seam', t => {
  t.is(makeCapabilityBank({ lookupPowers: Far('Lookup', {}) }), undefined);
  t.is(makeCapabilityBank({ storeValue: () => {} }), undefined);
});
