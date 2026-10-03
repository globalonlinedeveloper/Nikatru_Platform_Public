#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-known-issues.mjs — a known issue is PUBLIC, so it carries no personal
// data (lane feedback-triage, Do 6; docs/ops/feedback-triage.md §Known issues).
//
//   node tooling/ci/assert-known-issues.mjs [--root <dir>]
//
// SUBJECT: every `content/known-issues/<slug>.md` (README.md aside). The triage
// routine PROPOSES these from reports; the lead opens them as normal PRs; lane
// help-search renders them into the help centre. Nothing between a report and
// a published page reads the text for personal data, so this does:
//
//   KI-1  front matter: `title`, `apps` (a list), `versions`, `status` (open |
//         fixed), `updated` (YYYY-MM-DD), and `fixedIn` exactly when fixed.
//   KI-2  no e-mail address anywhere in the file.
//   KI-3  no report id (`FB-` + 10): a public page never points at a report.
//   KI-4  no report text: no blockquote line and no fenced block — the two
//         shapes a quotation takes (the routine's prompt quotes report text
//         only inside a fenced data block, which is exactly what may never be
//         pasted here) — and no phone-number-like or card-like run of digits.
//   KI-5  no link except to nikatru.com: a report's links are never repeated.
//
// Exit 0 clean · 1 a finding · 2 COVERAGE LOST (the directory is missing, or a
// file could not be read). Zero files is a valid, printed answer: the help
// centre then says "No known issues".
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

export const DIR = 'content/known-issues';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const REPORT_ID = /\bFB-[0-9A-Z]{10}\b/;
const DIGIT_RUN = /(?:\d[ -]?){10,}/;
const LINK = /https?:\/\/[^\s)>\]"']+/g;
const ALLOWED_LINK = /^https:\/\/(?:[a-z0-9-]+\.)?nikatru\.com(?:[/?#]|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['open', 'fixed']);

/** `--- … ---` front matter as a flat map; lists are `[a, b]`. Null when absent. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    fm[kv[1]] = v;
  }
  return { fm, body: text.slice(m[0].length) };
}

/** Every finding for one file's text. */
export function checkKnownIssue(name, text) {
  const out = [];
  const parsed = frontMatter(text);
  if (!parsed) return [`${name}: KI-1 no front matter (--- title/apps/versions/status/updated ---)`];
  const { fm, body } = parsed;
  if (typeof fm.title !== 'string' || fm.title === '') out.push(`${name}: KI-1 no title`);
  if (!Array.isArray(fm.apps) || fm.apps.length === 0) out.push(`${name}: KI-1 apps must be a non-empty list`);
  if (typeof fm.versions !== 'string' || fm.versions === '') out.push(`${name}: KI-1 no versions`);
  if (!STATUSES.has(fm.status)) out.push(`${name}: KI-1 status must be open or fixed`);
  if (typeof fm.updated !== 'string' || !DATE.test(fm.updated)) out.push(`${name}: KI-1 updated must be YYYY-MM-DD`);
  if ((fm.status === 'fixed') !== (typeof fm.fixedIn === 'string' && fm.fixedIn !== '')) out.push(`${name}: KI-1 fixedIn is required exactly when status is fixed`);
  if (body.trim() === '') out.push(`${name}: KI-1 no body (the workaround)`);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${name}:${i + 1}`;
    if (EMAIL.test(line)) out.push(`${at}: KI-2 an e-mail address`);
    if (REPORT_ID.test(line)) out.push(`${at}: KI-3 a report id`);
    if (/^\s*>/.test(line)) out.push(`${at}: KI-4 a blockquote (report text is never quoted here)`);
    if (/^\s*(```|~~~)/.test(line)) out.push(`${at}: KI-4 a fenced block (report text is never quoted here)`);
    if (DIGIT_RUN.test(line.replace(/\d{4}-\d{2}-\d{2}/g, ''))) out.push(`${at}: KI-4 a phone- or card-like run of digits`);
    for (const url of line.match(LINK) ?? []) if (!ALLOWED_LINK.test(url)) out.push(`${at}: KI-5 a link off nikatru.com`);
  });
  return out;
}

export function run(root) {
  const dir = path.join(root, DIR);
  if (!existsSync(dir)) return { code: 2, lines: [`assert-known-issues: COVERAGE LOST — ${DIR}/ does not exist`] };
  const files = listDir(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const findings = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(path.join(dir, f), 'utf8');
    } catch {
      return { code: 2, lines: [`assert-known-issues: COVERAGE LOST — ${DIR}/${f} could not be read`] };
    }
    findings.push(...checkKnownIssue(`${DIR}/${f}`, text));
  }
  if (findings.length) return { code: 1, lines: [...findings, `assert-known-issues: ${findings.length} finding(s) in ${files.length} file(s)`] };
  return { code: 0, lines: [`assert-known-issues: ok — ${files.length} known issue(s) checked, none carries personal data or report text`] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const root = a.includes('--root') ? path.resolve(a[a.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = run(root);
  for (const l of r.lines) console.log(l);
  process.exit(r.code);
}
