// @ts-check
/**
 * Code-evaluation tools: `evaluate` runs a snippet directly with endowments
 * the guest names, while `define` proposes a reusable program with named
 * slots for the host to fill.
 *
 * @import { LalTool } from './index.js'
 */

import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';

const NamePathShape = M.arrayOf(M.string());
const NameOrPathShape = M.or(M.string(), NamePathShape);

/** @type {LalTool} */
export const evaluateTool = {
  name: 'evaluate',
  summary:
    'Evaluate JavaScript code directly. Arguments: workerName (string|undefined), ' +
    'source (string), codeNames (string[]), edgeNames (string[]), resultName.',
  // workerName + codeNames + edgeNames are optional in the dispatcher
  // (codeNames/edgeNames default to [] and workerName accepts the
  // "#undefined" SmallCaps sentinel). Allow either undefined or the
  // expected primitive shape.
  params: M.splitRecord(
    { source: M.string(), resultName: NameOrPathShape },
    {
      workerName: M.or(M.string(), M.undefined()),
      codeNames: M.arrayOf(M.string()),
      edgeNames: M.arrayOf(M.string()),
    },
  ),
  execute: async (powers, args) => {
    const {
      workerName: rawWorkerName,
      source,
      codeNames = [],
      edgeNames = [],
      resultName,
    } = args;
    if (source === undefined) {
      throw new Error('source is required');
    }
    if (resultName === undefined) {
      throw new Error('resultName is required');
    }
    const workerName =
      rawWorkerName === 'undefined' || rawWorkerName === '#undefined'
        ? undefined
        : rawWorkerName;
    return E(powers).evaluate(
      workerName,
      source,
      harden(codeNames),
      harden(edgeNames),
      resultName,
    );
  },
};
harden(evaluateTool);

/** @type {LalTool} */
export const defineTool = {
  name: 'define',
  summary:
    'Propose a reusable program with named capability slots for the host to fill. ' +
    'Unlike evaluate(), you do NOT provide the capabilities yourself. ' +
    'Arguments: source (string), slots (object mapping slot name to { label }).',
  params: M.splitRecord({
    source: M.string(),
    slots: M.recordOf(M.string(), M.splitRecord({ label: M.string() })),
  }),
  execute: async (powers, args) => {
    const { source, slots } = args;
    if (source === undefined) {
      throw new Error('source is required');
    }
    if (slots === undefined) {
      throw new Error('slots is required');
    }
    return E(powers).define(source, harden(slots));
  },
};
harden(defineTool);
