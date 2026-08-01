#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-cors-allowlist.mjs — EVERY Worker's CORS allowlist still covers every
// browser origin known to call it.
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
// ALLOWED_ORIGINS produced BYTE-IDENTICAL output and exit 0. That is this repo's
// signature failure — a scanner that silently covers less than its name says and
// still prints "ok". It now iterates every services/*/wrangler.jsonc, the way
// assert-d1-bindings.mjs already does, and a Worker it has not been TAUGHT about
// is a hard failure rather than a silent skip.
//
// Usage:  node tooling/ci/assert-cors-allowlist.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';

const ROOT = resolve(process.argv[2] ?? '.');
const SERVICES = join(ROOT, 'services');

/**
 * Per-service policy. Origins that demonstrably call that Worker from a browser
 * today, each with the reason it is there.
 *
 * `exemptReason` marks a Worker with NO browser callers at all. It is a claim
 * that the question does not apply — not a waiver — and it must survive being
 * read aloud, same idiom as assert-guard-coverage.mjs's NOT_A_SCANNER. A Worker
 * that appears in neither form fails the build.
 */
const POLICY = {
  platform: {
    required: [
      {
        origin: 'https://subly.nikatru.com',
        why: 'the live Subly web app (config + analytics)',
      },
      {
        origin: 'https://subly-9cp.pages.dev',
        why: 'Subly’s Cloudflare Pages preview domain — mirrors services/subly-api',
      },
      {
        origin: 'http://localhost:3000',
        why: 'the local Subly web dev server (.claude/launch.json) — it fetches config.nikatru.com cross-origin from the browser. This Worker has NO localhost regex, so the origin must be listed explicitly.',
      },
    ],
  },
  'subly-api': {
    required: [
      {
        origin: 'https://subly.nikatru.com',
        why: 'the live Subly web app — every /v1 data call',
      },
      {
        origin: 'https://subly-9cp.pages.dev',
        why: 'Subly’s Cloudflare Pages preview domain',
      },
      // NOTE: no localhost entry. This per-app Worker allows localhost by regex
      // (a recorded trade — the `flutter drive -d web-server` harness picks a
      // random port), so listing it here would assert something the config does
      // not need to carry.
    ],
  },
};

/** Strip line and block comments outside string literals, drop trailing commas,
 *  then parse. Structural, never a grep: a wrangler.jsonc is mostly prose. */
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
// The loop below is only as strong as what it iterates and what POLICY holds.
// Empty either and this prints "all 0 required present" and exits 0 forever —
// an assertion that cannot fail, which this repo treats as worse than none.
const MIN_SERVICES = 2; // platform + subly-api
const MIN_REQUIRED_ORIGINS = 5; // 3 platform + 2 subly-api

if (!existsSync(SERVICES)) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — ${posix.join('services')} does not exist under ${ROOT}.\n` +
      '    The scan is broken, not the tree.',
  );
  process.exit(1);
}

const policyOrigins = Object.values(POLICY).reduce(
  (n, p) => n + (p.required?.length ?? 0),
  0,
);
if (Object.keys(POLICY).length < MIN_SERVICES || policyOrigins < MIN_REQUIRED_ORIGINS) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — POLICY declares ${Object.keys(POLICY).length} ` +
      `service(s) / ${policyOrigins} origin(s), expected at least ${MIN_SERVICES} / ${MIN_REQUIRED_ORIGINS}.\n` +
      '    The guard is broken, not the config: with a thinned POLICY this check\n' +
      '    passes over any allowlist, including one that dropped a live origin.',
  );
  process.exit(1);
}

// ── enumerate every Worker config under services/ ────────────────────────────
const configs = [];
for (const entry of readdirSync(SERVICES, { withFileTypes: true }).sort((a, b) =>
  a.name < b.name ? -1 : 1,
)) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const path = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(SERVICES, entry.name, f))
    .find((p) => existsSync(p));
  if (!path) continue; // not a Worker (no deployable config)
  configs.push({ service: entry.name, path, where: `services/${entry.name}/${path.split(/[\\/]/).pop()}` });
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

const problems = [];
let checked = 0;
let originsSeen = 0;

for (const { service, path, where } of configs) {
  const policy = POLICY[service];
  if (!policy) {
    // A new Worker is not automatically out of scope — it is untaught scope.
    problems.push(
      `✗ ${where} — this guard has never been taught about services/${service}.\n` +
        '    Add it to POLICY with its required browser origins, or with an\n' +
        '    exemptReason saying why it has no browser callers. A Worker that is\n' +
        '    neither is a Worker whose allowlist nothing checks.',
    );
    continue;
  }
  if (policy.exemptReason) {
    console.log(`  – ${where} — exempt: ${policy.exemptReason}`);
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
  for (const { origin, why } of policy.required) {
    originsSeen++;
    if (!listed.includes(origin)) {
      problems.push(`✗ ${where} — missing "${origin}" — ${why}`);
    }
  }
}

// Every service POLICY names must actually have been reached. Otherwise a
// renamed directory turns a checked Worker into an unchecked one and the run
// still prints a tally that looks healthy.
const seen = new Set(configs.map((c) => c.service));
for (const service of Object.keys(POLICY)) {
  if (!seen.has(service)) {
    problems.push(
      `✗ COVERAGE LOST — POLICY names services/${service}, but no Worker config was found there.\n` +
        '    Either the directory moved (fix POLICY in the same change) or the\n' +
        '    Worker was deleted; until then its allowlist is checked by nothing.',
    );
  }
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

console.log(
  `assert-cors-allowlist: ${checked} Worker config(s) checked, ${originsSeen} required origin(s) all present.`,
);
