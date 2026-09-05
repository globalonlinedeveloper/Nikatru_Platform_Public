/* gen-catalog.mjs — rewrite the README catalog table from tool.json files.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/gen-catalog.mjs            rewrite README.md in place
     node scripts/gen-catalog.mjs --check    fail if it is out of date (CI)
     node scripts/gen-catalog.mjs --print    print the table, touch nothing

   The catalog table is the first thing anyone sees, and it is the thing that
   goes stale first: a tool ships, a listing goes live, a status changes, and
   the table still says what was true in July. Generating it from tool.json
   means the table cannot disagree with the tools — because it is not a second
   place where the facts are written.

   IT WRITES BETWEEN MARKERS, AND REFUSES WITHOUT THEM

       <!-- CATALOG:START -->
       ...generated...
       <!-- CATALOG:END -->

   No markers, no write. A generator that guesses where its output belongs
   eventually eats a paragraph somebody wrote by hand, and the diff that does it
   looks exactly like the diff that does not.

   IT REFUSES TO REPLACE A FULL TABLE WITH AN EMPTY ONE

   Zero tools produces an empty table, which is indistinguishable from a broken
   glob — and this repo has already had a search silently miss an entire tree.
   So an empty result over a non-empty table stops and says so; --allow-empty is
   the way to mean it.

   IT NEVER INVENTS A URL. A store link comes from tool.json "listings", and a
   null listing renders as plain text. Nothing here composes a plausible store
   URL for a listing that does not exist yet.

   Exit codes: 0 written / already correct · 1 --check found it stale ·
   2 could not run (no markers, or an empty result it will not write). */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, loadAllTools, readText } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['check', 'print', 'allow-empty', 'file', 'repo-root']);
const root = repoRoot(args);

const START = '<!-- CATALOG:START -->';
const END = '<!-- CATALOG:END -->';

const { tools, errors, warnings } = loadAllTools(root);
if (errors.length) {
  console.error('CANNOT GENERATE THE CATALOG — ' + errors.length + ' tool.json problem(s):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(EXIT_FAIL);
}
for (const w of warnings) console.log('WARN  ' + w);

/* ---------------- the table ---------------- */
const STATUS_TEXT = {
  idea: 'Idea',
  wip: 'In progress',
  shipping: 'Built',
  archived: 'Archived'
};

function statusCell(t) {
  const live = Object.entries(t.listings || {})
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([store, url]) => '[' + store.charAt(0).toUpperCase() + store.slice(1) + '](' + url + ')');
  const base = STATUS_TEXT[t.status] || t.status || 'unknown';
  if (live.length) return base + ' · ' + live.join(' · ');
  if (t.status === 'shipping') return base + ' · not yet listed';
  return base;
}

function escapeCell(s) {
  /* A pipe inside a cell silently ends the column. */
  return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function buildTable(list) {
  const rows = list
    .slice()
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map(t => '| [' + escapeCell(t.name) + '](' + t.rel + ') | ' + escapeCell(t.summary) + ' | ' + escapeCell(statusCell(t)) + ' |');
  return [
    '| Extension | What it does | Status |',
    '|---|---|---|',
    ...rows
  ].join('\n');
}

const table = buildTable(tools);

if (args.bool('print')) {
  console.log(table);
  process.exit(0);
}

/* ---------------- splice ---------------- */
const fileRel = typeof args.get('file') === 'string' ? args.get('file') : 'README.md';
const fileAbs = path.join(root, fileRel);
if (!fs.existsSync(fileAbs)) die(fileRel + ' does not exist (looked in ' + root + ').');

const before = readText(fileAbs);
const iStart = before.indexOf(START);
const iEnd = before.indexOf(END);

if (iStart === -1 || iEnd === -1 || iEnd < iStart) {
  die(fileRel + ' has no catalog markers, so there is nowhere to write.\n\n' +
    'This script will not guess where its output belongs — a generator that guesses eventually eats a\n' +
    'paragraph somebody wrote by hand, and the diff that does it looks exactly like the diff that does not.\n\n' +
    'Put these two lines around the existing table in ' + fileRel + ':\n\n' +
    '  ' + START + '\n' +
    table.split('\n').map(l => '  ' + l).join('\n') + '\n' +
    '  ' + END + '\n');
}

const head = before.slice(0, iStart + START.length);
const tail = before.slice(iEnd);
const existing = before.slice(iStart + START.length, iEnd).trim();

if (tools.length === 0 && existing && !args.bool('allow-empty')) {
  die('there are no tool.json files, so the generated table is empty — and ' + fileRel + ' currently\n' +
    'holds a table with content. Overwriting it would silently delete the catalog.\n\n' +
    'An empty result is indistinguishable from a broken search, and a search in this repo has silently\n' +
    'missed an entire tree before. If the catalog really should be empty, pass --allow-empty.');
}

const after = head + '\n' + table + '\n' + tail;

const r = new Report('gen-catalog · ' + fileRel);

if (after === before) {
  r.pass(fileRel + ' catalog is up to date', tools.length + ' tool(s)');
  process.exit(r.finish());
}

if (args.bool('check')) {
  r.fail(fileRel + ' catalog is out of date',
    'The table between the CATALOG markers does not match the tool.json files on disk.\n' +
    'Run:  node scripts/gen-catalog.mjs\n\n' +
    'expected:\n' + table.split('\n').map(l => '  ' + l).join('\n') + '\n\n' +
    'found:\n' + (existing ? existing.split('\n').map(l => '  ' + l).join('\n') : '  (empty)'));
  process.exit(r.finish());
}

fs.writeFileSync(fileAbs, after, 'utf8');
r.pass('rewrote the catalog in ' + fileRel, tools.length + ' tool(s): ' + (tools.map(t => t.id).join(', ') || 'none'));
process.exit(r.finish());
