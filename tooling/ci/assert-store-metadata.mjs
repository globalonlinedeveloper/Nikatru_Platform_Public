#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-metadata.mjs — the store listing lives in the repo, is generated
// from the spec, and cannot rot without failing a build.
//
// [pipeline D-5] "Store listing metadata is generated from the spec and lives in
//                 the repo … so a listing can be regenerated, audited, localized
//                 and diffed, and is never hand-typed into a store console as
//                 the only copy."
//
// ── THE CRITERION D-5 SHIPPED WITH COULD NOT FIRE ────────────────────────────
// "A guard fails any app whose apps.json entry CLAIMS A STORE CHANNEL but has no
// metadata tree." No app can ever claim one: post_gen.dart writes
// `'platforms': <String>['web']` as a literal constant and the brick has no
// `platforms` var, so the only value the factory can produce is ["web"], and web
// is not a store channel. Empty antecedent ⇒ vacuously true forever.
//
// ── REQUIRED_COVERAGE IS A RELATIONSHIP, NOT A NUMBER ────────────────────────
// D-5's replacement acceptance: "every app carries apps/<id>/store/<channel>/
// for every channel it declares in [9]R-5's register — one directory per
// declared channel". So the expected set is computed as
//
//     { kind: "store" rows in the register } × { apps in apps.json }
//
// and it GROWS with the register. Add a store channel tomorrow and the coverage
// requirement grows with it; there is no constant anybody can lower. The list of
// files each tree must carry is the register's `storeMetadataContract`, read
// from there rather than declared here — same reasoning that moved `keyKinds`
// out of assert-channel-register.mjs ([pipeline F-2]): a private copy would be
// the second declaration and the first to drift. tooling/release/
// submit-windows-store.mjs reads the same block.
//
// ── MODE-AWARE, BECAUSE THE ACCOUNTS ARE OWNER-GATED ─────────────────────────
// Four of the five store channels have no publisher account and no tree, and
// creating those accounts is OWNER_QUEUE work an agent must never do. Per the
// standing rule (assert-seams-wired.mjs, [pipeline C-6]) a MISSING tree on a
// DEFERRED row PRINTS on every run — a known gap nobody sees becomes permanent.
//
//   tree missing, row served      -> FAIL  (a live store listing nobody can diff)
//   tree missing, row deferred, DATED deferral not yet expired -> PRINT
//   tree missing, row deferred, no dated deferral / expired    -> FAIL
//   tree PRESENT but incomplete   -> FAIL  (this is the case that matters)
//   tree present, field emptied   -> FAIL
//   tree present, field forked from its spec source -> FAIL
//   a tree with no register row   -> FAIL  (a channel renamed out from under it)
//   EVERY expected tree gone      -> COVERAGE LOST
//
// 🔴 THE `tree PRESENT but incomplete` LINE IS THE POINT — named, not numbered,
// because two lines were inserted above it in 2026-09-20 and a "third line"
// citation would now be pointing at a different rule entirely.
// A guard that only printed would let anyone
// delete apps/subscriptiontracker/store/windows-store/title.txt and stay green — "PRINT
// everything" is how an owner-gated exemption eats the check it was meant to
// scope. What is owner-gated is CREATING a tree, not KEEPING one.
//
// ── ⏳ AND THE SECOND LINE USED TO BE UNCONDITIONAL, WHICH IS HOW A CHANNEL ON
// ──    A CLOCK STAYED GREEN WITH NO LISTING AT ALL ──────────────────────────
// MEASURED 2026-09-20: apps/subscriptiontracker/store/apps-gov-in/ DID NOT
// EXIST. The brick has carried an `apps-gov-in` template the whole time, so a
// stamped app got the slot and the one real app — which predates the brick —
// did not. This guard exited 0 printing `NO TREE (deferred)` on every run,
// because the row is `served: false`. Meanwhile that channel's publisher
// account is VERIFIED and EXPIRES: an individual developer profile is suspended
// if no app is uploaded within two months of approval (approved 2026-08-31 →
// about 2026-10-31, `accountStatus.note`). A print that repeats an expected line
// is wallpaper — the android-play row's own `accountStatus._why` records the
// same defect from the other side, where a gap-printer correctly printed a gap
// that had already closed, for two days, in a public repo.
//
// 🔴 "DEFERRED" IS NOT A STATE, IT IS A PROMISE WITH A DATE, AND A PROMISE WITH
// NO DATE IS A PERMANENT EXEMPTION WEARING A TEMPORARY WORD. So the deferred
// branch now costs the register something it must keep current:
//
//   deferral.treeDeferredUntil — `YYYY-MM-DD`, a REAL calendar date, in the future
//   deferral.treeDeferredWhy   — why THIS TREE cannot exist yet, in prose
//
// Both, or the missing tree FAILS. And they are deliberately NOT `deferral
// .reason`, which every row already carries: those reasons are about the
// PUBLISH — "the first publish is manual and owner-gated", "native Linux is
// deferred until there is revenue" — and not one of them is a reason a LISTING
// TREE cannot exist in a repository. Reusing that field would have let the
// publish deferral discharge the tree duty, which is the exact confusion that
// produced the hole: creating a PUBLISHER ACCOUNT is owner work, writing eight
// text files is not, and the old print conflated them by quoting `ownerQueue`
// as if it explained the absent directory.
//
// ⚠️ Neither quoted reason is cited by its ADR id on purpose: an `ADR NNN`
// token in this header is scraped into tooling/enforcement-index.json as a
// CLAIM that this guard ENFORCES that decision, and quoting another row's
// deferral reason is not enforcing the decision behind it. Measured 2026-09-20,
// by assert-enforcement-index.mjs going red on exactly that.
//
// ⚠️ THE DATE IS COMPARED IN UTC and the owner is in IST (UTC+5:30), so an
// expiry can bite up to one day "early" in local terms. Named rather than
// corrected: CI runs in UTC, a deferral date is a deadline and not a timestamp,
// and a guard that quietly extended one by a timezone would be doing the thing
// this limb exists to stop. There is also no environment override for "today" —
// a seam for faking the clock is a seam for waiving the rule.
//
// ⬜ NO ROW CARRIES THE PAIR TODAY, on purpose: all six app-surface store rows
// now have trees, so this is an escape hatch for the next channel declared
// before its listing is written, not an exemption anybody is using. Both
// directions are proven in tooling/ci/test/store-metadata.test.mjs and against
// the real tree.
//
// ─────────────────────────────────────────────────────────────────────────────
// ── AND EVERY WORD ABOVE WAS ABOUT ONE HAND-MADE DIRECTORY ──────────────────
// ─────────────────────────────────────────────────────────────────────────────
// The requirement's sentence is "store listing metadata is GENERATED from the
// app's spec fields and lives in the repo". The observation that makes it FALSE
// is: STAMP A FRESH APP AND YOU GET NO `store/` TREE.
//
// Measured on `main` @ 26c2303: `find tooling/bricks/app -ipath "*store*"`
// returned ZERO FILES, and this guard exited 0 reporting "5 present and
// complete" — because every subject it had was `apps/subscriptiontracker/store/`, which a
// human wrote by hand. Real guard, running, green, pointed one artifact away
// from the behaviour the requirement names. The seventh recorded instance of
// this corpus's signature defect.
//
// The limb at "THE FACTORY" below is the fix: its subject is the BRICK, so
// removing a store template from `tooling/bricks/app` turns this guard RED. That
// is the mutation the previous version slept through.
//
// ── WHAT HAPPENS TO apps/subscriptiontracker/store/, AND WHY ──────────────────────────────
// It STAYS, byte for byte, and it is NOT regenerated from the new templates.
// Three reasons, in order of weight:
//
//   1. It is a SHIPPED app's reviewed listing copy. `long-description.txt` is
//      written prose about what Subly actually does; `data-safety.json` and
//      `content-rating.json` are SWORN DECLARATIONS about Subly's real code,
//      each answer carrying its own citation and two of them closed by reading
//      a vendored SDK. Regenerating would replace all of that with template
//      filler that is true of no app in particular — trading a reviewed listing
//      for a uniform one, and swapping accurate declarations for `null`.
//   2. It is not the source of truth for the templates and must not become one.
//      What the brick inherited from this tree is its SHAPE and the CHANNEL
//      facts (the sourced limits, the UNVERIFIED marks, the reason a snap name
//      is claimed once). Its COPY is Subly's.
//   3. Nothing is lost by leaving it. The fields that MUST be generated — title,
//      short description, the two URLs — are already compared to their sources
//      on every run, above, and Subly passes. "Generated" and "agrees with the
//      spec" are the same property here, and the second is already enforced.
//
// The one thing that would have made regeneration necessary is if the hand-made
// tree and the generated one could disagree without anybody noticing. They
// cannot: both are checked against the same `derivedFields` block.
//
// Usage:  node tooling/ci/assert-store-metadata.mjs [repoRoot]
// Exit 0 = every tree that exists is complete and derived; 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { STORE_FORM_RULES } from '../../contracts/store/vocabulary.js';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);
const isDir = (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory();

/** Fatal on the spot: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — the defect this guard exists
 *  to remove, in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-metadata: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

// ── the register: the only declaration of the expected set ───────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    '[10]D-5\'s expected set is { store rows } × { apps }. With no register the left factor is',
    'undefined, the product is empty, and this guard would report every listing complete forever.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`, 'The expected set cannot be computed.']);
}

const channels = Array.isArray(register.channels) ? register.channels : [];

// ── WHICH STORE ROWS ARE THIS GUARD'S, AND WHY THE ANSWER IS DECLARED ────────
// 🔴 THE PRODUCT IS { kind: "store" rows OF THIS SURFACE } × { apps }, AND THE
// SURFACE HALF IS NOT A SHRINK. `apps/{app}/store/<channel>` is what this file
// grades and `catalog/apps.json` is the only right-hand side it has. On
// 2026-09-05 the register acquired `chrome-webstore`, `edge-addons` and `amo` —
// browser add-on stores whose listing trees live under
// extensions/Extension/<tool>/store/<store> and whose products are not in
// apps.json at all. Multiplying them by the app set would have demanded
// `apps/subscriptiontracker/store/chrome-webstore/`, a directory that should never exist: it
// would be a Chrome Web Store listing for a Flutter app that will never be
// submitted to it.
//
// So the domain is DECLARED rather than guessed, and it is declared in the
// register: each surface names its `storeMetadataGradedBy`, and this file takes
// the rows that name IT. That is the same shape as `storeMetadataContract` —
// read from the register, never a private copy — and it means a new surface
// cannot quietly fall out of every guard's domain: it either names this file, or
// it names another one, and the rows it takes with it are PRINTED below.
//
// ⚠️ NOTHING LEAVES COVERAGE. The extension trees are graded by
// extensions/scripts/check-store-metadata.mjs, which is stricter about them than
// this file could be — it holds three declarations of the store vocabulary to
// each other and enforces per-store field limits that carry a fetched source.
// assert-channel-register.mjs holds the two corpora together at the row level:
// every extension row's `storeMetadataDir` must resolve on disk for every tool
// AND agree with that tool's own `tool.json`.
const MY_REL = 'tooling/ci/assert-store-metadata.mjs';
const surfaceDefs = register.surfaces;
if (surfaceDefs === null || typeof surfaceDefs !== 'object' || Array.isArray(surfaceDefs)) {
  coverageLost([
    `${REGISTER} declares no \`surfaces\` block.`,
    'This guard reads `surfaces.<surface>.storeMetadataGradedBy` to decide which store rows are its',
    'domain. With the block gone the filter matches NOTHING and the expected set is empty — which is',
    'the same vacuity D-5 shipped with, arriving through a deleted key instead of an empty register.',
  ]);
}
const mySurfaces = new Set(
  Object.entries(surfaceDefs)
    .filter(([name, def]) => !name.startsWith('_') && def && def.storeMetadataGradedBy === MY_REL)
    .map(([name]) => name),
);
if (mySurfaces.size === 0) {
  coverageLost([
    `${REGISTER} names ${MY_REL} as \`storeMetadataGradedBy\` for NO surface.`,
    'Every store row would then belong to some other grader and this file would check nothing while',
    'exiting 0. If this guard is genuinely no longer D-5\'s reader, delete it in the same commit that',
    'moves the last surface off it — a guard nobody\'s domain names is a guard nobody runs.',
  ]);
}
const allStoreRows = channels.filter((c) => c && c.kind === 'store');
const storeRows = allStoreRows.filter((c) => mySurfaces.has(c.surface));
const elsewhere = allStoreRows.filter((c) => !mySurfaces.has(c.surface));
if (storeRows.length === 0) {
  coverageLost([
    `${REGISTER} declares ZERO \`kind: "store"\` channels on the surface(s) this guard grades (${[...mySurfaces].join(', ')}).`,
    'D-5 is entirely about store listings. With no store row the expected set is empty and this',
    'guard passes by having nothing to check — which is exactly the vacuity D-5 shipped with.',
  ]);
}

// Every store row this guard does NOT grade is named, with the guard that does.
// A row that silently left one guard's domain and entered nobody's is the exact
// shape of the coverage this file exists to make loud, so the handover is
// printed on every run rather than inferred from an absence.
for (const c of elsewhere) {
  const by = surfaceDefs?.[c.surface]?.storeMetadataGradedBy ?? '(no grader named — see assert-channel-register.mjs)';
  prints.push(
    `NOT THIS GUARD'S DOMAIN: channel "${c.id}" is kind:"store" on surface "${c.surface}", whose listing trees are graded by ${by}. ` +
      `Its trees are ${c.storeMetadataDir ?? '(none declared)'} — outside apps/{app}/store/, which is this file's whole subject. ` +
      'D-5 still holds for it; a different reader holds it.',
  );
}

const contract = register.storeMetadataContract;
if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract\`.`,
    'That block IS the per-tree file list. Without it "the tree is complete" has no right-hand side,',
    'so an empty directory would satisfy every check below.',
  ]);
}
const requiredFiles = Array.isArray(contract.requiredFiles) ? contract.requiredFiles.filter((f) => typeof f === 'string' && f.trim() !== '') : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} storeMetadataContract.requiredFiles is missing or empty.`,
    'The per-tree loop below iterates it. Empty, every tree is "complete" in zero comparisons and',
    'the listing this factory submits is whatever somebody last typed into a console.',
  ]);
}
const urlFiles = new Set(Array.isArray(contract.urlFiles) ? contract.urlFiles : []);
const derived = contract.derivedFields ?? {};
/** ORDERED CANDIDATES, not one path. `apps/subscriptiontracker` keeps its config at
 *  `lib/core/config/app_config.dart` and the BRICK stamps `lib/core/
 *  app_config.dart`; the single template that used to live here matched only the
 *  first, so every app the factory produces fell through to a `CANNOT DERIVE`
 *  print. See `portfolioUrls._why` in the register. */
const appConfigPaths = Array.isArray(contract.appConfigPaths)
  ? contract.appConfigPaths.filter((p) => typeof p === 'string' && p.includes('{app}'))
  : [];
if (appConfigPaths.length === 0) {
  coverageLost([
    `${REGISTER} storeMetadataContract.appConfigPaths is missing, empty, or holds no \`{app}\` template.`,
    'It is the only way this guard locates an app\'s compiled config, and the portfolio-URL agreement',
    'check below quantifies over what it finds. Empty, that check compares nothing and reports ok.',
  ]);
}
const portfolioUrls = contract.portfolioUrls;
if (portfolioUrls === null || typeof portfolioUrls !== 'object' || Array.isArray(portfolioUrls)) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract.portfolioUrls\`.`,
    'The privacy-policy and support URLs in every listing are compared to it. Without the block those',
    'two fields are checked for being non-empty https and nothing else — which is satisfied by any',
    'URL at all, including one pointing at somebody else\'s policy.',
  ]);
}

// ── the apps: the right factor of the expected set ───────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — the expected set has no right-hand factor.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([
    `${APPS} carries no app entries.`,
    'The expected set is { store rows } × { apps }; with no apps it is empty and this guard reports',
    'perfect coverage over nothing.',
  ]);
}

// ── the expected set ─────────────────────────────────────────────────────────
const expected = [];
for (const row of storeRows) {
  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) {
    // assert-channel-register.mjs already fails this; repeating the failure here
    // would be two guards reporting one fault. What matters HERE is that the row
    // contributes no expected tree, which would silently shrink the set.
    problems.push(
      `channel "${row.id}" is a store row with no \`storeMetadataDir\` template, so it contributes ZERO expected metadata trees. The coverage relationship "one directory per declared channel" cannot be evaluated for it, and a store row that expects nothing is a store row this guard does not cover.`,
    );
    continue;
  }
  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    expected.push({ row, app, dir: template.replace('{app}', app.slug) });
  }
}
if (expected.length === 0) {
  coverageLost([
    `the expected set is EMPTY — ${storeRows.length} store row(s) × ${apps.length} app(s) produced no directory.`,
    'Every per-tree check below has no domain. This is D-5\'s original vacuity wearing a different hat.',
  ]);
}

const present = expected.filter((e) => isDir(e.dir));
if (present.length === 0) {
  coverageLost([
    `${expected.length} store metadata tree(s) are expected and NONE exists on disk.`,
    'One of these is true and both are failures: every tree was deleted, or this scan is reading the',
    'wrong tree. A listing that exists only in a store console is precisely what [10]D-5 forbids —',
    `expected: ${expected.map((e) => e.dir).join(', ')}`,
  ]);
}

// ── orphan trees: a directory no register row declares ───────────────────────
// The other direction of the relationship. Rename a channel id in the register
// and the old tree is instantly unreachable — the register grows a store row
// with no tree AND a tree with no row, and without this the first half only
// PRINTS (deferred) while the second is invisible.
const declaredDirs = new Set(expected.map((e) => e.dir));
for (const app of apps) {
  if (typeof app.slug !== 'string') continue;
  const storeRoot = `apps/${app.slug}/store`;
  if (!isDir(storeRoot)) continue;
  for (const entry of listDir(abs(storeRoot), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = posix.join(storeRoot, entry.name);
    if (declaredDirs.has(rel)) continue;
    problems.push(
      `${rel} is a store metadata tree that no \`kind: "store"\` row in ${REGISTER} declares. Either a channel was renamed and its listing left behind — orphaned, unreachable, and still looking maintained — or a tree was created for a channel nobody declared. Declare the channel or delete the tree.`,
    );
  }
}

// ── the spec sources every derived field is compared to ──────────────────────
/** `static const String <name> = '<value>';` — the shape app_config.dart uses.
 *  Parsed, not grepped: the value has to be the one the app actually compiles. */
function dartConst(text, name) {
  const m = text.match(new RegExp(`static\\s+const\\s+String\\s+${name}\\s*=\\s*'([^']*)'\\s*;`));
  return m ? m[1] : null;
}

/** Every path from `appConfigPaths` that exists for `slug`, in declared order. */
function appConfigsFor(slug) {
  return appConfigPaths.map((t) => t.replace('{app}', slug)).filter((rel) => read(rel) !== null);
}

function specValue(app, spec) {
  if (spec.source === 'apps.json') {
    const v = app[spec.field];
    return typeof v === 'string' && v.trim() !== '' ? { value: v.trim() } : { gap: `${APPS} entry "${app.slug}" has no \`${spec.field}\`` };
  }
  if (spec.source === 'portfolioUrls') {
    const v = portfolioUrls[spec.field];
    // NOT a gap. The block is the register's own declaration, so a missing key
    // is a broken contract rather than an app that has not got there yet —
    // printing it would let the listing field go unchecked forever.
    return typeof v === 'string' && v.trim() !== ''
      ? { value: v.trim() }
      : { problem: `${REGISTER} storeMetadataContract.portfolioUrls has no \`${spec.field}\`, so this listing field is compared to nothing.` };
  }
  return { problem: `${REGISTER} storeMetadataContract.derivedFields declares source "${spec.source}", which this guard cannot resolve. A derivation nobody can evaluate is a field nobody checks.` };
}

// ── per tree ─────────────────────────────────────────────────────────────────
let treesChecked = 0;
let filesChecked = 0;
let derivedChecked = 0;

/** A declared `max` with no citation. Enforcing it would risk rejecting correct
 *  input on an invented number; ignoring it would leave the register claiming a
 *  constraint that does nothing. Fail, and say which. */
function unsourced(register, channelId, block, file) {
  return `${register} storeMetadataContract.perChannel["${channelId}"].${block}["${file}"] declares a numeric limit with NO \`source\`. An invented limit fires on CORRECT input — a made-up "120 characters or fewer" once rejected this repo's own fixture at 129 — so this guard will not enforce a number nobody sourced, and will not let the register pretend to constrain a field it does not. Add the URL and the date, or remove the limit.`;
}

/** Unicode CODE POINTS of the trimmed text.
 *
 *  🔴 NOT `.length`, WHICH IS UTF-16 UNITS. A correct limit counted the wrong
 *  way fires on correct input exactly like an invented one: a 30-character app
 *  name made of astral characters (emoji, many CJK extension and historic
 *  scripts) scores 60 under `.length` and would be rejected at a limit both
 *  Apple and Google would accept. Neither publishes the counting RULE — Google
 *  says only that "Character limits apply to both full-width and half-width
 *  characters" — so code points are the closest defensible reading; a byte
 *  count would reject correct UTF-8 prose in the other direction.
 *
 *  Trimmed, because the trailing newline every one of these files ends with is
 *  a text-file convention, not a character of the listing — counting it would
 *  reject a field sitting exactly on its limit. */
const charCount = (text) => [...text.trim()].length;

/** How many field limits were actually MEASURED. A contract that names files the
 *  trees do not carry would report every field within its limit by measuring
 *  none — see the self-check after the loop.
 *  `limitProblems` gates that self-check: when a limit was skipped because it is
 *  UNSOURCED, the guard has already said so, and firing COVERAGE LOST on top
 *  would exit early and MASK the specific message. A backstop that hides the
 *  diagnosis it was meant to back up is worse than no backstop. */
let limitsChecked = 0;
let limitProblems = 0;

/** Today in UTC, `YYYY-MM-DD`. Deliberately no environment override: a seam for
 *  faking the clock is a seam for waiving the rule, and every other date in this
 *  register is an owner-asserted `asOf` nobody can fake either. */
const TODAY_UTC = new Date().toISOString().slice(0, 10);

/** A REAL calendar date in `YYYY-MM-DD`. Round-tripped through Date rather than
 *  matched with a regex alone, because `2026-02-31` and `2026-13-01` satisfy the
 *  shape and are not dates — and a deferral whose expiry is not a date is one
 *  that can never expire, which is the failure mode this whole limb is about. */
function isRealIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `null` when a missing tree is legitimately deferred — the row carries a real
 *  future date AND a written reason for THE TREE. Otherwise the diagnosis, which
 *  the caller pastes into a FAIL.
 *
 *  🔴 THE COMPARISON IS `<`, SO THE NAMED DAY IS STILL COVERED and the guard
 *  reds the day after. "Deferred until 2026-10-31" reading as "already expired
 *  on the 31st" would make every deferral one day shorter than its author wrote,
 *  which is a guard editing a decision rather than enforcing one. */
function treeDeferralFault(deferral) {
  if (deferral === null || typeof deferral !== 'object' || Array.isArray(deferral)) {
    return 'and the row declares no `deferral` block at all, so nothing anywhere says when this tree is due, or why it cannot exist yet.';
  }
  const until = deferral.treeDeferredUntil;
  const why = deferral.treeDeferredWhy;
  if (until === undefined || until === null) {
    return 'and its `deferral` block carries no `treeDeferredUntil`. A deferral with no date never expires, so this gap prints on every run forever and no build ever notices — which is an exemption, not a deferral.';
  }
  if (!isRealIsoDate(until)) {
    return `and its \`deferral.treeDeferredUntil\` is ${JSON.stringify(until)}, which is not a real calendar date in YYYY-MM-DD. A date nothing can parse cannot pass, so it is a permanent exemption spelled like a deadline.`;
  }
  if (typeof why !== 'string' || why.trim() === '') {
    return `and its \`deferral.treeDeferredWhy\` is missing or empty. A date with no reason cannot be reviewed: nobody reading it later can tell whether ${until} is a considered deadline or a number typed to get a green build.`;
  }
  if (until < TODAY_UTC) {
    return `and its \`deferral.treeDeferredUntil\` was ${until}, which has PASSED — today is ${TODAY_UTC} in UTC. The deferral ran out and the tree still does not exist. The reason it was deferred for: ${why.trim()}`;
  }
  return null;
}

for (const { row, app, dir } of expected) {
  const extraFiles = (contract.perChannel?.[row.id]?.additionalFiles ?? []).filter((f) => typeof f === 'string');
  const maxLines = contract.perChannel?.[row.id]?.maxLines ?? {};
  const maxChars = contract.perChannel?.[row.id]?.maxChars ?? {};

  if (!isDir(dir)) {
    if (row.served === true) {
      problems.push(
        `channel "${row.id}" is SERVED and app "${app.slug}" carries no metadata tree at ${dir}. A live store listing whose only copy is in the console cannot be regenerated, audited, localized or diffed — [10]D-5 exists for exactly that.`,
      );
    } else {
      const fault = treeDeferralFault(row.deferral);
      if (fault === null) {
        prints.push(
          `NO TREE (deferred until ${row.deferral.treeDeferredUntil}): ${dir} — channel "${row.id}" is served: false and carries a dated tree deferral: ${String(row.deferral.treeDeferredWhy).trim()} AFTER ${row.deferral.treeDeferredUntil} — that day is still covered — this print becomes a FAIL, which is the whole difference between a deferral and an exemption.`,
        );
      } else {
        problems.push(
          `channel "${row.id}" is deferred and app "${app.slug}" carries no metadata tree at ${dir} — ${fault} A listing tree is eight text files this repository can write today; what is owner-gated is creating a PUBLISHER ACCOUNT, not writing a listing, and ${REGISTER} \`ownerQueue: ${JSON.stringify(row.ownerQueue ?? null)}\` does not say a directory cannot exist. MEASURED 2026-09-20: this limb printed instead of failing for "apps-gov-in", whose account is VERIFIED and lapses about 2026-10-31 if nothing is uploaded — a green build on a channel with no listing and a deadline. To defer a tree, the row's \`deferral\` must carry BOTH \`treeDeferredUntil\` (YYYY-MM-DD, a real date, still in the future, compared in UTC) and \`treeDeferredWhy\` (why THIS TREE cannot exist yet — not why the PUBLISH is deferred, which \`deferral.reason\` already says and which no tree needs). Otherwise: create the tree from tooling/bricks/app/__brick__/apps/{{app_id}}/store/${row.id}/.`,
        );
      }
    }
    continue;
  }
  treesChecked++;

  for (const rel of [...requiredFiles, ...extraFiles]) {
    const p = posix.join(dir, rel);
    const text = read(p);
    if (text === null) {
      problems.push(`${p} is missing. ${REGISTER} storeMetadataContract requires it in every store metadata tree.`);
      continue;
    }
    if (text.trim() === '') {
      problems.push(
        `${p} is EMPTY. An emptied listing field passes every "does the file exist" check and submits a blank — which is the difference between a tree that exists and a listing that is there.`,
      );
      continue;
    }
    filesChecked++;

    if (urlFiles.has(rel)) {
      const url = text.trim();
      if (!/^https:\/\/[^\s]+$/.test(url)) {
        problems.push(
          `${p} is not a single absolute https URL: ${JSON.stringify(url)}. Microsoft Store Policy 10.5.1 requires a working privacy-policy URL in Partner Center for any product accessing personal information; a relative or malformed one fails review.`,
        );
      }
    }

    // ── the numeric limits, and every one arrives with its citation ─────────
    // 🔴 A LIMIT WITHOUT A `source` IS NOT ENFORCED, IT IS REPORTED. An invented
    // limit fires on CORRECT input — a made-up "120 characters or fewer" once
    // rejected this repo's own fixture at 129 — so the only way to make the
    // guard reject a field is to write the citation next to the number. Skipping
    // silently would be worse than either: the register would look like it
    // constrained a field it did not.
    const limit = maxLines[rel];
    if (limit && Number.isInteger(limit.max)) {
      if (typeof limit.source !== 'string' || limit.source.trim() === '') {
        limitProblems++;
        problems.push(unsourced(REGISTER, row.id, 'maxLines', rel));
      } else {
        limitsChecked++;
        const entries = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
        if (entries.length > limit.max) {
          problems.push(`${p} has ${entries.length} entries and the limit is ${limit.max}. Source: ${limit.source}`);
        }
      }
    }

    // CHARACTERS, not entries — Apple's App Name and Subtitle are the only two
    // store field limits this repo has a primary source for. Everything else on
    // every Apple listing (keywords, description, promotional text) is recorded
    // as COULD-NOT-ESTABLISH in the tree README and carries no number here.
    const chars = maxChars[rel];
    if (chars && (Number.isInteger(chars.max) || Number.isInteger(chars.min))) {
      if (typeof chars.source !== 'string' || chars.source.trim() === '') {
        limitProblems++;
        problems.push(unsourced(REGISTER, row.id, 'maxChars', rel));
      } else {
        limitsChecked++;
        const n = charCount(text);
        if (Number.isInteger(chars.max) && n > chars.max) {
          problems.push(`${p} is ${n} characters and the limit is ${chars.max}. Source: ${chars.source}`);
        }
        if (Number.isInteger(chars.min) && n < chars.min) {
          problems.push(`${p} is ${n} characters and the minimum is ${chars.min}. Source: ${chars.source}`);
        }
      }
    }

    // GENERATED FROM THE SPEC, checked rather than asserted in a README.
    const spec = derived[rel];
    if (spec && typeof spec === 'object' && typeof spec.source === 'string') {
      const got = specValue(app, spec);
      if (got.problem) {
        problems.push(got.problem);
      } else if (got.gap) {
        prints.push(`CANNOT DERIVE ${p} — ${got.gap}. The field is present and non-empty; it just could not be compared to its spec source.`);
      } else {
        derivedChecked++;
        if (text.trim() !== got.value) {
          problems.push(
            `${p} has forked from its spec source. It reads ${JSON.stringify(text.trim())}; ${spec.source}:${spec.field} says ${JSON.stringify(got.value)}. [10]D-5: the listing is GENERATED from the spec — edit the spec, not the copy, or the two disagree and the store gets whichever is submitted last.`,
          );
        }
      }
    }
  }
}

// ── the scan must still be comparing something ───────────────────────────────
if (treesChecked > 0 && filesChecked === 0) {
  coverageLost([
    `${treesChecked} metadata tree(s) exist and ZERO files inside them were read.`,
    'Every field check above ran over an empty set and reported the listings complete.',
  ]);
}
// The same shape for the LIMITS. A `maxChars`/`maxLines` block declared against
// a tree that EXISTS, with not one comparison run, means the contract's file
// names have stopped lining up with the trees — and every listing field would
// then be "within its limit" by never having been measured. Counted only over
// channels whose tree is actually present, so a deferred channel's declared
// limits cannot fake coverage for a tree nobody has built.
const limitsDeclared = expected
  .filter((e) => isDir(e.dir))
  .reduce((n, e) => {
    const per = contract.perChannel?.[e.row.id] ?? {};
    const count = (o) => Object.keys(o ?? {}).filter((k) => k !== '_why').length;
    return n + count(per.maxLines) + count(per.maxChars);
  }, 0);
if (limitsDeclared > 0 && limitsChecked === 0 && limitProblems === 0) {
  coverageLost([
    `${limitsDeclared} field limit(s) are declared for trees that EXIST and NOT ONE was evaluated.`,
    'Either the contract names files the trees do not carry, or every limit lost its `source` and was',
    'skipped. Both report every listing field within its limit by never measuring one — and the limit',
    'that bites hardest (Play and Apple both cap the app name at 30) is derived from apps.json, so it',
    'is the STAMP this would stop catching, not just the listing.',
  ]);
}
if (treesChecked > 0 && Object.keys(derived).filter((k) => k !== '_why').length > 0 && derivedChecked === 0) {
  coverageLost([
    `${treesChecked} metadata tree(s) exist, ${Object.keys(derived).length - 1} derived field(s) are declared, and NOT ONE comparison ran.`,
    '"Generated from the spec" is D-5\'s headline. With no comparison reaching a spec source, the',
    'listing and the app can say different things and this guard cannot tell.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── THE FACTORY: does a NEW app get a listing without anybody typing one? ────
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 EVERYTHING ABOVE THIS LINE READS `apps/subscriptiontracker/store/`, WHICH WAS HAND-MADE.
// D-5's sentence is "store listing metadata is GENERATED from the app's spec
// fields". The observation that makes it false is: STAMP A FRESH APP AND YOU GET
// NO `store/` TREE. Measured on `main` @ 26c2303 — `find tooling/bricks/app
// -ipath "*store*"` returned ZERO files while this guard exited 0 reporting
// "5 present and complete". The guard was real, it ran, it was green, and its
// subject was one directory a human wrote by hand.
//
// So this limb's subject is the BRICK. It is the only limb that can see the
// falsifying observation, and it needs no stamp to do it: the templates are
// committed, so the check works in a tree where `apps/probe` is absent (which is
// every tree — the probe is CI-ephemeral and gitignored).
//
// ── STATED LIMIT ────────────────────────────────────────────────────────────
// This proves the brick EMITS a complete listing and that its derived fields
// reference the spec. It does not prove mason RENDERS them — that is what the
// `app_brick` lane's stamp does, and `assert-stamp-text-fidelity.mjs` is what
// fails on an HTML entity in the rendered output.
const BRICK = 'tooling/bricks/app';
const BRICK_APP_TOKEN = '{{app_id}}';
/** The brick's copy of a per-app path: `apps/{app}/x` -> `<brick>/apps/{{app_id}}/x`. */
const brickPath = (perAppTemplate) =>
  `${BRICK}/__brick__/${perAppTemplate.replace('{app}', BRICK_APP_TOKEN)}`;

/** Dart source with COMMENTS REMOVED and string literals copied through.
 *
 *  🔴 MEASURED, NOT PRECAUTIONARY. Commenting the call out —
 *  `final written = <String>[]; // writeStoreGraphics(` — left the wiring check
 *  below GREEN while a stamp wrote no listing graphics at all. That is this
 *  repository's oldest recorded guard defect wearing a Dart hat: a `grep
 *  '"r2_buckets"'` once matched the template comment explaining why there is no
 *  r2_buckets. A hook file whose entire purpose is explained in prose ABOUT the
 *  functions it calls is the worst possible input for a text scan.
 *
 *  String literals are copied through rather than stripped: `'…'` bodies are not
 *  comments, and a call spelled inside one would be prose too — but blanking
 *  them would change offsets for no gain, and the patterns here are function
 *  calls, which do not occur inside a Dart string in this file. */
function stripDartComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src[i] === "'" || src[i] === '"') {
      const quote = src[i];
      out += src[i++];
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') out += src[i++];
        out += src[i++];
      }
      if (i < src.length) out += src[i++];
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** A template body that is exactly one triple-stached mustache tag.
 *  TRIPLE on purpose: mason HTML-escapes every DOUBLE stache (& < > " ' /), and
 *  a listing is text, so `{{short_name}}` would stamp `Probe&#x27;s` into a
 *  store title. Matching only `{{{…}}}` makes that a build failure here rather
 *  than a corrupt listing nobody reads until review. */
const MUSTACHE_ONLY = /^\{\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\}$/;

let brickTreesChecked = 0;
let brickFilesChecked = 0;
let brickDerivedChecked = 0;

/** Files a store tree carries that the brick CANNOT template, because a mason
 *  template is text and these are PNGs. They are generated by post_gen from
 *  `app_id` + `seed_hex`; the wiring check below is what stops that generation
 *  being quietly removed. */
const generatedGraphics = new Set();
for (const row of storeRows) {
  const assets = contract.perChannel?.[row.id]?.graphicAssets?.assets ?? {};
  for (const name of Object.keys(assets)) if (!name.startsWith('_')) generatedGraphics.add(name);
}

for (const row of storeRows) {
  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) continue; // already a problem above
  const dir = brickPath(template);

  if (!isDir(dir)) {
    problems.push(
      `THE BRICK EMITS NO STORE LISTING for channel "${row.id}": ${dir} does not exist. [10]D-5 is that listing metadata is GENERATED from the app's spec — stamp app #2 today and its ${row.id} listing has to be hand-typed into a console, which is the one outcome D-5 names. This is the failure the previous version of this guard could not see, because its only subject was apps/subscriptiontracker/store, which a human wrote.`,
    );
    continue;
  }
  brickTreesChecked++;

  const extraFiles = (contract.perChannel?.[row.id]?.additionalFiles ?? []).filter((f) => typeof f === 'string');
  for (const rel of [...requiredFiles, ...extraFiles]) {
    if (generatedGraphics.has(rel)) continue; // covered by the wiring check below
    const p = posix.join(dir, rel);
    const text = read(p);
    if (text === null) {
      problems.push(
        `${p} is missing from the brick. ${REGISTER} requires "${rel}" in every store metadata tree, so a stamped app's "${row.id}" listing would be INCOMPLETE the moment the app joins the catalogue — and this guard would then fail on the app rather than on the factory that produced it.`,
      );
      continue;
    }
    if (text.trim() === '') {
      problems.push(`${p} is an EMPTY template, so every app the factory stamps gets a blank "${rel}" in its "${row.id}" listing.`);
      continue;
    }
    brickFilesChecked++;

    // ── the headline: is the field GENERATED, or is it a literal? ───────────
    const spec = derived[rel];
    if (!spec || typeof spec !== 'object') continue;
    const body = text.trim();
    if (spec.source === 'apps.json') {
      const brickVar = spec.brickVar;
      if (typeof brickVar !== 'string' || brickVar === '') {
        problems.push(
          `${REGISTER} storeMetadataContract.derivedFields["${rel}"] is sourced from ${APPS}.${spec.field} but names no \`brickVar\`. Nothing then says WHICH mason var the template must interpolate, so this limb cannot tell a generated field from a hand-typed one — the exact blindness [10]D-5 is about.`,
        );
        continue;
      }
      const m = MUSTACHE_ONLY.exec(body);
      if (!m) {
        problems.push(
          `${p} is not generated: it reads ${JSON.stringify(body.slice(0, 60))} where it must be exactly \`{{{${brickVar}}}}\`. A literal in the template is the same listing for all fifty apps — hand-written once instead of once per app, which is not the fix [10]D-5 asks for. (Triple stache: mason HTML-escapes double staches and a store title is text.)`,
        );
      } else if (m[1] !== brickVar) {
        problems.push(
          `${p} interpolates \`{{{${m[1]}}}}\` but ${APPS}.${spec.field} — the value this field is compared against on every run — is stamped from \`${brickVar}\`. The two would disagree for any app where the vars differ, and the per-app check above would then fail on the app.`,
        );
      } else {
        brickDerivedChecked++;
      }
    } else if (spec.source === 'portfolioUrls') {
      const want = portfolioUrls[spec.field];
      if (typeof want !== 'string' || want.trim() === '') continue; // reported by specValue
      if (body !== want.trim()) {
        problems.push(
          `${p} reads ${JSON.stringify(body)} and ${REGISTER} storeMetadataContract.portfolioUrls.${spec.field} says ${JSON.stringify(want.trim())}. Every app this factory stamps would publish the wrong ${spec.field} in its "${row.id}" listing, and the per-app check would then fail on each of them in turn.`,
        );
      } else {
        brickDerivedChecked++;
      }
    }
  }
}

// ── the two PNGs the brick cannot template, and the wiring that writes them ──
// A mason template is text; a feature graphic is not. post_gen generates both
// from `app_id` + `seed_hex`. That is a CLAIM about the stamping path, so it is
// checked as one — and deliberately across TWO FILES: the declaration is in
// brand_assets.dart and the call must be in post_gen.dart, which contains no
// declaration of it. That is the 2026-07-26 lesson stated as a shape rather than
// a note (assert-seams-wired.mjs shipped with its "is it called" check matching
// the function's own declaration, so deleting every real caller still passed).
if (generatedGraphics.size > 0) {
  const DECL = `${BRICK}/hooks/brand_assets.dart`;
  const CALL = `${BRICK}/hooks/post_gen.dart`;
  const declRaw = read(DECL);
  const callRaw = read(CALL);
  const declSrc = declRaw === null ? null : stripDartComments(declRaw);
  const callSrc = callRaw === null ? null : stripDartComments(callRaw);
  if (declSrc === null || callSrc === null) {
    coverageLost([
      `${declSrc === null ? DECL : CALL} does not exist.`,
      'The store listing graphics are generated by the stamp, and this is the only check that they',
      'still are. With the file gone the check ranges over nothing and reports the factory healthy.',
    ]);
  }
  // 🔴 THE LOOKBEHIND IS THE WHOLE CHECK. Without `(?<![\w$])` this matches
  // `_writeStoreGraphics(` — post_gen's own PRIVATE WRAPPER, which is a
  // different function that merely shares a suffix. MEASURED, not reasoned:
  // with the bare pattern, gutting the real call inside that wrapper
  // (`final written = <String>[]; // writeStoreGraphics(`) left this guard GREEN
  // while a stamp wrote no listing graphics at all. Same family as the 2026-07-26
  // seams defect — a "is it called" check satisfied by something that is not the
  // call — found the same way, by mutating the real tree rather than a fixture.
  const CALLS = /(?<![\w$])writeStoreGraphics\s*\(/;
  if (!new RegExp(`List<String>\\s+${CALLS.source.replace('(?<![\\w$])', '')}`).test(declSrc)) {
    problems.push(
      `${DECL} declares no \`writeStoreGraphics\`. ${[...generatedGraphics].join(', ')} would then never be written by a stamp, and every app the factory produces would carry an INCOMPLETE store tree.`,
    );
  }
  if (!CALLS.test(callSrc)) {
    problems.push(
      `${CALL} never calls \`writeStoreGraphics\` — comments stripped, and not counting its own private \`_writeStoreGraphics\` wrapper. The generator exists and nothing runs it, so a stamped app gets ${[...generatedGraphics].join(' and ')} not at all and this guard then fails on the APP rather than on the factory that shorted it.`,
    );
  }
  if (!/channel-register\.json/.test(callSrc)) {
    problems.push(
      `${CALL} does not read tooling/channel-register.json. Play's dimensions and its two OPPOSITE alpha requirements are declared there with the URL and date they were fetched from; a stamp that hard-codes them instead is the second declaration and the first to drift, and getting the alpha backwards produces a file that looks perfect and is rejected at upload.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── A STORE'S OWN FORM RULES: the listing must be one the portal ACCEPTS ─────
// ─────────────────────────────────────────────────────────────────────────────
// Everything above checks that a listing is complete and derived. It cannot say
// whether the store's upload form would take it, because until 2026-09-22 no
// store's form had been read. apps.gov.in's has (contracts/store/vocabulary.js
// STORE_FORM_RULES, read out of the form's own script), and each rule there is
// a validator the portal runs on the day the owner uploads. A listing that
// breaks one is refused at the sitting, with the suspension clock running, so
// each is checked here on every PR (O-APPS-GOV-IN-CHANNEL-APK).
//
// The screenshots are photographs of a build, so a stamp cannot make them. On
// an app the catalogue calls `live`, zero screenshots FAILS; on any other app
// (a fresh stamp is `preview`) it PRINTS. A wrong count, size, format or byte
// size FAILS on every app. The brick is held to the two things it DOES stamp:
// the category (the literal the renderer writes) and form-answers.json.
let formRuleChecks = 0;

/** Pixel size from the file's own header: PNG IHDR, or a JPEG start-of-frame. */
function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpg' };
      i += 2 + len;
    }
  }
  return null;
}

/** Every `{ from: "<name>" }` in the form answers, with the key path it sits at. */
function fromRefs(node, path, out = []) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (typeof node.from === 'string') out.push({ path, from: node.from });
    for (const [k, v] of Object.entries(node)) fromRefs(v, `${path}.${k}`, out);
  }
  return out;
}

const OWNER_FILLS = 'OWNER FILLS';
const STEP3_COUNT = 11;

/** form-answers.json, on an app tree and on the brick alike. On the brick, a
 *  `from` naming a PNG the stamp generates (post_gen, see above) is not a file yet.
 *  It is REQUIRED here rather than through the register's `additionalFiles`: a
 *  .json listed there is a sworn declaration to assert-sworn-store-files.mjs,
 *  whose template must stamp null answers, and these answers are chassis facts
 *  that assert-apps-gov-in-apk.mjs re-proves against the built .apk. */
function checkFormAnswers(dir, row, rules, onBrick = false) {
  const p = posix.join(dir, 'form-answers.json');
  const text = read(p);
  if (text === null) {
    problems.push(`${p} is missing. It is the answer to every field of the ${row.id} upload form, which the owner types from; without it the form is filled from memory.`);
    return;
  }
  let fa;
  try {
    fa = JSON.parse(text);
  } catch (e) {
    problems.push(`${p} does not parse (${e.message}). It is what the owner types the ${row.id} upload form from.`);
    return;
  }
  formRuleChecks++;
  if (fa.channel !== row.id) problems.push(`${p} says channel ${JSON.stringify(fa.channel ?? null)}; it sits in the "${row.id}" tree.`);
  const s1 = fa.step1 ?? {};
  const s2 = fa.step2 ?? {};
  const mp = s1.minimumPlatform ?? {};
  const label = rules.minPlatformLabels[mp.sdk];
  if (!Number.isInteger(mp.sdk) || label === undefined) {
    problems.push(`${p} step1.minimumPlatform.sdk is ${JSON.stringify(mp.sdk ?? null)}; the form's list names only SDK ${Object.keys(rules.minPlatformLabels).join(', ')}.`);
  } else if (mp.label !== label) {
    problems.push(`${p} step1.minimumPlatform says SDK ${mp.sdk} is ${JSON.stringify(mp.label ?? null)}; the form lists SDK ${mp.sdk} as ${JSON.stringify(label)}. The owner picks the label, so the label is what must be right.`);
  }
  if (typeof s1.stateUt?.answer !== 'string' || s1.stateUt.answer.trim() === '') {
    problems.push(`${p} step1.stateUt.answer is missing. The form requires a state or union territory.`);
  }
  for (const field of ['supportEmail', 'supportPhone']) {
    if (s1[field] !== OWNER_FILLS) {
      const len = typeof s1[field] === 'string' ? [...s1[field]].length : 0;
      const cap = field === 'supportPhone' && len > rules.supportPhoneMaxChars ? ` It is also ${len} characters, and the form takes at most ${rules.supportPhoneMaxChars}.` : '';
      problems.push(`${p} step1.${field} must read "${OWNER_FILLS}". The value is shown on the store, and the owner's contact details are never written into this repository.${cap}`);
    }
  }
  for (const { path, from } of fromRefs({ step1: s1, step2: s2 }, 'form-answers')) {
    if (onBrick && generatedGraphics.has(from)) continue;
    if (!existsSync(abs(posix.join(dir, from)))) {
      problems.push(`${p} ${path.replace(/^form-answers\./, '')} is filled from "${from}", and ${posix.join(dir, from)} does not exist.`);
    }
  }
  const s3 = Array.isArray(fa.step3) ? fa.step3 : [];
  if (s3.length !== STEP3_COUNT) problems.push(`${p} step3 holds ${s3.length} answer(s); the form's step 3 asks ${STEP3_COUNT} questions.`);
  const ids = new Set();
  s3.forEach((a, i) => {
    if (a?.q !== i + 1) problems.push(`${p} step3[${i}] is question ${JSON.stringify(a?.q ?? null)}; the list is in the form's order, 1 to ${STEP3_COUNT}.`);
    if (typeof a?.id !== 'string' || ids.has(a.id)) problems.push(`${p} step3[${i}] has a missing or repeated id ${JSON.stringify(a?.id ?? null)}.`);
    else ids.add(a.id);
    if (a?.answer !== 'Yes' && a?.answer !== 'No') problems.push(`${p} step3 "${a?.id}" answers ${JSON.stringify(a?.answer ?? null)}; the form takes Yes or No.`);
    if (typeof a?.evidence !== 'string' || a.evidence.trim() === '') problems.push(`${p} step3 "${a?.id}" gives no evidence. An answer with no evidence is an answer from memory.`);
  });
}

for (const { row, app, dir } of present) {
  const rules = STORE_FORM_RULES[row.id];
  if (!rules) continue;
  const live = app.status === 'live';

  // category: one of the store's own closed list
  const category = (read(posix.join(dir, 'category.txt')) ?? '').trim();
  formRuleChecks++;
  if (category !== '' && !rules.categories.includes(category)) {
    problems.push(`${dir}/category.txt reads ${JSON.stringify(category)}, which is not one of the ${rules.categories.length} categories the ${row.id} form offers (${rules.categories.join(', ')}). Source: ${rules.source}`);
  }

  // screenshots: count, format, exact pixel size, byte size
  const shots = rules.screenshots;
  const shotsDir = posix.join(dir, shots.dir);
  const names = isDir(shotsDir) ? listDir(abs(shotsDir)).filter((n) => n !== 'README.md' && n !== 'CAPTURE.json').sort() : [];
  if (names.length === 0) {
    const why = `${shotsDir} holds no screenshots; the ${row.id} form refuses an upload with fewer than ${shots.min}.`;
    if (live) problems.push(`${why} App "${app.slug}" is live in the catalogue, so its listing must be uploadable today.`);
    else prints.push(`NO SCREENSHOTS YET — ${why} App "${app.slug}" is ${JSON.stringify(app.status ?? null)}, so this prints.`);
  } else if (names.length < shots.min || names.length > shots.max) {
    problems.push(`${shotsDir} holds ${names.length} screenshot(s); the ${row.id} form takes ${shots.min} to ${shots.max}.`);
  }
  for (const n of names) {
    const p = posix.join(shotsDir, n);
    const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!shots.formats.includes(ext)) {
      problems.push(`${p} is not a ${shots.formats.join(' or ')} file; the ${row.id} form takes no other screenshot format.`);
      continue;
    }
    const buf = readFileSync(abs(p));
    const size = imageSize(buf);
    formRuleChecks++;
    if (!size) problems.push(`${p} has no readable PNG or JPEG header.`);
    else if (size.width !== shots.width || size.height !== shots.height) {
      problems.push(`${p} is ${size.width}x${size.height}; the ${row.id} form refuses any screenshot that is not exactly ${shots.width}x${shots.height}.`);
    }
    if (buf.length > shots.maxBytes) problems.push(`${p} is ${buf.length} bytes; the ${row.id} form takes at most ${shots.maxBytes} per screenshot.`);
  }

  // the icon: exact size, under the byte cap
  const icon = rules.icon;
  const iconRel = posix.join(dir, icon.file);
  if (existsSync(abs(iconRel))) {
    const buf = readFileSync(abs(iconRel));
    const size = imageSize(buf);
    formRuleChecks++;
    if (!size || size.format !== 'png') problems.push(`${iconRel} is not a readable PNG.`);
    else if (size.width !== icon.width || size.height !== icon.height) problems.push(`${iconRel} is ${size.width}x${size.height}; the ${row.id} form takes exactly ${icon.width}x${icon.height}.`);
    if (buf.length >= icon.maxBytesExclusive) problems.push(`${iconRel} is ${buf.length} bytes; the ${row.id} form takes an icon under ${icon.maxBytesExclusive}.`);
  } else {
    problems.push(`${iconRel} is missing; the ${row.id} form requires an app icon.`);
  }

  checkFormAnswers(dir, row, rules);
}

for (const row of storeRows) {
  const rules = STORE_FORM_RULES[row.id];
  if (!rules || typeof row.storeMetadataDir !== 'string') continue;
  // The register's icon declaration is what post_gen writes a stamped app's icon
  // from, so it must say what the form says.
  const decl = contract.perChannel?.[row.id]?.graphicAssets?.assets?.[rules.icon.file];
  formRuleChecks++;
  if (!decl || decl.width !== rules.icon.width || decl.height !== rules.icon.height || decl.maxBytes !== rules.icon.maxBytesExclusive - 1) {
    problems.push(
      `${REGISTER} storeMetadataContract.perChannel["${row.id}"].graphicAssets.assets["${rules.icon.file}"] must declare ${rules.icon.width}x${rules.icon.height} and maxBytes ${rules.icon.maxBytesExclusive - 1}, the form's own icon rule (contracts/store/vocabulary.js STORE_FORM_RULES). post_gen writes every stamped app's icon from that declaration; it reads ${JSON.stringify(decl ? { width: decl.width, height: decl.height, maxBytes: decl.maxBytes } : null)}.`,
    );
  }
  const dir = brickPath(row.storeMetadataDir);
  if (!isDir(dir)) continue; // the factory limb already failed it
  const category = (read(posix.join(dir, 'category.txt')) ?? '').trim();
  formRuleChecks++;
  if (category !== rules.listingCategory) {
    problems.push(
      `${dir}/category.txt stamps ${JSON.stringify(category)}; it must stamp exactly ${JSON.stringify(rules.listingCategory)}, the \`listingCategory\` tooling/app-yaml/render.mjs writes for "${row.id}". A mustache template cannot test membership of the form's ${rules.categories.length} categories, so anything else is refused by the portal for some app, or disagrees with the app's first render.`,
    );
  }
  checkFormAnswers(dir, row, rules, true);
}

// ── ⚠️ AND THERE IS DELIBERATELY NO `COVERAGE LOST` FOR THIS LIMB ───────────
// Every other scan in this file needs one because its domain can silently
// become empty. This one's cannot: a store row with no brick tree is a FAIL by
// name, and every required file missing from a tree that exists is a FAIL by
// name. So "the scan reached nothing" is not a silent zero here — it is N
// explicit failures, one per channel, printed with the channel id.
//
// The two backstops that were written first (`brickFilesChecked === 0` and
// `brickDerivedChecked === 0`) were REMOVED rather than kept: neither could be
// reached without a per-row FAIL already firing, and the COVERAGE LOST exits
// immediately — so their only possible effect was to MASK the specific
// diagnosis with a vaguer one. An assertion that cannot fail is worse than
// none, and one that can only fire by hiding a better message is worse again.
// The numbers are still REPORTED, on the REQUIRED_COVERAGE line below, which is
// where a shrinking scan shows up to a human reading a green run.

// ── the portfolio URLs still agree with the code that ships them ────────────
// `portfolioUrls` moved OUT of app_config so the check could reach a stamped app
// (see the register's `_why`). This is what stops that move loosening anything:
// every app_config in the tree that declares one of these constants must still
// agree with the register, in BOTH layouts, brick included.
const agrees = portfolioUrls.agreesWithAppConfigConst ?? {};
let configsCompared = 0;
const configSubjects = [
  ...apps.filter((a) => typeof a.slug === 'string' && a.slug !== '').flatMap((a) => appConfigsFor(a.slug)),
  ...appConfigPaths.map((t) => brickPath(t)).filter((rel) => read(rel) !== null),
];
for (const [urlKey, constName] of Object.entries(agrees)) {
  const want = portfolioUrls[urlKey];
  if (typeof want !== 'string' || want.trim() === '') continue;
  for (const rel of configSubjects) {
    const declaredValue = dartConst(read(rel), constName);
    if (declaredValue === null) continue; // this config does not declare it
    configsCompared++;
    if (declaredValue !== want.trim()) {
      problems.push(
        `${rel} compiles \`${constName} = ${JSON.stringify(declaredValue)}\` while ${REGISTER} storeMetadataContract.portfolioUrls.${urlKey} publishes ${JSON.stringify(want.trim())} in every store listing. The app sends users to one page and the store listing to another, and both look correct on their own.`,
      );
    }
  }
}
if (Object.keys(agrees).length > 0 && configsCompared === 0) {
  coverageLost([
    `storeMetadataContract.portfolioUrls.agreesWithAppConfigConst names ${Object.keys(agrees).length} constant(s) and NOT ONE app_config in this tree declares any of them.`,
    `Subjects searched: ${configSubjects.length ? configSubjects.join(', ') : '(none found — appConfigPaths matched nothing)'}.`,
    'Either the constant was renamed or appConfigPaths has stopped locating the config. Both leave the',
    'listing URL tied to nothing while this block still claims it is tied to the code.',
  ]);
}

// ── the MSIX package identity: declared once, packaged from that declaration ─
// The register row's own notes say the identity is THIS row's field. That is a
// claim about data, and until it is compared to what `msix` actually packages it
// is a claim about prose. tooling/release/submit-windows-store.mjs re-checks the
// same thing independently and on purpose: a release path that trusts a check it
// did not run is not a release path.
/** Flat scalar keys of a pubspec's `msix_config:` block. Self-checking: a block
 *  that parses to nothing is reported, never assumed absent. */
function msixConfig(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^msix_config:\s*$/.test(l));
  if (at === -1) return null;
  const out = {};
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const IDENTITY_FIELDS = [
  ['identityName', 'identity_name'],
  ['publisherDisplayName', 'publisher_display_name'],
  ['publisher', 'publisher'],
];

let identitiesChecked = 0;
for (const row of storeRows) {
  const identity = row.packageIdentity;
  if (identity === undefined || identity === null) continue; // only rows that claim one
  const sentinel = identity.notYetConfiguredSentinel;
  if (typeof sentinel !== 'string' || sentinel.trim() === '') {
    problems.push(
      `channel "${row.id}" declares a \`packageIdentity\` with no \`notYetConfiguredSentinel\`. Without it nothing can tell a Partner-Center placeholder from a real value, so a placeholder would validate as configured and a package would be built under an identity that does not exist.`,
    );
    continue;
  }
  for (const app of apps) {
    const pubspecRel = `apps/${app.slug}/pubspec.yaml`;
    const pubspecText = read(pubspecRel);
    if (pubspecText === null) continue;
    const cfg = msixConfig(pubspecText);
    if (cfg === null) {
      // 🔴 THE SAME ASYMMETRY AS THE TREES, AND FOR THE SAME REASON. An app that
      // already carries this channel's metadata tree has committed to the
      // channel, so a DELETED msix_config is a regression: `msix` silently falls
      // back to `com.flutter.<name>`, an identity that belongs to nobody, and
      // packaging keeps succeeding. An app with no tree never had one — that is
      // the brick work D-5 still owes — and prints.
      // Mutation-proven 2026-08-01: before this split, deleting the whole
      // msix_config block from apps/subscriptiontracker/pubspec.yaml exited 0.
      const committed = isDir(String(row.storeMetadataDir ?? '').replace('{app}', app.slug));
      const msg = `${pubspecRel} declares no \`msix_config:\` block while app "${app.slug}" carries channel "${row.id}"'s metadata tree. \`msix\` then packages under its fallback identity \`com.flutter.<name>\` — which belongs to nobody, cannot be submitted, and makes [13]T-5's Windows cancelAll a no-op — and the build still succeeds.`;
      if (committed) problems.push(msg);
      else
        prints.push(
          `NO msix_config: ${pubspecRel} — app "${app.slug}" declares no MSIX packaging block and carries no ${row.id} metadata tree either, so channel "${row.id}"'s package identity is not applied to it. Stamped apps do not get one yet; that is [10]D-5's remaining brick work.`,
        );
      continue;
    }
    if (Object.keys(cfg).length === 0) {
      coverageLost([
        `${pubspecRel} has an \`msix_config:\` block that parsed to ZERO keys.`,
        'The reader has stopped reaching the block, so every identity comparison below compares',
        'undefined to undefined and agrees.',
      ]);
    }
    let pending = 0;
    let configured = 0;
    for (const [regField, yamlField] of IDENTITY_FIELDS) {
      const declaredValue = identity[regField];
      const packaged = cfg[yamlField];
      if (typeof declaredValue !== 'string' || declaredValue.trim() === '') {
        problems.push(`channel "${row.id}" packageIdentity.${regField} is missing or empty in ${REGISTER}. The register is the SINGLE declaration of this identity ([pipeline F-2]); an absent field is a hole, not a placeholder.`);
        continue;
      }
      if (packaged === undefined) {
        problems.push(`${pubspecRel} msix_config.${yamlField} is absent while ${REGISTER} declares packageIdentity.${regField}. \`msix\` would package a different identity from the one the register documents, and only one of the two can ship.`);
        continue;
      }
      identitiesChecked++;
      if (declaredValue !== packaged) {
        problems.push(
          `package identity DISAGREES for app "${app.slug}": ${REGISTER} says ${regField} = ${JSON.stringify(declaredValue)}, ${pubspecRel} says ${yamlField} = ${JSON.stringify(packaged)}. Two copies of an identity is how the wrong one ships, and an MSIX published under the wrong identity cannot be taken back.`,
        );
        continue;
      }
      if (declaredValue.includes(sentinel)) pending++;
      else configured++;
    }
    if (pending > 0 && configured > 0) {
      problems.push(
        `package identity for app "${app.slug}" on channel "${row.id}" is HALF configured — ${configured} real value(s) and ${pending} still ${sentinel}. It packages cleanly and submits under a name that is part real and part placeholder.`,
      );
    } else if (pending > 0) {
      prints.push(
        `PACKAGE IDENTITY NOT YET CONFIGURED — app "${app.slug}", channel "${row.id}": all ${pending} field(s) are ${sentinel}. Partner Center assigns them after OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}; there is nothing to derive them from and an invented value would publish under an identity we do not own.`,
      );
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
  console.log('');
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-store-metadata: FAILED');
  process.exitCode = 1;
} else {
  ok(
    `REQUIRED_COVERAGE — ${storeRows.length} store channel(s) × ${apps.length} app(s) = ${expected.length} expected tree(s); ` +
      `${treesChecked} present and complete, ${expected.length - treesChecked} printed as owner-gated gaps`,
  );
  ok(`${formRuleChecks} store form rule(s) checked against the store's own upload form (contracts/store/vocabulary.js STORE_FORM_RULES)`);
  ok(`${filesChecked} listing field(s) non-empty, ${derivedChecked} of them compared to their spec source, ${limitsChecked} measured against a SOURCED store limit, ${identitiesChecked} package-identity field(s) agree`);
  ok(
    `REQUIRED_COVERAGE (THE FACTORY) — ${storeRows.length} store channel(s) → ${brickTreesChecked} brick template tree(s) under ${BRICK}, ` +
      `${brickFilesChecked} template(s) read, ${brickDerivedChecked} field(s) proven GENERATED from a spec var rather than typed, ` +
      `${generatedGraphics.size} graphic(s) wired to the stamp, ${configsCompared} app_config constant(s) agree with the register`,
  );
  console.log('\nassert-store-metadata: ok');
}
