#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-prompt-provenance.mjs — [pipeline 7]P-2: every generation prompt is
// IP-clean and logged before it runs.
//
// 🔴 THE ORIGINAL CRITERION REWARDS THE FAILURE IT IS AGAINST. "No prompt in the
// log steers toward existing IP" is green on zero prompts, and stays green on a
// PROVENANCE.json with zero entries — so the way to satisfy it is to stop
// logging, which is precisely the failure mode. The check here is a RELATIONSHIP:
// the number of logged prompts equals the number of items the pack ships, in both
// directions.
//
// 🔴 PARSE, NEVER GREP. This is the `r2_buckets`-in-a-comment bug in its worst
// possible form: the ban list itself CONTAINS the strings it bans (it has to),
// and a legitimate refusal note in a log quotes the phrase it refused. A raw-text
// scan over this repository flags src/prompts.mjs, this guard's own header, and
// every honest note. So PROVENANCE.json is parsed and the rules are applied to
// the parsed `prompt` VALUES and nothing else.
//
// ⚠️ THE PRE-SUBMISSION HALF IS THE ONE THAT MATTERS, and it is not here — it is
// `assertPromptIsClean`, called by the pipeline before anything is submitted. A
// post-hoc scan that fires means the money and the exposure were already spent:
// the asset exists, and on the consumer Gemini route there is no IP indemnity
// behind it ([ADR 019]). This guard proves the pre-submission refusal still works
// by feeding it a planted template, and then proves the log agrees with the pack.
//
// Usage:  node tooling/ci/assert-prompt-provenance.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { IP_STEERING_RULES, assertPromptIsClean, ipSteeringViolations } from '../content_pipeline/src/prompts.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

/** The whole check, as a function, so the planted cases below run through the
 *  SAME code the real packs do rather than through a second implementation. */
function check(prov, manifest, content) {
  const out = [];
  const items = Array.isArray(prov?.items) ? prov.items : [];
  if (items.length === 0) {
    out.push('PROVENANCE.json carries ZERO entries. An empty log is the failure P-2 exists for, not a pack with nothing to declare.');
    return out;
  }
  for (const row of items) {
    for (const v of ipSteeringViolations(row.prompt)) {
      out.push(`${row.item_id}: prompt ${v.id} — matched "${v.match}". ${v.adr}`);
    }
  }
  // The relationship, in both directions and per kind.
  const baseLocale = (manifest.locales ?? [])[0];
  const contentKeys = Object.keys(content?.[baseLocale] ?? {});
  const textRows = items.filter((r) => r.modality === 'text').map((r) => r.item_id).sort();
  const assetRows = items.filter((r) => r.modality !== 'text');
  const missingText = contentKeys.filter((k) => !textRows.includes(k));
  const extraText = textRows.filter((k) => !contentKeys.includes(k));
  for (const k of missingText) out.push(`content key "${k}" (locale ${baseLocale}) has NO provenance entry — an asset with no logged prompt is an asset with no independent-creation evidence`);
  for (const k of extraText) out.push(`PROVENANCE.json logs text item "${k}", which content.json does not carry`);
  if (assetRows.length !== (manifest.assets ?? []).length) {
    out.push(`PROVENANCE.json logs ${assetRows.length} non-text item(s) and the manifest declares ${(manifest.assets ?? []).length} asset(s)`);
  }
  return out;
}

// ── the domain ───────────────────────────────────────────────────────────────
const packs = existsSync(FIXTURES)
  ? readdirSync(FIXTURES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(FIXTURES, e.name, 'PROVENANCE.json')))
      .map((e) => join(FIXTURES, e.name))
  : [];
if (packs.length === 0) {
  coverageLost(
    `no pack with a PROVENANCE.json under ${relative(repoRoot, FIXTURES)}.`,
    'A prompt scan with no log to scan is exactly the green-on-zero-prompts shape this guard replaces.',
  );
}
if (IP_STEERING_RULES.length === 0) coverageLost('the IP-steering rule set is empty, so every prompt would pass.');

let rows = 0;
let subject = null;
for (const dir of packs) {
  const rel = relative(repoRoot, dir).split('\\').join('/');
  const prov = JSON.parse(readFileSync(join(dir, 'PROVENANCE.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const content = JSON.parse(readFileSync(join(dir, 'content.json'), 'utf8'));
  for (const p of check(prov, manifest, content)) problems.push(`${rel}: ${p}`);
  rows += prov.items?.length ?? 0;
  subject ??= { prov, manifest, content, rel };
}
if (rows === 0) coverageLost('every PROVENANCE.json found is empty, so nothing was scanned.');

// ── THREE RECORDED FAILING CASES, planted onto the real log ─────────────────
{
  // (1) an IP-steering prompt.
  const m = structuredClone(subject.prov);
  m.items[0].prompt = 'Draw the badge in the style of a well-known animation studio, matching their look.';
  if (!check(m, subject.manifest, subject.content).some((p) => /style-of/.test(p))) {
    problems.push('NOT CAUGHT — a planted "in the style of" prompt passed the parsed-value scan.');
  }
  // (2) an item with no provenance entry.
  const n = structuredClone(subject.prov);
  n.items = n.items.filter((r) => r.modality !== 'text' || r.item_id !== Object.keys(subject.content[subject.manifest.locales[0]])[0]);
  if (!check(n, subject.manifest, subject.content).some((p) => /has NO provenance entry/.test(p))) {
    problems.push('NOT CAUGHT — removing one item\'s provenance row left the relationship satisfied.');
  }
  // (3) a log with zero entries — the failure the original criterion rewards.
  if (!check({ items: [] }, subject.manifest, subject.content).some((p) => /ZERO entries/.test(p))) {
    problems.push('NOT CAUGHT — an empty PROVENANCE.json passed.');
  }
}

// ── the PRE-SUBMISSION refusal, exercised ───────────────────────────────────
// Without this, the ban list is only ever proven by the post-hoc scan — and a
// post-hoc scan that fires means the run was already paid for.
{
  let threw = false;
  try {
    assertPromptIsClean('Generate a mascot that looks like a famous studio character, recreate the look of their poster art.', 'planted');
  } catch (e) {
    threw = /REFUSED before submission/.test(e.message);
  }
  if (!threw) problems.push('NOT CAUGHT — assertPromptIsClean accepted a planted IP-steering template, so nothing refuses BEFORE a generation request is built.');
  // …and it must not refuse a legitimate neutral prompt, or it gets switched off.
  try {
    assertPromptIsClean('Flat-vector friendly rodent mascot, rounded shapes, teal-and-blue palette, plain background.', 'planted-clean');
  } catch (e) {
    problems.push(`FALSE POSITIVE — assertPromptIsClean refused a neutral [ADR 019]-compliant prompt: ${e.message.split('\n')[1] ?? e.message}`);
  }
}

prints.push(
  'the ban list is a FLOOR, not a proof: it catches a prompt that names a studio and cannot catch one that describes ' +
    'it closely without naming it. [ADR 019]\'s stack is this rule PLUS the human review sample (P-4) PLUS reverse-image-search on illustrations.',
);

if (problems.length) {
  console.error(`✗ prompt provenance — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `ok  prompt provenance — ${rows} logged prompt(s) across ${packs.length} pack(s), parsed not grepped, ` +
    `checked against ${IP_STEERING_RULES.length} [ADR 019] rule(s); prompt count reconciles with content keys and manifest assets in both directions; ` +
    '3 planted cases caught and the pre-submission refusal proven on a real template',
);
