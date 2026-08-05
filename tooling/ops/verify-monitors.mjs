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
//   · a live monitor no row accounts for                         (register short)
//   · a row with `monitor: null`                                 (the known gap)
//
// ⚠️ NOT RUN BY CI, AND THAT IS THE DESIGN. A CI limb needing a network token
// would either be SKIPPED when the token is absent — and a skipped check reports
// ok, which is the failure this whole stage exists to remove — or it would make
// every build depend on the Oracle box, which is precisely the single point of
// failure E-9b is about. So: an offline guard that always runs, plus this, which
// anybody can re-run by hand. It becomes automatable when GLITCHTIP_TOKEN is a
// repository secret (OWNER_QUEUE S-8); until then it is a command, not a gate.
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
// Exit 1 = drift, or the API could not be reached / authorised.
// Exit 2 = no token supplied — a DIFFERENT exit code from "drift" on purpose,
//          so "I could not look" can never be read as "I looked and it was fine".
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const BASE = (process.env.GLITCHTIP_URL ?? 'https://glitchtip.nikatru.com').replace(/\/+$/, '');
const ORG = process.env.GLITCHTIP_ORG ?? 'nikatru';
const TOKEN = process.env.GLITCHTIP_TOKEN;

const register = JSON.parse(readFileSync(REGISTER, 'utf8'));
const rows = Array.isArray(register.hosts) ? register.hosts : [];
if (rows.length === 0) {
  console.error('✗ tooling/monitor-register.json declares no hosts — nothing to reconcile.');
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
  // NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
  // request carrying one with error 1000 before the origin is reached. Recorded
  // here because this is a hand-rolled request and the mistake is cheap to make.
  const res = await fetch(`${BASE}/api/0/organizations/${ORG}/monitors/`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`✗ GlitchTip returned ${res.status} ${res.statusText} for the monitor list.`);
    console.error('  A 401 means the token is wrong or expired; a 5xx means the Oracle box is unwell —');
    console.error('  which is itself the E-9b single point of failure showing its face.');
    process.exitCode = 1;
    return;
  }
  live = await res.json();
} catch (err) {
  console.error(`✗ could not reach ${BASE}: ${err.message}`);
  process.exitCode = 1;
  return;
}

if (!Array.isArray(live)) {
  console.error('✗ the monitor list was not an array; the API shape changed and this script cannot reconcile.');
  process.exitCode = 1;
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
  matched++;
  const state = found.isUp === false ? 'DOWN' : 'up';
  console.log(`ok   ${row.hostname} — monitor ${m.id} "${found.name}" (${found.monitorType}, every ${found.interval}s) is ${state}`);
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
    `${gaps.length} gap(s), ${unaccounted.length} live monitor(s) not filed under a hostname, ${problems.length} drift(s)`,
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  process.exitCode = 1;
}
})();
