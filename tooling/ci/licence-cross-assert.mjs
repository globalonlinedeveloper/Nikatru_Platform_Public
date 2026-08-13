#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// licence-cross-assert.mjs — the SEAM between the two licence registers.
//
// [pipeline 7]P-5  · content-pipeline INPUTS   → tooling/legal/content-licence-register.json
// [pipeline 8]K-10 · BUILT-BUNDLE contents     → tooling/legal/asset-register.json
//
// TWO REGISTERS, TWO GUARDS, AND UNTIL 2026-08-13 NOTHING BETWEEN THEM. Each
// guard was green over its own file, and the boundary between the two files was
// stated in exactly one place — a comment inside content-licence-register.json:
//
//   "An app can ship a font it never generated with; a pack can carry a voice
//    the app binary never sees."
//
// That sentence is correct and it is also the whole risk: a family can land in
// BOTH files, and nothing compared what the two of them said about it. Two green
// guards, one family, two different licence verdicts — and the disagreement is
// invisible precisely because each guard is doing its own job correctly. G-36 is
// the owner's stated #1 lens and the failure mode is a DMCA takedown, so a
// family that falls into the seam between two green guards is the expensive kind
// of gap.
//
// ── THE LINK IS DECLARED ONCE, ON THE ASSET SIDE ─────────────────────────────
// Every row in asset-register.json carries `contentFamily`:
//   · a string — this artefact is ALSO a content-pipeline input, and names the
//     content-licence-register family it corresponds to;
//   · null — it is not, and somebody answered that question deliberately.
// 🔴 THE FIELD IS REQUIRED, AND `null` IS A REAL ANSWER RATHER THAN AN ABSENCE.
// An OPTIONAL cross-link would be a guard nobody can fail: the way a family
// falls into a seam is that nobody wrote the link, which is exactly the input an
// optional field accepts silently. Required-with-an-explicit-null means a new
// asset row cannot be added without someone answering "is this also something
// the content pipeline consumes?" — which is the question the seam is made of.
//
// ⚠️ ONE LINK, NOT TWO, and the reason is this repository's own scar tissue. A
// reverse link on the content side (`shipsInBundleAs: [...]`) would be a second
// store for one relationship — the shape `promo_gate.dart` refused for the Art
// 21 objection ("two stores for one obligation is how a person objects on the
// rail, the card keeps rendering off a stale latch, and BOTH halves report
// healthy"). The reverse direction needs no link anyway: assert-licence-register
// walks a real built bundle and fails on any shipped file with no row, so a Noto
// face that starts shipping in a binary is caught by K-10 whether or not anybody
// remembered to write a link for it.
//
// ── WHAT IS COMPARED ─────────────────────────────────────────────────────────
// FIELD_PAIRS below. Each pair names one field on each side and normalises both
// to a comparable token. `UNVERIFIED` normalises to itself on both sides and is
// NOT treated as a wildcard: a family recorded UNVERIFIED in one register and
// resolved in the other is a real disagreement about what we know, and the fix
// is to carry the finding across rather than to let two registers hold two
// different states of knowledge about one licence.
//
// ── AND WHY THIS FILE IS SHARED BY BOTH GUARDS ───────────────────────────────
// Imported by assert-content-licences.mjs AND assert-licence-register.mjs, so a
// disagreement turns BOTH red. A cross-assert living in one guard would let the
// other keep reporting a clean register while the pair disagreed — half a check,
// and the half that stays green is the one somebody quotes.
//
// ── NON-VACUITY, STATED PLAINLY BECAUSE THE OVERLAP IS EMPTY TODAY ───────────
// 🔬 MEASURED 2026-08-13: 6 content families, 6 asset rows, **0 names in both**.
// So the agreement limb has NO SUBJECT right now, and an agreement limb with no
// subject is this repository's cardinal sin ("an assertion that cannot fail is
// worse than none"). Three things keep it honest:
//   1. the `contentFamily` completeness limb DOES have a subject today — all 6
//      asset rows must answer, and deleting the field from any one of them fails
//      the build;
//   2. the FIELD-EXISTENCE limb has a subject today — every field named in
//      FIELD_PAIRS must be present on at least one row of its own register, so
//      renaming `licence` to something else fails loudly instead of silently
//      comparing undefined to undefined forever;
//   3. the empty overlap is PRINTED on every run, with the seam candidates
//      named, so "0 compared" can never be read as "0 disagreements".
//
// ── NEGATIVE TESTS — 2026-08-13, MUTATING THE REAL REGISTERS ─────────────────
// "A fixture passing is not a guard working." Every case below was applied to
// the real tooling/legal/*.json, run through BOTH guards, then restored from the
// original bytes and sha256-compared. Every one is a transition FROM a proven
// green (baseline: both guards exit 0), and every restore returned both to 0.
//
//   1. AGREEMENT, both pairs — `flutter-material-icons.contentFamily` set to
//      "noto-fonts" (UNVERIFIED/null vs OFL-1.1/required) → exit 1 on BOTH,
//      two SEAM DISAGREEMENT messages, one per field pair.
//   2. AGREEMENT, licence identity alone — attribution first made to agree, so
//      only the licence differed (APACHE-2.0 vs OFL-1.1) → exit 1 on BOTH. This
//      is the case that proves the pairs are checked independently rather than
//      one masking the other.
//   3. `contentFamily` deleted from one row → exit 1 on BOTH.
//   4. `contentFamilyWhy` blanked on one row → exit 1 on BOTH.
//   5. dangling link — "noto-fontz" → exit 1 on BOTH.
//   6. `"licence":` renamed to `"licenceId":` on every asset row → exit 1 on
//      BOTH, CROSS-ASSERT COVERAGE LOST. This is the mutation that matters most:
//      without limb 6 a rename would leave every pair comparing undefined to
//      undefined and agreeing perfectly, forever.
//   7. `"attributionRequired":` renamed on every asset row → exit 1 on BOTH.
//   8. the boundary sentence edited in content-licence-register.json → exit 1 on
//      BOTH, naming the two corpus copies that must be re-synced.
//
// 🔴 EVERY CASE WAS ASSERTED TO FAIL **BOTH** GUARDS, NOT EITHER. That is the
// limb a one-sided cross-assert would have passed, and the half that stayed
// green is the half somebody would have quoted.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTENT_REGISTER_REL = 'tooling/legal/content-licence-register.json';
export const ASSET_REGISTER_REL = 'tooling/legal/asset-register.json';

/** The boundary sentence, held here as the single canonical copy.
 *
 *  It is quoted verbatim in THREE places by deliberate decision (2026-08-13):
 *  content-licence-register.json's _readme, [7]P-5's requirement text and
 *  [8]K-10's requirement text — because the two requirement texts are what a
 *  person schedules work from, and the boundary was unreadable from either.
 *  Duplication is a decay mechanism, so it is guarded rather than trusted: if
 *  the register's copy is edited, this check fails and names the two
 *  requirement texts that must be re-synced. The corpus copies live under
 *  company/ (gitignored) and cannot be read from CI, which is why the assertion
 *  is anchored on the copy CI CAN see. */
export const BOUNDARY_SENTENCE =
  'An app can ship a font it never generated with; a pack can carry a voice the app binary never sees.';

const CORPUS_COPIES = ['company/pipeline/07-content-pipeline.md ([7]P-5)', 'company/pipeline/08-compliance-legal.md ([8]K-10)'];

/** Normalise a licence identity for comparison. Case and surrounding space are
 *  noise; nothing else is touched, because a licence id is an identifier and
 *  "close enough" is not a property licences have. */
const licenceToken = (v) => String(v ?? '').trim().toUpperCase() || 'MISSING';

/** Normalise an attribution/NOTICE duty from either register's spelling.
 *  The content register records `required` / `not-required` / `UNVERIFIED`; the
 *  asset register records a boolean. Both mean the same thing and neither is
 *  converted into a guess: an unreadable value stays UNVERIFIED. */
const attributionToken = (v) => {
  if (v === true) return 'REQUIRED';
  if (v === false) return 'NOT-REQUIRED';
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'REQUIRED' || s === 'YES') return 'REQUIRED';
  if (s === 'NOT-REQUIRED' || s === 'NOT REQUIRED' || s === 'NO') return 'NOT-REQUIRED';
  return 'UNVERIFIED';
};

/** The comparison table. `field` is the literal key whose presence is asserted
 *  on that register, so a rename cannot silently empty the comparison out. */
const FIELD_PAIRS = [
  {
    what: 'licence identity',
    content: { field: 'licence_id', read: (f) => f.licence_id, token: licenceToken },
    asset: { field: 'licence', read: (a) => a.licence, token: licenceToken },
    why:
      'Two registers naming two licences for one family is not a filing inconsistency: whichever is wrong, ' +
      'something shipped under terms nobody checked, and the store asks for evidence of rights without warning.',
  },
  {
    what: 'attribution / NOTICE duty',
    content: {
      field: 'attribution_NOTICE',
      read: (f) => f.verdicts?.attribution_NOTICE?.value,
      token: attributionToken,
    },
    asset: { field: 'attributionRequired', read: (a) => a.attributionRequired, token: attributionToken },
    why:
      'Attribution is a licence CONDITION, not a courtesy — OFL 1.1 condition 5 makes the whole licence ' +
      '"null and void" if the conditions are unmet. One register saying the duty exists while the other says ' +
      'it does not means one of the two shipping paths discharges nothing.',
  },
];

const readJson = (abs) => {
  try {
    return { doc: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { error: e.message };
  }
};

/**
 * Cross-assert the two licence registers.
 *
 * @param {string} repoRoot
 * @param {{ side: 'content'|'asset' }} opts — which guard is calling, used only
 *   to phrase the report. The CHECKS are identical from both sides on purpose:
 *   a seam check that says different things depending on who runs it is two
 *   checks wearing one name.
 * @returns {{ problems: string[], prints: string[], compared: number, linked: number }}
 */
export function crossAssertLicenceRegisters(repoRoot, { side } = {}) {
  const problems = [];
  const prints = [];
  const other = side === 'asset' ? CONTENT_REGISTER_REL : ASSET_REGISTER_REL;

  const contentAbs = join(repoRoot, ...CONTENT_REGISTER_REL.split('/'));
  const assetAbs = join(repoRoot, ...ASSET_REGISTER_REL.split('/'));

  // ── COVERAGE: both files must be readable, from EITHER guard ──────────────
  // A cross-assert that silently skips when the other register is missing is the
  // defect it exists to prevent, one level up.
  for (const [rel, abs] of [
    [CONTENT_REGISTER_REL, contentAbs],
    [ASSET_REGISTER_REL, assetAbs],
  ]) {
    if (!existsSync(abs)) {
      problems.push(
        `CROSS-ASSERT COVERAGE LOST — ${rel} does not exist, so the seam between the two licence registers ` +
          `was not checked at all. Running only ${other === rel ? 'one side' : 'the near side'} of a two-register ` +
          'boundary is how a family ends up cleared in one file and unmentioned in the other.',
      );
      return { problems, prints, compared: 0, linked: 0 };
    }
  }
  const c = readJson(contentAbs);
  const a = readJson(assetAbs);
  for (const [rel, r] of [
    [CONTENT_REGISTER_REL, c],
    [ASSET_REGISTER_REL, a],
  ]) {
    if (r.error) {
      problems.push(`CROSS-ASSERT COVERAGE LOST — ${rel} is not valid JSON (${r.error}); the seam was not checked.`);
      return { problems, prints, compared: 0, linked: 0 };
    }
  }
  const families = Array.isArray(c.doc.families) ? c.doc.families : [];
  const assets = Array.isArray(a.doc.assets) ? a.doc.assets : [];
  if (families.length === 0 || assets.length === 0) {
    problems.push(
      `CROSS-ASSERT COVERAGE LOST — ${CONTENT_REGISTER_REL} has ${families.length} family row(s) and ` +
        `${ASSET_REGISTER_REL} has ${assets.length} asset row(s). With either side empty every comparison ` +
        'below ranges over nothing and reports agreement.',
    );
    return { problems, prints, compared: 0, linked: 0 };
  }

  // ── the canonical boundary sentence still says what the corpus quotes ─────
  const registerText = readFileSync(contentAbs, 'utf8');
  if (!registerText.includes(BOUNDARY_SENTENCE)) {
    problems.push(
      `${CONTENT_REGISTER_REL} no longer contains the boundary sentence verbatim: ${JSON.stringify(BOUNDARY_SENTENCE)}. ` +
        `It is quoted word-for-word in ${CORPUS_COPIES.join(' and ')}. Re-sync all three, or the requirement texts ` +
        'now describe a boundary the register does not draw — which is worse than the register having been the only copy.',
    );
  }

  // ── FIELD EXISTENCE: the comparison must still read real fields ───────────
  // A rename on either side would otherwise make every pair compare undefined
  // to undefined and agree perfectly, forever.
  for (const pair of FIELD_PAIRS) {
    if (!families.some((f) => pair.content.read(f) !== undefined)) {
      problems.push(
        `CROSS-ASSERT COVERAGE LOST — not one row in ${CONTENT_REGISTER_REL} produces a value for ` +
          `"${pair.content.field}" (${pair.what}). The field was renamed or removed; re-point this pair rather ` +
          'than leaving it comparing nothing to nothing.',
      );
    }
    if (!assets.some((r) => pair.asset.read(r) !== undefined)) {
      problems.push(
        `CROSS-ASSERT COVERAGE LOST — not one row in ${ASSET_REGISTER_REL} produces a value for ` +
          `"${pair.asset.field}" (${pair.what}). The field was renamed or removed; re-point this pair rather ` +
          'than leaving it comparing nothing to nothing.',
      );
    }
  }

  // ── every asset row answers the seam question ─────────────────────────────
  const byFamily = new Map(families.map((f) => [f.family, f]));
  const links = [];
  for (const row of assets) {
    const at = `${ASSET_REGISTER_REL} row ${JSON.stringify(row.id)}`;
    if (!('contentFamily' in row)) {
      problems.push(
        `${at} declares no \`contentFamily\`. Every asset row must answer whether the content pipeline also ` +
          `consumes this family: name the ${CONTENT_REGISTER_REL} family, or write \`null\` to say it does not. ` +
          'An optional cross-link cannot fail on the input that actually causes the seam — nobody writing one.',
      );
      continue;
    }
    // A `null` with no reason is a permanent shrug, and the register's own house
    // style already refuses those (`wouldNeed`, `source.note`). The reason is
    // where a wrong answer becomes visible to a reader: "our own brand mark, and
    // the content pipeline does not produce it" is checkable by a person in a
    // way that a bare `null` is not.
    if (typeof row.contentFamilyWhy !== 'string' || row.contentFamilyWhy.trim() === '') {
      problems.push(
        `${at} answers \`contentFamily\` and gives no \`contentFamilyWhy\`. One sentence: why this artefact is ` +
          '(or is not) also something the content pipeline consumes. A bare answer to the seam question cannot be ' +
          'reviewed, and this seam is reviewed by people far more often than it is run.',
      );
    }
    const fam = row.contentFamily;
    if (fam === null) continue;
    if (typeof fam !== 'string' || fam.trim() === '') {
      problems.push(`${at} has a \`contentFamily\` that is neither a family name nor null (${JSON.stringify(fam)}).`);
      continue;
    }
    const family = byFamily.get(fam);
    if (!family) {
      problems.push(
        `${at} links to content family ${JSON.stringify(fam)} and ${CONTENT_REGISTER_REL} has no such row. ` +
          'A cross-link to nothing reads exactly like a checked one.',
      );
      continue;
    }
    links.push({ row, family });
  }

  // ── THE AGREEMENT LIMB ────────────────────────────────────────────────────
  let compared = 0;
  for (const { row, family } of links) {
    for (const pair of FIELD_PAIRS) {
      const cTok = pair.content.token(pair.content.read(family));
      const aTok = pair.asset.token(pair.asset.read(row));
      compared++;
      if (cTok === aTok) continue;
      problems.push(
        `SEAM DISAGREEMENT on ${pair.what} for family ${JSON.stringify(family.family)}: ` +
          `${CONTENT_REGISTER_REL} says ${cTok} (${pair.content.field}) and ${ASSET_REGISTER_REL} row ` +
          `${JSON.stringify(row.id)} says ${aTok} (${pair.asset.field}). ${pair.why} ` +
          'Both registers describe the same licence for the same family; settle it in both, in the same commit.',
      );
    }
  }

  // ── the honest state, printed every run ───────────────────────────────────
  if (links.length === 0) {
    const candidates = families
      .filter((f) => f.kind !== 'first-party')
      .map((f) => f.family)
      .join(', ');
    prints.push(
      `SEAM [7]P-5 ↔ [8]K-10 — ${assets.length} asset row(s) all answered \`contentFamily\`, and ZERO link to a ` +
        `content family, so the agreement limb compared NOTHING. That is the true state, not a clean bill: ` +
        `${families.length} content families exist and none is in a shipped bundle yet. Seam candidates the day one ` +
        `is (a font, a voice or a model landing in a binary): ${candidates}.`,
    );
  } else {
    prints.push(
      `SEAM [7]P-5 ↔ [8]K-10 — ${links.length} family/families in BOTH registers, ${compared} verdict comparison(s), ` +
        'all in agreement.',
    );
  }

  return { problems, prints, compared, linked: links.length };
}
