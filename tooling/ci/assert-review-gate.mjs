#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-review-gate.mjs — [pipeline 7]P-4: a deterministic human sample gates
// every pack, and review.jsonl is the moat.
//
// 🔴 A review.jsonl WITH ONE PASSING VERDICT OVER THE RIGHT CONTENT HASH
// SATISFIES ALL THREE OF THE ORIGINAL CRITERIA. Presence, a threshold and a
// content-hash binding are each true of that file. So three more limbs are added,
// and they are the ones that carry the property the word "deterministic" was
// doing in the requirement:
//
//   4. COVERAGE   — verdicts / pack items below the recipe's declared floor
//                   fails; review_tier `expert` fails below 100%.
//   5. DETERMINISM— the gate RE-DERIVES the sample from the pack's content hash
//                   and fails unless the reviewed ids are exactly the derived
//                   ids. A free-hand sample now fails.
//   6. CHECKLIST  — the named human checklist becomes a real list.
//                   reverse-image-search · text-in-pixels · G3 do-no-harm each
//                   need a per-item verdict. Without this, P-8 routes its human
//                   half ("text never ships inside pixels") into a void and
//                   nobody owns it — the list existed in NO FILE before today.
//
// The sampler is shared with the pipeline (src/sample.mjs), so the side that
// tells a reviewer what to review and the side that checks what was reviewed
// cannot disagree.
//
// ⚠️ THE VERDICTS THEMSELVES ARE HUMAN LABOUR and this guard does not pretend
// otherwise. It proves the sample was the right one, that it was covered, and
// that every named check was answered. Whether the answers are true is the moat,
// and a person supplies it.
//
// Usage:  node tooling/ci/assert-review-gate.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

import { REVIEW_CHECKLIST, checklistProblems, deriveSample } from '../content_pipeline/src/sample.mjs';
import { readReviewLog } from '../content_pipeline/src/gates.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const EXAMPLES = join(repoRoot, 'tooling', 'content_pipeline', 'examples');
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');

const problems = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

if (REVIEW_CHECKLIST.length === 0) coverageLost('the review checklist is empty, so limb 6 requires nothing of any verdict row.');

/** The gate, as a function, so the planted cases run through the SAME code. */
function gate(recipe, prov, contentHash, rows) {
  const out = [];
  const itemIds = (prov.items ?? []).map((r) => r.item_id);
  const modalityOf = new Map((prov.items ?? []).map((r) => [r.item_id, r.modality]));
  if (itemIds.length === 0) return ['the pack declares no items, so every ratio below is over an empty set'];

  // 1-3: presence + binding
  if (rows.length === 0) return ['review.jsonl carries no verdicts'];
  for (const r of rows) {
    if (r.content_hash !== contentHash) out.push(`a verdict for "${r.item_id}" names content_hash ${JSON.stringify(r.content_hash)}, not ${contentHash} — it reviewed a different pack`);
  }

  // 5: DETERMINISM — re-derive, then compare as a set.
  const expected = deriveSample(contentHash, itemIds, { tier: recipe.review.tier, sampleFloor: recipe.review.sample_floor });
  const reviewed = [...new Set(rows.map((r) => r.item_id))].sort();
  const notInSample = reviewed.filter((id) => !expected.includes(id));
  const unreviewed = expected.filter((id) => !reviewed.includes(id));
  for (const id of notInSample) out.push(`"${id}" was reviewed and is NOT in the derived sample — a free-hand sample is not a deterministic one`);
  for (const id of unreviewed) out.push(`"${id}" is in the derived sample and has no verdict`);

  // 4: COVERAGE against the declared floor.
  const ratio = reviewed.length / itemIds.length;
  const floor = recipe.review.tier === 'expert' ? 1 : recipe.review.sample_floor;
  if (ratio + 1e-9 < floor) {
    out.push(
      `coverage is ${reviewed.length}/${itemIds.length} = ${(ratio * 100).toFixed(1)}%, below the declared ` +
        `${recipe.review.tier} floor of ${(floor * 100).toFixed(1)}%`,
    );
  }

  // 6: the named checklist, per item.
  for (const r of rows) {
    out.push(...checklistProblems(r.item_id, modalityOf.get(r.item_id) ?? 'text', r.checks));
    if (!/^(pass|fail)\b/.test(String(r.verdict ?? ''))) out.push(`"${r.item_id}": verdict is ${JSON.stringify(r.verdict)}; it must start pass or fail`);
    if (String(r.verdict ?? '').startsWith('fail')) out.push(`"${r.item_id}" FAILED human review and the pack still declares it`);
    if (!r.reviewer || !r.reviewed_on) out.push(`"${r.item_id}": a verdict with no reviewer or no date is not evidence of anything`);
  }
  return out;
}

// ── the domain ───────────────────────────────────────────────────────────────
const subjects = [];
if (existsSync(EXAMPLES)) {
  for (const e of listDir(EXAMPLES, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const recipePath = join(EXAMPLES, e.name, 'recipe.json');
    const logPath = join(EXAMPLES, e.name, 'gates', 'review.jsonl');
    if (!existsSync(recipePath)) continue;
    const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
    const packDir = join(FIXTURES, `v${recipe.pack_version.split('.')[0]}`);
    if (!existsSync(join(packDir, 'PROVENANCE.json'))) continue;
    if (!existsSync(logPath)) {
      problems.push(`${e.name}: no gates/review.jsonl — the human sample gate has nothing to read, and a pack cannot publish without it`);
      continue;
    }
    subjects.push({
      name: e.name,
      recipe,
      prov: JSON.parse(readFileSync(join(packDir, 'PROVENANCE.json'), 'utf8')),
      manifest: JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')),
      rows: readReviewLog(logPath),
      logRel: relative(repoRoot, logPath).split('\\').join('/'),
    });
  }
}
if (subjects.length === 0) {
  coverageLost(
    'no (recipe, frozen pack, review.jsonl) triple was found.',
    'Every limb quantifies over one. With none, the gate reports a reviewed pack having read no verdicts.',
  );
}

let verdicts = 0;
for (const s of subjects) {
  for (const p of gate(s.recipe, s.prov, s.manifest.content_hash, s.rows)) problems.push(`${s.logRel}: ${p}`);
  verdicts += s.rows.length;
}
if (verdicts === 0) coverageLost('not one verdict row was read across every subject found.');

// ── FOUR RECORDED FAILING CASES, mutated onto the real log ──────────────────
{
  const s = subjects[0];
  const cases = [
    {
      name: 'a deleted verdict (coverage)',
      rows: s.rows.slice(0, -1),
      expect: /in the derived sample and has no verdict|coverage is/,
    },
    {
      name: 'a free-hand sample — one sampled id swapped for an unsampled one (determinism)',
      rows: (() => {
        const ids = (s.prov.items ?? []).map((r) => r.item_id);
        const reviewed = new Set(s.rows.map((r) => r.item_id));
        const outsider = ids.find((id) => !reviewed.has(id));
        const copy = structuredClone(s.rows);
        copy[0] = { ...copy[0], item_id: outsider };
        return copy;
      })(),
      expect: /is NOT in the derived sample/,
    },
    {
      name: 'a missing checklist key',
      rows: (() => {
        const copy = structuredClone(s.rows);
        delete copy[0].checks[REVIEW_CHECKLIST[REVIEW_CHECKLIST.length - 1].key];
        return copy;
      })(),
      expect: new RegExp(`no verdict for "${REVIEW_CHECKLIST[REVIEW_CHECKLIST.length - 1].key}"`),
    },
    {
      name: 'reverse-image-search marked n/a on an IMAGE item',
      rows: (() => {
        const copy = structuredClone(s.rows);
        const modalityOf = new Map((s.prov.items ?? []).map((r) => [r.item_id, r.modality]));
        const img = copy.find((r) => modalityOf.get(r.item_id) === 'image');
        if (img) img.checks['reverse-image-search'] = 'n/a: skipped';
        return copy;
      })(),
      expect: /is marked n\/a on a image item, where it DOES apply/,
    },
    {
      name: 'a verdict naming a different pack (content-hash binding)',
      rows: (() => {
        const copy = structuredClone(s.rows);
        copy[0].content_hash = 'f'.repeat(64);
        return copy;
      })(),
      expect: /it reviewed a different pack/,
    },
  ];
  for (const c of cases) {
    const found = gate(s.recipe, s.prov, s.manifest.content_hash, c.rows).join('\n');
    if (!c.expect.test(found)) problems.push(`NOT CAUGHT — "${c.name}" planted onto the real log and the gate said: ${found || '(nothing)'}`);
  }
  // The image case is only a real proof if the pack HAS an image item in the
  // sample. Otherwise the mutation is a no-op and the "catch" is meaningless.
  const modalityOf = new Map((s.prov.items ?? []).map((r) => [r.item_id, r.modality]));
  if (!s.rows.some((r) => modalityOf.get(r.item_id) === 'image')) {
    coverageLost(
      `${s.logRel} reviews no image item, so the reverse-image-search limb could not be exercised.`,
      'That limb is the one [ADR 019] leans on for the risk it cannot mitigate by prompting, and a sample with no',
      'image asset retires it silently. Raise the recipe\'s sample_floor until an image item is drawn.',
    );
  }
}

if (problems.length) {
  console.error(`✗ review gate — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(
  `ok  review gate — ${subjects.length} pack(s), ${verdicts} verdict(s); sample RE-DERIVED from the content hash and matched exactly; ` +
    `coverage at or above the declared floor; all ${REVIEW_CHECKLIST.length} named checklist item(s) answered per verdict; 5 planted cases caught`,
);
