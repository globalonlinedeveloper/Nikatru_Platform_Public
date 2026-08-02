#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-monitor-coverage.mjs — [pipeline E-9] every live hostname has a
// monitor, and the list cannot silently shrink.
//
// WHY THIS EXISTS. The acceptance quantifies over "every live hostname", and
// until tooling/monitor-register.json landed that set did not exist anywhere a
// machine could read. The monitor set lived inside GlitchTip on the Oracle box;
// the deployed set lived in wrangler configs, an app catalogue and a handful of
// canonical links; and the comparison between them was performed by a human,
// from memory, when somebody happened to look. Measured 2026-08-01 and again
// 2026-08-02 — six monitors, five hostnames, and TWO deployed custom domains
// (platform.nikatru.com, config.nikatru.com) that nothing watches, both bound
// since the Worker shipped. Nobody decided not to monitor them.
//
// 🔴 THE DEPLOYED SET IS DERIVED FROM THE TREE ON EVERY RUN, from three sources
// that already exist for other reasons:
//   · workerCustomDomains — `routes[]` entries with `custom_domain: true`
//     across services/*/wrangler.jsonc. A custom domain IS a public hostname.
//   · appCatalogue        — the `url` and `api` hosts in
//     sites/_shared/_data/apps.json, which is what the public site advertises.
//   · siteCanonicals      — each sites/*/index.html's `<link rel="canonical">`.
//     A site's own canonical URL is the one place it names the host it is
//     served from; the directory name is not that (`sites/nikatru` ⇒
//     nikatru.com is a guess, and a guess is how a register goes stale).
// Adding a route to a wrangler config therefore acquires a monitoring
// obligation the moment it merges, rather than when somebody remembers this
// file exists. That is the half a hand-typed list can never have.
//
// WHAT FAILS, AND WHAT ONLY PRINTS
//   FAIL · a derived hostname with no row in the register    (the list shrank)
//   FAIL · a row naming a hostname nothing deploys, unless it is `declared`
//          with a reason                                     (a dead row)
//   FAIL · a row claiming a monitor without id/name/type/verifiedOn
//   FAIL · no row carries `role: "observability"`  (nothing asks who watches
//          the watcher — the monitor host is the one hostname NO deploy config
//          can mention, so its absence is silent by construction)
//   PRINT · rows with `monitor: null` — the actual coverage gap.
//
// ⚠️ THE GAP PRINTS RATHER THAN FAILS ON PURPOSE, and this is the repo's
// established shape rather than a softening. Creating a monitor is an action on
// the owner's GlitchTip instance, not a change to this repository; a guard that
// failed CI on it would block every branch on work only the owner can do — the
// same reasoning assert-seams-wired.mjs applies to the unpinned pack-signing
// keys. What must never happen is the gap becoming INVISIBLE, so the count is
// on stdout every single run, gap or no gap.
//
// ⚠️ NO THRESHOLD IS CHECKED AND NONE IS INVENTED. "How many consecutive
// failures should page, and how fast" has no derivable answer in this tree, so
// this guard asserts nothing about it. The register records each monitor's
// interval as a MEASURED fact — what the live API reports today — not a target.
//
// The LIVE half of E-9 is tooling/ops/verify-monitors.mjs, which reconciles the
// register against the GlitchTip API. It is deliberately not run here: a CI limb
// needing a network token would either be skipped (and a skipped check reports
// ok) or would make every build depend on the Oracle box, which is the very
// single point of failure E-9b is about.
//
// Usage:  node tooling/ci/assert-monitor-coverage.mjs [repoRoot]
// Exit 0 = every deployed hostname is declared, 1 = violation or lost coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const REGISTER = 'tooling/monitor-register.json';
const SERVICES = 'services';
const SITES = 'sites';
const CATALOGUE = 'sites/_shared/_data/apps.json';

/** The three DERIVED sources. Each must contribute at least one hostname: a
 *  source that silently stops yielding anything makes the coverage check true
 *  of a smaller world and still prints ok, which is this repository's single
 *  most repeated failure. `declared` is not here — it is the escape hatch for
 *  the one hostname no deploy config can name, and it is bounded by the
 *  observability check below rather than by a count. */
const DERIVED_SOURCES = ['workerCustomDomains', 'appCatalogue', 'siteCanonicals'];

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(1);
};

const rel = (p) => join(ROOT, ...p.split('/'));
const readIf = (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8') : null);

/** JSONC → JSON. Comments STRIPPED before parsing, never scanned — this repo has
 *  already shipped a guard that matched the template comment explaining why
 *  there is no `r2_buckets`. String literals are respected so a `//` inside a
 *  URL is not read as a comment. */
function parseJsonc(text, where) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    coverageLost(`${where} could not be parsed after stripping comments: ${err.message}`);
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// ── derive the deployed hostname set ────────────────────────────────────────
/** hostname → the set of sources that produced it. */
const derived = new Map();
const perSource = new Map(DERIVED_SOURCES.map((s) => [s, new Set()]));
const add = (source, host) => {
  if (!host) return;
  perSource.get(source).add(host);
  if (!derived.has(host)) derived.set(host, new Set());
  derived.get(host).add(source);
};

// 1 · Worker custom domains.
if (!existsSync(rel(SERVICES))) {
  coverageLost(`no ${SERVICES}/ directory under ${ROOT}; the Worker half of the derivation ran over nothing.`);
}
for (const e of listDir(rel(SERVICES), { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const name of ['wrangler.jsonc', 'wrangler.json']) {
    const path = `${SERVICES}/${e.name}/${name}`;
    const text = readIf(path);
    if (text === null) continue;
    const cfg = parseJsonc(text, path);
    for (const route of Array.isArray(cfg.routes) ? cfg.routes : []) {
      if (route && route.custom_domain === true && typeof route.pattern === 'string') {
        add('workerCustomDomains', route.pattern.toLowerCase());
      }
    }
    break;
  }
}

// 2 · The app catalogue — what the public site advertises.
const catalogueText = readIf(CATALOGUE);
if (catalogueText === null) {
  coverageLost(`${CATALOGUE} does not exist; the app half of the derivation ran over nothing.`);
}
let catalogue;
try {
  catalogue = JSON.parse(catalogueText);
} catch (err) {
  coverageLost(`${CATALOGUE} is not valid JSON (${err.message}).`);
}
for (const app of Array.isArray(catalogue) ? catalogue : []) {
  for (const field of ['url', 'api']) {
    if (typeof app?.[field] === 'string') add('appCatalogue', hostOf(app[field]));
  }
}

// 3 · Each site's OWN canonical host. Not the directory name: `sites/nikatru`
//     ⇒ nikatru.com is a guess, and a guess is how a register goes stale.
if (!existsSync(rel(SITES))) {
  coverageLost(`no ${SITES}/ directory under ${ROOT}; the site half of the derivation ran over nothing.`);
}
for (const e of listDir(rel(SITES), { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
  const html = readIf(`${SITES}/${e.name}/index.html`);
  if (html === null) continue;
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  if (canonical) add('siteCanonicals', hostOf(canonical));
}

for (const source of DERIVED_SOURCES) {
  if (perSource.get(source).size === 0) {
    coverageLost(
      `the "${source}" derivation yielded no hostname. The deployed set below is short by everything it ` +
        'contributes, so "every live hostname is declared" would hold over a smaller world and still print ok.',
    );
  }
}

// ── the register ────────────────────────────────────────────────────────────
const registerText = readIf(REGISTER);
if (registerText === null) {
  coverageLost(`${REGISTER} does not exist. It is the declared right-hand side; without it this guard compares the deployed set against nothing.`);
}
let register;
try {
  register = JSON.parse(registerText);
} catch (err) {
  coverageLost(`${REGISTER} is not valid JSON (${err.message}).`);
}
const rows = Array.isArray(register?.hosts) ? register.hosts : [];
if (rows.length === 0) {
  coverageLost(`${REGISTER} declares no hosts. An empty register accepts any deployment at all, including one with no monitoring whatsoever.`);
}

const byHost = new Map();
for (const row of rows) {
  if (typeof row?.hostname !== 'string' || row.hostname === '') {
    fail(`${REGISTER} has a row with no hostname: ${JSON.stringify(row)}`);
    continue;
  }
  const h = row.hostname.toLowerCase();
  if (byHost.has(h)) {
    fail(`${REGISTER} declares ${h} twice. Two rows for one hostname is two answers to "is it monitored".`);
  }
  byHost.set(h, row);
}

// ── 1 · every deployed hostname is declared ─────────────────────────────────
const undeclared = [...derived.keys()].filter((h) => !byHost.has(h)).sort();
for (const h of undeclared) {
  fail(
    `${h} is deployed by this repository (${[...derived.get(h)].join(', ')}) and has NO row in ${REGISTER}. ` +
      'A hostname nobody declared is a hostname nobody decided about — which is exactly how ' +
      'platform.nikatru.com went unwatched from the day the Worker shipped.',
  );
}

// ── 2 · no dead rows ────────────────────────────────────────────────────────
// A row for a hostname nothing deploys reports judgement over nothing — this
// guard's own failure mode, applied to its subject.
for (const [h, row] of byHost) {
  if (derived.has(h)) continue;
  if (row.derivedFrom === 'declared' && typeof row.why === 'string' && row.why.trim() !== '') continue;
  fail(
    `${h} has a row in ${REGISTER} and nothing in the tree deploys it. Either it was retired and the row ` +
      'did not follow, or it is genuinely outside the derivation — in which case say so with ' +
      '`"derivedFrom": "declared"` and a `why` that survives being read aloud.',
  );
}

// ── 3 · the observability host ──────────────────────────────────────────────
// The one hostname no wrangler config, app row or canonical link can name,
// because it is the thing doing the watching. Its absence is silent by
// construction, so it is the one row this guard requires by name.
const observability = rows.filter((r) => r.role === 'observability');
if (observability.length === 0) {
  coverageLost(
    `no row in ${REGISTER} carries \`"role": "observability"\`. The monitor host is the only hostname the ` +
      'derivation structurally cannot produce, so with no row for it "who watches the watcher" is a question ' +
      'nothing in this tree asks — and the answer today is that monitor id 1 watches the box it runs on.',
  );
}
if (observability.length > 1) {
  fail(`${REGISTER} carries ${observability.length} observability rows; there is one monitor host.`);
}

// ── 4 · a claimed monitor is a complete claim ───────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
let monitored = 0;
const gaps = [];
for (const [h, row] of [...byHost.entries()].sort()) {
  const m = row.monitor;
  if (m === null || m === undefined) {
    const why = row.gap?.why;
    if (typeof why !== 'string' || why.trim() === '') {
      fail(
        `${h} declares no monitor and records no \`gap.why\`. An unmonitored host with no stated reason is ` +
          'indistinguishable from one nobody has looked at — and the printed gap below is the only thing ' +
          'keeping this visible, so it has to say something.',
      );
      continue;
    }
    gaps.push(`${h} — ${why}${row.gap?.action ? ` ACTION: ${row.gap.action}` : ''}`);
    continue;
  }
  const missing = [];
  if (typeof m.id !== 'number') missing.push('id (a number)');
  if (typeof m.name !== 'string' || m.name === '') missing.push('name');
  if (typeof m.type !== 'string' || m.type === '') missing.push('type');
  if (typeof m.verifiedOn !== 'string' || !ISO_DATE.test(m.verifiedOn)) missing.push('verifiedOn (YYYY-MM-DD)');
  if (missing.length) {
    fail(
      `${h} claims a monitor but the claim is incomplete: no ${missing.join(', no ')}. ` +
        'An undated claim about a live system is a claim nobody can check; tooling/ops/verify-monitors.mjs ' +
        'reconciles these fields against the GlitchTip API and needs all of them to do it.',
    );
    continue;
  }
  monitored++;
}

// ── the printed gap, on every run, pass or fail ─────────────────────────────
if (gaps.length) {
  console.log(`--   ${gaps.length} deployed hostname(s) with NO monitor — OWNER-GATED, printed not hidden:`);
  for (const g of gaps) console.log(`       ${g}`);
  console.log('     Creating a monitor is an action on the GlitchTip instance, not a change to this repo, so');
  console.log('     this prints rather than failing the build. It stops being printed when it stops being true.');
}
if (register?.observability?.decidedOn == null) {
  console.log(
    '--   [pipeline E-9b] the observability SPOF is UNDECIDED: every monitor, including the one watching',
  );
  console.log('     glitchtip.nikatru.com, runs inside GlitchTip on one Oracle box, and so does the alert path.');
  console.log('     Owner must fund/accept an off-box checker or record the SPOF as accepted, with a date and a');
  console.log('     name (monitor-register.json → observability.decidedOn / decidedBy).');
}

const summary =
  `monitor coverage — ${derived.size} deployed hostname(s) derived from ${DERIVED_SOURCES.length} source(s) ` +
  `(${DERIVED_SOURCES.map((s) => `${s}: ${perSource.get(s).size}`).join(', ')}), ` +
  `${byHost.size} declared, ${monitored} monitored, ${gaps.length} gap(s)`;

if (failed) {
  console.error(`\n${summary}`);
  console.error('assert-monitor-coverage: FAILED');
  process.exit(1);
}
ok(summary);
