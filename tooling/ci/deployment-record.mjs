#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// deployment-record.mjs — the SHAPE of "what is live where", decided once.
//
// [pipeline 10]D-9 "What is live on which channel is recorded, and the record
//                   is machine-answerable."
//
// 🔴 THIS EXISTS BEFORE THE FIRST SUBMISSION, ON PURPOSE. `record-deployment.mjs`
// wrote `description: "live at <sha8>"` — free prose, and adequate for the web
// channel, where "live" is the only state a deploy can be in and the URL is
// always the same. A STORE deploy is not that. It has a REVIEW STATE that is
// not "live" for most of its life (in_review → live | rejected | pulled) and a
// LISTING URL that is issued by the store and is the only address anybody can
// open. Neither has a slot in a prose sentence.
//
// Deciding the shape AFTER the first submission means re-writing a record that
// is, by then, the only copy of what happened. There is no second source: the
// Partner Center / Play Console history is behind an account, and the question
// D-9 exists to answer — "what is live on which channel, right now?" — is asked
// at exactly the moment nobody can log in.
//
// ── THE ENCODING ─────────────────────────────────────────────────────────────
// One line, into the Deployment Status `description` field (GitHub caps it at
// 140 characters, which the length check below respects):
//
//     nk1 state=<state> sha=<sha8> listing=<url>
//
// Prefixed and versioned so a reader can tell a record it understands from one
// it does not — and the LEGACY `live at <sha8>` form decodes as UNPARSEABLE
// rather than as `live`. That distinction is the whole point of the version
// tag: a reader that guessed "live" from an old prose record would report a
// store listing as live on the strength of a web deploy's sentence.
//
// ── WHAT IS NOT ENCODED, AND WHY ─────────────────────────────────────────────
// No timestamp: GitHub already stamps every deployment status with one, and a
// second copy is the first to drift. No app id: the environment name carries it
// (`{app}-{channel}`, the register's own `deploymentEnvironment` template).
//
// ⚠️ IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM — pure functions, text in,
// text out, no filesystem. The "did my scan reach the tree" question belongs to
// its callers. It is FLAT in tooling/ci because assert-guard-coverage.mjs
// treats any .mjs below tooling/ci as a guard that has escaped its scan.
// ─────────────────────────────────────────────────────────────────────────────

/** The review states a channel record can be in.
 *
 *  🔴 `in_review` IS FIRST BECAUSE IT IS THE LONGEST-LIVED. A submission spends
 *  days there and minutes becoming `live`; a vocabulary that only had `live`
 *  would force every real record to lie for the whole period somebody might
 *  actually ask. `pulled` is distinct from `rejected` on purpose: rejected is
 *  the store refusing, pulled is us withdrawing, and the response to each is a
 *  different runbook. */
export const STATES = Object.freeze(['in_review', 'live', 'rejected', 'pulled']);

/** GitHub truncates a Deployment Status description past this. A record that
 *  is silently cut is a record that no longer round-trips, and the truncation
 *  lands on the LAST field — the listing URL, i.e. the one thing only the store
 *  can give us. Refuse rather than write a record that cannot be read back. */
export const MAX_DESCRIPTION = 140;

const PREFIX = 'nk1';

/**
 * Encode one record. Throws rather than writing something unreadable: this is
 * called at the end of a real submission, and the failure mode to avoid is a
 * record that exists, looks fine, and cannot be parsed six months later.
 */
export function encodeDescription({ state, sha, listingUrl = null }) {
  if (!STATES.includes(state)) {
    throw new Error(`unknown state "${state}" — expected one of ${STATES.join(', ')}`);
  }
  const short = String(sha ?? '').slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(short)) {
    throw new Error(`sha "${sha}" is not a hex commit sha — the record must name the commit that shipped`);
  }
  const parts = [PREFIX, `state=${state}`, `sha=${short}`];
  if (listingUrl) {
    if (/\s/.test(listingUrl)) throw new Error('listing URL contains whitespace, which the one-line encoding cannot carry');
    parts.push(`listing=${listingUrl}`);
  }
  const out = parts.join(' ');
  if (out.length > MAX_DESCRIPTION) {
    throw new Error(
      `the encoded record is ${out.length} characters and GitHub truncates a deployment description at ` +
        `${MAX_DESCRIPTION}. Truncation lands on the listing URL — the one field only the store can give us — ` +
        'so this refuses rather than writing a record that cannot be read back.',
    );
  }
  return out;
}

/**
 * Decode a description. Returns `{ ok: true, state, sha, listingUrl }` or
 * `{ ok: false, reason }`.
 *
 * 🔴 A LEGACY `live at <sha8>` RECORD DECODES AS UNPARSEABLE, NOT AS `live`.
 * Guessing would make a reader report a store listing as live on the strength
 * of a web deploy's prose sentence, which is the second source of truth this
 * whole requirement exists to prevent.
 */
export function decodeDescription(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: false, reason: 'empty description' };
  const tokens = s.split(/\s+/);
  if (tokens[0] !== PREFIX) {
    return {
      ok: false,
      reason:
        `not a "${PREFIX}" record (it reads "${s.slice(0, 60)}"). Legacy prose records are reported as ` +
        'UNPARSEABLE rather than guessed at — reading "live at abc12345" as state=live would report a ' +
        'store listing live on the strength of a web deploy sentence.',
    };
  }
  const fields = new Map();
  for (const t of tokens.slice(1)) {
    const at = t.indexOf('=');
    if (at === -1) return { ok: false, reason: `token "${t}" is not key=value` };
    fields.set(t.slice(0, at), t.slice(at + 1));
  }
  const state = fields.get('state');
  if (!STATES.includes(state)) {
    return { ok: false, reason: `unknown state "${state ?? '(absent)'}" — expected one of ${STATES.join(', ')}` };
  }
  const sha = fields.get('sha');
  if (!/^[0-9a-f]{8}$/.test(String(sha ?? ''))) {
    return { ok: false, reason: `sha "${sha ?? '(absent)'}" is not an 8-character hex commit sha` };
  }
  return { ok: true, state, sha, listingUrl: fields.get('listing') ?? null };
}

/**
 * Split an environment name into `{ app, channel }` against a register's
 * `deploymentEnvironment` templates. Derived from the register rather than by
 * splitting on the last hyphen: `subly-android-play` and `subly-web` do not
 * split the same way, and a reader that guessed would file a Play record under
 * a channel called "play".
 */
export function resolveEnvironment(register, environment) {
  const rows = Array.isArray(register?.channels) ? register.channels : [];
  for (const row of rows) {
    const tpl = row?.deploymentEnvironment;
    if (typeof tpl !== 'string' || !tpl.includes('{app}')) continue;
    const [head, tail] = tpl.split('{app}');
    if (!environment.startsWith(head) || !environment.endsWith(tail)) continue;
    const app = environment.slice(head.length, environment.length - tail.length);
    if (app === '' || app.includes('/')) continue;
    return { app, channel: row };
  }
  return null;
}

/**
 * The reader [10]D-6's cadence limb and [10]D-10 limb (iii) both consume.
 *
 * Input is whatever the caller fetched from the Deployments API, normalised to
 * `{ environment, createdAt, description }`. Output separates what was
 * understood from what was not — never silently dropping the second, because a
 * ledger that hides its unreadable rows reports a smaller, tidier, wrong answer.
 *
 * ⬜ IT RETURNS AN EMPTY SET TODAY AND THAT IS CORRECT, not a defect: no
 * submission has happened, because no publisher account exists ([10]D-4 /
 * OWNER_QUEUE A-2, A-3, A-4, A-6). [10]D-10 limb (iii) — "the ledger holds a
 * submission record" — is owner-gated BY DEFINITION and cannot be satisfied by
 * any amount of agent work. Callers must PRINT that emptiness rather than
 * asserting over it.
 */
export function readSubmissions(entries, register) {
  const records = [];
  const unreadable = [];
  for (const e of entries ?? []) {
    const env = String(e?.environment ?? '');
    const resolved = resolveEnvironment(register, env);
    if (resolved === null) {
      unreadable.push({ environment: env, reason: 'no register row has a deploymentEnvironment template that matches' });
      continue;
    }
    if (resolved.channel.kind !== 'store') continue; // a web deploy is not a submission
    const decoded = decodeDescription(e?.description);
    if (!decoded.ok) {
      unreadable.push({ environment: env, reason: decoded.reason });
      continue;
    }
    records.push({
      environment: env,
      app: resolved.app,
      channel: resolved.channel.id,
      state: decoded.state,
      sha: decoded.sha,
      listingUrl: decoded.listingUrl,
      createdAt: e?.createdAt ?? null,
    });
  }
  return { records, unreadable };
}

/** `YYYY-MM` of an ISO timestamp — the bucket the NIKATRU cadence rule counts
 *  in. UTC, so the bucket does not depend on where the reader is sitting. */
export function calendarMonth(iso) {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}
