// @ts-check
/**
 * Pet-name directory tools: presence, enumeration, lookup, and the four
 * directory-edit operations (remove, move, copy, makeDirectory), plus
 * `adopt` which materializes a pet-name binding from an incoming package
 * message. The trigger for `adopt` is mail-shaped but its effect is to
 * create a pet name in the local directory, which is why it lives here
 * with the other directory mutators rather than in mail.js.
 *
 * @import { LalTool } from './index.js'
 */

import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';

const NamePathShape = M.arrayOf(M.string());
const NameOrPathShape = M.or(M.string(), NamePathShape);
const MessageNumberShape = M.or(M.bigint(), M.number());

/** @type {LalTool} */
export const hasTool = {
  name: 'has',
  summary:
    'Check if a pet name exists in the directory. Returns true or false. ' +
    'Argument: petNamePath (string[]).',
  params: M.splitRecord({ petNamePath: NamePathShape }),
  execute: async (powers, args) => {
    const { petNamePath } = args;
    if (!petNamePath) {
      throw new Error('petNamePath is required');
    }
    return E(powers).has(...petNamePath);
  },
};
harden(hasTool);

/** @type {LalTool} */
export const listTool = {
  name: 'list',
  summary:
    'List contents of your directory or any capability you have a pet name for. ' +
    'With no arguments, lists pet names in your root directory. ' +
    'With a name, looks up that capability and calls list() on it. ' +
    'Optional argument: name (string or string[]).',
  params: M.splitRecord({}, { name: NameOrPathShape }),
  execute: async (powers, args) => {
    // eslint-disable-next-line no-shadow
    const { name: lookupName } = args;
    if (lookupName !== undefined) {
      const capability = await E(powers).lookup(lookupName);
      return E(capability).list();
    }
    return E(powers).list();
  },
};
harden(listTool);

/** @type {LalTool} */
export const lookupTool = {
  name: 'lookup',
  summary:
    'Resolve a pet name or path to its value. Returns the value stored under that name. ' +
    'Argument: petNameOrPath (string or string[]).',
  params: M.splitRecord({ petNameOrPath: NameOrPathShape }),
  execute: async (powers, args) => {
    const { petNameOrPath } = args;
    if (petNameOrPath === undefined) {
      throw new Error('petNameOrPath is required');
    }
    return E(powers).lookup(petNameOrPath);
  },
};
harden(lookupTool);

/** @type {LalTool} */
export const removeTool = {
  name: 'remove',
  summary:
    'Remove a pet name from the directory. The underlying value is not deleted, just the name mapping. ' +
    'Argument: petNamePath (string[]).',
  params: M.splitRecord({ petNamePath: NamePathShape }),
  execute: async (powers, args) => {
    const { petNamePath } = args;
    if (!petNamePath) {
      throw new Error('petNamePath is required');
    }
    return E(powers).remove(...petNamePath);
  },
};
harden(removeTool);

/** @type {LalTool} */
export const moveTool = {
  name: 'move',
  summary:
    'Move/rename a reference from one name to another. The original name is removed. ' +
    'Arguments: fromPath (string[]), toPath (string[]).',
  params: M.splitRecord({ fromPath: NamePathShape, toPath: NamePathShape }),
  execute: async (powers, args) => {
    const { fromPath, toPath } = args;
    if (!fromPath || !toPath) {
      throw new Error('fromPath and toPath are required');
    }
    return E(powers).move(fromPath, toPath);
  },
};
harden(moveTool);

/** @type {LalTool} */
export const copyTool = {
  name: 'copy',
  summary:
    'Copy a reference to a new name. Both names will refer to the same value. ' +
    'Arguments: fromPath (string[]), toPath (string[]).',
  params: M.splitRecord({ fromPath: NamePathShape, toPath: NamePathShape }),
  execute: async (powers, args) => {
    const { fromPath, toPath } = args;
    if (!fromPath || !toPath) {
      throw new Error('fromPath and toPath are required');
    }
    return E(powers).copy(fromPath, toPath);
  },
};
harden(copyTool);

/** @type {LalTool} */
export const makeDirectoryTool = {
  name: 'makeDirectory',
  summary:
    'Create a new subdirectory at the given path. ' +
    'Argument: petNamePath (string[]).',
  params: M.splitRecord({ petNamePath: NamePathShape }),
  execute: async (powers, args) => {
    const { petNamePath } = args;
    if (!petNamePath) {
      throw new Error('petNamePath is required');
    }
    return E(powers).makeDirectory(petNamePath);
  },
};
harden(makeDirectoryTool);

/** @type {LalTool} */
export const adoptTool = {
  name: 'adopt',
  summary:
    'Adopt a value from an incoming package message, giving it a pet name. ' +
    'Arguments: messageNumber, edgeName, petName.',
  params: M.splitRecord({
    messageNumber: MessageNumberShape,
    edgeName: NameOrPathShape,
    petName: NameOrPathShape,
  }),
  bigintArgs: ['messageNumber'],
  execute: async (powers, args) => {
    const { messageNumber, edgeName, petName } = args;
    if (
      messageNumber === undefined ||
      edgeName === undefined ||
      petName === undefined
    ) {
      throw new Error('messageNumber, edgeName, and petName are required');
    }
    return E(powers).adopt(messageNumber, edgeName, petName);
  },
};
harden(adoptTool);
