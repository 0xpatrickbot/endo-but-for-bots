// @ts-check
/**
 * Mail / inbox tools: enumerating messages and responding to them via
 * resolve, reject, dismiss, request, send, and reply.
 *
 * (Note: `adopt` is mail-triggered but petname-shaped in effect and lives
 * in petnames.js with the other directory mutators.)
 *
 * @import { LalTool } from './index.js'
 */

import { M } from '@endo/patterns';
import { E } from '@endo/eventual-send';

const NamePathShape = M.arrayOf(M.string());
const NameOrPathShape = M.or(M.string(), NamePathShape);
const MessageNumberShape = M.or(M.bigint(), M.number());

/** @type {LalTool} */
export const listMessagesTool = {
  name: 'listMessages',
  summary:
    'List all messages in your inbox. Returns an array of message objects ' +
    'with number, date, from, type, and content. No arguments.',
  params: M.splitRecord({}),
  execute: async powers => {
    const rawMessages = await E(powers).listMessages();
    return harden(
      // The variant union of StampedMessage hides `strings`/`names` on
      // request/value branches; the dispatcher returns the package shape's
      // fields uniformly (undefined where absent), so we cast to a
      // permissive view to mirror the previous inline switch-case.
      rawMessages.map((/** @type {any} */ msg) => ({
        number: msg.number,
        date: msg.date,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        strings: msg.strings,
        names: msg.names,
        messageId: msg.messageId,
        replyTo: msg.replyTo,
      })),
    );
  },
};
harden(listMessagesTool);

/** @type {LalTool} */
export const resolveTool = {
  name: 'resolve',
  summary:
    'Respond to a request message by providing a named value. ' +
    'Arguments: messageNumber (SmallCaps BigInt like "+5"), petNameOrPath.',
  params: M.splitRecord({
    messageNumber: MessageNumberShape,
    petNameOrPath: NameOrPathShape,
  }),
  bigintArgs: ['messageNumber'],
  execute: async (powers, args) => {
    const { messageNumber, petNameOrPath } = args;
    if (messageNumber === undefined || petNameOrPath === undefined) {
      throw new Error('messageNumber and petNameOrPath are required');
    }
    return E(powers).resolve(messageNumber, petNameOrPath);
  },
};
harden(resolveTool);

/** @type {LalTool} */
export const rejectTool = {
  name: 'reject',
  summary:
    'Decline a request message. The requester receives an error. ' +
    'Arguments: messageNumber (SmallCaps BigInt like "+5"), optional reason (string).',
  params: M.splitRecord(
    { messageNumber: MessageNumberShape },
    { reason: M.string() },
  ),
  bigintArgs: ['messageNumber'],
  execute: async (powers, args) => {
    const { messageNumber, reason } = args;
    if (messageNumber === undefined) {
      throw new Error('messageNumber is required');
    }
    return E(powers).reject(messageNumber, reason);
  },
};
harden(rejectTool);

/** @type {LalTool} */
export const dismissTool = {
  name: 'dismiss',
  summary:
    'Remove a message from your inbox. Use after you have processed a message. ' +
    'Argument: messageNumber (SmallCaps BigInt like "+5").',
  params: M.splitRecord({ messageNumber: MessageNumberShape }),
  bigintArgs: ['messageNumber'],
  execute: async (powers, args) => {
    const { messageNumber } = args;
    if (messageNumber === undefined) {
      throw new Error('messageNumber is required');
    }
    return E(powers).dismiss(messageNumber);
  },
};
harden(dismissTool);

/** @type {LalTool} */
export const requestTool = {
  name: 'request',
  summary:
    'Send a request to another agent asking for a capability. ' +
    'Arguments: recipientName, description (string), optional responseName.',
  params: M.splitRecord(
    { recipientName: NameOrPathShape, description: M.string() },
    { responseName: NameOrPathShape },
  ),
  execute: async (powers, args) => {
    const { recipientName, description, responseName } = args;
    if (recipientName === undefined || description === undefined) {
      throw new Error('recipientName and description are required');
    }
    return E(powers).request(recipientName, description, responseName);
  },
};
harden(requestTool);

/** @type {LalTool} */
export const sendTool = {
  name: 'send',
  summary:
    'Send a package message with values to another agent. ' +
    'Arguments: recipientName, strings (string[]), edgeNames (string[]), petNames. ' +
    'For text-only messages: send("@host", ["text"], [], []).',
  params: M.splitRecord({
    recipientName: NameOrPathShape,
    strings: M.arrayOf(M.string()),
    edgeNames: M.arrayOf(M.string()),
    petNames: M.arrayOf(NameOrPathShape),
  }),
  execute: async (powers, args) => {
    const { recipientName, strings, edgeNames, petNames } = args;
    if (recipientName === undefined || !strings || !edgeNames || !petNames) {
      throw new Error(
        'recipientName, strings, edgeNames, and petNames are required',
      );
    }
    return E(powers).send(recipientName, strings, edgeNames, petNames);
  },
};
harden(sendTool);

/** @type {LalTool} */
export const replyTool = {
  name: 'reply',
  summary:
    'Reply to a message in your inbox, threading the response to the original message. ' +
    'Use this instead of send() when responding to a received message. ' +
    'Arguments: messageNumber, strings (string[]), edgeNames (string[]), petNames.',
  params: M.splitRecord({
    messageNumber: MessageNumberShape,
    strings: M.arrayOf(M.string()),
    edgeNames: M.arrayOf(M.string()),
    petNames: M.arrayOf(NameOrPathShape),
  }),
  bigintArgs: ['messageNumber'],
  execute: async (powers, args) => {
    const { messageNumber, strings, edgeNames, petNames } = args;
    if (messageNumber === undefined || !strings || !edgeNames || !petNames) {
      throw new Error(
        'messageNumber, strings, edgeNames, and petNames are required',
      );
    }
    return E(powers).reply(messageNumber, strings, edgeNames, petNames);
  },
};
harden(replyTool);
