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
export const STATES = Object.freeze(['in_review', 'live', 'rejected', 'pulled', 'pending_manual_publish']);

/** 🔴 `pending_manual_publish` IS NOT A SUBMISSION STATE, AND THAT IS THE WHOLE
 *  REASON IT EXISTS. Added 2026-09-06 with the three browser add-on store rows.
 *
 *  A release on the EXTENSION surface publishes the exact bytes the store will
 *  take — `extensions/dist/<tool>-<target>.zip`, built once and uploaded to the
 *  GitHub Release by the same job — but it submits to no store: all three rows
 *  are `submittable: false`, and [ADR 067] decision 8 puts a MANUAL first
 *  publish in front of every one of them. So the run knows a fact the four
 *  states above cannot say: *this release is the ORIGIN of the artifact destined
 *  for that channel, and nobody has submitted it*.
 *
 *  Saying it with `in_review` would be a fiction — the store has not been sent
 *  anything and has nothing to review — and it would be COUNTED as a submission
 *  by [10]D-6's cadence limb, which caps submissions per calendar month to keep
 *  a burst from reading as a content farm. Saying nothing at all would leave the
 *  release with no ledger row and the artifact with no recorded origin.
 *
 *  It carries no listing URL because there is none: a listing does not exist
 *  before the first publish (`tool.json`'s `listings` are null on all three
 *  today), which is exactly what this state says out loud. */
export const NOT_SUBMITTED_STATES = Object.freeze(['pending_manual_publish']);

/** The states that mean the store HAS the thing — what [10]D-6's cadence counts,
 *  and the one declaration of that boundary. `STATES` is the vocabulary; this is
 *  the half of it that describes a submission. */
export const SUBMISSION_STATES = Object.freeze(STATES.filter((s) => !NOT_SUBMITTED_STATES.includes(s)));

/** 🔴 WHAT A SUBMITTING RUN IS ENTITLED TO ASSERT, AND NOTHING MORE.
 *
 *  A store submission is NOT live when the upload succeeds. `upload accepted`
 *  and `the listing is installable` are separated by a human review that takes
 *  hours to weeks and can end in `rejected`. A run that uploads therefore knows
 *  exactly one fact — *it submitted* — and `in_review` is the only state that
 *  says that.
 *
 *  The other three are STORE-ISSUED FACTS. `live`, `rejected` and `pulled` are
 *  decided after the submitting run has exited, so they can only be recorded by
 *  a LATER run (a status poll, or a dispatch a human triggers on the review
 *  email). Writing them at submission time is not a rounding error: it is the
 *  ledger claiming the store approved something it has not yet looked at, which
 *  is the precise failure `[10]D-9` exists to prevent — "what is live" answered
 *  from hope rather than from record.
 *
 *  This list is the ONE declaration of that boundary. assert-publish-records.mjs
 *  reads it to grade `--state` in workflow YAML, and record-deployment.mjs reads
 *  it to decide that a STORE channel may not fall back to the `live` default. */
export const SUBMIT_TIME_STATES = Object.freeze(['in_review']);

/** Why each state exists, in the words a report should use. Kept beside STATES
 *  so a new state cannot be added without saying what it claims. */
export const STATE_MEANING = Object.freeze({
  in_review: 'submitted; the store has not decided. The only state a submitting run may assert.',
  live: 'the store approved it and the listing is installable — a store-issued fact, known only after the submitting run has ended.',
  rejected: 'the store refused it. Store-issued, and a different runbook from `pulled`.',
  pulled: 'we withdrew it. Ours, not the store\'s, and deliberately distinct from `rejected`.',
  pending_manual_publish:
    'the release is the ORIGIN of the artifact destined for this channel and nothing was submitted: the channel is `submittable: false`, so the publish is a manual act somebody still owes. NOT a submission — [10]D-6\'s cadence does not count it.',
});

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
 * splitting on the last hyphen: `subscriptiontracker-android-play` and `subscriptiontracker-web` do not
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

  // ── SERVICE ENVIRONMENTS — backend Workers, which are not release channels ──
  //
  // 🔴 MATCHED EXACTLY, NOT AS A TEMPLATE, and that is the point. A Worker
  // environment has no `{app}` hole: `platform` is ONE deployment serving every
  // app, so there is no app to extract, and `app` is returned as null rather
  // than as a guess. See `_serviceEnvironmentsWhy` in the register for why these
  // must not be `channels` rows — a bare "{app}" template would have head and
  // tail both empty and would therefore match every environment string ever
  // passed, silently filing Play submissions under it.
  //
  // Consumers already handle this correctly: `readSubmissions` skips anything
  // whose `kind !== 'store'`, and record-deployment.mjs's listing-URL rule tests
  // the same field, so a service record can never escape a store rule by being
  // renamed.
  const services = Array.isArray(register?.serviceEnvironments) ? register.serviceEnvironments : [];
  for (const row of services) {
    if (typeof row?.deploymentEnvironment !== 'string') continue;
    if (row.deploymentEnvironment !== environment) continue;
    return { app: null, channel: { ...row, kind: row.kind ?? 'service' } };
  }

  // ── SITE ENVIRONMENTS — a static site and its Pages Functions ──────────────
  // ⏱ 2026-09-25 · row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE (D3a). Matched
  // exactly, like a service, and for the same reason: `nikatru-site` is ONE
  // deployment with no app in it. Its own list, because a site is neither a
  // release channel nor a Worker: rollback.mjs reads `source` of a service row
  // as a Worker directory, and `kind: 'site'` is re-promoted by nothing there.
  const sites = Array.isArray(register?.siteEnvironments) ? register.siteEnvironments : [];
  for (const row of sites) {
    if (typeof row?.deploymentEnvironment !== 'string') continue;
    if (row.deploymentEnvironment !== environment) continue;
    return { app: null, channel: { ...row, kind: row.kind ?? 'site' } };
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
 * OWNER_QUEUE A-2, A-6; A-3 and A-4 closed). [10]D-10 limb (iii) — "the ledger holds a
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

/** ⏱ 2026-09-24 · The largest versionCode a list of Deployments records, or `null`.
 *
 *  record-deployment.mjs --version-code writes it into the Deployment `payload` as
 *  `version_code` on every row that carries a `versionCodeHighWater` block (android-play);
 *  read-ledger-version-code.mjs hands this to assert-app-versioning.mjs --play-floor, which
 *  stops a build while the committed mark sits below it. The payload is read the way
 *  tooling/ops/check-prod-provenance.mjs `deploymentPayload` reads it: the API returns the
 *  object that was posted, a payload posted as a string comes back as that string and is
 *  parsed, and `{}`, `''`, a string that is not JSON or a non-object names nothing. Only a
 *  whole `version_code` of 1 or more counts; the Deployments written before 2026-09-24
 *  carry none, so a ledger holding only those answers `null`. Pure: no I/O. */
export function maxVersionCode(deployments) {
  let max = null;
  for (const d of deployments ?? []) {
    let p = d?.payload;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        continue;
      }
    }
    if (p === null || typeof p !== 'object' || Array.isArray(p)) continue;
    const v = p.version_code;
    if (!Number.isInteger(v) || v < 1) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/** `YYYY-MM` of an ISO timestamp — the bucket the NIKATRU cadence rule counts
 *  in. UTC, so the bucket does not depend on where the reader is sitting. */
export function calendarMonth(iso) {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}
