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
// ── `--emit-url <slug>` — THE ORIGIN THE WEB LANE DEPLOYS TO ─────────────────
// [10]D-2b. `deploy-web.yml` is a matrix over the workspace app set and must
// therefore resolve "where does app <id> live" at run time rather than carry one
// app's hostname in its YAML. That answer already exists exactly once, in the
// catalogue this guard's whole subject is, and `tooling/monitor-register.json`
// already derives every watched hostname from the same file
// (`_derivation.appCatalogue`).
//
// 🔴 IT IS EMITTED FROM THE GUARD THAT ASSERTS THOSE URLS ANSWER, and that is
// the point rather than a shortcut — the same relationship
// assert-release-lane-generic.mjs `--emit-apps` has with the lanes it grades. A
// separate reader inlined in the workflow would be a second parse of one file,
// free to disagree with this one in the only way that reports "clean".
//
// It does NOT filter on `status`. `live` is a claim about a surface that already
// answers; an app is deployed BEFORE it can be live, so requiring `live` here
// would make the first deploy of every new app impossible. Reachability stays
// the business of the scan below.
//
// Usage:  node tooling/ci/assert-catalog-reachable.mjs [repoRoot]
//         node tooling/ci/assert-catalog-reachable.mjs --emit-url <slug> [repoRoot]
// Exit 0 = every advertised app answered, 1 = one did not (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `indexOf` returns -1 when the flag is absent, and -1 + 1 === 0 silently
// selects argv[0] — the off-by-one that shipped in assert-gate-passed.mjs and
// blocked both production deploys. Filtered explicitly, never by arithmetic.
const argv = process.argv.slice(2);
const emitAt = argv.indexOf('--emit-url');
const EMIT_SLUG = emitAt === -1 ? null : (argv[emitAt + 1] ?? null);
const positional = emitAt === -1 ? argv : argv.filter((_, i) => i !== emitAt && i !== emitAt + 1);

const ROOT = resolve(positional[0] ?? process.cwd());
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

/** Same as fail(), but for the post-fetch paths — see the note beside `done`. */
let softFailed = false;
function failSoft(lines) {
  for (const l of lines) console.error(l);
  softFailed = true;
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

// ── the emit mode, BEFORE any network work ───────────────────────────────────
// Deliberately after the catalogue's structural floors and before the probes:
// this mode answers one question ("what origin does app <slug> publish to") and
// must not be able to fail — or hang for ATTEMPTS × TIMEOUT_MS — because a
// hostname unrelated to it is down. It fails LOUDLY on every "I could not tell"
// case, because the caller is a deploy lane and an empty answer there resolves
// to `/version.json` — a smoke against the runner's own filesystem, which is the
// green-over-nothing shape this repository keeps paying for.
if (emitAt !== -1) {
  if (!EMIT_SLUG || EMIT_SLUG.startsWith('-')) {
    fail([
      '✗ --emit-url needs an app slug: `--emit-url <slug>`.',
      `  Got ${EMIT_SLUG === null ? 'nothing' : JSON.stringify(EMIT_SLUG)}. An unresolved slug would emit an empty`,
      '  origin and the caller would probe a path with no host at all.',
    ]);
  }
  const row = entries.find((e) => e && e.slug === EMIT_SLUG);
  if (!row) {
    fail([
      `✗ the catalogue declares no app with slug "${EMIT_SLUG}".`,
      `  It holds: ${entries.map((e) => e?.slug ?? '<no slug>').join(', ')}.`,
      '  [3]S-7 makes the stamp write this row; an app in the pub workspace with no catalogue row is an app',
      '  the web lane can build and cannot address, so this is a real fault and not a missing convenience.',
    ]);
  }
  const url = typeof row.url === 'string' ? row.url.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\/[^\s/]+/.test(url)) {
    fail([
      `✗ the catalogue row for "${EMIT_SLUG}" declares url ${JSON.stringify(row.url ?? null)}, which is not an https origin.`,
      '  The deploy lane appends `/version.json` to this value and the deployment record publishes it verbatim.',
    ]);
  }
  console.log(`site_url=${url}`);
  process.exit(0);
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
    // 🔴 THE BODY MUST BE DRAINED, and it is not politeness. An unconsumed body
    // leaves the socket checked out of the pool, so the later `process.exit()`
    // tears down a connection that is still live — on Windows that surfaced as
    // the guard CRASHING with 0xC0000409 instead of exiting 1, and only on the
    // retrying (5xx) path, which is what made it look like a 522-specific bug.
    await res.arrayBuffer().catch(() => {});
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

// 🔴 FROM HERE ON, EXIT VIA `process.exitCode` AND NEVER `process.exit()`.
// Calling process.exit() after a fetch tears down undici's still-open pool
// mid-flight, and on Windows that is not a tidy race — it aborts the process
// (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 127) AFTER
// printing "ok", so the guard reports success and returns a failure code. A
// guard whose exit code contradicts its own output is worse than no guard.
// Setting exitCode lets the loop drain and the process end on its own.
const done = (code) => { process.exitCode = code; };

// The network-is-down case. Only claim it when NOTHING got through and every
// failure was a transport error — a single unreachable host among answering
// ones is that host's problem, not the runner's.
if (live.length > 0 && transportFailures.length === live.length) {
  failSoft([
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
  done(1);
}

// Skipped entirely when the transport branch already fired: every entry would
// be re-listed there, and one defect reported twice reads as two defects.
const problems = [];
if (!softFailed) {
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

}

if (problems.length) {
  console.error(`✗ catalogue reachability — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline S-7a] a `live` entry is a promise to a stranger that the link works.');
  console.error(`  Catalogue: sites/_shared/_data/apps.json`);
  done(1);
}

if (!softFailed && !problems.length) {
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
}
