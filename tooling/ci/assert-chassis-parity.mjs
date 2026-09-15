#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-chassis-parity.mjs — THE FACTORY IS THE BASE, AND THIS IS WHAT CHECKS
// THAT THE APPS FOLLOW IT.
//
// [ADR 067] moved the generic screens and services out of the app and into
// `packages/`, and rewrote the app template to DELEGATE to them. Nothing checked
// that a shipping app did the same. The result, measured 2026-09-12: the next app
// stamped from the template is more modern than the app this repository actually
// ships, and every fix landed in a shared package reaches the template and not the
// live app.
//
// ── WHY THIS GUARD AND NOT A FILE DIFF ───────────────────────────────────────
// 🔴 AN APP IS SUPPOSED TO DIFFER FROM THE TEMPLATE. It has its own screens, its
// own content, its own tables. A byte-comparison would be red forever and would
// teach everyone to ignore it. What is NOT allowed to differ is the ANSWER TO ONE
// QUESTION: does the app get a shared capability from the shared package, or does
// it keep a private copy of it?
//
// So the subject is the IMPORT, not the file. For every `package:nikatru_*` the
// template imports, every shipping app must import it somewhere. That is a fact a
// scan can establish exactly, in both directions, with no judgement call — and it
// is precisely the property that was violated.
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT ASK. It does not compare file for file.
// `apps/subscriptiontracker/lib/core/router.dart` is 74 lines against the
// template's 552 — not because the app copied less, but because the app SPLIT the
// router into `lib/core/router/*.dart`, and it imports the shared packages from
// there. A per-file rule would have called that drift and been wrong. Measured
// before this guard was written, which is why the rule is per PACKAGE.
//
// ── THE RATCHET ──────────────────────────────────────────────────────────────
// `tooling/chassis-parity.json` records the packages a named app has not adopted
// YET, each with a reason, a cost and a plan. A row is a debt written down, never
// permission. Three ways to go red, and the third is the one that keeps the file
// honest:
//   1. a package the template imports that an app imports nowhere and NO row
//      declares — new drift, refused;
//   2. a declared row whose `files` no longer match the template files that import
//      that package — the template gained or lost a delegation and nobody decided
//      what the app should do about it;
//   3. a declared row for a package the app NOW imports — the debt is paid and the
//      row must be deleted, or this file becomes a list of things that used to be
//      true, which is how the register rows in this repository rot.
//
// ── ⏱ 2026-09-15 · [ADR 086] PARTIAL ADOPTION IS A STATE, NOT A PAID DEBT ──────
// The owner decided the live app adopts the chassis ONE SCREEN (or shell piece)
// AT A TIME. Rule 3 above read the first adopted piece as "the debt is paid —
// delete the row", which would have erased the record of every screen still owed
// the day the first one moved. So a row may now carry `adopted`: one entry per
// app file that imports the package, each with the chassis `piece` it took, the
// `on` date and its measured `callSiteDelta` (lines after − before, after
// `dart format` in CI's mode). Graded both ways against the scan:
//   · the app files that import the package must equal the `adopted` files —
//     an import nobody recorded, or a record with no import, is a finding;
//   · every `callSiteDelta` must be NEGATIVE — [ADR 066]'s rule that a move lands
//     only where the calling code measurably shrinks;
//   · an app that imports the package with a row and NO `adopted` is still rule 3.
//
// ── COVERAGE, FAIL-CLOSED ────────────────────────────────────────────────────
// Exit 2 when the scan cannot establish its own subject: no template lib, no
// shared-package import found in it, or no app with a `lib/`. A guard that finds
// nothing must say so rather than print ok over an empty question.
//
// Usage:  node tooling/ci/assert-chassis-parity.mjs [repoRoot]
// Exit 0 = every app imports every shared package the template does, or a row
//          declares why not. 1 = a finding. 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 🔴 THE LISTING GOES THROUGH THE SHARED WALKER, AND assert-walks-bounded.mjs IS
// WHY. A bare `readdirSync` descends into a nested checkout — this repository grows
// git worktrees under its own root — and would read another tree's files as this
// one's: green in CI, which creates no worktrees, and red only on the machine of
// the person actually looking. `listDir` refuses that descent.
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const abs = (...p) => join(ROOT, ...p);

const TEMPLATE_LIB = join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib');
const MANIFEST_REL = 'tooling/chassis-parity.json';

/** `import 'package:nikatru_x/…'` — the only shape this repository uses, and the
 *  one `dart format` keeps. A deferred or aliased import still starts this way. */
const SHARED_IMPORT = /import\s+'package:(nikatru_[a-z0-9_]+)\//g;

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('assert-chassis-parity: COVERAGE LOST');
  for (const l of lines) console.error(`    ${l}`);
  console.error('    Exit 2 = could not look. A scan that finds no subject must not print ok.');
  process.exit(2);
}

/** Every .dart file under a directory, relative to it, with forward slashes. */
function dartFiles(dirAbs) {
  if (!existsSync(dirAbs)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of listDir(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.dart')) out.push(relative(dirAbs, p).split(sep).join('/'));
    }
  };
  walk(dirAbs);
  return out.sort();
}

/** The shared packages a file imports. */
const importsIn = (text) => new Set([...String(text).matchAll(SHARED_IMPORT)].map((m) => m[1]));

// ── 1 · what the TEMPLATE delegates ──────────────────────────────────────────
const templateAbs = abs(TEMPLATE_LIB);
if (!existsSync(templateAbs)) {
  coverageLost([`${TEMPLATE_LIB.split(sep).join('/')} does not exist, so nothing establishes what the factory delegates.`]);
}
const templateFiles = dartFiles(templateAbs);
if (templateFiles.length === 0) {
  coverageLost([`${TEMPLATE_LIB.split(sep).join('/')} holds no .dart file, so no delegation could be read.`]);
}
/** package → the template files that import it. */
const delegated = new Map();
for (const rel of templateFiles) {
  for (const pkg of importsIn(readFileSync(join(templateAbs, ...rel.split('/')), 'utf8'))) {
    if (!delegated.has(pkg)) delegated.set(pkg, []);
    delegated.get(pkg).push(rel);
  }
}
if (delegated.size === 0) {
  coverageLost([
    `no file under ${TEMPLATE_LIB.split(sep).join('/')} imports a \`package:nikatru_*\`.`,
    'Either the template stopped delegating (a finding somebody must look at) or this matcher stopped matching.',
  ]);
}

// ── 2 · what each APP imports ────────────────────────────────────────────────
const appsDir = abs('apps');
const apps = existsSync(appsDir)
  ? listDir(appsDir).filter((a) => !a.startsWith('.') && existsSync(join(appsDir, a, 'lib')))
  : [];
if (apps.length === 0) {
  coverageLost(['no apps/<id>/lib directory exists, so no app could be graded against the template.']);
}
/** app → package → how many of its files import it. */
const appImports = new Map();
/** app → package → WHICH of its files import it ([ADR 086] partial adoption). */
const appImportFiles = new Map();
for (const app of apps) {
  const libAbs = join(appsDir, app, 'lib');
  const counts = new Map();
  const byPkg = new Map();
  for (const rel of dartFiles(libAbs)) {
    for (const pkg of importsIn(readFileSync(join(libAbs, ...rel.split('/')), 'utf8'))) {
      counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
      if (!byPkg.has(pkg)) byPkg.set(pkg, new Set());
      byPkg.get(pkg).add(rel);
    }
  }
  appImports.set(app, counts);
  appImportFiles.set(app, byPkg);
}

// ── 3 · the manifest ─────────────────────────────────────────────────────────
if (!existsSync(abs(MANIFEST_REL))) {
  coverageLost([
    `${MANIFEST_REL} does not exist. Without it every unadopted package reads as new drift and this guard`,
    'cannot tell a declared debt from one nobody has seen — so it refuses to grade rather than guess.',
  ]);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(abs(MANIFEST_REL), 'utf8'));
} catch (err) {
  coverageLost([`${MANIFEST_REL} did not parse (${err.message}), so no declaration could be read.`]);
}
const rows = Array.isArray(manifest?.notAdopted) ? manifest.notAdopted : null;
if (rows === null) {
  coverageLost([`${MANIFEST_REL} has no \`notAdopted\` array. An empty ratchet is \`"notAdopted": []\`, not an absent key.`]);
}
const declared = new Map();
for (const [i, r] of rows.entries()) {
  const where = `${MANIFEST_REL} notAdopted[${i}]`;
  for (const field of ['app', 'package', 'why', 'since', 'plan']) {
    if (typeof r?.[field] !== 'string' || r[field].trim() === '') {
      problems.push(`${where} has no \`${field}\`. A debt with no ${field} is a permission slip, which is what this file is not.`);
    }
  }
  if (!Array.isArray(r?.files)) {
    problems.push(`${where} has no \`files\` array, so nothing pins WHICH delegations the row covers — and the template could grow one silently.`);
  }
  if (typeof r?.app === 'string' && typeof r?.package === 'string') declared.set(`${r.app}|${r.package}`, r);
}

// ── 4 · grade ────────────────────────────────────────────────────────────────
let graded = 0;
for (const app of apps) {
  const counts = appImports.get(app);
  for (const [pkg, files] of [...delegated.entries()].sort()) {
    graded++;
    const key = `${app}|${pkg}`;
    const row = declared.get(key);
    const used = counts.get(pkg) ?? 0;

    if (used > 0 && row && Array.isArray(row.adopted) && row.adopted.length > 0) {
      // [ADR 086] partial adoption: the record must match the imports, both ways.
      const importing = [...(appImportFiles.get(app)?.get(pkg) ?? [])].sort();
      const recorded = row.adopted.map((a) => a?.file).filter((f) => typeof f === 'string').sort();
      const unrecorded = importing.filter((f) => !recorded.includes(f));
      const stale = recorded.filter((f) => !importing.includes(f));
      if (unrecorded.length > 0 || stale.length > 0) {
        problems.push(
          `${MANIFEST_REL} row for \`${app}\`/\`${pkg}\` records \`adopted\` in [${recorded.join(', ')}], and apps/${app} imports ` +
            `the package in [${importing.join(', ')}].` +
            (unrecorded.length > 0 ? ` UNRECORDED: ${unrecorded.join(', ')}.` : '') +
            (stale.length > 0 ? ` NO LONGER IMPORTS: ${stale.join(', ')}.` : '') +
            ' [ADR 086]: each adopted piece is written down with its measured callSiteDelta, in the same commit as the import.',
        );
      }
      for (const [i, a] of row.adopted.entries()) {
        for (const field of ['file', 'piece', 'on']) {
          if (typeof a?.[field] !== 'string' || a[field].trim() === '') {
            problems.push(`${MANIFEST_REL} row for \`${app}\`/\`${pkg}\` adopted[${i}] has no \`${field}\`.`);
          }
        }
        if (typeof a?.callSiteDelta !== 'number' || !(a.callSiteDelta < 0)) {
          problems.push(
            `${MANIFEST_REL} row for \`${app}\`/\`${pkg}\` adopted[${i}] (${a?.file}) records callSiteDelta ${JSON.stringify(a?.callSiteDelta)}. ` +
              "[ADR 066]: a piece moves only where the calling code measurably SHRINKS after dart format — a delta that is not negative is a revert, recorded as STAYS.",
          );
        }
      }
      prints.push(
        `⬜ declared debt, partly paid — apps/${app} adopts \`${pkg}\` in ${importing.length} file(s) (` +
          `${row.adopted.map((a) => `${a.piece} ${a.callSiteDelta}`).join(', ')}); the rest stays owed (${(row.files ?? []).length} template file(s), since ${row.since}).`,
      );
      // The row still pins WHICH template delegations it covers — rule 2 applies to a
      // partly paid debt exactly as to an unpaid one.
      const wantP = [...files].sort();
      const haveP = [...(row.files ?? [])].sort();
      const addedP = wantP.filter((f) => !haveP.includes(f));
      const goneP = haveP.filter((f) => !wantP.includes(f));
      if (addedP.length > 0 || goneP.length > 0) {
        problems.push(
          `${MANIFEST_REL} row for \`${app}\`/\`${pkg}\` lists ${haveP.length} template file(s); the template now ` +
            `delegates ${wantP.length}.` +
            (addedP.length > 0 ? ` ADDED: ${addedP.join(', ')}.` : '') +
            (goneP.length > 0 ? ` GONE: ${goneP.join(', ')}.` : '') +
            ' Re-measure the row in the same commit as the change.',
        );
      }
      continue;
    } else if (used > 0) {
      if (row) {
        problems.push(
          `${MANIFEST_REL} still declares \`${pkg}\` as not adopted by \`${app}\`, but ${app} now imports it in ` +
            `${used} file(s). THE DEBT IS PAID — delete the row. A ratchet that keeps satisfied rows becomes a list ` +
            `of things that used to be true, and the next reader cannot tell which half is current.`,
        );
      }
      continue;
    }

    if (!row) {
      problems.push(
        `apps/${app} imports \`${pkg}\` in NO file, while the app template delegates ${files.length} file(s) to it ` +
          `(${files.slice(0, 4).join(', ')}${files.length > 4 ? `, +${files.length - 4} more` : ''}). The factory is the ` +
          `base: a capability the template takes from a shared package must not be a private copy in an app, or every ` +
          `fix to that package reaches the next app and never this one. Adopt it, or declare the debt in ` +
          `${MANIFEST_REL} with a why, a cost and a plan.`,
      );
      continue;
    }

    const want = [...files].sort();
    const have = [...(row.files ?? [])].sort();
    const added = want.filter((f) => !have.includes(f));
    const gone = have.filter((f) => !want.includes(f));
    if (added.length > 0 || gone.length > 0) {
      problems.push(
        `${MANIFEST_REL} row for \`${app}\`/\`${pkg}\` lists ${have.length} template file(s); the template now ` +
          `delegates ${want.length}.` +
          (added.length > 0 ? ` ADDED: ${added.join(', ')}.` : '') +
          (gone.length > 0 ? ` GONE: ${gone.join(', ')}.` : '') +
          ` The template's delegation changed and nobody decided what the unmigrated app should do about it. ` +
          `Re-measure the row in the same commit as the change.`,
      );
    } else {
      prints.push(
        `⬜ declared debt — apps/${app} does not adopt \`${pkg}\` (${have.length} template file(s), since ${row.since}). ` +
          `Plan: ${String(row.plan).slice(0, 120)}${String(row.plan).length > 120 ? '…' : ''}`,
      );
    }
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
for (const p of prints) console.log(`  ${p}`);
if (problems.length > 0) {
  console.error(`✗ chassis parity — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(`  graded ${graded} app x package pair(s) over ${apps.length} app(s) and ${delegated.size} delegated package(s).`);
  process.exit(1);
}
console.log(
  `✓ chassis parity — every shared package the template delegates to is imported by every app, or its absence is ` +
    `declared: ${graded} app x package pair(s), ${apps.length} app(s) [${apps.join(', ')}], ${delegated.size} package(s) ` +
    `[${[...delegated.keys()].sort().join(', ')}], ${rows.length} declared debt(s).`,
);
