#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-play-device-coverage.mjs — Play's screenshot minimum counts DEVICE
// TYPES, not files, and this tree had only ever counted files.
//
// [pipeline D-5] "store listing metadata is generated from the spec and lives in
//                 the repo … and is never hand-typed into a store console as the
//                 only copy."
//
// ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────
// 🔴 EVERY OTHER PLAY LISTING ASSET PASSES. Measured 2026-08-20 against the real
// files: `store-icon-512.png` is 512×512 RGBA 61.3 KB — pass. `feature-graphic
// .png` is 1024×500 RGB 346.5 KB — pass. The screenshots are four PNGs, and
// `assert-listing-assets.mjs` clears every one of them: count ≥ minCount 2,
// ≤ maxCount 8, inside the ratio limit, colour type 2, live provenance, no demo
// banner. Green, correctly, on every limb it has.
//
// And all four are 1080×1920. **Zero tablet. Zero Chromebook.** Google's
// sentence is "you must provide a minimum of two screenshots ACROSS DIFFERENT
// DEVICE TYPES to publish your store listing", and four phone screenshots are
// one device type. On the evidence in this repository that is the single most
// likely cause of a first-submission bounce — and it had been invisible for
// weeks under a set of checks that were each individually right.
//
// ── WHY assert-listing-assets.mjs COULD NOT HAVE CAUGHT IT ───────────────────
// Not an oversight — a limit of the medium. That guard asks a PNG how many, how
// big, what colour type and what is painted at the top of it. There is no
// question it can ask a PNG that answers WHICH DEVICE TYPE PLAY WILL FILE IT
// UNDER, because Play files a screenshot by the console SLOT it was uploaded to.
// 1080×1920 is a perfectly ordinary 7-inch tablet portrait screenshot; the
// pixels do not decide it.
//
// So the device type is DECLARED, in `tooling/channel-register.json` →
// `…graphicAssets.screenshots.deviceTypeCoverage.sets`, as one directory per
// type, and this guard counts the declared directories that actually carry
// pixels. That is the only form of the question a repository can answer, and it
// is the form the console will ask at upload.
//
// ── A DIRECTORY THAT IS NOT EMPTY IS NOT A SET THAT IS RIGHT ────────────────
// Coverage used to turn on "the directory holds one readable PNG", and a 1x1 PNG
// dropped into screenshots-tablet/ bought it: measured 2026-08-26 on a throwaway
// root, --for-submission exited 0. The register's `sets.tablet` row already
// declares minCount, minSide, maxSide and portraitAspect with the page quoted
// beside them, so each screenshot is now opened and graded against THAT SET'S
// OWN declared rule. A row declaring only `dir` — `phone` does — grades nothing.
//
// ── 🔴 ROOT 2: THE FACTORY. A CHECK THAT CANNOT SEE THE TEMPLATE IS THE BUG ──
// Everything above ranges over `catalog/apps.json` — REGISTERED apps. Measured
// 2026-09-05 on `main` @ a9b04696: that is ONE app, `subly`, whose tablet set a
// human captured by hand on 2026-08-27. The template every future app is stamped
// from, `tooling/bricks/app/__brick__/apps/{{app_id}}/store/android-play/`,
// carried `screenshots/` AND NO `screenshots-tablet/` AT ALL — so every app
// stamped since the register grew its tablet row on 2026-08-21 was born one
// device type short, structurally unpublishable, and this guard printed `ok`.
// Not because a limb was wrong: because the brick was not in its domain. The
// first anyone would have learned of it is a Google Play rejection.
//
// So the brick is a SECOND ROOT, with its OWN floor, checked on every run. The
// register is the one declaration for both roots; only the question differs.
//
//   root 1, a REGISTERED app  — "does this listing carry the pixels?"
//   root 2, the BRICK         — "can the factory produce a listing that can?"
//
// ⚠️ AND THE BRICK'S ANSWER IS THE OPPOSITE ONE. A declared set here must exist
// and must be EMPTY of pixels. A PNG committed into the template is a
// placeholder by construction — nobody photographed an app that does not exist —
// and it would be stamped into every app at once while satisfying exactly the
// check ("the tablet directory has pixels") that is meant to prove the frames
// were captured. A listing that cannot be published yet and says why is strictly
// better than one that can be published carrying fake frames.
//
// What makes the directory exist in a clone at all is its `README.md`, since git
// cannot commit an empty directory — which is precisely how the gap arose. So
// the README is required, and its absence means the directory is absent means a
// stamped app is short a device type again.
//
// The floors are PER ROOT, never a union: `tooling/ci/assert-workspace-coverage
// .mjs:130-136` records a union floor staying satisfied over an emptied `apps/`,
// and today a guard printed ok over 7 files when it should have seen 349 because
// a root fell off a list and every limb watched only for an EMPTIED root, never
// an UNLISTED one. Root 2 therefore has its own COVERAGE LOST, and which branch
// it took is PRINTED on every run rather than implied. Shape borrowed from
// `assert-no-tls-pinning.mjs:94-175`.
//
// ── THE PRINT/FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ───────────────────────
//   ("short of the minimum" below covers every kind of gap: too few device types,
//    a set whose pixels miss its own declared count/size/aspect rule, and a
//    declared set that holds nothing while siblings satisfy the union floor.)
//   short of the minimum, channel `served: false`   -> PRINT   (this is today)
//   short of the minimum, channel `served: true`    -> FAIL
//   short of the minimum, `--for-submission`        -> FAIL    (the submit lane)
//   a declared set's directory missing entirely     -> FAIL (a declaration with
//       no directory is a coverage claim over nothing, at any served state)
//   the declaration itself absent or unsourced      -> COVERAGE LOST
//
//   ROOT 2 IS NOT ROUTED THROUGH THAT SPLIT, DELIBERATELY:
//   a declared set missing from the BRICK           -> FAIL, any served state
//   a PNG committed into a BRICK set                -> FAIL, any served state
//   a BRICK set with no README.md                   -> FAIL, any served state
//   the brick's store tree for the channel absent   -> COVERAGE LOST
//   `served` is a fact about ONE listing's readiness; the factory's ability to
//   emit a publishable listing is not that fact, and waiting for the channel to
//   be served would be waiting for the rejection. Same reasoning as
//   `assert-store-metadata.mjs`'s "THE FACTORY" limb, which fails outright.
//
// `--for-submission` is what makes this a per-environment gate rather than a
// note. `.github/workflows/ci.yml` runs it plain, where the gap prints and the
// build stays green; `.github/workflows/submit-play.yml` runs it with the flag,
// where the same gap is fatal — because that is the moment it stops being a gap
// and becomes a rejected upload. Same guard, same numbers, one lane that cares.
//
// ── EVERY NUMBER IS THE REGISTER'S ───────────────────────────────────────────
// `minDistinctTypes` and the directory of each set are read from the register,
// never declared here, for the same reason `assert-listing-assets.mjs` reads its
// dimensions from there: a private copy would be the second declaration and the
// first to drift. A `deviceTypeCoverage` block that arrives WITHOUT a `source`
// is COVERAGE LOST rather than enforced — an invented limit fires on correct
// input, and this repo has already rejected its own fixture at 129 characters
// against a made-up "120 or fewer".
//
// ── ⚠️ WHAT IT CANNOT SEE ────────────────────────────────────────────────────
// Whether the pixels in `screenshots-tablet-10/` really came off a 10-inch
// tablet. Nothing in a PNG says so, and the guard says so out loud rather than
// implying a stronger claim: it reports which DECLARED SETS carry screenshots.
// A set is a promise about where a device type's shots live, kept by whoever
// captures them. What this removes is the failure that was actually present —
// a listing that satisfies every count while covering one device type. Sizes and
// counts are measured; what a frame SHOWS — posture, demo banner, which account
// — is assert-listing-assets.mjs's subject and is measured for no set here.
//
// Usage:  node tooling/ci/assert-play-device-coverage.mjs [--for-submission] [repoRoot]
// Exit 0 = every declared channel covers at least its minimum device types and
//          every set keeps its own declared rule, or falls short on a channel
//          that is not served yet and said so; AND the brick offers a directory
//          for every declared set, each empty of pixels and carrying its README.
// Exit 1 = a served or submitting channel is short, the brick cannot emit a
//          declared set or ships placeholder pixels, or a scan reached nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { pngHeader } from '../store/chrome-raster.mjs';

const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

// ── ROOT 2, addressed exactly as assert-store-metadata.mjs addresses it ──────
// One spelling of "the brick's copy of a per-app path" in the corpus, not two.
const BRICK = 'tooling/bricks/app';
const BRICK_APP_TOKEN = '{{app_id}}';
/** `apps/{app}/store/x` -> `tooling/bricks/app/__brick__/apps/{{app_id}}/store/x`. */
const brickPath = (perAppTemplate) => `${BRICK}/__brick__/${perAppTemplate.replace('{app}', BRICK_APP_TOKEN)}`;
/** The file that makes an intentionally-empty set directory exist in a clone. */
const SET_README = 'README.md';

const argv = process.argv.slice(2);
const FOR_SUBMISSION = argv.includes('--for-submission');
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/**
 * ROOT 2 is a path INSIDE this repository, so it means nothing over the
 * synthetic roots the unit tests build: those legitimately model one listing
 * tree at a time and carry no brick. The limb is therefore applied only when
 * ROOT is a real checkout, detected by THIS GUARD'S OWN FILE being present under
 * it — a sentinel that sits outside both subject roots and so survives any
 * mutation OF a subject, which a sentinel under `apps/` or `tooling/bricks/`
 * would not. Which branch was taken is PRINTED on every run: a limb that went
 * quiet must never be indistinguishable from a limb that found nothing.
 */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-play-device-coverage.mjs'));

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-play-device-coverage: FAILED');
  process.exit(1);
}

const readJson = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    coverageLost([
      `${rel} does not exist, so the subject set is derived from nothing.`,
      'Without it there is no declaration of how many device types a listing needs, and every listing below',
      'would satisfy a comparison against nothing.',
    ]);
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${rel} could not be parsed (${e.message}).`]);
  }
};

const register = readJson(REGISTER);
const apps = readJson(APPS);
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

const contract = register.storeMetadataContract;
if (contract === null || typeof contract !== 'object') coverageLost([`${REGISTER} declares no \`storeMetadataContract\`.`]);

const storeRows = (Array.isArray(register.channels) ? register.channels : []).filter((c) => c && c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([`${REGISTER} declares ZERO \`kind: "store"\` channels — there is no listing to have screenshots for.`]);
}

// Which store channels state a device-type requirement at all. A channel with
// none is not a failure — only Play's rule has been fetched — but if NO channel
// states one, this guard has nothing to enforce and must say so rather than pass.
const withCoverage = storeRows.filter((r) => contract.perChannel?.[r.id]?.graphicAssets?.screenshots?.deviceTypeCoverage);
if (withCoverage.length === 0) {
  coverageLost([
    `no \`kind: "store"\` channel in ${REGISTER} declares a \`screenshots.deviceTypeCoverage\` block.`,
    'That block IS the requirement. Without one, "the listing covers enough device types" has no right-hand',
    'side, and a listing carrying a single phone set satisfies every check below. If Play\'s block was removed,',
    'this guard did not become unnecessary — it became blind.',
  ]);
}

/** A file counts towards a device type only if it is a real PNG. `touch
 *  screenshots-tablet-10/x.png` must not buy coverage — that is the shape of
 *  every placeholder this corpus has had to remove, and the whole value of the
 *  check is that the directory cannot be satisfied by an empty gesture.
 *  The reader is `tooling/store/chrome-raster.mjs`'s, shared with
 *  assert-listing-assets.mjs, so no third idea of "what a PNG is" enters. */
function screenshotsIn(absDir) {
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) return null;
  const out = [];
  for (const n of listDir(absDir).filter((n) => n.toLowerCase().endsWith('.png')).sort()) {
    const h = pngHeader(readFileSync(join(absDir, n)));
    if (h !== null) out.push({ name: n, h }); // the header is kept rather than re-read, so the
  }                                           // rule below grades the same bytes that counted.
  return out;
}

const RULE_KEYS = ['minCount', 'minSide', 'maxSide', 'portraitAspect'];
const ruled = (def) => RULE_KEYS.some((k) => k in def);

const aspect = (v) => {
  const m = typeof v === 'string' ? /^(\d+):(\d+)$/.exec(v.trim()) : null;
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  return w > 0 && h > 0 ? { w, h } : null;
};

/** A set graded against ITS OWN declared rule. Every number is the register's and
 *  is reprinted with that row's `source`. Short side against minSide, long side
 *  against maxSide — assert-listing-assets.mjs's convention, so no second reading
 *  of Google's words enters. `portraitAspect` grades PORTRAIT frames only: a
 *  landscape frame has no declared aspect rule and is not given an invented one. */
function ruleGaps(type, def, rel, found) {
  const out = [];
  const cite = typeof def.source === 'string' ? ` Source: ${def.source}` : '';
  if (Number.isInteger(def.minCount) && found.length < def.minCount) {
    out.push(`set "${type}" (${rel}) holds ${found.length} screenshot(s) and the register declares minCount ${def.minCount} for it.${cite}`);
  }
  const ar = aspect(def.portraitAspect);
  for (const { name, h } of found) {
    const at = `${rel}/${name} is ${h.width}x${h.height}`;
    if (Number.isInteger(def.minSide) && Math.min(h.width, h.height) < def.minSide) {
      out.push(`${at} and set "${type}" declares minSide ${def.minSide}px.${cite}`);
    }
    if (Number.isInteger(def.maxSide) && Math.max(h.width, h.height) > def.maxSide) {
      out.push(`${at} and set "${type}" declares maxSide ${def.maxSide}px.${cite}`);
    }
    if (ar && h.height > h.width && h.width * ar.h !== h.height * ar.w) {
      out.push(`${at} — portrait — and set "${type}" declares portraitAspect ${def.portraitAspect}.${cite}`);
    }
  }
  return out;
}

// ROOT 1 counters.
let treesSeen = 0;
let channelsChecked = 0;
let setsMeasured = 0;
let ruledSets = 0;
let framesGraded = 0;

// ROOT 2 counters, kept SEPARATE from root 1's on purpose. A union count is
// satisfied by one healthy root while the other is gone, which is the exact
// shape of the failure this root was added to remove.
let brickTreesSeen = 0;
let brickSetsDeclared = 0; // sets root 2 OUGHT to have looked for — the floor
let brickSetsExamined = 0; // sets root 2 ACTUALLY looked for, present or not
let brickSetsKept = 0;     // present, empty of pixels, and carrying their README

for (const row of withCoverage) {
  const g = contract.perChannel[row.id].graphicAssets;
  const shots = g.screenshots;
  const cov = shots.deviceTypeCoverage;
  const where = `storeMetadataContract.perChannel["${row.id}"].graphicAssets.screenshots.deviceTypeCoverage`;

  if (typeof cov.source !== 'string' || cov.source.trim() === '') {
    coverageLost([
      `${where} declares a device-type minimum with no \`source\`.`,
      'A limit that arrives without its citation cannot be re-checked later, and this guard would then be',
      "enforcing somebody's memory. Same rule as every dimension in `graphicAssets.assets`.",
    ]);
  }
  const min = cov.minDistinctTypes;
  if (!Number.isInteger(min) || min < 1) {
    coverageLost([`${where}.minDistinctTypes is ${JSON.stringify(min ?? null)}, not a positive integer.`]);
  }
  const sets = cov.sets;
  if (sets === null || typeof sets !== 'object' || Array.isArray(sets) || Object.keys(sets).length === 0) {
    coverageLost([
      `${where}.sets is empty or is not an object.`,
      'The set map is what names the device types and where their screenshots live. With it empty, zero',
      'directories are examined and the minimum ranges over nothing.',
    ]);
  }

  // A limit that cannot be read still LOOKS declared while grading nothing, which
  // is the shape of every check in this corpus that passed for an unverified
  // reason. An unreadable one is COVERAGE LOST, never a silently skipped rule.
  for (const [type, def] of Object.entries(sets)) {
    if (!def || typeof def !== 'object') continue;
    if (ruled(def) && (typeof def.source !== 'string' || def.source.trim() === '')) {
      coverageLost([
        `${where}.sets["${type}"] declares a dimension rule with no \`source\`.`,
        'The rule the channel-level minimum is held to, applied to a per-set one: an uncited limit cannot be',
        're-checked later, so enforcing it would be this guard grading against somebody\'s memory.',
      ]);
    }
    for (const k of ['minCount', 'minSide', 'maxSide']) {
      if (k in def && !(Number.isInteger(def[k]) && def[k] > 0)) {
        coverageLost([`${where}.sets["${type}"].${k} is ${JSON.stringify(def[k])}, not a positive integer, so a declared limit would grade nothing.`]);
      }
    }
    if ('portraitAspect' in def && aspect(def.portraitAspect) === null) {
      coverageLost([`${where}.sets["${type}"].portraitAspect is ${JSON.stringify(def.portraitAspect)}, not "W:H" in positive integers, so a declared limit would grade nothing.`]);
    }
    if (ruled(def)) ruledSets++;
    // ROOT 2's floor is counted HERE, from the register, and not inside the
    // brick loop below — a floor produced by the same code it grades is the
    // counter marking its own homework, which is the defect
    // assert-case-count-honest.mjs exists for.
    brickSetsDeclared++;
  }

  // 🔴 THE TWO DECLARATIONS OF WHERE THE PHONE SET LIVES MUST AGREE.
  // `screenshots.dir` is what assert-listing-assets.mjs measures; `sets.<type>
  // .dir` is what this guard counts. If they drift, one guard grades a directory
  // the other has never heard of and both go on printing ok.
  const naming = Object.entries(sets).filter(([, v]) => v && v.dir === shots.dir);
  if (naming.length !== 1) {
    problems.push(
      `channel "${row.id}": \`screenshots.dir\` is ${JSON.stringify(shots.dir)} and ${naming.length} declared set(s) name it ` +
        `(${naming.map(([k]) => k).join(', ') || 'none'}). Exactly one must, or assert-listing-assets.mjs and this guard are ` +
        'grading different directories while both report ok.',
    );
  }

  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) {
    coverageLost([
      `channel "${row.id}" declares \`deviceTypeCoverage\` but has no \`storeMetadataDir\` template, so it contributes`,
      'ZERO expected directories and every check for it ranges over nothing.',
    ]);
  }

  for (const app of apps) {
    const dir = template.replace('{app}', app.slug);
    if (!existsSync(join(ROOT, dir)) || !statSync(join(ROOT, dir)).isDirectory()) {
      prints.push(`NO TREE: ${dir} — app "${app.slug}" has no metadata tree for channel "${row.id}". assert-store-metadata.mjs owns that verdict.`);
      continue;
    }
    treesSeen++;
    channelsChecked++;

    // One relationship for every kind of gap this guard finds: printed while the
    // channel is unserved, fatal when it is served or when this is the submit lane.
    const route = (kind, why) => {
      if (FOR_SUBMISSION) problems.push(`SUBMITTING and ${why}`);
      else if (row.served === true) problems.push(`channel "${row.id}" is SERVED and ${why}`);
      else prints.push(`${kind} (channel not served yet, OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}): ${why} ` +
        'This PRINTS here and is FATAL on the submission lane, which runs this guard with --for-submission.');
    };

    const covered = [];
    const empty = [];
    const gaps = [];
    const bare = [];
    for (const [type, def] of Object.entries(sets)) {
      if (!def || typeof def.dir !== 'string' || def.dir.trim() === '') {
        problems.push(`${where}.sets["${type}"] declares no \`dir\`, so there is no directory to count.`);
        continue;
      }
      setsMeasured++;
      const rel = `${dir}/${def.dir}`;
      const found = screenshotsIn(join(ROOT, dir, def.dir));
      if (found === null) {
        // A declared set with no directory is a coverage claim over nothing, and
        // it fails whatever the channel's served state is: the register is
        // asserting a device type this tree cannot produce.
        problems.push(
          `${rel} does not exist, and \`${where}.sets["${type}"]\` declares it. A device type named in the register ` +
            'with no directory behind it is a claim this tree cannot keep — either capture the set or remove the row.',
        );
        continue;
      }
      // A set is graded against its own declared rule whether or not it holds
      // files. `continue` stood here, so `ruleGaps` only ever saw a non-empty
      // set and a declared `minCount` could not fire on the set holding nothing.
      // The type floor below is a UNION: two siblings can satisfy it between
      // them while a third row's emptiness stays a print.
      if (found.length === 0) {
        empty.push(`${type} (${rel})`);
        // A row declaring no count has no number to miss, and is still a device
        // type the register names and this tree shows no pixels for.
        if (!Number.isInteger(def.minCount)) {
          bare.push(`set "${type}" (${rel}) is declared and holds no screenshot, so the register names a device type this listing does not cover.`);
        }
      } else {
        covered.push(`${type} (${found.length})`);
      }
      if (ruled(def)) framesGraded += found.length;
      gaps.push(...ruleGaps(type, def, rel, found));
    }

    if (covered.length < min) {
      const why =
        `app "${app.slug}" channel "${row.id}" covers ${covered.length} device type(s) — ${covered.join(', ') || 'none'}` +
        `${empty.length ? `; declared but empty: ${empty.join(', ')}` : ''} — and Play requires at least ${min} ACROSS ` +
        `DIFFERENT DEVICE TYPES. Every individual screenshot passes; the set spans too few types. ` +
        `Add a set to \`${where}.sets\` and capture into it. Source: ${cov.source}`;
      route('DEVICE-TYPE SHORTFALL', why);
    }
    for (const g of gaps) route('SET RULE SHORTFALL', g);
    for (const b of bare) route('EMPTY DECLARED SET', b);
  }

  // ── ROOT 2: THE FACTORY ────────────────────────────────────────────────────
  // Same register, same `sets`, opposite expectation: the brick must OFFER every
  // declared device type and must SUPPLY pixels for none of them.
  if (IS_FULL_CHECKOUT) {
    const brickDir = brickPath(template);
    if (!existsSync(join(ROOT, brickDir)) || !statSync(join(ROOT, brickDir)).isDirectory()) {
      coverageLost([
        `${brickDir} does not exist, so channel "${row.id}"'s device types were checked on registered apps ONLY.`,
        `${apps.length} registered app(s) is not the subject: the brick is what every future app is stamped from, and a`,
        'template that emits no store tree emits no device-type sets either. A root that is never DERIVED must not read',
        'as "nothing to check" — that is how this guard printed ok over a brick with no tablet set for two weeks.',
        'If the brick genuinely no longer emits this channel, assert-store-metadata.mjs owns that verdict and fails too.',
      ]);
    }
    brickTreesSeen++;

    for (const [type, def] of Object.entries(sets)) {
      if (!def || typeof def.dir !== 'string' || def.dir.trim() === '') continue; // counted, not examined — the floor below catches it
      const rel = `${brickDir}/${def.dir}`;
      const found = screenshotsIn(join(ROOT, brickDir, def.dir));
      brickSetsExamined++;

      if (found === null) {
        problems.push(
          `THE BRICK EMITS NO "${type}" SET: ${rel} does not exist, and \`${where}.sets["${type}"]\` declares it. Every app ` +
            `stamped from this template is therefore born covering fewer than the ${min} device type(s) Play requires — ` +
            'unpublishable on day one, with nothing to tell anyone until the console rejects the upload. Stamp the ' +
            `directory with a README.md stating the obligation (git cannot commit an empty one). Source: ${cov.source}`,
        );
        continue;
      }

      // 🔴 THE ONE PLACE IN THIS GUARD WHERE PIXELS ARE A FAILURE.
      if (found.length > 0) {
        problems.push(
          `${rel} holds ${found.length} PNG(s) (${found.map((f) => f.name).join(', ')}), and it is the TEMPLATE. Nobody ` +
            'photographed an app that does not exist yet, so a screenshot committed here is a placeholder by construction — ' +
            'stamped into every app at once, and satisfying the very check ("the set carries pixels") that is supposed to ' +
            'prove the frames were captured. A listing that cannot be published yet and says why is strictly better than ' +
            'one that can be published carrying fake frames. Delete them; capture into the stamped app instead.',
        );
      }

      if (!existsSync(join(ROOT, brickDir, def.dir, SET_README))) {
        problems.push(
          `${rel}/${SET_README} is missing. It is the only file in an intentionally-empty set directory, and git cannot ` +
            'commit an empty directory — so without it the directory does not survive a clone, the stamped app is short ' +
            `device type "${type}" again, and the person who has to capture the frames is never told the obligation. ` +
            'That is not a tidiness rule: it is the mechanism by which this set went missing in the first place.',
        );
      } else if (found.length === 0) {
        brickSetsKept++;
      }
    }
  }
}

// ── ROOT 2's OWN FLOOR ───────────────────────────────────────────────────────
// Never folded into root 1's. `assert-workspace-coverage.mjs:130-136` records a
// union floor staying satisfied over an emptied `apps/`, and every limb that
// watched only for an EMPTIED root missed the day a root went UNLISTED.
if (IS_FULL_CHECKOUT) {
  if (brickSetsExamined === 0) {
    coverageLost([
      `${brickTreesSeen} brick store tree(s) were read and ZERO device-type sets were looked for in the template.`,
      'Root 1 can be perfectly green while this is true — it was, for two weeks — because a hand-fixed registered app',
      'says nothing about the factory. Zero sets examined means the brick was not graded at all.',
    ]);
  }
  if (brickSetsExamined !== brickSetsDeclared) {
    coverageLost([
      `the register declares ${brickSetsDeclared} device-type set row(s) and the brick limb examined ${brickSetsExamined}.`,
      'The two numbers are counted by different code over the same register — the floor by the row validator above, the',
      'other by the brick walk itself — precisely so a walk that quietly skips a row cannot also lower its own floor.',
      'A declared set the factory check never looked for is a device type nobody is watching in the template, which is',
      'indistinguishable from the template being correct. A row naming no `dir` is the way this happens.',
    ]);
  }
}

if (treesSeen === 0) {
  coverageLost([
    `${apps.length} app(s) × ${withCoverage.length} declaring channel(s) produced ZERO metadata trees to read.`,
    'A scan that reached nothing prints the same thing as a scan that found nothing wrong.',
  ]);
}
if (setsMeasured === 0) {
  coverageLost([
    `${treesSeen} tree(s) were read and ZERO device-type sets were measured.`,
    'The declaration exists but named no directory, so the minimum was compared against nothing.',
  ]);
}

if (prints.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const p of prints) console.log(`    ${p}`);
}

if (problems.length) {
  console.error('');
  console.error(`✗ play device coverage — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline D-5] Google files a screenshot by the console slot it was uploaded to, so the device');
  console.error('  type is declared in tooling/channel-register.json and counted here. No PNG can answer this.');
  console.error('\nassert-play-device-coverage: FAILED');
  process.exit(1);
}

console.log(
  `ok  play device coverage — ROOT 1 (registered apps): ${channelsChecked} (app × channel) listing(s) across ` +
    `${treesSeen} tree(s); ${setsMeasured} declared device-type set(s) measured, ${framesGraded} screenshot(s) graded ` +
    `against the ${ruledSets} set(s) that declare a rule${FOR_SUBMISSION ? '; --for-submission, so a shortfall would have been fatal' : ''}`,
);
console.log(
  IS_FULL_CHECKOUT
    ? `    ROOT 2 (the factory): ${brickTreesSeen} brick store tree(s) under ${BRICK}; ${brickSetsExamined} of ` +
      `${brickSetsDeclared} declared set(s) examined, ${brickSetsKept} present, empty of pixels and carrying their ` +
      `${SET_README} — so an app stamped today is born offering every declared device type and inventing none.`
    : '    ROOT 2 (the factory): NOT APPLIED — this root is not a checkout of this repository, so there is no ' +
      `${BRICK} to grade. Only the registered-app root above was checked.`,
);
console.log('   ⚠️ CANNOT SEE: whether the pixels in a set really came off that device type. A set is a promise');
console.log('      about where a type\'s shots live; this counts the sets that are kept. And in the brick it can only');
console.log('      see that the set is OFFERED and UNFILLED — whether anyone ever captures into it is root 1\'s question.');
