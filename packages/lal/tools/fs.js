// @ts-check
/**
 * Filesystem-shaped tools that read or write text through
 * ReadableTree/WritableTree capabilities.
 *
 * @import { LalTool } from './index.js'
 */

import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';

const NamePathShape = M.arrayOf(M.string());
const NameOrPathShape = M.or(M.string(), NamePathShape);

/** @type {LalTool} */
export const readTextTool = {
  name: 'readText',
  summary:
    'Read text content from a capability (ReadableTree, WritableTree, etc.). ' +
    'Arguments: petNameOrPath, fileName (string).',
  params: M.splitRecord({
    petNameOrPath: NameOrPathShape,
    fileName: M.string(),
  }),
  execute: async (powers, args) => {
    const { petNameOrPath, fileName } = args;
    if (petNameOrPath === undefined || fileName === undefined) {
      throw new Error('petNameOrPath and fileName are required');
    }
    const capability = await E(powers).lookup(petNameOrPath);
    return E(capability).readText(fileName);
  },
};
harden(readTextTool);

/** @type {LalTool} */
export const writeTextTool = {
  name: 'writeText',
  summary:
    'Write text content to a capability (WritableTree, etc.). ' +
    'Arguments: petNameOrPath, fileName (string), content (string).',
  params: M.splitRecord({
    petNameOrPath: NameOrPathShape,
    fileName: M.string(),
    content: M.string(),
  }),
  execute: async (powers, args) => {
    const { petNameOrPath, fileName, content } = args;
    if (
      petNameOrPath === undefined ||
      fileName === undefined ||
      content === undefined
    ) {
      throw new Error('petNameOrPath, fileName, and content are required');
    }
    const capability = await E(powers).lookup(petNameOrPath);
    return E(capability).writeText(fileName, content);
  },
};
harden(writeTextTool);
