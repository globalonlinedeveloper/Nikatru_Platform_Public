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
// ── ⬜ KNOWN-PENDING — THE BOOTSTRAP: NO ROW, AND AN ENTRY NOT YET VENDORED ────
// ⏱ 2026-10-03 · ops-watch 37103985999. A box cannot post until its cron is
// installed, and that install CREATES A CREDENTIAL (the box-scoped secret), so
// it is an owner step this repository cannot take; and a file the corpus has not
// (correctly) vendored yet has no hash to compare. Until those land, NO ROW and
// "no vendored sha256 yet" are true and are not the duty being broken — the
// bootstrap tooling/ops/register.json's `recordQuery.firstDue` answers for
// run-history duties (assert-ops-register.mjs) and check-secret-scopes.mjs's
// `firstDueVerdict` answers for a secret stored nowhere. The same terms here: a
// box's `firstDue` (an ISO instant) with a `firstDueWhy` naming the step it waits
// for turns THAT BOX'S NO ROW, and each of ITS entries with no vendored sha256,
// into a KNOWN-PENDING line, printed in full, that does not block. It is bounded
// four ways: it lifts those two states alone (every entry that HAS a hash is
// graded in full against the box's post, so DRIFT, STALE, MISSING and UNDECLARED
// stay red; a register that is unreadable, declares no box or a box with no file,
// and a D1 that cannot be read, stay COVERAGE LOST); only while now < firstDue;
// only for a date at most FIRST_DUE_MAX_DAYS ahead; and it expires by arithmetic
// — from that instant NO ROW is red and the entry COVERAGE LOST again, whether or
// not anybody edits the register. A malformed, unexplained or over-long firstDue
// gates nothing and says why on the line it would have lifted.
//
// ── THE VENDORED HASHES ──────────────────────────────────────────────────────
// The vendored copies live in the private corpus, which no CI job can read, so
// the register holds their sha256 and the PATH each was taken from. Refresh it
// from a checkout of the corpus with
//     node tooling/ops/check-box-config-drift.mjs --refresh-vendored <corpus dir>
// which rewrites only the `sha256` fields, from the files the `vendored` paths name.
// An entry whose vendored file is absent is written as `sha256: null` (never left
// holding a hash of a file the corpus no longer has) and named, exit 2; the
// reader then reports it COVERAGE LOST. If NO entry resolves, the corpus dir is
// wrong rather than the register, and nothing is written.
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

/** `abcdef123456…` — enough to tell two hashes apart in a log line. */
const short = (h) => (typeof h === 'string' ? `${h.slice(0, 12)}…` : String(h));

/** The longest a box's `firstDue` may sit ahead of now: a pending state is dated, never an open-ended waiver.
 *  Two weeks is one owner step plus one re-set; a date further out is refused, not honoured. */
export const FIRST_DUE_MAX_DAYS = 14;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * A box's bootstrap, PURE. `decl` is the box's register entry. Returns `{}` (no
 * firstDue), `{ notYetDue, hours }` (NO ROW is KNOWN-PENDING), or `{ problem }`
 * (it gates nothing, and the line says why). The terms are check-secret-scopes.mjs's
 * `firstDueVerdict` and assert-ops-register.mjs's `recordQuery.firstDue`.
 */
export function firstDueVerdict(decl, nowMs) {
  const fd = decl?.firstDue;
  if (fd === undefined || fd === null) return {};
  const dueMs = typeof fd === 'string' && ISO_INSTANT.test(fd) ? Date.parse(fd) : NaN;
  if (Number.isNaN(dueMs)) return { problem: `its firstDue ${JSON.stringify(fd)} is not an ISO instant (YYYY-MM-DDTHH:MM:SSZ), so it gates nothing` };
  if (typeof decl.firstDueWhy !== 'string' || decl.firstDueWhy.trim().length < 20) {
    return { problem: `its firstDue ${fd} carries no firstDueWhy naming the step it waits for, so it gates nothing: a bootstrap with no reason is a waiver` };
  }
  const aheadMs = dueMs - nowMs;
  if (aheadMs > FIRST_DUE_MAX_DAYS * 86_400_000) {
    return { problem: `its firstDue ${fd} is ${(aheadMs / 86_400_000).toFixed(1)} days ahead, past the ${FIRST_DUE_MAX_DAYS}-day bound, so it gates nothing: a pending state is dated, not open-ended` };
  }
  if (aheadMs > 0) return { notYetDue: true, hours: aheadMs / 3_600_000 };
  return { problem: `its firstDue (${fd}) has PASSED, so it gates nothing: do the step its firstDueWhy names, then delete the field` };
}

/**
 * The register, validated. Returns `{ boxes, maxPostAgeHours, lost, unmeasured }`
 * or `{ lost }`. A box with no declared file, or a file whose `sha256` is null,
 * is LOST: a reader that compared against nothing would print "no drift". Each
 * null-hash line is ALSO in `unmeasured` ({ box, line }), the one LOST state a
 * box's firstDue may hold pending (`gateUnmeasured`).
 */
export function readRegister(abs) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    return { lost: [`COVERAGE LOST — the register ${abs} could not be read (${e.message})`] };
  }
  const lost = [];
  const unmeasured = [];
  const maxPostAgeHours = reg?.maxPostAgeHours;
  if (!Number.isFinite(maxPostAgeHours) || maxPostAgeHours <= 0) lost.push('COVERAGE LOST — the register carries no positive maxPostAgeHours');
  const boxes = reg?.boxes && typeof reg.boxes === 'object' ? reg.boxes : {};
  if (Object.keys(boxes).length === 0) lost.push('COVERAGE LOST — the register declares no box');
  for (const [box, decl] of Object.entries(boxes)) {
    const files = decl?.files && typeof decl.files === 'object' ? decl.files : {};
    if (Object.keys(files).length === 0) lost.push(`COVERAGE LOST — ${box} declares no file`);
    for (const [name, f] of Object.entries(files)) {
      if (!SHA256.test(f?.sha256 ?? '')) {
        const line = `COVERAGE LOST — ${box}/${name} carries no vendored sha256 yet (refresh it with --refresh-vendored from the corpus)`;
        lost.push(line);
        unmeasured.push({ box, line });
      }
    }
  }
  return { boxes, maxPostAgeHours, lost, unmeasured };
}

/**
 * The bootstrap over the register's LOST lines, PURE. A null-hash entry on a box
 * inside its firstDue becomes a KNOWN-PENDING line (printed in full, not a
 * finding); every other LOST line stays LOST, and a box whose firstDue is refused
 * says why on its line. Returns `{ lost, pending }`.
 */
export function gateUnmeasured(register, nowMs) {
  const boxOf = new Map((register.unmeasured ?? []).map((u) => [u.line, u.box]));
  const lost = [];
  const pending = [];
  for (const l of register.lost ?? []) {
    const box = boxOf.get(l);
    const decl = box === undefined ? undefined : register.boxes?.[box];
    const due = decl ? firstDueVerdict(decl, nowMs) : {};
    if (due.notYetDue) {
      pending.push(
        `KNOWN-PENDING — ${l} NOT YET DUE: ${box}'s firstDue is ${decl.firstDue}, ${due.hours.toFixed(1)}h from now — ${decl.firstDueWhy.trim()} ` +
          'This prints and does not block; it is COVERAGE LOST from that instant, whether or not anybody edits the register.',
      );
    } else {
      lost.push(due.problem ? `${l}; ${box}: ${due.problem}` : l);
    }
  }
  return { lost, pending };
}

/**
 * THE JUDGEMENT, pure. `rows` are D1's (or a fixture's) `{box, manifest,
 * posted_at}`; `manifest` is the JSON text the route stored (an object is
 * accepted too, for fixtures). Returns `{ findings, ok, pending, notes }` —
 * lines, never a value beyond a short hash. `pending` is a box's NO ROW inside
 * its `firstDue` (printed in full, not a finding); `notes` print and grade nothing.
 */
export function judgeDrift(register, rows, nowMs) {
  const findings = [];
  const ok = [];
  const pending = [];
  const notes = [];
  const byBox = new Map();
  for (const r of rows ?? []) if (r && typeof r.box === 'string') byBox.set(r.box, r);
  for (const [box, decl] of Object.entries(register.boxes)) {
    const row = byBox.get(box);
    if (!row) {
      const line = `${box}: NO ROW — the box has never posted its config hashes (is the cron installed, and can it reach the Worker?)`;
      const due = firstDueVerdict(decl, nowMs);
      if (due.notYetDue) {
        pending.push(
          `KNOWN-PENDING — ${line} NOT YET DUE: firstDue is ${decl.firstDue}, ${due.hours.toFixed(1)}h from now — ${decl.firstDueWhy.trim()} ` +
            'This prints and does not block; it BLOCKS from that instant, whether or not anybody edits the register.',
        );
      } else {
        findings.push(due.problem ? `${line}; ${due.problem}` : line);
      }
      continue;
    }
    // A box that has posted and whose every entry carries a hash is past its
    // bootstrap: it is graded in full below, and a firstDue left on it would read
    // as a waiver it is not. (A null-hash entry is still held by it: gateUnmeasured.)
    const unmeasured = Object.values(decl.files ?? {}).some((f) => !SHA256.test(f?.sha256 ?? ''));
    if (decl.firstDue !== undefined && !unmeasured) {
      notes.push(`${box}: has posted and every entry carries a hash, so its firstDue (${JSON.stringify(decl.firstDue)}) gates nothing — delete the field and its firstDueWhy`);
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
  return { findings, ok, pending, notes };
}

/** platform_db's id, from the wrangler config of the Worker that owns its migrations. */
function platformDbId() {
  const cfg = parseJsonc(readFileSync(join(ROOT, PLATFORM_WRANGLER_REL), 'utf8'));
  return (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id ?? null;
}

/**
 * The D1 query URL. 🔴 THE HOST IS A LITERAL and the file supplies only the
 * database id, so the id is refused (CouldNotLook) unless it is a UUID before it
 * enters the path: a `database_id` of `x/../../user` would otherwise send the
 * Cloudflare token to a different API path on the same host. This is what makes
 * the by-design disposition of CodeQL alert 584 (js/file-access-to-http) true.
 */
export function d1QueryUrl(account, databaseId) {
  if (typeof databaseId !== 'string' || !UUID.test(databaseId)) {
    throw new CouldNotLook(`${PLATFORM_WRANGLER_REL} database_id ${JSON.stringify(databaseId)} is not a UUID — refused before it reaches the D1 API URL`);
  }
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${databaseId}/query`;
}

/** The manifest rows, a SELECT through the D1 HTTP API. `env`, `dbId` and
 *  `fetchImpl` are injectable so a test can prove a refused id makes no request. */
export async function readRows({ env = process.env, dbId, fetchImpl = globalThis.fetch } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment — cannot read box_config_manifest');
  const db = dbId === undefined ? platformDbId() : dbId;
  if (!db) throw new CouldNotLook(`${PLATFORM_WRANGLER_REL} has no D1 binding carrying migrations_dir`);
  const url = d1QueryUrl(account, db);
  // 🔴 A POST THAT IS A READ (the D1 HTTP API takes SELECTs by POST), so a
  // re-send changes nothing — the same decision check-heartbeats.mjs records.
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetchImpl(url, {
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

/**
 * Rewrite each entry's `sha256` from the vendored file its `vendored` path names.
 * An entry the corpus does not hold is written `null` and named (exit 2): a hash
 * kept for a file that is gone would compare the box against nothing that exists,
 * and the reader reports the null as COVERAGE LOST. If no entry resolves at all,
 * the corpus dir is what is wrong, so nothing is written.
 */
function refreshVendored(registerAbs, corpusDir) {
  const reg = JSON.parse(readFileSync(registerAbs, 'utf8'));
  const problems = [];
  let resolved = 0;
  for (const [box, decl] of Object.entries(reg.boxes ?? {})) {
    for (const [name, f] of Object.entries(decl.files ?? {})) {
      const abs = typeof f.vendored === 'string' ? join(corpusDir, f.vendored) : null;
      if (!abs || !existsSync(abs)) {
        problems.push(`${box}/${name}: vendored path ${JSON.stringify(f.vendored)} does not exist under ${corpusDir} — its sha256 is null (COVERAGE LOST) until the corpus vendors it`);
        f.sha256 = null;
        continue;
      }
      f.sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex');
      resolved++;
    }
  }
  if (resolved === 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`✗ NOT WRITTEN — no declared entry resolved under ${corpusDir}: the corpus dir is wrong, not the register`);
    return 2;
  }
  writeFileSync(registerAbs, `${JSON.stringify(reg, null, 2)}\n`);
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length) {
    console.error(`✗ ${registerAbs} refreshed from ${corpusDir}: ${resolved} hash(es) written, ${problems.length} entr(ies) the corpus does not hold (above)`);
    return 2;
  }
  console.log(`✓ ${registerAbs} refreshed from ${corpusDir}: ${resolved} hash(es) written`);
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
    // An unreadable D1 is never pending: nothing at all was read.
    const gated = gateUnmeasured(register, nowMs);
    console.error(`✗ COVERAGE LOST — box_config_manifest could not be read: ${e?.message ?? e}`);
    for (const l of gated.pending) console.log(`⬜ ${l}`);
    for (const l of gated.lost) console.error(`✗ ${l}`);
    process.exitCode = 2;
    return;
  }

  const { findings, ok, pending: noRowPending, notes } = judgeDrift(register, rows, nowMs);
  const gated = gateUnmeasured(register, nowMs);
  const pending = [...noRowPending, ...gated.pending];
  for (const l of ok) console.log(`✓ ${l}`);
  for (const l of pending) console.log(`⬜ ${l}`);
  for (const l of notes) console.log(`ℹ ${l}`);
  for (const l of findings) console.error(`✗ ${l}`);
  for (const l of gated.lost) console.error(`✗ ${l}`);
  if (gated.lost.length) process.exitCode = 2;
  else if (findings.length) process.exitCode = 1;
  else if (pending.length) {
    // Not the all-clear line: what a pending line names was compared with nothing.
    console.log(
      `✓ no finding — ${pending.length} line(s) KNOWN-PENDING, NOT YET DUE (printed above; what they name was compared with nothing). ` +
        `Every other declared entry posted within ${register.maxPostAgeHours}h is the vendored config.`,
    );
    process.exitCode = 0;
  } else {
    console.log(`✓ every declared box posted within ${register.maxPostAgeHours}h, and its live config is the vendored config`);
    process.exitCode = 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
