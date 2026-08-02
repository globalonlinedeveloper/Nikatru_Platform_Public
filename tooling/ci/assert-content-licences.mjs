#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-content-licences.mjs — [pipeline 7]P-5 / G-36: no asset ships in a
// content pack without a cleared licence row.
//
// 🔴 THE REGISTER IS IN tooling/legal/, AND THE STAGE FILE SAYS company/. That is
// not a filing preference. `company/` is gitignored (.gitignore line 15) and is
// not in the public repository, so a guard pointed at
// `company/compliance/licence-register` reads NOTHING on a runner: existsSync
// returns false, the row set is empty, and the guard prints a clean tree over an
// empty domain. It is the same defect that stopped four stage-8 increments until
// PR #117 settled the in-tree home — see tooling/legal/README.md. Nothing in a
// third-party font, model or vendor licence is private business data.
//
// 🔴 THE RULE THAT MAKES A ROW WORTH HAVING: every verdict carries a BASIS. Not a
// value — a basis. `clause:<n>` means the licence says so and quotes it;
// `absence` means the licence is SILENT and silence is being read as permission
// ([ADR 019] accepts exactly that for the Gemini route, knowingly and without
// indemnity); `owner-lock` names the decision that accepted the risk;
// `UNVERIFIED` means nobody has read the primary text and is treated as NOT
// CLEARED. A row recording `commercial_use: yes` and nothing else certifies the
// wrong thing — OFL 1.1's subsetting/Reserved-Font-Name pair is the worked
// example, and it is in the register in full for that reason.
//
// PRINT vs FAIL, per tooling/legal/README.md: an uncleared row for a family
// NOTHING CONSUMES prints (per-row legal sign-off is owner judgement, and failing
// every CI run on it blocks all other work). A recipe that DECLARES an uncleared
// family fails. So the register can carry honest gaps while it stays impossible
// to ship past one.
//
// Usage:  node tooling/ci/assert-content-licences.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

import { IMPLEMENTED_MODALITIES, QA_IMPLEMENTED_MODALITIES } from '../content_pipeline/src/recipe.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const REGISTER_REL = 'tooling/legal/content-licence-register.json';
const REGISTER = join(repoRoot, REGISTER_REL);
const EXAMPLES = join(repoRoot, 'tooling', 'content_pipeline', 'examples');

const problems = [];
const prints = [];
const coverageLost = (...lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

if (!existsSync(REGISTER)) {
  coverageLost(
    `${REGISTER_REL} does not exist.`,
    'The register is the left-hand side of every comparison here. Absent, this guard compares a recipe to',
    'nothing and prints ok — which is precisely what a register under the gitignored company/ would do on',
    'every CI run, forever.',
  );
}
let reg;
try {
  reg = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (e) {
  coverageLost(`${REGISTER_REL} is not valid JSON (${e.message}).`);
}
const families = Array.isArray(reg.families) ? reg.families : [];
if (families.length === 0) coverageLost(`${REGISTER_REL} declares no families, so every check below ranges over an empty set.`);
const byName = new Map(families.map((f) => [f.family, f]));
const verdictFields = Array.isArray(reg.verdictFields) ? reg.verdictFields : [];
if (verdictFields.length === 0) {
  coverageLost(
    `${REGISTER_REL} declares no verdictFields.`,
    'The per-row completeness check below iterates that list, so an empty list makes every row complete.',
  );
}
const requiredCoverage = Array.isArray(reg.requiredCoverage) ? reg.requiredCoverage : [];
if (requiredCoverage.length === 0) {
  coverageLost(`${REGISTER_REL} declares no requiredCoverage, so a register holding one trivial row would pass.`);
}

// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
for (const name of requiredCoverage) {
  if (!byName.has(name)) {
    problems.push(`requiredCoverage names "${name}" and the register has no row for it. The corpus already knows this factory consumes it.`);
  }
}

// ── per-row completeness, banned ids, archived text ─────────────────────────
const banned = Array.isArray(reg.bannedLicencePrefixes) ? reg.bannedLicencePrefixes : [];
const uncleared = [];
for (const row of families) {
  const at = `${REGISTER_REL} "${row.family}"`;
  if (!row.family) problems.push(`${REGISTER_REL}: a row has no "family" name`);
  if (typeof row.licence_id !== 'string' || row.licence_id === '') problems.push(`${at}: no licence_id`);
  if (row.source === undefined) problems.push(`${at}: no source block. A licence claim with no source is not a licence claim.`);

  for (const f of verdictFields) {
    const v = row.verdicts?.[f];
    if (v === undefined) {
      problems.push(`${at}: no verdict for "${f}". Each verdict answers a different question; none substitutes for another.`);
      continue;
    }
    if (typeof v !== 'object' || v === null) {
      problems.push(`${at}: verdict "${f}" is not a {value, basis, clauseText} object`);
      continue;
    }
    if (!v.value) problems.push(`${at}: verdict "${f}" has no value`);
    if (!v.basis) problems.push(`${at}: verdict "${f}" has no basis. A value with no basis is a guess wearing a citation.`);
    if (!String(v.clauseText ?? '').trim()) problems.push(`${at}: verdict "${f}" quotes nothing — the basis is unreadable`);
  }

  for (const prefix of banned) {
    if (String(row.licence_id).toUpperCase().startsWith(prefix.toUpperCase())) {
      problems.push(
        `${at}: licence_id "${row.licence_id}" is REFUSED AT INTAKE. ${prefix} cannot ship here — NC excludes commercial ` +
          "distribution outright, and SA's anti-ETM term is refuted by the Ed25519 signature on our packs, which cannot be " +
          'removed without removing the fail-closed verifier.',
      );
    }
  }

  if (row.archived_text !== null && row.archived_text !== undefined) {
    if (!existsSync(join(repoRoot, row.archived_text))) {
      problems.push(`${at}: archived_text "${row.archived_text}" is not on disk. An archive that is not there is a URL that has already rotted.`);
    }
  }

  const hasUnverified = verdictFields.some((f) => String(row.verdicts?.[f]?.value ?? '').toUpperCase() === 'UNVERIFIED');
  const signed = Boolean(row.cleared_by) && Boolean(row.cleared_on);
  if (!signed || hasUnverified) {
    uncleared.push(row);
    if (!row.wouldNeed) {
      problems.push(`${at}: not cleared and no "wouldNeed". An UNVERIFIED row that does not say what would settle it is a permanent shrug.`);
    }
  }
}

// ── tripwires: a family that is not consumed YET, asserted anyway ───────────
// A row about something absent from the tree would be judgement over nothing.
// A tripwire turns it into an assertion: the guard fails the moment the thing
// arrives while the row is still uncleared.
const pubspecs = [];
const collectPubspecs = (dir, depth) => {
  if (depth > 4 || !existsSync(dir)) return;
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name.startsWith('.')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) collectPubspecs(abs, depth + 1);
    else if (e.name === 'pubspec.yaml') pubspecs.push(abs);
  }
};
for (const top of ['apps', 'packages', 'tooling']) collectPubspecs(join(repoRoot, top), 0);
if (existsSync(join(repoRoot, 'pubspec.yaml'))) pubspecs.push(join(repoRoot, 'pubspec.yaml'));
if (pubspecs.length === 0) {
  coverageLost('no pubspec.yaml was found anywhere, so every tripwire below scanned nothing and reported clean.');
}
const pubspecText = pubspecs.map((p) => readFileSync(p, 'utf8')).join('\n');
let tripwires = 0;
for (const row of families) {
  if (!row.tripwire?.token) continue;
  tripwires++;
  const present = pubspecText.includes(row.tripwire.token);
  const signed = Boolean(row.cleared_by) && Boolean(row.cleared_on);
  if (present && !signed) {
    problems.push(
      `${REGISTER_REL} "${row.family}": the tripwire token "${row.tripwire.token}" is now IN A PUBSPEC and the row is not cleared. ` +
        `${row.tripwire.why}`,
    );
  } else if (!present) {
    prints.push(`tripwire "${row.family}" armed and not tripped — "${row.tripwire.token}" appears in none of the ${pubspecs.length} pubspec(s) scanned`);
  }
}

// ── the recipes: a declared family must exist AND be cleared ────────────────
const recipes = [];
if (existsSync(EXAMPLES)) {
  for (const e of listDir(EXAMPLES, { withFileTypes: true })) {
    const p = join(EXAMPLES, e.name, 'recipe.json');
    if (e.isDirectory() && existsSync(p) && statSync(p).isFile()) recipes.push(p);
  }
}
if (recipes.length === 0) {
  coverageLost(
    'no recipe was found, so the "a pack may not declare an uncleared family" limb — the only one that can BLOCK a ship — ran over nothing.',
  );
}
let declaredFamilies = 0;
for (const path of recipes) {
  const rel = relative(repoRoot, path).split('\\').join('/');
  const recipe = JSON.parse(readFileSync(path, 'utf8'));
  for (const name of recipe.licence_families ?? []) {
    declaredFamilies++;
    const row = byName.get(name);
    if (!row) {
      problems.push(`${rel} declares licence family "${name}" and the register has no row for it — the pack consumes something nobody has cleared`);
      continue;
    }
    if (uncleared.includes(row)) {
      problems.push(
        `${rel} declares licence family "${name}", whose register row is NOT CLEARED ` +
          `(${row.cleared_by ? 'an UNVERIFIED verdict' : 'no cleared_by/cleared_on'}). ${row.wouldNeed ?? ''}`,
      );
    }
  }
  // …and the gate artifact must AGREE with the register, so a stale clearance
  // cannot outlive the fact it recorded.
  const clearance = join(path, '..', 'gates', 'licence-clearance.json');
  if (existsSync(clearance)) {
    const doc = JSON.parse(readFileSync(clearance, 'utf8'));
    const claimed = new Set((doc.families ?? []).filter((f) => f.cleared).map((f) => f.family));
    for (const name of claimed) {
      const row = byName.get(name);
      if (!row || uncleared.includes(row)) {
        problems.push(
          `${relative(repoRoot, clearance).split('\\').join('/')} claims "${name}" is cleared and ${REGISTER_REL} does not. ` +
            'A clearance artifact that outlives the register row it copied is how a re-run ships past a withdrawn verdict.',
        );
      }
    }
    for (const name of recipe.licence_families ?? []) {
      if (!claimed.has(name)) problems.push(`${relative(repoRoot, clearance).split('\\').join('/')} does not clear "${name}", which the recipe declares`);
    }
  }
}
if (declaredFamilies === 0) {
  coverageLost('not one recipe declares a licence family, so the blocking limb had no subject.');
}

// ── the honest gaps ─────────────────────────────────────────────────────────
for (const row of uncleared) {
  prints.push(`NOT CLEARED — ${row.family} (${row.licence_id}). ${row.wouldNeed ?? ''}`);
}
const qaModels = reg.qaModels?.models ?? [];
const qaGap = IMPLEMENTED_MODALITIES.filter((m) => !QA_IMPLEMENTED_MODALITIES.includes(m));
if (qaModels.length === 0 && qaGap.length) {
  prints.push(
    `qaModels is EMPTY, and that is accurate rather than a stub: the QA stage implements ${QA_IMPLEMENTED_MODALITIES.join('/')} only, ` +
      `which uses no third-party model. ${qaGap.join(', ')} have no machine check at all — so "no model rows" must not be read as ` +
      '"the model limbs are cleared". Land each model-bearing limb WITH its register row, never before.',
  );
}

if (problems.length) {
  console.error(`✗ content licences — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 7]P-5 / G-36 — a store can ask for rights evidence without warning, and the answer has');
  console.error('  to be a file rather than a search.');
  process.exit(1);
}
if (prints.length) {
  console.log('⬜ printed, not hidden:');
  for (const p of prints) console.log(`    ${p}`);
}
console.log(
  `ok  content licences — ${families.length} family row(s), ${requiredCoverage.length} required and all present, ` +
    `${verdictFields.length} verdict field(s) complete on every row; ${tripwires} tripwire(s) armed; ` +
    `${declaredFamilies} family declaration(s) across ${recipes.length} recipe(s), every one cleared; ${uncleared.length} row(s) not cleared and printed`,
);
