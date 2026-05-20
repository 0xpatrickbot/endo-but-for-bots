// @ts-check
/**
 * Meta / self-documentation tools: `help` surfaces guest documentation,
 * `locate` returns the endo:// URL for a pet name, and `inspect` resolves
 * a capability and reports its help() text plus method names.
 *
 * @import { LalTool } from './index.js'
 */

import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';

const NamePathShape = M.arrayOf(M.string());
const NameOrPathShape = M.or(M.string(), NamePathShape);

/** @type {LalTool} */
export const helpTool = {
  name: 'help',
  summary:
    'Get documentation for guest capabilities or a specific method. ' +
    'Call with no arguments for an overview, or with a method name for specific documentation.',
  params: M.splitRecord({}, { methodName: M.string() }),
  execute: async (powers, args) => {
    const { methodName } = args;
    return E(powers).help(methodName);
  },
};
harden(helpTool);

/** @type {LalTool} */
export const locateTool = {
  name: 'locate',
  summary:
    'Get the locator URL for a pet name. Returns an "endo://..." URL string. ' +
    'Use locate(["@self"]) to get your own locator. ' +
    'Argument: petNamePath (string[]).',
  params: M.splitRecord({ petNamePath: NamePathShape }),
  execute: async (powers, args) => {
    const { petNamePath } = args;
    if (!petNamePath) {
      throw new Error('petNamePath is required');
    }
    return E(powers).locate(...petNamePath);
  },
};
harden(locateTool);

/** @type {LalTool} */
export const inspectTool = {
  name: 'inspect',
  summary:
    'Look up a capability by pet name and call its help() method to learn how to use it. ' +
    'Argument: petNameOrPath.',
  params: M.splitRecord({ petNameOrPath: NameOrPathShape }),
  execute: async (powers, args) => {
    const { petNameOrPath } = args;
    if (petNameOrPath === undefined) {
      throw new Error('petNameOrPath is required');
    }
    const capability = await E(powers).lookup(petNameOrPath);
    const parts = [];
    try {
      const helpText = await E(capability).help();
      parts.push(helpText);
    } catch {
      parts.push(`Capability at "${petNameOrPath}" does not implement help().`);
    }
    try {
      // eslint-disable-next-line no-underscore-dangle
      const methods = await E(capability).__getMethodNames__();
      parts.push(`\nMethods: ${methods.join(', ')}`);
    } catch {
      // No __getMethodNames__ available.
    }
    return parts.join('\n');
  },
};
harden(inspectTool);
