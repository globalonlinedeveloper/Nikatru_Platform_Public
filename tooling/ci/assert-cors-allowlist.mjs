#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-cors-allowlist.mjs — EVERY Worker's CORS allowlist is DERIVED from the
// app catalogue, and carries nothing the catalogue does not justify.
//
// Why this needs a guard at all: the owner chose an EXACT allowlist over suffix
// matching (2026-07-25). An exact list fails CLOSED and SILENTLY — drop an
// origin and that surface loses its browser callers with no server-side error,
// no failing request log, and nothing in CI. The middleware's own vitest suites
// cover BEHAVIOUR; this covers the deployed CONFIG, which lives in wrangler.jsonc
// and cannot be imported from a Worker test (that tsconfig deliberately exposes
// no node APIs).
//
// 🔴 THIS GUARD USED TO READ ONE FILE. `const WRANGLER =
// 'services/platform/wrangler.jsonc'` — hardcoded, with services/subly-api never
// opened, while tooling/capability-register.json claimed ALLOWED_ORIGINS was
// "guarded by assert-cors-allowlist.mjs" as if that covered the var generally.
// Mutation-proven 2026-08-01: emptying services/subly-api/wrangler.jsonc's
// ALLOWED_ORIGINS produced BYTE-IDENTICAL output and exit 0.
//
// 🔴 AND THEN IT HARDCODED THE ORIGINS. The fix above iterated every Worker but
// compared them against a `POLICY` literal inside this file — so the allowlist
// was still a HAND-EDITED list, merely moved from wrangler.jsonc into the guard
// that was supposed to derive it. Mutation-proven 2026-08-07 on the real tree:
// adding a second live app to catalog/apps.json with a brand-new
// origin (`https://drift.nikatru.com`) and changing nothing else produced
// BYTE-IDENTICAL output and exit 0 — while that app's every browser request
// would have been refused at runtime. This is [4]B-2's CORS half and [3]S-11:
// stamping a new app into the factory must not depend on a human remembering to
// edit a comma-separated string in two Worker configs.
//
// THE DERIVATION (there is no hand-maintained origin list left):
//   • catalog/apps.json is the app catalogue. Each row's `url`
//     contributes exactly one browser ORIGIN.
//   • `platform` is the SHARED Worker (config.nikatru.com / platform.nikatru.com)
//     that EVERY app's web build calls → it must list EVERY catalogue origin.
//   • `services/<slug>-api` is app <slug>'s own Worker → it must list that one
//     app's origin. The mapping is by DIRECTORY NAME, so a new app that brings
//     its own Worker is covered without editing this file.
//   • Anything else listed in a config must appear in EXTRAS with a reason. An
//     origin the catalogue does not justify and nobody wrote a reason for is a
//     hand-addition, and that is the drift this guard exists to stop.
//
// Usage:  node tooling/ci/assert-cors-allowlist.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? '.');
const SERVICES = join(ROOT, 'services');
const CATALOGUE = join(ROOT, 'catalog', 'apps.json');

/**
 * Workers whose audience is NOT derivable from a `<slug>-api` directory name.
 *
 * `scope: 'every-app'` — a shared Worker every app's web build calls.
 * `exemptReason`       — a claim that the Worker has NO browser callers at all.
 *                        Not a waiver: it must survive being read aloud, same
 *                        idiom as assert-guard-coverage.mjs's NOT_A_SCANNER.
 * A Worker that is in neither this map nor the `<slug>-api` derivation fails.
 */
const SERVICE_POLICY = {
  platform: {
    scope: 'every-app',
    why: 'config.nikatru.com + platform.nikatru.com — the shared config/analytics Worker that every app\'s web build fetches cross-origin',
  },
};

/**
 * The ONLY permitted non-catalogue origins, each with the reason it is there.
 * Every entry is a standing exception to "the catalogue is the source of truth",
 * so each one has to earn its line. An origin in a config that is neither
 * catalogue-derived nor listed here is a hard failure.
 */
const EXTRAS = {
  platform: [
    {
      origin: 'https://subly-9cp.pages.dev',
      why: 'Subly’s Cloudflare Pages preview domain. Not in apps.json — the catalogue advertises production URLs to the public and a preview host has no business there.',
    },
    {
      origin: 'http://localhost:3000',
      why: 'the local Subly web dev server (.claude/launch.json). It fetches config.nikatru.com cross-origin from the browser, and this Worker has NO localhost regex, so the origin must be listed explicitly.',
    },
  ],
  'subly-api': [
    {
      origin: 'https://subly-9cp.pages.dev',
      why: 'Subly’s Cloudflare Pages preview domain — mirrors services/platform.',
    },
    // NOTE: no localhost entry. This per-app Worker allows localhost by regex
    // (a recorded trade — the `flutter drive -d web-server` harness picks a
    // random port), so listing it here would assert something the config does
    // not need to carry.
  ],
};

/** Strip line and block comments outside string literals, drop trailing commas,
 *  then parse. Structural, never a grep: a wrangler.jsonc is mostly prose, and
 *  a `grep '"r2_buckets"'` in this repo once matched the comment explaining why
 *  there is no r2_buckets. */
function parseJsonc(path) {
  const raw = readFileSync(path, 'utf8');
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.slice(i, i + 2) === '//') {
      while (i < raw.length && raw[i] !== '\n') i++;
    } else if (raw.slice(i, i + 2) === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else if (raw[i] === '"') {
      out += raw[i++];
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') out += raw[i++];
        out += raw[i++];
      }
      if (i < raw.length) out += raw[i++];
    } else {
      out += raw[i++];
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ── COVERAGE ASSERTIONS [pipeline F-10] ──────────────────────────────────────
// Everything below is only as strong as the catalogue it derives from and the
// configs it iterates. Empty either and this prints "all 0 required present"
// and exits 0 forever — an assertion that cannot fail, which this repo treats
// as worse than none. [10]D-8 limb (c) printed `0 comparison(s)`; an iOS
// usage-key haystack held 0 keys while 18 tells compared against it.
const MIN_SERVICES = 2; // platform + subly-api
const MIN_CATALOGUE_ORIGINS = 1; // apps.json declares subly today
const MIN_PER_APP_WORKERS = 1; // the `<slug>-api` derivation must be LIVE, not theoretical

if (!existsSync(SERVICES)) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — services/ does not exist under ${ROOT}.\n` +
      '    The scan is broken, not the tree.',
  );
  process.exit(1);
}

if (!existsSync(CATALOGUE)) {
  console.error(
    'assert-cors-allowlist: COVERAGE LOST — no catalogue at catalog/apps.json.\n' +
      '    Every required origin is DERIVED from that file. Without it this guard\n' +
      '    has nothing to require, and would wave through an allowlist that had\n' +
      '    dropped every live app.',
  );
  process.exit(1);
}

let catalogue;
try {
  catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
} catch (e) {
  console.error(`assert-cors-allowlist: COVERAGE LOST — apps.json is not parseable JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(catalogue)) {
  console.error('assert-cors-allowlist: COVERAGE LOST — apps.json is not an array.');
  process.exit(1);
}

// ── derive the origins ───────────────────────────────────────────────────────
const apps = [];
const badRows = [];
for (const row of catalogue) {
  const slug = typeof row?.slug === 'string' ? row.slug : '(no slug)';
  if (typeof row?.url !== 'string' || row.url === '') {
    badRows.push(`✗ apps.json row "${slug}" has no \`url\`, so no browser origin can be derived for it.`);
    continue;
  }
  let origin;
  try {
    origin = new URL(row.url).origin;
  } catch {
    badRows.push(`✗ apps.json row "${slug}" has an unparseable \`url\`: ${row.url}`);
    continue;
  }
  apps.push({ slug, origin });
}

const catalogueOrigins = [...new Set(apps.map((a) => a.origin))];
if (catalogueOrigins.length < MIN_CATALOGUE_ORIGINS) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — the catalogue yielded ${catalogueOrigins.length} origin(s), ` +
      `expected at least ${MIN_CATALOGUE_ORIGINS}.\n` +
      '    A guard over an empty catalogue requires nothing of any allowlist and\n' +
      '    passes forever — including over a config that had been emptied.',
  );
  for (const b of badRows) console.error(`    ${b}`);
  process.exit(1);
}

// ── enumerate every Worker config under services/ ────────────────────────────
const configs = [];
for (const entry of listDir(SERVICES, { withFileTypes: true }).sort((a, b) =>
  a.name < b.name ? -1 : 1,
)) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const path = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(SERVICES, entry.name, f))
    .find((p) => existsSync(p));
  if (!path) continue; // not a Worker (no deployable config)
  configs.push({
    service: entry.name,
    path,
    where: `services/${entry.name}/${path.split(/[\\/]/).pop()}`,
  });
}

if (configs.length < MIN_SERVICES) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — found ${configs.length} Worker config(s) under services/, ` +
      `expected at least ${MIN_SERVICES}.\n` +
      '    A rename or a moved directory silently shrinks this scan; a scan over\n' +
      '    nothing reports a clean allowlist for every Worker in the tree.',
  );
  process.exit(1);
}

const problems = [...badRows];
let checked = 0;
let originsSeen = 0; // catalogue-DERIVED requirements
let extrasSeen = 0; // hand-declared EXTRAS, counted separately and printed
let perAppWorkers = 0;

for (const { service, path, where } of configs) {
  const declared = SERVICE_POLICY[service];
  // The `<slug>-api` derivation: app `subly` owns `services/subly-api`.
  const owner = apps.find((a) => `${a.slug}-api` === service);

  let required;
  if (declared?.exemptReason) {
    console.log(`  – ${where} — exempt: ${declared.exemptReason}`);
    continue;
  } else if (declared?.scope === 'every-app') {
    required = apps.map((a) => ({
      origin: a.origin,
      why: `apps.json declares "${a.slug}" at ${a.origin}; ${service} is shared by every app`,
    }));
  } else if (owner) {
    perAppWorkers++;
    required = [
      {
        origin: owner.origin,
        why: `apps.json declares "${owner.slug}" at ${owner.origin}, and services/${service} is that app's own Worker`,
      },
    ];
  } else {
    // A new Worker is not automatically out of scope — it is untaught scope.
    problems.push(
      `✗ ${where} — this guard has never been taught about services/${service}.\n` +
        `    Name it services/<slug>-api for a slug in apps.json (then its origin is\n` +
        '    derived automatically), or add it to SERVICE_POLICY with scope\n' +
        '    \'every-app\', or with an exemptReason saying why it has no browser\n' +
        '    callers. A Worker that is none of those is a Worker whose allowlist\n' +
        '    nothing checks.',
    );
    continue;
  }

  let cfg;
  try {
    cfg = parseJsonc(path);
  } catch (e) {
    problems.push(`✗ ${where} is not parseable JSONC: ${e.message}`);
    continue;
  }

  const raw = cfg?.vars?.ALLOWED_ORIGINS;
  if (typeof raw !== 'string') {
    problems.push(
      `✗ ${where} — vars.ALLOWED_ORIGINS is missing.\n` +
        '    An absent value denies every non-localhost browser origin: the web\n' +
        '    build of this app loses every call it makes from a browser.',
    );
    continue;
  }

  const listed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.length === 0) {
    problems.push(
      `✗ ${where} — ALLOWED_ORIGINS is EMPTY.\n` +
        '    An empty list denies every non-localhost browser origin rather than\n' +
        '    falling back to "*" (the "*" fallback was the fork removed 2026-08-01).\n' +
        '    This takes the web build offline for every listed origin.',
    );
    continue;
  }

  checked++;

  // The allowlist must EQUAL derived ∪ EXTRAS — a floor and a ceiling in one.
  // A declared EXTRA is required too: it is an origin somebody wrote a reason
  // for, so removing it has to be a reviewable diff in this file rather than a
  // quiet edit to a comma-separated string. (Dropping http://localhost:3000
  // silently breaks local web dev; that was catchable before this rewrite and
  // must stay catchable.)
  const expected = [
    ...required,
    ...(EXTRAS[service] ?? []).map((e) => ({ origin: e.origin, why: `EXTRAS: ${e.why}`, extra: true })),
  ];

  // (a) everything expected must be present.
  for (const { origin, why, extra } of expected) {
    if (extra) extrasSeen++;
    else originsSeen++;
    if (!listed.includes(origin)) {
      problems.push(
        `✗ ${where} — missing "${origin}" — ${why}.\n` +
          (extra
            ? '    Declared in EXTRAS but absent from the config. If it is genuinely\n' +
              '    no longer needed, delete the EXTRAS entry in the same change so the\n' +
              '    reason disappears with the origin.'
            : '    Derived from the catalogue, absent from the config: that app builds\n' +
              '    green, deploys green, and every browser request it makes to this\n' +
              '    Worker is refused at runtime with nothing logged server side.'),
      );
    }
  }

  // (b) nothing may be hand-added that neither the catalogue nor EXTRAS justifies.
  const justified = new Set(expected.map((e) => e.origin));
  for (const origin of listed) {
    if (!justified.has(origin)) {
      problems.push(
        `✗ ${where} — "${origin}" is listed but NOTHING justifies it.\n` +
          '    It is not a catalogue app\'s origin and it is not in EXTRAS. Either\n' +
          '    add the app to catalog/apps.json, or add an EXTRAS entry\n' +
          '    in this guard saying why it is there. An unexplained origin is a\n' +
          '    standing CORS grant nobody reviewed.',
      );
    }
  }
}

// Every service SERVICE_POLICY names must actually have been reached. Otherwise a
// renamed directory turns a checked Worker into an unchecked one and the run
// still prints a tally that looks healthy.
const seen = new Set(configs.map((c) => c.service));
for (const service of Object.keys(SERVICE_POLICY)) {
  if (!seen.has(service)) {
    problems.push(
      `✗ COVERAGE LOST — SERVICE_POLICY names services/${service}, but no Worker config was found there.\n` +
        '    Either the directory moved (fix SERVICE_POLICY in the same change) or\n' +
        '    the Worker was deleted; until then its allowlist is checked by nothing.',
    );
  }
}

// EXTRAS for a Worker that no longer exists is dead policy pretending to be cover.
for (const service of Object.keys(EXTRAS)) {
  if (!seen.has(service)) {
    problems.push(
      `✗ COVERAGE LOST — EXTRAS names services/${service}, but no Worker config was found there.`,
    );
  }
}

// The `<slug>-api` limb must have matched something. If it never fires, the
// per-app half of the derivation is untested code that reports healthy.
if (perAppWorkers < MIN_PER_APP_WORKERS) {
  problems.push(
    `✗ COVERAGE LOST — the <slug>-api derivation matched ${perAppWorkers} Worker(s), ` +
      `expected at least ${MIN_PER_APP_WORKERS}.\n` +
      '    That limb is what covers each app\'s own API Worker. If it matches\n' +
      '    nothing, only the shared Worker is really being checked.',
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(
    `\nassert-cors-allowlist: ${problems.length} problem(s).\n` +
      'An exact allowlist fails closed and silently: the affected surface simply\n' +
      'stops working in the browser, with nothing logged server side.',
  );
  process.exit(1);
}

// The EXTRAS count is printed, not buried: every one is a standing exception to
// "the catalogue is the source of truth", and a number that quietly grows is how
// a hand-maintained list comes back.
console.log(
  `assert-cors-allowlist: ${checked} Worker config(s) checked against ${catalogueOrigins.length} ` +
    `catalogue origin(s) from ${apps.length} app(s); ${originsSeen} derived requirement(s) ` +
    `+ ${extrasSeen} declared EXTRAS all present, no unjustified origins.`,
);
