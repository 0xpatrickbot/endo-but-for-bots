// @ts-nocheck - PiAgent and runAgentRound generics don't compose cleanly here
/**
 * Per-round runner for the Lal agent.
 *
 * Consumes the event stream `runAgentRound` yields for one chat round
 * on a constructed `PiAgent`, prints lal's standard diagnostic console
 * output (tool calls, tool results, assistant prose, errors), and
 * invokes the caller's `hooks` callbacks alongside.
 *
 * The hook surface is the seam the eval harness uses to record a
 * trace without monkey-patching `agent.js`. Default `noopHooks` (from
 * `hooks/index.js`) means no observation.
 */

import { passableAsJustin } from '@endo/marshal';
import { runAgentRound } from '@endo/genie';

/** @import { Hooks } from './hooks/index.js' */

/**
 * Render a tool call's args for the diagnostic log. Returns a truncated
 * preview string. Mirrors the previous inline rendering in agent.js
 * verbatim so console output does not drift.
 *
 * @param {unknown} args
 * @returns {string}
 */
const renderArgsPreview = args => {
  try {
    const s =
      typeof args === 'string'
        ? args
        : passableAsJustin(harden(args ?? {}), false);
    return s.length > 200 ? `${s.slice(0, 200)}...` : s;
  } catch {
    return '(args)';
  }
};

/**
 * Render a tool result for the diagnostic log. Falls back to String()
 * if the result isn't passable.
 *
 * @param {unknown} result
 * @returns {string}
 */
const renderToolResult = result => {
  try {
    return passableAsJustin(result, false);
  } catch {
    return String(result);
  }
};

/**
 * Run one chat round on a `PiAgent` and stream its events. Emits the
 * standard `[tool] ...`, `[assistant] ...`, and `[agent] LLM error: ...`
 * console diagnostics, invokes the matching `hooks` callbacks, and
 * propagates an `Error` event by throwing.
 *
 * @param {any} piAgent
 * @param {string} prompt - User-role content for this round.
 * @param {Hooks} hooks
 * @returns {Promise<void>}
 */
export const runRound = async (piAgent, prompt, hooks) => {
  // eslint-disable-next-line no-await-in-loop
  for await (const event of runAgentRound(piAgent, prompt)) {
    switch (event.type) {
      case 'ToolCallStart': {
        console.log(
          `[tool] ${event.toolName}(${renderArgsPreview(event.args)})`,
        );
        hooks.onToolCallStart(event);
        break;
      }
      case 'ToolCallEnd': {
        if ('error' in event && event.error) {
          console.error(
            `[tool] ${event.toolName} error: ${event.error.message}`,
          );
        } else {
          console.log(
            `[tool] ${event.toolName} -> ${renderToolResult(event.result)}`,
          );
        }
        hooks.onToolCallEnd(event);
        break;
      }
      case 'Message': {
        if (event.role === 'assistant' && event.content) {
          // The LLM's text response is logged for visibility; lal's
          // protocol is tool-call-only, so any prose surfaces here as a
          // debugging breadcrumb rather than being sent to a peer.
          console.log(`[assistant] ${event.content}`);
        }
        hooks.onMessage(event);
        break;
      }
      case 'Error': {
        console.error(`[agent] LLM error: ${event.message}`);
        hooks.onEvent(event);
        throw event.cause || new Error(event.message);
      }
      default:
        break;
    }
    hooks.onEvent(event);
  }
};
harden(runRound);
