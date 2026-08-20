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
// ── THE PRINT/FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ───────────────────────
//   short of the minimum, channel `served: false`   -> PRINT   (this is today)
//   short of the minimum, channel `served: true`    -> FAIL
//   short of the minimum, `--for-submission`        -> FAIL    (the submit lane)
//   a declared set's directory missing entirely     -> FAIL (a declaration with
//       no directory is a coverage claim over nothing, at any served state)
//   the declaration itself absent or unsourced      -> COVERAGE LOST
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
// a listing that satisfies every count while covering one device type.
//
// Usage:  node tooling/ci/assert-play-device-coverage.mjs [--for-submission] [repoRoot]
// Exit 0 = every declared channel covers at least its minimum device types, or
//          falls short on a channel that is not served yet and said so.
// Exit 1 = a served or submitting channel is short, or the scan reached nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { pngHeader } from '../store/chrome-raster.mjs';

const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

const argv = process.argv.slice(2);
const FOR_SUBMISSION = argv.includes('--for-submission');
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

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
  const names = listDir(absDir).filter((n) => n.toLowerCase().endsWith('.png')).sort();
  return names.filter((n) => pngHeader(readFileSync(join(absDir, n))) !== null);
}

let treesSeen = 0;
let channelsChecked = 0;
let setsMeasured = 0;

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

    const covered = [];
    const empty = [];
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
      if (found.length === 0) empty.push(`${type} (${rel})`);
      else covered.push(`${type} (${found.length})`);
    }

    if (covered.length < min) {
      const why =
        `app "${app.slug}" channel "${row.id}" covers ${covered.length} device type(s) — ${covered.join(', ') || 'none'}` +
        `${empty.length ? `; declared but empty: ${empty.join(', ')}` : ''} — and Play requires at least ${min} ACROSS ` +
        `DIFFERENT DEVICE TYPES. Every individual screenshot passes; the set spans too few types. ` +
        `Add a set to \`${where}.sets\` and capture into it. Source: ${cov.source}`;
      if (FOR_SUBMISSION) {
        problems.push(`SUBMITTING and ${why}`);
      } else if (row.served === true) {
        problems.push(`channel "${row.id}" is SERVED and ${why}`);
      } else {
        prints.push(
          `DEVICE-TYPE SHORTFALL (channel not served yet, OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}): ${why} ` +
            'This PRINTS here and is FATAL on the submission lane, which runs this guard with --for-submission.',
        );
      }
    }
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
  `ok  play device coverage — ${channelsChecked} (app × channel) listing(s) across ${treesSeen} tree(s); ` +
    `${setsMeasured} declared device-type set(s) measured${FOR_SUBMISSION ? '; --for-submission, so a shortfall would have been fatal' : ''}`,
);
console.log('   ⚠️ CANNOT SEE: whether the pixels in a set really came off that device type. A set is a promise');
console.log('      about where a type\'s shots live; this counts the sets that are kept.');
