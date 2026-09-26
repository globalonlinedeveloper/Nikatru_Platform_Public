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
//   2. 🔴 EVERY ONE OF THOSE CHECKS RAN AS `--app subscriptiontracker`, HARDCODED IN ci.yml.
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
//   subjects = { every app in catalog/apps.json }
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
// ── ⏱ 2026-09-11 — THE SNAP NAME, AND THE NAME THIS PORTFOLIO RETIRED ─────────
// REVIEW-stores-2026-09-10 #7: snap-name.txt was shape-checked only, so any
// lowercase-hyphen string passed — `subly` included — while the Snap Store binds
// the name at `snapcraft register` and never lets it go. Two limbs, both data-led:
//   · a register row with a `snapName` block has its file compared to the
//     block's derivation (param-case of app.yaml `name`), exactly;
//   · every `retiredIdentityTokens` token is refused, case- and separator-
//     insensitively, in every snap name AND every store identity this guard
//     resolves. An absent token list is COVERAGE LOST: an empty deny-list
//     refuses nothing and reads exactly like a clean tree.
//
// ── ⏱ 2026-09-11 — WINDOWS JOINS, AND ITS EXPECTED VALUE IS NOT THE SLUG ─────
// REVIEW-stores-2026-09-10 #3: the windows-store row had no `identity` block, so
// this guard never saw Windows, and submit-windows-store.mjs treated an identity
// that was ENTIRELY `PARTNER-CENTER-PENDING` as a print — `--submit` would have
// uploaded under the placeholder. An MSIX Package/Identity/Name is ASSIGNED by
// Partner Center, so a row may now say `expectedFrom: "packageIdentity.identityName"`
// and the expected value is read from that register field instead of derived.
// While that value is the row's declared placeholder, this guard:
//   · PRINTS the owner-gated gap (the account step is owner work, not a defect);
//   · FAILS if the row says `served: true` — a served channel under a placeholder;
//   · RUNS the row's `submission.script --submit` with no credentials in its
//     environment and FAILS unless it exits non-zero naming the placeholder refusal.
//     No credentials means it cannot authenticate even if the refusal were gone, and
//     every check that talks to GitHub or Microsoft sits after the problems block
//     that exits — so this proves the refusal without being able to submit anything.
//
// ⏱ 2026-09-25 — O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). "that register field"
// above was ONE value for every app, so a second app packaging the first app's
// identity agreed with it. The row now says
// `expectedFrom: "apps/{app}/app.yaml stores.windows-store.identityName"`: the
// expected value is the record of the app being graded, read through
// read-identity.mjs windowsIdentityOf. The sentinel and the placeholder stay the
// row's, because they define the placeholder for every app.
//
// Usage:  node tooling/ci/assert-store-identity.mjs [repoRoot]
// Exit 0 = every app × declared platform resolves to the one canonical id.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIdentity, windowsIdentityOf, WINDOWS_STORE } from './read-identity.mjs';
import { appIdProblems } from '../../contracts/app-id/app-id.js';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_REL = 'catalog/apps.json';

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

/** The one `expectedFrom` this guard reads: the identity Partner Center issued
 *  to THE APP BEING GRADED, from its own declaration. */
const APP_RECORD_FIELD = `apps/{app}/app.yaml stores.${WINDOWS_STORE}.identityName`;

/** What a row's identity must equal. The default is the canonical form; a row
 *  whose identity is ASSIGNED by the store (MSIX) names the per-app record that
 *  holds it instead. An `expectedFrom` this guard cannot read is COVERAGE LOST,
 *  never a silent fall-back to the canonical form. */
function expectationFor(row, slug) {
  const from = row.identity.expectedFrom;
  if (from === undefined) return { want: canonical(slug), label: "architecture §24's canonical form" };
  if (from !== APP_RECORD_FIELD) {
    return { lost: `channel "${row.id}" identity.expectedFrom is ${JSON.stringify(from)}; the only field this guard knows how to read is "${APP_RECORD_FIELD}".` };
  }
  const pi = row.packageIdentity;
  if (!pi || typeof pi.notYetConfiguredSentinel !== 'string' || pi.notYetConfiguredSentinel === '') {
    return { lost: `channel "${row.id}" declares no packageIdentity.notYetConfiguredSentinel, so a placeholder cannot be told from a real Partner Center value.` };
  }
  if (row.identity.placeholderValue !== pi.notYetConfiguredSentinel) {
    return {
      problem:
        `channel "${row.id}" identity.placeholderValue is ${JSON.stringify(row.identity.placeholderValue ?? null)} and ` +
        `packageIdentity.notYetConfiguredSentinel is ${JSON.stringify(pi.notYetConfiguredSentinel)}. The marked placeholder and the ` +
        'sentinel the submitter refuses must be ONE string, or a value can be "not the placeholder" to one reader and "the placeholder" to the other.',
    };
  }
  const record = windowsIdentityOf(ROOT, slug);
  if (record.missing) return { problem: record.missing };
  if (!record.value) {
    return {
      problem:
        `${record.rel} declares no stores.${WINDOWS_STORE} record, and it is the one declaration of the identity Partner Center ` +
        `issued this app. An app with no Partner Center product yet declares ${pi.notYetConfiguredSentinel} in both of its fields.`,
    };
  }
  return {
    want: record.value.identityName,
    label: `${record.rel} stores.${WINDOWS_STORE}.identityName`,
    declaredIn: record.rel,
    sentinel: pi.notYetConfiguredSentinel,
  };
}

/** Run the channel's own submitter with `--submit` and NO credentials, and
 *  require it to refuse the placeholder by name. Returns a problem string or null. */
function submitRefusesPlaceholder(row, slug) {
  const script = row.submission?.script;
  if (typeof script !== 'string' || script === '') {
    return `channel "${row.id}" packages the placeholder identity and declares no submission.script, so nothing proves a submit refuses it.`;
  }
  const abs = join(ROOT, script);
  if (!existsSync(abs)) {
    return `channel "${row.id}" names submission.script ${script}, which does not exist, so nothing proves a submit refuses the placeholder.`;
  }
  // The environment is BUILT, not inherited minus a list: a credential this guard
  // did not think to blank would otherwise travel into a `--submit` run.
  const env = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  const r = spawnSync(process.execPath, [abs, '--submit', '--app', slug, '--allow-missing-artifact', '--repo-root', ROOT], {
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 && out.includes('PLACEHOLDER PACKAGE IDENTITY — --submit REFUSED')) return null;
  const tail = out.trim().split(/\r?\n/).slice(-12).join(' ⏎ ');
  return (
    `channel "${row.id}": app "${slug}" still packages the placeholder identity and ${script} --submit did NOT refuse it by name ` +
    `(exit ${r.status ?? r.error?.code ?? 'none'}). A placeholder identity must be a refusal before anything is uploaded. Output tail: ${tail}`
  );
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-identity: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
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

// ⏱ 2026-09-11 — THE CLASS, NOT THE INSTANCE. The subject set above is "rows that
// declare an `identity` block", so a store row that declares none is not compared
// AND not reported — which is exactly how windows-store sat outside [10]D-3 until
// today (REVIEW-stores-2026-09-10 #3). A `kind: "store"` row for a native platform
// with no block is therefore a FAILURE by name. Browser-extension stores are not
// native platforms here (their ids live in tool.json), and `direct` channels bind
// no store record.
for (const r of rows) {
  if (r?.kind !== 'store' || (r.identity && typeof r.identity === 'object')) continue;
  const native = (r.platforms ?? []).filter((p) => PLATFORM_DIR.has(p));
  if (native.length === 0) continue;
  problems.push(
    `channel "${r.id}" is a store for ${native.join(', ')} and declares no \`identity\` block in ${REGISTER_REL}, so this guard ` +
      'never compares the identity it would submit under — and says nothing about not comparing it. That is the exact shape ' +
      'windows-store was in until 2026-09-11. Declare the block (kind + declaredIn, and expectedFrom when the store assigns the value).',
  );
}

/** The token list is the register's; a guard-side copy would be a second list to forget. */
const retiredTokens = Array.isArray(register.retiredIdentityTokens?.tokens)
  ? register.retiredIdentityTokens.tokens.filter((t) => typeof t === 'string' && t.trim() !== '')
  : [];
if (retiredTokens.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`retiredIdentityTokens.tokens\`.`,
    'The retired-name limb refuses a token in every store identity and snap name; with no tokens it refuses',
    'nothing, and a retired name binding a store record forever would read exactly like a clean tree.',
  ]);
}
const squash = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
/** The retired token a value carries in ANY case or separator form, or null. */
const retiredIn = (value) => retiredTokens.find((t) => squash(value).includes(squash(t))) ?? null;

/** param-case: diacritics folded, every run of non-alphanumerics one hyphen, none at the ends. */
const paramCase = (v) =>
  String(v)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

let checked = 0;
let skippedNoFolder = 0;

for (const app of apps) {
  const slug = typeof app?.slug === 'string' ? app.slug : null;
  if (!slug) {
    problems.push(`${APPS_REL} carries an entry with no \`slug\`, so no identity can be resolved for it.`);
    continue;
  }
  // The slug IS the app id, and `com.nikatru.<slug>` is bound by every store for
  // good at the first upload — so the slug meets contracts/app-id before any
  // identity is built from it (O-APP-ID-FORM-UNVALIDATED (a)).
  const idProblems = appIdProblems(slug);
  if (idProblems.length > 0) {
    for (const p of idProblems) {
      problems.push(`${APPS_REL}[${apps.indexOf(app)}] slug "${slug}": ${p} No store identity is derived from it.`);
    }
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
      const exp = expectationFor(row, slug);
      if (exp.lost) coverageLost([`${at}: ${exp.lost}`]);
      if (exp.problem) {
        problems.push(`${at}: ${exp.problem}`);
        continue;
      }
      const want = exp.want;
      if (exp.sentinel !== undefined) {
        if (r.value !== want) {
          problems.push(
            `${at}: ${r.rel} declares "${r.value}" and ${exp.label} is "${want}". The app's record is the one declaration of the ` +
              'identity the store issued it; the pubspec is what gets packaged. Two answers means the wrong one ships.',
          );
          continue;
        }
        if (String(r.value).includes(exp.sentinel)) {
          if (row.served === true) {
            problems.push(
              `${at}: the row says served: true and ${r.rel} still packages the placeholder "${r.value}". A served channel ` +
                'under a placeholder identity is a store listing no product owns.',
            );
            continue;
          }
          const refusal = submitRefusesPlaceholder(row, slug);
          if (refusal) {
            problems.push(`${at}: ${refusal}`);
            continue;
          }
          // ⏱ 2026-09-25 (D3a): an open account's closed item is `accountStatus.openedBy`.
          const owner = row.ownerQueue ?? (row.accountStatus?.openedBy ? `owner; account opened by ${row.accountStatus.openedBy}` : 'owner');
          prints.push(
            `OWNER-GATED (${owner}) · ${at}: the package identity is the placeholder "${r.value}" in both ${exp.declaredIn} ` +
              `and ${r.rel}. ${row.submission.script} --submit REFUSES it (run here with no credentials, exit non-zero, refusal named), ` +
              'so it cannot reach a store upload. It stops printing when Partner Center\'s real values land in both files.',
          );
        }
        continue;
      }
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

// ── the retired tokens, over every identity resolved above ──────────────────
// A second pass rather than a line inside the comparison loop, so the refusal is
// independent of which expected value a row compares against.
let retiredChecked = 0;
for (const app of apps) {
  const slug = typeof app?.slug === 'string' ? app.slug : null;
  if (!slug || !existsSync(join(ROOT, 'apps', slug))) continue;
  for (const row of withIdentity) {
    for (const platform of row.platforms ?? []) {
      const dir = PLATFORM_DIR.get(platform);
      if (!dir || !existsSync(join(ROOT, 'apps', slug, dir))) continue;
      const r = resolveIdentity(ROOT, slug, row.identity);
      if (typeof r.value !== 'string') continue; // absence and loss were reported by the loop above
      retiredChecked++;
      const hit = retiredIn(r.value);
      if (hit) {
        problems.push(
          `app "${slug}" × channel "${row.id}" (${platform}): ${r.rel} declares "${r.value}", which carries the RETIRED token ` +
            `"${hit}" (${REGISTER_REL} retiredIdentityTokens). A store binds this string at the first upload; a retired name there ` +
            'is a second app forever, not a rename away from fixed.',
        );
      }
    }
  }
}

// ── the snap name: derived, exact, and never a retired token ────────────────
const snapRows = rows.filter((r) => r?.snapName && typeof r.snapName === 'object');
const SNAP_DERIVATION = 'param-case(apps/{app}/app.yaml name)';
let snapChecked = 0;
let snapEligible = 0;
const problemsBeforeSnap = problems.length;
for (const row of snapRows) {
  const decl = row.snapName;
  if (typeof decl.declaredIn !== 'string' || !decl.declaredIn.includes('{app}')) {
    coverageLost([`channel "${row.id}" snapName.declaredIn ${JSON.stringify(decl.declaredIn ?? null)} is not an "{app}" template, so it resolves for no app.`]);
  }
  if (decl.derivation !== SNAP_DERIVATION) {
    coverageLost([
      `channel "${row.id}" snapName.derivation is ${JSON.stringify(decl.derivation ?? null)}; the only derivation this guard implements is "${SNAP_DERIVATION}".`,
      'A derivation nobody implements is compared against nothing, which is the shape the snap name was unenforced in.',
    ]);
  }
  for (const app of apps) {
    const slug = typeof app?.slug === 'string' ? app.slug : null;
    if (!slug) continue;
    const built = (row.platforms ?? []).some((p) => PLATFORM_DIR.has(p) && existsSync(join(ROOT, 'apps', slug, PLATFORM_DIR.get(p))));
    if (!built) continue;
    snapEligible++;
    const at = `app "${slug}" × channel "${row.id}" (snap name)`;
    const fileRel = decl.declaredIn.replace('{app}', slug);
    if (!existsSync(join(ROOT, fileRel))) {
      problems.push(`${at}: the app is built for this channel's platform and ${fileRel} does not exist, so nothing states the GLOBAL name it would register.`);
      continue;
    }
    const lines = readFileSync(join(ROOT, fileRel), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length !== 1) {
      problems.push(`${at}: ${fileRel} holds ${lines.length} non-empty line(s). A snap has exactly one name; anything else means nobody decided.`);
      continue;
    }
    const snap = lines[0];
    const yamlRel = `apps/${slug}/app.yaml`;
    const yamlAbs = join(ROOT, yamlRel);
    const nameMatch = existsSync(yamlAbs) ? readFileSync(yamlAbs, 'utf8').match(/^name:[ \t]*(.+?)[ \t]*$/m) : null;
    const appName = nameMatch ? nameMatch[1].replace(/[ \t]+#.*$/, '').replace(/^['"]|['"]$/g, '').trim() : '';
    snapChecked++;
    const hit = retiredIn(snap);
    if (hit) {
      problems.push(
        `${at}: ${fileRel} is "${snap}", which carries the RETIRED token "${hit}". \`snapcraft register\` binds a snap name ` +
          'permanently and globally; this one must never be claimed.',
      );
    }
    if (appName === '') {
      problems.push(`${at}: ${yamlRel} declares no top-level \`name\`, so the snap name cannot be derived and "${snap}" is compared to nothing.`);
      continue;
    }
    const want = paramCase(appName);
    if (snap !== want) {
      problems.push(
        `${at}: ${fileRel} is "${snap}" and the derived snap name is "${want}" (${SNAP_DERIVATION}, from ${yamlRel} name ` +
          `${JSON.stringify(appName)}). A shape-valid name that is not the derived one registers a namespace nobody reviewed.`,
      );
    }
  }
}
// Only when nothing more specific was said: a missing or two-line file is already a named problem,
// and replacing it with "compared nothing" would send the fix to the wrong place.
if (snapRows.length > 0 && snapEligible > 0 && snapChecked === 0 && problems.length === problemsBeforeSnap) {
  coverageLost([`${snapEligible} app × snap-channel pair(s) were eligible and ZERO snap names were compared.`]);
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
  `ok  store identity — ${checked} (app × platform) identity(ies) compared to com.nikatru.<slug> (or the app's own store-issued record) across ` +
    `${apps.length} app(s) and ${withIdentity.length} identity-declaring channel(s); ${skippedNoFolder} pair(s) ` +
    'skipped for having no platform folder (a web-only app is not missing an Android package name)',
);
console.log(
  `ok  snap name — ${snapChecked} snap name(s) equal ${SNAP_DERIVATION}; retired token(s) ${retiredTokens.map((t) => JSON.stringify(t)).join(', ')} ` +
    `refused across ${retiredChecked} store identity(ies) and ${snapChecked} snap name(s)`,
);
