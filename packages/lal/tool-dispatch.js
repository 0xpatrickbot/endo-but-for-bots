// @ts-nocheck - tool execute signatures use `any` for guest powers
/**
 * Tool dispatch for the Lal agent.
 *
 * The set of tools the LLM can call is built up from per-tool files
 * under `tools/`. Each file exports a hardened
 * `{ name, summary, [params], [bigintArgs], execute }` record; the
 * aggregated `tools` array lives in `tools/index.js`. This module
 * indexes that array by tool name and wraps the per-tool `execute`
 * callbacks in the dispatcher pi-agent-core consumes.
 *
 * - `makeExecuteTool(powers)` returns the `execTool` callback `PiAgent`
 *   calls when the LLM emits a tool call.
 * - `toAgentTool(name, summary, executeTool)` wraps that callback in
 *   the permissive open-object `AgentTool` shape pi-agent-core ships
 *   today (per-tool argument validation happens inside `executeTool`).
 */

import { mustMatch } from '@endo/patterns';

import { tools } from './tools/index.js';

/** @import { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core' */
/** @import { ToolCallArgs } from './agent.types.js' */

// ============================================================================
// Per-tool SmallCaps BigInt-coercion
// ============================================================================
//
// The previous harness ran the entire args record through a SmallCaps
// marshal, which silently re-interpreted any LLM-emitted string starting
// with a SmallCaps special prefix (`!"#$%&'()*+,-`) as a BigInt,
// sentinel, symbol, or remotable. That was a footgun: a phone number
// `"+15551234567"`, a literal `"+5"` typed by the user, a hashtag
// `"#main"`, or the word `"%percentage"` in `strings` / `content` /
// `source` would all be silently mutated before the tool ever saw them
// (#290 review, kriskowal, 2026-05-20). To stay rigorous on SmallCaps
// as long as we are using JSON as the wire format, we coerce *only*
// the per-tool fields declared as `bigintArgs` (the documented
// `messageNumber` surface) and leave every other string verbatim. The
// `@endo/patterns` matchers then catch any drift (a string in a
// `petNamePath: string[]` slot, a number in a `petName: string` slot,
// etc.) at the args boundary.

const BIGINT_LITERAL_RE = /^[+-]\d+$/;

/**
 * Coerce a single value to a BigInt when it is shaped like a SmallCaps
 * BigInt literal (`"+N"` or `"-N"`). Plain numbers and existing BigInts
 * are passed through; the pattern matcher tolerates both. Anything that
 * does not look like a BigInt literal is returned unchanged so the
 * matcher can reject it with a clear "must be a bigint" diagnostic.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
const coerceBigintArg = value => {
  if (typeof value !== 'string') return value;
  if (!BIGINT_LITERAL_RE.test(value)) return value;
  try {
    return BigInt(value);
  } catch {
    return value;
  }
};

/**
 * Coerce the named bigint-typed fields of an args record in place
 * (returning a fresh object). Non-bigint fields are copied through
 * verbatim with no SmallCaps interpretation. This is the entirety of
 * SmallCaps decoding the harness performs on inbound tool args; every
 * other primitive shape is left to the LLM's JSON.
 *
 * @param {Record<string, unknown>} args
 * @param {readonly string[]} bigintArgs
 * @returns {Record<string, unknown>}
 */
const coerceBigintArgs = (args, bigintArgs) => {
  if (bigintArgs.length === 0) return args;
  /** @type {Record<string, unknown>} */
  const next = { ...args };
  for (const key of bigintArgs) {
    if (Object.hasOwn(next, key)) {
      next[key] = coerceBigintArg(next[key]);
    }
  }
  return next;
};

// ============================================================================
// Tool registry indices
// ============================================================================
//
// Pre-index each tool's @endo/patterns matcher, bigint-arg list, and
// execute callback by tool name. The matcher validates the decoded
// args record before dispatch, matching the discipline
// `packages/genie/src/tools/common.js` applies (per-tool schema +
// nested-JSON fixup) but expressed at the args-record level. The
// execute index turns dispatch into a single registry lookup,
// replacing the previous switch that lived in `agent.js`.

const paramsByTool = new Map(
  tools.filter(t => t.params !== undefined).map(t => [t.name, t.params]),
);
/** @type {Map<string, readonly string[]>} */
const bigintArgsByTool = new Map(
  tools
    .filter(t => t.bigintArgs && t.bigintArgs.length > 0)
    .map(t => [t.name, /** @type {readonly string[]} */ (t.bigintArgs)]),
);
/** @type {Map<string, (powers: any, args: ToolCallArgs) => Promise<unknown>>} */
const executeByTool = new Map(tools.map(t => [t.name, t.execute]));

/**
 * Validate decoded args against the tool's `@endo/patterns` matcher.
 * If the first attempt fails and any field is a string that parses as
 * JSON, we retry once with those fields un-JSON-fied. Some LLMs
 * (notably smaller Ollama models) emit nested arrays/objects as
 * JSON-encoded strings; the same retry idea is used in genie's
 * `common.js`.
 *
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Record<string, unknown>} Possibly fixed-up args.
 */
const validateAndFixupArgs = (name, args) => {
  const pattern = paramsByTool.get(name);
  if (pattern === undefined) return args;
  try {
    mustMatch(harden(args), pattern, `${name} args`);
    return args;
  } catch (err) {
    if (typeof args !== 'object' || args === null) throw err;
    let fixedAny = false;
    /** @type {Record<string, unknown>} */
    const next = { ...args };
    for (const [key, val] of Object.entries(args)) {
      if (typeof val === 'string') {
        try {
          next[key] = JSON.parse(val);
          fixedAny = true;
        } catch {
          // not JSON; leave as-is
        }
      }
    }
    if (!fixedAny) throw err;
    mustMatch(harden(next), pattern, `${name} args`);
    return next;
  }
};

/**
 * Build the executeTool callback bound to a specific guest's powers.
 * The returned function is the `execTool` parameter to
 * `new PiAgent({tools:[...]})`; it must always resolve (errors
 * propagate as the tool's `details`/`content`).
 *
 * @param {any} powers - Guest powers
 * @returns {(name: string, args: ToolCallArgs) => Promise<unknown>}
 */
export const makeExecuteTool = powers => {
  const executeTool = async (name, rawArgs) => {
    // pi-agent-core delivers args as a plain object after JSON-parsing.
    // Coerce only the declared bigint-typed fields (the `messageNumber`
    // surface) from `"+N"` literals to actual BigInts. Every other
    // field passes through verbatim so user-text fields like `strings`,
    // `content`, and `source` cannot be inadvertently reinterpreted as
    // SmallCaps tokens (#290 review, kriskowal: a JSON-over-the-wire
    // protocol needs rigorous SmallCaps treatment, not a recursive
    // walk).
    const argsRecord = /** @type {Record<string, unknown>} */ (rawArgs ?? {});
    const bigintArgs = bigintArgsByTool.get(name) ?? [];
    const decoded = coerceBigintArgs(argsRecord, bigintArgs);
    // Validate against the tool's @endo/patterns matcher so a
    // malformed args record fails fast with a structured error instead
    // of cascading into a confusing E(powers).<method>() failure
    // mid-dispatch.
    const args = /** @type {ToolCallArgs} */ (
      validateAndFixupArgs(name, decoded)
    );
    const execute = executeByTool.get(name);
    if (execute === undefined) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return execute(powers, args);
  };

  return executeTool;
};
harden(makeExecuteTool);

/**
 * Convert a lal tool definition into a pi-agent-core AgentTool. The
 * `parameters` field is a permissive open-object schema; per-tool
 * argument validation lives in `executeTool` (per-field BigInt
 * coercion plus the `@endo/patterns` matcher + JSON-string fixup
 * retry). When pi-agent-core's tool-schema forwarding stabilizes we
 * can promote the per-tool schemas into this field.
 *
 * @param {string} name
 * @param {string} summary
 * @param {(name: string, args: any) => Promise<any>} executeTool
 * @returns {AgentTool<any>}
 */
export function toAgentTool(name, summary, executeTool) {
  return {
    name,
    label: name,
    description: summary,
    parameters: { type: 'object', additionalProperties: true },
    execute: async (_toolCallId, params, _signal, _onUpdate) => {
      const result = await executeTool(name, params);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      /** @type {AgentToolResult<any>} */
      const toolResult = {
        content: [{ type: 'text', text }],
        details: result,
      };
      return toolResult;
    },
  };
}
harden(toAgentTool);
