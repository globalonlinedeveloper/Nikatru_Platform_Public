#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-identity.mjs — one `app_id` derives every store identity, on
// every platform, for every app.
//
// [pipeline 10]D-3 "One app_id derives every store identity."
//
// ── WHAT WAS ACTUALLY WRONG, AND IT IS NOT WHAT IT LOOKS LIKE ────────────────
// Three identity checks already existed, and each was real: submit-play.mjs
// compared `applicationId` to `com.nikatru.<slug>`, submit-appstore.mjs
// compared the register's `bundleIdentifier` to the Xcode project, and
// assert-store-metadata.mjs compared the register's MSIX `packageIdentity` to
// pubspec's `msix_config`. Three holes:
//
//   1. 🔴 LINUX WAS COMPARED BY NOTHING. `set(APPLICATION_ID "…")` in
//      apps/*/linux/CMakeLists.txt is the id GTK registers the app under and
//      the id a .desktop entry and a Snap must agree with. No check in this
//      repository read it.
//   2. 🔴 EVERY ONE OF THOSE CHECKS RAN AS `--app subly`, HARDCODED IN ci.yml.
//      App #2 would be invisible to all of them on the day it is stamped, and
//      nothing would say so — the coverage-shrink pattern this repo has paid
//      for repeatedly.
//   3. 🔴 ABSENCE READ AS AGREEMENT. This is the sharpest one. Windows was
//      GREEN ON HAVING NO IDENTITY AT ALL: a check that resolves a declared
//      value and finds nothing, then compares nothing to nothing, agrees. So a
//      declared platform whose identity file yields no identity is
//      **COVERAGE LOST**, not a pass.
//
// ── THE RELATIONSHIP, WHICH IS WHAT MAKES IT GROW BY ITSELF ──────────────────
//   subjects = { every app in sites/_shared/_data/apps.json }
//            × { every register row that declares an `identity` block }
//   restricted to pairs where the app HAS that platform's folder — a web-only
//   app is not failing to declare an Android package name, it has no Android.
//
// Both sides are already-maintained files, so a new app or a new channel
// acquires coverage by existing. There is no list in this guard to fall behind.
//
// The expected value is `com.nikatru.<slug>` — architecture §24's canonical
// form. It is the SAME string on every platform on purpose: Play, App Store
// Connect and the Snap Store each bind their record to it permanently, and
// three platforms disagreeing is three apps.
//
// The READERS are shared with the two submission scripts
// (tooling/ci/read-identity.mjs). A second implementation would inherit none of
// their tests, and a duplicated identity reader fails by reporting agreement
// between two things it read wrongly.
//
// Usage:  node tooling/ci/assert-store-identity.mjs [repoRoot]
// Exit 0 = every app × declared platform resolves to the one canonical id.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIdentity } from './read-identity.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_REL = 'sites/_shared/_data/apps.json';

/** architecture §24's canonical identity form. ONE string per app, on every
 *  platform: each store binds its record to it permanently, so three platforms
 *  disagreeing is three apps that can never be merged. */
const canonical = (slug) => `com.nikatru.${slug}`;

/** Which app folder must exist for a platform's identity to be expected. A
 *  web-only app is not failing to declare an Android package name. */
const PLATFORM_DIR = new Map([
  ['android', 'android'],
  ['ios', 'ios'],
  ['macos', 'macos'],
  ['linux', 'linux'],
  ['windows', 'windows'],
]);

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-identity: FAILED');
  process.exit(1);
}

const readJson = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) coverageLost([`${rel} does not exist, so the subject set is derived from nothing.`]);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${rel} could not be parsed (${e.message}).`]);
  }
};

const register = readJson(REGISTER_REL);
const apps = readJson(APPS_REL);

if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([
    `${APPS_REL} lists no app, so the identity check ranges over nothing.`,
    'A guard with no subjects prints "every identity agrees" over the empty set, which is true of every',
    'tree including one where the catalogue was emptied.',
  ]);
}
const rows = Array.isArray(register.channels) ? register.channels : [];
const withIdentity = rows.filter((r) => r?.identity && typeof r.identity === 'object');
if (withIdentity.length === 0) {
  coverageLost([
    `no row in ${REGISTER_REL} declares an \`identity\` block.`,
    'The platform side of the relationship is empty, so every app trivially satisfies it. This is the',
    'shape Windows was green on for weeks: having no identity read exactly like having the right one.',
  ]);
}

let checked = 0;
let skippedNoFolder = 0;

for (const app of apps) {
  const slug = typeof app?.slug === 'string' ? app.slug : null;
  if (!slug) {
    problems.push(`${APPS_REL} carries an entry with no \`slug\`, so no identity can be resolved for it.`);
    continue;
  }
  const appDir = join(ROOT, 'apps', slug);
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    // A catalogue entry with no app on disk is somebody else's problem
    // (assert-catalog-reachable / the DoD guard); say so rather than inventing
    // a verdict about an identity file that could not exist.
    prints.push(`${APPS_REL} lists "${slug}" and apps/${slug} is not on disk, so it has no identity files to compare.`);
    continue;
  }

  for (const row of withIdentity) {
    for (const platform of row.platforms ?? []) {
      const dir = PLATFORM_DIR.get(platform);
      if (!dir) continue; // `web` has no native identity, and that is not a gap
      const platformDir = join(appDir, dir);
      if (!existsSync(platformDir)) {
        skippedNoFolder++;
        continue;
      }

      const r = resolveIdentity(ROOT, slug, row.identity);
      const at = `app "${slug}" × channel "${row.id}" (${platform})`;

      if (r.absent) {
        problems.push(
          `${at}: apps/${slug}/${dir}/ exists but ${r.absent} does not. The platform folder is there, so this ` +
            'app IS built for it — and the file that declares what it is built AS is missing, which means ' +
            'nothing anywhere states the identity this channel would submit under.',
        );
        continue;
      }
      if (r.lost) {
        coverageLost([
          `${at}: ${r.lost}`,
          'A reader that finds nothing then compares nothing to nothing and agrees. That is the exact shape',
          'Windows was green on: having NO identity read the same as having the right one.',
        ]);
      }
      if (r.missing) {
        problems.push(`${at}: ${r.missing}`);
        continue;
      }

      checked++;
      const want = canonical(slug);
      if (r.value !== want) {
        problems.push(
          `${at}: ${r.rel} declares "${r.value}" and architecture §24's canonical form is "${want}". ` +
            'Every store binds its record to this string PERMANENTLY at first submission — Play at the ' +
            'first upload, App Store Connect at the first record, the Snap Store at `snapcraft register`. ' +
            'Two platforms disagreeing is two apps, with separate reviews, separate install counts and no ' +
            'way to merge them.',
        );
      }
    }
  }
}

if (checked === 0) {
  coverageLost([
    `${apps.length} app(s) × ${withIdentity.length} identity-declaring channel(s) produced ZERO comparisons.`,
    `${skippedNoFolder} pair(s) were skipped for having no platform folder. If that is all of them, the`,
    'relationship is real but empty — say so by declaring an identity for a platform an app actually has,',
    'never by letting this print "every identity agrees" over nothing.',
  ]);
}

if (problems.length) {
  console.error(`✗ store identity — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 10]D-3 — one app_id derives every store identity, on every platform.');
  console.error('  See the header of tooling/ci/assert-store-identity.mjs for the three holes it closes.');
  process.exit(1);
}

if (prints.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const p of prints) console.log(`    ${p}`);
}

console.log(
  `ok  store identity — ${checked} (app × platform) identity(ies) compared to com.nikatru.<slug> across ` +
    `${apps.length} app(s) and ${withIdentity.length} identity-declaring channel(s); ${skippedNoFolder} pair(s) ` +
    'skipped for having no platform folder (a web-only app is not missing an Android package name)',
);
