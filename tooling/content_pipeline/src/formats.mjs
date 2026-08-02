// ─────────────────────────────────────────────────────────────────────────────
// formats.mjs — ONE allowlist serving [pipeline 7]P-7 (a pack is provably inert
// data) and P-14 (the optimize stage emits only the locked formats).
//
// Two allowlists is how they drift, so there is one, and both the emitter
// (pack.mjs, at write time) and the guard (assert-pack-inert.mjs, on every push)
// read it.
//
// ── WHAT THE APPLE RULES ACTUALLY SAY, BY NUMBER ─────────────────────────────
// App Store Review Guideline **2.5.2** — an app may not download, install or
// execute code which introduces or changes features or functionality. Guideline
// **4.7** ("Mini apps, mini games, streaming games, chatbots, plug-ins…") permits
// HTML5 mini-apps under conditions, and is the clause a reviewer would reach for
// if our packs looked like anything other than data.
//
// A content pack carries no code and is not a mini-app, so 4.7's conditions never
// arise — which is exactly why this allowlist is BYTES-ONLY and deliberately
// over-compliant. Cited by number here, per 39-CHASSIS §5.16, so a future session
// does not re-litigate the framing from memory.
//
// ── THE ALLOWLIST, AND ONE DELIBERATE OMISSION ───────────────────────────────
// · MP3          — [ADR 017]. Patents expired April 2017; the only audio format
//                  definitively unencumbered AND natively decodable on all six
//                  platforms. `audioplayers` bundles no decoder and delegates to
//                  the OS, so the patent position is clean end to end.
// · WebP         — the only image format. See the AVIF note below.
// · JPEG / PNG   — NOT here. The optimize stage emits WebP; a PNG in a pack is an
//                  un-optimized asset that slipped the stage, not a second
//                  supported format.
//
// 🔴 THE ISOBMFF/AVIF SIGNATURE IS ABSENT AND ITS ABSENCE IS THE ENFORCEMENT.
// AVIF was cut 2026-07-29: Flutter cannot decode it (flutter/flutter#61229, open
// since 2020). Adding `ftypavif` here would silently reverse a written cut.
// TRIGGER: AVIF returns the day flutter/flutter#61229 closes — not before, and
// not because an encoder made a smaller file.
//
// 🔴 VIDEO IS DORMANT, NOT MISSING. 39-CHASSIS §4 cut 8 parks the whole video
// question on an unanswered owner scope question ("does any near-term app need
// video or long-form audio?"). [ADR 013]'s VP9+Opus WebM lock is therefore a
// decision with nothing to enforce it on yet. Do not add a WebM signature to
// un-block a document that does not exist — and note that WebM and WebP share
// neither a container nor a magic prefix beyond `RIFF`, so this is a real choice.
// ─────────────────────────────────────────────────────────────────────────────

/** Every member a pack may contain. THE WHOLE PACK IS ENUMERATED against this —
 *  not just `content.json` and `assets/`. The original P-7 scope was those two
 *  paths, which lets a root-level `.js` (its own worked example) walk straight
 *  past, because a root-level file is in neither. */
export const PACK_MEMBERS = Object.freeze({
  exact: Object.freeze(['manifest.json', 'manifest.sig', 'content.json', 'PROVENANCE.json']),
  prefix: Object.freeze(['assets/']),
});

/** modality -> allowed formats. Each format is matched on BYTES, never on the
 *  extension: an extension is a claim the file makes about itself. */
export const FORMAT_ALLOWLIST = Object.freeze([
  Object.freeze({
    format: 'mp3',
    modality: 'audio',
    extensions: Object.freeze(['.mp3']),
    lock: '[ADR 017] — MP3, patents expired April 2017',
    // An MP3 file starts either with an ID3v2 tag or directly with an MPEG audio
    // frame sync (11 set bits: FF followed by E0-FF in the top three bits).
    matches: (b) =>
      (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  }),
  Object.freeze({
    format: 'webp',
    modality: 'image',
    extensions: Object.freeze(['.webp']),
    lock: 'AVIF cut 2026-07-29 (flutter/flutter#61229) — WebP is the only image format',
    matches: (b) =>
      b.length >= 12 &&
      b.toString('latin1', 0, 4) === 'RIFF' &&
      b.toString('latin1', 8, 12) === 'WEBP',
  }),
]);

/** The formats a bytes-inspection can NAME when it refuses, so a failure says
 *  what arrived instead of "not allowed". Refusing without naming is how
 *  LINEAR16/WAV — the realistic off-format audio asset, because it is Chirp's
 *  DEFAULT audioEncoding and arrives whenever nobody set the field — gets
 *  mistaken for a corrupt file. */
export const KNOWN_REFUSED = Object.freeze([
  Object.freeze({
    name: 'WAV / LINEAR16',
    why: "Chirp 3 HD's DEFAULT audioEncoding. It arrives because nobody set the field, not because anyone chose it. [ADR 017] locks MP3.",
    matches: (b) =>
      b.length >= 12 &&
      b.toString('latin1', 0, 4) === 'RIFF' &&
      b.toString('latin1', 8, 12) === 'WAVE',
  }),
  Object.freeze({
    name: 'Ogg (Opus/Vorbis)',
    why: 'Opus is CONTESTED, not royalty-free: Vectis IP (Dolby + Fraunhofer) opened a patent pool in Jan 2023 with live enforcement. [ADR 017] chose MP3 over Opus for exactly this.',
    matches: (b) => b.length >= 4 && b.toString('latin1', 0, 4) === 'OggS',
  }),
  Object.freeze({
    name: 'AVIF (ISOBMFF)',
    why: 'CUT 2026-07-29 — Flutter cannot decode AVIF (flutter/flutter#61229, open since 2020). Returns only when that issue closes.',
    matches: (b) => b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && b.toString('latin1', 8, 12) === 'avif',
  }),
  Object.freeze({
    name: 'PNG',
    why: 'Not a second image format — an un-optimized asset that slipped the optimize stage, which emits WebP.',
    matches: (b) => b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG',
  }),
]);

/** Is `rel` a member a pack may carry at all? */
export function isAllowedMember(rel) {
  const p = rel.split('\\').join('/');
  return PACK_MEMBERS.exact.includes(p) || PACK_MEMBERS.prefix.some((pre) => p.startsWith(pre) && p.length > pre.length);
}

/** Classify asset bytes. Returns `{ ok: true, format }`, or `{ ok: false, reason }`
 *  naming what arrived when it can. */
export function classifyAsset(rel, bytes) {
  const lower = rel.toLowerCase();
  const hit = FORMAT_ALLOWLIST.find((f) => f.matches(bytes));
  if (!hit) {
    const known = KNOWN_REFUSED.find((k) => k.matches(bytes));
    return {
      ok: false,
      reason: known
        ? `bytes are ${known.name} — ${known.why}`
        : `bytes match no allowed format (first 12: ${[...bytes.subarray(0, 12)].map((n) => n.toString(16).padStart(2, '0')).join(' ')})`,
    };
  }
  // Bytes decide, and then the extension must AGREE with them. A .mp3 holding
  // WebP bytes is refused above; a .webp holding MP3 bytes is refused here. Both
  // are the same defect — a file lying about itself — and only one of them is
  // caught by looking at bytes alone.
  if (!hit.extensions.some((e) => lower.endsWith(e))) {
    return { ok: false, reason: `bytes are ${hit.format} but the name ends "${lower.slice(lower.lastIndexOf('.'))}" — extension and content disagree` };
  }
  return { ok: true, format: hit.format, modality: hit.modality };
}
