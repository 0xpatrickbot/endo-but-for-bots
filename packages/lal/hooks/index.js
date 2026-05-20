// @ts-check
/**
 * Observation hooks for the Lal agent loop.
 *
 * `spawnWorkerLoop` invokes a `Hooks` callback set as it processes each
 * event yielded by `runAgentRound`. The default (`noopHooks`) is silent;
 * lal's own diagnostic console output is invoked separately inside the
 * round runner so this surface is additive and not load-bearing for
 * production behavior.
 *
 * The eval harness (Phase 2) supplies its own hook set to record the
 * full event stream as a trace, without monkey-patching `agent.js`.
 *
 * The shape is intentionally narrow: only the events that `runOneRound`
 * already observes are exposed. Do not invent hooks that nothing calls.
 *
 * @typedef {object} Hooks
 * @property {(evt: AgentRoundEvent) => void} onEvent
 *   Called for every event yielded by `runAgentRound`, after lal's own
 *   diagnostic handling. The discriminated `type` field selects the
 *   variant; callers narrow as needed.
 * @property {(call: ToolCallStartEvent) => void} onToolCallStart
 *   Called when a tool call begins (LLM emitted the call; tool has not
 *   yet been dispatched).
 * @property {(end: ToolCallEndEvent) => void} onToolCallEnd
 *   Called when a tool call completes, whether with a result or an
 *   error. `end.error` is present on failure.
 * @property {(msg: MessageEvent) => void} onMessage
 *   Called for each LLM message event (assistant prose or tool-result
 *   echo).
 */

/**
 * Narrow shapes mirroring `runAgentRound`'s event union. Only the fields
 * `runOneRound` actually reads are documented; pi-agent-core may include
 * additional fields, which pass through to hook callers unmodified.
 *
 * @typedef {{ type: 'ToolCallStart', toolName: string, args?: unknown }} ToolCallStartEvent
 * @typedef {{ type: 'ToolCallEnd', toolName: string, result?: unknown, error?: { message: string } }} ToolCallEndEvent
 * @typedef {{ type: 'Message', role: string, content?: string }} MessageEvent
 * @typedef {{ type: 'Error', message: string, cause?: unknown }} ErrorEvent
 * @typedef {ToolCallStartEvent | ToolCallEndEvent | MessageEvent | ErrorEvent | { type: string }} AgentRoundEvent
 */

/**
 * The no-op default hooks: all callbacks are silent. Used when
 * `spawnWorkerLoop` is invoked without an explicit `hooks` parameter.
 *
 * @type {Hooks}
 */
export const noopHooks = harden({
  onEvent: _evt => {},
  onToolCallStart: _call => {},
  onToolCallEnd: _end => {},
  onMessage: _msg => {},
});
