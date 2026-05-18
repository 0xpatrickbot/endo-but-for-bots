// @ts-nocheck - E() generics don't work well with JSDoc types for remote objects
/* eslint-disable no-await-in-loop */

import { makeExo } from '@endo/exo';
import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';
import { passableAsJustin, makeMarshal } from '@endo/marshal';
import { makeRefIterator } from '@endo/daemon/ref-reader.js';
import { makeLocalTree } from '@endo/platform/fs/node';

import { registerBuiltInApiProviders } from '@mariozechner/pi-ai';
import { makePiAgent, runAgentRound } from '@endo/genie';

/** @import { FarRef } from '@endo/eventual-send' */
/** @import { GuestPowers, ToolCallArgs, InboxMessage, LalContext } from './agent.types.js' */

// Register pi-ai's built-in providers (anthropic, openai, gemini, ollama, etc.)
// so getModel(provider, modelId) lookups succeed for any caller-supplied
// "provider/modelId" string.
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
// Each tool is named, has a one-line summary (used by pi-agent-core as the
// tool description sent to the LLM), and an `execute(powers, args)` callback
// that calls into the daemon. The `parameters` field captures the JSON-schema
// shape the LLM should target; `makePiAgent` accepts a permissive open object
// schema by default, so the field is primarily for documentation today. When
// `pi-agent-core` learns to forward custom parameter schemas this field will
// be wired through directly.
//
// Tool dispatch lives entirely in this module: `executeTool` is the single
// `switch` that maps tool names to `E(powers)` calls. The set of tools is the
// same surface lal exposed before the genie migration; only the agent loop
// driving them has been replaced.

/**
 * @typedef {object} LalToolDef
 * @property {string} name
 * @property {string} summary - one-line description sent to the LLM.
 * @property {object} [parameters] - JSON-schema-like shape (for documentation).
 */

/** @type {LalToolDef[]} */
const toolDefs = [
  // --- Self-documentation ---
  {
    name: 'help',
    summary:
      'Get documentation for guest capabilities or a specific method. ' +
      'Call with no arguments for an overview, or with a method name for specific documentation.',
  },

  // --- Directory operations ---
  {
    name: 'has',
    summary:
      'Check if a pet name exists in the directory. Returns true or false. ' +
      'Argument: petNamePath (string[]).',
  },
  {
    name: 'list',
    summary:
      'List contents of your directory or any capability you have a pet name for. ' +
      'With no arguments, lists pet names in your root directory. ' +
      'With a name, looks up that capability and calls list() on it. ' +
      'Optional argument: name (string or string[]).',
  },
  {
    name: 'lookup',
    summary:
      'Resolve a pet name or path to its value. Returns the value stored under that name. ' +
      'Argument: petNameOrPath (string or string[]).',
  },
  {
    name: 'remove',
    summary:
      'Remove a pet name from the directory. The underlying value is not deleted, just the name mapping. ' +
      'Argument: petNamePath (string[]).',
  },
  {
    name: 'move',
    summary:
      'Move/rename a reference from one name to another. The original name is removed. ' +
      'Arguments: fromPath (string[]), toPath (string[]).',
  },
  {
    name: 'copy',
    summary:
      'Copy a reference to a new name. Both names will refer to the same value. ' +
      'Arguments: fromPath (string[]), toPath (string[]).',
  },
  {
    name: 'makeDirectory',
    summary:
      'Create a new subdirectory at the given path. ' +
      'Argument: petNamePath (string[]).',
  },

  // --- Mail operations ---
  {
    name: 'listMessages',
    summary:
      'List all messages in your inbox. Returns an array of message objects ' +
      'with number, date, from, type, and content. No arguments.',
  },
  {
    name: 'resolve',
    summary:
      'Respond to a request message by providing a named value. ' +
      'Arguments: messageNumber (SmallCaps BigInt like "+5"), petNameOrPath.',
  },
  {
    name: 'reject',
    summary:
      'Decline a request message. The requester receives an error. ' +
      'Arguments: messageNumber (SmallCaps BigInt like "+5"), optional reason (string).',
  },
  {
    name: 'adopt',
    summary:
      'Adopt a value from an incoming package message, giving it a pet name. ' +
      'Arguments: messageNumber, edgeName, petName.',
  },
  {
    name: 'dismiss',
    summary:
      'Remove a message from your inbox. Use after you have processed a message. ' +
      'Argument: messageNumber (SmallCaps BigInt like "+5").',
  },
  {
    name: 'request',
    summary:
      'Send a request to another agent asking for a capability. ' +
      'Arguments: recipientName, description (string), optional responseName.',
  },
  {
    name: 'send',
    summary:
      'Send a package message with values to another agent. ' +
      'Arguments: recipientName, strings (string[]), edgeNames (string[]), petNames. ' +
      'For text-only messages: send("@host", ["text"], [], []).',
  },
  {
    name: 'reply',
    summary:
      'Reply to a message in your inbox, threading the response to the original message. ' +
      'Use this instead of send() when responding to a received message. ' +
      'Arguments: messageNumber, strings (string[]), edgeNames (string[]), petNames.',
  },

  // --- Identity ---
  {
    name: 'locate',
    summary:
      'Get the locator URL for a pet name. Returns an "endo://..." URL string. ' +
      'Use locate(["@self"]) to get your own locator. ' +
      'Argument: petNamePath (string[]).',
  },

  // --- Capability operations ---
  {
    name: 'inspect',
    summary:
      'Look up a capability by pet name and call its help() method to learn how to use it. ' +
      'Argument: petNameOrPath.',
  },
  {
    name: 'readText',
    summary:
      'Read text content from a capability (ReadableTree, WritableTree, etc.). ' +
      'Arguments: petNameOrPath, fileName (string).',
  },
  {
    name: 'writeText',
    summary:
      'Write text content to a capability (WritableTree, etc.). ' +
      'Arguments: petNameOrPath, fileName (string), content (string).',
  },

  // --- Code evaluation ---
  {
    name: 'evaluate',
    summary:
      'Evaluate JavaScript code directly. Arguments: workerName (string|undefined), ' +
      'source (string), codeNames (string[]), edgeNames (string[]), resultName.',
  },

  // --- Define (code with slots for host to fill) ---
  {
    name: 'define',
    summary:
      'Propose a reusable program with named capability slots for the host to fill. ' +
      'Unlike evaluate(), you do NOT provide the capabilities yourself. ' +
      'Arguments: source (string), slots (object mapping slot name to { label }).',
  },
];

// ============================================================================
// System Prompt
// ============================================================================

/** @type {string} */
const systemPrompt = `\
You are an Endo agent with Guest capabilities. You communicate entirely
through tool calls — do not write prose responses.

## Quick Reference

1. \`listMessages()\` — Check your inbox
2. \`locate(["@self"])\` — Get your identity (compare with message "from" to identify your own messages)
3. For received messages: \`adopt()\` values -> process -> \`reply()\` -> \`dismiss()\`

## Names

There are two kinds of name in your inventory:

- *Special names* start with \`@\` and are read-only and indelible
  (you cannot remove, rename, or overwrite them):
  - \`@self\` — Your own handle
  - \`@host\` — Your host agent
- *Pet names* are user-chosen labels like \`my-counter\` or
  \`project-data\`. You can create, rename, copy, and remove them
  freely. They are lowercase alphanumeric with hyphens
  (\`a-z0-9-\`, 1-128 chars).

## SmallCaps

Message numbers are BigInt. Use \`"+N"\` format: \`dismiss("+5")\`, \`reply("+3", ...)\`

## Key Rules

1. Reply to every received message using \`reply()\`, then \`dismiss()\` it
2. Adopt values first — if a message has values in its \`names\` array, adopt them before use
3. Prefer direct tools — use \`list()\`, \`readText()\`, \`writeText()\`, \`lookup()\`, etc. instead of \`evaluate()\`
4. No prose responses — communicate only through tool calls
5. Check before acting — use \`list()\` and \`has()\` to verify pet names exist

## Helping the User

Your user may be interacting with Endo through either the *Endo CLI*
(terminal commands like \`endo ls\`, \`endo send\`, \`endo adopt\`) or the
*Endo Chat* web UI (slash commands like \`/ls\`, \`/send\`, \`/adopt\`),
or both. When giving the user instructions or guidance:

- Frame instructions for *both* interfaces when practical.
  For example: "You can list your inventory with \`endo ls\` in the
  terminal or \`/ls\` in Chat."
- Read \`readText("primer", "cli-reference.md")\` and
  \`readText("primer", "chat-reference.md")\` for the full command
  lists in each interface.
- Read the scenario guides under \`readText("primer", "howto-*.md")\`
  for step-by-step walkthroughs of common tasks.
- Prefer the user's apparent interface when you can infer it; if
  uncertain, show both.

## Writing Programs

When the user asks you to write, create, propose, or build a program,
**always use the \`define()\` tool**. Do not use \`evaluate()\` — the user
expects to review the code and choose which capabilities to bind.

- Each endowment the code needs becomes a named slot in the \`slots\`
  parameter with a descriptive label.
- The code receives endowments as lexical bindings (variable names
  matching the slot keys).
- The *completion value* (last expression) is the result. Make sure
  the final expression evaluates to whatever the program should produce.
- Top-level \`await\` is not supported. For a single async call, the
  promise itself is the completion value. For multiple async steps,
  wrap in an async IIFE: \`(async () => { ... })()\`.

Example — propose a program that reads a file from a directory:
\`\`\`
define("E(dir).readText('config.json')", {
  "dir": {"label": "Directory containing config.json"}
})
\`\`\`

## Primer

You have a \`primer\` directory in your inventory with detailed documentation.
Use the \`readText\` and \`list\` tools to read it:

\`\`\`
list("primer")          // See available docs
readText("primer", "README.md")   // Overview and table of contents
\`\`\`

The primer contains:
- Agent tool reference, messaging, capabilities, encoding, formatting, errors
- CLI and Chat command references
- How-to guides for common scenarios

When you encounter an unfamiliar situation, read the relevant primer document
before resorting to \`evaluate()\`. For unfamiliar capabilities, use
\`inspect("name")\` to call their \`help()\` method.
`;

// ============================================================================
// Tool Dispatch
// ============================================================================

// SmallCaps marshal for decoding pi-ai tool call arguments. pi-ai passes
// arguments as plain objects after JSON-parsing; this round-trip lets the
// LLM emit SmallCaps tokens like "+5" (BigInt 5) and "#undefined" inside
// argument values, preserving the existing protocol.
const { unserialize } = makeMarshal(undefined, undefined, {
  serializeBodyFormat: 'smallcaps',
});

/**
 * Decode a value that may contain SmallCaps-encoded primitives. The pi-ai
 * harness gives us objects with already-parsed JSON; we round-trip through
 * SmallCaps to recover BigInts and other SmallCaps-only primitives.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
const decodeSmallcapsValue = value => {
  if (value === undefined || value === null) return value;
  try {
    // Re-serialize as JSON, then ask the SmallCaps marshal to deserialize
    // the structure. This preserves the existing "+N" => BigInt convention
    // while passing through plain primitives untouched.
    const jsonString =
      typeof value === 'string' ? value : JSON.stringify(value);
    return unserialize({ body: `#${jsonString}`, slots: [] });
  } catch {
    return value;
  }
};

/**
 * Build the executeTool callback bound to a specific guest's powers. The
 * returned function is the `execTool` parameter to `makePiAgent`; it must
 * always resolve (errors propagate as the tool's `details`/`content`).
 *
 * @param {any} powers - Guest powers
 * @returns {(name: string, args: ToolCallArgs) => Promise<unknown>}
 */
const makeExecuteTool = powers => {
  const executeTool = async (name, rawArgs) => {
    // pi-agent-core delivers args as an object. Run SmallCaps decoding so
    // numeric-shaped strings like "+5" become BigInts before dispatch.
    const args = /** @type {ToolCallArgs} */ (decodeSmallcapsValue(rawArgs));
    switch (name) {
      // Self-documentation
      case 'help': {
        const { methodName } = args;
        return E(powers).help(methodName);
      }

      // Directory operations
      case 'has': {
        const { petNamePath } = args;
        if (!petNamePath) {
          throw new Error('petNamePath is required');
        }
        return E(powers).has(...petNamePath);
      }
      case 'list': {
        // eslint-disable-next-line no-shadow
        const { name: lookupName } = args;
        if (lookupName !== undefined) {
          const capability = await E(powers).lookup(lookupName);
          return E(capability).list();
        }
        return E(powers).list();
      }
      case 'lookup': {
        const { petNameOrPath } = args;
        if (petNameOrPath === undefined) {
          throw new Error('petNameOrPath is required');
        }
        return E(powers).lookup(petNameOrPath);
      }
      case 'remove': {
        const { petNamePath } = args;
        if (!petNamePath) {
          throw new Error('petNamePath is required');
        }
        return E(powers).remove(...petNamePath);
      }
      case 'move': {
        const { fromPath, toPath } = args;
        if (!fromPath || !toPath) {
          throw new Error('fromPath and toPath are required');
        }
        return E(powers).move(fromPath, toPath);
      }
      case 'copy': {
        const { fromPath, toPath } = args;
        if (!fromPath || !toPath) {
          throw new Error('fromPath and toPath are required');
        }
        return E(powers).copy(fromPath, toPath);
      }
      case 'makeDirectory': {
        const { petNamePath } = args;
        if (!petNamePath) {
          throw new Error('petNamePath is required');
        }
        return E(powers).makeDirectory(petNamePath);
      }

      // Mail operations
      case 'listMessages': {
        const rawMessages = await E(powers).listMessages();
        return harden(
          rawMessages.map(
            (
              /** @type {InboxMessage & {messageId?: string, replyTo?: string}} */ msg,
            ) => ({
              number: msg.number,
              date: msg.date,
              from: msg.from,
              to: msg.to,
              type: msg.type,
              strings: msg.strings,
              names: msg.names,
              messageId: msg.messageId,
              replyTo: msg.replyTo,
            }),
          ),
        );
      }
      case 'resolve': {
        const { messageNumber, petNameOrPath } = args;
        if (messageNumber === undefined || petNameOrPath === undefined) {
          throw new Error('messageNumber and petNameOrPath are required');
        }
        return E(powers).resolve(messageNumber, petNameOrPath);
      }
      case 'reject': {
        const { messageNumber, reason } = args;
        if (messageNumber === undefined) {
          throw new Error('messageNumber is required');
        }
        return E(powers).reject(messageNumber, reason);
      }
      case 'adopt': {
        const { messageNumber, edgeName, petName } = args;
        if (
          messageNumber === undefined ||
          edgeName === undefined ||
          petName === undefined
        ) {
          throw new Error('messageNumber, edgeName, and petName are required');
        }
        return E(powers).adopt(messageNumber, edgeName, petName);
      }
      case 'dismiss': {
        const { messageNumber } = args;
        if (messageNumber === undefined) {
          throw new Error('messageNumber is required');
        }
        return E(powers).dismiss(messageNumber);
      }
      case 'request': {
        const { recipientName, description, responseName } = args;
        if (recipientName === undefined || description === undefined) {
          throw new Error('recipientName and description are required');
        }
        return E(powers).request(recipientName, description, responseName);
      }
      case 'send': {
        const { recipientName, strings, edgeNames, petNames } = args;
        if (
          recipientName === undefined ||
          !strings ||
          !edgeNames ||
          !petNames
        ) {
          throw new Error(
            'recipientName, strings, edgeNames, and petNames are required',
          );
        }
        return E(powers).send(recipientName, strings, edgeNames, petNames);
      }
      case 'reply': {
        const { messageNumber, strings, edgeNames, petNames } = args;
        if (
          messageNumber === undefined ||
          !strings ||
          !edgeNames ||
          !petNames
        ) {
          throw new Error(
            'messageNumber, strings, edgeNames, and petNames are required',
          );
        }
        return E(powers).reply(messageNumber, strings, edgeNames, petNames);
      }

      // Identity
      case 'locate': {
        const { petNamePath } = args;
        if (!petNamePath) {
          throw new Error('petNamePath is required');
        }
        return E(powers).locate(...petNamePath);
      }

      // Capability operations
      case 'inspect': {
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
          parts.push(
            `Capability at "${petNameOrPath}" does not implement help().`,
          );
        }
        try {
          // eslint-disable-next-line no-underscore-dangle
          const methods = await E(capability).__getMethodNames__();
          parts.push(`\nMethods: ${methods.join(', ')}`);
        } catch {
          // No __getMethodNames__ available.
        }
        return parts.join('\n');
      }
      case 'readText': {
        const { petNameOrPath, fileName } = args;
        if (petNameOrPath === undefined || fileName === undefined) {
          throw new Error('petNameOrPath and fileName are required');
        }
        const capability = await E(powers).lookup(petNameOrPath);
        return E(capability).readText(fileName);
      }
      case 'writeText': {
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
      }

      // Code evaluation
      case 'evaluate': {
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
      }

      // Define code with slots for host to fill
      case 'define': {
        const { source, slots } = args;
        if (source === undefined) {
          throw new Error('source is required');
        }
        if (slots === undefined) {
          throw new Error('slots is required');
        }
        return E(powers).define(source, harden(slots));
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
  // listTools / execTool pair pi-agent-core expects.
  const executeTool = makeExecuteTool(powers);
  const listTools = () =>
    toolDefs.map(({ name, summary }) => ({ name, summary }));
  const execTool = async (name, args) => executeTool(name, args);

  const piAgent = await makePiAgent({
    model,
    systemPrompt,
    listTools,
    execTool,
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

      // Skip our own outbound messages.
      // eslint-disable-next-line @endo/restrict-comparison-operands
      if (fromLocator === selfLocator) {
        continue;
      }

      console.log(`[mail] New message #${number} (type: ${type || 'package'})`);

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
 *   contains "generativelanguage.googleapis.com" or "gemini" -> "gemini"
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
    provider = 'gemini';
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
 * @param {Promise<LalContext> | LalContext | undefined} _context
 * @returns {object} The Lal exo object
 */
export const make = (guestPowers, _context) => {
  /** @type {any} */
  const powers = guestPowers;

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

    const agent = await E(powers).lookup('host-agent');
    const selfLocator = await E(powers).locate('@self');
    const activeWorkers = new Map();

    // Check in the primer directory as a content-addressed readable-tree.
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

      // eslint-disable-next-line @endo/restrict-comparison-operands
      if (msg.from === selfLocator && msg.type === 'form') {
        formMessageId = msg.messageId;
      } else if (
        msg.type === 'value' &&
        // eslint-disable-next-line @endo/restrict-comparison-operands
        msg.replyTo === formMessageId
      ) {
        try {
          const config =
            /** @type {{ name: string, host: string, model: string, authToken: string }} */ (
              await E(powers).lookupById(msg.valueId)
            );

          const { name } = config;

          if (activeWorkers.has(name)) {
            await E(powers).reply(
              msg.number,
              [`Agent "${name}" already exists.`],
              [],
              [],
            );
          } else {
            let guest;
            if (await E(agent).has(name)) {
              guest = await E(agent).lookup(name);
            } else {
              guest = await E(agent).provideGuest(name, {
                agentName: `profile-for-${name}`,
              });
            }

            await provisionPrimer(guest);

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
