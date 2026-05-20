// @ts-check
/**
 * SmallCaps helpers for agentic tool dispatch.
 *
 * SmallCaps is the marshal format used inside Endo for cross-vat object
 * references; it reserves a small set of leading characters
 * (`!"#$%&'()*+,-`) to encode BigInts, sentinels, symbols, and
 * remotables in string positions. Agentic harnesses that present a
 * JSON-shaped tool API to an LLM cannot run the full SmallCaps marshal
 * across LLM-emitted args — a user-text string like `"+15551234567"`,
 * `"#main"`, or `"%percentage"` would be silently mutated before the
 * tool sees it (#290 review, kriskowal, 2026-05-20).
 *
 * Instead, harnesses opt-in per-tool to BigInt coercion on the fields
 * whose schema declares `bigintArgs`. The helpers below carry out that
 * narrow coercion: `coerceBigintArg` for one value,
 * `coerceBigintArgs` for an args record.
 */

const BIGINT_LITERAL_RE = /^[+-]\d+$/;

/**
 * Coerce a single value to a BigInt when it is shaped like a SmallCaps
 * BigInt literal (`"+N"` or `"-N"`). Plain numbers and existing BigInts
 * are passed through; the caller's pattern matcher should tolerate
 * both. Anything that does not look like a BigInt literal is returned
 * unchanged so the matcher can reject it with a clear "must be a
 * bigint" diagnostic.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export const coerceBigintArg = value => {
  if (typeof value !== 'string') return value;
  if (!BIGINT_LITERAL_RE.test(value)) return value;
  try {
    return BigInt(value);
  } catch {
    return value;
  }
};
harden(coerceBigintArg);

/**
 * Coerce the named bigint-typed fields of an args record (returning a
 * fresh object; the input is not mutated). Non-bigint fields are
 * copied through verbatim with no SmallCaps interpretation. This is
 * the entirety of SmallCaps decoding a JSON-wire tool dispatch should
 * perform on inbound args; every other primitive shape is left to the
 * LLM's JSON.
 *
 * @param {Record<string, unknown>} args
 * @param {readonly string[]} bigintArgs
 * @returns {Record<string, unknown>}
 */
export const coerceBigintArgs = (args, bigintArgs) => {
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
harden(coerceBigintArgs);
