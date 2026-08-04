// @ts-check

/** @import { ERef } from '@endo/eventual-send' */
/** @import { Client } from '@endo/ocapn/client/types' */

import harden from '@endo/harden';
import { makeOcapn } from '@endo/ocapn';

/**
 * The worker and hub fixtures expose several capabilities with different
 * method sets.
 * `fetch` and `evaluate` are the common capability-producing methods;
 * the open method index covers the fixture-specific methods used by tests.
 *
 * @template [MethodResult=any]
 * @typedef {Record<string, (...args: unknown[]) => MethodResult> & {
 *   fetch: (swissnum: ArrayBufferLike) => ERef<ThixotropeRemote>,
 *   evaluate: (source: string, endowments?: Record<string, unknown>) => ERef<MethodResult>,
 *   getGift: () => ERef<{ gift: Promise<unknown> }>,
 * }} ThixotropeRemote
 * @typedef {object} ThixotropeBootstrap
 * @property {(swissnum: ArrayBufferLike) => ERef<ThixotropeRemote>} fetch
 */

/**
 * Construct a test OCapN client with the bootstrap interface shared by the
 * worker and hub fixtures.
 *
 * @param {Parameters<typeof makeOcapn>[0]} options
 * @returns {Promise<Client<ThixotropeBootstrap>>}
 */
export const makeTestOcapn = options =>
  makeOcapn(options).then(client =>
    /** @type {Client<ThixotropeBootstrap>} */ (/** @type {unknown} */ (client)),
  );
harden(makeTestOcapn);
