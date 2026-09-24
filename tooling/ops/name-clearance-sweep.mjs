#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// name-clearance-sweep.mjs — RE-VERIFY EVERY DECLARED APP'S NAME, and file an
// owner item when a verdict FLIPS.
//
// 🔴 A CLEARANCE IS A MEASUREMENT WITH A DATE. Names get taken — by somebody
// else, on a store nobody here watches, on a Tuesday. A record written once and
// never re-derived is the undated-proof shape this corpus keeps deleting, and
// the whole reason `assert-name-clearance.mjs` carries a 30-day ceiling is that
// something has to re-derive it before that ceiling closes. This is that
// something.
//
// It re-runs `tooling/store/name-clearance.mjs`'s `clear()` for every app in
// `catalog/apps.json`, rewrites each record, and REPORTS THE FLIP — the previous
// `overall` beside the new one — because a sweep that quietly overwrites a CLEAR
// with a BLOCKED has destroyed the only signal anybody would have read.
//
// ── IT FILES, IT DOES NOT BLOCK ──────────────────────────────────────────────
// The blocking is `assert-name-clearance.mjs`'s job, in CI and in the hook, over
// the record this writes. This is the slow networked half: ~16.5 s per app over
// ~20 external calls, which is why it is a routine and never a gate.
//
// ── IT REFUSES TO MAKE THINGS WORSE ──────────────────────────────────────────
// `writeRecord` refuses to overwrite an existing record when a red control
// failed on this run: a stale-but-real clearance beats a fresh record full of
// "I could not check". So an offline or rate-limited sweep exits 2 COVERAGE LOST
// with every record untouched, which is the correct outcome and not a fault to
// be worked around.
//
// EXIT CODES:  0 = every record re-derived and no verdict flipped
//              1 = a verdict FLIPPED — an owner item is owed, printed below
//              2 = COVERAGE LOST — the register/catalogue was unreadable, or a
//                  red control failed and nothing was rewritten
//
// USAGE:  node tooling/ops/name-clearance-sweep.mjs [--repo <path>] [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clear, writeRecord, makeHttp, CoverageLost, RECORD_REL, CATALOG_REL } from '../store/name-clearance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * One app's probe, settled against its record: write (or, dry, only merge) it,
 * and compare the previous `overall` with the one the MERGED record carries.
 *
 * 🔴 The comparison is against `writeRecord`'s `overall`, never `rollUp(record)`.
 * The probe cannot produce a ruling, so its own roll-up of a PROCEED record is
 * QUALIFIED while the rewritten file says CLEAR — a flip reported every week
 * that never happened, and a record whose line here disagrees with its file.
 */
export function settle({ root, app, name, previous, record, dryRun = false }) {
  const failed = record.controls.failed.length
    ? `   [${record.controls.failed.length} red control(s) FAILED: ${record.controls.failed.join(', ')}]`
    : '';
  const was = previous ?? '(no previous record)';
  const w = writeRecord(root, record, { dryRun });
  if (w.refused) {
    return { line: `${app} — "${name}" — ${was} → NOT REWRITTEN${failed}`, overall: previous, flip: null, lost: `${app} — ${w.why}` };
  }
  const flip =
    previous !== null && previous !== w.overall
      ? `${app} — the clearance for "${name}" moved ${previous} → ${w.overall}. FILE AN OWNER ITEM: a name that ` +
        'was cleared and is not any more is a decision, not a build detail, and the record alone will not raise it.'
      : null;
  return { line: `${app} — "${name}" — ${was} → ${w.overall}${failed}`, overall: w.overall, flip, lost: null };
}

/** The top-level `name:` of an app declaration, anchored at column zero for the
 *  reason `assert-name-clearance.mjs` records: `name:` is a plausible key under
 *  several nested blocks and the first match is silently the wrong one. */
const declaredName = (text) => {
  const m = text.match(/^name:[ \t]*(\S.*?)[ \t]*$/m);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : null;
};

const lose = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

async function main() {
  const argv = process.argv.slice(2);
  const flagValue = (n, d) => {
    const i = argv.indexOf(n);
    return i === -1 ? d : argv[i + 1];
  };
  const ROOT = resolve(flagValue('--repo', resolve(HERE, '..', '..')));
  const DRY_RUN = argv.includes('--dry-run');

  const catalogAbs = join(ROOT, CATALOG_REL);
  if (!existsSync(catalogAbs)) {
    lose([`${CATALOG_REL} is absent at ${catalogAbs}.`, 'The set of apps to re-verify is unknown, so a sweep over it would sweep nothing and report success.']);
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogAbs, 'utf8'));
  } catch (e) {
    lose([`${CATALOG_REL} did not parse (${e.message}).`]);
  }
  if (!Array.isArray(catalog) || catalog.length === 0) {
    lose([`${CATALOG_REL} declares no apps.`, 'A sweep over an empty set is the vacuous green this routine exists to avoid.']);
  }

  const http = makeHttp();
  const flips = [];
  const lost = [];
  let swept = 0;

  for (const row of catalog) {
    const app = row.slug;
    const yamlAbs = join(ROOT, `apps/${app}/app.yaml`);
    if (!existsSync(yamlAbs)) {
      lose([`apps/${app}/app.yaml is absent.`, `${CATALOG_REL} declares this app and there is no declaration to read its name from, so nothing could be re-verified for it.`]);
    }
    const name = declaredName(readFileSync(yamlAbs, 'utf8'));
    if (!name) lose([`apps/${app}/app.yaml declares no top-level \`name:\`.`, 'There is nothing to clear.']);

    const recordAbs = join(ROOT, RECORD_REL(app));
    let previous = null;
    if (existsSync(recordAbs)) {
      try {
        previous = JSON.parse(readFileSync(recordAbs, 'utf8')).overall ?? null;
      } catch {
        previous = null;
      }
    }

    let record;
    try {
      record = await clear({ root: ROOT, name, app, http });
    } catch (e) {
      if (e instanceof CoverageLost) lose(e.lines);
      throw e;
    }
    swept += 1;
    const s = settle({ root: ROOT, app, name, previous, record, dryRun: DRY_RUN });
    console.log(s.line);
    if (DRY_RUN) continue;
    if (s.lost) lost.push(s.lost);
    if (s.flip) flips.push(s.flip);
  }

  if (lost.length) {
    console.error(`✗ COVERAGE LOST — ${lost.length} record(s) were NOT rewritten:`);
    for (const l of lost) console.error(`    ${l}`);
    console.error('  Nothing was made worse: the existing records still stand. Re-run when the endpoints answer.');
    process.exit(2);
  }
  if (flips.length) {
    console.error(`✗ ${flips.length} clearance verdict(s) FLIPPED:`);
    for (const f of flips) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`✔ ${swept} app(s) re-verified${DRY_RUN ? ' (dry run — nothing written)' : ''}, no verdict flipped.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
