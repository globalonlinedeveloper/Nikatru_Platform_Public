#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// status.mjs — ONE COMMAND THAT ANSWERS "IS ANYTHING BROKEN RIGHT NOW?"
//
// [pipeline O-2] "One command answers 'is anything broken now?', delivered
// unasked on a cadence." This file is the command; .github/workflows/ops-watch.yml
// is the "unasked on a cadence" half.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 "HEALTHY" MEANS THE SURFACE PRODUCED ITS EXPECTED OUTPUT. NOT THAT A SOCKET
// OPENED. This is the whole reason the file exists, and it is not pedantry — it
// was measured. Three live GlitchTip monitors were type `Ping` until 2026-08-11
// (ids 3, 4 and 5, converted to GET+expectedStatus that day), and a Ping on a
// Pages host is green while the app behind it serves a 500, a blank shell, or
// has emitted nothing, ever. So every surface this command probes is
// asserted with a GET AND the status the register declares it should answer,
// and every DATA-BEARING surface is additionally asserted to return a body that
// carries something. `platform`, `config` and `api` all answer `{"ok":true}`
// today while `events` and `consent_artifacts` hold ZERO rows: a green door and
// an empty room are different facts and this command must not conflate them.
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE IS A RELATIONSHIP, NEVER A COUNT, AND THE SET IS NOT MINE.
// The probed set is DERIVED from tooling/monitor-register.json — [11]E-9's
// register, whose own header says "[14]O-2 must CONSUME this register rather
// than re-enumerate the hostnames", and whose derivation (Worker custom domains
// ∪ the app catalogue ∪ every site's canonical URL ∪ one declared observability
// host) is strictly WIDER than anything that could be typed here. Two
// enumerations of one list is how the ceiling budget came to disagree with
// itself by 5x. There is no hostname literal anywhere below.
//
// The relationship enforced, and every limb of it has a recorded failing input:
//   · the delegate exists, parses, and declares a NON-EMPTY `hosts` array;
//   · every row carries a hostname, and no hostname twice;
//   · every row's `derivedFrom` names one of the register's OWN `_derivation`
//     keys — a row whose provenance is unstated is a row nothing derived;
//   · EVERY declared `_derivation` key contributes at least one row. This is the
//     "yields fewer rows than it declares" limb and it is the one that matters:
//     a source that silently stops yielding makes "every surface is healthy"
//     true of a smaller world, and still prints ok. That exact defect shipped
//     here before — check-migrations.mjs went from 5 files to 4 and reported
//     PASS.
// Any of those is COVERAGE LOST and exits 2. When coverage is lost NOTHING is
// probed and NOTHING is reported healthy: a partial set that still prints ok is
// the failure being guarded against, not a degraded mode of it.
//
// ─────────────────────────────────────────────────────────────────────────────
// FAIL CLOSED, EVERYWHERE. A non-200 (or whatever the register declares), a
// timeout, a DNS failure, an aborted request, a body that is not JSON, a body
// that carries nothing, or a probe that did not run at all are ALL failures.
// None of them is a skip. "I could not tell" must never read as "it is fine" —
// that is precisely how eighteen of this stage's acceptance criteria became
// unfalsifiable, and it is check-heartbeats.mjs's reasoning applied to HTTP.
//
// ⚠️ THERE IS NO CREDENTIAL HERE AND THAT IS DELIBERATE, NOT AN OMISSION. Every
// hostname in the delegate is a public surface that answers an unauthenticated
// GET, so requiring a token would invent a failure mode this command does not
// have — and a required-but-unused secret is exactly the kind of check that
// silently starts skipping. What IS enforced is the environment this command
// needs in order to LOOK: an unreadable `--probes-file`, an absent or
// unparseable register, or a transport that cannot complete are all refusals to
// answer, and they exit 2 rather than 1.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXIT CODES — "unhealthy" and "could not look" are DIFFERENT, the
// verify-monitors.mjs precedent:
//   0  every probed surface answered as the register declares it should.
//   1  at least one probed surface is UNHEALTHY. I looked, and it is broken.
//   2  I COULD NOT LOOK — coverage lost, or the inputs to the run are unusable.
//      Never collapse 2 into 1: "the register is gone" and "the API is down" get
//      different responses, and collapsing them is how "nothing was checked"
//      comes to look like "something was checked and failed".
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT PRINTS AND NEVER BLOCKS. A declared hostname whose monitor is absent, is
// not a GET, or is a GET with no expectedStatus cannot be probed, and the count
// PRINTS on every single run — gap or no gap. "0 unprobeable" and "5
// unprobeable" must never read identically; that is the only thing keeping the
// gap visible. The number is deliberately NOT written down here: it was `Five`
// from 2026-08-03, and by 2026-08-05 it was three (monitors 11 and 12 were
// created for platform and config) with nothing in this paragraph saying so.
// The count is computed below and printed; a second copy of it in prose is a
// claim that goes stale silently, which is this file's own subject.
//
// AS OF 2026-08-11 IT IS ZERO — monitors 3, 4 and 5 were converted from `Ping`
// to GET+expectedStatus 200 on the live instance, so all seven declared
// hostnames are probed. That gap was owner-gated in writing and was not:
// converting a monitor takes the vault GLITCHTIP_TOKEN and one PUT, the same
// disproof monitor-register.json already records for CREATING one. It stays
// non-blocking because the honest reason survives — a guard that failed CI on a
// change to somebody's monitoring instance would be disabled, and a disabled
// guard checks nothing (CLAUDE.md's C-6 rule).
//
// ⚠️ NO THRESHOLD IS ASSERTED AND NONE IS INVENTED. No SLA, no latency budget,
// no "N consecutive failures", no retries. How many failures should page, and
// how fast, has no derivable answer in this repository — monitor-register.json's
// own header says so, and inventing one here would create a number nobody can
// defend. The ONE arbitrary constant in this file is PROBE_TIMEOUT_MS, declared
// as arbitrary at its definition, on the MAX_AGE_DAYS = 14 precedent.
//
// Offline testing: --probes-file <json> [--root <dir>] injects probe results and
// a fixture tree, so every decision branch is exercised with no network. It
// prints a loud banner so its presence in a real ops-watch log is unmistakable.
//
// Usage:  node tooling/ops/status.mjs [--root <repoRoot>] [--probes-file <json>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** [11]E-9's register. This command owns no hostname list; it owns the reading. */
const DELEGATE_REL = 'tooling/monitor-register.json';

/**
 * ⚠️ THE ONE ARBITRARY CONSTANT IN THIS FILE, and it is recorded as arbitrary —
 * the assert-platform-proof-fresh.mjs `MAX_AGE_DAYS = 14` precedent. It is NOT
 * a latency budget and must never be cited as one: nothing here asserts that a
 * surface is fast. It exists for exactly one reason — a surface that never
 * answers must not hang the run forever, because a job that hangs is a job that
 * gets cancelled, and a cancelled job reports nothing at all. Ten seconds is
 * long enough that a cold Worker start is not an alarm. One number, changed
 * deliberately.
 */
const PROBE_TIMEOUT_MS = 10_000;

export const EXIT_OK = 0;
export const EXIT_UNHEALTHY = 1;
export const EXIT_CANNOT_LOOK = 2;

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That off-by-one shipped once in this repo and blocked both production deploys
// with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

/**
 * The probed set, DERIVED from the delegate register — never a list in this
 * file. Returns { surfaces, gaps, problems }.
 *
 *   surfaces  rows the register describes well enough to PROBE: a GET monitor
 *             carrying an expectedStatus. Each becomes an assertion.
 *   gaps      rows it does not: no monitor, a non-GET monitor, or a GET monitor
 *             with no expectedStatus. These PRINT and never block.
 *   problems  COVERAGE LOST. When this is non-empty the other two are EMPTY, on
 *             purpose: reporting on part of a set you could not fully read is
 *             how "clean" gets printed over a shrinking world.
 *
 * ⚠️ WHICH SURFACES ARE DATA-BEARING COMES FROM THE REGISTER, NOT FROM A LIST
 * TYPED HERE: a row is data-bearing exactly when its monitor declares a `path`.
 * A monitor pointed at a specific endpoint is the register saying "this surface
 * is checked at an endpoint, not at a door" — the door test is `expectedStatus`
 * and every row gets it; the endpoint test is the body and only these get it.
 * The alternative — `['api.nikatru.com', 'platform.nikatru.com', …]` written
 * here — was rejected: it is a second enumeration of the delegate's set, it goes
 * stale the first time a host is added, and its staleness is silent.
 */
export function deriveSurfaces(root) {
  const problems = [];
  const surfaces = [];
  const gaps = [];
  const lost = (m) => problems.push(`COVERAGE LOST — ${m}`);
  const nothing = () => ({ surfaces: [], gaps: [], problems });

  const path = join(root, ...DELEGATE_REL.split('/'));
  if (!existsSync(path)) {
    lost(
      `${DELEGATE_REL} does not exist. It is the delegate that owns the hostname set ([11]E-9), so without ` +
        'it this command has nothing to probe — and probing nothing successfully is exit 0 over an empty world.',
    );
    return nothing();
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    lost(`${DELEGATE_REL} could not be parsed (${e.message}). An unreadable delegate is an unknown set, and an unknown set is not an empty one.`);
    return nothing();
  }

  const hosts = Array.isArray(reg?.hosts) ? reg.hosts : null;
  if (hosts === null) {
    lost(`${DELEGATE_REL} declares no \`hosts\` array. The shape changed underneath this reader and it would otherwise probe zero surfaces and report healthy.`);
    return nothing();
  }
  if (hosts.length === 0) {
    lost(`${DELEGATE_REL} declares ZERO hosts. An empty register accepts any deployment at all, including one with no surface being watched whatsoever.`);
    return nothing();
  }

  // The register's own declared sources. `_why`-style meta keys are excluded by
  // the leading underscore convention the registers already use.
  const sources = Object.keys(reg?._derivation ?? {}).filter((k) => !k.startsWith('_'));
  if (sources.length === 0) {
    lost(
      `${DELEGATE_REL} declares no \`_derivation\` sources. Without them there is nothing to check the rows AGAINST, ` +
        'so "every declared surface" would mean "every row somebody remembered to leave in the file".',
    );
    return nothing();
  }

  const rowsPerSource = new Map(sources.map((s) => [s, 0]));
  const seen = new Set();

  for (const row of hosts) {
    const hostname = typeof row?.hostname === 'string' ? row.hostname.trim().toLowerCase() : '';
    if (hostname === '') {
      lost(`a row in ${DELEGATE_REL} carries no hostname: ${JSON.stringify(row)?.slice(0, 160)}. A surface with no name cannot be probed and must not be quietly dropped from the set.`);
      continue;
    }
    if (seen.has(hostname)) {
      lost(`${DELEGATE_REL} declares ${hostname} twice. Two rows for one hostname is two answers to "is it healthy", and this command would report whichever it read last.`);
      continue;
    }
    seen.add(hostname);

    const source = row.derivedFrom;
    if (typeof source !== 'string' || !rowsPerSource.has(source)) {
      lost(
        `${hostname} records \`derivedFrom\`: ${JSON.stringify(source)}, which is not one of the register's own ` +
          `\`_derivation\` keys (${sources.join(', ')}). A row whose provenance is unstated is a row nothing derived — ` +
          'it cannot be checked against the tree, so the set it belongs to cannot be trusted to be complete.',
      );
      continue;
    }
    rowsPerSource.set(source, rowsPerSource.get(source) + 1);

    const m = row.monitor;
    if (m === null || m === undefined) {
      gaps.push({
        hostname,
        kind: 'no-monitor',
        why: typeof row.gap?.why === 'string' && row.gap.why.trim() !== '' ? row.gap.why : 'no monitor, and no reason recorded',
        action: row.gap?.action ?? null,
      });
      continue;
    }
    if (m.type !== 'GET') {
      gaps.push({
        hostname,
        kind: 'not-a-get',
        why: `monitor ${m.id} is type "${m.type}" — a ping proves a socket opened, not that the surface produced its expected output.`,
        action: `PUT /api/0/organizations/<org>/monitors/${m.id}/ with monitorType GET and an expectedStatus, then record it here. Agent-doable with the vault GLITCHTIP_TOKEN — done for ids 3, 4 and 5 on 2026-08-11 — so this is not an owner item.`,
      });
      continue;
    }
    if (typeof m.expectedStatus !== 'number') {
      gaps.push({
        hostname,
        kind: 'no-expected-status',
        why: `monitor ${m.id} is a GET but declares no expectedStatus, so there is nothing to assert the answer against.`,
        action: `Read monitor ${m.id}'s expectedStatus off the live instance and record it here; if it has none, set one.`,
      });
      continue;
    }

    const declaredPath = typeof m.path === 'string' && m.path.trim() !== '' ? m.path.trim() : null;
    surfaces.push({
      hostname,
      what: typeof row.what === 'string' ? row.what : '',
      derivedFrom: source,
      monitorId: m.id,
      url: `https://${hostname}${declaredPath ?? '/'}`,
      expectedStatus: m.expectedStatus,
      dataBearing: declaredPath !== null,
    });
  }

  // ⚠️ THE LIMB THAT CATCHES A SHRINKING WORLD. Every source the register
  // DECLARES must actually contribute a row. Losing the last row of a source
  // does not make this command fail on any individual surface — it makes it
  // quietly stop covering a whole class of them and still print ok, which is
  // this repository's single most repeated defect.
  for (const [source, n] of rowsPerSource) {
    if (n === 0) {
      lost(
        `${DELEGATE_REL} declares the derivation source "${source}" and NOT ONE row comes from it. ` +
          'Either that source stopped yielding hostnames or its rows were removed; either way the set this ' +
          'command probes just got smaller than the set the register claims to describe, and every surface ' +
          'in it would still have been reported healthy.',
      );
    }
  }

  if (problems.length) return nothing();
  return { surfaces, gaps, problems };
}

/**
 * THE DECISION, KEPT PURE — no network, no clock, no filesystem.
 *
 * `surface` is one entry from deriveSurfaces().surfaces; `probe` is what the
 * transport got back: `{ status, body }`, or `{ error }`, or nothing at all.
 *
 * Every path out of here that is not `ok: true` is RED. There is no third
 * state, and in particular there is no "skipped": a probe that did not happen
 * is the strongest possible reason to refuse to say the surface is fine.
 */
export function evaluateSurface(surface, probe) {
  const at = `${surface.hostname} (GET ${surface.url})`;

  if (probe === null || probe === undefined || typeof probe !== 'object') {
    return {
      ok: false,
      kind: 'unreachable',
      reason: `${at}: NO probe result at all. The surface was never contacted, so nothing is known about it — and "unknown" is red here, never a skip.`,
    };
  }
  if (probe.error) {
    return {
      ok: false,
      kind: 'unreachable',
      reason: `${at}: the probe COULD NOT RUN — ${probe.error}. A timeout, a DNS failure or a refused connection is exactly what a dead surface looks like from outside.`,
    };
  }
  if (typeof probe.status !== 'number') {
    return {
      ok: false,
      kind: 'unreachable',
      reason: `${at}: the probe returned no status code (${JSON.stringify(probe.status)}). An answer this reader cannot interpret is a failure, not a pass.`,
    };
  }
  if (probe.status !== surface.expectedStatus) {
    return {
      ok: false,
      kind: 'status',
      reason: `${at}: answered ${probe.status} and the register declares monitor ${surface.monitorId} expects ${surface.expectedStatus}.`,
    };
  }

  // A door that opens. For a surface whose whole job is to be reachable, that
  // is the assertion — and the register said so by declaring no `path`.
  if (!surface.dataBearing) {
    return { ok: true, kind: 'ok', reason: `${at}: answered ${probe.status} as declared` };
  }

  // ── DATA-BEARING: the body has to carry something ──────────────────────────
  const body = probe.body;
  if (typeof body !== 'string' || body.trim() === '') {
    return {
      ok: false,
      kind: 'vacuous',
      reason: `${at}: answered ${probe.status} with an EMPTY body. The status line is not the output; this surface's output IS the body, and there isn't one.`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return {
      ok: false,
      kind: 'unparseable',
      reason:
        `${at}: answered ${probe.status} and the body is NOT JSON (${e.message}): ${body.slice(0, 120).replace(/\s+/g, ' ')}. ` +
        'A 200 carrying an edge error page or an HTML shell is the shape a status-only check calls healthy.',
    };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return {
      ok: false,
      kind: 'vacuous',
      reason: `${at}: answered ${probe.status} with a JSON scalar (${JSON.stringify(parsed)}), not a document. There is no expected output in it to assert.`,
    };
  }
  const values = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const carries = values.some((v) => {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });
  if (!carries) {
    return {
      ok: false,
      kind: 'vacuous',
      reason:
        `${at}: answered ${probe.status} with a body that carries NOTHING — ${body.slice(0, 120).replace(/\s+/g, ' ')}. ` +
        'An empty document is what a surface returns when the thing behind it produced no output at all.',
    };
  }
  return { ok: true, kind: 'ok', reason: `${at}: answered ${probe.status} with a non-vacuous body` };
}

/** The transport. Every failure becomes `{ error }`, which evaluateSurface reds. */
async function probeLive(surface) {
  try {
    // NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
    // request carrying one with error 1000 BEFORE the origin is reached, so a
    // probe that sent it would report every surface down and be believed.
    const res = await fetch(surface.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: '*/*' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Always drained: an unread body holds the socket open, and this runs in a
    // loop over every surface.
    const body = await res.text();
    return { status: res.status, body };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

function printUsage() {
  console.log('Usage: node tooling/ops/status.mjs [--root <repoRoot>] [--probes-file <json>]');
  console.log('');
  console.log('  Answers "is anything broken right now?" over the surfaces derived from');
  console.log(`  ${DELEGATE_REL} — [11]E-9's register, which owns the hostname set.`);
  console.log('');
  console.log('  --root <dir>          read the delegate register from this tree instead of the repo.');
  console.log('  --probes-file <json>  { "<hostname>": { "status": 200, "body": "…" } | { "error": "…" } }');
  console.log('                        OFFLINE: nothing is contacted. Announces itself loudly.');
  console.log('');
  console.log(`  exit ${EXIT_OK} = every probed surface answered as declared`);
  console.log(`  exit ${EXIT_UNHEALTHY} = at least one probed surface is UNHEALTHY (I looked, it is broken)`);
  console.log(`  exit ${EXIT_CANNOT_LOOK} = I COULD NOT LOOK (coverage lost, or the run's inputs are unusable)`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return EXIT_OK;
  }

  const { surfaces, gaps, problems } = deriveSurfaces(ROOT);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('');
    console.error(`    Exit code ${EXIT_CANNOT_LOOK}, deliberately distinct from ${EXIT_UNHEALTHY}: "I could not look" must never be`);
    console.error('    readable as "I looked and everything was fine". NOTHING was probed on this run.');
    return EXIT_CANNOT_LOOK;
  }

  const probesFile = flag('--probes-file');
  let fixture = null;
  if (probesFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --probes-file is set, so NO surface was contacted.');
    console.log('!!  This must NEVER appear in a real ops-watch log.');
    try {
      fixture = JSON.parse(readFileSync(probesFile, 'utf8'));
    } catch (e) {
      console.error(`✗ could not read probe fixture ${probesFile}: ${e.message}`);
      console.error(`    Exit ${EXIT_CANNOT_LOOK} — an unusable input is a refusal to answer, not an empty set of results.`);
      return EXIT_CANNOT_LOOK;
    }
  }

  const failures = [];
  const healthy = [];
  for (const s of surfaces) {
    const probe = fixture ? fixture[s.hostname] : await probeLive(s);
    const verdict = evaluateSurface(s, probe);
    if (verdict.ok) healthy.push(verdict.reason);
    else failures.push(verdict.reason);
  }

  const dataBearing = surfaces.filter((s) => s.dataBearing).length;
  console.log(
    `⬜  probing ${surfaces.length} surface(s) derived from ${DELEGATE_REL} ` +
      `(${dataBearing} data-bearing, i.e. the body is asserted too): ${surfaces.map((s) => s.url).join(', ')}`,
  );
  for (const l of healthy) console.log(`ok  ${l}`);

  // ── the owner-gated gap, printed on EVERY run, WITH ITS COUNT ──────────────
  const declared = surfaces.length + gaps.length;
  if (gaps.length) {
    console.log(`--  ${gaps.length} of ${declared} declared hostname(s) CANNOT BE PROBED from the register — printed not hidden:`);
    for (const g of gaps) console.log(`      ${g.hostname} — ${g.why}${g.action ? ` ACTION: ${g.action}` : ''}`);
    console.log('    This prints rather than failing the build because a guard that reddens every branch on a change');
    console.log('    to somebody else\'s monitoring instance gets disabled, and a disabled guard checks nothing. It is');
    console.log('    NOT a claim that the work is owner-only: creating a monitor (ids 11, 12) and converting one');
    console.log('    (ids 3, 4, 5) were both done with the vault token and the GlitchTip API. It stops being printed');
    console.log('    when it stops being true.');
  } else {
    console.log(`--  0 of ${declared} declared hostname(s) are unprobeable — every one carries a GET and an expectedStatus.`);
  }

  // ── the bound on what a green run here means ───────────────────────────────
  console.log('--  WHAT A GREEN RUN DOES NOT PROVE: a non-vacuous body proves the surface produced its expected');
  console.log('    output. It does NOT prove the pipe behind it carries anything — platform, config and api all');
  console.log('    answer {"ok":true} while events and consent_artifacts hold ZERO rows. That limb is a row count,');
  console.log('    it is not in this command, and this exit code must never be read as covering it.');

  if (failures.length) {
    console.error(`✗ ${failures.length} of ${surfaces.length} probed surface(s) are NOT healthy:`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    console.error(`    Exit ${EXIT_UNHEALTHY} — I looked, and it is broken. [pipeline O-2]`);
    return EXIT_UNHEALTHY;
  }

  console.log(`ok  every probed surface produced its expected output — ${surfaces.length} probed, ${gaps.length} owner-gated gap(s) [pipeline O-2]`);
  return EXIT_OK;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await main());
}
