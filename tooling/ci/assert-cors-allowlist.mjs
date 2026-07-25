#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-cors-allowlist.mjs — the shared platform Worker's CORS allowlist still
// covers every browser origin known to call it.
//
// Why this needs a guard at all: the owner chose an EXACT allowlist over suffix
// matching (2026-07-25). An exact list fails CLOSED and SILENTLY — drop an
// origin and that surface loses config resolution and analytics in the browser
// with no server-side error, no failing request log, and nothing in CI. The
// middleware's own vitest suite covers BEHAVIOUR; this covers the deployed
// CONFIG, which lives in wrangler.jsonc and cannot be imported from a Worker
// test (that tsconfig deliberately exposes no node APIs).
//
// This guard cannot know about an app that does not exist yet — adding a new
// app's origin remains a manual step, printed by the brick's post_gen checklist.
// What it does catch is the regression: someone clearing, trimming or typo-ing
// the list and breaking a surface that already works.
//
// Usage:  node tooling/ci/assert-cors-allowlist.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

const WRANGLER = 'services/platform/wrangler.jsonc';

/** Origins that demonstrably call this Worker from a browser today. */
const REQUIRED = [
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
    why: 'the local Subly web dev server (.claude/launch.json) — it fetches config.nikatru.com cross-origin from the browser',
  },
];

/** Strip // comments outside string literals, drop trailing commas, parse. */
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

let cfg;
try {
  cfg = parseJsonc(WRANGLER);
} catch (e) {
  console.error(`assert-cors-allowlist: ${WRANGLER} is not parseable JSONC: ${e.message}`);
  process.exit(1);
}

const raw = cfg?.vars?.ALLOWED_ORIGINS;
if (typeof raw !== 'string') {
  console.error(
    'assert-cors-allowlist: vars.ALLOWED_ORIGINS is missing.\n' +
      '    An absent value denies EVERY browser origin — every web build would lose\n' +
      '    config resolution and analytics.',
  );
  process.exit(1);
}

const listed = raw.split(',').map((s) => s.trim()).filter(Boolean);
if (listed.length === 0) {
  console.error(
    'assert-cors-allowlist: ALLOWED_ORIGINS is EMPTY.\n' +
      '    Since 2026-07-25 an empty list denies every browser origin rather than\n' +
      '    falling back to "*" — this takes every web build offline.',
  );
  process.exit(1);
}

let missing = 0;
for (const { origin, why } of REQUIRED) {
  if (!listed.includes(origin)) {
    console.error(`  ✗ missing "${origin}" — ${why}`);
    missing++;
  }
}

if (missing > 0) {
  console.error(
    `\nassert-cors-allowlist: ${missing} required origin(s) absent from ${WRANGLER}.\n` +
      'An exact allowlist fails closed and silently: the affected surface simply\n' +
      'stops working in the browser, with nothing logged server side.',
  );
  process.exit(1);
}

console.log(
  `assert-cors-allowlist: ${listed.length} origin(s) listed, all ${REQUIRED.length} required present.`,
);
