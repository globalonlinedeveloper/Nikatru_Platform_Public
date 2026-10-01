#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// worker-secrets.mjs — EVERY WORKER SECRET FROM ONE MANIFEST, SYNCED FROM THE
// VAULT BY ONE COMMAND (owner lock 2026-10-01: portable, from the pipeline).
// Rotating any key = edit its vault key, then `sync --secret <NAME>`.
//
//   check    [--worker W] [--port P [--adapter A]]
//            Diffs tooling/worker-secrets.json, the live secret NAMES of every
//            Worker script (Cloudflare lists names, never values) and the vault
//            NAMES. Exit 1 when a live secret has no manifest row (undeclared),
//            or a vault-set row is live but absent from the vault (a custody
//            gap: the value exists only on Cloudflare, so it cannot be rotated
//            or re-synced from the pipeline). With --port, one line per secret
//            `<name> <present|absent> <len> <sha8>` (present = set on its
//            Worker; len/sha8 of the vault value, `0 -` when the vault lacks
//            it), for tooling/ops/port-switch.mjs to parse.
//   sync     [--worker W] [--secret S] [--dry-run] [--force]
//            PUTs the vault value of each selected `setBy: vault` row. Without
//            --secret it only RE-SYNCS names already live (it never provisions
//            one: setting an absent secret can switch a feature on). An
//            unchanged value (its sha256 equals the ledger's, and the name is
//            live) is SKIPPED; --force always PUTs. `deploy` rows ride
//            deploy-workers.yml and are never written here.
//   generate <SECRET> [--worker W] [--dry-run]
//            For a `generated` row: random bytes into the vault FIRST (a backup
//            copy, append, read back), then the PUT. Refuses when the vault
//            already holds the key — that is a rotation, and the row's
//            `rotation` says how (TOKEN_ENC_KEY_V1 must never be replaced).
//
// NEVER PRINTS A VALUE: a length and the first 8 hex of its sha256 only. The
// vault is read in-process. Cloudflare credentials come from the environment
// (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: CI) or else the vault.
// Cloudflare cannot read a secret back, so idempotence is a hash LEDGER beside
// the vault (worker-secrets.ledger.json, gitignored with the whole .claude/).
// The vault is $NIKATRU_VAULT, else <root>/.claude/secrets.env, else the main
// checkout's (a worktree has no .claude/; `git rev-parse --git-common-dir`).
//
// Exit 0 done/clean, 1 a finding or a refused/failed write, 2 COVERAGE LOST
// (names or vault unreadable) or a usage error. On Windows a process.exit()
// after fetch aborts in libuv (TRAPS: UV_HANDLE_CLOSING), so this only ever
// sets process.exitCode.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkers, MANIFEST } from '../ci/assert-worker-secrets-declared.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API_DEFAULT = 'https://api.cloudflare.com/client/v4';
export const LEDGER_NAME = 'worker-secrets.ledger.json';
const VALUE_FLAGS = new Set(['--worker', '--secret', '--port', '--adapter', '--root']);
const NO_VALUE_FLAGS = new Set(['--dry-run', '--force']);

export const sha8 = (v) => createHash('sha256').update(v).digest('hex').slice(0, 8);
export const sha256 = (v) => createHash('sha256').update(v).digest('hex');
/** The only thing ever printed about a value. */
export const fingerprint = (v) => (typeof v === 'string' && v.length ? `len ${v.length} sha8 ${sha8(v)}` : 'len 0 sha8 -');

export function parseArgs(argv) {
  const out = { cmd: null, positional: [], worker: null, secret: null, port: null, adapter: null, root: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (NO_VALUE_FLAGS.has(a)) { if (a === '--dry-run') out.dryRun = true; else out.force = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown flag ${a}` };
    if (!out.cmd) out.cmd = a; else out.positional.push(a);
  }
  if (!['check', 'sync', 'generate'].includes(out.cmd)) return { error: 'usage: worker-secrets.mjs check|sync|generate …' };
  if (out.cmd === 'generate' && out.positional.length !== 1) return { error: 'generate takes exactly one <SECRET>' };
  if (out.cmd !== 'generate' && out.positional.length) return { error: `unexpected argument ${out.positional[0]}` };
  if (out.adapter && !out.port) return { error: '--adapter needs --port' };
  return out;
}

/** KEY=value lines (optional `export`, optional quotes: TRAPS ci-14 — an unstripped quote reads as a revoked token). */
export function parseVault(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    map.set(m[1], v);
  }
  return map;
}

export function vaultPath(root) {
  if (process.env.NIKATRU_VAULT) return process.env.NIKATRU_VAULT;
  const own = join(root, '.claude', 'secrets.env');
  if (existsSync(own)) return own;
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (r.status === 0 && r.stdout.trim()) {
    const common = r.stdout.trim();
    const main = dirname(isAbsolute(common) ? common : resolve(root, common));
    return join(main, '.claude', 'secrets.env');
  }
  return own;
}

export function readLedger(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

/** Atomic: write a temp file, re-read and parse it, then rename over (TRAPS ci-21). */
export function writeLedger(path, ledger) {
  const text = `${JSON.stringify(ledger, null, 2)}\n`;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  JSON.parse(readFileSync(tmp, 'utf8'));
  renameSync(tmp, path);
}

/** What sync does with one row: a pure decision, so the tests can hold it. */
export function decideSync(row, { vaultValue, livePresent, ledgerSha, force, explicit = false }) {
  if (row.setBy !== 'vault') return { action: 'skip', why: `setBy ${row.setBy}: carried by ${row.setBy === 'deploy' ? 'deploy-workers.yml (--secrets-file)' : row.setBy}, never written here` };
  const inVault = typeof vaultValue === 'string' && vaultValue.length > 0;
  if (!inVault && livePresent) return { action: 'refuse', why: `vault key ${row.vaultKey} is absent: a CUSTODY GAP, the value exists only on Cloudflare` };
  if (!inVault) return explicit ? { action: 'refuse', why: `vault key ${row.vaultKey} is absent: nothing to sync` } : { action: 'skip', why: 'not provisioned (neither the vault nor the Worker holds it)' };
  // A bulk sync RE-SYNCS what is live and never provisions: setting an absent
  // secret can switch a feature on (a payment rail, a receipt verifier), so
  // that takes an explicit --secret.
  if (!livePresent && !explicit) return { action: 'skip', why: 'absent on the Worker: provisioning takes an explicit --secret' };
  if (!force && livePresent && ledgerSha === sha256(vaultValue)) return { action: 'skip', why: 'unchanged (ledger hash equals the vault value, and the name is live)' };
  return { action: 'put', why: force ? '--force' : !livePresent ? 'absent on the Worker' : ledgerSha ? 'the vault value differs from the ledger' : 'no ledger entry yet' };
}

/** The API base: the default, or a loopback test double — never another host with the token. */
export function apiBase() {
  const b = process.env.CLOUDFLARE_API_BASE;
  if (!b) return API_DEFAULT;
  if (!/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(b)) throw new Error(`CLOUDFLARE_API_BASE may only be a 127.0.0.1 test double, not ${b}`);
  return b.replace(/\/$/, '');
}

function creds(vault) {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID || vault?.get('CLOUDFLARE_ACCOUNT_ID') || '';
  const token = process.env.CLOUDFLARE_API_TOKEN || vault?.get('CLOUDFLARE_API_TOKEN') || '';
  return acct && token ? { acct, token } : null;
}

async function cf(c, method, path, body) {
  const res = await fetch(`${apiBase()}/accounts/${c.acct}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json?.success !== false, json, errors: (json?.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ') };
}

/** Live secret NAMES per script; a script Cloudflare does not know is `null` (not deployed), any other failure throws. */
async function liveNames(c, scripts) {
  const out = new Map();
  for (const s of scripts) {
    const r = await cf(c, 'GET', `/workers/scripts/${encodeURIComponent(s)}/secrets`);
    if (r.status === 404) { out.set(s, null); continue; }
    if (!r.ok) throw new Error(`listing ${s}'s secret names: HTTP ${r.status} ${r.errors}`);
    out.set(s, new Set((r.json.result ?? []).map((x) => x.name)));
  }
  return out;
}

function loadManifest(root) {
  const doc = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  if (!Array.isArray(doc?.rows) || !doc.rows.length) throw new Error(`${MANIFEST} has no rows`);
  return doc.rows;
}

class Refusal extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

async function run(opts) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const rows = loadManifest(root);
  const vPath = vaultPath(root);
  if (!existsSync(vPath)) throw new Refusal(`COVERAGE LOST — the vault ${vPath} does not exist; set NIKATRU_VAULT or run from a checkout that has .claude/`, 2);
  let vaultText = readFileSync(vPath, 'utf8');
  let vault = parseVault(vaultText);
  const c = creds(vault);
  if (!c) throw new Refusal('COVERAGE LOST — no CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN in the environment or the vault', 2);
  const ledgerPath = join(dirname(vPath), LEDGER_NAME);
  const ledger = readLedger(ledgerPath);

  const workers = readWorkers(root).filter((w) => !w.error);
  const scripts = [...new Set([...workers.flatMap((w) => w.scripts), ...rows.map((r) => r.worker)])].sort();
  let selected = rows;
  if (opts.worker) selected = selected.filter((r) => r.worker === opts.worker);
  if (opts.port) selected = selected.filter((r) => r.port === opts.port && (!opts.adapter || r.adapter === opts.adapter));

  if (opts.cmd === 'check') {
    let live;
    try { live = await liveNames(c, opts.worker ? [opts.worker] : scripts); } catch (e) { throw new Refusal(`COVERAGE LOST — ${e.message}`, 2); }
    if (opts.port) {
      if (!selected.length) throw new Refusal(`no row of ${MANIFEST} names port ${opts.port}${opts.adapter ? ` adapter ${opts.adapter}` : ''}`, 1);
      let bad = 0;
      for (const r of selected) {
        const v = vault.get(r.vaultKey);
        const present = live.get(r.worker)?.has(r.secret) ? 'present' : 'absent';
        console.log(`${r.secret} ${present} ${v ? v.length : 0} ${v ? sha8(v) : '-'}`);
        if (r.setBy === 'vault' && present === 'present' && !v) bad++;
      }
      return bad ? 1 : 0;
    }
    const findings = [];
    for (const r of selected) {
      const names = live.get(r.worker);
      const v = vault.get(r.vaultKey);
      const isLive = !!names?.has(r.secret);
      const led = ledger[`${r.worker}/${r.secret}`]?.sha256;
      const ledState = !v || !led ? 'none' : led === sha256(v) ? 'match' : 'differs';
      console.log(`${r.worker} ${r.secret} live:${names === null ? 'no-script' : isLive ? 'present' : 'absent'} vault:${v ? 'present' : 'absent'}(${r.vaultKey}) ${fingerprint(v)} ledger:${ledState} setBy:${r.setBy}`);
      if (r.setBy === 'vault' && isLive && !v) findings.push(`CUSTODY GAP ${r.worker}/${r.secret}: live, but vault key ${r.vaultKey} is absent — it cannot be rotated or re-synced from the pipeline`);
    }
    if (!opts.worker) {
      const declared = new Set(rows.map((r) => `${r.worker}/${r.secret}`));
      for (const [s, names] of live) for (const n of names ?? []) if (!declared.has(`${s}/${n}`)) findings.push(`UNDECLARED ${s}/${n}: live on Cloudflare, no row of ${MANIFEST}`);
    }
    for (const f of findings) console.log(f);
    console.log(findings.length ? `check: ${findings.length} finding(s)` : `check: clean over ${selected.length} row(s)`);
    return findings.length ? 1 : 0;
  }

  if (opts.cmd === 'sync') {
    if (opts.secret) selected = selected.filter((r) => r.secret === opts.secret);
    if (!selected.length) throw new Refusal(`no row of ${MANIFEST} matches${opts.worker ? ` --worker ${opts.worker}` : ''}${opts.secret ? ` --secret ${opts.secret}` : ''}`, 1);
    let live;
    try { live = await liveNames(c, [...new Set(selected.map((r) => r.worker))]); } catch (e) { throw new Refusal(`COVERAGE LOST — ${e.message}`, 2); }
    let failed = 0;
    for (const r of selected) {
      const v = vault.get(r.vaultKey);
      const names = live.get(r.worker);
      const d = decideSync(r, { vaultValue: v, livePresent: !!names?.has(r.secret), ledgerSha: ledger[`${r.worker}/${r.secret}`]?.sha256, force: opts.force, explicit: !!opts.secret });
      const tag = `${r.worker}/${r.secret} (${fingerprint(v)})`;
      if (d.action === 'refuse') { console.log(`REFUSED ${tag}: ${d.why}`); failed++; continue; }
      if (d.action === 'skip') { console.log(`skipped ${tag}: ${d.why}`); continue; }
      if (names === null) { console.log(`REFUSED ${tag}: script ${r.worker} does not exist on Cloudflare`); failed++; continue; }
      if (opts.dryRun) { console.log(`DRY RUN — would PUT ${tag}: ${d.why}`); continue; }
      const put = await cf(c, 'PUT', `/workers/scripts/${encodeURIComponent(r.worker)}/secrets`, { name: r.secret, text: v, type: 'secret_text' });
      if (!put.ok) { console.log(`FAILED PUT ${tag}: HTTP ${put.status} ${put.errors}`); failed++; continue; }
      ledger[`${r.worker}/${r.secret}`] = { sha256: sha256(v), vaultKey: r.vaultKey, at: new Date().toISOString() };
      writeLedger(ledgerPath, ledger);
      console.log(`PUT ${tag}: HTTP ${put.status} (${d.why}); ledger updated`);
    }
    return failed ? 1 : 0;
  }

  // generate
  const name = opts.positional[0];
  let cands = rows.filter((r) => (r.secret === name || r.vaultKey === name) && r.kind === 'generated');
  if (opts.worker) cands = cands.filter((r) => r.worker === opts.worker);
  if (!cands.length) throw new Refusal(`no generated row of ${MANIFEST} is ${name}${opts.worker ? ` on ${opts.worker}` : ''}`, 1);
  if (cands.length > 1) throw new Refusal(`${name} is generated on ${cands.map((r) => r.worker).join(', ')}: pass --worker`, 2);
  const r = cands[0];
  if (vault.has(r.vaultKey)) throw new Refusal(`vault key ${r.vaultKey} already exists (${fingerprint(vault.get(r.vaultKey))}); generate never replaces a key. Re-send it with \`sync --secret ${r.secret} --worker ${r.worker}\`, or rotate per the row: ${r.rotation}`, 1);
  const value = randomBytes(r.generate.bytes).toString(r.generate.encoding);
  if (opts.dryRun) { console.log(`DRY RUN — would add vault key ${r.vaultKey} (${r.generate.bytes} random bytes, ${r.generate.encoding}) and PUT ${r.worker}/${r.secret}`); return 0; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  copyFileSync(vPath, `${vPath}.pre-${r.vaultKey}-${stamp}Z`);
  appendFileSync(vPath, `${vaultText.endsWith('\n') || !vaultText.length ? '' : '\n'}${r.vaultKey}="${value}"\n`);
  vaultText = readFileSync(vPath, 'utf8');
  vault = parseVault(vaultText);
  if (vault.get(r.vaultKey) !== value) throw new Refusal(`the vault write of ${r.vaultKey} was not read back; STOP before the Worker`, 1);
  console.log(`vault: ${r.vaultKey} added (${fingerprint(value)}); backup ${vPath}.pre-${r.vaultKey}-${stamp}Z`);
  const put = await cf(c, 'PUT', `/workers/scripts/${encodeURIComponent(r.worker)}/secrets`, { name: r.secret, text: value, type: 'secret_text' });
  if (!put.ok) { console.log(`FAILED PUT ${r.worker}/${r.secret}: HTTP ${put.status} ${put.errors}. The vault holds it; re-send with \`sync --secret ${r.secret} --worker ${r.worker}\``); return 1; }
  ledger[`${r.worker}/${r.secret}`] = { sha256: sha256(value), vaultKey: r.vaultKey, at: new Date().toISOString() };
  writeLedger(ledgerPath, ledger);
  console.log(`PUT ${r.worker}/${r.secret}: HTTP ${put.status}; ledger updated`);
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) { console.error(opts.error); process.exitCode = 2; return; }
  try {
    process.exitCode = await run(opts);
  } catch (e) {
    console.error(e instanceof Refusal ? e.message : `worker-secrets: ${e.message}`);
    process.exitCode = e instanceof Refusal ? e.code : 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
