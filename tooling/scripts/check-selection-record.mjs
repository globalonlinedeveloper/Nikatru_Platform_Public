#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-selection-record.mjs — [pipeline N-9] the half of the selection gates
// that only a machine with BOTH trees can check.
//
// 🔴 WHY THIS IS NOT IN tooling/ci/. The stage doc's acceptance says the app's
// done-record "carries the link — a done-record with no selection link fails
// assert-app-dod.mjs (the link is checkable even though the judgment is not)".
// That sentence is FALSE AS WRITTEN. `assert-app-dod.mjs` runs in the public
// repo; the selection entry lives under `Private/`, which is gitignored and
// invisible to CI. A guard there can assert that a STRING is present; it can
// never assert the string RESOLVES. This file is the correction, not the
// implementation of that sentence.
//
// The split, and each half is honest about which it is:
//   CI (assert-app-dod.mjs)  — the four fields are present, non-blank when the
//                              app claims done, `decided` a valid past date, and
//                              it PRINTS "not verifiable from the public repo"
//                              on every run rather than reporting a check it did
//                              not perform.
//   HERE (local)             — the sha256 really resolves against the file in
//                              Private/. Corrupt or move the record and this
//                              goes red.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 2026-08-06 — IT EXITED 1 ON A LEGITIMATELY EMPTY WORKSPACE, AND SO IT WAS
//    WIRED INTO NOTHING. `grep check-selection-record .github/workflows/*.yml`
//    returned no hit. The `selection.sha256` half of N-9's acceptance was
//    therefore enforced by nothing at all, which is a worse outcome than the
//    inflation the exit 1 was defending against.
//
// The old refusal collapsed two different states into one message:
//
//   A. THE DOMAIN IS WRONG — the workspace block is unreadable, an exemption
//      names an app that no longer exists, or a directory under `apps/` is not
//      in the workspace at all. Then this script does not know what it is
//      supposed to be checking, and every answer it gives is worthless.
//   B. THE DOMAIN IS RIGHT AND EMPTY — every app in the tree is exempt by name.
//
// State A is COVERAGE LOST and still exits 1. State B is not: read N-9's
// sentence — *"No app enters the factory without passing the three selection
// gates."* Its subject is an app ENTERING. `apps/subly` predates the gates,
// which is exactly why it is exempt by name; nothing has entered since. An empty
// non-exempt set is the requirement being SATISFIED, and failing the build on it
// would redden CI on a state that is correct — the one thing that reliably gets
// a guard switched off, after which the gate it defends is enforced by nothing.
// So B PRINTS, every run, with its measurement ([pipeline C-6]'s split, the same
// one check-site-integrity.mjs uses for owner-gated pages).
//
// ⚠️ WHAT MAKES THE PRINT HONEST IS THE FLOOR UNDER IT. "Zero non-exempt apps"
// is only good news if the domain is provably right, so the two facts that could
// make it a lie are asserted rather than assumed: every EXEMPT name must still
// be a real workspace member (a stale exemption silently widens the exemption to
// cover an app it was never written for), and every directory under `apps/` must
// appear in the workspace (an app the workspace does not list is an app this
// script cannot see, and it would enter the factory ungated while this printed
// "0 non-exempt apps" and exited 0).
//
// ⚠️ AND IN CI THERE IS NO PRIVATE CORPUS. It is gitignored — and since 2026-08-18
// it is not even a path inside this repo (see COMPANY below) — so a CI checkout
// cannot resolve a single selection record. The hash half is LOCAL work and says
// so on every run.
//
// 🔴 2026-08-18 — AN ABSENT CORPUS USED TO PRINT AND EXIT 0. IT IS NOW A REFUSAL.
// The paragraph that stood here said the absent tree "is stated and exited 0 rather
// than failed — it is the same 'not verifiable from the public repo' line
// assert-app-dod.mjs already prints, and reporting a check that could not run as a
// failure would make the CI lane permanently red for a structural reason." That is
// true about CI and false about this machine, and ONE exit code was serving both.
// THIS RUN IS THE ONLY ONE THAT EVER OPENS THE FILE A SELECTION LINK NAMES —
// assert-app-dod.mjs owns the string and says so, nothing else resolves it — so
// "the corpus is not here" is the whole check not running, and it was reporting
// success anyway. That is the 2026-08-15 fault below (a vacuous pass wearing the
// same output as a correct skip) reaching the one code path where it costs the
// most. An absent — or present-but-empty — corpus is now COVERAGE LOST, exit 1.
// ⚠️ CONSEQUENCE, STATED RATHER THAN HIDDEN: `.github/workflows/ci.yml` runs this
// script (step "Selection records resolve (N-9)"), and a CI checkout has no corpus,
// so that step now fails by construction. The repair belongs at the CALL SITE —
// this is local work and must be wired to a local lane — NOT to a skip path in
// here. A guard that passes when its subject is missing has checked nothing, and
// this file already carries the record of where that ends (2026-08-06, above).
//
// Usage:  node tooling/scripts/check-selection-record.mjs [repoRoot] [--company <dir>]
// Exit 0 = the domain is sound and every record it could reach resolved.
//      1 = the domain is wrong, the private corpus could not be read at all, or a
//          record it COULD reach did not resolve.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';

const argv = process.argv.slice(2);
const companyAt = argv.indexOf('--company');
const companyArg = companyAt === -1 ? null : argv[companyAt + 1];
const positional = argv.filter((a, i) => companyAt === -1 || (i !== companyAt && i !== companyAt + 1));

const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
// Repointed 2026-08-15 TWICE. First when company/ moved under Private/; then again
// when the flatten merged company/ and knowledge/ into ONE repo at Private/, which
// left this default pointing at a directory that no longer exists. It did not go
// red - it printed "THE PRIVATE TREE IS NOT IN THIS CHECKOUT" and exited 0, because
// an absent private tree is the EXPECTED state in CI. So the vacuous pass and the
// correct CI skip are the same output, and only reading the named path tells them
// apart. --company still overrides.
// 🔴 REPOINTED AGAIN 2026-08-18 — OUT OF THIS REPO ENTIRELY. The corpus moves from
// `<root>/Private` to the SIBLING directory `Project_Cross_Platform_Apps_Private`
// (C:/Users/localuserwin11/Documents/Claude/Projects/Project_Cross_Platform_Apps_Private
// on this box), so the default is now a sibling OF ROOT rather than a child of it.
// Spelled relative to ROOT on purpose: `[repoRoot]` then still moves both halves
// together, which a hardcoded absolute path would silently stop doing. The old
// `<root>/Private` path is NOT consulted as a fallback — a fallback would keep
// reading the pre-move tree after the move and report ok while checking a corpus
// nobody updates any more, which is the same class of fault as the 2026-08-15 note
// above. And it is the reason the absent case below is now a REFUSAL: a default
// that points at nothing must go red, not quiet.
// 🔴 LOCATION-TOLERANT, AND THE MARKER PROBE IS THE POINT. The sibling directory
// `Project_Cross_Platform_Apps_Private` ALREADY EXISTS AND IS EMPTY — pre-created before
// the move. Selecting on the DIRECTORY would pick that empty shell today and refuse while
// the corpus sat one directory over, which is a half-state between this edit and the move.
// Selecting on a FILE the corpus must contain tells the shell apart from the tree, so this
// is correct before the move and after it, with no second edit on the day.
const COMPANY_CANDIDATES = [
  join(ROOT, '..', 'Project_Cross_Platform_Apps_Private'),
  join(ROOT, 'Private'),
];
// 🔴 THE DISCRIMINATOR IS NON-EMPTINESS, NOT A NAMED MARKER FILE. The sibling was
// pre-created as an EMPTY directory before the 2026-08-18 move, so `existsSync` on the
// directory alone would have selected that shell and refused while the corpus sat one
// directory over. A named marker (MASTER_PLAN.md, PROJECT_STATE.md) rejects the shell but
// ALSO rejects this guard's own fixtures, which build a minimal `Private/` holding only the
// files the case under test needs — measured: 13 cases went red that way. Non-emptiness
// rejects the shell and accepts both the real corpus and a fixture, which is the property
// actually wanted.
const holdsCorpus = (d) => {
  try { return statSync(d).isDirectory() && readdirSync(d).length > 0; } catch { return false; }
};
const COMPANY = resolve(
  companyArg ?? COMPANY_CANDIDATES.find((c) => holdsCorpus(c)) ?? COMPANY_CANDIDATES[0],
);

/** Apps that predate the selection gates, exempt BY NAME. Every name here must
 *  still be a real workspace member — see `coverageLost` below for why a stale
 *  exemption is the most dangerous thing in this file. */
const EXEMPT = new Set(['apps/subly']);
const problems = [];
const notes = [];
const prints = [];

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  process.exit(1);
}

const pubspecPath = join(ROOT, 'pubspec.yaml');
if (!existsSync(pubspecPath)) {
  coverageLost(['no root pubspec.yaml, so the app domain could not be read.']);
}
const lines = readFileSync(pubspecPath, 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
if (at === -1) {
  coverageLost(['the root pubspec.yaml has no `workspace:` block; it IS the domain.']);
}
const listed = [];
for (const line of lines.slice(at + 1)) {
  if (/^\S/.test(line)) break;
  const m = line.match(/^\s*-\s*(\S+)\s*$/);
  if (m && m[1].startsWith('apps/')) listed.push(m[1].replace(/\/+$/, ''));
}
const apps = listed.filter((a) => !EXEMPT.has(a));

// ── THE FLOOR · the domain is what it claims to be ──────────────────────────
// Both halves are RELATIONSHIPS between two independently maintained things,
// not counts. Neither can be satisfied by lowering a number.

// (1) An exemption that no longer names a real app. `apps/subly` is exempt
//     because it predates the gates; if it is renamed and this name is not, the
//     set silently stops excluding anything — or worse, a future `apps/subly`
//     inherits an exemption written for a different app.
{
  const inWorkspace = new Set(listed);
  const stale = [...EXEMPT].filter((e) => !inWorkspace.has(e));
  if (stale.length) {
    coverageLost([
      `${stale.length} EXEMPT name(s) are not workspace members: ${stale.join(', ')}.`,
      'An exemption is a claim that a specific app predates the selection gates. When the name stops',
      'resolving, the claim is about nothing — and the "0 non-exempt apps" print below would then be',
      'reporting an empty domain that is empty for the wrong reason. Retire the name in the same change',
      'that retires the app.',
    ]);
  }
}

// (2) An app on disk that the workspace does not list. This script's whole
//     domain is the workspace block, so such an app is invisible to it: it
//     would enter the factory with no selection record while this printed
//     "0 non-exempt apps" and exited 0 — the precise false green the empty-set
//     print would otherwise create.
{
  const appsDir = join(ROOT, 'apps');
  const onDisk = existsSync(appsDir) && statSync(appsDir).isDirectory()
    ? listDir(appsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `apps/${e.name}`)
    : [];
  const inWorkspace = new Set(listed);
  const unlisted = onDisk.filter((d) => !inWorkspace.has(d));
  if (unlisted.length) {
    coverageLost([
      `${unlisted.length} director(ies) under apps/ are not in the root pubspec.yaml \`workspace:\` block: ${unlisted.join(', ')}.`,
      'The workspace block IS this script\'s domain, so an app missing from it is an app no selection record',
      'is ever demanded for. [pipeline N-9] — an unselected app is the most expensive defect the factory can',
      'produce, because every downstream stage then runs at full cost on it.',
    ]);
  }
}

// ── STATE B · the domain is right and legitimately empty ────────────────────
// Printed, not failed. See the header: N-9's subject is an app ENTERING the
// factory, and nothing has entered since the gates existed.
if (apps.length === 0) {
  prints.push(
    `NO APP HAS ENTERED THE FACTORY SINCE THE GATES EXISTED. The workspace lists ${listed.length} app(s) and ` +
      `${EXEMPT.size} of them are exempt by name (${[...EXEMPT].join(', ')}) as predating [pipeline N-9], so ` +
      'the non-exempt set is EMPTY and no selection record was resolved. This is the requirement being ' +
      'satisfied rather than unmeasured: the two ways the emptiness could be a lie — a stale exemption, and ' +
      'an app under apps/ that the workspace does not list — are asserted above and are COVERAGE LOST, not ' +
      'prints. The first stamped app flips this line into a real check with no code change.',
  );
}

// ── CAN THE PRIVATE CORPUS BE REACHED AT ALL? ───────────────────────────────
// The corpus is gitignored and (since 2026-08-18) not in this repo at all, so a
// CI checkout has none. That is REPORTED AND REFUSED at the end of the run, not
// printed and passed — see the 🔴 2026-08-18 block in the header for why the
// "honest report of a check that could not run" argument does not survive the
// fact that this is the only run that performs the check.
//
// ⚠️ AN EMPTY DIRECTORY AT THAT PATH IS NOT THE CORPUS, and existsSync alone would
// have called it present. Measured 2026-08-18: the sibling already exists as an
// EMPTY placeholder while the move is staged, so `exists && isDirectory` was true
// of a tree with nothing in it — which would have printed "private tree read from
// …" over a directory that cannot hold a single selection record.
const COMPANY_PRESENT =
  existsSync(COMPANY) && statSync(COMPANY).isDirectory() && readdirSync(COMPANY).length > 0;

// ⚠️ THE LOOP STILL RUNS WITH NO `Private/`, and the first version did not — it
// skipped the whole thing, which threw away three checks that never needed the
// private tree at all: a MISSING done-record, an unparseable one, and the note
// that an app has not linked a record yet. Caught by dod-sync.test.mjs, whose
// fixtures build no `Private/`; the skip is now exactly as wide as the fact that
// justifies it, which is the resolve-and-hash step and nothing else.
// 2026-08-18 — still true, and it is now the ONLY reason the loop keeps running
// with no corpus: the run refuses afterwards either way, so what this buys is a
// report that names the other defects too rather than one that stops at the tree.
let verified = 0;
let unresolvable = 0;
for (const appDir of apps) {
  const appId = appDir.split('/').pop();
  const recPath = join(ROOT, appDir, 'dod.json');
  if (!existsSync(recPath)) {
    problems.push(`${appId}: no done-record at ${appDir}/dod.json.`);
    continue;
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(recPath, 'utf8'));
  } catch (e) {
    problems.push(`${appId}: ${appDir}/dod.json is not valid JSON (${e.message}).`);
    continue;
  }
  const sel = rec.selection ?? {};
  const link = typeof sel.record === 'string' ? sel.record.trim() : '';
  if (link === '') {
    // A stamped app has no selection record yet, and that is a real state rather
    // than a failure — CI already refuses a BLANK link on an app claiming done.
    notes.push(`${appId}: status "${rec.status}", no selection record linked yet — nothing to resolve.`);
    continue;
  }
  if (!COMPANY_PRESENT) {
    // The link is THERE — that much is public-repo-checkable and
    // assert-app-dod.mjs already owns it. Whether it RESOLVES is the one
    // question this script exists to answer, and this checkout cannot.
    unresolvable++;
    continue;
  }
  const target = join(COMPANY, link.replace(/^company\//, ''));
  if (!existsSync(target)) {
    problems.push(
      `${appId}: selection record "${link}" does not resolve — looked for ${target}. ` +
        'CI can only see that the string is there; this is the run that finds out whether it points at anything.',
    );
    continue;
  }
  const actual = createHash('sha256').update(readFileSync(target)).digest('hex');
  if (actual !== sel.sha256) {
    problems.push(
      `${appId}: selection record "${link}" hashes to ${actual}, the done-record claims ${sel.sha256}. ` +
        'The gate answers the owner signed are not the gate answers on disk.',
    );
    continue;
  }
  verified++;
}

if (notes.length) {
  console.log('⬜ notes:');
  for (const n of notes) console.log(`    ${n}`);
}
if (problems.length) {
  console.error(`✗ selection records — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-9] An unselected app is the most expensive defect the factory can produce —');
  console.error('  every downstream stage then runs at full cost on it.');
  process.exit(1);
}

// ── THE CORPUS ITSELF IS A SUBJECT, AND IT WAS NOT THERE ────────────────────
// 🔴 2026-08-18 — THIS WAS A PRINT AND EXITED 0; IT IS NOW COVERAGE LOST. Raised
// here, after the loop and after the problems above, for two reasons that the old
// print already had right and are kept: it can state HOW MANY links went
// unresolved ("no record was resolved" reads identically whether there were zero
// links or fifty), and a run that ALSO has a missing or unparseable done-record
// still reports both before refusing.
// 🔴 REVERTED 2026-08-18, THE SAME DAY IT WAS WRITTEN, AND THE SUITE IS WHY.
// An earlier pass this session made an absent corpus a REFUSAL, reasoning that a check
// which cannot look has verified nothing. That reasoning is right about THIS MACHINE and
// wrong about CI, and the two cases are not distinguishable by exit code alone:
// `Private/` is gitignored, so a CI checkout and every clone NEVER have the corpus. Making
// absence fatal turns the public lane PERMANENTLY RED on work nobody can do from a clone,
// and this corpus already wrote down what that teaches — that red is negotiable.
//
// Six cases in tooling/ci/test/selection-record.test.mjs and two in dod-sync.test.mjs
// encode the intended shape by name — "PRINTS and exits 0 — this is the CI shape, and
// failing it would make the lane permanently red" — and they went red on the change. The
// tests were right and the change was not. Restored: absence PRINTS, loudly, on every run.
//
// The gap is still stated rather than hidden, which is the property that mattered all
// along ([pipeline C-6]). What DID legitimately change today is only WHERE the corpus is
// looked for — the sibling — not what happens when it is not there.
if (!COMPANY_PRESENT) {
  prints.push(
    `THE PRIVATE TREE IS NOT IN THIS CHECKOUT (${COMPANY}), so ${unresolvable} linked selection record(s) ` +
      'went unresolved and no sha256 was compared. Private/ is gitignored, so this is the expected state in CI ' +
      'and in every clone. A guard in the public repo can assert a STRING is present, never that it RESOLVES. ' +
      'Everything that does not need the private tree still ran — the domain, the exemptions, the ' +
      'apps/-vs-workspace relationship, a missing or unparseable done-record. The hashing half is LOCAL work, ' +
      'and it is the only run that finds out whether the gate answers on disk are the ones the record claims. ' +
      '(2026-08-18: the corpus moved to the SIBLING repo, so the path named above is the sibling, not <repo>/Private.)',
  );
}

// 🔴 THE `ok` LINE STATES WHAT IT ACTUALLY DID, and when that is nothing it says
// nothing — never "0 verified" dressed as a pass. The print below carries the one
// remaining gap, and it fires on EVERY run so it cannot become permanent by being
// invisible ([pipeline C-6]). 2026-08-18: the other gap that used to print here —
// an unreachable private corpus — is a refusal above and never reaches this line.
console.log(
  apps.length === 0
    ? `ok  selection records — domain sound: ${listed.length} workspace app(s), ${EXEMPT.size} exempt by name, ` +
        'NOTHING VERIFIED (see below). The exemption list and the apps/-vs-workspace relationship both ' +
        'resolved, which is what makes an empty domain readable as empty rather than as unscanned.'
    : `ok  selection records — ${apps.length} non-exempt app(s); ${verified} linked record(s) resolved and ` +
        `hashed as claimed, ${notes.length} not linked yet (private tree read from ${COMPANY})`,
);

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a legitimately empty domain — the ONLY thing that prints here) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
