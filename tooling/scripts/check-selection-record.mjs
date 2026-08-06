#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-selection-record.mjs — [pipeline N-9] the half of the selection gates
// that only a machine with BOTH trees can check.
//
// 🔴 WHY THIS IS NOT IN tooling/ci/. The stage doc's acceptance says the app's
// done-record "carries the link — a done-record with no selection link fails
// assert-app-dod.mjs (the link is checkable even though the judgment is not)".
// That sentence is FALSE AS WRITTEN. `assert-app-dod.mjs` runs in the public
// repo; the selection entry lives under `company/`, which is gitignored and
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
//                              company/. Corrupt or move the record and this
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
// ⚠️ AND IN CI THERE IS NO `company/`. It is gitignored, so a CI checkout cannot
// resolve a single selection record. That is stated and exited 0 rather than
// failed — it is the same "not verifiable from the public repo" line
// assert-app-dod.mjs already prints, and reporting a check that could not run as
// a failure would make the CI lane permanently red for a structural reason.
// The hash half is LOCAL work and says so on every run.
//
// Usage:  node tooling/scripts/check-selection-record.mjs [repoRoot] [--company <dir>]
// Exit 0 = the domain is sound and every record it could reach resolved.
//      1 = the domain is wrong, or a record it COULD reach did not resolve.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';

const argv = process.argv.slice(2);
const companyAt = argv.indexOf('--company');
const companyArg = companyAt === -1 ? null : argv[companyAt + 1];
const positional = argv.filter((a, i) => companyAt === -1 || (i !== companyAt && i !== companyAt + 1));

const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const COMPANY = resolve(companyArg ?? join(ROOT, 'company'));

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

// ── CAN THE PRIVATE TREE BE REACHED AT ALL? ─────────────────────────────────
// `company/` is gitignored, so a CI checkout has none. Saying so and exiting 0
// is the honest report of a check that could not run — the same line
// assert-app-dod.mjs prints for the same reason. Failing instead would make any
// lane that wires this permanently red for a structural reason, which is how a
// guard gets removed rather than fixed.
const COMPANY_PRESENT = existsSync(COMPANY) && statSync(COMPANY).isDirectory();

// ⚠️ THE LOOP STILL RUNS WITH NO `company/`, and the first version did not — it
// skipped the whole thing, which threw away three checks that never needed the
// private tree at all: a MISSING done-record, an unparseable one, and the note
// that an app has not linked a record yet. Caught by dod-sync.test.mjs, whose
// fixtures build no `company/`; the skip is now exactly as wide as the fact that
// justifies it, which is the resolve-and-hash step and nothing else.
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

// Pushed AFTER the loop so it can state HOW MANY links went unresolved. A print
// that says "no record was resolved" reads identically whether there were zero
// links or fifty, and those are very different situations.
if (!COMPANY_PRESENT) {
  prints.push(
    `THE PRIVATE TREE IS NOT IN THIS CHECKOUT (${COMPANY}), so ${unresolvable} linked selection record(s) ` +
      "went unresolved and no sha256 was compared. company/ is gitignored — this is the expected state in CI, " +
      "and it is the reason [pipeline N-9]'s stage doc is WRONG where it says a done-record with no selection " +
      'link "fails assert-app-dod.mjs": a guard in the public repo can assert a STRING is present, never that ' +
      'it RESOLVES. Everything that does not need the private tree still ran — the domain, the exemptions, the ' +
      'apps/-vs-workspace relationship, a missing or unparseable done-record. The hashing half is LOCAL work, ' +
      'and it is the only run that finds out whether the gate answers on disk are the ones the record claims.',
  );
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
// 🔴 THE `ok` LINE STATES WHAT IT ACTUALLY DID, and when that is nothing it says
// nothing — never "0 verified" dressed as a pass. The prints below carry the
// gaps, and they fire on EVERY run so neither can become permanent by being
// invisible ([pipeline C-6]).
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
  console.log('   ── printed, not failed (a legitimately empty domain, or a tree this checkout cannot see) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
