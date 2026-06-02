// @ts-check
/// <reference types="ses"/>

import { E } from '@endo/far';

/**
 * Mirror Fae's existing read-file truncation cap so the capability slice
 * is a behavior-preserving swap of the *substrate* (ambient `fs` for an
 * `EndoMount`), not a change in the tool's contract to the LLM.
 */
const MAX_TEXT_CHARS = 50_000;

/**
 * @typedef {object} ToolContribution
 * @property {() => object} schema OpenAI-format tool schema.
 * @property {(args: Record<string, unknown>) => Promise<string>} execute
 *   Dispatch target for a `mountReadText` tool call.
 * @property {() => string} help One-line capability description.
 */

/**
 * A read-only filesystem tool backed by an `EndoMount` (or a `readOnly()`
 * `ReadableTree` view of one). Reads a single text file by mount-relative
 * path and returns its contents.
 *
 * Confinement (`..`-clamping at the mount root and symlink-escape
 * rejection), and fail-closed revocation, are the mount's job, not this
 * tool's: the tool holds a capability reference, never a path string,
 * never `fs`, and never resolves an absolute path. A `../` escape is
 * clamped inside the mount exo; a symlink that points outside the mount
 * is rejected by the mount's `realPath` resolution; and once the mount
 * formula is cancelled or garbage-collected the next `E(mount).readText`
 * rejects because the eventual-send target no longer resolves. The tool
 * carries no path-safety logic of its own, which is the whole point of
 * the capability shape.
 *
 * The LLM supplies a single `path` string. `EndoMount` treats a string
 * argument as one path *segment* and rejects an embedded `/`, so the
 * tool splits the path on `/` into a segment array before the send: the
 * mount normalizes the segments, clamps any `..` at the mount root, and
 * confines the result. The split is the tool's only path handling; it
 * resolves nothing and asserts nothing — `'../secret'` becomes
 * `['..', 'secret']`, which the mount clamps to a path that does not
 * escape, and the read rejects there, not here.
 *
 * The maker binds to `E(mount).readText(segments)` — the one-round-trip
 * surface (liaison directive). The alternative is the stronger
 * structural guarantee offered by a `readOnly()` `ReadableTree` view,
 * where the mutating methods are absent from the exo entirely rather
 * than merely guarded; over that narrowed view the read goes through
 * `lookup(segments)` → mount-file `text()`:
 *
 *   const view = E(mount).readOnly(); // a ReadableTree
 *   const content = await E(await E(view).lookup(segments)).text();
 *
 * That costs a second eventual-send per read in exchange for the
 * absent-method guarantee. To swap the binding, replace the single
 * `E(mount).readText(segments)` send in `execute` below with the
 * two-send `lookup` → `text` chain; the rest of the tool is unchanged.
 *
 * @param {import('@endo/far').ERef<{
 *   readText: (path: string | string[]) => Promise<string>,
 * }>} mount An `EndoMount` ERef. Authority is shaped by attenuating the
 *   mount, never by the tool gating itself. Read-only attenuation for
 *   this `readText`-binding maker is a mount minted with `readOnly:
 *   true` (its mutating methods reject, but `readText` is still present);
 *   subtree scoping is `E(mount).lookup(subdir)`. The `readOnly()`
 *   `ReadableTree` view is *not* a drop-in here — it structurally omits
 *   `readText`, so it is the alternative-binding surface documented
 *   above (`lookup` → `text`), not an argument to this maker.
 * @returns {ToolContribution}
 */
export const makeMountReadTool = mount => {
  const schema = harden({
    type: 'function',
    function: {
      name: 'mountReadText',
      description:
        'Read a UTF-8 text file from the mounted project directory. ' +
        'Path is relative to the mount root; "../" escapes are rejected.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Mount-relative path to the file to read.',
          },
        },
        required: ['path'],
      },
    },
  });

  return harden({
    schema: () => schema,
    async execute(args) {
      const { path } = /** @type {{ path?: unknown }} */ (args);
      if (typeof path !== 'string' || path === '') {
        throw new Error('mountReadText requires a non-empty string path');
      }
      // Split into mount segments. The mount rejects a '/' inside a
      // single string segment, so a multi-component path must be handed
      // over as a segment array. Leading/trailing slashes and empty
      // interior segments collapse to '.' so the mount's segment
      // validator (which rejects empty segments) is not tripped by a
      // path like 'a//b' or '/a'.
      const segments = path.split('/').map(segment => segment || '.');
      const content = await E(mount).readText(segments);
      if (content.length > MAX_TEXT_CHARS) {
        return `${content.slice(0, MAX_TEXT_CHARS)}\n\n... (truncated, ${content.length} chars total)`;
      }
      return content;
    },
    help: () =>
      'Read a text file from the mounted project directory (read-only).',
  });
};
harden(makeMountReadTool);
