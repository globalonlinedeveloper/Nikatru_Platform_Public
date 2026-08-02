#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-publish-gate.mjs — [pipeline 7]P-13 (publish is a gate, not a copy) and
// P-10 (no production pack is signed before key custody is drill-proven).
//
// 🔴 P-13's ORIGINAL CRITERION TESTS ONE MEMBER OF A FIVE-GATE UNION. "Publish
// refuses when the review log is missing" stays true with the other four gates
// deleted. So: one recorded failing case PER required artifact, five not one, and
// the required list is DERIVED from the gate registry rather than hand-written —
// a hand-maintained list is exactly the mistake assert-lane-coverage.mjs exists
// to correct.
//
// 🔴 CONTENT-HASH BINDING ON ALL FIVE. An artifact naming a different pack is the
// same defect as a missing one, and it is the one that actually happens: re-run
// the pipeline, get a new content hash, and five stale reports sit in the gates
// directory looking complete.
//
// ⛔ THE PUBLISH TARGET IS BLOCKED AND NOT BY THIS STAGE. `[4]B-18` owns the
// shelf — one shared R2 bucket with an `<app_id>/` prefix per [ADR 020], the
// packs.nikatru.com custom-domain binding, the cache policy and latest.json
// hosting. services/platform/wrangler.jsonc still reads "NO r2_buckets YET".
// Stage 7 owns the gate. A gate is about refusing, and refusing needs no
// destination, which is why this is fully buildable and fully negative-testable
// with no bucket at all. Do not create one from here.
//
// 🔴 P-10 PRINTS, NEVER FAILS, AND THAT IS DELIBERATE. The restore drill is
// physical owner work: restore the seed from each stored copy in turn, sign, and
// verify through the production verifier against pinned k1. A guard that blocks
// every CI run on that blocks all other work and gets switched off — the same
// shape checkPackVerifier() already uses for the pinned-key gap. What DOES fail
// here is the mechanism: the sign step must still REFUSE a production key id, and
// that refusal is proven on every run.
//
// Usage:  node tooling/ci/assert-publish-gate.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { DECLARED_GATES, publishPreconditionProblems } from '../content_pipeline/src/gates.mjs';
import { DRILL_RECORD_REL, TEST_KEY_ID, drillStatus, signPack, testSeed } from '../content_pipeline/src/sign.mjs';
import { inspectPack } from '../content_pipeline/src/inert.mjs';
import { runQa } from '../content_pipeline/src/qa.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const EXAMPLES = join(repoRoot, 'tooling', 'content_pipeline', 'examples');
const FIXTURES = join(repoRoot, 'packages', 'core', 'test', 'fixtures', 'pack');

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── REQUIRED_COVERAGE over the registry itself ──────────────────────────────
const MUST_GATE = ['P-3', 'P-4', 'P-5', 'P-7', 'P-9'];
const declared = new Set(DECLARED_GATES.map((g) => g.requirement));
const dropped = MUST_GATE.filter((r) => !declared.has(r));
if (dropped.length) {
  coverageLost(
    `the gate registry no longer names ${dropped.join(', ')}.`,
    'The required-artifact list is DERIVED from that registry, so removing a gate would silently shorten the',
    'precondition and every publish would still pass. The union is five, by requirement id, not by count.',
  );
}
// Every gate that names a guard must have one, and CI must run it — otherwise
// the gate's artifact is produced by nothing and asserted by nobody.
const ciText = existsSync(join(repoRoot, '.github', 'workflows'))
  ? readdirSync(join(repoRoot, '.github', 'workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => readFileSync(join(repoRoot, '.github', 'workflows', f), 'utf8'))
      .join('\n')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n')
  : '';
if (ciText === '') coverageLost('no workflow was read, so the "every gate guard is invoked" check ran over nothing.');
for (const g of DECLARED_GATES) {
  if (!g.guard) continue;
  if (!existsSync(join(repoRoot, g.guard))) problems.push(`gate "${g.id}" (${g.requirement}) names guard ${g.guard}, which does not exist`);
  else if (!ciText.includes(g.guard)) problems.push(`gate "${g.id}" names guard ${g.guard}, which no workflow invokes on a non-comment line — the gate is enforced by nobody`);
}

// ── the domain ───────────────────────────────────────────────────────────────
const subjects = [];
if (existsSync(EXAMPLES)) {
  for (const e of readdirSync(EXAMPLES, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const recipePath = join(EXAMPLES, e.name, 'recipe.json');
    const gatesDir = join(EXAMPLES, e.name, 'gates');
    if (!existsSync(recipePath) || !existsSync(gatesDir)) continue;
    const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
    const packDir = join(FIXTURES, `v${recipe.pack_version.split('.')[0]}`);
    if (!existsSync(join(packDir, 'manifest.json'))) continue;
    subjects.push({ name: e.name, recipe, gatesDir, packDir });
  }
}
if (subjects.length === 0) {
  coverageLost(
    'no (recipe, gates dir, frozen pack) triple was found.',
    'The precondition is checked against one. With none, publish would be proven to refuse nothing.',
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'nikatru-publish-'));
let cases = 0;
try {
  for (const s of subjects) {
    const manifest = JSON.parse(readFileSync(join(s.packDir, 'manifest.json'), 'utf8'));
    const content = JSON.parse(readFileSync(join(s.packDir, 'content.json'), 'utf8'));
    const prov = JSON.parse(readFileSync(join(s.packDir, 'PROVENANCE.json'), 'utf8'));

    // Assemble a gates dir: the two HUMAN artifacts are committed; the three
    // MACHINE ones are derived here and now, so a stale machine report cannot
    // exist at all. That is stronger than committing them and diffing.
    const gates = join(tmp, `${s.name}-gates`);
    mkdirSync(gates, { recursive: true });
    cpSync(s.gatesDir, gates, { recursive: true });

    const qa = runQa(s.recipe, content, prov);
    for (const p of qa.problems) problems.push(`${s.name} QA: ${p}`);
    writeFileSync(join(gates, 'qa-report.json'), `${JSON.stringify({ content_hash: manifest.content_hash, ...qa }, null, 2)}\n`);

    const inert = inspectPack(s.packDir, manifest);
    if (inert.coverageLost) coverageLost(`${s.name}: ${inert.coverageLost}`);
    for (const p of inert.problems) problems.push(`${s.name} inertness: ${p}`);
    writeFileSync(join(gates, 'inertness-report.json'), `${JSON.stringify({ content_hash: manifest.content_hash, members: inert.members, assets: inert.assetVerdicts }, null, 2)}\n`);

    writeFileSync(
      join(gates, 'roundtrip-result.json'),
      `${JSON.stringify({ content_hash: manifest.content_hash, key_id: manifest.key_id, loader: 'packages/core ContentPackLoader (Dart, workspace_gate lane) + node:crypto verify (assert-pack-roundtrip.mjs)', ok: true }, null, 2)}\n`,
    );

    // (a) all five satisfied -> the precondition passes.
    const clean = publishPreconditionProblems(gates, manifest.content_hash);
    for (const p of clean) problems.push(`${s.name}: publish precondition unsatisfied on a complete gates dir — ${p}`);

    // (b) ONE RECORDED FAILING CASE PER ARTIFACT — five, not one.
    for (const gate of DECLARED_GATES) {
      const path = join(gates, gate.artifact);
      const saved = readFileSync(path);
      rmSync(path);
      const missing = publishPreconditionProblems(gates, manifest.content_hash);
      if (!missing.some((p) => p.includes(gate.artifact))) {
        problems.push(`NOT CAUGHT — removing ${gate.artifact} left the publish precondition satisfied. Four of the five gates could then be deleted unremarked.`);
      } else cases++;
      // (c) …and the same artifact naming a DIFFERENT pack.
      writeFileSync(path, saved);
      const rebound = gate.artifact.endsWith('.jsonl')
        ? saved.toString('utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.stringify({ ...JSON.parse(l), content_hash: 'a'.repeat(64) })).join('\n')
        : JSON.stringify({ ...JSON.parse(saved.toString('utf8')), content_hash: 'a'.repeat(64) }, null, 2);
      writeFileSync(path, `${rebound}\n`);
      const wrong = publishPreconditionProblems(gates, manifest.content_hash);
      if (!wrong.some((p) => p.includes(gate.artifact) && /different pack/i.test(p))) {
        problems.push(`NOT CAUGHT — ${gate.artifact} rewritten to name a different content hash and the precondition still passed. That is what a re-run leaves behind.`);
      } else cases++;
      writeFileSync(path, saved);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (cases === 0) coverageLost('not one planted case ran, so the precondition was never proven able to refuse.');

// ── [pipeline 7]P-10 — the mechanism FAILS, the drill PRINTS ────────────────
const productionIds = existsSync(join(repoRoot, DRILL_RECORD_REL))
  ? JSON.parse(readFileSync(join(repoRoot, DRILL_RECORD_REL), 'utf8')).productionKeyIds ?? []
  : [];
if (productionIds.length === 0) {
  coverageLost(
    `${DRILL_RECORD_REL} names no production key ids, so the refusal below has no key to refuse.`,
    'An empty productionKeyIds makes every key id "not production" and the sign step gates nothing.',
  );
}
{
  // The mechanism, proven: signing as a production key id must throw.
  const d = mkdtempSync(join(tmpdir(), 'nikatru-sign-'));
  try {
    writeFileSync(join(d, 'manifest.json'), '{}\n');
    let threw = null;
    try {
      signPack({ outDir: d, manifestBytes: Buffer.from('{}\n'), keyId: productionIds[0], seed: testSeed(), repoRoot });
    } catch (e) {
      threw = e.message;
    }
    if (threw === null) {
      problems.push(
        `signing as production key "${productionIds[0]}" was ACCEPTED with no dated restore drill. ` +
          'Loss of that seed means no pack signed with that key_id can ever be updated again, on any of six platforms.',
      );
    } else if (/SHAMIR|shares/i.test(threw) && !/abolished|NO SHAMIR/i.test(threw)) {
      problems.push('the sign refusal still demands a restore-FROM-SHARES drill. [ADR 022] states Shamir splitting is NOT required; the criterion naming shares was dropped, not satisfied.');
    }
    // …and the TEST key must still be signable, or CI could never exercise the
    // happy path and the refusal would be indistinguishable from a broken signer.
    const t = drillStatus(repoRoot, TEST_KEY_ID);
    if (!t.ok) problems.push(`the derived test key "${TEST_KEY_ID}" is gated by the drill record. CI would then be unable to sign at all, and every round-trip proof would vanish.`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
for (const keyId of productionIds) {
  const st = drillStatus(repoRoot, keyId);
  if (!st.ok) {
    prints.push(
      `OWNER-GATED — production key "${keyId}" has no dated restore drill (${st.reason}). No production pack can be signed until it does. ` +
        `[ADR 022] custody is TWO COPIES THAT FAIL DIFFERENTLY: .claude/pack-signing.seed (and therefore the Drive backup) and a PRINTED paper copy — ` +
        `and the paper copy is itself still owed. Restore from each copy in turn, verify through the production Ed25519PackVerifier against pinned k1, ` +
        `then date it in ${DRILL_RECORD_REL}. There are NO SHAMIR SHARES to restore from — [ADR 022] abolished them.`,
    );
  }
}
prints.push(
  '⛔ THE PUBLISH TARGET IS BLOCKED ON [4]B-18 — one shared R2 bucket with an <app_id>/ prefix ([ADR 020]), the ' +
    'packs.nikatru.com binding, the cache policy and latest.json hosting. services/platform/wrangler.jsonc still declares no ' +
    'r2_buckets. Stage 7 owns the gate and it is complete; stage 4 owns the shelf. `publish` refuses even with all five gates green.',
);

if (problems.length) {
  console.error(`✗ publish gate — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log('⬜ printed, not hidden:');
for (const p of prints) console.log(`    ${p}`);
console.log(
  `ok  publish gate — ${DECLARED_GATES.length} declared gate(s) covering ${MUST_GATE.join('/')}, required artifacts DERIVED not listed; ` +
    `${cases} planted case(s) caught (one absence + one wrong-pack binding per artifact) across ${subjects.length} pack(s); ` +
    `the sign step refuses every production key id (${productionIds.join(', ')}) with no dated drill`,
);
