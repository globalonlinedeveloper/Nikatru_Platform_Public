#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-a11y-statement.mjs — the published accessibility statement lists
// EXACTLY the gaps the exceptions register holds (lane a11y-statement, Do 1;
// rows O-A11Y-STATEMENT-UNPUBLISHED, O-WEB-A11Y-SCAN-MISSING).
//
//   node tooling/ci/assert-a11y-statement.mjs [--root <dir>]
//
// SUBJECTS: tooling/a11y/exceptions.json (what tooling/a11y/scan.mjs tolerates)
// and sites/nikatru/accessibility.html (what nikatru.com/accessibility says).
//   AS-1  every register id appears on the page as `data-exception="<id>"`: a
//         gap the scan tolerates is a gap the public is told about.
//   AS-2  every `data-exception` id on the page is a register row: the page
//         never publishes a gap (or keeps one) the evidence no longer holds.
//   AS-3  each id appears once on the page.
// The page is generated (tooling/sites/gen-accessibility-statement.mjs, in
// tooling/sites/regen.mjs ORDER), so `regen --check` already catches a hand
// edit; this guard is the semantic claim, and it holds when the generator
// itself is changed to drop or invent a row.
//
// Exit 0 clean · 1 a finding · 2 COVERAGE LOST (either file missing or
// unreadable, or the register has no rows to compare — zero is not evidence).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTER = 'tooling/a11y/exceptions.json';
export const PAGE = 'sites/nikatru/accessibility.html';

/** The `data-exception` ids on the page, in order, duplicates kept. */
export const pageIds = (html) => [...html.matchAll(/\bdata-exception\s*=\s*"([^"]*)"/g)].map((m) => m[1]);

/** { code, lines } for a register document and a page's HTML. */
export function compare(doc, html) {
  const rows = Array.isArray(doc?.exceptions) ? doc.exceptions.map((r) => r?.id) : null;
  if (!rows || rows.length === 0) return { code: 2, lines: [`assert-a11y-statement: COVERAGE LOST — ${REGISTER} has no exception rows to compare`] };
  const onPage = pageIds(html);
  const out = [];
  const pageSet = new Set(onPage);
  const regSet = new Set(rows);
  for (const id of rows) if (!pageSet.has(id)) out.push(`AS-1 ${id} is in ${REGISTER} but not published on ${PAGE}`);
  for (const id of pageSet) if (!regSet.has(id)) out.push(`AS-2 ${PAGE} publishes ${id}, which ${REGISTER} does not hold`);
  for (const id of pageSet) if (onPage.filter((x) => x === id).length > 1) out.push(`AS-3 ${PAGE} lists ${id} more than once`);
  if (out.length) return { code: 1, lines: [...out, `assert-a11y-statement: ${out.length} finding(s) — run node tooling/sites/gen-accessibility-statement.mjs`] };
  return { code: 0, lines: [`assert-a11y-statement: ok — ${rows.length} register row(s), each published once on ${PAGE}, and nothing else`] };
}

export function run(root) {
  let doc;
  let html;
  try {
    doc = JSON.parse(readFileSync(path.join(root, REGISTER), 'utf8'));
  } catch (e) {
    return { code: 2, lines: [`assert-a11y-statement: COVERAGE LOST — ${REGISTER} could not be read (${e.code ?? e.message})`] };
  }
  try {
    html = readFileSync(path.join(root, PAGE), 'utf8');
  } catch (e) {
    return { code: 2, lines: [`assert-a11y-statement: COVERAGE LOST — ${PAGE} could not be read (${e.code ?? e.message})`] };
  }
  return compare(doc, html);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const root = a.includes('--root') ? path.resolve(a[a.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = run(root);
  for (const l of r.lines) console.log(l);
  process.exit(r.code);
}
