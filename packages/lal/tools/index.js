// @ts-check
/**
 * Registry of Endo capability tools exposed to the LLM through pi-agent-core.
 *
 * Tools are grouped into family modules under this directory; each module
 * exports a hardened `{ name, summary, [params], [bigintArgs], execute }`
 * record per tool. The shape matches the previous inline `LalToolDef`
 * array in `agent.js`; `execute` is the per-tool handler that the previous
 * switch case dispatched to.
 *
 * Tools are read just-in-time by `agent.js` via the aggregated `tools`
 * array below. To add a new tool: add an `export const xxxTool = …` to
 * the appropriate family file (or seed a new family file), then import
 * and append it here.
 */

/**
 * @typedef {object} LalTool
 * @property {string} name - The LLM-visible tool name.
 * @property {string} summary - One-line description sent to the LLM.
 * @property {import('@endo/patterns').Pattern} [params] - `@endo/patterns`
 *   matcher run against the decoded args object before dispatch.
 * @property {readonly string[]} [bigintArgs] - Field names whose values
 *   should be coerced from a SmallCaps-shaped BigInt literal (`"+N"` or
 *   `"-N"`) into an actual BigInt before pattern validation.
 * @property {(powers: any, args: import('../agent.types.js').ToolCallArgs) => Promise<unknown>} execute
 *   - The handler the dispatcher invokes with the guest's powers and the
 *     validated args record.
 */

import { helpTool, locateTool, inspectTool } from './meta.js';
import {
  hasTool,
  listTool,
  lookupTool,
  removeTool,
  moveTool,
  copyTool,
  makeDirectoryTool,
  adoptTool,
} from './petnames.js';
import {
  listMessagesTool,
  resolveTool,
  rejectTool,
  dismissTool,
  requestTool,
  sendTool,
  replyTool,
} from './mail.js';
import { readTextTool, writeTextTool } from './fs.js';
import { evaluateTool, defineTool } from './code.js';

/** @type {readonly LalTool[]} */
export const tools = harden([
  // Self-documentation
  helpTool,
  // Directory operations
  hasTool,
  listTool,
  lookupTool,
  removeTool,
  moveTool,
  copyTool,
  makeDirectoryTool,
  adoptTool,
  // Mail operations
  listMessagesTool,
  resolveTool,
  rejectTool,
  dismissTool,
  requestTool,
  sendTool,
  replyTool,
  // Identity
  locateTool,
  // Capability operations
  inspectTool,
  readTextTool,
  writeTextTool,
  // Code evaluation
  evaluateTool,
  // Define code with slots for host to fill
  defineTool,
]);
