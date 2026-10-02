#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify_export_csv.mjs — THE EXPORT LEG'S FILE, read off the runner's disk
// (train st-e2e-parity, run by .github/workflows/e2e.yml after the drive).
//
// The web suite taps Settings → Export (CSV); the app hands the file to the
// browser, and headless Chrome saves it to the download directory. A widget
// that SAID "exported" proves nothing about the file, so this reads the newest
// `subscriptions*.csv` there and holds it to what the suite printed when it
// tapped: `NK_E2E step=export rows=<n> name=<row> price=<p>` — the number of
// rows the live Worker held, and one row (the edited one) by name and price.
//
//   node tooling/e2e/verify_export_csv.mjs <drive.log> [downloadDir]
//
// Exit 0 = the file holds the rows · 1 = it does not, or no file arrived ·
// 2 = the drive printed no export line (the leg did not run).
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** PURE. The export line's facts, or null. */
export function exportClaim(log) {
  const m = /NK_E2E step=export rows=(\d+) name=(.+?) price=(\S+)\s*$/m.exec(String(log ?? ''));
  return m ? { rows: Number(m[1]), name: m[2], price: m[3] } : null;
}

/** PURE. The data rows of a CSV body (BOM and header dropped, blank lines ignored). */
export function csvDataRows(body) {
  const lines = String(body ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.slice(1);
}

/** PURE. The problems with [body] against [claim]. */
export function gradeExport(body, claim) {
  const rows = csvDataRows(body);
  const problems = [];
  if (rows.length !== claim.rows) problems.push(`the file holds ${rows.length} row(s); the server held ${claim.rows} when Export was tapped`);
  const row = rows.find((r) => r.includes(claim.name));
  if (!row) problems.push(`no row names "${claim.name}"`);
  else if (!row.includes(claim.price)) problems.push(`the row "${claim.name}" does not carry the edited price ${claim.price}: ${row}`);
  return problems;
}

/** The newest subscriptions*.csv in [dir], or null. */
export function newestExport(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const files = names
    .filter((f) => /^subscriptions.*\.csv$/.test(f))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? join(dir, files[0].f) : null;
}

function main(argv) {
  const [logPath, dirArg] = argv;
  let log = null;
  try {
    if (logPath) log = readFileSync(logPath, 'utf8');
  } catch {
    log = null;
  }
  if (log === null) {
    console.error(`verify_export_csv: no drive log at ${logPath ?? '(none given)'}`);
    return 2;
  }
  const claim = exportClaim(log);
  if (!claim) {
    console.error('verify_export_csv: the drive printed no `NK_E2E step=export` line — the export leg did not run');
    return 2;
  }
  const dir = resolve(dirArg ?? join(homedir(), 'Downloads'));
  const file = newestExport(dir);
  if (!file) {
    console.error(`FAIL no subscriptions*.csv was downloaded into ${dir} — the Export tap produced no file`);
    return 1;
  }
  const problems = gradeExport(readFileSync(file, 'utf8'), claim);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    return 1;
  }
  console.log(`ok  verify_export_csv: ${file} holds the ${claim.rows} row(s) the server held, "${claim.name}" at ${claim.price}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
