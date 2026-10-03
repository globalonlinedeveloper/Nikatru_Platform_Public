#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/report-link.node.js — the sim for core/v1/report-link.js.

   Loads the REAL shipped bytes of v1/report-link.js on bare Node and grades
   what the "Report a problem" link may carry: the closed key list, one shape
   per key, and NOTHING about a page (no URL, title or host, under any key).
   scripts/policy-check.mjs gate 10 runs the vendored copy in each tool; this
   grades the core source itself, as every module on the vendored surface is.

   Run: node core/test/report-link.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, expectBroken } = H;

const MODULE = 'v1/report-link.js';
const SRC = H.readCore(MODULE);

function load(source) {
  return H.loadCore(MODULE, {}, { source }).SKREPORT;
}

/* A probe state carrying everything a page could leak, beside the tool's own
   facts. Only the tool's own facts may come out. */
const PAGE_URL = 'https://bank.example.com/account?id=42';
const PROBE = {
  app: 'fullshot',
  version: '1.4.2',
  uiLocale: 'ta',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Safari/537.36',
  category: 'crash',
  url: PAGE_URL,
  title: 'My bank — account 42',
  host: 'bank.example.com'
};

function leaksPage(R, state) {
  const p = R.payload(state);
  const l = R.link(state);
  const values = Object.keys(p).map((k) => p[k]).join(' ');
  return ['bank.example.com', 'account?id=42', 'My bank'].some((s) => values.indexOf(s) >= 0 || decodeURIComponent(l).indexOf(s) >= 0);
}

async function main() {
  /* ---------------------------------------------------------------- */
  section('it loads at all, on bare Node, from the shipped bytes');
  /* ---------------------------------------------------------------- */
  const R = load();
  check('SKREPORT attaches with payload, link and coarsePlatform',
    !!R && typeof R.payload === 'function' && typeof R.link === 'function' && typeof R.coarsePlatform === 'function');

  /* ---------------------------------------------------------------- */
  section('CORE-POLICY §1.3 — shared code makes no network call, ever');
  /* ---------------------------------------------------------------- */
  {
    const banned = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource'];
    const hits = banned.filter((b) => SRC.indexOf(b) >= 0);
    check('no network API appears anywhere in the shipped source', hits.length === 0, hits.join(', '));
  }

  /* ---------------------------------------------------------------- */
  section('the payload is the tool\'s own facts, and only those');
  /* ---------------------------------------------------------------- */
  {
    const p = R.payload(PROBE);
    check('the tool\'s own facts survive', p.app === 'fullshot' && p.v === '1.4.2' && p.loc === 'ta' && p.category === 'crash',
      JSON.stringify(p));
    check('the platform is engine and major version, never the user-agent string', p.plat === 'chromium 130', p.plat);
    check('every key is on the closed list', Object.keys(p).every((k) => R.KEYS.indexOf(k) >= 0), Object.keys(p).join(', '));
    check('nothing about the page reaches the payload or the link', !leaksPage(R, PROBE));
    check('a page URL under a LISTED key is dropped too (a shape per key)',
      R.payload(Object.assign({}, PROBE, { uiLocale: 'bank.example.com', version: PAGE_URL })).loc === undefined);
    check('an unknown category reads as bug', R.payload({ category: 'exfiltrate' }).category === 'bug');
  }

  /* ---------------------------------------------------------------- */
  section('q — the words typed into Help search');
  /* ---------------------------------------------------------------- */
  {
    check('plain words are carried, whitespace folded',
      R.payload({ query: '  screenshot   is blank ' }).q === 'screenshot is blank');
    for (const bad of [PAGE_URL, 'www.example.com', 'mail me at a@b.com', 'see example.org/x']) {
      check('dropped whole when it looks like a URL, host or address: ' + JSON.stringify(bad),
        R.payload({ query: bad }).q === undefined);
    }
    check('dropped over 200 characters', R.payload({ query: 'a'.repeat(201) }).q === undefined);
  }

  /* ---------------------------------------------------------------- */
  section('the link');
  /* ---------------------------------------------------------------- */
  {
    const l = R.link(PROBE);
    check('it opens the report form on nikatru.com/support, at the form', l.indexOf(R.FORM + '?') === 0 && /#report-a-problem$/.test(l), l);
    check('its query is exactly the payload', new URL(l).searchParams.get('app') === 'fullshot' && new URL(l).searchParams.get('v') === '1.4.2');
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — the recorded failing case (docs/CORE-POLICY.md §2 rule 3)');
  /* ---------------------------------------------------------------- */
  /* Let any value through under a listed key: a page URL passed as `version`
     must then reach the link, so the "nothing about the page" check reds. */
  await expectBroken('a key without its shape check lets a page URL through', () => {
    const M = load(H.mutate(SRC, "if (typeof v !== 'string' || !SHAPES[k].test(v)) continue;", "if (typeof v !== 'string') continue;"));
    return !leaksPage(M, Object.assign({}, PROBE, { version: PAGE_URL }));
  });
  /* Read the platform off the raw user-agent: the coarse-platform check reds. */
  await expectBroken('the raw user-agent never reaches the link', () => {
    const M = load(H.mutate(SRC, 'plat: coarsePlatform(s.userAgent),', 'plat: s.userAgent,'));
    return M.payload(PROBE).plat === 'chromium 130';
  });

  process.exit(H.finish());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
