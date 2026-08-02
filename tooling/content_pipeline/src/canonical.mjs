// ─────────────────────────────────────────────────────────────────────────────
// canonical.mjs — ONE serialisation, used by the writer and the signer.
//
// 🔴 THE FAILURE THIS EXISTS TO REMOVE. A signer that re-serialises the manifest
// instead of signing the bytes it wrote produces a pack that verifies on the
// pipeline machine and fails on every client in the field. Key order, indentation
// and the trailing newline are all part of the signed message, and JSON.stringify
// preserves *insertion* order — so a manifest assembled in a different order in
// two places is two different messages that both look like "the manifest".
//
// So there is exactly one writer (`canonicalJson`), it fixes key order explicitly
// via `orderedKeys`, and `pack.mjs` hands the SAME Buffer to writeFileSync and to
// the signer. Nothing re-derives it.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

/** The manifest's key order, fixed. Matches ContentPackManifest.toJson() in
 *  packages/core/lib/src/content/content_pack.dart so a reader comparing the two
 *  by eye sees the same document. */
export const MANIFEST_KEY_ORDER = [
  'pack_id',
  'version',
  'key_id',
  'content_hash',
  'assets',
  'generators',
  'locales',
];

/** Deterministic JSON bytes: two-space indent, trailing newline, keys in the
 *  order `order` names (any remaining keys follow, sorted, so an added field is
 *  still deterministic rather than insertion-ordered). */
export function canonicalJson(value, order = null) {
  const ordered = order ? reorder(value, order) : value;
  return Buffer.from(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

function reorder(obj, order) {
  const out = {};
  for (const k of order) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  for (const k of Object.keys(obj).sort()) if (!(k in out)) out[k] = obj[k];
  return out;
}

/** Lower-case hex sha256, the encoding ContentPackLoader compares against
 *  (`sha256.convert(bytes).toString()` in Dart is lower-case hex). */
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
