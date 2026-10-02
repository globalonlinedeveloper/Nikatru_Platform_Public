#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// native_auth_proof.mjs — ONE TARGET'S NATIVE SIGN-IN PROOF, on its own device
// (ST-N1g, run by .github/workflows/native-auth-proof.yml).
//
// ⏱ 2026-09-28 · rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT. Box C's GoTrue captchas the password grant,
// and no store build carries a Turnstile site key (ADR 084), so every native
// sign-in answered `captcha_failed` until the platform Worker's native route
// (ST-T7a) and the client that uses it (ST-T7b). A unit test proves the client
// reaches the route; only a device proves a TARGET signs in. This runs
// `integration_test/native_auth_proof_test.dart` on the device named, and:
//
//   1. prints this runner's egress IP, read from Cloudflare's /cdn-cgi/trace on
//      the platform host — the address GoTrue's per-IP limiter must see once
//      Box C keys it on CF-Connecting-IP (the ST-T7a brief's BOX C STEP, P-IP);
//   2. when the proof prints NK_PROOF_AWAIT_CALLBACK, has the OS open
//      com.nikatru.<app>://auth-callback?nk_auth=reset&code=st-n1-invalid with
//      the target's own mechanism (adb / simctl / LaunchServices / xdg-open);
//   3. reads the run's output back: every NK_PROOF step, and on a callback
//      target the line `nk_auth_callback flow=reset outcome=failed`. A missing
//      line fails the run even when `flutter test` exited 0;
//   4. tees every byte `flutter test` prints to --log <path>, ending it with
//      the PROOF_LOG_END line once flutter has exited — tooling/e2e/purge.mjs
//      reads the consent row's install id off it (E2E_PROOF_LOG), and a
//      finished log with none shows this run wrote no row (run 36525783687:
//      all four purges failed on "no consent anon_id resolved");
//   5. kills `flutter test` after SILENCE_LIMIT_MS with no output, so a hung
//      launch (run 36525783687: macOS printed nothing for 40 min after
//      "Failed to foreground app" and the job was cancelled) fails as a named
//      finding with its purge still inside the job's ceiling.
//   6. ⏱ 2026-09-29 (AB-O1-05): when the app's proof suite declares the
//      offline read (it prints OFFLINE_READ_LINE), requires that line too — the
//      list read back with the network off from this target's own store. An app
//      whose suite has no such step is not asked for it; one whose suite has it
//      and whose run did not print it is a finding.
//
// ⏱ 2026-09-29 (AB-E2E-02): also the SCHEDULED native legs' drive —
// e2e.yml's `native` job runs this per target every week, and
// tooling/e2e-leg-register.json `nativeTargets` names it as what proves the
// anonymous and sign-in legs off web. native-auth-proof.yml stays the
// per-auth-change dispatch; both run this file and nothing else.
//
// Windows runs WITHOUT --callback: protocol activation needs the MSIX
// installed, and a runner build is not one, so windows-store keeps
// nativeAuth false until the callback is proven on a device that has it.
//
// ⏱ 2026-09-30 (ADR no.NNN, lead ruling on the second review of #1070):
// --expect-refusal. Production's native route now serves only requests whose
// attestation the platform Worker VERIFIES (Play Integrity, App Attest), and a
// CI emulator, simulator or desktop runner cannot attest. So the scheduled legs
// run this mode: from the target's own runner, it sends production the calls a
// build that cannot attest sends, and PASSES ONLY WHEN EACH IS REFUSED with an
// attestation code and no session comes back (gradeRefusal). A 2xx, or any
// token in an answer, is the gate open and fails the leg. No device build runs:
// what is proved is the gate, and a flaky emulator boot must not redden it.
//
//   node tooling/e2e/native_auth_proof.mjs --app <id> --target <t>
//        [--device <id>] [--callback] [--log <path>] [--expect-refusal]
//        [--stagger-anchor <epoch ms> --stagger-apps <JSON app list>]
//        [--sign-in form|token] [--notification-tap] [--pending-flows skip|run]
//
// Env: E2E_EMAIL, E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL.
// Exit 0 = every step read back · 1 = a step failed or is missing · 2 = the
// run could not start (bad arguments, a missing define).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROOF_LOG_END } from './consent_anon_id.mjs';

const NAME = 'native_auth_proof';

export const TARGETS = ['android', 'ios', 'macos', 'windows', 'linux'];
export const PROOF_TEST = 'integration_test/native_auth_proof_test.dart';
export const AWAIT_MARKER = 'NK_PROOF_AWAIT_CALLBACK';
export const FAILED_CALLBACK_LINE = 'nk_auth_callback flow=reset outcome=failed';
export const TRACE_URL = 'https://platform.nikatru.com/cdn-cgi/trace';
/** How long `flutter test` may print nothing before the proof calls it hung.
 *  The longest silent stretch of a healthy run is a cold Gradle build (≈ 4.5
 *  min in run 36525783687); an iOS xcodebuild is the next. */
export const SILENCE_LIMIT_MS = 20 * 60_000;

export const OFFLINE_READ_LINE = 'NK_PROOF step=offline-read outcome=ok';

// ⏱ 2026-10-01 · train st-e2e-parity (EN-07, XP-02). The device leg OPENS THE
// APP again and walks the core flow (integration_test/flow_steps.dart,
// walkCoreFlow): add a weekly plan → read it back → edit its price → pause →
// delete → Undo → delete. Every line below is required of a run whose suite
// calls walkCoreFlow, in this order; flow_steps.dart kCoreFlowLines is the
// other copy, held equal by tooling/ci/test/e2e-parity.test.mjs.
export const CORE_FLOW_LINES = Object.freeze([
  'NK_PROOF step=core-add outcome=ok',
  'NK_PROOF step=core-read-back outcome=ok',
  'NK_PROOF step=core-edit-price outcome=ok',
  'NK_PROOF step=core-pause outcome=ok',
  'NK_PROOF step=core-delete-undo outcome=ok',
  'NK_PROOF step=core-delete outcome=ok',
]);

// ⏱ 2026-10-02 · lead ruling on #1143 (land the proven, park the red legs).
// Dispatch 36987269922: on all five targets the refusal probe passed and the
// token session reached Home, and the core flow failed at its first step
// (`addPlanThroughSheet`: `Bad state: No element` on the add form's name field).
// One targeted fix followed (flow_steps.dart walks the ST-T9 pick step); until a
// dispatch proves it, the core flow and the notification tap after it are
// PARKED: `--pending-flows skip` (the default) builds the suite with
// NK_PROOF_PENDING_FLOWS=skip, the suite prints CORE_FLOW_PENDING_LINE instead
// of walking them, and readProof requires that line — so a parked leg is said
// on every run, never silently absent. tooling/e2e-leg-register.json `flows`
// carries each parked leg as `status: pending` with this run id and failure.
export const PENDING_FLOWS_MODES = Object.freeze(['skip', 'run']);
export const PENDING_FLOWS_ROW = 'O-E2E-CORE-FLOW-LEGS-PENDING';
export const CORE_FLOW_PENDING_LINE = `NK_PROOF step=core-flow outcome=pending row=${PENDING_FLOWS_ROW}`;

/** How a device leg gets its session (`--sign-in`). `form`: the real form —
 *  the line SIGN_IN_LINE is required and a harness-token session is a FINDING.
 *  `token`: the harness-minted one-time token, for a target whose form route
 *  needs an attestation no hosted runner can produce (ADR no.NNN); the leg's
 *  sign-in is then declared an equivalent in tooling/e2e-leg-register.json. */
export const SIGN_IN_MODES = Object.freeze(['form', 'token']);
export const SIGN_IN_LINE = 'NK_PROOF step=sign-in outcome=ok';
export const TOKEN_SESSION_LINE = 'NK_PROOF step=session outcome=ok via=harness-token';

/** The notification-tap leg (flow_steps.dart proveNotificationTap). */
export const AWAIT_NOTIFICATION_MARKER = 'NK_PROOF_AWAIT_NOTIFICATION';
export const TAP_PROOF_TITLE = 'NK tap proof';
export const NOTIFICATION_TAP_LINE = 'NK_PROOF step=notification-tap outcome=ok';
/** The targets whose HOST can tap a delivered notification on a hosted runner.
 *  Android alone: adb opens the shade and taps the row. iOS (simulator), macOS,
 *  Windows and Linux have no host-side tap on a runner without a UI-automation
 *  harness; each is a declared equivalent in the leg register's `flows`. */
export const NOTIFICATION_TAP_TARGETS = Object.freeze(['android']);

/** PURE. The APP_VERSION a CI device leg is built with: `e2e-<run>-<sha7>`, the
 *  shape production's consent ingest accepts for an E2E row (services/platform
 *  lib E2E_RUN). ⏱ 2026-10-02 · dispatch 36971560167: with no APP_VERSION the
 *  build stamped `dev`, the ingest answered 422 unreleased_build, and on every
 *  target the re-acceptance never recorded, so no leg reached Home. Null off CI. */
export function proofAppVersion(env) {
  const run = String(env?.GITHUB_RUN_NUMBER ?? '');
  const sha = String(env?.GITHUB_SHA ?? '');
  if (!/^\d{1,9}$/.test(run) || !/^[0-9a-fA-F]{7,40}$/.test(sha)) return null;
  return `e2e-${run}-${sha.slice(0, 7).toLowerCase()}`;
}
/** The platform Worker's origin — the host TRACE_URL reads, and the native route's. */
export const PLATFORM_ORIGIN = new URL(TRACE_URL).origin;

/**
 * The refusal codes that PROVE the gate: every one says "no verified
 * attestation, so no sign-in" (services/platform/src/routes/native-auth.ts).
 * `native_auth_unavailable` is a refusal too — a listed kind whose server config
 * is not yet provisioned answers 503 rather than admitting.
 */
export const REFUSAL_CODES = Object.freeze([
  'attestation_required',
  'attestation_kind_refused',
  'attestation_challenge_invalid',
  'attestation_invalid',
  'attestation_key_unknown',
  'native_auth_unavailable',
]);

/**
 * The calls a build that CANNOT attest sends, per step: no attestation at all;
 * the desktop / simulator fallback kind (`install-key`) with a fresh challenge;
 * and an emulator's Play Integrity proof that is not a verifiable token.
 */
export const REFUSAL_STEPS = Object.freeze([
  { step: 'token-unattested', op: 'token', kind: null },
  { step: 'signup-unattested', op: 'signup', kind: null },
  { step: 'token-install-key', op: 'token', kind: 'install-key' },
  { step: 'signup-install-key', op: 'signup', kind: 'install-key' },
  { step: 'token-play-unverifiable', op: 'token', kind: 'play-integrity' },
]);

/**
 * PURE. Grades the answers the refusal steps got: `[{ step, status, body }]`.
 * Every step must answer 4xx/5xx with a REFUSAL_CODES `error_code`, and no
 * answer may carry a token. Returns the problems (empty = the gate held).
 */
export function gradeRefusal(answers) {
  const problems = [];
  const seen = new Set((answers ?? []).map((a) => a.step));
  for (const { step } of REFUSAL_STEPS) if (!seen.has(step)) problems.push(`${step}: no answer was recorded`);
  for (const a of answers ?? []) {
    const text = JSON.stringify(a.body ?? null);
    if (/"(access_token|refresh_token)"/.test(text)) {
      problems.push(`${a.step}: the answer CARRIES A SESSION — the gate is open`);
      continue;
    }
    if (!(a.status >= 400)) {
      problems.push(`${a.step}: answered HTTP ${a.status} — a call that cannot attest was ADMITTED`);
      continue;
    }
    const code = a.body && typeof a.body === 'object' ? a.body.error_code : undefined;
    if (!REFUSAL_CODES.includes(code)) {
      problems.push(`${a.step}: answered HTTP ${a.status} with error_code ${JSON.stringify(code ?? null)}, not an attestation refusal`);
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 (fourth review of #1070) · THE REFUSAL LEGS SHARE ONE RATE BUDGET.
// Every Sunday leg of e2e.yml (each app × each target) fires at the same cron
// minute, and GitHub-hosted runners share a handful of networks — the platform
// Worker's per-network limiters key on `edge:<colo>:<asn>`, so to them the legs
// are ONE caller. One leg spends 8 calls of NATIVE_AUTH_EDGE_LIMITER (60/min:
// a challenge plus an op for each attested step, an op for each bare one) and 2
// of NATIVE_AUTH_UNATTESTED_LIMITER (10/min). All at once, a second app's legs
// already overrun the unattested budget and a third's the edge one: the leg reads
// `429 over_request_rate_limit`, which is not an attestation refusal, and reds.
// So the legs are STAGGERED (refusalSchedule): ordered app by app, target by
// target, and packed into one-minute slots holding no more than HALF of each
// budget — any sixty seconds then spans at most two slots, so a sliding window
// can never see more than the whole budget. And a 429 that still arrives (a
// runner that started late, a limiter that is per colo and eventually
// consistent) is waited out and the step re-asked (probeRefusals): it is the
// limiter speaking, not the gate, and the step's final answer is what is graded.
// The limits are services/platform/wrangler.jsonc's, held equal to it by
// tooling/ci/test/native-auth-proof.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The per-network limiters a refusal leg spends, and what each REFUSAL_STEPS step costs it. */
export const REFUSAL_LIMITS = Object.freeze([
  Object.freeze({ binding: 'NATIVE_AUTH_EDGE_LIMITER', limit: 60, period: 60, cost: (s) => (s.kind ? 2 : 1) }),
  Object.freeze({ binding: 'NATIVE_AUTH_UNATTESTED_LIMITER', limit: 10, period: 60, cost: (s) => (s.kind === 'install-key' ? 1 : 0) }),
  Object.freeze({ binding: 'NATIVE_AUTH_PLAY_VERIFY_LIMITER', limit: 10, period: 60, cost: (s) => (s.kind === 'play-integrity' ? 1 : 0) }),
]);

/** One slot of the schedule — the limiters' own period. */
export const REFUSAL_SLOT_MS = 60_000;

/** What one whole leg costs [limiter]. */
export const legCost = (limiter) => REFUSAL_STEPS.reduce((n, s) => n + limiter.cost(s), 0);

/** PURE. How many legs one slot holds: each limiter's budget halved, over one leg's cost. */
export function legsPerSlot(limits = REFUSAL_LIMITS) {
  let n = Infinity;
  for (const l of limits) {
    const cost = legCost(l);
    if (cost > 0) n = Math.min(n, Math.floor(Math.floor(l.limit / 2) / cost));
  }
  if (!Number.isFinite(n) || n < 1) throw new Error('a single refusal leg costs more than half of a limiter budget — no slot can hold it');
  return n;
}

/** PURE. Every leg's slot: apps in the order given, targets in TARGETS order. */
export function refusalSchedule(apps, targets = TARGETS, limits = REFUSAL_LIMITS) {
  const per = legsPerSlot(limits);
  const legs = [];
  for (const app of apps) for (const target of targets) legs.push({ app, target, slot: Math.floor(legs.length / per) });
  return legs;
}

/** PURE. [app]/[target]'s slot of the schedule for [apps], and the slot count — or null when the leg is not in it. */
export function refusalSlot(apps, app, target, targets = TARGETS) {
  const schedule = refusalSchedule(apps, targets);
  const leg = schedule.find((l) => l.app === app && l.target === target);
  return leg ? { slot: leg.slot, slots: schedule[schedule.length - 1].slot + 1 } : null;
}

/** How many times a rate-limited step is waited out and re-asked before its 429 is graded. */
export const REFUSAL_RETRIES = 2;

/** A 429 from one of the limiters: the limiter speaking, not the gate. */
const rateLimited = (status, body) => status === 429 && body?.error_code === 'over_request_rate_limit';

/** Retry-After in ms, bounded to 1..120 s; 60 s when absent or unreadable. */
export function retryAfterMs(headerValue) {
  const n = Number(headerValue);
  return (Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 1), 120) : 60) * 1000;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** IMPURE. Sends each REFUSAL_STEPS call to production's native route for [app]. */
export async function probeRefusals(app, { email, password, doFetch = fetch, origin = PLATFORM_ORIGIN, sleep = realSleep, out = console } = {}) {
  const base = `${origin}/v1/auth/native/${app}`;
  const answers = [];
  const read = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };
  const ask = async ({ op, kind }) => {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': `nikatru-e2e-refusal/${app}` };
    if (kind) {
      const ch = await doFetch(`${base}/attest/challenge`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15_000) });
      const chBody = await read(ch);
      if (!ch.ok) {
        // No challenge at all is the gate refusing earlier (no kind listed, or no challenge key): graded as is.
        return { status: ch.status, body: chBody, retryAfter: ch.headers?.get?.('Retry-After') ?? null };
      }
      headers['X-NK-Attest-Kind'] = kind;
      headers['X-NK-Attest-Challenge'] = String(chBody?.challenge ?? '');
      if (kind === 'install-key') headers['X-NK-Attest-Key'] = 'e2e-refusal-probe';
      headers['X-NK-Attest-Proof'] = kind === 'play-integrity' ? 'not.a.verifiable.integrity.token' : 'AAAA';
    }
    const path = op === 'token' ? `${base}/token?grant_type=password` : `${base}/${op}`;
    const res = await doFetch(path, { method: 'POST', headers, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await read(res), retryAfter: res.headers?.get?.('Retry-After') ?? null };
  };
  for (const s of REFUSAL_STEPS) {
    for (let attempt = 0; ; attempt++) {
      const a = await ask(s);
      if (!rateLimited(a.status, a.body) || attempt >= REFUSAL_RETRIES) {
        answers.push({ step: s.step, status: a.status, body: a.body });
        break;
      }
      const wait = retryAfterMs(a.retryAfter);
      out.log(`NK_PROOF step=${s.step} rate-limited (429 over_request_rate_limit) — the limiter, not the gate; asking again in ${wait / 1000} s (${attempt + 1} of ${REFUSAL_RETRIES})`);
      await sleep(wait);
    }
  }
  return answers;
}

/**
 * IMPURE. The whole --expect-refusal leg: probe, grade, print. Returns the exit
 * code — 0 the gate held, 1 it did not, 2 the leg could not run. With [log] it
 * FINISHES the proof log with PROOF_LOG_END on every one of those exits: the leg
 * starts no app, so no consent prompt was answered, and the purge after it must
 * read a finished log as "no row" rather than a cut-off one as unresolved.
 */
export async function runRefusalLeg(o, { log = null, env = process.env, probe = probeRefusals, egress = printEgressIp, out = console, now = Date.now, sleep = realSleep } = {}) {
  const finish = (code, refused) => {
    if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=none mode=expect-refusal exit=${code}${refused ? ` refused=${refused}` : ''}\n`);
    return code;
  };
  for (const k of ['E2E_EMAIL', 'E2E_PASSWORD']) {
    if (!env[k]) {
      out.error(`${NAME}: missing env ${k} — the refusal probe sends the provisioned user's credentials`);
      return finish(2, 'env');
    }
  }
  // The stagger (fourth review of #1070): with --stagger-anchor and --stagger-apps
  // the leg waits for its own slot of refusalSchedule. Both or neither; a value
  // that cannot place this leg is a workflow defect and refuses, never probes early.
  if (o.staggerAnchor !== undefined || o.staggerApps !== undefined) {
    const anchor = Number(o.staggerAnchor);
    let apps = null;
    try {
      apps = JSON.parse(o.staggerApps ?? '');
    } catch {
      apps = null;
    }
    const place = Number.isFinite(anchor) && anchor > 0 && Array.isArray(apps) ? refusalSlot(apps, o.app, o.target) : null;
    if (!place) {
      out.error(`${NAME}: --stagger-anchor ${JSON.stringify(o.staggerAnchor ?? null)} --stagger-apps ${JSON.stringify(o.staggerApps ?? null)} cannot place ${o.app}/${o.target} in the refusal schedule`);
      return finish(2, 'stagger');
    }
    const wait = anchor + place.slot * REFUSAL_SLOT_MS - now();
    out.log(`${NAME}: ${o.app}/${o.target} is slot ${place.slot + 1} of ${place.slots} (${legsPerSlot()} leg(s) a minute)${wait > 0 ? `; waiting ${Math.ceil(wait / 1000)} s` : '; its slot has begun'}`);
    if (wait > 0) await sleep(wait);
  }
  await egress();
  let answers;
  try {
    answers = await probe(o.app, { email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  } catch (e) {
    out.error(`${NAME}: the native route could not be reached (${e?.message ?? e})`);
    return finish(2, 'unreachable');
  }
  for (const a of answers) out.log(`NK_PROOF step=${a.step} answer=${a.status}/${a.body?.error_code ?? '-'}`);
  const problems = gradeRefusal(answers);
  if (problems.length) {
    for (const p of problems) out.error(`FAIL ${p}`);
    out.error(`${NAME}: ${o.app}/${o.target} FAILED — the native route did not refuse a build that cannot attest`);
    return finish(1);
  }
  out.log(`${NAME}: ${o.app}/${o.target} OK — every call a build that cannot attest sends was refused, and no session came back (ADR no.NNN)`);
  return finish(0);
}

/** Does [app]'s proof suite declare the offline read? Read comment-stripped:
 *  a sentence about the step is not the step. */
export function offlineReadDeclared(root, app) {
  const p = join(root, 'apps', app, PROOF_TEST);
  if (!existsSync(p)) return false;
  const code = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  return /\bkOfflineReadOkLine\b/.test(code);
}

/** Does [app]'s proof suite walk the core flow? Comment-stripped, as above. */
export function coreFlowDeclared(root, app) {
  let raw;
  try {
    raw = readFileSync(join(root, 'apps', app, PROOF_TEST), 'utf8');
  } catch {
    return false;
  }
  const code = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  return /\bawait\s+walkCoreFlow\s*\(/.test(code);
}

/** The Android package the notification tap grants, from the app's Gradle file. */
export function androidPackageOf(root, app) {
  for (const f of ['build.gradle.kts', 'build.gradle']) {
    let gradle;
    try {
      gradle = readFileSync(join(root, 'apps', app, 'android', 'app', f), 'utf8');
    } catch {
      continue;
    }
    const m = /applicationId\s*=?\s*["']([^"']+)["']/.exec(gradle);
    if (m) return m[1];
  }
  throw new Error(`apps/${app}/android/app/build.gradle(.kts) declares no applicationId`);
}

/** PURE. The bounds centre of the uiautomator node whose text is [title], or null. */
export function tapPointOf(dumpXml, title) {
  for (const m of String(dumpXml ?? '').matchAll(/<node\b[^>]*>/g)) {
    const node = m[0];
    const text = /\btext="([^"]*)"/.exec(node)?.[1];
    if (text !== title) continue;
    const b = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
  }
  return null;
}

/** The unusable reset callback the OS opens: a real marker, a code no flow minted. */
export const callbackUrl = (app) => `com.nikatru.${app}://auth-callback?nk_auth=reset&code=st-n1-invalid`;

/** `ip=` off a /cdn-cgi/trace body, or null. */
export function egressIpOf(trace) {
  const m = /^ip=(.+)$/m.exec(String(trace ?? ''));
  return m ? m[1].trim() : null;
}

/** The Linux runner's binary name, read from the app's own CMakeLists. */
export function linuxBinaryOf(root, app) {
  const cmake = readFileSync(join(root, 'apps', app, 'linux', 'CMakeLists.txt'), 'utf8');
  const m = /set\(BINARY_NAME\s+"([^"]+)"\)/.exec(cmake);
  if (!m) throw new Error(`apps/${app}/linux/CMakeLists.txt sets no BINARY_NAME`);
  return m[1];
}

/**
 * The commands that make the OS deliver [url] to the running proof, in order,
 * as [cmd, ...args] — or null for a target that cannot receive it here.
 */
export function openCommands(target, url, { app, root, device, home = homedir() }) {
  switch (target) {
    case 'android':
      return [['adb', ...(device ? ['-s', device] : []), 'shell', `am start -W -a android.intent.action.VIEW -d '${url}'`]];
    case 'ios':
      // 🔴 NOT `simctl openurl`: iOS holds a custom-scheme URL from outside
      // the app behind a system "Open in “<app>”?" sheet that nothing on a
      // runner answers — run 36637965865's screenshot, 25 s after the open.
      // The app opens its own callback instead (appOpensCallback below), which
      // iOS routes through the same scene → app_links → supabase_flutter path.
      return [];
    case 'macos': {
      const products = join(root, 'apps', app, 'build', 'macos', 'Build', 'Products', 'Debug');
      const bundle = existsSync(products) ? readdirSync(products).find((f) => f.endsWith('.app')) : undefined;
      if (!bundle) throw new Error(`no .app under ${products} — the proof build did not land where LaunchServices is pointed`);
      const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
      return [[lsregister, '-f', join(products, bundle)], ['open', url]];
    }
    case 'linux': {
      const exec = join(root, 'apps', app, 'build', 'linux', 'x64', 'debug', 'bundle', linuxBinaryOf(root, app));
      const desktop = `nk-proof-${app}.desktop`;
      const dir = join(home, '.local', 'share', 'applications');
      return [
        ['__write__', join(dir, desktop), [
          '[Desktop Entry]',
          'Type=Application',
          `Name=${app} (ST-N1 proof)`,
          `Exec=${exec} %u`,
          `MimeType=x-scheme-handler/com.nikatru.${app};`,
          'NoDisplay=true',
          '',
        ].join('\n')],
        ['update-desktop-database', dir],
        ['xdg-mime', 'default', desktop, `x-scheme-handler/com.nikatru.${app}`],
        ['xdg-open', url],
      ];
    }
    case 'windows':
      return null;
    default:
      throw new Error(`unknown target "${target}" — one of ${TARGETS.join(', ')}`);
  }
}

/** Whether the APP opens the callback itself (`NK_PROOF_OPEN_FROM_APP`)
 *  rather than the host — iOS alone; see the `ios` arm of openCommands. */
export const appOpensCallback = (target) => target === 'ios';

/** What the run's output proves, and what it does not. */
export function readProof(out, { callback, offlineRead = false, coreFlow = false, signIn = 'form', notificationTap = false, flowsParked = false }) {
  const text = String(out ?? '');
  const problems = [];
  const need = (line, why) => {
    if (!text.includes(line)) problems.push(`missing "${line}" — ${why}`);
  };
  if (signIn === 'token') {
    need(TOKEN_SESSION_LINE, 'the harness session did not reach Home');
  } else {
    need(SIGN_IN_LINE, 'the real form did not sign the user in and reach Home');
    // A form leg whose session came from the harness token proves no front door.
    if (text.includes(TOKEN_SESSION_LINE)) problems.push(`"${TOKEN_SESSION_LINE}" in a --sign-in form leg — the session came from the harness token, not the form`);
  }
  if (flowsParked) {
    // Parked: the suite must SAY so; the core-flow and tap lines are not asked.
    if (coreFlow || notificationTap) need(CORE_FLOW_PENDING_LINE, 'a parked run must print that the core flow was skipped, and why');
  } else if (text.includes(CORE_FLOW_PENDING_LINE)) {
    problems.push(`"${CORE_FLOW_PENDING_LINE}" in a --pending-flows run leg — the suite skipped the flows this run asked it to walk`);
  }
  if (coreFlow && !flowsParked) {
    let at = -1;
    for (const line of CORE_FLOW_LINES) {
      const i = text.indexOf(line, at + 1);
      if (i === -1) problems.push(`missing "${line}" — the core flow (add → read back → edit price → pause → delete → Undo → delete) stopped before this step`);
      else at = i;
    }
  }
  if (notificationTap && !flowsParked) need(NOTIFICATION_TAP_LINE, 'the tapped reminder did not land on its /sub/<id>');
  for (const step of ['sign-up-registered', 'recover-unregistered']) {
    const m = new RegExp(`NK_PROOF step=${step} answer=(\\S+)`).exec(text);
    if (!m) problems.push(`missing "NK_PROOF step=${step}" — GoTrue's answer was not recorded`);
    else if (m[1] === 'captcha_failed') problems.push(`${step} answered captcha_failed — the call did not go through the native route`);
  }
  if (offlineRead) need(OFFLINE_READ_LINE, 'the list was not read back with the network off from this target\'s store');
  need('NK_PROOF step=sign-out outcome=ok', 'sign-out did not return to the sign-in form');
  if (callback) {
    need(FAILED_CALLBACK_LINE, 'the OS-delivered callback was not reported as a failed exchange');
    need('NK_PROOF step=callback outcome=ok', 'the dead-link sentence did not show');
  }
  return problems;
}

function args(argv) {
  const o = { callback: false, expectRefusal: false, signIn: 'form', notificationTap: false, pendingFlows: 'skip' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--callback') o.callback = true;
    else if (a === '--expect-refusal') o.expectRefusal = true;
    else if (a === '--notification-tap') o.notificationTap = true;
    else if (a === '--sign-in') o.signIn = argv[++i];
    else if (a === '--pending-flows') o.pendingFlows = argv[++i];
    else if (a === '--app' || a === '--target' || a === '--device' || a === '--log') o[a.slice(2)] = argv[++i];
    else if (a === '--stagger-anchor') o.staggerAnchor = argv[++i];
    else if (a === '--stagger-apps') o.staggerApps = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function printEgressIp() {
  try {
    const res = await fetch(TRACE_URL, { signal: AbortSignal.timeout(15_000) });
    console.log(`NK_PROOF egress_ip=${egressIpOf(await res.text()) ?? 'unread'}`);
  } catch (e) {
    console.log(`NK_PROOF egress_ip=unread (${e?.message ?? e})`);
  }
}

/**
 * What the OS did with the callback, read 25 s after it was opened — or null
 * where the target's own output already says. iOS only: proof run
 * 36546306851's simctl openurl exited 0 and the app never saw the URL (no
 * `handle deeplink uri`), and nothing a runner prints could say why. So the
 * simulator's own log and a screenshot of what was on screen.
 */
export function afterOpenDiagnostics(target, { device, dir }) {
  if (target !== 'ios') return null;
  const dev = device || 'booted';
  return {
    screenshot: ['xcrun', 'simctl', 'io', dev, 'screenshot', join(dir, 'nk-proof-ios-after-open.png')],
    log: ['xcrun', 'simctl', 'spawn', dev, 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate',
      'eventMessage CONTAINS[c] "nikatru" OR eventMessage CONTAINS[c] "openurl" OR eventMessage CONTAINS "app_links" ' +
        'OR eventMessage CONTAINS "Flutter application in debug" OR process == "SpringBoard" AND eventMessage CONTAINS[c] "url"'],
  };
}

function runDiagnostics(d, root) {
  if (!d) return;
  console.log(`${NAME}: $ ${d.screenshot.join(' ')}`);
  spawnSync(d.screenshot[0], d.screenshot.slice(1), { cwd: root, stdio: 'inherit' });
  const r = spawnSync(d.log[0], d.log.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = String(r.stdout ?? '').split('\n').filter((l) => l.trim());
  console.log(`${NAME}: simulator log after the open — last ${Math.min(lines.length, 150)} of ${lines.length} line(s):`);
  for (const l of lines.slice(-150)) console.log(`  ${l}`);
}

function runOpen(commands, root) {
  for (const [cmd, ...rest] of commands) {
    if (cmd === '__write__') {
      const [path, body] = rest;
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, body);
      console.log(`${NAME}: wrote ${path}`);
      continue;
    }
    console.log(`${NAME}: $ ${[cmd, ...rest].join(' ')}`);
    const r = spawnSync(cmd, rest, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) console.log(`${NAME}: ${cmd} exited ${r.status ?? r.error?.message}`);
  }
}

/**
 * IMPURE. Android: grant POST_NOTIFICATIONS, wait for the reminder (scheduled
 * one minute out), open the shade and tap the row titled TAP_PROOF_TITLE —
 * a real tap on the system UI, which the app receives as a notification
 * response. Polls for up to five minutes: an inexact alarm may land late.
 */
async function tapNotification(o, root) {
  const adb = (...a) => spawnSync('adb', [...(o.device ? ['-s', o.device] : []), ...a], { cwd: root, encoding: 'utf8' });
  const pkg = androidPackageOf(root, o.app);
  adb('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
  const end = Date.now() + 5 * 60_000;
  await realSleep(55_000);
  while (Date.now() < end) {
    adb('shell', 'cmd', 'statusbar', 'expand-notifications');
    await realSleep(1_500);
    adb('shell', 'uiautomator', 'dump', '/sdcard/nk-shade.xml');
    const dump = adb('shell', 'cat', '/sdcard/nk-shade.xml').stdout;
    const at = tapPointOf(dump, TAP_PROOF_TITLE);
    if (at) {
      console.log(`${NAME}: tapping "${TAP_PROOF_TITLE}" at ${at.x},${at.y}`);
      adb('shell', 'input', 'tap', String(at.x), String(at.y));
      return;
    }
    adb('shell', 'cmd', 'statusbar', 'collapse');
    await realSleep(10_000);
  }
  console.error(`${NAME}: no notification titled "${TAP_PROOF_TITLE}" reached the shade within five minutes`);
}

async function main() {
  const root = process.cwd();
  let o;
  try {
    o = args(process.argv.slice(2));
    if (!o.app || !TARGETS.includes(o.target)) throw new Error(`--app <id> and --target <${TARGETS.join('|')}> are required`);
    if (o.target === 'windows' && o.callback) throw new Error('windows cannot take --callback here: protocol activation needs the MSIX installed');
    if (!SIGN_IN_MODES.includes(o.signIn)) throw new Error(`--sign-in must be one of ${SIGN_IN_MODES.join(', ')}`);
    if (!PENDING_FLOWS_MODES.includes(o.pendingFlows)) throw new Error(`--pending-flows must be one of ${PENDING_FLOWS_MODES.join(', ')}`);
    if (o.notificationTap && !NOTIFICATION_TAP_TARGETS.includes(o.target)) {
      throw new Error(`--notification-tap: the host cannot tap a notification on ${o.target} (only ${NOTIFICATION_TAP_TARGETS.join(', ')})`);
    }
  } catch (e) {
    console.error(`${NAME}: ${e.message}`);
    process.exit(2);
  }
  const defines = ['E2E_EMAIL', 'E2E_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL'];
  // Created FIRST, before any refusal and before the spawn: to the purge a
  // proof step that ran and left no log is UNRESOLVED (consent_anon_id.mjs,
  // resolveProofLogConsent), so a path that starts no app must say so here.
  const log = o.log ? resolve(root, o.log) : null;
  if (log) {
    mkdirSync(resolve(log, '..'), { recursive: true });
    writeFileSync(log, `${NAME}: ${o.app}/${o.target} — flutter test output follows\n`);
  }
  // ⏱ 2026-09-30 (third review of #1070): the refusal leg starts no app, and it
  // runs HERE — after the log exists, before the flutter defines are asked for —
  // so it finishes the log on every exit and the purge reads "no row".
  if (o.expectRefusal) {
    const code = await runRefusalLeg(o, { log });
    if (code !== 0) process.exit(code);
    return;
  }
  if (o.signIn === 'token') defines.push('E2E_TOKEN_HASH');
  const missing = defines.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`${NAME}: missing env ${missing.join(', ')} — the build would run in demo posture or without the user`);
    if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=none refused=env\n`);
    process.exit(2);
  }
  const offlineRead = offlineReadDeclared(root, o.app);
  console.log(`${NAME}: ${o.app}'s proof suite ${offlineRead ? 'declares' : 'does not declare'} the offline read`);
  const coreFlow = coreFlowDeclared(root, o.app);
  console.log(`${NAME}: ${o.app}'s proof suite ${coreFlow ? 'walks' : 'does not walk'} the core flow; sign-in via ${o.signIn}`);
  const flowsParked = o.pendingFlows === 'skip';
  if (flowsParked && (coreFlow || o.notificationTap)) {
    console.log(`${NAME}: the core flow${o.notificationTap ? ' and the notification tap are' : ' is'} PARKED (--pending-flows skip) under ${PENDING_FLOWS_ROW} — red on dispatch 36987269922; not graded proven`);
  }
  await printEgressIp();

  const appVersion = proofAppVersion(process.env);
  if (!appVersion && process.env.GITHUB_ACTIONS === 'true') {
    console.error(`${NAME}: GITHUB_RUN_NUMBER/GITHUB_SHA do not make an e2e-<run>-<sha7> stamp — production's consent ingest refuses an unstamped build, so no leg could reach Home`);
    if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=none refused=version\n`);
    process.exit(2);
  }
  const flutterArgs = [
    'test', PROOF_TEST,
    // why: on CI flutter picks the `github` reporter, which holds a test's
    // output until the test ENDS — so a hung or killed run left no line at all
    // (run 36525783687), and the consent id printed before the tap would never
    // reach the log. `expanded` streams each line as it is printed.
    '--reporter', 'expanded',
    ...(o.device ? ['-d', o.device] : []),
    ...defines.map((k) => `--dart-define=${k}=${process.env[k]}`),
    `--dart-define=NK_PROOF_CALLBACK=${o.callback}`,
    `--dart-define=NK_PROOF_SIGN_IN=${o.signIn}`,
    `--dart-define=NK_PROOF_NOTIFICATION_TAP=${o.notificationTap}`,
    `--dart-define=NK_PROOF_PENDING_FLOWS=${o.pendingFlows}`,
    ...(appVersion ? [`--dart-define=APP_VERSION=${appVersion}`] : []),
    ...(o.callback && appOpensCallback(o.target) ? [`--dart-define=NK_PROOF_OPEN_FROM_APP=${callbackUrl(o.app)}`] : []),
  ];
  const url = callbackUrl(o.app);
  let out = '';
  let opened = false;
  let tapping = false;
  let hung = false;
  const child = spawn('flutter', flutterArgs, {
    cwd: join(root, 'apps', o.app),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let silence;
  const arm = () => {
    clearTimeout(silence);
    silence = setTimeout(() => {
      hung = true;
      console.error(`${NAME}: flutter test printed nothing for ${SILENCE_LIMIT_MS / 60_000} min — killing it`);
      // On Windows `shell: true` makes the child cmd.exe, and flutter its child.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill();
    }, SILENCE_LIMIT_MS);
  };
  arm();
  const onData = (stream) => (chunk) => {
    const s = chunk.toString();
    arm();
    out += s;
    if (log) appendFileSync(log, s);
    stream.write(s);
    if (o.callback && !opened && out.includes(AWAIT_MARKER)) {
      opened = true;
      setTimeout(() => runOpen(openCommands(o.target, url, { app: o.app, root, device: o.device }), root), 3_000);
      const diag = afterOpenDiagnostics(o.target, { device: o.device, dir: process.env.RUNNER_TEMP || root });
      if (diag) setTimeout(() => runDiagnostics(diag, root), 28_000);
    }
    if (o.notificationTap && !tapping && out.includes(AWAIT_NOTIFICATION_MARKER)) {
      tapping = true;
      tapNotification(o, root).catch((e) => console.error(`${NAME}: the notification tap failed: ${e?.message ?? e}`));
    }
  };
  child.stdout.on('data', onData(process.stdout));
  child.stderr.on('data', onData(process.stderr));
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(silence);
  if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=${code}${hung ? ' killed=silence' : ''}\n`);

  const problems = readProof(out, { callback: o.callback, offlineRead, coreFlow, signIn: o.signIn, notificationTap: o.notificationTap, flowsParked });
  if (code !== 0) problems.unshift(`flutter test exited ${code}`);
  if (hung) problems.unshift(`flutter test printed nothing for ${SILENCE_LIMIT_MS / 60_000} min and was killed — the app never reported back (a launch that hung, not a sign-in that failed)`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`${NAME}: ${o.app}/${o.target} FAILED`);
    process.exit(1);
  }
  console.log(`${NAME}: ${o.app}/${o.target} OK — the form signed in, the gated calls answered without a captcha, sign-out returned${offlineRead ? ', the list read back offline' : ''}${o.callback ? ', and the OS-delivered callback failed cleanly' : ''}`);
}

const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) await main();
