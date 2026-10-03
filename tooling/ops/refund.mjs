#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tooling/ops/refund.mjs — A MANUAL (GOODWILL) REFUND, PREPARED EXACTLY AND
// EXECUTED ONLY ON A TYPED CONFIRMATION (refund-finish, MF-6;
// O-MANUAL-REFUND-UNPREPARED).
//
//   node tooling/ops/refund.mjs --provider paddle   --ref txn_01h…  --reason "…" [--sandbox]
//   node tooling/ops/refund.mjs --provider razorpay --ref pay_N…    --reason "…" [--amount 17900]
//
// Without --execute it is a DRY RUN: it prints the exact request it would send
// (method, URL, body — never a credential) and a CONFIRMATION TOKEN derived
// from that request, and makes NO network call. To carry it out, the lead
// re-runs the SAME command with
//   --execute --confirm <token> --ledger <file outside every git work tree>
// The token binds the confirmation to that one request: a different reference,
// amount or reason gives a different token, so a pasted token cannot execute a
// request nobody read. The money event (rail, reference, amount, the rail's
// answer status and id, when) is appended to --ledger as one JSON line; money
// figures never land in a repository.
//
// 🔴 LEDGER FIRST, ONCE PER TOKEN (review 2026-10-03). Before anything is sent:
//   1. the ledger path is validated (absolute, outside every git work tree) and
//      the ledger is READ — an unreadable or unparseable ledger exits 2, because a
//      ledger that cannot be read cannot prove this refund was not already made;
//   2. a ledger line that already carries THIS token (an intent or a result), or
//      an older token-less line for the same rail, reference and amount, refuses
//      the run: a re-run with the same token never refunds twice. A partial with
//      another amount is another request, so another token, keyed separately;
//   3. a `manual_refund_intent` line {token, rail, reference, amount, reason} is
//      APPENDED — a ledger that will not take it refuses the run, nothing sent;
// and only then is the request sent; its answer is appended as the
// `manual_refund` line keyed by (token, refund id). So no refund leaves without a
// ledger row, and a crash between the two leaves the intent, which refuses the
// re-run and sends the operator to the rail's dashboard instead.
//
// 🔴 NEVER IN CI: under GITHUB_ACTIONS=true it exits 2 with empty stdout, dry run
// included — a refund is the owner's per-action yes, on the laptop.
// 🔴 KEYS BY NAME ONLY (PADDLE_API_KEY; RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET),
// read from the environment the lead's vault loader sets; never printed.
// 🔴 FULL REFUND BY DEFAULT, as refund.html promises; --amount (minor units) is
// for a goodwill partial on Razorpay only — a Paddle partial needs line items,
// which this tool refuses rather than guesses.
//
// The request shapes, read from the rails' API references on 2026-10-02:
//   Paddle   POST /adjustments {action: "refund", transaction_id, reason, type: "full"}
//            https://developer.paddle.com/api-reference/adjustments/create-adjustment
//   Razorpay POST /v1/payments/{id}/refund {amount?, speed: "normal", notes: {reason}}
//            https://razorpay.com/docs/api/refunds/create-normal/
// The lead verifies the printed request against those pages before typing the
// token; the first live refund is watched (Lead steps).
//
// Exit 0 done (or a dry run printed) · 1 refused or the rail said no · 2 CI or
// COVERAGE LOST. Plain Node, no shell helper, `node:path` only: it runs the
// same on the Windows laptop.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAILS = {
  paddle: { live: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com', keys: ['PADDLE_API_KEY'] },
  razorpay: { live: 'https://api.razorpay.com', sandbox: 'https://api.razorpay.com', keys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] },
};

/** @ceiling none — a client-side patience budget for one call, not a platform resource. */
export const REFUND_TIMEOUT_MS = 20_000;

/**
 * The ONE thing the rail's answer may put in the ledger: its refund id, and only
 * in the shape both rails use (`adj_…` on Paddle, `rfnd_…` on Razorpay). Anything
 * else is recorded as null, so the response never writes free text into the file
 * (CodeQL js/http-to-file-access #595; the ledger path is the operator's --ledger).
 */
export const REFUND_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const refundIdOf = (j) => {
  const id = j?.data?.id ?? j?.id ?? null;
  return typeof id === 'string' && REFUND_ID.test(id) ? id : null;
};

export function parseArgs(argv) {
  const a = { execute: false, sandbox: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--execute') a.execute = true;
    else if (k === '--sandbox') a.sandbox = true;
    else if (['--provider', '--ref', '--reason', '--amount', '--confirm', '--ledger'].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** The exact request, or why there is none. */
export function buildPlan(a) {
  const rail = RAILS[a.provider];
  if (!rail) return { error: `--provider must be one of ${Object.keys(RAILS).join(', ')}` };
  if (typeof a.ref !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(a.ref)) return { error: '--ref is the rail\'s purchase reference (letters, digits, _ and -)' };
  if (typeof a.reason !== 'string' || a.reason.trim().length < 3 || a.reason.length > 200) return { error: '--reason is required (3-200 characters)' };
  let amount = null;
  if (a.amount !== undefined) {
    if (!/^[1-9][0-9]{0,11}$/.test(String(a.amount))) return { error: '--amount is a positive whole number of minor units' };
    amount = Number(a.amount);
    if (a.provider === 'paddle') return { error: 'a Paddle partial refund needs line items; this tool refunds Paddle in full only' };
  }
  const base = a.sandbox ? rail.sandbox : rail.live;
  if (a.provider === 'paddle') {
    return { provider: 'paddle', method: 'POST', url: `${base}/adjustments`, body: { action: 'refund', transaction_id: a.ref, reason: a.reason.trim(), type: 'full' }, ref: a.ref, amount };
  }
  return {
    provider: 'razorpay',
    method: 'POST',
    url: `${base}/v1/payments/${encodeURIComponent(a.ref)}/refund`,
    body: { ...(amount === null ? {} : { amount }), speed: 'normal', notes: { reason: a.reason.trim() } },
    ref: a.ref,
    amount,
  };
}

/** The confirmation token: 10 hex of the request's canonical form. */
export function confirmationToken(plan) {
  return createHash('sha256').update(JSON.stringify([plan.method, plan.url, plan.body])).digest('hex').slice(0, 10);
}

/**
 * True when `file` is inside a git work tree: some ancestor directory holds a
 * `.git`. Works on either path flavour (pass `path.win32` for a Windows path);
 * `exists` is injectable for the test.
 */
export function insideGitWorkTree(file, { pathMod = path, exists = existsSync } = {}) {
  let dir = pathMod.dirname(pathMod.resolve(file));
  for (;;) {
    if (exists(pathMod.join(dir, '.git'))) return true;
    const up = pathMod.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * What the ledger already says about this request: `{ prior }` (the line that
 * makes it a repeat), `{ prior: null }` (no such line, or no ledger yet), or
 * `{ error }` when the ledger cannot be read or a line is not JSON. `read` is
 * injectable for the test; a missing file is an empty ledger (read, not checked
 * for existence first).
 */
export function ledgerPrior(file, plan, token, { read = (f) => readFileSync(f, 'utf8') } = {}) {
  let text;
  try {
    text = read(file);
  } catch (e) {
    if (e?.code === 'ENOENT') return { prior: null };
    return { error: `the ledger could not be read (${e?.code ?? 'error'})` };
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  for (const [i, l] of lines.entries()) {
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      return { error: `ledger line ${i + 1} is not JSON` };
    }
    if (j?.token === token) return { prior: j };
    const legacy = j?.token === undefined && j?.kind === 'manual_refund' && j.provider === plan.provider && j.ref === plan.ref && (j.amount_minor ?? null) === plan.amount;
    if (legacy) return { prior: j };
  }
  return { prior: null };
}

function authHeader(provider, env) {
  if (provider === 'paddle') return `Bearer ${env.PADDLE_API_KEY}`;
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export async function main(
  argv,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    out = (s) => process.stdout.write(s),
    err = (s) => process.stderr.write(s),
    now = () => new Date().toISOString(),
    readLedger = (f) => readFileSync(f, 'utf8'),
    appendLedger = (f, line) => appendFileSync(f, line),
  } = {},
) {
  if (env.GITHUB_ACTIONS === 'true') {
    err('✗ refund.mjs refuses to run in CI (GITHUB_ACTIONS=true): a refund is the owner\'s per-action yes, on the laptop.\n');
    return 2;
  }
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}\n`);
    return 1;
  }
  const plan = buildPlan(a);
  if (plan.error) {
    err(`✗ ${plan.error}\n`);
    return 1;
  }
  const token = confirmationToken(plan);
  const shown = { provider: plan.provider, method: plan.method, url: plan.url, body: plan.body };
  if (!a.execute) {
    out(`DRY RUN — nothing was sent. The exact request:\n${JSON.stringify(shown, null, 2)}\n`);
    out(`To carry it out, re-run the same command with: --execute --confirm ${token} --ledger <file outside any git work tree>\n`);
    return 0;
  }
  if (a.confirm !== token) {
    err('✗ --confirm does not match this request\'s token (run without --execute to see it). Nothing was sent.\n');
    return 1;
  }
  if (typeof a.ledger !== 'string' || a.ledger.length === 0) {
    err('✗ --execute needs --ledger <file>: the money event is recorded before this tool says it is done. Nothing was sent.\n');
    return 1;
  }
  const pathMod = /^[A-Za-z]:[\\/]|\\/.test(a.ledger) ? path.win32 : path;
  if (!pathMod.isAbsolute(a.ledger) || a.ledger.includes('\0')) {
    err('✗ --ledger must be an absolute path (the same file on every run, wherever it is started from). Nothing was sent.\n');
    return 1;
  }
  if (insideGitWorkTree(a.ledger, { pathMod })) {
    err('✗ --ledger is inside a git work tree; money events never land in a repository. Nothing was sent.\n');
    return 1;
  }
  const missing = RAILS[plan.provider].keys.filter((k) => !env[k]);
  if (missing.length) {
    err(`✗ ${missing.join(', ')} not set in this environment (load the vault keys by name). Nothing was sent.\n`);
    return 1;
  }
  const seen = ledgerPrior(a.ledger, plan, token, { read: readLedger });
  if (seen.error) {
    err(`✗ ${seen.error}, so it cannot show this refund was not already made. Nothing was sent.\n`);
    return 2;
  }
  if (seen.prior !== null) {
    err(
      `✗ the ledger already holds this request (${seen.prior.kind ?? 'a line'} at ${seen.prior.at ?? 'an unknown time'}${seen.prior.status === undefined ? '' : `, status ${seen.prior.status}`}). ` +
        "A refund is sent once per token: check the rail's dashboard, and for another amount prepare another request. Nothing was sent.\n",
    );
    return 1;
  }
  const reason = plan.body.reason ?? plan.body.notes?.reason;
  try {
    appendLedger(a.ledger, `${JSON.stringify({ at: now(), kind: 'manual_refund_intent', token, provider: plan.provider, ref: plan.ref, amount_minor: plan.amount, reason })}\n`);
  } catch (e) {
    err(`✗ the ledger would not take the intent line (${e?.code ?? 'error'}); no refund leaves without its ledger row. Nothing was sent.\n`);
    return 1;
  }
  let status = 0;
  let id = null;
  try {
    const res = await fetchImpl(plan.url, {
      method: plan.method,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(plan.provider, env) },
      body: JSON.stringify(plan.body),
      signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
    });
    status = res.status;
    try {
      id = refundIdOf(await res.json());
    } catch {
      id = null;
    }
  } catch (e) {
    err(`✗ the ${plan.provider} call got no answer (${e?.name ?? 'error'}); check the rail's dashboard before any retry.\n`);
    appendLedger(a.ledger, `${JSON.stringify({ at: now(), kind: 'manual_refund', token, provider: plan.provider, ref: plan.ref, amount_minor: plan.amount, reason, status: 'no_answer', refund_id: null })}\n`);
    return 1;
  }
  const ok = status >= 200 && status < 300;
  appendLedger(a.ledger, `${JSON.stringify({ at: now(), kind: 'manual_refund', token, provider: plan.provider, ref: plan.ref, amount_minor: plan.amount, reason, status, refund_id: id })}\n`);
  if (!ok) {
    err(`✗ ${plan.provider} answered ${status}; recorded in the ledger. Nothing more was sent.\n`);
    return 1;
  }
  out(`✓ ${plan.provider} accepted the refund (${status}${id ? `, ${id}` : ''}); recorded in the ledger.\n`);
  return 0;
}

/**
 * Whether `argv1` names this module. Windows compares case-insensitively and
 * either slash: `node c:\\…\\refund.mjs` and `C:/…/refund.mjs` are this file too
 * (the #1148 class of defect: a laptop-only mismatch makes the CLI a silent no-op).
 */
export function isThisModule(argv1, self, platform = process.platform) {
  if (!argv1) return false;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const a = p.resolve(argv1);
  const b = p.resolve(self);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isThisModule(process.argv[1], fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
