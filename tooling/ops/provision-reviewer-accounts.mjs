#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provision-reviewer-accounts.mjs — THE TWO STORE-REVIEW DEMO ACCOUNTS, a free
// one and a Pro one, on PRODUCTION, made idempotently, their passwords kept in
// the vault and nowhere else.
//
// ⏱ 2026-10-03 (store-readiness-2026-10-04 X4). Play Console "App access",
// Apple's review notes and Microsoft's certification notes each need working
// sign-in credentials for a login-gated app, one of them already in the premium
// state (Private runbooks/store-submission-android.md, "App-access demo
// credentials"). Nothing made them; this does, and it does nothing else.
//
//   node tooling/ops/provision-reviewer-accounts.mjs [--apply] [--grant-pro [--mint-comp-set]]
//        [--free-email <addr>] [--pro-email <addr>] [--feature-set <name>@<version>]
//        [--expires-days <n>] [--vault <path>] [repoRoot]
//
// 🔴 THE DEFAULT IS A PLAN. Without --apply it READS (the GoTrue admin user list,
// the vault's names, and with --grant-pro the platform_db SELECTs) and prints what
// --apply would do. Nothing is written: no user, no vault line, no row.
//
// WHAT --apply DOES, per account (REVIEWER_FREE_*, REVIEWER_PRO_*):
//   · the password is the vault's REVIEWER_<ROLE>_PASSWORD when the vault holds
//     one; otherwise a new one is generated and APPENDED to the vault FIRST, so a
//     run that dies after it has lost nothing (the next run finds the line);
//   · no auth user with that address → one is created through the GoTrue admin
//     API, pre-confirmed (`email_confirm: true`, the provision_user.mjs pattern),
//     with `app_metadata.store_review` naming the role;
//   · a user that exists → its password is SET to the vault's value (the same
//     value again on a re-run), because production sign-in is captcha-gated and
//     a password grant cannot be used to check that the vault still opens it;
//   · REVIEWER_<ROLE>_EMAIL is appended once (the user id is printed, never stored:
//     the address finds it again).
// The vault is APPEND-ONLY here: a name already present is never rewritten, and
// one present with a DIFFERENT value than this run would write is a refusal.
//
// 🔴 PRO IS THE PLATFORM'S OWN COMP PATH, NEVER A PAYMENT (--grant-pro). The one
// non-paying source the schema seeds for exactly this is `owner_comp` — "An owner
// comp — staff, a reviewer, a support make-good" (services/platform/migrations/
// 0009_bundle_grants.sql, requires_receipt 0: the authority is an operator
// record). The grant is written by THE ONE WRITER into bundle_grants,
// `upsertBundleGrant` (services/platform/src/lib/mor/bundle-store.ts), executed
// from its own TypeScript source (money-dry-run.mjs's resolution hook) over the
// D1 HTTP API, with the operator record in its provider fields. It is then READ
// BACK through THE ONE READER, `readProductEntitlement`
// (services/_shared/src/entitlement-read.ts), the function both Workers answer
// GET /v1/entitlements with — so "Pro" here means what the app will be told.
//   A bundle grant serves the members of a feature set (owner_comp's term is
//   `subscription`: the latest `sellable` version, else the pinned one). As of
//   2026-10-03 NO feature set is recorded as minted in platform_db (catalog/
//   bundles.json `nikatru_all` is a draft), so the precondition is checked
//   read-only and REFUSED (exit 2) naming the decision; --mint-comp-set records
//   the narrowest one, `--feature-set` (default store_review_comp@1, status
//   `draft`, the single member subscriptiontracker) — a reviewed, opt-in act.
//
// Prints NO secret: a password appears as its length, never its characters and
// never a hash of it.
//
// 🔴 THE IDENTITY STACK IS THE ONE PRODUCTION TRUSTS, READ FROM THE FILE THE DEPLOY
// READS: services/platform/wrangler.jsonc vars.SUPABASE_URL (Box C's GoTrue). A
// SUPABASE_URL in the environment must name that same origin or the run refuses.
// The VAULT's SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are NOT read: measured
// 2026-10-03, they are the HOSTED project's (the vault-sync labels say "remove
// then"), and accounts made there would be accounts no production build can sign
// in to. The service-role key comes from the environment (SUPABASE_SERVICE_ROLE_KEY,
// Box C's — the GitHub secret SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY, or
// /opt/supabase/.env on the box) or from the vault name
// SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY, by EXACT name (never a split on `=`). For
// --grant-pro: CLOUDFLARE_ACCOUNT_ID plus CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN).
//
// The vault gains REVIEWER_{FREE,PRO}_{EMAIL,PASSWORD}. Nikatru_Platform_Private
// runbooks/config/vault-sync-machine-keys.mjs refuses a secrets.env name with no
// purpose (exit 2, the 02:30 "NIKATRU vault sync" task), so its NAME_PURPOSES map
// needs REVIEWER_FREE_PASSWORD and REVIEWER_PRO_PASSWORD (each with `user:` its
// _EMAIL) in the same sitting as the first --apply.
//
// Exit 0 = done (or planned). 1 = a request or a refusal stopped it. 2 = COVERAGE
// LOST: a credential, the vault, or the comp precondition is missing.
// ─────────────────────────────────────────────────────────────────────────────
import { randomInt } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CredentialOriginRefused, credentialOrigin } from './credential-origin.mjs';
import { E2E_EMAIL_SHAPE, E2E_SWEEPABLE_SHAPE } from '../e2e/e2e_email.mjs';

const NAME = 'provision-reviewer-accounts';
const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = 'subscriptiontracker';
export const DEFAULT_EMAILS = Object.freeze({ free: 'review-free@nikatru.com', pro: 'review-pro@nikatru.com' });
export const DEFAULT_FEATURE_SET = 'store_review_comp@1';
const REQUEST_MS = 15_000;
const EMAIL = /^[a-z0-9][a-z0-9.+_-]*@nikatru\.com$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEATURE_SET = /^([a-z][a-z0-9_]*)@([1-9]\d*)$/;

export class Refused extends Error {
  constructor(code, lines) {
    super(lines[0]);
    this.code = code;
    this.lines = lines;
  }
}

/** A password a reviewer can type on a phone: four groups of five from an
 *  alphabet with no look-alikes, at least one upper, lower and digit (~114 bits). */
export function newPassword(pick = (n) => randomInt(n)) {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    const groups = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => ALPHA[pick(ALPHA.length)]).join(''));
    const p = groups.join('-');
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

/** How a secret is shown: its length, never its characters and never a hash of
 *  it (a fast hash of a password is a guessable one — CodeQL js/insufficient-
 *  password-hash on the first draft of this line). */
export const fingerprint = (v) => `${v.length} chars`;

// ── the vault: exact-name reads, append-only writes ─────────────────────────
/** `NAME=value` lines of one vault text, by exact name. NEVER a split on `=`: a
 *  free-form paste carries no `=`, and a splitting reader prints the value whole. */
function parseVault(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (m && !out.has(m[1])) out.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
  }
  return out;
}

/** Every `NAME=value` line of the vault at `path` (an absent vault is empty). */
export function readVault(path) {
  try {
    return parseVault(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e?.code === 'ENOENT') return new Map();
    throw e;
  }
}

/** Appends `name=value` unless the vault already says exactly that. A name
 *  present with ANOTHER value is a refusal: this file never rewrites a line.
 *  ONE descriptor, opened for append, is both the read and the write, so the
 *  text judged is the text appended to (no check-then-use window). */
export function appendVault(path, name, value) {
  const fd = openSync(path, 'a+');
  try {
    const text = readFileSync(fd, 'utf8');
    const have = parseVault(text).get(name);
    if (have === value) return false;
    if (have !== undefined) {
      throw new Refused(1, [`the vault already holds ${name} with a different value; this tool appends and never rewrites. Resolve it by hand.`]);
    }
    writeSync(fd, `${text === '' || text.endsWith('\n') ? '' : '\n'}${name}=${value}\n`);
    return true;
  } finally {
    closeSync(fd);
  }
}

/** The vault this run reads and appends to: --vault, else <root>/.claude/secrets.env,
 *  else the main checkout's (a lane worktree carries none). */
export function vaultPathOf(root, explicit) {
  if (explicit) return resolve(explicit);
  const own = join(root, '.claude', 'secrets.env');
  if (existsSync(own)) return own;
  const common = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  const main = common.status === 0 ? join(dirname(common.stdout.trim()), '.claude', 'secrets.env') : null;
  return main && existsSync(main) ? main : own;
}

// ── the two transports ───────────────────────────────────────────────────────
async function call(fetchImpl, url, init, what) {
  let res;
  let text;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
    text = await res.text();
  } catch (e) {
    throw new Refused(1, [`${what}: the request did not answer (${e?.name ?? 'error'}: ${e?.message ?? e}).`]);
  }
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    /* judged by the caller */
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** GoTrue's admin API, bound to the service-role key. */
export function gotrue({ url, serviceKey, fetchImpl = fetch }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const body = (r, what) => {
    if (!r.ok) throw new Refused(1, [`${what}: HTTP ${r.status} ${String(r.text).slice(0, 200)}`]);
    return r.json;
  };
  return {
    /** The one user with exactly this address, or null. `filter` narrows; the
     *  exact match is ours. Bounded: 40 pages of 100. */
    async findByEmail(email) {
      for (let page = 1; page <= 40; page++) {
        const q = new URLSearchParams({ page: String(page), per_page: '100', filter: email });
        const json = body(await call(fetchImpl, `${url}/auth/v1/admin/users?${q}`, { method: 'GET', headers }, 'auth user list'), 'auth user list');
        const users = Array.isArray(json?.users) ? json.users : null;
        if (users === null) throw new Refused(1, ['auth user list: the answer carries no `users` list.']);
        const hit = users.filter((u) => String(u?.email ?? '').toLowerCase() === email);
        if (hit.length > 1) throw new Refused(1, [`auth user list: ${hit.length} users carry ${email}.`]);
        if (hit.length === 1) return hit[0];
        if (users.length < 100) return null;
      }
      throw new Refused(1, ['auth user list: 40 pages read and the list did not end; refusing to guess.']);
    },
    async create(email, password, role) {
      const json = body(
        await call(fetchImpl, `${url}/auth/v1/admin/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { store_review: role } }),
        }, 'auth user create'),
        'auth user create',
      );
      const id = json?.id ?? json?.user?.id;
      if (typeof id !== 'string' || !UUID.test(id)) throw new Refused(1, ['auth user create: no user id (a UUID) in the answer.']);
      return id;
    },
    async setPassword(id, password, role) {
      body(
        await call(fetchImpl, `${url}/auth/v1/admin/users/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ password, email_confirm: true, app_metadata: { store_review: role } }),
        }, 'auth user update'),
        'auth user update',
      );
    },
  };
}

/** A SqlDb (services/_shared/src/ports/sql.ts) over the D1 HTTP API, so the
 *  platform's own writer and reader run unchanged against production. */
export function d1Db({ acct, token, dbId, fetchImpl = fetch }) {
  const exec = async (sql, params) => {
    const r = await call(fetchImpl, `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sql, params }),
    }, 'D1 query');
    if (!r.ok || r.json?.success !== true) throw new Refused(1, [`D1 query: HTTP ${r.status} ${JSON.stringify(r.json?.errors ?? r.text).slice(0, 200)}`]);
    const first = Array.isArray(r.json.result) ? r.json.result[0] : null;
    return { results: first?.results ?? [], meta: { changes: first?.meta?.changes ?? 0, ...(first?.meta ?? {}) } };
  };
  const statement = (sql, params = []) => ({
    bind: (...values) => {
      if (values.some((v) => v === undefined)) throw new Refused(1, ['an undefined value reached a D1 bind (D1_TYPE_ERROR).']);
      return statement(sql, values);
    },
    all: () => exec(sql, params),
    run: () => exec(sql, params),
    first: async () => (await exec(sql, params)).results[0] ?? null,
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

// ── the platform's own writer and reader, from source ───────────────────────
export async function loadPlatform(root) {
  const { registerTypeScriptResolution } = await import(pathToFileURL(join(root, 'tooling/ops/money-dry-run.mjs')).href);
  await registerTypeScriptResolution();
  const store = await import(pathToFileURL(join(root, 'services/platform/src/lib/mor/bundle-store.ts')).href);
  const reader = await import(pathToFileURL(join(root, 'services/_shared/src/entitlement-read.ts')).href);
  return { upsertBundleGrant: store.upsertBundleGrant, readProductEntitlement: reader.readProductEntitlement };
}

/** The GoTrue origin production trusts: the platform Worker's top-level
 *  vars.SUPABASE_URL, the issuer its JWT verify and /v1/health read. */
async function authTargetOf(root) {
  const { parseJsonc } = await import(pathToFileURL(join(root, 'tooling/ci/d1-sql-inventory.mjs')).href);
  const cfg = parseJsonc(readFileSync(join(root, 'services/platform/wrangler.jsonc'), 'utf8'));
  const v = cfg?.vars?.SUPABASE_URL;
  if (typeof v !== 'string' || !v.startsWith('https://')) {
    throw new Refused(2, ['services/platform/wrangler.jsonc carries no https vars.SUPABASE_URL, so the identity stack production trusts is unknown.']);
  }
  return v;
}

/** platform_db's production id and the production money world, from the files
 *  the deploys read (never typed here). */
async function platformTarget(root) {
  const { backendOf } = await import(pathToFileURL(join(root, 'tooling/e2e/backend.mjs')).href);
  const { parseJsonc } = await import(pathToFileURL(join(root, 'tooling/ci/d1-sql-inventory.mjs')).href);
  const { platformDb } = backendOf(APP, { env: 'production', root });
  const cfg = parseJsonc(readFileSync(join(root, 'services/platform/wrangler.jsonc'), 'utf8'));
  return { dbId: platformDb, environment: cfg?.vars?.MONEY_ENVIRONMENT };
}

/** What the one reader answers for this user and the app. */
async function proOf(platform, db, environment, userId) {
  const read = await platform.readProductEntitlement(
    {
      db,
      allRows: async (stmt) => (await stmt.all()).results ?? [],
      isMoneyEnvironment: (v) => v === 'live' || v === 'sandbox',
      isKnownProduct: (id) => id === APP,
      warn: () => {},
      error: () => {},
    },
    { userId, productId: APP, environment, rid: NAME },
  );
  if (read.kind !== 'ok') throw new Refused(1, [`the entitlement reader refused (${read.kind}).`]);
  return { isPro: read.is_pro, via: read.granted_via };
}

// ── the run ──────────────────────────────────────────────────────────────────
export async function run(opts) {
  const { root, env = process.env, fetchImpl = fetch, log = console.log, now = () => new Date() } = opts;
  const apply = opts.apply === true;
  const vaultPath = vaultPathOf(root, opts.vault);
  if (!existsSync(vaultPath)) throw new Refused(2, [`no vault at ${vaultPath}: the passwords have nowhere to live, so nothing is made. Pass --vault <path>.`]);
  const vault = readVault(vaultPath);
  const cred = (...names) => {
    for (const n of names) {
      const v = env[n] || vault.get(n);
      if (v) return v;
    }
    return undefined;
  };

  // The identity production trusts, from the platform Worker's own config; never the vault's.
  const trusted = await (opts.authTarget ?? authTargetOf)(root);
  let url;
  try {
    url = credentialOrigin(env.SUPABASE_URL || trusted, 'supabase');
  } catch (e) {
    if (e instanceof CredentialOriginRefused) throw new Refused(2, [`SUPABASE_URL: ${e.message}`]);
    throw e;
  }
  if (url !== new URL(trusted).origin) {
    throw new Refused(2, [
      `SUPABASE_URL is ${url}, and production trusts ${new URL(trusted).origin} (services/platform/wrangler.jsonc vars.SUPABASE_URL).`,
      'Accounts made on another stack are accounts no production build can sign in to; nothing was made.',
    ]);
  }
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || vault.get('SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) {
    throw new Refused(2, [
      `no service-role key for ${url}: set SUPABASE_SERVICE_ROLE_KEY in the environment (Box C's), or add SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY to the vault.`,
      'The vault\'s SUPABASE_SERVICE_ROLE_KEY is the hosted project\'s and is never used here.',
    ]);
  }
  const auth = gotrue({ url, serviceKey, fetchImpl });

  const accounts = [
    { role: 'free', email: (opts.freeEmail ?? DEFAULT_EMAILS.free).toLowerCase(), prefix: 'REVIEWER_FREE' },
    { role: 'pro', email: (opts.proEmail ?? DEFAULT_EMAILS.pro).toLowerCase(), prefix: 'REVIEWER_PRO' },
  ];
  for (const a of accounts) {
    if (!EMAIL.test(a.email)) throw new Refused(1, [`${a.email} is not an address under nikatru.com, the domain we own.`]);
    // A throwaway E2E shape would be swept: tooling/e2e/purge_stale.mjs deletes it.
    if (E2E_EMAIL_SHAPE.test(a.email) || E2E_SWEEPABLE_SHAPE.test(a.email)) throw new Refused(1, [`${a.email} has the throwaway E2E shape, which the stale sweep deletes.`]);
  }
  if (accounts[0].email === accounts[1].email) throw new Refused(1, ['the free and the Pro account cannot share one address.']);

  log(`${NAME}: ${apply ? 'APPLY' : 'PLAN (reads only; --apply writes)'} · auth ${url} · vault ${vaultPath}`);
  const done = [];
  for (const a of accounts) {
    const user = await auth.findByEmail(a.email);
    const held = vault.get(`${a.prefix}_PASSWORD`);
    const heldEmail = vault.get(`${a.prefix}_EMAIL`);
    if (heldEmail !== undefined && heldEmail.toLowerCase() !== a.email) {
      throw new Refused(1, [`the vault's ${a.prefix}_EMAIL is another address than ${a.email}; this tool will not move the account. Pass --${a.role}-email to match it.`]);
    }
    const steps = [];
    if (!held) steps.push(`generate a password and append ${a.prefix}_PASSWORD to the vault`);
    steps.push(user ? `set user ${user.id}'s password to the vault's` : 'create the user, pre-confirmed');
    if (heldEmail === undefined) steps.push(`append ${a.prefix}_EMAIL`);
    log(`  ${a.role.padEnd(4)} ${a.email} — ${user ? `exists (${user.id})` : 'absent'}; vault password ${held ? `held (${fingerprint(held)})` : 'absent'}`);
    log(`       ${apply ? 'doing' : 'would'}: ${steps.join('; ')}`);
    if (!apply) {
      done.push({ ...a, userId: user?.id ?? null });
      continue;
    }
    let password = held;
    if (!password) {
      password = newPassword();
      appendVault(vaultPath, `${a.prefix}_PASSWORD`, password);
    }
    appendVault(vaultPath, `${a.prefix}_EMAIL`, a.email);
    const userId = user ? user.id : await auth.create(a.email, password, a.role);
    if (user) await auth.setPassword(user.id, password, a.role);
    log(`       ok: user ${userId}; password ${fingerprint(password)} is in the vault as ${a.prefix}_PASSWORD`);
    done.push({ ...a, userId });
  }

  if (!opts.grantPro) {
    log(`  pro grant: not asked (--grant-pro). The Pro account is NOT Pro until it is.`);
    return { accounts: done, pro: null };
  }

  // ── --grant-pro: the owner_comp bundle grant, through the one writer ───────
  const fs = FEATURE_SET.exec(opts.featureSet ?? DEFAULT_FEATURE_SET);
  if (!fs) throw new Refused(1, [`--feature-set ${opts.featureSet} is not <name>@<version>.`]);
  const [setName, setVersion] = [fs[1], Number(fs[2])];
  const acct = cred('CLOUDFLARE_ACCOUNT_ID');
  const token = cred('CLOUDFLARE_D1_TOKEN', 'CLOUDFLARE_API_TOKEN');
  if (!acct || !token) throw new Refused(2, ['--grant-pro needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN).']);
  const target = await (opts.platformTarget ?? platformTarget)(root);
  if (target.environment !== 'live') throw new Refused(2, [`services/platform/wrangler.jsonc vars.MONEY_ENVIRONMENT is ${JSON.stringify(target.environment)}, not "live": a production grant would be written in a world the production reader does not serve.`]);
  const db = d1Db({ acct, token, dbId: target.dbId, fetchImpl });
  const platform = await (opts.loadPlatform ?? loadPlatform)(root);

  const source = (await db.prepare('SELECT source, requires_receipt FROM bundle_sources WHERE source = ?').bind('owner_comp').all()).results[0];
  if (!source || Number(source.requires_receipt) !== 0) {
    throw new Refused(2, ['platform_db bundle_sources has no `owner_comp` row with requires_receipt 0 (migration 0009): the comp source this grant is is not there.']);
  }
  const servedVersionOf = async () => {
    const r = await db
      .prepare(`SELECT COALESCE((SELECT MAX(version) FROM feature_sets WHERE name = ? AND status = 'sellable'), ?) AS served`)
      .bind(setName, setVersion)
      .all();
    return Number(r.results[0]?.served ?? setVersion);
  };
  const isMember = async (version) =>
    (await db.prepare('SELECT 1 AS hit FROM feature_set_members WHERE name = ? AND version = ? AND product_slug = ?').bind(setName, version, APP).all()).results.length > 0;
  let served = await servedVersionOf();
  let member = await isMember(served);
  log(`  pro grant: owner_comp via ${setName}@${setVersion} — served version ${served}, ${APP} ${member ? 'IS' : 'is NOT'} a member`);
  if (!member && opts.mintCompSet && apply) {
    const sha = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null;
    await db
      .prepare(`INSERT INTO feature_sets (name, version, minted_at, minted_from, status) VALUES (?, ?, ?, ?, 'draft') ON CONFLICT(name, version) DO NOTHING`)
      .bind(setName, setVersion, now().toISOString(), sha ? `${NAME}@${sha}` : NAME)
      .run();
    await db
      .prepare(`INSERT INTO feature_set_members (name, version, product_slug, product_kind) VALUES (?, ?, ?, 'app') ON CONFLICT(name, version, product_slug) DO NOTHING`)
      .bind(setName, setVersion, APP)
      .run();
    served = await servedVersionOf();
    member = await isMember(served);
    log(`       minted ${setName}@${setVersion} (draft, member ${APP}); served version ${served}, member ${member}`);
  }
  if (!member) {
    throw new Refused(2, [
      `${APP} is not a member of ${setName}'s served version, so an owner_comp grant on it would serve the reviewer nothing.`,
      `Decision for the lead: mint the comp set (re-run with --apply --grant-pro --mint-comp-set, which records ${setName}@${setVersion}`,
      `as a DRAFT with the single member ${APP}), or name a minted set with --feature-set <name>@<version>.`,
    ]);
  }
  const pro = done.find((a) => a.role === 'pro');
  const free = done.find((a) => a.role === 'free');
  if (!apply || !pro.userId) {
    log(`       would: upsertBundleGrant owner_comp for ${pro.email} (${pro.userId ?? 'user not made yet'}), ${opts.expiresDays ?? 365} days; then read both accounts back through readProductEntitlement`);
    return { accounts: done, pro: null };
  }
  const at = now();
  const expires = new Date(at.getTime() + (opts.expiresDays ?? 365) * 86_400_000).toISOString();
  const written = await platform.upsertBundleGrant(
    { db, environment: 'live' },
    {
      userId: pro.userId,
      source: 'owner_comp',
      featureSetName: setName,
      featureSetVersion: setVersion,
      // The operator record: who granted it, why, and when — the authority an
      // exempt source carries instead of a receipt (assert-bundle-provenance limb 5).
      provider: 'owner_comp',
      providerSubscriptionId: `store-review:${pro.userId}`,
      providerTransactionId: `operator-record:${NAME}:${at.toISOString().slice(0, 10)}`,
      providerStatus: 'active',
      lastEventId: `operator-record:${NAME}:store-review-pro`,
      occurredAt: at.toISOString(),
      currentPeriodEnd: expires,
      trialEnd: null,
      expiresAt: expires,
      graceUntil: null,
      revokedAt: null,
      revocationReason: null,
      creditDaysApplied: null,
      term: null,
    },
  );
  const proRead = await proOf(platform, db, target.environment, pro.userId);
  const freeRead = free.userId ? await proOf(platform, db, target.environment, free.userId) : null;
  log(`       grant ${written.outcome} (${written.grantId.slice(0, 12)}…), expires ${expires}`);
  log(`       read back: ${pro.email} is_pro ${proRead.isPro} via ${proRead.via}; ${free.email} is_pro ${freeRead?.isPro ?? 'n/a'}`);
  if (!proRead.isPro) throw new Refused(1, ['the grant was written and the entitlement reader still answers is_pro false for the Pro account.']);
  if (freeRead?.isPro) throw new Refused(1, ['the FREE reviewer account reads as Pro; it must not.']);
  return { accounts: done, pro: proRead };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const val = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const VALUED = ['--free-email', '--pro-email', '--feature-set', '--expires-days', '--vault'];
  const known = new Set([...VALUED, '--apply', '--grant-pro', '--mint-comp-set']);
  const unknown = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !VALUED.includes(argv[i - 1]));
  const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
  const days = val('--expires-days');
  const fail = (code, lines) => {
    console.error('');
    console.error(`${code === 2 ? 'FAIL COVERAGE LOST' : 'FAIL'} — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`     ${l}`);
    console.error(`\n${NAME}: FAILED`);
    process.exitCode = code;
  };
  if (unknown.length) fail(2, [`unknown flag(s): ${unknown.join(', ')}.`]);
  else if (days !== undefined && !/^[1-9]\d{0,3}$/.test(days)) fail(1, ['--expires-days takes a whole number of days, 1 to 9999.']);
  else {
    try {
      await run({
        root: resolve(positional[0] ?? join(HERE, '..', '..')),
        apply: argv.includes('--apply'),
        grantPro: argv.includes('--grant-pro'),
        mintCompSet: argv.includes('--mint-comp-set'),
        freeEmail: val('--free-email'),
        proEmail: val('--pro-email'),
        featureSet: val('--feature-set'),
        expiresDays: days === undefined ? undefined : Number(days),
        vault: val('--vault'),
      });
      console.log(`\n${NAME}: ok`);
    } catch (e) {
      if (e instanceof Refused) fail(e.code, e.lines);
      else throw e;
    }
  }
}
