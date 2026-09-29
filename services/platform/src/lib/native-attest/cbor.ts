// ─────────────────────────────────────────────────────────────────────────────
// cbor.ts — the smallest CBOR decoder an App Attest attestation and assertion
// need (RFC 8949 major types 0-5 and the three simple values), and nothing more
// (⏱ 2026-09-29, ADR no.NNN).
//
// 🔴 IT REFUSES RATHER THAN GUESSES: indefinite lengths, tags, floats, a length
// past the input, nesting deeper than MAX_DEPTH and trailing bytes all throw.
// The input is attacker-supplied bytes on an unauthenticated route, so every
// length is checked against what is left before anything is allocated.
// ─────────────────────────────────────────────────────────────────────────────

export type Cbor = number | Uint8Array | string | boolean | null | Cbor[] | Map<string | number, Cbor>;

/** @ceiling none — an INPUT SHAPE bound on attacker-supplied CBOR, not a platform resource: an App Attest object nests three deep. */
const MAX_DEPTH = 8;

export class CborError extends Error {}

export function decodeCbor(input: Uint8Array): Cbor {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let pos = 0;

  const need = (n: number) => {
    if (n < 0 || pos + n > input.length) throw new CborError('truncated');
  };

  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return input[pos++]!;
    }
    if (info === 25) {
      need(2);
      const v = view.getUint16(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      need(4);
      const v = view.getUint32(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      const hi = view.getUint32(pos);
      const lo = view.getUint32(pos + 4);
      pos += 8;
      if (hi > 0x1fffff) throw new CborError('integer past 2^53');
      return hi * 2 ** 32 + lo;
    }
    throw new CborError('indefinite or reserved length');
  };

  const item = (depth: number): Cbor => {
    if (depth > MAX_DEPTH) throw new CborError('nested too deep');
    need(1);
    const head = input[pos++]!;
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2: {
        const n = length(info);
        need(n);
        const out = input.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 3: {
        const n = length(info);
        need(n);
        const out = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.subarray(pos, pos + n));
        pos += n;
        return out;
      }
      case 4: {
        const n = length(info);
        need(n); // every element is at least one byte
        const out: Cbor[] = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        const n = length(info);
        need(n * 2);
        const out = new Map<string | number, Cbor>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          if (typeof k !== 'string' && typeof k !== 'number') throw new CborError('map key is not text or integer');
          if (out.has(k)) throw new CborError('duplicate map key');
          out.set(k, item(depth + 1));
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborError('unsupported simple value or float');
      default:
        throw new CborError('tags are not accepted');
    }
  };

  const value = item(0);
  if (pos !== input.length) throw new CborError('trailing bytes');
  return value;
}

/** A byte-string field of a decoded CBOR map, or null. */
export function bytesAt(map: Cbor, key: string): Uint8Array | null {
  if (!(map instanceof Map)) return null;
  const v = map.get(key);
  return v instanceof Uint8Array ? v : null;
}
