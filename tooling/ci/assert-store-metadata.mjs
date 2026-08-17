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
//   tree missing, row deferred    -> PRINT (owner-gated; the whole set today)
//   tree PRESENT but incomplete   -> FAIL  (this is the case that matters)
//   tree present, field emptied   -> FAIL
//   tree present, field forked from its spec source -> FAIL
//   a tree with no register row   -> FAIL  (a channel renamed out from under it)
//   EVERY expected tree gone      -> COVERAGE LOST
//
// 🔴 THE THIRD LINE IS THE POINT. A guard that only printed would let anyone
// delete apps/subly/store/windows-store/title.txt and stay green — "PRINT
// everything" is how an owner-gated exemption eats the check it was meant to
// scope. What is owner-gated is CREATING a tree, not KEEPING one.
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
// complete" — because every subject it had was `apps/subly/store/`, which a
// human wrote by hand. Real guard, running, green, pointed one artifact away
// from the behaviour the requirement names. The seventh recorded instance of
// this corpus's signature defect.
//
// The limb at "THE FACTORY" below is the fix: its subject is the BRICK, so
// removing a store template from `tooling/bricks/app` turns this guard RED. That
// is the mutation the previous version slept through.
//
// ── WHAT HAPPENS TO apps/subly/store/, AND WHY ──────────────────────────────
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
  process.exit(1);
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
const storeRows = channels.filter((c) => c && c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([
    `${REGISTER} declares ZERO \`kind: "store"\` channels.`,
    'D-5 is entirely about store listings. With no store row the expected set is empty and this',
    'guard passes by having nothing to check — which is exactly the vacuity D-5 shipped with.',
  ]);
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
/** ORDERED CANDIDATES, not one path. `apps/subly` keeps its config at
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
      prints.push(
        `NO TREE (deferred): ${dir} — channel "${row.id}" is served: false and blocked on OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}. Creating a publisher account is owner work, so this prints rather than blocking every build on it.`,
      );
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
// 🔴 EVERYTHING ABOVE THIS LINE READS `apps/subly/store/`, WHICH WAS HAND-MADE.
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
      `THE BRICK EMITS NO STORE LISTING for channel "${row.id}": ${dir} does not exist. [10]D-5 is that listing metadata is GENERATED from the app's spec — stamp app #2 today and its ${row.id} listing has to be hand-typed into a console, which is the one outcome D-5 names. This is the failure the previous version of this guard could not see, because its only subject was apps/subly/store, which a human wrote.`,
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
      // msix_config block from apps/subly/pubspec.yaml exited 0.
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
  ok(`${filesChecked} listing field(s) non-empty, ${derivedChecked} of them compared to their spec source, ${limitsChecked} measured against a SOURCED store limit, ${identitiesChecked} package-identity field(s) agree`);
  ok(
    `REQUIRED_COVERAGE (THE FACTORY) — ${storeRows.length} store channel(s) → ${brickTreesChecked} brick template tree(s) under ${BRICK}, ` +
      `${brickFilesChecked} template(s) read, ${brickDerivedChecked} field(s) proven GENERATED from a spec var rather than typed, ` +
      `${generatedGraphics.size} graphic(s) wired to the stamp, ${configsCompared} app_config constant(s) agree with the register`,
  );
  console.log('\nassert-store-metadata: ok');
}
