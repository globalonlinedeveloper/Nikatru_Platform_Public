#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// name-clearance.mjs — IS THIS NAME AVAILABLE ON EVERY CHANNEL THIS FACTORY CAN
// RELEASE TO, AND CAN WE PROVE IT EITHER WAY?
//
// Pipeline requirement: Private/requirements/ → D-3, D-5.
//
// 🔴 WHY IT EXISTS, IN ONE MEASUREMENT. On 2026-09-09 the Microsoft Partner
// Center "reserve a name" dialog was open on **Subly**, one click from a
// three-month submit-or-lose clock — and Subly is a name iOS and macOS can NEVER
// ship under, because App Store names are GLOBALLY UNIQUE and six-plus published
// apps already hold it, one of them in Finance, the same category. Checking a
// name was something a person had to remember; this is that memory made
// mechanical. The owner's words: "App name should be available in all
// environments, app name no trade name, we need to check in all perspective."
//
// ── THIS IS A TOOL. THE THING THAT BLOCKS THE BUILD IS THE GUARD ─────────────
// MEASURED ON THIS MACHINE 2026-09-09, wall clock including node start: this
// probe 15,365 ms / 13,726 ms over ~20 external calls (two samples, warm);
// tooling/ci/assert-name-clearance.mjs, which reads the record this writes and
// touches no network, 297 / 285 / 269 ms (three samples, warm). The existing
// pre-commit fast set is ~11.3 s and the 4.3 s that took it there was argued at
// length. Fourteen seconds of network on every commit is not a candidate: a
// blocking hook that slow gets bypassed inside a week, and a guard that is
// skipped is worth less than no guard, because it also carries the belief that
// something was checked. SO THE SLOW NETWORKED PART IS THIS FILE, THE FAST
// OFFLINE PART IS THE GUARD, AND THIS FILE NEVER ENTERS A HOOK.
//
// ── READ-ONLY AGAINST EVERY EXTERNAL PLATFORM ────────────────────────────────
// Nothing here creates, reserves, registers, claims, submits or publishes
// anything. Every call is a GET, or the one documented read-only POST the winget
// catalogue search takes. The two authorities that could answer definitively —
// App Store Connect's New App dialog and Partner Center's reserve-name dialog —
// answer BY MUTATING, so they are refused and named as owner-only manual steps.
//
// ── THE ONE RULE: THREE ANSWERS, NEVER TWO ───────────────────────────────────
// PROVEN-TAKEN / PROVEN-FREE / UNDETERMINED, with the discipline and the red
// controls written out in `name-probes.mjs`. UNDETERMINED NEVER COUNTS AS CLEAR.
// A channel in tooling/channel-register.json with no probe registered comes out
// UNDETERMINED and says so — it is never silently dropped.
//
// ── IT WALKS THE REGISTER, AND IT CALLS THE IDENTITY READER THAT EXISTS ──────
// The channel set is `tooling/channel-register.json`'s `channels` array; there
// is no channel list in this file. The permanent identifiers are read by
// `tooling/ci/read-identity.mjs` — `resolveIdentity(root, app, decl)` — which
// already resolves the FILE for each identity from that same register (which is
// why it gets the macOS xcconfig right where the pbxproj carries only the TEST
// bundle's id) and already answers in the `{value} / {missing} / {lost}`
// trichotomy this needs, where `lost` means COVERAGE LOST. A second identity
// reader would inherit none of its tests and would report agreement between two
// things it read wrongly.
//
// EXIT CODES
//   0  CLEAR         every channel that can answer said free
//   1  BLOCKED or QUALIFIED — a wall, or a ruling is owed before this name ships
//   2  COVERAGE LOST — could not check, which is deliberately NOT a pass
//
// USAGE
//   node tooling/store/name-clearance.mjs <Name> [--app <slug>] [--json]
//   node tooling/store/name-clearance.mjs <Name> --app <slug> --execute
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIdentity } from '../ci/read-identity.mjs';
import { rulingOwed } from '../scripts/name-ruling.mjs';
import { PROBES, noProbeRegistered, identityLines, norm, PROVEN_FREE, PROVEN_TAKEN, UNDETERMINED, NOT_APPLICABLE, GLOBAL } from './name-probes.mjs';

export const RECORD_REL = (app) => `apps/${app}/name-clearance.json`;
export const REGISTER_REL = 'tooling/channel-register.json';
export const CATALOG_REL = 'catalog/apps.json';
export const SCHEMA_REL = 'contracts/name-clearance.schema.json';

export const TRADEMARK_DISCLAIMER =
  'ADVISORY SIGNAL ONLY. THIS IS NOT LEGAL ADVICE. No software can clear a trademark: registry databases ' +
  '(USPTO TSDR, the UK IPO, the Indian registry) are not reachable from an unauthenticated read and are not ' +
  'faked here. These are observations that require an explicit OWNER RULING, recorded with a date.';

/** LOCAL date, never `toISOString()`. This machine sits ahead of UTC, so an
 *  evening run would stamp yesterday — and the staleness ceiling is computed off
 *  this field, so a day lost here is a day of the ceiling given away. */
export const today = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The default transport. Returns a UNIFORM shape whatever happens — a thrown
 *  fetch and a 500 must be distinguishable from a 404, and neither may be
 *  mistaken for an answer. `json` is null when the body did not parse, which is
 *  what a JS-rendered store page returns and what must never read as "free". */
export function makeHttp({ timeoutMs = 25_000, fetchImpl = globalThis.fetch } = {}) {
  return async function http(url, opts = {}) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, {
        signal: ac.signal,
        redirect: 'follow',
        method: opts.method || 'GET',
        body: opts.body,
        headers: { 'user-agent': 'nikatru-name-clearance/1.0 (read-only availability probe)', ...(opts.headers || {}) },
      });
      const text = await r.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return { ok: true, status: r.status, text, json: parsed };
    } catch (e) {
      return { ok: false, status: 0, text: '', json: null, error: String(e?.message || e) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The whole clearance, as data. Separated from the CLI so the suite can drive it
 * with a stub transport — a probe table whose controls can only be exercised
 * against the live internet is a probe table whose red controls are never tested.
 *
 * Throws `CoverageLost` when the register or the catalogue cannot be read: the
 * channel set would then be unknown, and a clearance computed over an unknown
 * channel set is a clearance over nothing.
 */
export class CoverageLost extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
    this.name = 'COVERAGE LOST';
  }
}

export async function clear({ root, name, app, http, now = new Date() }) {
  // ⚠️ EVERY READ BELOW IS A SINGLE ATTEMPT, NEVER `existsSync` FOLLOWED BY A
  // READ. CodeQL's js/file-system-race flagged that shape HIGH in this file on
  // 2026-09-09, and it is right in principle for every one of them: absent and
  // unreadable are the SAME answer to this function — COVERAGE LOST — so the
  // check bought nothing and opened a window in which the answer could change.
  const registerAbs = join(root, REGISTER_REL);
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    throw new CoverageLost([
      `cannot read ${REGISTER_REL} at ${registerAbs} (${e.message}).`,
      'The channel set IS the register, so with it unreadable NOTHING was checked — and nothing is not a pass.',
    ]);
  }
  const channels = register.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new CoverageLost([`${REGISTER_REL} holds no \`channels\` array.`, 'A clearance over zero channels is the vacuous pass this whole design exists to refuse.']);
  }

  const catalogAbs = join(root, CATALOG_REL);
  let catalog = null;
  try {
    catalog = JSON.parse(readFileSync(catalogAbs, 'utf8'));
  } catch {
    catalog = null;
  }
  if (!Array.isArray(catalog)) {
    throw new CoverageLost([
      `${CATALOG_REL} was not readable as an array.`,
      'It is the only authority on the one namespace this factory owns, so without it the `web` channel could ' +
        'not be judged and the run would silently under-report a collision with our own catalogue.',
    ]);
  }

  const slug = norm(name).replace(/[^a-z0-9]+/g, '');
  // The snap name is the ONE permanent identifier the register does not model as
  // an `identity` block — it is a plain text file — so `read-identity.mjs` cannot
  // answer for it and this is the only place the disagreement can be seen. Read
  // here rather than in the probe table, which stays free of the filesystem.
  const snapRel = `apps/${app}/store/linux-snap/snap-name.txt`;
  const snapAbs = join(root, snapRel);
  let snapDeclared = null;
  try {
    snapDeclared = { value: readFileSync(snapAbs, 'utf8').trim(), rel: snapRel };
  } catch {
    snapDeclared = null;
  }
  const asOf = today(now);
  const out = { app, slug, name, asOf, channels: {}, identifiers: [], controls: { green: 0, failed: [] } };

  for (const row of channels) {
    const decl = row.identity ?? null;
    const identity = decl ? resolveIdentity(root, app, decl) : null;
    const identityRel = decl?.declaredIn ? decl.declaredIn.replace('{app}', app) : null;
    const probe = PROBES[row.id];
    let result;
    if (!probe) {
      result = noProbeRegistered(row.id);
    } else {
      try {
        const r = await probe.run({ http, name, slug, app, catalog, identity, identityRel, snapDeclared, row, register });
        result = { uniqueness: probe.uniqueness, ...r };
      } catch (e) {
        result = { uniqueness: probe.uniqueness, verdict: UNDETERMINED, why: `the probe threw: ${e.message}`, evidence: [], control: null };
      }
    }
    if (result.control) {
      if (result.control.green) out.controls.green += 1;
      else out.controls.failed.push(row.id);
    }
    out.channels[row.id] = {
      verdict: result.verdict,
      uniqueness: result.uniqueness,
      why: result.why,
      evidence: result.evidence ?? [],
      control: result.control ?? null,
    };

    // ── the permanent identifier, from the reader that already exists ────────
    if (decl) {
      const id = identityLines(identity, identityRel);
      out.identifiers.push({
        channel: row.id,
        kind: decl.kind,
        declaredIn: identityRel,
        value: identity?.value ?? null,
        verdict:
          id.state === 'value'
            ? result.verdict === PROVEN_TAKEN
              ? PROVEN_TAKEN
              : result.verdict === PROVEN_FREE
                ? PROVEN_FREE
                : UNDETERMINED
            : id.state === 'absent'
              ? NOT_APPLICABLE
              : UNDETERMINED,
        why:
          id.state === 'value'
            ? `${id.lines[0]} — bound PERMANENTLY at the first upload on this channel and never recycled, so this is the string that cannot be taken back. ${result.why}`
            : id.lines[0] ?? 'the register declares an identity for this channel and nothing could be read for it.',
      });
    }
  }

  out.trademark = { disclaimer: TRADEMARK_DISCLAIMER, signals: await trademarkSignals({ http, slug, out }), ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null };
  out.overall = rollUp(out).overall;
  return out;
}

/** Observations, never a verdict. A domain that resolves to a live commercial
 *  site is a signal; so is a same-category listing found during the store sweep.
 *  Both go under the disclaimer and both demand a dated owner ruling. */
async function trademarkSignals({ http, slug, out }) {
  const signals = [];
  for (const tld of ['com', 'app', 'io']) {
    const r = await http(`https://${slug}.${tld}/`);
    signals.push(r.ok ? `${slug}.${tld} — RESOLVES, HTTP ${r.status}. A live site suggests an existing commercial holder.` : `${slug}.${tld} — did not resolve (${r.error ?? 'no answer'}).`);
  }
  for (const [id, ch] of Object.entries(out.channels)) {
    if (ch.verdict !== PROVEN_TAKEN) continue;
    for (const e of ch.evidence) signals.push(`${id} — a live listing carries this name: ${e}`);
  }
  return signals;
}

/**
 * THE ROLL-UP, and the order of its branches is the design.
 *
 * A wall outranks everything. Below that, COVERAGE LOST on a channel that
 * REFUSES duplicates outranks a merely qualified answer — because on such a
 * channel "I could not tell" and "it is free" have completely different
 * consequences and must never share an exit code.
 */
export function rollUp(record) {
  const entries = Object.entries(record.channels);
  const blocking = entries.filter(([id, c]) => c.verdict === PROVEN_TAKEN && (c.uniqueness === GLOBAL || id === 'web'));
  const advisory = entries.filter(([, c]) => c.verdict === PROVEN_TAKEN && c.uniqueness === 'tolerated');
  const undetermined = entries.filter(([, c]) => c.verdict === UNDETERMINED);
  const undeterminedGlobal = undetermined.filter(([, c]) => c.uniqueness === GLOBAL);

  // The owner refusing the name is a wall too, and outranks what follows for the
  // same reason: nothing ships under it, whatever the channels could not tell.
  const tm = record.trademark ?? {};
  if (blocking.length || tm.ruling === 'DO-NOT-PROCEED') return { overall: 'BLOCKED', exit: 1, blocking, advisory, undetermined };
  if (record.controls.failed.length || undeterminedGlobal.length) {
    return { overall: 'UNDETERMINED', exit: 2, blocking, advisory, undetermined };
  }
  // Only a COMPLETE PROCEED clears. This read `ruling == null` until 2026-09-24,
  // which let a DO-NOT-PROCEED roll up to CLEAR on a record with nothing else
  // owed; then `ruling === 'PROCEED'` alone, which cleared a PROCEED that limb 7
  // of tooling/ci/assert-name-clearance.mjs refuses for want of who, when or on
  // what basis (the PR 913 review, L2). Both now ask `rulingOwed`.
  if (advisory.length || undetermined.length || tm.ruling !== 'PROCEED' || rulingOwed(tm).length) {
    return { overall: 'QUALIFIED', exit: 1, blocking, advisory, undetermined };
  }
  return { overall: 'CLEAR', exit: 0, blocking, advisory, undetermined };
}

/**
 * `--execute`. Writes the record — and REFUSES to overwrite a good one with a
 * worse one.
 *
 * 🔴 A STALE-BUT-REAL CLEARANCE BEATS A FRESH RECORD FULL OF "I COULD NOT
 * CHECK". If any red control failed on this run, every verdict it produced is
 * worth less than it looks, and writing them over an existing record would
 * DESTROY evidence and replace it with the appearance of freshness. So the write
 * is refused whenever a control failed and a record already exists.
 *
 * The trademark block is PRESERVED, never rewritten: the probe cannot produce a
 * ruling, and a re-probe that reset `gatedUntil` would be a waiver extending its
 * own reason, which is the shape this corpus deletes.
 *
 * 🔴 ONE VERDICT: the MERGED record's. The probe's own roll-up never sees the
 * carried ruling, so a PROCEED record re-probed clean rolls up QUALIFIED while
 * the file says CLEAR — and a sweep comparing that against the file's `overall`
 * reports a flip that never happened, every week. So this returns the written
 * `overall` (and its exit), and the sweep and the CLI print and compare THAT.
 * `dryRun` builds and rolls up the merged record without writing it.
 */
export function writeRecord(root, record, { force = false, dryRun = false } = {}) {
  const rel = RECORD_REL(record.app);
  const abs = join(root, rel);
  // ⚠️ ONE READ, NOT A CHECK-THEN-WRITE. This was `existsSync(abs)` followed by a
  // `writeFileSync(abs, …)` further down, and CodeQL's js/file-system-race
  // flagged it HIGH on the first push: between the check and the write the file
  // can change, so the refusal below could be decided against a state that no
  // longer holds. Reading the bytes once answers BOTH questions this function
  // asks — does a record exist, and what does it carry forward — with no window
  // in between. An unreadable existing file still counts as EXISTING, because
  // the refusal is about not destroying somebody's evidence and a file we cannot
  // parse is not a file we may assume is worthless.
  let priorText = null;
  try {
    priorText = readFileSync(abs, 'utf8');
  } catch {
    priorText = null;
  }
  const existed = priorText !== null;
  if (record.controls.failed.length && existed && !force) {
    return {
      written: false,
      refused: true,
      rel,
      why:
        `REFUSED — ${record.controls.failed.length} red control(s) failed on this run (${record.controls.failed.join(', ')}), ` +
        `and ${rel} already holds a record. A stale-but-real clearance beats a fresh one full of "I could not check": ` +
        'overwriting would destroy evidence and replace it with the appearance of freshness.',
    };
  }
  let carried = null;
  let carriedWhy = null;
  if (existed) {
    try {
      const prior = JSON.parse(priorText);
      carried = prior.trademark ?? null;
      // The seeded prose survives the weekly sweep. A routine that silently
      // deleted the paragraph explaining why a record is BLOCKED and the build
      // is not would leave the next reader with the verdict and none of the
      // reasoning — which is how a considered state comes to look like a bug.
      carriedWhy = Array.isArray(prior._why) ? prior._why : null;
    } catch {
      carried = null;
    }
  }
  const merged = {
    ...(carriedWhy ? { _why: carriedWhy } : {}),
    ...record,
    name: { value: record.name, asOf: record.asOf, verify: `node tooling/store/name-clearance.mjs ${shellQuote(record.name)} --app ${record.app} --execute`, verifyKind: 'remote' },
    trademark: carried
      ? { ...record.trademark, ruling: carried.ruling ?? null, ruledBy: carried.ruledBy ?? null, ruledOn: carried.ruledOn ?? null, basis: carried.basis ?? null, ownerItem: carried.ownerItem ?? null, gatedUntil: carried.gatedUntil ?? null }
      : record.trademark,
  };
  const verdict = rollUp(merged);
  merged.overall = verdict.overall;
  if (dryRun) {
    return { written: false, refused: false, rel, why: `${rel} not written (dry run).`, overall: verdict.overall, exit: verdict.exit, verdict, record: merged };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`);
  return { written: true, refused: false, rel, why: `${rel} rewritten from this run.`, overall: verdict.overall, exit: verdict.exit, verdict, record: merged };
}

/** POSIX single-quoting, so a multi-word name stays ONE argument when the
 *  record's `verify` line is pasted into a shell. A bare `${name}` split
 *  "Nikatru Subscription Tracker" into three positionals and cleared "Nikatru". */
export function shellQuote(s) {
  return /^[A-Za-z0-9._\/-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n, d = null) => {
    const i = argv.indexOf(n);
    return i === -1 ? d : argv[i + 1];
  };
  const FLAGS_WITH_VALUES = new Set(['--app', '--repo']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUES.has(argv[i - 1]));
  const NAME = positional[0];
  if (!NAME) {
    console.error('COVERAGE LOST — no candidate name was given, so nothing was checked.');
    console.error('usage: node tooling/store/name-clearance.mjs <Name> [--app <slug>] [--json] [--execute]');
    process.exit(2);
  }
  const ROOT = resolve(flag('--repo', DEFAULT_ROOT));
  const APP = flag('--app', norm(NAME).replace(/[^a-z0-9]+/g, ''));
  const AS_JSON = argv.includes('--json');
  const EXECUTE = argv.includes('--execute');

  let record;
  try {
    record = await clear({ root: ROOT, name: NAME, app: APP, http: makeHttp() });
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.lines[0]}`);
      for (const l of e.lines.slice(1)) console.error(`  ${l}`);
      process.exit(2);
    }
    throw e;
  }
  // The verdict printed and exited on is the one the record carries once the
  // owner's ruling is merged in — the same roll-up `writeRecord` stamps into the
  // file's `overall`. A refused write keeps the probe's own.
  const w = writeRecord(ROOT, record, { dryRun: !EXECUTE });
  const verdict = w.refused ? rollUp(record) : w.verdict;

  if (AS_JSON) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    const B = '─'.repeat(78);
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`\n${B}\nNAME CLEARANCE — "${record.name}"   (slug "${record.slug}", app "${record.app}")   asOf ${record.asOf}`);
    console.log(`${REGISTER_REL} — ${Object.keys(record.channels).length} channel(s) walked, none hardcoded\n${B}`);
    for (const [id, c] of Object.entries(record.channels)) {
      const mark = c.verdict === PROVEN_TAKEN ? '⛔' : c.verdict === PROVEN_FREE ? '✅' : c.verdict === NOT_APPLICABLE ? '· ' : '⚠️ ';
      console.log(`${pad(id, 18)}${pad(c.uniqueness, 12)}${mark} ${c.verdict}`);
      console.log(`   ${c.why}`);
      for (const e of c.evidence) console.log(`     · ${e}`);
      if (c.control && !c.control.green) console.log(`     ✗ RED CONTROL FAILED — ${c.control.what} (${c.control.detail})`);
      console.log('');
    }
    console.log(`${B}\nPERMANENT IDENTIFIERS — read by tooling/ci/read-identity.mjs from the files the\nregister declares. These can NEVER be changed or reused once claimed.\n${B}`);
    for (const r of record.identifiers) console.log(`${pad(r.channel, 18)}${pad(String(r.value ?? '—'), 26)}${r.verdict}\n   ${r.why}\n`);
    console.log(`${B}\nTRADEMARK\n${record.trademark.disclaimer}\n${B}`);
    for (const s of record.trademark.signals) console.log(`  · ${s}`);
    console.log(`\n${B}\nOVERALL: ${verdict.overall}\n${B}`);
    if (verdict.blocking.length) {
      console.log('BLOCKING:');
      for (const [id, c] of verdict.blocking) console.log(`  ⛔ ${id} — ${c.why}`);
    }
    if (record.controls.failed.length) console.log(`RED CONTROLS FAILED on ${record.controls.failed.length} channel(s): ${record.controls.failed.join(', ')} — their verdicts carry no information.`);
    if (verdict.undetermined.length) console.log(`UNDETERMINED on ${verdict.undetermined.length} channel(s) — NOT a pass: ${verdict.undetermined.map(([id]) => id).join(', ')}`);
    console.log('');
  }

  if (EXECUTE) {
    console.log(w.written ? `wrote ${w.rel}` : `✗ ${w.why}`);
    if (!w.written) process.exit(2);
  }
  process.exit(verdict.exit);
}
