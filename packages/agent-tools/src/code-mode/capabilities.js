// @ts-check
/// <reference types="ses"/>

/** @import { ERef } from '@endo/eventual-send' */
/** @import { CodeModeGlobal } from './evaluate-tool.js' */

import { E } from '@endo/eventual-send';
import { Far } from '@endo/pass-style';

/**
 * The durable capability seam used by code mode.
 *
 * `lookupPowers` is normally the daemon's pet-name store. `storeValue` is the
 * same host-owned persistence hook used by evaluate's `resultName` parameter.
 * The hook must be backed by durable storage when the caller wants a Far to
 * survive a process or session restart; this module deliberately does not
 * serialize capabilities itself.
 *
 * @param {{ lookupPowers?: ERef<{ lookup: (petName: string | string[]) => ERef<object> }>, storeValue?: (value: unknown, petName: string | string[]) => Promise<void> | void }} options
 * @returns {object | undefined}
 */
export const makeCapabilityBank = ({ lookupPowers, storeValue }) => {
  // A durable bank needs both halves: without lookup there is no way to
  // recover a preserved Far, and without storeValue there is no cross-session
  // preservation authority. Callers that need only one half can still pass a
  // named power or use evaluate's resultName directly.
  if (lookupPowers === undefined || storeValue === undefined) {
    return undefined;
  }

  const lookup = petName => {
    if (lookupPowers === undefined) {
      throw new Error(
        'code-mode capability lookup requires a lookupPowers capability',
      );
    }
    return E(lookupPowers).lookup(petName);
  };

  const preserve = (value, petName) => {
    if (storeValue === undefined) {
      throw new Error(
        'code-mode capability preservation requires storeValue authority',
      );
    }
    return storeValue(value, petName);
  };

  // Keep the bank intentionally small. In particular, Far is a direct lexical
  // endowment (see makeCapabilityGlobals), not a method on this Far: a methods
  // object contains guest functions and cannot be marshalled as a method
  // argument. The guest makes its Far locally, then preserves that Far here.
  return Far('CodeModeCapabilityBank', {
    lookup,
    preserve,
  });
};
harden(makeCapabilityBank);

const FAR_DECLARATION = harden({
  aux: `type FarMethods = Record<string, (...args: any[]) => any>;
type FarMaker = (name: string, methods: FarMethods) => object;`,
  body: 'FarMaker',
});

const CAPABILITY_BANK_DECLARATION = harden({
  aux: `type CapabilityPetName = string | string[];
type CapabilityBank = {
  lookup: (petName: CapabilityPetName) => Promise<object>;
  preserve: (value: object, petName: CapabilityPetName) => Promise<void>;
};`,
  body: 'CapabilityBank',
});

/**
 * @returns {CodeModeGlobal[]}
 */
export const makeCapabilityGlobals = () =>
  harden([
    {
      name: 'Far',
      description:
        'Make a local remotable. Preserve it with caps.preserve to retain it across sessions.',
      declaration: FAR_DECLARATION,
    },
    {
      name: 'caps',
      description:
        'Look up previously preserved capabilities and preserve new Fars under pet names.',
      declaration: CAPABILITY_BANK_DECLARATION,
    },
  ]);
harden(makeCapabilityGlobals);
