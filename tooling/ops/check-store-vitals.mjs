#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-store-vitals.mjs — CRASH AND ANR RATES, READ FROM THE STORES THEMSELVES
// AND GRADED AGAINST THE LEAD'S THRESHOLDS (crash-rates; O-STORE-VITALS-UNREAD;
// gate R11-05).
//
//   node tooling/ops/check-store-vitals.mjs [--state <file>] [--read-pending-until YYYY-MM-DD]
//   node tooling/ops/check-store-vitals.mjs --explain crash|anr
//
// For EVERY app (apps/*/app.yaml) and EVERY app channel of
// tooling/channel-register.json — a new app or channel needs no code — it reads
// the store-aggregated rates (tooling/ops/vitals/readers.mjs, one adapter per
// store) and prints, per app and channel: the rate, the threshold, the grade
// (tooling/ops/vitals/grade.mjs against tooling/ops/vitals/thresholds.json). A
// channel with no source says so; nothing is silently missing. No data is GREY,
// never green; a missing credential is `unreadable` with its secret's NAME,
// never red and never green.
//
// THE REGRESSION ALERT: with --state <file>, the last KNOWN grade per channel and
// metric is kept there, and a grade that WORSENED since prints `PAGE:` and exits 1
// — the scheduler's existing owner-page path (a laptop duty's non-zero exit fails
// its GlitchTip heartbeat, which pages). Two identical runs exit 0 twice: a red
// that stays red pages once, when it became red.
//
// Exit 0 nothing worsened · 1 a grade worsened, the thresholds register is
// incomplete, or a store answered in a shape its docs do not describe · 2
// COVERAGE LOST: nothing at all could be read, past --read-pending-until (until
// then the Play Reporting API's enablement is a lead step, and that is printed).
//
// The credentials are the ones the store lanes already use, BY NAME:
// PLAY_SERVICE_ACCOUNT_JSON and APP_STORE_CONNECT_{ISSUER_ID,KEY_ID,PRIVATE_KEY}.
// Plain Node, `node:path` only, no shell helper: it runs the same on Windows.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../app-yaml/yaml.mjs';
import { ORG } from '../kit/stamp-native.mjs';
import { MAX_VITALS_REQUESTS, VitalsShapeError, readChannel } from './vitals/readers.mjs';
import { gradeReading, nextState, worsened } from './vitals/grade.mjs';

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_REL = 'tooling/ops/vitals/thresholds.json';
const GRADED = ['crash', 'anr'];
const ICON = { green: '✅', amber: '🟨', red: '🔴', 'no-data': '⬜', unreadable: '❔', 'no-source': '➖', 'no-threshold': '◽' };

/** The thresholds register, or the reason it cannot grade. */
export function loadRegister(root) {
  const p = path.join(root, ...REGISTER_REL.split('/'));
  if (!existsSync(p)) return { error: `${REGISTER_REL} is missing` };
  let reg;
  try {
    reg = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return { error: `${REGISTER_REL} is not JSON (${e.message})` };
  }
  for (const m of GRADED) {
    const row = reg.metrics?.[m];
    if (!row) return { error: `${REGISTER_REL} has no row for \`${m}\`: a rate with no threshold is not a passing one` };
    for (const k of ['value', 'asOf', 'verify', 'source']) if (row[k] === undefined) return { error: `${REGISTER_REL} row \`${m}\` has no \`${k}\`` };
  }
  return { reg };
}

/** Every app with its store identities, from apps/*\/app.yaml. */
export function loadApps(root) {
  const dir = path.join(root, 'apps');
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'probe') continue;
    const yml = path.join(dir, e.name, 'app.yaml');
    if (!existsSync(yml)) continue;
    const y = parseYaml(readFileSync(yml, 'utf8'));
    out.push({ id: y.id, androidPackage: `${ORG}.${y.id}`, ascAppId: y.stores?.['ios-appstore']?.recordId ?? null });
  }
  return out;
}

/** Every channel an app ships through (the register's `surface: app` rows). */
export function loadChannels(root) {
  const reg = JSON.parse(readFileSync(path.join(root, 'tooling', 'channel-register.json'), 'utf8'));
  return reg.channels.filter((c) => c.surface === 'app').map((c) => c.id);
}

const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(2)}%`);

export async function main(argv, { root = DEFAULT_ROOT, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), log = (s) => console.log(s), error = (s) => console.error(s) } = {}) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const loaded = loadRegister(root);
  if (loaded.error) {
    error(`✗ store vitals — ${loaded.error}`);
    return 1;
  }
  const reg = loaded.reg;
  const explain = arg('--explain');
  if (explain) {
    const row = reg.metrics[explain];
    if (!row) {
      error(`✗ no row \`${explain}\``);
      return 1;
    }
    log(`${explain}: ${row.label} — limit ${pct(row.value)} (${row.redWhen}), amber from ${pct(row.value * reg.amberFraction)}; Play's own: ${pct(row.play?.value ?? null)} (${row.play?.source ?? '-'}); ${row.source}; asOf ${row.asOf}`);
    return 0;
  }

  const apps = loadApps(root);
  const channels = loadChannels(root);
  if (apps.length === 0 || channels.length === 0) {
    error('✗ COVERAGE LOST — no app or no app channel was found to read');
    return 2;
  }
  const budget = { left: MAX_VITALS_REQUESTS };
  const grades = {};
  let readAnything = false;
  for (const app of apps) {
    for (const channel of channels) {
      let readings;
      try {
        readings = await readChannel(channel, { app: { ...app, budget }, env, fetchImpl, now });
      } catch (e) {
        if (e instanceof VitalsShapeError) {
          error(`✗ store vitals — ${app.id} ${channel}: ${e.message}. A body the docs do not describe is never read as a zero.`);
          return 1;
        }
        throw e;
      }
      for (const r of readings) {
        let grade;
        try {
          grade = gradeReading(r, reg);
        } catch (e) {
          error(`✗ store vitals — ${e.message}`);
          return 1;
        }
        if (r.status === 'ok' || r.status === 'no-data') readAnything = true;
        grades[`${app.id}|${channel}|${r.metric}`] = grade;
        const row = reg.metrics[r.metric];
        const rate = r.unit === 'fraction' ? pct(r.value) : r.value === null ? '-' : `${r.value} ${r.unit}`;
        log(`${ICON[grade] ?? '?'} ${app.id} · ${channel} · ${r.metric} · rate ${rate} · threshold ${row ? pct(row.value) : '-'} · ${grade}${r.period ? ` · ${r.period}` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
      }
    }
  }

  const statePath = arg('--state');
  let exit = 0;
  if (statePath) {
    let prev = {};
    if (existsSync(statePath)) {
      try {
        prev = JSON.parse(readFileSync(statePath, 'utf8')).grades ?? {};
      } catch {
        prev = {};
      }
    }
    const worse = worsened(prev, grades);
    for (const w of worse) log(`PAGE: ${w.key.split('|').join(' · ')} worsened ${w.from} → ${w.to}`);
    writeFileSync(statePath, `${JSON.stringify({ asOf: new Date(now()).toISOString(), grades: nextState(prev, grades) }, null, 2)}\n`);
    if (worse.length) exit = 1;
  }

  if (!readAnything) {
    const until = arg('--read-pending-until');
    const today = new Date(now()).toISOString().slice(0, 10);
    if (until && today <= until) {
      log(`⬜ nothing was read on any store; deferred until ${until} (the Play Reporting API enablement and the scheduled run are lead steps).`);
    } else {
      error('✗ COVERAGE LOST — no store answered for any app: an unread rate is not a passing one.');
      return 2;
    }
  }
  return exit;
}

/** `node c:\…\check-store-vitals.mjs` in any case is this module on Windows. */
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
