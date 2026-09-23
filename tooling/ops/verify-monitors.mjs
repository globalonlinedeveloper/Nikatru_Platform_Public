#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-monitors.mjs — [pipeline E-9] the LIVE half.
//
// tooling/ci/assert-monitor-coverage.mjs answers "is every deployed hostname
// DECLARED" from the tree alone, with no network and no token, which is what
// lets it run on every push. It cannot answer "and does the monitor the register
// claims actually EXIST", because that fact lives in GlitchTip.
//
// This does. It reads tooling/monitor-register.json, asks the GlitchTip API for
// the org's monitors, and prints the drift in both directions:
//   · a row claiming monitor id N that the API does not return   (register lies)
//   · a row whose live url/type disagrees with what it records   (drift)
//   · a row DECLARING `expectedBody` that the live monitor does not carry
//     verbatim                                          (declared-body drift)
//     Added 2026-08-11, when monitors 3, 4 and 5 acquired a body assertion and
//     the register grew a claim nothing consumed — monitors 11 and 12 had
//     carried `expectedBody` since 2026-08-05 and this file had never read it,
//     so the register could say one thing while the live monitor said another
//     for as long as anyone cared to look. DECLARED-ONLY on purpose: a row that
//     records no `expectedBody` asserts none, so this cannot false-red on
//     monitors 1 and 2, whose live body has never been read off the API. It CAN
//     fire, which is the whole point — the live PUT and the register row are
//     one change or this goes red.
//   · a live monitor no row accounts for                         (register short)
//   · a row with `monitor: null`                                 (the known gap)
//   · a `pathMonitors` entry whose url/expectedBody is not what the CATALOGUE
//     produces, or that no catalogue app produces at all, or that a catalogue
//     app produces and no entry covers      (the app-path limb, added 2026-09-09)
//
// ⏱ 2026-09-09 — THE PARAGRAPH THAT USED TO STAND HERE SAID "NOT RUN BY CI, AND
// THAT IS THE DESIGN … it is a command, not a gate", AND IT HAD BEEN FALSE FOR
// FOUR WEEKS. tooling/monitor-register.json has recorded it as stale since
// 2026-09-05 and named these exact lines. Measured 2026-09-09:
// .github/workflows/ops-watch.yml runs this script in the `glitchtip` job on
// four schedules and on workflow_dispatch, and has since OWNER_QUEUE S-8 closed
// at 2026-08-11T16:55:34Z when GLITCHTIP_TOKEN became a repository secret. The
// design REASON survives the correction and is why the split still exists: a
// per-PUSH limb needing a network token would either be skipped when the token
// is absent — and a skipped check reports ok — or it would make every build
// depend on the box GlitchTip runs on, which is the single point of failure E-9b
// is about. So the offline half (tooling/ci/assert-monitor-coverage.mjs) gates
// every push and this half runs on a SCHEDULE and gates no merge.
//
// 🔴 ITS RED IS THEREFORE DURABLE AND COSTS A HUMAN. Exit 1 fails the
// `glitchtip` job, whose failure step opens or comments the portfolio's single
// alert issue — reused for every later failure and never closed automatically.
// Read tooling/monitor-register.json's own warning before editing a row here:
// a register row and its live monitor are ONE change, not two.
//
// ── THE APP-PATH LIMB, [ADR 075] ─────────────────────────────────────────────
// Until 2026-09-09 an app was published on its own hostname, so an app's monitor
// was a `hosts` row and every limb above graded it. The app is now published at
// a PATH on the apex (https://nikatru.com/<id>), and a per-hostname register
// cannot carry a second row for the apex — assert-monitor-coverage.mjs fails a
// duplicate hostname, correctly. So the app's monitor lives in `pathMonitors` on
// the apex row, and this file is the guard that reads it.
//
// 🔴 IT RECOMPUTES BOTH ASSERTIONS RATHER THAN READING THEM. `url` and
// `expectedBody` are derived from catalog/apps.json and tooling/sites/apex.mjs
// on every run and compared to what the register records, so a stale or
// hand-retyped address in the register is a RED. That is the whole difference
// between "derived" and "written down once": the app has already been renamed
// once, and the id may move again, so every address in this tree is composed
// from apps/<id>/app.yaml's id through ONE function — never typed as a literal.
//
// 🔴 IT ASSERTS NO THRESHOLD. It reports what is there. "How many consecutive
// failures should page, and how fast" has no derivable answer in this repo, and
// inventing one is how a guard acquires a number nobody can defend.
//
// Usage:
//   GLITCHTIP_URL=https://glitchtip.nikatru.com \
//   GLITCHTIP_ORG=nikatru \
//   GLITCHTIP_TOKEN=…  node tooling/ops/verify-monitors.mjs
//
// The token lives in the local vault (.claude/secrets.env) and must never be
// committed, echoed or printed. Nothing below ever prints its value.
//
// Exit 0 = register and live instance agree (gaps are printed, not failed).
// Exit 1 = drift.
// Exit 2 = no token supplied, or the API could not be reached, authorised or read
//          (those three were exit 1 until 2026-09-11) — a DIFFERENT exit code from "drift" on purpose,
//          so "I could not look" can never be read as "I looked and it was fine".
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 🔴 IMPORTED, NEVER RETYPED. tooling/sites/apex.mjs is the ONE declaration of
// the apex origin and of how an app's public address and base href are composed
// from its id. Four other readers already import it (the discovery generator,
// the catalogue renderer, the address-shape guard and the reachability guard);
// a fifth that spelled `nikatru.com` or `/<id>/` by hand would be the second
// spelling of a fact, which is how a register comes to disagree with the tree.
import { APEX_HOST, publicAppUrl, appBaseHref } from '../sites/apex.mjs';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';

// 🔴 `process.exit()` IS BANNED IN THIS FILE, AND IT IS A BUG FIX. Calling it
// while an undici (fetch) keep-alive handle is still open CRASHES libuv on
// Windows —  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
// src/win/async.c:94`  — and the process then reports 127 instead of the code
// this header documents. Measured 2026-08-05: with a BAD token this file exited
// 127, three runs out of three, where it documents 1. The no-token path returned
// 2 correctly ONLY because it runs before any fetch.
//
// That defeats the exact distinction the exit codes exist to draw: "I could not
// look" (2) vs "I looked and it was wrong" (1) both collapse into 127 the moment
// a request has been made. Set `process.exitCode` and return instead; Node then
// drains its handles and exits with that code on its own.


const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'monitor-register.json');
const CATALOGUE = join(ROOT, 'catalog', 'apps.json');

/**
 * THE EXPECTED APP-PATH MONITORS, COMPUTED FROM THE CATALOGUE.
 *
 * Pure so it is testable with no network and no tree: hand it the catalogue text
 * and it returns a Map from the exact url a monitor must watch to the exact
 * assertions it must carry. Nothing in here is typed — `publicAppUrl` and
 * `appBaseHref` compose both from the app's id, which is what
 * tooling/app-yaml/render.mjs composed the catalogue `url` from in the first
 * place. So this function does not read the catalogue's opinion of the address;
 * it RE-DERIVES the address and checks the catalogue against it too.
 *
 * Apps published on their own hostname are not path monitors and are skipped —
 * they are `hosts` rows, graded by every other limb in this file.
 *
 * Returns `{ expected, problems }`. `problems` is non-empty only when the
 * catalogue itself is inconsistent with the one function that composes the
 * address, which is a failure of the tree rather than of the register.
 */
export function deriveApexAppMonitors(catalogueText) {
  const expected = new Map();
  const problems = [];
  let catalogue;
  try {
    catalogue = JSON.parse(catalogueText);
  } catch (err) {
    return { expected, problems: [`catalog/apps.json is not valid JSON (${err.message}).`], unreadable: true };
  }
  if (!Array.isArray(catalogue) || catalogue.length === 0) {
    return {
      expected,
      problems: ['catalog/apps.json declares no apps, so the set of app-path monitors this file expects is empty — and an empty expectation is satisfied by a register that declares nothing at all.'],
      unreadable: true,
    };
  }
  for (const app of catalogue) {
    const slug = typeof app?.slug === 'string' && app.slug !== '' ? app.slug : null;
    const url = typeof app?.url === 'string' && app.url !== '' ? app.url : null;
    if (slug === null || url === null) {
      problems.push(`a catalogue row has no ${slug === null ? 'slug' : 'url'}: ${JSON.stringify(app).slice(0, 120)}`);
      continue;
    }
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      problems.push(`the catalogue row for "${slug}" carries a url that will not parse: ${JSON.stringify(url)}`);
      continue;
    }
    // Published on its own hostname: that is a `hosts` row, not a path monitor.
    if (host !== APEX_HOST) continue;
    // The address, re-derived. A trailing slash on both sides so that
    // `https://nikatru.com/x` and `https://nikatru.com/x/` cannot be two facts.
    const composed = `${publicAppUrl(slug)}/`;
    const declared = `${url.replace(/\/+$/, '')}/`;
    if (composed !== declared) {
      problems.push(
        `the catalogue publishes "${slug}" at ${declared} and tooling/sites/apex.mjs composes ${composed} from that same id. ` +
          'The catalogue url is supposed to BE publicAppUrl(id) — tooling/app-yaml/render.mjs writes it that way — so a ' +
          'difference here means the catalogue was hand-edited away from its own generator, and every address derived ' +
          'from either side is now a coin toss.',
      );
      continue;
    }
    expected.set(composed, {
      slug,
      url: composed,
      // What `flutter build web --base-href /<id>/` writes into the shell in
      // place of $FLUTTER_BASE_HREF. The one byte sequence in the served page
      // that exists only if a real build ran, with the right base href.
      expectedBody: `<base href="${appBaseHref(slug)}">`,
    });
  }
  return { expected, problems };
}

/** Shorten a body for a message without ever hiding that it was shortened. */
export const showBody = (v) => {
  const s = typeof v === 'string' ? v : '';
  return s === '' ? '(none)' : JSON.stringify(s.length > 120 ? `${s.slice(0, 120)}…` : s);
};

/**
 * THE APP-PATH LIMB, TREE HALF — pure, offline, and deliberately BEFORE the
 * token check in `main()` below.
 *
 * 🔴 WHY IT RUNS WITHOUT A CREDENTIAL. Everything it grades is a disagreement
 * between two things IN THIS REPOSITORY — what the register records and what
 * catalog/apps.json plus tooling/sites/apex.mjs compose — so making it wait for
 * a network token would mean a retyped or stale address sitting green on every
 * runner that has none, and only ever failing inside the scheduled job. It would
 * also be untestable: a limb reachable only through a live instance is a limb
 * whose failing case nobody has ever seen, which is the exact defect
 * tooling/ci/test/ops-verifiers.test.mjs was written about.
 *
 * Returns `{ problems, notes, entries }`. `entries` are the ones that survived
 * and are worth asking the live instance about.
 */
export function gradePathMonitorsAgainstTree(rows, expected) {
  const problems = [];
  const notes = [];
  const entries = [];
  const covered = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const list = row?.pathMonitors;
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) {
      problems.push(`${row.hostname} — \`pathMonitors\` is ${typeof list}, not an array. The shape changed underneath this reader, which would otherwise check nothing and print ok.`);
      continue;
    }
    for (const [i, pm] of list.entries()) {
      const at = `${row.hostname} → pathMonitors[${i}]`;
      const missing = [];
      if (typeof pm?.id !== 'number') missing.push('id (a number)');
      if (typeof pm?.name !== 'string' || pm.name === '') missing.push('name');
      if (typeof pm?.type !== 'string' || pm.type === '') missing.push('type');
      if (typeof pm?.url !== 'string' || pm.url === '') missing.push('url');
      if (pm === null || typeof pm !== 'object' || !('verifiedOn' in pm)) missing.push('verifiedOn (YYYY-MM-DD, or null with a stated reason)');
      if (missing.length) {
        problems.push(`${at} — the claim is incomplete: no ${missing.join(', no ')}. An unnamed, undated claim about a live system is a claim nobody can check.`);
        continue;
      }
      // NOT a failure on its own: an entry may legitimately be recorded before
      // the live PUT lands, and the live half is what goes red then. PRINTED so
      // "never verified" can never be silent.
      if (pm.verifiedOn === null) {
        notes.push(`${at} — monitor ${pm.id} "${pm.name}" records verifiedOn: null; these assertions have never been read off the live instance.`);
      }
      let declaredHost = null;
      try {
        declaredHost = new URL(pm.url).hostname.toLowerCase();
      } catch {
        problems.push(`${at} — \`url\` ${JSON.stringify(pm.url)} will not parse as a URL.`);
        continue;
      }
      if (declaredHost !== String(row.hostname).toLowerCase()) {
        problems.push(`${at} — the entry watches ${declaredHost} and is filed under ${row.hostname}. A path monitor belongs to the row for the host that serves the path, or the row is a claim about a different machine.`);
        continue;
      }
      const want = expected.get(pm.url);
      if (!want) {
        problems.push(
          `${at} — no app in catalog/apps.json is published at ${pm.url}. The apps published on ${APEX_HOST} today are ` +
            `${expected.size === 0 ? 'NONE' : [...expected.keys()].join(', ')}. Either the app was retired and this entry ` +
            'did not follow, or the address was TYPED here rather than derived — and a typed address is one a rename ' +
            'moves on one side only.',
        );
        continue;
      }
      covered.add(pm.url);
      if (pm.expectedBody !== want.expectedBody) {
        problems.push(
          `${at} — the register records expectedBody ${showBody(pm.expectedBody)} and catalog/apps.json plus ` +
            `tooling/sites/apex.mjs compose ${showBody(want.expectedBody)} for "${want.slug}". The base href a Flutter ` +
            'web build is compiled with IS the app id, so a disagreement here is a monitor asserting a string the build ' +
            'no longer writes: green on a shell that is not this app, red on the one that is.',
        );
        continue;
      }
      entries.push({ at, row, pm, want });
    }
  }
  // ── the other direction: the set cannot silently shrink ──────────────────
  // The limb above can only grade entries that EXIST. An app published on the
  // apex with no entry at all is the failure that reports nothing.
  for (const [url, want] of expected) {
    if (covered.has(url)) continue;
    problems.push(
      `catalog/apps.json publishes "${want.slug}" at ${url} and NO \`pathMonitors\` entry in the register covers it. ` +
        "An app whose public address nobody declared is an app nobody decided about — and the apex row's own monitor " +
        'cannot stand in for it: it watches `/`, which is 200 while every app underneath it is a 404.',
    );
  }
  return { problems, notes, entries };
}

/**
 * THE SCRIPT — wrapped in a function so this module can be IMPORTED without
 * performing a live reconciliation.
 *
 * ⚠️ ADDED 2026-09-09 AND IT IS NOT COSMETIC. `deriveApexAppMonitors` above is
 * the app-path limb's whole judgement, and a judgement no test can reach is a
 * judgement nobody has exercised — the failure this file's own test header is
 * written about. Until this wrapper existed, `import { deriveApexAppMonitors }`
 * ran the entire script at import time and exited 2 before the first assertion.
 * Same shape as tooling/ops/post-deploy-smoke.mjs, which has always had it.
 *
 * Nothing about the exit contract moves: every `process.exit()` and
 * `process.exitCode` below is where it was, and the two cases in
 * tooling/ci/test/ops-verifiers.test.mjs that spawn this file still spawn it.
 */
async function main() {
const BASE = (process.env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').replace(/\/+$/, '');
const ORG = process.env.GLITCHTIP_ORG ?? 'nikatru';
const TOKEN = process.env.GLITCHTIP_TOKEN;

const register = JSON.parse(readFileSync(REGISTER, 'utf8'));
const rows = Array.isArray(register.hosts) ? register.hosts : [];
if (rows.length === 0) {
  console.error('✗ tooling/monitor-register.json declares no hosts — nothing to reconcile.');
  process.exit(1);
}

// ── the app-path expectation, derived BEFORE the token check ────────────────
// Deliberately here, ahead of the network: it needs no credential, and a tree
// this file cannot derive an expectation from is a COVERAGE LOST that must be
// reported even on a runner with no token — otherwise the day the catalogue
// breaks is a day this file reports "I could not look" for the wrong reason.
// `process.exit()` is safe on this path for the reason the block above gives:
// no request has been made yet.
let catalogueText;
try {
  catalogueText = readFileSync(CATALOGUE, 'utf8');
} catch (err) {
  console.error(`✗ COVERAGE LOST — catalog/apps.json could not be read (${err.message}).`);
  console.error('   It is the right-hand side of the app-path limb: without it this file cannot tell whether the');
  console.error('   register\'s `pathMonitors` describe the apps this repository actually publishes, and it would');
  console.error('   otherwise reconcile the hostname rows and print ok over a limb that checked nothing.');
  process.exit(2);
}
const { expected: expectedPathMonitors, problems: derivationProblems, unreadable: derivationLost } =
  deriveApexAppMonitors(catalogueText);
if (derivationLost) {
  console.error('✗ COVERAGE LOST — the app-path expectation could not be derived:');
  for (const p of derivationProblems) console.error(`   ${p}`);
  process.exit(2);
}

// ── THE APP-PATH LIMB, TREE HALF — also ahead of the token check ────────────
// It grades the register against catalog/apps.json and tooling/sites/apex.mjs,
// which are both in this repository, so a credential adds nothing to it and
// waiting for one would leave a retyped address green on every runner without a
// token. Exit 1, not 2: this is "I looked and it was wrong", and what was looked
// at is the tree.
const { problems: treeProblems, notes: pathNotes, entries: pathEntries } =
  gradePathMonitorsAgainstTree(rows, expectedPathMonitors);
for (const n of pathNotes) console.log(`--   ${n}`);
if (derivationProblems.length > 0 || treeProblems.length > 0) {
  console.error('');
  for (const p of derivationProblems) console.error(`✗ catalog/apps.json — ${p}`);
  for (const p of treeProblems) console.error(`✗ ${p}`);
  console.error('');
  console.error('   Every line above is a disagreement between two things in THIS repository, so the live instance');
  console.error('   was not contacted: there is nothing coherent to reconcile it against yet. Fix the tree, then');
  console.error('   re-run with a token.');
  process.exit(1);
}

if (!TOKEN) {
  console.error('⬜ GLITCHTIP_TOKEN is not set, so the live instance was NOT contacted.');
  console.error('   Exit code 2, deliberately distinct from 1: "I could not look" must never be readable');
  console.error('   as "I looked and it was fine". Source the token from the local vault and re-run.');
  process.exit(2);
}

// See the note above: from here on a request has been made, so `process.exit()`
// would crash libuv on Windows and report 127. This region is wrapped so it can
// `return` and set `process.exitCode` instead.
await (async () => {
let live;
try {
  // ⏱ 2026-09-21 — BOUNDED RETRY (tooling/ops/bounded-retry.mjs). Un-retried until
  // today, so one dropped connection to the Oracle box exited 2 and reddened
  // ops-watch, which reddens ci-gate on `main` — row
  // O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause. Every branch below still
  // exits 2 and none of them becomes a pass: the retry tells a blip from an
  // outage, it forgives neither.
  //
  // NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
  // request carrying one with error 1000 before the origin is reached. Recorded
  // here because this is a hand-rolled request and the mistake is cheap to make.
  const res = await fetchWithBoundedRetry(
    ({ signal }) =>
      fetch(`${BASE}/api/0/organizations/${ORG}/monitors/`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
        signal,
      }),
    { describe: (why) => `the monitor list: ${why}` },
  );
  // ⏱ 2026-09-11 — EVERY BRANCH BELOW IS "I COULD NOT LOOK", SO EVERY ONE IS EXIT 2.
  // All three used to set exit 1, the code this file gives "the register and the
  // live monitors DISAGREE". An expired token, a 5xx from the Oracle box, a DNS
  // failure and a changed API shape were therefore reported as monitor DRIFT —
  // a finding about the register that nobody could fix in the register.
  if (!res.ok) {
    console.error(`✗ COULD NOT LOOK — GlitchTip returned ${res.status} ${res.statusText} for the monitor list.`);
    console.error('  A 401 means the token is wrong or expired; a 5xx means the Oracle box is unwell —');
    console.error('  which is itself the E-9b single point of failure showing its face.');
    console.error('  Exit 2, not 1: nothing was reconciled, so nothing can have drifted.');
    process.exitCode = 2;
    return;
  }
  live = await res.json();
} catch (err) {
  console.error(`✗ COULD NOT LOOK — could not read the monitor list from ${BASE}: ${err.message}`);
  console.error('  Exit 2, not 1: nothing was reconciled, so nothing can have drifted.');
  process.exitCode = 2;
  return;
}

if (!Array.isArray(live)) {
  console.error('✗ COULD NOT LOOK — the monitor list was not an array; the API shape changed and this script cannot reconcile.');
  console.error('  Exit 2, not 1: nothing was reconciled, so nothing can have drifted.');
  process.exitCode = 2;
  return;
}

const byId = new Map(live.map((m) => [m.id, m]));
const accountedFor = new Set();
const problems = [];
const gaps = [];
let matched = 0;

for (const row of rows) {
  const m = row.monitor;
  if (m == null) {
    gaps.push(`${row.hostname} — ${row.gap?.why ?? 'no reason recorded'}`);
    continue;
  }
  const found = byId.get(m.id);
  if (!found) {
    problems.push(
      `${row.hostname} — the register claims monitor id ${m.id} ("${m.name}") and the live instance has no such monitor. The register is describing something that is not there.`,
    );
    continue;
  }
  accountedFor.add(m.id);
  const liveHost = (() => {
    try {
      return new URL(found.url).hostname.toLowerCase();
    } catch {
      return null;
    }
  })();
  // A HEARTBEAT monitor has no url by design, so host comparison does not apply
  // to it; every other type must actually be pointed at the host it is filed
  // under, or the row is a claim about a different machine.
  if (liveHost !== null && liveHost !== row.hostname.toLowerCase()) {
    problems.push(
      `${row.hostname} — monitor id ${m.id} is pointed at ${liveHost}, not at ${row.hostname}. The row says this host is watched; the live monitor is watching a different one.`,
    );
    continue;
  }
  if (typeof found.monitorType === 'string' && found.monitorType !== m.type) {
    problems.push(
      `${row.hostname} — monitor id ${m.id} is type "${found.monitorType}" live and "${m.type}" in the register.`,
    );
    continue;
  }
  // ── the DECLARED-BODY limb ────────────────────────────────────────────────
  // A body assertion is the difference between "the door opened" and "the thing
  // behind it is ours": a Cloudflare edge error page, a Pages 404, an empty
  // deploy and a cross-wired Pages project all answer 200. Until 2026-08-11
  // nothing here read `expectedBody`, so the register could carry one the live
  // monitor did not have — a claim about a check that is not running, which
  // reads on this script's own stdout as `ok`.
  //
  // Compared only when the REGISTER declares one. A row that declares no body
  // asserts none, so this cannot false-red on monitors 1 and 2, whose live
  // `expectedBody` has never been read off the API. It can still fail, and its
  // failing case is one line: change the body on the live monitor without
  // changing the row here (or the row without the monitor) and this exits 1.
  if (typeof m.expectedBody === 'string' && m.expectedBody !== '') {
    const liveBody = typeof found.expectedBody === 'string' ? found.expectedBody : '';
    if (liveBody !== m.expectedBody) {
      const show = (s) => (s === '' ? '(none)' : JSON.stringify(s.length > 120 ? `${s.slice(0, 120)}…` : s));
      problems.push(
        `${row.hostname} — monitor id ${m.id} declares expectedBody ${show(m.expectedBody)} in the register and the ` +
          `live monitor carries ${show(liveBody)}. A body assertion that exists only in the register is a claim ` +
          'about a check nobody is running: the live monitor is still green on a blank shell.',
      );
      continue;
    }
  }
  matched++;
  const state = found.isUp === false ? 'DOWN' : 'up';
  console.log(`ok   ${row.hostname} — monitor ${m.id} "${found.name}" (${found.monitorType}, every ${found.interval}s) is ${state}`);
}

let pathMatched = 0;
// ── THE APP-PATH LIMB, LIVE HALF — [ADR 075] ──────────────────────────
// The TREE half ran before the token check and has already refused anything the
// catalogue does not produce, so every entry reaching here is one whose address
// and body assertion are the derived ones. What is left is the same four
// questions a `monitor` gets, asked of the live instance.
for (const { at, pm } of pathEntries) {
  const found = byId.get(pm.id);
  if (!found) {
    problems.push(`${at} — the register claims monitor id ${pm.id} ("${pm.name}") and the live instance has no such monitor. The register is describing something that is not there.`);
    continue;
  }
  accountedFor.add(pm.id);
  const liveUrl = typeof found.url === 'string' ? found.url.replace(/\/+$/, '') : '';
  if (liveUrl !== pm.url.replace(/\/+$/, '')) {
    problems.push(
      `${at} — monitor id ${pm.id} is pointed at ${JSON.stringify(found.url ?? null)} live and the register records ` +
        `${JSON.stringify(pm.url)}. A path monitor is only a path monitor because of its PATH: a live monitor left on the ` +
        'apex root, or on the retired subdomain, answers 200 for a deploy that never shipped this app.',
    );
    continue;
  }
  if (typeof found.monitorType === 'string' && found.monitorType !== pm.type) {
    problems.push(`${at} — monitor id ${pm.id} is type "${found.monitorType}" live and "${pm.type}" in the register.`);
    continue;
  }
  if (typeof pm.expectedBody === 'string' && pm.expectedBody !== '') {
    const liveBody = typeof found.expectedBody === 'string' ? found.expectedBody : '';
    if (liveBody !== pm.expectedBody) {
      problems.push(
        `${at} — monitor id ${pm.id} declares expectedBody ${showBody(pm.expectedBody)} in the register and the live ` +
          `monitor carries ${showBody(liveBody)}. A body assertion that exists only in the register is a claim about a ` +
          'check nobody is running: the live monitor is still green on a blank shell.',
      );
      continue;
    }
  }
  pathMatched++;
  const state = found.isUp === false ? 'DOWN' : 'up';
  console.log(`ok   ${pm.url} — monitor ${pm.id} "${found.name}" (${found.monitorType}, every ${found.interval}s) is ${state}`);
}

const unaccounted = live.filter((m) => !accountedFor.has(m.id));
for (const m of unaccounted) {
  // Not a failure: a heartbeat monitor (the laptop backup) legitimately has no
  // hostname to file under. Printed so the two sets stay comparable by eye.
  console.log(`--   live monitor ${m.id} "${m.name}" (${m.monitorType}) is not filed under any hostname in the register`);
}
if (gaps.length) {
  console.log(`--   ${gaps.length} declared hostname(s) with NO monitor — the same gap the CI guard prints:`);
  for (const g of gaps) console.log(`       ${g}`);
}

console.log(
  `\nverify-monitors — ${matched} of ${rows.length} declared host(s) reconciled against ${live.length} live monitor(s); ` +
    `${pathMatched} of ${expectedPathMonitors.size} app path(s) on ${APEX_HOST} reconciled; ` +
    `${gaps.length} gap(s), ${unaccounted.length} live monitor(s) not filed under a hostname, ${problems.length} drift(s)`,
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  process.exitCode = 1;
}
})();
}

// Run only when this file IS the entry point. An `import` of it — which is how
// the app-path derivation is tested — must not reconcile anything, must not
// read a token and must not exit.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
