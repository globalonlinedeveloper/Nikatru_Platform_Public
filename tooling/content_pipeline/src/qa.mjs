// ─────────────────────────────────────────────────────────────────────────────
// qa.mjs — [pipeline 7]P-3, the TEXT limb and the declared-check registry.
//
// 🔴 THE ORIGINAL COVERAGE IS A FREE VARIABLE OF ITS OWN INPUT. "For each
// modality ACTIVE IN THE RECIPE" is satisfied by a text-only recipe, so the
// ASR-word-error-rate check that the stage's own evidence calls load-bearing
// never fires and the criterion still passes. The stage therefore DECLARES what
// it implements, and a recipe naming anything else is REFUSED by
// recipe.mjs — never skipped.
//
// WHAT IS BUILT: the text limb, which needs no third-party model.
// WHAT IS NOT, and why it is not a gap somebody forgot:
//   · ASR word-error rate (audio)     — needs a downloaded ASR model
//   · per-language NER (text/audio)   — needs a per-language model
//   · NSFW classification (image)     — needs a classifier
// Every local QA model needs a row in tooling/legal/content-licence-register.json
// BEFORE it runs (29-SYNTHESIS-A-S.md:373). Land each limb in the same increment
// as its row, never before — that ordering is the whole point of G-36.
//   · melodic similarity (music)      — NOT BUILT. Drift is deferred ([ADR 019],
//     music is the 🔴 tier), so the check would be an assertion that cannot fail.
//   · video                           — DORMANT (39-CHASSIS §4 cut 8).
//
// 🔴 THE SYNTHID CHECK KEYS ON THE GENERATOR, NOT THE MODALITY. Asserting
// "SynthID survived" on a Chirp asset asserts that a mark which was never applied
// was not removed — it can only pass. The check fails when a GEMINI-generated
// item lacks a surviving mark, and the unmarked count is printed every run so the
// EU AI-Act Art. 50 exposure stays visible.
// ─────────────────────────────────────────────────────────────────────────────
import { GENERATOR_MARKING } from './pack.mjs';

/** The declared check registry. `assert-publish-gate.mjs` asserts the QA report
 *  names every one of these, so silently dropping a check is a build failure
 *  rather than a shorter report. */
export const DECLARED_CHECKS = Object.freeze([
  Object.freeze({ id: 'schema-validity', modality: 'text', what: 'every content value is a non-empty string' }),
  Object.freeze({ id: 'assistant-tell', modality: 'text', what: 'no "as an AI", "I cannot", "as a language model" or similar model-voice leakage reached the content' }),
  Object.freeze({ id: 'pii-scrub', modality: 'text', what: 'no email address, phone-shaped digit run, or long digit sequence in shipped copy' }),
  Object.freeze({ id: 'intra-pack-dedup', modality: 'text', what: 'no two keys in one locale carry identical copy — the shape a truncated generation run leaves behind' }),
  Object.freeze({ id: 'marking-declared', modality: 'all', what: 'every item declares a marking that agrees with its generator, and unmarked items are counted out loud' }),
]);

const ASSISTANT_TELLS = [
  /\bas an? (?:AI|language model)\b/i,
  /\bI(?:'m| am) (?:an? )?(?:AI|language model)\b/i,
  /\bI (?:cannot|can't|am unable to) (?:assist|help|provide|generate)\b/i,
  /\bas requested,?\s+here (?:is|are)\b/i,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LONG_DIGITS = /\d[\d\s().-]{8,}\d/;

/** Run the implemented checks. Returns a report; `problems` is non-empty when a
 *  check FAILED, which is different from a check not existing. */
export function runQa(recipe, content, provenance) {
  const problems = [];
  const findings = [];
  const counts = { items: 0, unmarked: 0 };

  for (const [locale, shard] of Object.entries(content ?? {})) {
    const seen = new Map();
    for (const [key, value] of Object.entries(shard ?? {})) {
      counts.items++;
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`[schema-validity] ${locale}/${key}: not a non-empty string`);
        continue;
      }
      for (const re of ASSISTANT_TELLS) {
        if (re.test(value)) problems.push(`[assistant-tell] ${locale}/${key}: model-voice leakage — "${value.slice(0, 60)}"`);
      }
      if (EMAIL.test(value)) problems.push(`[pii-scrub] ${locale}/${key}: contains an email address`);
      if (LONG_DIGITS.test(value)) problems.push(`[pii-scrub] ${locale}/${key}: contains a long digit run (phone-shaped)`);
      const dupe = seen.get(value);
      if (dupe !== undefined) problems.push(`[intra-pack-dedup] ${locale}: "${key}" and "${dupe}" carry identical copy — the shape a truncated generation run leaves behind`);
      else seen.set(value, key);
    }
  }

  for (const row of provenance?.items ?? []) {
    const declared = GENERATOR_MARKING[row.generator_model_id];
    const expected = declared === undefined ? null : declared.split(':')[0];
    if (expected === null) {
      problems.push(`[marking-declared] ${row.item_id}: generator "${row.generator_model_id}" has no declared marking behaviour`);
      continue;
    }
    if (expected === 'synthid' && row.marking !== 'synthid') {
      problems.push(
        `[marking-declared] ${row.item_id}: ${row.generator_model_id} applies SynthID and this item declares "${row.marking}". ` +
          'The mark IS the EU AI-Act Art. 50 machine-readable marking (G-33) and it is free — losing it in the optimize stage is the realistic way it goes missing.',
      );
    }
    if (row.marking === 'none') counts.unmarked++;
  }

  findings.push(
    `${counts.unmarked} of ${provenance?.items?.length ?? 0} item(s) carry NO machine-readable mark. ` +
      'For a Chirp asset that is correct and unavoidable — Chirp 3 HD applies no watermark, so PROVENANCE.json is audio\'s only marking evidence. ' +
      'The count is printed rather than hidden because it IS the Art. 50 exposure.',
  );

  return {
    checks: DECLARED_CHECKS.map((c) => ({ id: c.id, modality: c.modality, what: c.what })),
    itemsChecked: counts.items,
    unmarked: counts.unmarked,
    findings,
    problems,
  };
}
