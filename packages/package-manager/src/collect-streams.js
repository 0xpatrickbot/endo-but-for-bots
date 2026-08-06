// @ts-check
/// <reference types="ses"/>

/**
 * Drain an async-iterable byte stream into a UTF-8 string, bounded to
 * `maxBytes`. Once the cap is reached remaining chunks are still read to
 * EOF (so the child never blocks on a full pipe) but discarded.
 *
 * @param {AsyncIterable<Uint8Array> | null | undefined} stream
 * @param {number} maxBytes
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
export const drainBounded = async (stream, maxBytes) => {
  if (stream === null || stream === undefined) {
    return { text: '', truncated: false };
  }
  /** @type {Uint8Array[]} */
  const kept = [];
  let total = 0;
  let truncated = false;
  await null;
  try {
    for await (const chunk of stream) {
      const bytes =
        chunk instanceof Uint8Array
          ? chunk
          : new TextEncoder().encode(String(chunk));
      if (truncated) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (total + bytes.length <= maxBytes) {
        kept.push(bytes);
        total += bytes.length;
      } else {
        const remaining = maxBytes - total;
        if (remaining > 0) {
          kept.push(bytes.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
      }
    }
  } catch {
    // Process likely killed mid-stream; return partial capture.
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of kept) {
    buf.set(c, offset);
    offset += c.length;
  }
  return { text: new TextDecoder().decode(buf), truncated };
};
harden(drainBounded);
