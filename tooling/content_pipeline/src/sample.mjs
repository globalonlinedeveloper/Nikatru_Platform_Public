// ─────────────────────────────────────────────────────────────────────────────
// sample.mjs — [pipeline 7]P-4's DETERMINISTIC sample, derived once and shared.
//
// The word "deterministic" was doing work in the requirement and nothing
// implemented it. A gate that only checks "review.jsonl exists, has ≥ N verdicts,
// and names this content hash" is satisfied by a reviewer picking the N easiest
// items — or by ONE passing verdict over the right hash, which satisfies all
// three of the original criteria at once.
//
// So the sample is a FUNCTION OF THE PACK: seeded by the content hash, over the
// sorted item ids. The gate re-derives it and fails unless review.jsonl records
// exactly those ids. A free-hand sample now fails, which is the property the
// requirement was reaching for.
//
// 🔴 ONE IMPLEMENTATION, IMPORTED BY BOTH SIDES. The pipeline tells the reviewer
// which items to review; assert-review-gate.mjs checks which items were reviewed.
// Two copies of a shuffle agree until one of them is edited, and the disagreement
// surfaces as a red build nobody can explain — so there is one.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

/** A counter-mode sha256 stream keyed by the content hash. Not cryptographic
 *  randomness and does not need to be: the property required is that the same
 *  pack always yields the same sample and that a reviewer cannot choose it. */
function* keystream(seedHex) {
  for (let counter = 0; ; counter++) {
    const block = createHash('sha256').update(`${seedHex}:${counter}`).digest();
    for (let i = 0; i + 4 <= block.length; i += 4) yield block.readUInt32BE(i);
  }
}

/**
 * The item ids a human must review for this pack.
 *
 * @param {string} contentHash lower-case hex sha256 of content.json — the pack's identity
 * @param {string[]} itemIds every reviewable item in the pack
 * @param {{tier:'standard'|'expert', sampleFloor:number}} review
 * @returns {string[]} the sampled ids, sorted, so the result is comparable as a set AND as a list
 */
export function deriveSample(contentHash, itemIds, review) {
  const ids = [...itemIds].sort();
  if (ids.length === 0) return [];
  // `expert` is 100% by definition — the tier exists to say "no sampling", so a
  // sample_floor beside it is ignored rather than blended. Blending is how an
  // expert-tier pack ends up 40% reviewed with everything green.
  if (review.tier === 'expert') return ids;

  const want = Math.max(1, Math.ceil(ids.length * review.sampleFloor));
  if (want >= ids.length) return ids;

  // Fisher-Yates over a copy, consuming the keystream. Deterministic given
  // (contentHash, ids), and every id is reachable.
  const shuffled = [...ids];
  const rng = keystream(contentHash);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.next().value % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, want).sort();
}

/** The named human checklist, which until now existed in NO FILE — P-8 delegated
 *  its human half ("text never ships inside pixels") to a list that did not
 *  exist, so nobody owned it. REQUIRED_COVERAGE: every item's verdict row must
 *  carry a value for each of these keys. */
export const REVIEW_CHECKLIST = Object.freeze([
  Object.freeze({
    key: 'reverse-image-search',
    appliesTo: Object.freeze(['image']),
    why: '[ADR 019] consequence (5) — reverse-image-search a sample of generated illustrations before a pack ships. This is the layer the ban list cannot be: a prompt that names nobody can still produce a near-copy.',
  }),
  Object.freeze({
    key: 'text-in-pixels',
    appliesTo: Object.freeze(['image', 'audio', 'text']),
    why: "[pipeline 7]P-8's human half. Text baked into an image cannot be localised and cannot be corrected without regenerating the asset — and the client's locale FALLBACK (content_pack.dart) makes the failure invisible at runtime.",
  }),
  Object.freeze({
    key: 'g3-do-no-harm',
    appliesTo: Object.freeze(['image', 'audio', 'text']),
    why: 'G3 do-no-harm. The one check no machine limb in this pipeline attempts, on any modality.',
  }),
]);

/** `n/a` is legal ONLY where the check cannot apply to that modality, and the
 *  reason must be stated. Otherwise "n/a" is how a checklist empties itself. */
export function checklistProblems(itemId, modality, checks) {
  const problems = [];
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    return [`${itemId} — "checks" is not an object; the checklist cannot be read at all`];
  }
  for (const entry of REVIEW_CHECKLIST) {
    const v = checks[entry.key];
    if (v === undefined) {
      problems.push(`${itemId} — no verdict for "${entry.key}". ${entry.why}`);
      continue;
    }
    if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`${itemId} — "${entry.key}" carries no verdict text`);
      continue;
    }
    if (v.startsWith('n/a')) {
      if (entry.appliesTo.includes(modality)) {
        problems.push(
          `${itemId} — "${entry.key}" is marked n/a on a ${modality} item, where it DOES apply. ` +
            'n/a is for a check a modality cannot have, not for one nobody performed.',
        );
      } else if (!/^n\/a\s*:\s*\S/.test(v)) {
        problems.push(`${itemId} — "${entry.key}" is n/a with no reason after the colon`);
      }
      continue;
    }
    if (!/^(pass|fail)\b/.test(v)) {
      problems.push(`${itemId} — "${entry.key}" is "${v}"; a verdict must start pass, fail or n/a:`);
    }
  }
  return problems;
}
