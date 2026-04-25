---
'@endo/pass-style': minor
'@endo/marshal': minor
---

Immutable `ArrayBuffer` (passStyle `'byteArray'`) is now serializable through
the capdata, smallcaps, and encode-passable codecs.

- `@endo/pass-style` gains `byteArrayToHex`, `hexToByteArray`,
  `byteArrayToUint8Array`, and `uint8ArrayToByteArray` helpers.
- `@endo/marshal`:
  - **capdata**: byteArray encodes as `{"@qclass":"byteArray","data":"<hex>"}`.
  - **smallcaps**: byteArray encodes as `"*<hex>"`.  The `*` prefix is now
    reserved.
  - **encode-passable**: byteArray encodes as
    `a<encodeBigInt(byteLength)>:<hex>`.  The Elias-delta length prefix gives
    shortlex ordering (matching `compareRank`) with no arbitrary size cap, and
    every character in the body is safe inside both `legacyOrdered` and
    `compactOrdered` array framings.
  - **marshal-justin**: renders byteArray as `hexToByteArray("<hex>")`.

Syrup already supported this value; no change required there.

Deploy sequencing: producers should not emit byteArrays until decoders are
upgraded.  Older decoders reject the new encodings (unknown `@qclass`,
unknown smallcaps prefix, unknown encode-passable prefix); consumers must
ship the new decoder before producers begin emitting byteArray values.
