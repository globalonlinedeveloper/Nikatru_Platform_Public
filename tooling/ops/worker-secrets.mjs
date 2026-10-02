#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// worker-secrets.mjs — EVERY WORKER SECRET FROM ONE MANIFEST, SYNCED FROM THE
// VAULT BY ONE COMMAND (owner lock 2026-10-01: portable, from the pipeline).
// Rotating a `replace: "explicit"` key = edit its vault key, then
// `sync --secret <NAME> --replace <NAME>`. A `replace: "never"` key (TOKEN_ENC_KEY_*:
// it seals stored data) is NEVER overwritten while live: rotate it as a new name (_V2)
// plus a migration (#1135 review finding 1).
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
//            it, and sha8 `-` for a value under 16 characters, whose hash
//            would give it away), for tooling/ops/port-switch.mjs to parse.
//   sync     [--worker W] [--secret S] [--replace NAME]... [--dry-run] [--force]
//            Provisions an ABSENT name only with an explicit --secret (setting
//            one can switch a feature on). A LIVE name is skipped when the
//            ledger shows the vault value is what was last synced; otherwise
//            it is REFUSED, its length (and sha8, when long enough) printed,
//            unless its row is `replace: "explicit"` and `--replace <NAME>` is
//            spelled out for it. A `replace: "never"` row is refused while live
//            by every flag. --force re-sends an unchanged value, only where a
//            replace is allowed. `deploy` rows ride deploy-workers.yml and are
//            never written here.
//   generate <SECRET> [--worker W] [--dry-run]
//            For a `generated` row: random bytes into the vault FIRST (the
//            vault read once, the new text verified in memory, a backup of
//            what was read, then ONE write: temp file + rename), then the PUT.
//            It first LISTS the Worker's live names and refuses when the name
//            is live, whatever the vault holds and with no flag to override
//            (a live value missing from a vault is a custody gap: import it).
//            It also refuses when the vault already holds the key. The vault
//            write refuses a symlinked vault, and a vault whose mtime or size
//            moved since it was read (a concurrent edit).
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
import { readFileSync, readlinkSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkers, MANIFEST } from '../ci/assert-worker-secrets-declared.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API_DEFAULT = 'https://api.cloudflare.com/client/v4';
export const LEDGER_NAME = 'worker-secrets.ledger.json';
const VALUE_FLAGS = new Set(['--worker', '--secret', '--port', '--adapter', '--root', '--replace']);
const NO_VALUE_FLAGS = new Set(['--dry-run', '--force']);
/** Below this length a hash of a value is a dictionary lookup away from the value, so only its length prints. */
export const MIN_HASHED_LENGTH = 16;

export const sha8 = (v) => createHash('sha256').update(v).digest('hex').slice(0, 8);
export const sha256 = (v) => createHash('sha256').update(v).digest('hex');
/** The only thing ever printed about a value: its length, and a sha8 only when it is long enough not to give the value away. */
export const fingerprint = (v) => {
  if (typeof v !== 'string' || !v.length) return 'len 0';
  return v.length < MIN_HASHED_LENGTH ? `len ${v.length}` : `len ${v.length} sha8 ${sha8(v)}`;
};

export function parseArgs(argv) {
  const out = { cmd: null, positional: [], worker: null, secret: null, port: null, adapter: null, root: null, dryRun: false, force: false, replace: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (NO_VALUE_FLAGS.has(a)) { if (a === '--dry-run') out.dryRun = true; else out.force = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      // --replace is spelled out once per NAME it may overwrite; it is never a wildcard.
      if (a === '--replace') out.replace.push(v);
      else out[a.slice(2)] = v;
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

/** Where the vault may be, in order: $NIKATRU_VAULT alone, else <root>/.claude/secrets.env, then the main checkout's. */
export function vaultCandidates(root) {
  if (process.env.NIKATRU_VAULT) return [process.env.NIKATRU_VAULT];
  const out = [join(root, '.claude', 'secrets.env')];
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (r.status === 0 && r.stdout.trim()) {
    const common = r.stdout.trim();
    out.push(join(dirname(isAbsolute(common) ? common : resolve(root, common)), '.claude', 'secrets.env'));
  }
  return out;
}

// ⏱ 2026-10-02 · CodeQL #552 (js/file-system-race, high), PR #1135. `generate` read the vault,
// then appended to it in a SECOND access, after an existsSync check on the same path: a file can
// change between a check and the use that trusts it. Now the vault is read ONCE (no existence
// check: a missing file is ENOENT from the read itself), the new text is built and verified IN
// MEMORY, and it is written ONCE: a temp file beside the vault, renamed over it (atomic on one
// volume). Nothing appends to the vault and nothing re-reads it.

/** ONE read: the first candidate that reads is the vault. `{ path, text }`, or `{ path: null, tried }`. */
export function readVault(root, { read = readFileSync, readlink = readlinkSync, stat = statSync } = {}) {
  const tried = [];
  for (const path of vaultCandidates(root)) {
    let text;
    try {
      text = read(path, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
      tried.push(path);
      continue;
    }
    // A symlinked vault would be REPLACED by a regular file at the rename, and its target would
    // keep the old text: refused. readlink answers EINVAL for anything that is not a link.
    let target = null;
    try { target = readlink(path); } catch (e) { if (e?.code !== 'EINVAL') throw e; }
    if (target !== null) throw new Refusal(`the vault ${path} is a symlink; refusing to read or write a vault through a link (point NIKATRU_VAULT at the file itself)`, 2);
    // Taken AFTER the read, so nothing here checks a file and then trusts the check: writeVaultOnce
    // compares these to the file just before its rename, and refuses a concurrent edit.
    const s = stat(path);
    return { path, text, mtimeMs: s.mtimeMs, size: s.size };
  }
  return { path: null, tried };
}

/** PURE. The vault text with `key` added, verified before anything is written. */
export function withVaultKey(text, key, value) {
  const next = `${text}${text.endsWith('\n') || !text.length ? '' : '\n'}${key}="${value}"\n`;
  if (parseVault(next).get(key) !== value) throw new Refusal(`the new vault text does not hold ${key} as written; nothing was written, STOP before the Worker`, 1);
  return next;
}

/** ONE write of the whole vault: a temp file created beside it (`wx`: never an existing file), then renamed over it.
 *  `asRead` is readVault's { mtimeMs, size }: if the vault moved since that read, an edit made in between would be
 *  lost by the rename, so it refuses and removes its temp file instead. */
export function writeVaultOnce(path, next, asRead, { write = writeFileSync, rename = renameSync, stat = statSync, remove = unlinkSync } = {}) {
  if (!asRead || typeof asRead.mtimeMs !== 'number' || typeof asRead.size !== 'number') throw new Refusal('writeVaultOnce needs the mtime and size the vault was read at', 2);
  const tmp = `${path}.tmp-${process.pid}`;
  write(tmp, next, { mode: 0o600, flag: 'wx' });
  const now = stat(path);
  if (now.mtimeMs !== asRead.mtimeMs || now.size !== asRead.size) {
    remove(tmp);
    throw new Refusal(`the vault ${path} changed since it was read (mtime or size moved): a concurrent edit; nothing was written, run again`, 1);
  }
  rename(tmp, path);
}

export function readLedger(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

/** Atomic: the JSON is validated in memory, written to a temp file, then renamed over (TRAPS ci-21). */
export function writeLedger(path, ledger) {
  const text = `${JSON.stringify(ledger, null, 2)}\n`;
  JSON.parse(text);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

/** What sync does with one row: a pure decision, so the tests can hold it.
 *
 *  ⏱ 2026-10-02 · #1135 review finding 1 (MAJOR). Overwriting a LIVE secret is never a default:
 *  a key that seals stored data (TOKEN_ENC_KEY_*) overwritten live makes every sealed row
 *  unreadable for good. So a live name is only ever SKIPPED (the ledger shows the vault value is
 *  what was last synced), or replaced when its row is `replace: "explicit"` AND the operator spelled
 *  `--replace <NAME>` for it. A `replace: "never"` row is never overwritten while live, by any flag:
 *  rotating it is a new name (`_V2`) and a migration. `--force` only re-sends an UNCHANGED value,
 *  and only where a replace is allowed. A row with no `replace` is treated as `never`. */
export function decideSync(row, { vaultValue, livePresent, ledgerSha, force, explicit = false, replace = [] }) {
  if (row.setBy !== 'vault') return { action: 'skip', why: `setBy ${row.setBy}: carried by ${row.setBy === 'deploy' ? 'deploy-workers.yml (--secrets-file)' : row.setBy}, never written here` };
  const inVault = typeof vaultValue === 'string' && vaultValue.length > 0;
  if (!inVault && livePresent) return { action: 'refuse', why: `vault key ${row.vaultKey} is absent: a CUSTODY GAP, the value exists only on Cloudflare` };
  if (!inVault) return explicit ? { action: 'refuse', why: `vault key ${row.vaultKey} is absent: nothing to sync` } : { action: 'skip', why: 'not provisioned (neither the vault nor the Worker holds it)' };
  // A bulk sync never provisions: setting an absent secret can switch a feature on (a payment
  // rail, a receipt verifier), so that takes an explicit --secret.
  if (!livePresent && !explicit) return { action: 'skip', why: 'absent on the Worker: provisioning takes an explicit --secret' };
  if (!livePresent) return { action: 'put', why: 'absent on the Worker: provisioned' };
  const unchanged = ledgerSha === sha256(vaultValue);
  if (unchanged && !force) return { action: 'skip', why: 'unchanged (ledger hash equals the vault value, and the name is live)' };
  const mode = row.replace === 'explicit' ? 'explicit' : 'never';
  const versus = `the vault holds ${fingerprint(vaultValue)}; the last synced value ${!ledgerSha ? 'is unknown (no ledger entry)' : unchanged ? 'is the same' : `differs${vaultValue.length < MIN_HASHED_LENGTH ? '' : ` (ledger sha8 ${ledgerSha.slice(0, 8)})`}`}`;
  if (mode === 'never') {
    return { action: 'refuse', why: `LIVE and \`replace: "never"\`: it is never overwritten in place, by any flag (${versus}). Rotate it as a NEW name (_V2) plus a migration.` };
  }
  if (!replace.includes(row.secret)) {
    return { action: 'refuse', why: `LIVE: overwriting it needs \`--replace ${row.secret}\` spelled out (${versus})` };
  }
  return { action: 'put', why: `--replace ${row.secret}${force ? ' --force' : ''} (${versus})` };
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
/** Pages of one Worker's secret listing read at most; past that the listing is refused, never truncated. */
export const MAX_LIST_PAGES = 20;

/** Live secret NAMES per script; a script Cloudflare does not know is `null` (not deployed).
 *  ⏱ 2026-10-02 · #1135 review 2: this FAILS CLOSED. Every caller decides "is this name live?"
 *  from it, and `generate`/`sync` write when the answer is no, so an answer it could not read
 *  is never "no live names": a success whose `result` is not an array, a page past
 *  MAX_LIST_PAGES, or names that do not add up to the listing's `result_info.total_count`
 *  THROW, and the run stops before any write. */
async function liveNames(c, scripts) {
  const out = new Map();
  for (const s of scripts) {
    const names = [];
    let total = null;
    let missing = false;
    for (let page = 1; ; page++) {
      if (page > MAX_LIST_PAGES) throw new Error(`listing ${s}'s secret names ran past ${MAX_LIST_PAGES} pages; refusing a truncated listing`);
      const path = `/workers/scripts/${encodeURIComponent(s)}/secrets${page > 1 ? `?page=${page}` : ''}`;
      const r = await cf(c, 'GET', path);
      if (r.status === 404 && page === 1) { missing = true; break; }
      if (!r.ok) throw new Error(`listing ${s}'s secret names: HTTP ${r.status} ${r.errors}`);
      if (!Array.isArray(r.json?.result)) throw new Error(`listing ${s}'s secret names: a success with no \`result\` array, so which names are live is UNKNOWN`);
      for (const x of r.json.result) {
        if (typeof x?.name !== 'string' || !x.name) throw new Error(`listing ${s}'s secret names: an entry with no name`);
        names.push(x.name);
      }
      const info = r.json.result_info;
      if (Number.isInteger(info?.total_count)) total = info.total_count;
      if (!(Number.isInteger(info?.total_pages) && page < info.total_pages)) break;
    }
    if (missing) { out.set(s, null); continue; }
    if (total !== null && names.length !== total) throw new Error(`listing ${s}'s secret names: read ${names.length} of total_count ${total}; refusing a partial listing`);
    out.set(s, new Set(names));
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
  const read = readVault(root);
  if (!read.path) throw new Refusal(`COVERAGE LOST — the vault does not exist (${read.tried.join(', ')}); set NIKATRU_VAULT or run from a checkout that has .claude/`, 2);
  const vPath = read.path;
  const vaultText = read.text;
  const vault = parseVault(vaultText);
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
        console.log(`${r.secret} ${present} ${v ? v.length : 0} ${v && v.length >= MIN_HASHED_LENGTH ? sha8(v) : '-'}`);
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
    const stray = opts.replace.filter((n) => !selected.some((r) => r.secret === n));
    if (stray.length) throw new Refusal(`--replace ${stray.join(', ')} names no selected row: a replace is spelled per NAME it overwrites`, 2);
    let live;
    try { live = await liveNames(c, [...new Set(selected.map((r) => r.worker))]); } catch (e) { throw new Refusal(`COVERAGE LOST — ${e.message}`, 2); }
    let failed = 0;
    for (const r of selected) {
      const v = vault.get(r.vaultKey);
      const names = live.get(r.worker);
      const d = decideSync(r, { vaultValue: v, livePresent: !!names?.has(r.secret), ledgerSha: ledger[`${r.worker}/${r.secret}`]?.sha256, force: opts.force, explicit: !!opts.secret, replace: opts.replace });
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
  // ⏱ 2026-10-02 · #1135 review finding 1: the LIVE Worker is asked first, names only. A name that is
  // live is never generated over, whatever this vault holds and whatever flag is given: with the
  // wrong vault (a worktree's, a stray NIKATRU_VAULT) or a custody gap, a fresh value over a live
  // sealing key makes every sealed row unreadable, and the old key may be in no vault at all.
  let live;
  try { live = await liveNames(c, [r.worker]); } catch (e) { throw new Refusal(`COVERAGE LOST — ${e.message}; generate never writes without first reading the live names`, 2); }
  if (live.get(r.worker) === null) throw new Refusal(`script ${r.worker} does not exist on Cloudflare`, 1);
  if (live.get(r.worker).has(r.secret)) {
    throw new Refusal(
      `${r.worker}/${r.secret} is LIVE: generate never writes over a live secret (row replace: ${r.replace ?? 'never'}). ` +
        `If this vault lacks it, that is a CUSTODY GAP: import the value from where it was made, never regenerate it. ` +
        `Rotating it: ${r.rotation}`,
      1,
    );
  }
  if (vault.has(r.vaultKey)) throw new Refusal(`vault key ${r.vaultKey} already exists (${fingerprint(vault.get(r.vaultKey))}); generate never replaces a key. Re-send it with \`sync --secret ${r.secret} --worker ${r.worker}\`, or rotate per the row: ${r.rotation}`, 1);
  const value = randomBytes(r.generate.bytes).toString(r.generate.encoding);
  if (opts.dryRun) { console.log(`DRY RUN — would add vault key ${r.vaultKey} (${r.generate.bytes} random bytes, ${r.generate.encoding}) and PUT ${r.worker}/${r.secret}`); return 0; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const backup = `${vPath}.pre-${r.vaultKey}-${stamp}Z`;
  const next = withVaultKey(vaultText, r.vaultKey, value);
  // The backup is the text this run READ, written from memory: no second read of the vault.
  writeFileSync(backup, vaultText, { mode: 0o600, flag: 'wx' });
  writeVaultOnce(vPath, next, read);
  console.log(`vault: ${r.vaultKey} added (${fingerprint(value)}); backup ${backup}`);
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
