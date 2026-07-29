#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-catalog-reachable.mjs — the public catalogue may not advertise a dead app.
//
// [pipeline S-7a] company/pipeline/03-stamper.md — the open sub-item under S-7.
//
// WHY. `[3]S-7` proves a stamp WRITES itself into sites/_shared/_data/apps.json,
// and that half is genuinely verified on every push. Its second promise —
// "never publishes a hostname that will not resolve" — is FALSE IN PRODUCTION,
// and measurably so: under the wildcard `*.nikatru.com` ([ADR 006]) EVERY name
// resolves and almost every name fails. Measured 2026-07-29: `lingo.nikatru.com`
// and `zzz-nonexistent-app.nikatru.com` both return 522, while
// `subly.nikatru.com/version.json` returns 200. So "it resolves" proves nothing
// whatsoever, and the catalogue could publish a `live`, broken entry with
// nothing in the repo noticing. This is a PUBLIC file: a broken link in it is a
// broken promise a stranger sees first.
//
// ── WHY IT LEANS ON THE RESPONSE, NEVER ON RESOLUTION ────────────────────────
// The wildcard is exactly why DNS is worthless here. An entry is reachable only
// if the host ANSWERS.
//
// ── HOW A DEAD APP IS TOLD APART FROM A CI RUNNER WITH NO NETWORK ────────────
// This is the whole design problem, and it is solved without an external canary
// by reading the FAILURE KIND rather than adding a control host:
//   · an HTTP status (522, 404, 500 …) means the network worked and the app did
//     not — a REAL failure, and 522 is precisely the shape a dead subdomain
//     takes under the wildcard;
//   · a transport error (DNS, connect refused, timeout) means we never got an
//     answer at all. If EVERY entry fails that way, the runner has no network
//     and blaming the catalogue would be a lie → COVERAGE LOST, not a pass.
// A control URL would have added a third-party dependency that can itself go
// down, and would have made this guard fail for a reason unrelated to us.
//
// ── ONLY `live` ENTRIES ARE BINDING ──────────────────────────────────────────
// `[3]S-7a` decided the stamp writes `status: "preview"` until an app actually
// answers, and post_gen.dart:153 does. `preview` is a promise nobody has made
// yet, so it is skipped — but the count of skipped entries is PRINTED on every
// run, because marking everything `preview` is the one way to quietly empty this
// guard's domain, and a shrink nobody can see is the failure this repo keeps
// paying for.
//
// Usage:  node tooling/ci/assert-catalog-reachable.mjs [repoRoot]
// Exit 0 = every advertised app answered, 1 = one did not (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const CATALOG = join(ROOT, 'sites', '_shared', '_data', 'apps.json');

/** Attempts per entry. A single blip must not fail a build; a dead app must.
 *  Bounded deliberately: worst case is ATTEMPTS × TIMEOUT_MS per entry, and a
 *  guard that can hang is worse than one that can fail — a hanging CI step looks
 *  exactly like a slow network, which is the one thing this guard exists to
 *  distinguish. */
const ATTEMPTS = 2;
const TIMEOUT_MS = 8000;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

if (!existsSync(CATALOG)) {
  fail([
    `✗ COVERAGE LOST — no catalogue at ${CATALOG}.`,
    '  [S-7] the stamp writes this file; without it there is nothing to check and nothing to trust.',
  ]);
}

let entries;
try {
  entries = JSON.parse(readFileSync(CATALOG, 'utf8'));
} catch (err) {
  fail([`✗ catalogue is not valid JSON: ${err.message}`]);
}
if (!Array.isArray(entries)) fail(['✗ catalogue is not a JSON array.']);
if (entries.length === 0) {
  fail([
    '✗ COVERAGE LOST — the catalogue is empty.',
    '  Every check below would range over nothing and report success.',
  ]);
}

const live = entries.filter((e) => e && e.status === 'live');
const skipped = entries.length - live.length;

/** One request. Returns {ok} | {status} | {transport} — the three cases the
 *  network/app distinction rests on. */
async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // GET, not HEAD: Workers and static hosts routinely answer HEAD differently
    // (or not at all), so HEAD can report a failure the real visitor never sees.
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    return res.ok ? { ok: true, status: res.status } : { status: res.status };
  } catch (err) {
    return { transport: err?.cause?.code ?? err?.name ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Retry only transport errors and 5xx — a 404 is a settled answer, not a blip. */
async function probeWithRetries(url) {
  let last;
  for (let i = 0; i < ATTEMPTS; i++) {
    last = await probe(url);
    if (last.ok) return last;
    if (last.status && last.status < 500) return last;
    if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return last;
}

const results = [];
for (const e of live) {
  if (!e.url) {
    results.push({ slug: e.slug ?? '<no slug>', verdict: { status: 0 }, missingUrl: true });
    continue;
  }
  results.push({ slug: e.slug ?? '<no slug>', url: e.url, verdict: await probeWithRetries(e.url) });
}

const answered = results.filter((r) => r.verdict.ok);
const httpFailures = results.filter((r) => !r.verdict.ok && r.verdict.status !== undefined);
const transportFailures = results.filter((r) => r.verdict.transport !== undefined);

// The network-is-down case. Only claim it when NOTHING got through and every
// failure was a transport error — a single unreachable host among answering
// ones is that host's problem, not the runner's.
if (live.length > 0 && transportFailures.length === live.length) {
  fail([
    `✗ COVERAGE LOST — all ${live.length} live entry(ies) failed at the transport layer, none returned`,
    '  any HTTP status.',
    '',
    '  ⚠️ THIS GUARD CANNOT TELL YOU WHICH OF TWO THINGS HAPPENED, and says so rather than picking one:',
    '     · the runner has no network — nothing is wrong with the catalogue; or',
    '     · every advertised host is genuinely unreachable — everything is wrong with it.',
    '  Both are failures, so this exits 1 either way. It is stated as COVERAGE LOST because the check',
    '  did not get to run, and claiming a specific cause it cannot observe would be the more expensive',
    '  mistake. (Note: any `*.nikatru.com` name RESOLVES under the wildcard and answers 522, so a real',
    '  catalogue entry reaches the HTTP branch above — a transport error here points off-wildcard.)',
    ...transportFailures.map((r) => `    ${r.slug} → ${r.url} — ${r.verdict.transport}`),
  ]);
}

const problems = [];
for (const r of httpFailures) {
  if (r.missingUrl) {
    problems.push(`${r.slug} — marked \`live\` with no \`url\`. An advertised app nobody can open.`);
    continue;
  }
  problems.push(
    `${r.slug} — marked \`live\` but ${r.url} answered HTTP ${r.verdict.status}. ` +
      (r.verdict.status === 522
        ? 'A 522 under the wildcard is what a subdomain with NOTHING BEHIND IT looks like — the name ' +
          'resolves because `*.nikatru.com` answers every name, and there is no origin. '
        : '') +
      'The catalogue is public: fix the deploy, or set `status` back to "preview" until it answers.',
  );
}
for (const r of transportFailures) {
  problems.push(
    `${r.slug} — marked \`live\` but ${r.url} could not be reached at all (${r.verdict.transport}), ` +
      'while other entries answered. So this is the app, not the network.',
  );
}

if (problems.length) {
  console.error(`✗ catalogue reachability — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline S-7a] a `live` entry is a promise to a stranger that the link works.');
  console.error(`  Catalogue: sites/_shared/_data/apps.json`);
  process.exit(1);
}

for (const r of answered) console.log(`    ${r.slug} → ${r.url} (${r.verdict.status})`);
if (skipped > 0) {
  // Printed on every run, pass or fail. Marking entries `preview` is the one way
  // to empty this guard's domain, so the shrink must be visible.
  console.log(`⚠  ${skipped} entry(ies) not marked \`live\` and therefore NOT probed.`);
}
console.log(
  `ok  catalogue reachability — ${answered.length} of ${live.length} live entry(ies) answered; ` +
    `${entries.length} entry(ies) in the catalogue, ${skipped} unprobed`,
);

// 🔴 EXPLICIT, AND NOT TIDINESS. `fetch` keeps pooled keep-alive sockets open,
// so falling off the end of this file does NOT end the process — it sits until
// the pool times out. Found by the fixtures hanging: every case, including the
// passing ones, blocked for minutes. In CI that is a step that never returns,
// which looks exactly like a slow network and is the worst possible failure
// shape for a guard whose whole subject is "did it answer".
process.exit(0);
