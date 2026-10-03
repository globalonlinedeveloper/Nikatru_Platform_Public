#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// move.mjs — move ONE report's status (lane feedback-triage, Do 3). The lead
// runs it after accepting a triage proposal; the routine never does.
//
//   node tooling/feedback/move.mjs FB-XXXXXXXXXX triaged
//   node tooling/feedback/move.mjs FB-XXXXXXXXXX in-fix --pr 1234
//   node tooling/feedback/move.mjs FB-XXXXXXXXXX fixed --version 1.4.1
//   node tooling/feedback/move.mjs FB-XXXXXXXXXX duplicate --of FB-YYYYYYYYYY
//   node tooling/feedback/move.mjs PR-XXXXXXXXXX acknowledged     (a DPDP rights request,
//   node tooling/feedback/move.mjs PR-XXXXXXXXXX resolved          lane dpdp-rights; see
//                                                                   docs/ops/privacy-requests.md)
//
// It POSTs to the platform Worker's /v1/ops/feedback/move with the bearer in
// the FEEDBACK_OPS_SECRET environment variable (never an argument, never
// printed). The WORKER enforces the lifecycle (services/platform/src/feedback/
// lifecycle.ts): an illegal move — `new -> notified` above all — is refused
// there, whatever this script sends. `notified` is the cron's alone.
//
// Exit: 0 moved · 1 refused by the Worker or not reached · 2 bad arguments / no secret.
// ─────────────────────────────────────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_ID } from './lib.mjs';

/** A DPDP rights request's id (services/platform/src/feedback/privacy.ts PRIVACY_ID). */
export const PRIVACY_REQUEST_ID = /^PR-[0-9A-HJKMNP-TV-Z]{10}$/;

export const MOVE_URL = 'https://platform.nikatru.com/v1/ops/feedback/move';

export function parseMoveArgs(argv) {
  const [id, to, ...rest] = argv;
  if (typeof id !== 'string' || !(REPORT_ID.test(id) || PRIVACY_REQUEST_ID.test(id))) {
    return { error: 'the first argument is a report id (FB- and 10 characters) or a rights request id (PR- and 10 characters)' };
  }
  if (typeof to !== 'string' || to.startsWith('-')) return { error: 'the second argument is the status to move to' };
  const body = { id, to };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const v = rest[++i];
    if (v === undefined) return { error: `${a} needs a value` };
    if (a === '--pr') body.pr = Number(v);
    else if (a === '--version') body.version = v;
    else if (a === '--of') body.duplicateOf = v;
    else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  return { body };
}

export async function move(body, { secret = process.env.FEEDBACK_OPS_SECRET, fetchImpl = fetch, log = console.log } = {}) {
  if (!secret) {
    log('move: FEEDBACK_OPS_SECRET is not set in this shell; nothing sent.');
    return 2;
  }
  let res;
  try {
    res = await fetchImpl(MOVE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    log(`move: the Worker was not reached (${err?.name ?? 'Error'}); nothing moved.`);
    return 1;
  }
  const answer = await res.json().catch(() => ({}));
  if (res.status === 200) {
    log(`move: ${answer.id} ${answer.from} -> ${answer.to} at ${answer.at}`);
    return 0;
  }
  // The Worker's error word and field only — it never echoes report text.
  log(`move: refused ${res.status} ${answer.error ?? ''}${answer.field ? ` (${answer.field})` : ''}${answer.from ? ` from ${answer.from}` : ''}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseMoveArgs(process.argv.slice(2));
  if (args.error) {
    console.log(`move: ${args.error}`);
    process.exit(2);
  }
  process.exit(await move(args.body));
}
