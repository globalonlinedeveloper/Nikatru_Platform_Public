#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-content-licences.mjs — [pipeline 7]P-5 / G-36: no asset ships in a
// content pack without a cleared licence row.
//
// 🔴 THE REGISTER IS IN tooling/legal/, AND THE STAGE FILE SAID Private/company/ (deleted
// 2026-08-15). That is not a filing preference. `Private/` — what the flatten merged it
// into — is gitignored (.gitignore:22) and is not in the public repository, so a guard pointed at
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
// The seam against [8]K-10's register. Imported by BOTH guards on purpose: a
// disagreement between the two registers must turn both red, or the one that
// stays green is the one somebody quotes. See licence-cross-assert.mjs.
import { crossAssertLicenceRegisters } from './licence-cross-assert.mjs';

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
    'nothing and prints ok — which is precisely what a register under the gitignored Private/ would do on',
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
// 🔴 NO DEPTH CAP, AND REMOVING IT — NOT RAISING IT — IS THE REPAIR.
// Until 2026-09-05 this walk opened `if (depth > 4 || !existsSync(dir)) return;`
// and that number was a SILENT COVERAGE LIMIT. The brick's app pubspec lives at
// `tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml` — SIX directory
// levels below `tooling/` — so the walk turned back one level short of it and
// the template EVERY future app is born from was never in the domain at all.
//
// MEASURED ON THIS TREE 2026-09-05, before the repair: append
// `awesome_notifications_fcm: ^0.10.0` to that brick pubspec — the exact
// dependency the one armed tripwire exists to catch — and the guard printed
//
//   tripwire "awesome_notifications_fcm" armed and not tripped — appears in
//   none of the 12 pubspec(s) scanned (apps=1, packages=9, tooling=1, root=1)
//
// and exited 0. `tooling=1` was the hooks pubspec alone. The token was in the
// file, the file was on disk, and the file was not in the scan. One unlicensed
// dependency added to the template is fifty apps born carrying it.
//
// Raising the cap to 6 was refused: a bigger magic number fails identically the
// day the brick nests one level deeper, and nothing would say so. So the cap is
// GONE; the prune that remains is semantic (generated output and dot-directories
// are not source, and `listDir` already refuses nested checkouts); and what the
// walk must REACH is declared by name in REQUIRED_PUBSPECS below, so a walk that
// stops reaching it fails instead of shrinking in silence.
const PRUNED_DIRS = new Set(['node_modules', 'build']);
const collectPubspecs = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (PRUNED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) collectPubspecs(abs);
    else if (e.name === 'pubspec.yaml') pubspecs.push(abs);
  }
};

// 🔴 ONE FLOOR PER SCOPE ROOT, NEVER ONE FLOOR OVER THE UNION.
// `tooling` holds the brick template, and the brick is a CONSTANT: it ships a
// pubspec.yaml no matter what happens to the product tree. A single
// `pubspecs.length === 0` floor over the union is therefore satisfied by the
// brick ALONE while every real app and package disappears.
// Measured on the real tree 2026-08-17 by emptying `apps/` and `packages/` and
// keeping `tooling/`: this scan fell from 12 pubspec(s) to 2, and the tripwire
// limb below still printed `appears in none of the 2 pubspec(s) scanned` and
// exited 0. A tripwire that reads the brick and pronounces the product tree
// clean is exactly the vacuous pass this corpus keeps paying for.
// ⏱ APPENDED 2026-09-05 — the paragraph above is left exactly as written; this
// corpus appends dated corrections rather than rewriting them. That measurement
// was taken against the depth-capped walk, so its "2" was the union of the
// brick's HOOKS pubspec and the repo-root one. With the cap gone the same
// mutation leaves 3, because the brick's app pubspec is finally in the scan.
// Nothing about the conclusion changes: a union floor of 1 is satisfied by
// either number while every app and package is gone.
//
// Each root therefore states its OWN requirement, and the two fields answer
// different questions:
//   · `structuralFloor` is asserted over ANY tree this guard is pointed at,
//     including the deliberately partial fixtures in tooling/ci/test. 0 means
//     the root is legitimately absent from such a tree, so nothing structural
//     can be said about it and the full-checkout limbs speak for it instead.
//   · `floor` is a MEASUREMENT OF THIS REPOSITORY and is applied only over a
//     full checkout (see IS_FULL_CHECKOUT). `floor: 0` means this root's
//     requirement is not a count at all — see the note on `tooling` below.
//
// ⚠️ `tooling` CARRIES NO NUMBER, AND THAT IS THE STRONGER CHOICE, NOT THE
// WEAKER ONE. A floor of 2 was written here first — 2 being today's count and 1
// being what the depth cap used to yield — and then removed, because it CANNOT
// FAIL: every pubspec under `tooling/` is one of the two landmarks named in
// REQUIRED_PUBSPECS below, so any state that would drop the count under 2 is
// already refused, by name and with the reason, one limb earlier. An assertion
// that cannot fail reads as coverage and is not coverage; this corpus deletes
// them. `tooling`'s requirement is the landmark list, which says WHICH file
// went missing where a count can only say how many.
const REQUIRED_COVERAGE = [
  { dir: 'apps', structuralFloor: 1, floor: 1, label: 'the shipped apps — what an end user installs (1 pubspec today)' },
  { dir: 'packages', structuralFloor: 1, floor: 5, label: 'the shared chassis every app links (9 pubspecs today)' },
  {
    dir: 'tooling',
    structuralFloor: 0,
    floor: 0,
    label:
      'the brick template every future app is born from — the app pubspec under `__brick__` plus the mason hooks '
      + '(2 pubspecs today), required BY NAME in REQUIRED_PUBSPECS rather than by count. Structural floor 0 because '
      + 'tooling/ci/test builds partial trees that copy tooling/ci, tooling/legal and tooling/content_pipeline '
      + 'without tooling/bricks, and those trees hold no brick to read.',
  },
];
const SCAN_ROOTS = REQUIRED_COVERAGE.map((r) => r.dir);

// The measured floors above mean nothing over a partial tree, so they are
// applied only when `repoRoot` is a full checkout of THIS repository — detected
// by `mason.yaml`, the brick registry, which sits at the repo root and therefore
// OUTSIDE apps/, packages/ and tooling/. That matters: a sentinel inside a
// subject tree is destroyed by a mutation OF that subject, which switches the
// floors off at exactly the moment they are meant to fire.
// ⚠️ This guard's OWN FILE would be the obvious sentinel — it is what
// assert-no-tls-pinning.mjs uses — and it is WRONG HERE, measured rather than
// assumed: tooling/ci/test/content-pipeline.test.mjs copies the whole of
// tooling/ci into its fixture, so `assert-content-licences.mjs` is present in a
// tree that deliberately has no tooling/bricks. Keyed on that file, every case
// in that suite would fail COVERAGE LOST for a root it never meant to supply.
// WHICH BRANCH WAS TAKEN IS PRINTED ON EVERY RUN, at the bottom of this file.
const MASON_REL = 'mason.yaml';
const IS_FULL_CHECKOUT = existsSync(join(repoRoot, MASON_REL));

// 🔴 A COUNT CANNOT NAME WHICH FILE WENT MISSING, SO THE LANDMARKS ARE NAMED.
// These are the pubspecs whose ABSENCE FROM THE SCAN is the G-2 defect itself.
// Two limbs, deliberately separate because they catch opposite failures:
//   L1 — the file is ON DISK and the walk did not collect it. That is a walk
//        that narrowed (a re-added depth cap, a new prune, a rename of a parent
//        directory into something skipped), and it is checked over EVERY tree,
//        full checkout or not, because it compares the walk against disk rather
//        than against an expectation.
//   L2 — the file is not on disk at all. Over a full checkout that is a landmark
//        that was deleted or moved without this list being updated. Over a
//        partial fixture it is simply a subject that tree never had, so L2 is
//        gated on IS_FULL_CHECKOUT and L1 is not.
const REQUIRED_PUBSPECS = [
  {
    rel: 'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml',
    why:
      'the app brick\'s own pubspec. Every app this factory will ever stamp inherits its dependency list verbatim, '
      + 'so a content or asset dependency added here is added to fifty apps at once — and it is the file the depth '
      + 'cap removed from this guard\'s domain (G-2).',
  },
  {
    rel: 'tooling/bricks/app/hooks/pubspec.yaml',
    why:
      'the mason generation hooks. It is the ONLY pubspec the old depth-capped walk did reach under tooling/, so if '
      + 'it too stops being collected the walk did not narrow — it collapsed.',
  },
];

const perRoot = new Map();
for (const top of SCAN_ROOTS) {
  const before = pubspecs.length;
  collectPubspecs(join(repoRoot, top));
  perRoot.set(top, pubspecs.length - before);
}
if (existsSync(join(repoRoot, 'pubspec.yaml'))) pubspecs.push(join(repoRoot, 'pubspec.yaml'));
const perRootSummary = SCAN_ROOTS.map((r) => `${r}=${perRoot.get(r)}`).join(', ');
for (const r of REQUIRED_COVERAGE) {
  if (r.structuralFloor > 0 && perRoot.get(r.dir) === 0) {
    coverageLost(
      `found 0 pubspec.yaml under ${r.dir}/, so every tripwire below judged the product tree without reading it.`,
      `Per-root counts: ${perRootSummary}.`,
      'The floor is PER ROOT and deliberately 1, not today\'s count: a floor pinned to the current number is a',
      'floor somebody lowers, while a floor of 1 per root can only fire when a whole root stopped being scanned.',
    );
  }
}
const collected = new Set(pubspecs.map((p) => relative(repoRoot, p).split('\\').join('/')));
const landmarksOnDisk = REQUIRED_PUBSPECS.filter((r) => existsSync(join(repoRoot, r.rel)));
const landmarksReached = landmarksOnDisk.filter((r) => collected.has(r.rel)).length;
const unreached = landmarksOnDisk.filter((r) => !collected.has(r.rel));
if (unreached.length) {
  coverageLost(
    `${unreached.length} pubspec(s) this guard must read are ON DISK and were NOT collected by the walk.`,
    ...unreached.flatMap((r) => [`· ${r.rel}`, `  ${r.why}`]),
    `Per-root counts: ${perRootSummary}; ${pubspecs.length} pubspec(s) collected in total.`,
    'This is G-2 recurring. The walk has stopped reaching a file that is sitting right there — a depth cap, a new',
    'prune, or a parent directory renamed into something skipped. Every tripwire below would then report the',
    'template clean without reading one line of it, which is what it did until 2026-09-05.',
  );
}
if (IS_FULL_CHECKOUT) {
  const missing = REQUIRED_PUBSPECS.filter((r) => !existsSync(join(repoRoot, r.rel)));
  if (missing.length) {
    coverageLost(
      `${missing.length} declared landmark pubspec(s) are not on disk under this full checkout.`,
      ...missing.flatMap((r) => [`· ${r.rel}`, `  ${r.why}`]),
      'Either the brick moved and REQUIRED_PUBSPECS above was not updated with it, or the brick is gone. Both are',
      'answers a human gives; neither is a scan quietly getting smaller.',
    );
  }
}
if (IS_FULL_CHECKOUT) {
  const floored = REQUIRED_COVERAGE.filter((r) => r.floor > 0);
  const belowFloor = floored.filter((r) => perRoot.get(r.dir) < r.floor);
  if (belowFloor.length) {
    coverageLost(
      `${belowFloor.length} of the ${floored.length} numerically floored root(s) fell below their own measured floor.`,
      ...belowFloor.map((r) => `· ${r.dir}/ yielded ${perRoot.get(r.dir)} pubspec(s), floor ${r.floor} — ${r.label}`),
      `Per-root counts: ${perRootSummary}. ${MASON_REL} is present, so this root is a full checkout of this`,
      'repository and the measured floors apply. They are measurements of THIS tree, never a target: each one can',
      'only fire when a root that had a subject stopped delivering it. (`tooling` is not among them — its',
      'requirement is the named landmark list one limb above, which is stronger than any count.)',
    );
  }
}
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
    prints.push(`tripwire "${row.family}" armed and not tripped — "${row.tripwire.token}" appears in none of the ${pubspecs.length} pubspec(s) scanned (${perRootSummary}, root=${existsSync(join(repoRoot, 'pubspec.yaml')) ? 1 : 0})`);
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

// ── the seam against [8]K-10's asset register ───────────────────────────────
// P-5 owns content-pipeline INPUTS; K-10 owns BUILT-BUNDLE contents. A family
// can be in both, and until 2026-08-13 nothing compared what the two files said
// about one. Both requirement texts now carry the boundary sentence verbatim;
// this is the half of it that fails a build.
const seam = crossAssertLicenceRegisters(repoRoot, { side: 'content' });
problems.push(...seam.problems);
prints.push(...seam.prints);

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
// 🔴 THE PASSING LINE STATES WHAT IT READ AND UNDER WHICH BRANCH. Until
// 2026-09-05 it named no pubspec at all, so the day the walk fell from 12 files
// to 11 — the brick's app pubspec dropping out behind a depth cap — every word
// of it stayed true. A per-root split and a named branch cannot be true of a
// scan that quietly narrowed.
const coverageMode = IS_FULL_CHECKOUT
  ? `FULL CHECKOUT (${MASON_REL} present), so the measured per-root floors [` +
    `${REQUIRED_COVERAGE.filter((r) => r.floor > 0).map((r) => `${r.dir} floor ${r.floor}`).join(', ')}; tooling ` +
    `by named landmark, not by count] and the "every landmark is on disk" check both ran`
  : `PARTIAL TREE (no ${MASON_REL} at ${repoRoot}), so the measured per-root floors and the "every landmark is on ` +
    'disk" check were NOT applied — only the structural per-root floors and "the walk reached every landmark that ' +
    'IS on disk" ran';
console.log(
  `ok  content licences — ${families.length} family row(s), ${requiredCoverage.length} required and all present, ` +
    `${verdictFields.length} verdict field(s) complete on every row; ${tripwires} tripwire(s) armed over ` +
    `${pubspecs.length} pubspec(s) [${perRootSummary}, root=${existsSync(join(repoRoot, 'pubspec.yaml')) ? 1 : 0}] ` +
    `of which ${landmarksReached} of the ${REQUIRED_PUBSPECS.length} declared landmark(s) were on disk and every ` +
    `one of those was reached; coverage mode: ${coverageMode}; ` +
    `${declaredFamilies} family declaration(s) across ${recipes.length} recipe(s), every one cleared; ${uncleared.length} row(s) not cleared and printed`,
);
