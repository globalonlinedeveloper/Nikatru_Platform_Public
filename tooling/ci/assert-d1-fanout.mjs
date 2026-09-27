#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-d1-fanout.mjs — every D1 database a Worker owns is backed up, and every
// app database is fanned out to and bound by the platform Worker.
//
// ⏱ ADDED 2026-09-26 · row O-BACKUP-AND-FANOUT-SETS-HAND-LISTED (service kit E-c):
// "A guard compares every D1 declared in services/*/wrangler.jsonc with the backup
// list and the fan-out list, and fails on a database that is in neither."
//
// 🔴 THE FAILURE. The nightly export (services/platform/src/backup/index.ts) and the
// renewals fan-out (services/platform/src/scheduled.ts `appTargets`) each carried a
// hand list naming app #1's database. App #2's Worker would own a database the
// platform never backed up and never renewed, and nothing anywhere went red. Both
// lists now come from services/platform/src/generated/app-targets.ts, which
// tooling/scripts/render-platform-app-block.mjs renders from the register (its own
// `--check` holds the module to the register). THIS guard holds the other end: the
// set of databases that EXIST, read off the Worker configs, against what the platform
// Worker actually backs up, fans out to and binds.
//
// THE DATABASES are every D1 a live wrangler config OWNS (declares with
// `migrations_dir`), from tooling/ci/d1-stores.mjs `ownedD1Stores` — the one D1
// walk, shared with assert-retention-coverage.mjs and provision-backend --check.
// A database bound elsewhere for a fan-out is the same store, not a second one.
//
// THE THREE LISTS, each read from the code that USES it (comments stripped):
//   backup   the `name: '<db>'` literals in backup/index.ts's `databases` array, plus
//            every APP_TARGETS `databaseName` when that array spreads `APP_TARGETS`;
//   fan-out  every APP_TARGETS `databaseName`, when scheduled.ts `appTargets` maps
//            `APP_TARGETS`;
//   binding  every `database_name` in services/platform/wrangler.jsonc `d1_databases`.
// A database the SERVING Worker owns (platform_db) must be backed up and bound; the
// fan-out is per app. Every other owned database must be in all three.
//
// Exit 0 = every owned database is where it must be (each printed, with its lists).
// Exit 1 = a database is missing from a list it must be in (named, with the list).
// Exit 2 = COVERAGE LOST: no owned database at all, or a list could not be read.
// Usage:  node tooling/ci/assert-d1-fanout.mjs [--root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedD1Stores, parseJsonc } from './d1-stores.mjs';
import { stripSourceComments } from './text-reductions.mjs';

export const PLATFORM_DIR = 'services/platform';
export const BACKUP_REL = `${PLATFORM_DIR}/src/backup/index.ts`;
export const SCHEDULED_REL = `${PLATFORM_DIR}/src/scheduled.ts`;
export const MODULE_REL = `${PLATFORM_DIR}/src/generated/app-targets.ts`;
export const CONFIG_REL = `${PLATFORM_DIR}/wrangler.jsonc`;

class Lost extends Error {}

const read = (root, rel) => {
  if (!existsSync(join(root, rel))) throw new Lost(`${rel} does not exist, so the list it holds cannot be read.`);
  return readFileSync(join(root, rel), 'utf8');
};

/** The three lists and the owned databases for the tree at `root`. Throws Lost. */
export function readLists(root) {
  const lostLines = [];
  const stores = ownedD1Stores(root, (lines) => lostLines.push(...lines));
  if (lostLines.length) throw new Lost(lostLines.join(' '));

  const moduleSrc = stripSourceComments(read(root, MODULE_REL), '.ts');
  const targets = [...moduleSrc.matchAll(/\{\s*appId:\s*'([^']+)',\s*dbBinding:\s*'([^']+)',\s*databaseName:\s*'([^']+)'\s*\}/g)].map((m) => ({
    appId: m[1],
    dbBinding: m[2],
    databaseName: m[3],
  }));
  if (!/export const APP_TARGETS\b/.test(moduleSrc)) throw new Lost(`${MODULE_REL} declares no APP_TARGETS.`);

  const backupSrc = stripSourceComments(read(root, BACKUP_REL), '.ts');
  const dbArray = backupSrc.match(/const databases\s*:[^=]*=\s*\[([\s\S]*?)\];/);
  if (!dbArray) throw new Lost(`${BACKUP_REL} has no \`const databases … = [ … ];\` list, so what the export backs up cannot be read.`);
  const backup = new Set([...dbArray[1].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]));
  if (/\.\.\.\s*APP_TARGETS\.map\(/.test(dbArray[1])) for (const t of targets) backup.add(t.databaseName);

  const scheduledSrc = stripSourceComments(read(root, SCHEDULED_REL), '.ts');
  const fn = scheduledSrc.match(/export function appTargets\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  if (!fn) throw new Lost(`${SCHEDULED_REL} has no \`export function appTargets(…)\`, so the fan-out cannot be read.`);
  const fanout = new Set(/APP_TARGETS\.map\(/.test(fn[1]) ? targets.map((t) => t.databaseName) : []);

  let cfg;
  try {
    cfg = parseJsonc(read(root, CONFIG_REL));
  } catch (e) {
    if (e instanceof Lost) throw e;
    throw new Lost(`${CONFIG_REL} does not parse (${e.message}).`);
  }
  const bound = new Set((cfg.d1_databases ?? []).map((d) => d?.database_name).filter(Boolean));

  return { owned: stores.owned, backup, fanout, bound };
}

/** Pure: the findings, and one line per database. */
export function judge({ owned, backup, fanout, bound }) {
  const problems = [];
  const lines = [];
  for (const o of owned) {
    const serving = o.config === CONFIG_REL;
    const need = serving ? ['backup', 'binding'] : ['backup', 'fan-out', 'binding'];
    const has = { backup: backup.has(o.databaseName), 'fan-out': fanout.has(o.databaseName), binding: bound.has(o.databaseName) };
    const missing = need.filter((k) => !has[k]);
    const inNone = need.every((k) => !has[k]);
    if (missing.length) {
      problems.push(
        `${o.databaseName} (owned by ${o.config}) is ${inNone ? 'in NONE of' : 'missing from'} ${missing
          .map((k) => ({ backup: `the nightly backup (${BACKUP_REL})`, 'fan-out': `the renewals fan-out (${SCHEDULED_REL})`, binding: `the platform Worker's d1_databases (${CONFIG_REL})` })[k])
          .join(', ')}. ${serving ? '' : 'Its Worker needs an appWorkers row in tooling/platform-register.json; then run node tooling/scripts/render-platform-app-block.mjs. '}` +
          'A database no list names is never backed up and, for an app, never renewed, and nothing else goes red.',
      );
    } else {
      lines.push(`${o.databaseName} (${o.config}): ${need.join(', ')}`);
    }
  }
  return { problems, lines };
}

function main(argv) {
  const r = argv.indexOf('--root');
  const root = resolve(r !== -1 ? argv[r + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let lists;
  try {
    lists = readLists(root);
  } catch (e) {
    if (!(e instanceof Lost)) throw e;
    return coverageLost([`✗ COVERAGE LOST — ${e.message}`]);
  }
  if (lists.owned.length === 0) {
    return coverageLost([
      '✗ COVERAGE LOST — no live wrangler config owns a D1 database (declares `migrations_dir`), so there is nothing to',
      '  compare with the backup and fan-out lists, and a guard over nothing prints ok.',
    ]);
  }
  const { problems, lines } = judge(lists);
  if (problems.length) {
    console.error(`✗ ${problems.length} owned D1 database(s) are not where they must be:\n`);
    for (const p of problems) console.error(`  · ${p}\n`);
    return 1;
  }
  console.log(`ok  d1 fan-out — ${lists.owned.length} owned D1 database(s), each backed up nightly, bound by the platform Worker and, for an app, fanned out to:`);
  for (const l of lines) console.log(`      ${l}`);
  return 0;
}

/** The one COVERAGE LOST stop: it prints why and answers 2, which main() exits with —
 *  never 1, which would read as a finding (AGENTS.md exit-code convention). */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exitCode = 2;
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
