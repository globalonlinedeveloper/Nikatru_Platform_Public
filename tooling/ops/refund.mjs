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
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAILS = {
  paddle: { live: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com', keys: ['PADDLE_API_KEY'] },
  razorpay: { live: 'https://api.razorpay.com', sandbox: 'https://api.razorpay.com', keys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] },
};

/** @ceiling none — a client-side patience budget for one call, not a platform resource. */
export const REFUND_TIMEOUT_MS = 20_000;

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

function authHeader(provider, env) {
  if (provider === 'paddle') return `Bearer ${env.PADDLE_API_KEY}`;
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), now = () => new Date().toISOString() } = {}) {
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
  if (insideGitWorkTree(a.ledger, { pathMod })) {
    err('✗ --ledger is inside a git work tree; money events never land in a repository. Nothing was sent.\n');
    return 1;
  }
  const missing = RAILS[plan.provider].keys.filter((k) => !env[k]);
  if (missing.length) {
    err(`✗ ${missing.join(', ')} not set in this environment (load the vault keys by name). Nothing was sent.\n`);
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
      const j = await res.json();
      id = j?.data?.id ?? j?.id ?? null;
    } catch {
      id = null;
    }
  } catch (e) {
    err(`✗ the ${plan.provider} call got no answer (${e?.name ?? 'error'}); check the rail's dashboard before any retry.\n`);
    appendFileSync(a.ledger, `${JSON.stringify({ at: now(), kind: 'manual_refund', provider: plan.provider, ref: plan.ref, amount_minor: plan.amount, reason: plan.body.reason ?? plan.body.notes?.reason, status: 'no_answer' })}\n`);
    return 1;
  }
  const ok = status >= 200 && status < 300;
  appendFileSync(
    a.ledger,
    `${JSON.stringify({ at: now(), kind: 'manual_refund', provider: plan.provider, ref: plan.ref, amount_minor: plan.amount, reason: plan.body.reason ?? plan.body.notes?.reason, status, refund_id: id })}\n`,
  );
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
