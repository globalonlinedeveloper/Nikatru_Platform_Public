#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-incidents.mjs — an incident is PUBLIC, so it carries no personal data
// and the shape the status page renders (lane status-page, Do 5).
//
//   node tooling/ci/assert-incidents.mjs [--root <dir>]
//
// SUBJECT: every ops/incidents/<YYYY-MM-DD>-<slug>.md (README.md aside), which
// tooling/status/build-status.mjs renders as status.nikatru.com's history and
// Atom feed.
//   IN-1  the file name is <YYYY-MM-DD>-<slug>.md.
//   IN-2  front matter: `title`; `started` a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)
//         on the file's date; `resolved` empty or a UTC timestamp not before
//         `started`; `impact` none | minor | major; `components` a non-empty
//         list of names the status page shows.
//   IN-3  no e-mail address anywhere in the file.
//   IN-4  no phone- or card-like run of digits (timestamps aside).
//   IN-5  no link off nikatru.com.
// Exit 0 clean · 1 a finding · 2 COVERAGE LOST (ops/incidents/ missing, or a
// file unreadable). Zero incidents is a valid, printed answer.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { frontMatter, readComponents } from '../status/build-status.mjs';

export const DIR = 'ops/incidents';
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]{1,60}\.md$/;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const DIGIT_RUN = /(?:\d[ -]?){10,}/;
const LINK = /https?:\/\/[^\s)>\]"']+/g;
const ALLOWED_LINK = /^https:\/\/(?:[a-z0-9-]+\.)?nikatru\.com(?:[/?#]|$)/;
const IMPACTS = new Set(['none', 'minor', 'major']);

/** Every finding for one incident file. `known` is the set of component names. */
export function checkIncident(file, text, known) {
  const out = [];
  const base = path.posix.basename(file);
  const nm = NAME.exec(base);
  if (!nm) out.push(`${file}: IN-1 the name is not <YYYY-MM-DD>-<slug>.md`);
  const parsed = frontMatter(text);
  if (!parsed) return [...out, `${file}: IN-2 no front matter`];
  const { fm } = parsed;
  if (typeof fm.title !== 'string' || fm.title === '') out.push(`${file}: IN-2 no title`);
  if (typeof fm.started !== 'string' || !TS.test(fm.started)) out.push(`${file}: IN-2 started must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ`);
  else if (nm && fm.started.slice(0, 10) !== nm[1]) out.push(`${file}: IN-2 started (${fm.started}) is not on the file's date ${nm[1]}`);
  if (fm.resolved !== undefined && fm.resolved !== '') {
    if (!TS.test(fm.resolved)) out.push(`${file}: IN-2 resolved must be empty or a UTC timestamp`);
    else if (TS.test(fm.started ?? '') && fm.resolved < fm.started) out.push(`${file}: IN-2 resolved is before started`);
  }
  if (!IMPACTS.has(fm.impact)) out.push(`${file}: IN-2 impact must be none, minor or major`);
  if (!Array.isArray(fm.components) || fm.components.length === 0) out.push(`${file}: IN-2 components must be a non-empty list`);
  else for (const c of fm.components) if (!known.has(c)) out.push(`${file}: IN-2 ${JSON.stringify(c)} is not a component the status page shows`);
  text.split(/\r?\n/).forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    if (EMAIL.test(line)) out.push(`${at}: IN-3 an e-mail address`);
    if (DIGIT_RUN.test(line.replace(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?/g, '').replace(/\d{2}:\d{2}/g, ''))) out.push(`${at}: IN-4 a phone- or card-like run of digits`);
    for (const url of line.match(LINK) ?? []) if (!ALLOWED_LINK.test(url)) out.push(`${at}: IN-5 a link off nikatru.com`);
  });
  return out;
}

export function run(root) {
  const dir = path.join(root, ...DIR.split('/'));
  if (!existsSync(dir)) return { code: 2, lines: [`assert-incidents: COVERAGE LOST — ${DIR}/ does not exist`] };
  const c = readComponents(root);
  if (c.lost) return { code: 2, lines: [`assert-incidents: COVERAGE LOST — ${c.lost}`] };
  const known = new Set(c.components.map((x) => x.name));
  const files = listDir(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const findings = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(path.join(dir, f), 'utf8');
    } catch {
      return { code: 2, lines: [`assert-incidents: COVERAGE LOST — ${DIR}/${f} could not be read`] };
    }
    findings.push(...checkIncident(`${DIR}/${f}`, text, known));
  }
  if (findings.length) return { code: 1, lines: [...findings, `assert-incidents: ${findings.length} finding(s) in ${files.length} file(s)`] };
  return { code: 0, lines: [`assert-incidents: ok — ${files.length} incident(s) checked against ${known.size} component(s); none carries personal data`] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const root = a.includes('--root') ? path.resolve(a[a.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = run(root);
  for (const l of r.lines) console.log(l);
  process.exit(r.code);
}
