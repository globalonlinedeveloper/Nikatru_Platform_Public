// ─────────────────────────────────────────────────────────────────────────────
// image.ts — the one screenshot a report may carry, with its metadata chunks
// stripped BEFORE it is stored (lane feedback-intake, Do 5).
//
// A screenshot's pixels are what the user previewed and blurred; its METADATA is
// not shown to them at all — a PNG `tEXt`/`iTXt`/`zTXt` chunk or `eXIf` block can
// carry a device name, a capture time or a software string, and a WebP carries the
// same in `EXIF` and `XMP `. So the stored image is rebuilt from an allowlist of
// chunks that hold pixels and the few that say how to draw them, and everything
// else is dropped. Anything that does not parse as PNG or WebP is refused — the
// bytes are never stored "as is".
// ─────────────────────────────────────────────────────────────────────────────

export type ImageKind = 'png' | 'webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG chunks kept: the critical four, and transparency/colour that change pixels. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'sRGB', 'cHRM', 'sBIT', 'bKGD']);
/** WebP chunks kept: the bitstreams, alpha and animation. */
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);
/** VP8X flag bits for the chunks dropped above: ICC (0x20), EXIF (0x08), XMP (0x04). */
const VP8X_DROPPED_FLAGS = 0x20 | 0x08 | 0x04;

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export function kindOf(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** The PNG rebuilt from PNG_KEEP's chunks, or null when it does not parse. */
export function stripPng(bytes: Uint8Array): Uint8Array | null {
  if (kindOf(bytes) !== 'png') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let sawEnd = false;
  let sawHeader = false;
  while (at + 12 <= bytes.length) {
    const len = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + len;
    if (end > bytes.length) return null;
    if (at === 8 && type !== 'IHDR') return null;
    if (type === 'IHDR') sawHeader = true;
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawHeader || !sawEnd) return null;
  return concat(parts);
}

/** The WebP rebuilt from WEBP_KEEP's chunks (VP8X flags cleared to match), or null. */
export function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (kindOf(bytes) !== 'webp') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  let at = 12;
  let sawImage = false;
  while (at + 8 <= riffEnd) {
    const fourcc = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > riffEnd) return null;
    if (WEBP_KEEP.has(fourcc)) {
      const chunk = bytes.slice(at, Math.min(end, riffEnd));
      if (fourcc === 'VP8X' && size >= 1) chunk[8] &= ~VP8X_DROPPED_FLAGS & 0xff;
      if (fourcc !== 'VP8X') sawImage = true;
      chunks.push(chunk);
    }
    at = end;
  }
  if (!sawImage) return null;
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

/** The stripped image and its kind, or null for anything that is not a clean PNG or WebP. */
export function stripImage(bytes: Uint8Array): { kind: ImageKind; bytes: Uint8Array } | null {
  const kind = kindOf(bytes);
  if (kind === 'png') {
    const out = stripPng(bytes);
    return out ? { kind, bytes: out } : null;
  }
  if (kind === 'webp') {
    const out = stripWebp(bytes);
    return out ? { kind, bytes: out } : null;
  }
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
