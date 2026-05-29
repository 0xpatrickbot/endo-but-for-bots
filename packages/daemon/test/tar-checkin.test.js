// @ts-nocheck
// Establish a perimeter:
// eslint-disable-next-line import/order
import '@endo/init/debug.js';

import test from 'ava';
import { makeReaderRef } from '../index.js';
import { checkinTarTree } from '../src/daemon.js';

const TAR_BLOCK_SIZE = 512;

/**
 * Build a minimal ustar file entry (header + content + block padding).
 *
 * @param {string} name
 * @param {Uint8Array} content
 */
const tarEntry = (name, content) => {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const enc = new TextEncoder();
  header.set(enc.encode(name).subarray(0, 100), 0);
  header.set(enc.encode('0000644\0'), 100);
  header.set(enc.encode('0000000\0'), 108);
  header.set(enc.encode('0000000\0'), 116);
  header.set(
    enc.encode(`${content.byteLength.toString(8).padStart(11, '0')}\0`),
    124,
  );
  header.set(enc.encode('00000000000\0'), 136);
  header.set(enc.encode('0'), 156); // regular file
  header.set(enc.encode('ustar\0'), 257);
  const pad =
    (TAR_BLOCK_SIZE - (content.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  const out = new Uint8Array(TAR_BLOCK_SIZE + content.byteLength + pad);
  out.set(header, 0);
  out.set(content, TAR_BLOCK_SIZE);
  return out;
};

const concatBytes = parts => {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
};

// A content store that records, per stored blob, how many chunks the
// streamed generator yielded and a caller-supplied probe value sampled
// the moment each store completes.
const makeRecordingStore = probe => {
  /** @type {Array<{ chunks: number, probeAtComplete: number }>} */
  const blobs = [];
  let counter = 0;
  return {
    blobs,
    store: async iterable => {
      let chunks = 0;
      // eslint-disable-next-line no-unused-vars
      for await (const chunk of iterable) {
        chunks += 1;
      }
      counter += 1;
      blobs.push({ chunks, probeAtComplete: Number(probe()) });
      // Deterministic, content-independent fake hash.
      return `sha-${counter}`;
    },
  };
};

test('checkinTarTree streams entries without buffering the whole archive', async t => {
  // First file is tiny; second file is large (many content blocks).
  const small = new TextEncoder().encode('a');
  const large = new Uint8Array(4096).fill(98); // 'b' * 4096 → 8 content blocks
  const archive = concatBytes([
    tarEntry('a.txt', small),
    tarEntry('b.txt', large),
    new Uint8Array(TAR_BLOCK_SIZE * 2), // two zero blocks terminate the tar
  ]);

  // Deliver the archive in 64-byte slices (smaller than one tar block)
  // and count how many slices have been pulled so far.
  let chunksPulled = 0;
  const sliceSize = 64;
  const totalSlices = Math.ceil(archive.byteLength / sliceSize);
  async function* sliced() {
    for (let offset = 0; offset < archive.byteLength; offset += sliceSize) {
      chunksPulled += 1;
      yield archive.slice(offset, offset + sliceSize);
    }
  }

  const store = makeRecordingStore(() => chunksPulled);
  const readerRef = makeReaderRef(sliced());
  await checkinTarTree(readerRef, store);

  // Two blobs were stored plus tree-JSON blobs; the first two stored are
  // the file contents in archive order.
  t.true(store.blobs.length >= 2);
  const [aBlob, bBlob] = store.blobs;

  // Fail-closed: the previous implementation buffered the ENTIRE archive
  // (`readAllBase64`) before storing any blob, so every slice would have
  // been pulled (`chunksPulled === totalSlices`) by the time the first
  // blob completed. Incremental streaming completes `a.txt` long before
  // the large `b.txt` content has been pulled.
  t.true(
    aBlob.probeAtComplete < totalSlices,
    `expected a.txt to store before the archive was fully pulled (pulled ${aBlob.probeAtComplete} of ${totalSlices})`,
  );

  // The large blob is streamed as multiple chunks, not one buffered slab.
  t.true(
    bBlob.chunks > 1,
    `expected b.txt to stream in multiple chunks, got ${bBlob.chunks}`,
  );
});
