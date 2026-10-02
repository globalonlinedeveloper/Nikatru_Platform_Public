#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-box-config-drift.mjs — is each box's LIVE config the config we vendored?
//
// PB-27 (O-JWKS-FALLBACK-LIVES-TEN-MINUTES folds O-BOX-CONFIG-OUTSIDE-THE-LANE).
// Box B's and Box C's compose, override and tunnel config is applied over SSH
// and re-vendored by hand, and until this reader nothing compared the two: a
// hand edit on a box that never reached the vendored copy was invisible until a
// rebuild from the vendored copy quietly undid it.
//
// ── THE CHAIN, AND WHY THE BOX PUSHES ────────────────────────────────────────
//   tooling/ops/boxes/post-config-manifest.sh (a cron ON the box)
//     → POST /v1/ops/box-manifest (services/platform/src/routes/box-manifest.ts),
//       authenticated with a secret scoped to that one box
//     → platform_db.box_config_manifest (one row per box, replaced whole)
//     → THIS reader, in ops-watch, against tooling/ops/box-config-vendored.json.
// CI never SSHes into a box: a CI credential that can log into a box is a
// bigger exposure than the drift it would find. Hashes only travel; content
// never leaves the box.
//
// ── WHAT IS RED ──────────────────────────────────────────────────────────────
// Exit 1 (a finding), per box the register declares:
//   · NO ROW          the box has never posted (the cron is not installed, or
//                     cannot reach the Worker);
//   · STALE           its newest post is older than `maxPostAgeHours` — the cron
//                     stopped, so the row describes a past box;
//   · DRIFT           a declared file's live hash is not the vendored hash;
//   · MISSING         a declared file is absent from the box's post;
//   · UNDECLARED      the box posted a file the register does not declare.
// Exit 2 (COVERAGE LOST — deliberately not a pass): the register is unreadable
// or declares no box, an entry carries no vendored hash yet, or D1 could not be
// read. 2 beats 1, as in check-heartbeats.mjs; every finding is still printed.
//
// ── THE VENDORED HASHES ──────────────────────────────────────────────────────
// The vendored copies live in the private corpus, which no CI job can read, so
// the register holds their sha256 and the PATH each was taken from. Refresh it
// from a checkout of the corpus with
//     node tooling/ops/check-box-config-drift.mjs --refresh-vendored <corpus dir>
// which rewrites only the `sha256` fields, from the files the `vendored` paths name.
//
// Usage:
//   node tooling/ops/check-box-config-drift.mjs                    # reads D1
//   node tooling/ops/check-box-config-drift.mjs --manifest <file>  # a fixture: [{box, manifest, posted_at}]
//   [--register <file>] [--now <ISO>]
// Env (the D1 read): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './check-heartbeats.mjs';
import { CouldNotLook, classifyThrown, isTransientStatus, readWithBoundedRetry, retryAfterMs, transientLook } from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const REGISTER_REL = 'tooling/ops/box-config-vendored.json';
const PLATFORM_WRANGLER_REL = 'services/platform/wrangler.jsonc';
const SHA256 = /^[0-9a-f]{64}$/;

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

/** `abcdef123456…` — enough to tell two hashes apart in a log line. */
const short = (h) => (typeof h === 'string' ? `${h.slice(0, 12)}…` : String(h));

/**
 * The register, validated. Returns `{ boxes, maxPostAgeHours }` or `{ lost }`.
 * A box with no declared file, or a file whose `sha256` is null, is LOST: a
 * reader that compared against nothing would print "no drift".
 */
export function readRegister(abs) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    return { lost: [`COVERAGE LOST — the register ${abs} could not be read (${e.message})`] };
  }
  const lost = [];
  const maxPostAgeHours = reg?.maxPostAgeHours;
  if (!Number.isFinite(maxPostAgeHours) || maxPostAgeHours <= 0) lost.push('COVERAGE LOST — the register carries no positive maxPostAgeHours');
  const boxes = reg?.boxes && typeof reg.boxes === 'object' ? reg.boxes : {};
  if (Object.keys(boxes).length === 0) lost.push('COVERAGE LOST — the register declares no box');
  for (const [box, decl] of Object.entries(boxes)) {
    const files = decl?.files && typeof decl.files === 'object' ? decl.files : {};
    if (Object.keys(files).length === 0) lost.push(`COVERAGE LOST — ${box} declares no file`);
    for (const [name, f] of Object.entries(files)) {
      if (!SHA256.test(f?.sha256 ?? '')) {
        lost.push(`COVERAGE LOST — ${box}/${name} carries no vendored sha256 yet (refresh it with --refresh-vendored from the corpus)`);
      }
    }
  }
  return { boxes, maxPostAgeHours, lost };
}

/**
 * THE JUDGEMENT, pure. `rows` are D1's (or a fixture's) `{box, manifest,
 * posted_at}`; `manifest` is the JSON text the route stored (an object is
 * accepted too, for fixtures). Returns `{ findings, ok }` — lines, never a value
 * beyond a short hash.
 */
export function judgeDrift(register, rows, nowMs) {
  const findings = [];
  const ok = [];
  const byBox = new Map();
  for (const r of rows ?? []) if (r && typeof r.box === 'string') byBox.set(r.box, r);
  for (const [box, decl] of Object.entries(register.boxes)) {
    const row = byBox.get(box);
    if (!row) {
      findings.push(`${box}: NO ROW — the box has never posted its config hashes (is the cron installed, and can it reach the Worker?)`);
      continue;
    }
    const postedMs = Date.parse(row.posted_at);
    const ageH = (nowMs - postedMs) / 3_600_000;
    if (!Number.isFinite(postedMs)) {
      findings.push(`${box}: STALE — its post carries no readable posted_at (${JSON.stringify(row.posted_at)})`);
    } else if (ageH > register.maxPostAgeHours) {
      findings.push(`${box}: STALE — the newest post is ${ageH.toFixed(1)}h old, past ${register.maxPostAgeHours}h; the cron has stopped, so the row describes a past box`);
    }
    let live;
    try {
      live = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
    } catch {
      live = null;
    }
    if (!live || typeof live !== 'object' || Array.isArray(live)) {
      findings.push(`${box}: its stored manifest is not a JSON object`);
      continue;
    }
    const declared = decl.files ?? {};
    for (const [name, f] of Object.entries(declared)) {
      if (!SHA256.test(f?.sha256 ?? '')) continue; // reported as LOST by readRegister
      if (!Object.hasOwn(live, name)) findings.push(`${box}/${name}: MISSING — declared, and absent from the box's post`);
      else if (live[name] !== f.sha256) findings.push(`${box}/${name}: DRIFT — live ${short(live[name])} ≠ vendored ${short(f.sha256)} (${f.vendored ?? 'no vendored path'})`);
      else ok.push(`${box}/${name}: live = vendored ${short(f.sha256)}`);
    }
    for (const name of Object.keys(live)) {
      if (!Object.hasOwn(declared, name)) findings.push(`${box}/${name}: UNDECLARED — the box posts a file the register does not declare`);
    }
  }
  return { findings, ok };
}

/** platform_db's id, from the wrangler config of the Worker that owns its migrations. */
function platformDbId() {
  const cfg = parseJsonc(readFileSync(join(ROOT, PLATFORM_WRANGLER_REL), 'utf8'));
  return (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id ?? null;
}

async function readRows() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment — cannot read box_config_manifest');
  const db = platformDbId();
  if (!db) throw new CouldNotLook(`${PLATFORM_WRANGLER_REL} has no D1 binding carrying migrations_dir`);
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`;
  // 🔴 A POST THAT IS A READ (the D1 HTTP API takes SELECTs by POST), so a
  // re-send changes nothing — the same decision check-heartbeats.mjs records.
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT box, manifest, posted_at FROM box_config_manifest', params: [] }),
      });
    } catch (e) {
      throw classifyThrown(e, `the D1 API did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (!res.ok) {
      const line = `the D1 API returned ${res.status}`;
      throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw classifyThrown(e, `the D1 API response was not JSON (${e.message})`);
    }
    if (body?.success !== true) throw new CouldNotLook(`the D1 API reported failure: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    const rows = body?.result?.[0]?.results;
    if (!Array.isArray(rows)) throw new CouldNotLook('the D1 API response carried no results array');
    return rows;
  });
}

/** Rewrite each entry's `sha256` from the vendored file its `vendored` path names. */
function refreshVendored(registerAbs, corpusDir) {
  const reg = JSON.parse(readFileSync(registerAbs, 'utf8'));
  const problems = [];
  for (const [box, decl] of Object.entries(reg.boxes ?? {})) {
    for (const [name, f] of Object.entries(decl.files ?? {})) {
      const abs = typeof f.vendored === 'string' ? join(corpusDir, f.vendored) : null;
      if (!abs || !existsSync(abs)) {
        problems.push(`${box}/${name}: vendored path ${JSON.stringify(f.vendored)} does not exist under ${corpusDir}`);
        continue;
      }
      f.sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    return 2;
  }
  writeFileSync(registerAbs, `${JSON.stringify(reg, null, 2)}\n`);
  console.log(`✓ ${registerAbs} refreshed from ${corpusDir}`);
  return 0;
}

// ⚠️ `process.exitCode` and return, NEVER `process.exit()` (check-heartbeats.mjs
// records why: exiting while a fetch handle closes aborts Node on Windows).
async function main() {
  const registerAbs = resolve(flag('--register') ?? join(ROOT, REGISTER_REL));
  const corpus = flag('--refresh-vendored');
  if (corpus) {
    process.exitCode = refreshVendored(registerAbs, resolve(corpus));
    return;
  }
  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`✗ COVERAGE LOST — --now is not a parseable date: ${nowFlag}`);
    process.exitCode = 2;
    return;
  }
  const register = readRegister(registerAbs);
  if (!register.boxes) {
    for (const l of register.lost) console.error(`✗ ${l}`);
    process.exitCode = 2;
    return;
  }

  let rows;
  const fixture = flag('--manifest');
  try {
    rows = fixture ? JSON.parse(readFileSync(resolve(fixture), 'utf8')) : await readRows();
    if (!Array.isArray(rows)) throw new CouldNotLook('the manifest rows are not an array');
  } catch (e) {
    console.error(`✗ COVERAGE LOST — box_config_manifest could not be read: ${e?.message ?? e}`);
    for (const l of register.lost) console.error(`✗ ${l}`);
    process.exitCode = 2;
    return;
  }

  const { findings, ok } = judgeDrift(register, rows, nowMs);
  for (const l of ok) console.log(`✓ ${l}`);
  for (const l of findings) console.error(`✗ ${l}`);
  for (const l of register.lost) console.error(`✗ ${l}`);
  if (register.lost.length) process.exitCode = 2;
  else if (findings.length) process.exitCode = 1;
  else {
    console.log(`✓ every declared box posted within ${register.maxPostAgeHours}h, and its live config is the vendored config`);
    process.exitCode = 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
