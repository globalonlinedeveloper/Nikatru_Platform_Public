#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// heartbeat.mjs — the laptop's heartbeat, the one signal the cloud fails over on.
//
// ⏱ 2026-10-02 · lane autopilot-outage, row O-LAPTOP-OUTAGE-READS-AS-RED. The
// laptop stays PRIMARY and writes a beat every 10 minutes; the cloud routines
// (reviewer, runner-a, fixer, runner-b) act only while that beat is older than
// STALE_MIN, and ops grading reads a laptop duty that went quiet DURING a proven
// outage as DEGRADED rather than red (assert-ops-register.mjs, `outageGrade`).
// Every name and number is tooling/autopilot/contract.json; docs/autopilot/
// contract.md is the prose.
//
// THE BEAT. Ref `lead/heartbeat` in THIS repo holds ONE parentless commit whose
// tree is one file, `beat.json`:
//   {"v":1,"at":"<ISO UTC>","seq":<int>,"mode":"primary|handover|drill","host":"laptop"}
// It is written through the git data API (tree → commit → force the ref), the
// same route the `lead/patches` precedent uses. No push trigger in this repo
// matches a non-main branch, so a beat starts nothing.
//
// Usage:
//   write   node tooling/autopilot/heartbeat.mjs write --once|--loop 600 [--mode primary|handover|drill] [--repo o/r]
//           (the owner's laptop, with its existing `gh` auth; one line per beat; never prints a token)
//   read    node tooling/autopilot/heartbeat.mjs read [--source auto|git|api] [--no-fetch] [--repo o/r]
//           prints `<state> age=<min> at=<ISO> mode=<m> seq=<n>`
// Exit (read): 0 fresh · 10 stale · 11 handover · 12 drill-stale · 2 unknown (could not tell).
// Exit (write): 0 every beat written · 1 a beat was refused · 2 bad usage.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { CONTRACT, envToken, flag, ghSpawnSpec, isMain, redact } from './cli.mjs';

export const HB = CONTRACT.heartbeat;
/** STALE_MIN is the queue contract's HEARTBEAT_STALE_MIN: one number, never two. */
export const STALE_MIN = CONTRACT.thresholds.HEARTBEAT_STALE_MIN;
export const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
const [FRESH, STALE, HANDOVER, DRILL_STALE, UNKNOWN] = HB.states;
const [, MODE_HANDOVER, MODE_DRILL] = HB.modes;
export const STATE = Object.freeze({ FRESH, STALE, HANDOVER, DRILL_STALE, UNKNOWN });
export const STATE_EXIT = Object.freeze({ [FRESH]: 0, [STALE]: 10, [HANDOVER]: 11, [DRILL_STALE]: 12, [UNKNOWN]: 2 });

const MIN = 60_000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// ── PURE ────────────────────────────────────────────────────────────────────

/** Text → a valid beat, or null. Anything off-schema is null (→ unknown), never a guess. */
export function parseBeat(text) {
  let b;
  try {
    b = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;
  if (b.v !== HB.schemaVersion) return null;
  if (typeof b.at !== 'string' || !ISO_UTC.test(b.at) || !Number.isFinite(Date.parse(b.at))) return null;
  if (!Number.isInteger(b.seq) || b.seq < 0) return null;
  if (!HB.modes.includes(b.mode)) return null;
  if (b.host !== HB.host) return null;
  return { v: b.v, at: b.at, seq: b.seq, mode: b.mode, host: b.host };
}

/**
 * THE ONE READING OF A BEAT. `beat` is parseBeat's output (or null); `now` ms.
 *   mode=handover                       → handover  (the laptop said it is leaving)
 *   age > STALE_MIN, mode=drill         → drill-stale
 *   age > STALE_MIN                     → stale
 *   age ≤ STALE_MIN                     → fresh
 *   missing, garbled, or `at` more than FUTURE_SKEW_MIN in the future → unknown
 * Unknown is NEVER an outage: every consumer treats it as "do what you do today".
 */
export function laptopState(beat, now = Date.now()) {
  if (!beat) return { state: UNKNOWN, ageMin: null, beat: null, why: 'no readable beat' };
  const at = Date.parse(beat.at);
  if (!Number.isFinite(at)) return { state: UNKNOWN, ageMin: null, beat, why: 'the beat has no readable time' };
  if (at - now > HB.FUTURE_SKEW_MIN * MIN) return { state: UNKNOWN, ageMin: null, beat, why: `the beat is ${Math.round((at - now) / MIN)} min in the future` };
  const ageMin = Math.max(0, (now - at) / MIN);
  if (beat.mode === MODE_HANDOVER) return { state: HANDOVER, ageMin, beat, why: 'the laptop handed over' };
  if (ageMin > STALE_MIN) return { state: beat.mode === MODE_DRILL ? DRILL_STALE : STALE, ageMin, beat, why: `the newest beat is ${Math.round(ageMin)} min old (> ${STALE_MIN})` };
  return { state: FRESH, ageMin, beat, why: `the newest beat is ${Math.round(ageMin)} min old` };
}

/** The one line `read` prints. */
export function stateLine(s) {
  const b = s.beat;
  const age = s.ageMin === null ? '?' : String(Math.round(s.ageMin));
  return `${s.state} age=${age} at=${b?.at ?? '?'} mode=${b?.mode ?? '?'} seq=${b?.seq ?? '?'}${s.state === UNKNOWN ? ` (${s.why})` : ''}`;
}

/** The next beat after `prev` (null on the first, or after a garbled one). */
export function nextBeat(prev, { now = new Date(), mode = HB.modes[0] } = {}) {
  if (!HB.modes.includes(mode)) throw new Error(`--mode must be one of ${HB.modes.join('|')}`);
  return { v: HB.schemaVersion, at: new Date(now).toISOString(), seq: prev ? prev.seq + 1 : 1, mode, host: HB.host };
}

/**
 * THE OUTAGE RULE for one `duty.laptop.*` row the record-query limb graded FAILING.
 * Degraded (printed, not a problem) ONLY on positive evidence: the laptop is
 * `stale` or `handover`, and the row's staleness began no earlier than
 * (beat `at` − one row cadence). Past DEGRADED_MAX_H of outage, the rows in
 * `redPastMaxH` (the offsite backup) are red again. Everything else → not degraded,
 * which leaves today's grading byte for byte.
 *   staleness began = the newest success + the row's own window (the moment the
 *   limb would first have called it stale).
 */
export function outageGrade({ rowId, cadenceMs, windowMs, lastSuccessMs, laptop, nowMs }) {
  const no = (why) => ({ degraded: false, why });
  if (!String(rowId ?? '').startsWith('duty.laptop.')) return no('not a laptop duty');
  if (!laptop || ![STALE, HANDOVER].includes(laptop.state)) return no(`laptop state is ${laptop?.state ?? UNKNOWN}: no outage is proven`);
  const at = Date.parse(laptop.beat?.at ?? '');
  if (!Number.isFinite(at)) return no('the beat has no readable time');
  if (!Number.isFinite(lastSuccessMs) || !Number.isFinite(windowMs) || !Number.isFinite(cadenceMs)) return no('the row has no newest success to date its staleness by');
  const staleSince = lastSuccessMs + windowMs;
  if (staleSince < at - cadenceMs) return no(`stale since ${new Date(staleSince).toISOString()}, before the outage began (${laptop.beat.at} − one cadence): the outage does not excuse an older failure`);
  const outageH = (nowMs - at) / 3_600_000;
  if ((HB.redPastMaxH ?? []).includes(rowId) && outageH > HB.DEGRADED_MAX_H) return no(`the laptop has been off ${outageH.toFixed(1)} h, past DEGRADED_MAX_H (${HB.DEGRADED_MAX_H} h): ${rowId} is red again`);
  return { degraded: true, line: `laptop off since ${laptop.beat.at} (${outageH.toFixed(1)} h): ${rowId} degraded`, why: 'positive evidence of an outage' };
}

// ── I/O: read ───────────────────────────────────────────────────────────────

const API = () => process.env.GITHUB_API_URL || 'https://api.github.com';

/** The beat over the REST contents API; the token is optional (the repo is public). */
export async function readBeatApi({ repo = DEFAULT_REPO, token = null, fetchImpl = globalThis.fetch, timeoutMs = HB.CALL_CEILING_S * 1000 } = {}) {
  const headers = { accept: 'application/vnd.github.raw+json', 'user-agent': 'nikatru-heartbeat', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(`${API()}/repos/${repo}/contents/${HB.file}?ref=${encodeURIComponent(HB.ref)}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { text: null, why: `contents API answered HTTP ${res.status}` };
    return { text: await res.text(), why: null };
  } catch (e) {
    return { text: null, why: `contents API: ${redact(e.message)}` };
  }
}

/** The beat from a local clone: fetch the ref shallowly (unless told not to), then show the file. */
export function readBeatGit({ fetch = true, run = execFileSync } = {}) {
  const opts = { shell: false, windowsHide: true, timeout: HB.CALL_CEILING_S * 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  const local = `refs/remotes/origin/${HB.ref}`;
  try {
    if (fetch) run('git', ['fetch', '--quiet', '--depth=1', 'origin', `+refs/heads/${HB.ref}:${local}`], opts);
    return { text: run('git', ['show', `${local}:${HB.file}`], opts), why: null };
  } catch (e) {
    return { text: null, why: `git: ${redact(String(e.stderr || e.message).trim().split('\n')[0])}` };
  }
}

// ── I/O: write (the laptop) ─────────────────────────────────────────────────

/** `gh api` through ghSpawnSpec: JSON in on stdin, JSON out. Throws with gh's message, redacted. */
export function ghApi(method, path, body = null, { run = execFileSync } = {}) {
  const args = ['api', '--method', method, path];
  if (body !== null) args.push('--input', '-');
  const spec = ghSpawnSpec(args, { input: body === null ? null : JSON.stringify(body) });
  try {
    const out = run(spec.file, spec.args, spec.options);
    return out ? JSON.parse(out) : null;
  } catch (e) {
    throw new Error(`gh api ${method} ${path}: ${redact(String(e.stderr || e.message).trim().split('\n')[0])}`);
  }
}

/** One beat: previous seq → tree → parentless commit → force the ref (create it when missing). */
export function writeBeat({ repo = DEFAULT_REPO, mode, now = new Date(), gh = ghApi } = {}) {
  let prev = null;
  try {
    const cur = gh('GET', `repos/${repo}/contents/${HB.file}?ref=${encodeURIComponent(HB.ref)}`);
    prev = parseBeat(Buffer.from(String(cur?.content ?? ''), 'base64').toString('utf8'));
  } catch {
    prev = null; // the first beat, or a garbled one: seq restarts at 1
  }
  const beat = nextBeat(prev, { now, mode });
  const tree = gh('POST', `repos/${repo}/git/trees`, { tree: [{ path: HB.file, mode: '100644', type: 'blob', content: `${JSON.stringify(beat)}\n` }] });
  const commit = gh('POST', `repos/${repo}/git/commits`, { message: `heartbeat seq=${beat.seq} mode=${beat.mode}`, tree: tree.sha, parents: [] });
  try {
    gh('PATCH', `repos/${repo}/git/refs/heads/${HB.ref}`, { sha: commit.sha, force: true });
  } catch (e) {
    if (!/\b(404|422)\b|not exist|Not Found/i.test(e.message)) throw e;
    gh('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${HB.ref}`, sha: commit.sha });
  }
  return { beat, commit: commit.sha };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(argv) {
  const [cmd] = argv;
  const repo = flag(argv, '--repo', process.env.GITHUB_REPOSITORY || DEFAULT_REPO);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.log(`usage: --repo must be owner/name, got ${JSON.stringify(repo)}`);
    return 2;
  }
  if (cmd === 'read') {
    const source = flag(argv, '--source', 'auto');
    let got = { text: null, why: 'no source tried' };
    if (source === 'git' || source === 'auto') got = readBeatGit({ fetch: !argv.includes('--no-fetch') });
    if (got.text === null && (source === 'api' || source === 'auto')) got = await readBeatApi({ repo, token: envToken() });
    const s = laptopState(parseBeat(got.text), Date.now());
    if (got.text === null) s.why = got.why;
    console.log(stateLine(s));
    return STATE_EXIT[s.state];
  }
  if (cmd === 'write') {
    const mode = flag(argv, '--mode', HB.modes[0]);
    if (!HB.modes.includes(mode)) {
      console.log(`usage: --mode must be one of ${HB.modes.join('|')}`);
      return 2;
    }
    const loopS = argv.includes('--loop') ? Number(flag(argv, '--loop', String(HB.LOOP_S))) : null;
    if (loopS !== null && !(loopS >= 60)) {
      console.log('usage: --loop takes seconds, at least 60');
      return 2;
    }
    if (loopS === null && !argv.includes('--once')) {
      console.log('usage: write --once | --loop <seconds>');
      return 2;
    }
    for (;;) {
      let code = 0;
      try {
        const { beat, commit } = writeBeat({ repo, mode });
        console.log(`beat seq=${beat.seq} mode=${beat.mode} at=${beat.at} commit=${commit.slice(0, 8)}`);
      } catch (e) {
        console.log(`beat REFUSED at=${new Date().toISOString()} — ${redact(e.message)}`);
        code = 1;
      }
      if (loopS === null) return code;
      await sleep(loopS * 1000);
    }
  }
  console.log('usage: heartbeat.mjs read [--source auto|git|api] [--no-fetch] | write --once|--loop <s> [--mode primary|handover|drill]');
  return 2;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
