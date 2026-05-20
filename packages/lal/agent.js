// @ts-nocheck - E() generics don't work well with JSDoc types for remote objects
/* eslint-disable no-await-in-loop */

import { makeExo } from '@endo/exo';
import { M, mustMatch } from '@endo/patterns';
import { E } from '@endo/eventual-send';
import { passableAsJustin } from '@endo/marshal';
import { makeRefIterator } from '@endo/daemon/ref-reader.js';
import { makeLocalTree } from '@endo/platform/fs/node';

import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { registerBuiltInApiProviders, getModel } from '@mariozechner/pi-ai';
import { runAgentRound } from '@endo/genie';

import { systemPrompt } from './prompts/system.js';
import { tools } from './tools/index.js';

/** @import { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core' */
/** @import { Model } from '@mariozechner/pi-ai' */

/** @import { FarRef } from '@endo/eventual-send' */
/** @import { GuestPowers, ToolCallArgs, InboxMessage, LalContext } from './agent.types.js' */

// Register pi-ai's built-in API providers (anthropic, openai, google,
// openrouter, mistral, deepseek, groq, xai, github-copilot, and ~20 others)
// so getModel(provider, modelId) lookups succeed for any caller-supplied
// "provider/modelId" string. Ollama is *not* in this registry; @endo/genie's
// makePiAgent treats "ollama/<id>" specially by constructing a custom
// Model that points at a local OpenAI-compatible Ollama endpoint.
registerBuiltInApiProviders();

// ============================================================================
// Interface Definition
// ============================================================================

const LalInterface = M.interface('Lal', {
  help: M.call().optional(M.string()).returns(M.string()),
});

// ============================================================================
// Endo Capability Tool Specs
// ============================================================================
//
// The set of tools the LLM can call is built up from per-tool files under
// `tools/`. Each file exports a hardened
// `{ name, summary, [params], [bigintArgs], execute }` record; the aggregated
// `tools` array lives in `tools/index.js`. The `summary` is what
// pi-agent-core sends to the LLM as the tool description; `params` is the
// `@endo/patterns` matcher run against the decoded args before dispatch;
// `bigintArgs` names the fields that should be SmallCaps-coerced; `execute`
// is the per-tool handler that the dispatcher invokes with the guest's
// powers and the validated args record.
//
// `toAgentTool` (defined below) wraps each spec in the permissive
// open-object parameter schema pi-agent-core ships today. When
// `pi-agent-core` learns to forward custom parameter schemas, the per-tool
// `params` will be wired through directly.
//
// Tool dispatch lives in `makeExecuteTool` below: a single
// registry-lookup-and-call replaces the previous inline switch.

// ============================================================================
// Tool Dispatch
// ============================================================================

// Per-tool SmallCaps BigInt-coercion. The previous harness ran the entire
// args record through a SmallCaps marshal, which silently re-interpreted any
// LLM-emitted string starting with a SmallCaps special prefix (`!"#$%&'()*+,-`)
// as a BigInt, sentinel, symbol, or remotable. That was a footgun: a phone
// number `"+15551234567"`, a literal `"+5"` typed by the user, a hashtag
// `"#main"`, or the word `"%percentage"` in `strings` / `content` / `source`
// would all be silently mutated before the tool ever saw them (#290 review,
// kriskowal, 2026-05-20). To stay rigorous on SmallCaps as long as we are
// using JSON as the wire format, we coerce *only* the per-tool fields
// declared as `bigintArgs` (the documented `messageNumber` surface) and
// leave every other string verbatim. The `@endo/patterns` matchers then
// catch any drift (a string in a `petNamePath: string[]` slot, a number in
// a `petName: string` slot, etc.) at the args boundary.

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

// Pre-index each tool's @endo/patterns matcher, bigint-arg list, and execute
// callback by tool name. The matcher validates the decoded args record before
// dispatch, matching the discipline `packages/genie/src/tools/common.js`
// applies (per-tool schema + nested-JSON fixup) but expressed at the
// args-record level. The execute index turns dispatch into a single registry
// lookup, replacing the previous switch that lived in this module.
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
 * If the first attempt fails and any field is a string that parses as JSON,
 * we retry once with those fields un-JSON-fied. Some LLMs (notably smaller
 * Ollama models) emit nested arrays/objects as JSON-encoded strings; the
 * same retry idea is used in genie's `common.js`.
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
 * Build the executeTool callback bound to a specific guest's powers. The
 * returned function is the `execTool` parameter to `new PiAgent({tools:[...]})`;
 * it must always resolve (errors propagate as the tool's `details`/`content`).
 *
 * @param {any} powers - Guest powers
 * @returns {(name: string, args: ToolCallArgs) => Promise<unknown>}
 */
export const makeExecuteTool = powers => {
  const executeTool = async (name, rawArgs) => {
    // pi-agent-core delivers args as a plain object after JSON-parsing.
    // Coerce only the declared bigint-typed fields (the `messageNumber`
    // surface) from `"+N"` literals to actual BigInts. Every other field
    // passes through verbatim so user-text fields like `strings`,
    // `content`, and `source` cannot be inadvertently reinterpreted as
    // SmallCaps tokens (#290 review, kriskowal: a JSON-over-the-wire
    // protocol needs rigorous SmallCaps treatment, not a recursive walk).
    const argsRecord = /** @type {Record<string, unknown>} */ (rawArgs ?? {});
    const bigintArgs = bigintArgsByTool.get(name) ?? [];
    const decoded = coerceBigintArgs(argsRecord, bigintArgs);
    // Validate against the tool's @endo/patterns matcher so a malformed
    // args record fails fast with a structured error instead of cascading
    // into a confusing E(powers).<method>() failure mid-dispatch.
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

// ============================================================================
// Worker Loop
// ============================================================================

/**
 * Spawn a worker loop that follows a guest's inbox and processes messages
 * using a pi-agent-core–backed PiAgent. The PiAgent's internal message
 * state is the durable transcript for the worker's lifetime; cross-restart
 * conversation continuity is intentionally not preserved by this migration
 * (see the PR body's *Memory migration* section).
 *
 * @param {any} powers - Guest powers (manager's own or a sub-guest's)
 * @param {Promise<object> | object | null | undefined} context
 * @param {{ LAL_HOST?: string, LAL_MODEL?: string, LAL_AUTH_TOKEN?: string }} workerEnv
 * @returns {Promise<void>}
 */
export const spawnWorkerLoop = async (powers, context, workerEnv) => {
  const getCancelled = async () => {
    if (!context) return null;
    const resolvedContext = await context;
    if (!resolvedContext) return null;
    if (typeof resolvedContext.whenCancelled === 'function') {
      return E(resolvedContext).whenCancelled();
    }
    if (resolvedContext.cancelled) {
      return resolvedContext.cancelled;
    }
    return null;
  };

  // Resolve the model string for pi-ai. lal historically selected a provider
  // from LAL_HOST and a model from LAL_MODEL. The pi-ai registry takes a
  // single "provider/modelId" string instead; we keep accepting the legacy
  // LAL_* variables and translate them.
  const model = resolveModelString(workerEnv);
  if (workerEnv.LAL_AUTH_TOKEN) {
    setProviderApiKey(model, workerEnv.LAL_AUTH_TOKEN);
  }

  // Bind the tool dispatcher to this guest's powers, then build the
  // AgentTool array pi-agent-core consumes directly. We construct the
  // PiAgent in-line rather than via @endo/genie's `makePiAgent` so that
  //   (a) we are free to seed `initialState.messages` from prior
  //       transcripts when cross-restart continuity lands (see PR body),
  //   (b) we control the system prompt verbatim (no genie claw policy
  //       suffix or security-notes wrapping is applied), and
  //   (c) the per-tool parameter schema lives at the tool boundary,
  //       which lets `@endo/patterns` validation guard inbound args.
  const executeTool = makeExecuteTool(powers);
  const agentTools = tools.map(({ name, summary }) =>
    toAgentTool(name, summary, executeTool),
  );

  const resolvedModel = await resolveModel(model);
  const isOllama = resolvedModel.name?.startsWith('ollama/');

  const piAgent = new PiAgent({
    initialState: {
      systemPrompt,
      model: resolvedModel,
      tools: agentTools,
      messages: [],
      thinkingLevel: resolvedModel.reasoning ? 'medium' : 'off',
    },
    convertToLlm: msgs =>
      msgs.filter(
        m =>
          m.role === 'user' ||
          m.role === 'assistant' ||
          m.role === 'toolResult',
      ),
    toolExecution: 'sequential',
    ...(isOllama ? { getApiKey: async _provider => getOllamaApiKey() } : {}),
  });

  /**
   * Run one chat round on the PiAgent, forwarding tool-call activity to
   * the console and dispatching tool errors via the LLM transcript.
   *
   * @param {string} prompt - User-role content for this round.
   */
  const runOneRound = async prompt => {
    for await (const event of runAgentRound(piAgent, prompt)) {
      switch (event.type) {
        case 'ToolCallStart': {
          const argsPreview = (() => {
            try {
              const s =
                typeof event.args === 'string'
                  ? event.args
                  : passableAsJustin(harden(event.args ?? {}), false);
              return s.length > 200 ? `${s.slice(0, 200)}...` : s;
            } catch {
              return '(args)';
            }
          })();
          console.log(`[tool] ${event.toolName}(${argsPreview})`);
          break;
        }
        case 'ToolCallEnd': {
          if ('error' in event && event.error) {
            console.error(
              `[tool] ${event.toolName} error: ${event.error.message}`,
            );
          } else {
            const out = (() => {
              try {
                return passableAsJustin(event.result, false);
              } catch {
                return String(event.result);
              }
            })();
            console.log(`[tool] ${event.toolName} -> ${out}`);
          }
          break;
        }
        case 'Message': {
          if (event.role === 'assistant' && event.content) {
            // The LLM's text response is logged for visibility; lal's
            // protocol is tool-call-only, so any prose surfaces here as a
            // debugging breadcrumb rather than being sent to a peer.
            console.log(`[assistant] ${event.content}`);
          }
          break;
        }
        case 'Error': {
          console.error(`[agent] LLM error: ${event.message}`);
          throw event.cause || new Error(event.message);
        }
        default:
          break;
      }
    }
  };

  /**
   * Build the user-role content for an inbound message. lal's prompt is
   * intentionally minimal: the LLM is expected to call listMessages() to
   * inspect the inbox itself.
   *
   * @returns {string}
   */
  const formatInboundMessage = () =>
    'You have new mail. Check your messages and respond appropriately.';

  /**
   * Run the agent loop, processing incoming messages.
   *
   * @returns {Promise<void>}
   */
  const runAgent = async () => {
    // Announce ourselves with a call to action.
    await E(powers).send(
      '@host',
      [
        "Hello! I'm ready to help.\n\n" +
          'Send me a message to get started — in Chat, type ' +
          '`@` followed by my name and your request.\n\n' +
          'A few things to try:\n' +
          '- Ask me what I can do\n' +
          '- Ask me to list your inventory\n' +
          '- Ask me to help write a program\n\n' +
          'Type `/help` to see all available Chat commands.',
      ],
      [],
      [],
    );

    /** @type {string | undefined} */
    const selfLocator = await E(powers).locate('@self');
    const cancelled = await getCancelled();
    const cancelledSignal = cancelled
      ? cancelled.then(
          () => ({ cancelled: true }),
          () => ({ cancelled: true }),
        )
      : null;

    const messageIterator = makeRefIterator(E(powers).followMessages());
    while (true) {
      const nextMessage = messageIterator.next();
      const raced = cancelledSignal
        ? await Promise.race([
            cancelledSignal,
            nextMessage.then(result => ({ cancelled: false, result })),
          ])
        : { cancelled: false, result: await nextMessage };
      if (raced.cancelled) {
        try {
          await messageIterator.return?.();
        } catch {
          // ignore iterator return errors on cancellation
        }
        break;
      }
      const { value: message, done } = raced.result;
      if (done) {
        break;
      }
      const inboxMessage =
        /** @type {InboxMessage & {type?: string, messageId?: string, replyTo?: string}} */ (
          message
        );
      const { from: fromLocator, number, type } = inboxMessage;

      // Skip our own outbound messages; only act on inbound mail.
      // eslint-disable-next-line @endo/restrict-comparison-operands
      if (fromLocator !== selfLocator) {
        console.log(
          `[mail] New message #${number} (type: ${type || 'package'})`,
        );
        try {
          await runOneRound(formatInboundMessage());
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('[agent] LLM error, notifying sender:', errorMessage);
          try {
            await E(powers).reply(
              number,
              [`LLM provider error: ${errorMessage}`],
              [],
              [],
            );
          } catch (replyError) {
            console.error('[agent] Failed to notify sender:', replyError);
          }
        }
      }
    }
  };

  await runAgent();
};
harden(spawnWorkerLoop);

// ============================================================================
// Model + Provider Resolution
// ============================================================================
//
// pi-ai expects a single "provider/modelId" string and reads provider API
// keys from `process.env.<PROVIDER>_API_KEY`. lal's historical configuration
// passes LAL_HOST + LAL_MODEL + LAL_AUTH_TOKEN. The helpers below translate
// the legacy LAL_* variables into the pi-ai shape so existing
// `.env.example` files continue to work.

/**
 * Translate the legacy LAL_HOST + LAL_MODEL pair into a single
 * "provider/modelId" string suitable for pi-ai's getModel(). Recognized
 * LAL_HOST patterns:
 *
 *   contains "anthropic.com"  -> provider "anthropic"
 *   contains "generativelanguage.googleapis.com" or "gemini" -> "google"
 *   contains "openai.com"     -> provider "openai"
 *   contains "openrouter"     -> provider "openrouter"
 *   contains ":11434"         -> provider "ollama"
 *   otherwise (incl. "/v1" llama.cpp servers) -> provider "openai"
 *     (pi-ai's openai-completions adaptor speaks the same protocol)
 *
 * LAL_MODEL is used as the model id; a sensible default is chosen if
 * LAL_MODEL is empty.
 *
 * @param {{ LAL_HOST?: string, LAL_MODEL?: string }} env
 * @returns {string}
 */
function resolveModelString(env) {
  const host = (env.LAL_HOST || 'http://localhost:11434').toLowerCase();
  let provider = 'ollama';
  let defaultModel = 'qwen3';
  if (host.includes('anthropic.com')) {
    provider = 'anthropic';
    defaultModel = 'claude-opus-4-5-20251101';
  } else if (
    host.includes('generativelanguage.googleapis.com') ||
    host.includes('gemini')
  ) {
    // pi-ai exposes Google's Gemini models under the provider name 'google'.
    provider = 'google';
    defaultModel = 'gemini-2.0-flash';
  } else if (host.includes('openrouter')) {
    provider = 'openrouter';
    defaultModel = 'openrouter/auto';
  } else if (host.includes('openai.com')) {
    provider = 'openai';
    defaultModel = 'gpt-4o-mini';
  } else if (host.includes(':11434')) {
    // Native Ollama port.
    provider = 'ollama';
    defaultModel = 'qwen3';
  } else if (host.includes('/v1')) {
    // Any OpenAI-compatible local server (llama.cpp, vLLM, tgi).
    provider = 'openai';
    defaultModel = 'qwen3';
  }
  const modelId = env.LAL_MODEL || defaultModel;
  return `${provider}/${modelId}`;
}

/**
 * Install the caller-supplied API key into the appropriate environment
 * variable so pi-ai's provider adaptor finds it. We avoid clobbering an
 * already-set variable; this is best-effort and explicitly per-worker.
 *
 * @param {string} modelString - "provider/modelId"
 * @param {string} authToken
 */
function setProviderApiKey(modelString, authToken) {
  // eslint-disable-next-line no-undef
  const env = globalThis?.process?.env;
  if (!env) return;
  const [provider] = modelString.split('/');
  const keyName = `${provider.toUpperCase()}_API_KEY`;
  if (!env[keyName] || env[keyName] === 'ollama') {
    env[keyName] = authToken;
  }
}

/**
 * Resolve a "provider/modelId" string into a pi-ai Model object. Mirrors
 * the resolution genie's `makePiAgent` performs internally: known providers
 * go through `getModel(provider, modelId)`; the `ollama/` prefix is treated
 * specially (Ollama is not in pi-ai's built-in registry and exposes an
 * OpenAI-compatible /v1 endpoint).
 *
 * @param {string} modelString
 * @returns {Promise<Model<'openai-completions'>>}
 */
async function resolveModel(modelString) {
  const parts = modelString.split('/');
  const provider = parts[0];
  const modelId = parts.slice(1).join('/');
  if (provider === 'ollama') {
    return buildOllamaModel(modelId);
  }
  // pi-ai's KnownProvider overloads of getModel typically resolve the modelId
  // to `never` for the generic call site; we want the runtime registry lookup
  // here, which works for any string the caller passed.
  // @ts-expect-error - permissive runtime lookup against KnownProvider overloads
  return getModel(provider, modelId);
}

/**
 * Build a pi-ai Model object for a local Ollama instance. Ollama exposes
 * an OpenAI-compatible /v1/chat/completions endpoint, so we masquerade as
 * the "openai" provider with a custom baseUrl. Matches the shape genie
 * uses internally.
 *
 * @param {string} id - The ollama model name (e.g. "qwen3")
 * @returns {Promise<Model<'openai-completions'>>}
 */
async function buildOllamaModel(id) {
  await Promise.resolve();
  // eslint-disable-next-line no-undef
  const env = globalThis?.process?.env ?? {};
  const ollamaHost = env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  return harden({
    id,
    name: `ollama/${id}`,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: `${ollamaHost}/v1`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 8192,
  });
}

/**
 * API-key resolver for Ollama models. Ollama itself does not require a key,
 * but pi-ai's openai-completions adaptor refuses requests without one.
 * Prefer `OLLAMA_API_KEY` (in case the operator has set one for a remote
 * Ollama), else fall back to a harmless sentinel that the operator's setup
 * commonly uses already.
 *
 * @returns {string}
 */
function getOllamaApiKey() {
  // eslint-disable-next-line no-undef
  const env = globalThis?.process?.env ?? {};
  return env.OLLAMA_API_KEY || 'ollama';
}

/**
 * Convert a lal tool definition into a pi-agent-core AgentTool. The
 * `parameters` field is a permissive open-object schema; per-tool argument
 * validation lives in `executeTool` (per-field BigInt coercion plus the
 * `@endo/patterns` matcher + JSON-string fixup retry). When pi-agent-core's
 * tool-schema forwarding stabilizes we can promote the per-tool schemas
 * into this field.
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

// ============================================================================
// Manager / Entry Point
// ============================================================================

/**
 * Creates a Lal agent manager.
 *
 * Sends a configuration form to HOST on startup. Each form submission
 * creates a new guest profile and spawns a worker loop for it.
 *
 * @param {FarRef<GuestPowers>} guestPowers - Guest powers from the Endo daemon
 * @param {Promise<LalContext> | LalContext | undefined} _context - Context for cancellation support
 * @returns {object} The Lal exo object
 */
export const make = (guestPowers, _context) => {
  /** @type {any} */
  const powers = guestPowers;

  // Send the configuration form to HOST for adding agents.
  const runManager = async () => {
    await E(powers).form(
      '@host',
      'Add an agent',
      harden([
        { name: 'name', label: 'Agent name' },
        {
          name: 'host',
          label: 'API host',
          default: 'http://localhost:11434/v1',
          example: 'https://api.anthropic.com for Anthropic',
        },
        {
          name: 'model',
          label: 'Model name',
          default: 'qwen3',
          example: 'claude-sonnet-4-6-20250514 for Anthropic',
        },
        {
          name: 'authToken',
          label: 'API auth token',
          default: 'ollama',
          example: 'sk-ant-... for Anthropic',
          secret: true,
        },
      ]),
    );

    // Resolve the host agent reference for provideGuest calls.
    const agent = await E(powers).lookup('host-agent');
    const selfLocator = await E(powers).locate('@self');
    const activeWorkers = new Map();

    // Check in the primer directory as a content-addressed readable-tree.
    // Stored once in the host namespace; each sub-guest gets a reference.
    const primerDirPath = new URL('./primer', import.meta.url).pathname;
    const localPrimerTree = makeLocalTree(primerDirPath);
    await E(agent).storeTree(localPrimerTree, 'lal-primer');
    const primerTreeId = await E(agent).identify('lal-primer');
    console.log(`[lal] Primer tree checked in (${primerTreeId})`);

    /**
     * Ensure the sub-guest has a `primer` reference.
     * @param {any} guest
     */
    const provisionPrimer = async guest => {
      const hasPrimer = await E(guest).has('primer');
      if (!hasPrimer) {
        await E(guest).storeIdentifier('primer', primerTreeId);
        console.log('[lal] Primer provisioned for guest');
      }
    };

    // Pre-scan existing messages to find our latest form messageId so that
    // old value messages (from prior sessions) that reply to an earlier form
    // are not accidentally matched when the iterator replays history.
    /** @type {string | undefined} */
    let formMessageId;
    const existingMessages = /** @type {any[]} */ (
      await E(powers).listMessages()
    );
    for (const msg of existingMessages) {
      // eslint-disable-next-line @endo/restrict-comparison-operands
      if (msg.from === selfLocator && msg.type === 'form') {
        formMessageId = msg.messageId;
      }
    }

    const messageIterator = makeRefIterator(E(powers).followMessages());
    while (true) {
      const { value: message, done } = await messageIterator.next();
      if (done) break;

      const msg = /** @type {any} */ (message);

      // Capture the form's messageId from our own outbound message.
      // eslint-disable-next-line @endo/restrict-comparison-operands
      if (msg.from === selfLocator && msg.type === 'form') {
        formMessageId = msg.messageId;
      } else if (
        msg.type === 'value' &&
        // eslint-disable-next-line @endo/restrict-comparison-operands
        msg.replyTo === formMessageId
      ) {
        // Only process value messages that reply to our form.
        try {
          // Resolve the submitted values from the value message.
          const config =
            /** @type {{ name: string, host: string, model: string, authToken: string }} */ (
              await E(powers).lookupById(msg.valueId)
            );

          const { name } = config;

          if (activeWorkers.has(name)) {
            // A worker is already running for this name.
            await E(powers).reply(
              msg.number,
              [`Agent "${name}" already exists.`],
              [],
              [],
            );
          } else {
            // Create the guest profile via the host agent.
            // provideGuest returns the full EndoGuest (not the handle).
            // Guard with has() so restart re-uses the existing guest;
            // re-running provideGuest on an existing name throws
            // "Formula already exists".
            let guest;
            if (await E(agent).has(name)) {
              guest = await E(agent).lookup(name);
            } else {
              guest = await E(agent).provideGuest(name, {
                agentName: `profile-for-${name}`,
              });
            }

            // Ensure the sub-guest has the primer directory.
            await provisionPrimer(guest);

            // Spawn a worker loop for this guest.
            const workerP = spawnWorkerLoop(guest, null, {
              LAL_HOST: config.host,
              LAL_MODEL: config.model,
              LAL_AUTH_TOKEN: config.authToken,
            });
            activeWorkers.set(name, workerP);
            workerP.catch(error => {
              console.error(`[lal] Worker "${name}" error:`, error);
              activeWorkers.delete(name);
            });

            await E(powers).reply(
              msg.number,
              [`Agent "${name}" is now running.`],
              [],
              [],
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('[lal] Form submission error:', errorMessage);
          try {
            await E(powers).reply(
              msg.number,
              [`Error creating agent: ${errorMessage}`],
              [],
              [],
            );
          } catch {
            // Best-effort reply.
          }
        }
      }
    }
  };

  runManager().catch(error => {
    console.error('[lal] Manager error:', error);
  });

  return makeExo('Lal', LalInterface, {
    /**
     * @param {string} [methodName]
     * @returns {string}
     */
    help(methodName) {
      if (methodName === undefined) {
        return 'Lal agent manager. Submit the configuration form to add agents.';
      }
      return `No documentation for method "${methodName}".`;
    },
  });
};
