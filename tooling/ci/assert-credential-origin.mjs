#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-credential-origin.mjs — A CREDENTIAL GOES ONLY TO ITS PINNED ISSUER.
//
// ⏱ 2026-10-01 (review 2 of the CodeQL stack #1085-#1087, finding 1). The stack
// wrote tooling/ops/credential-origin.mjs, "the one answer to may this credential
// go to that host", and routed some callers through it. The review then found the
// Supabase service-role key still sent to the raw SUPABASE_URL by four e2e scripts
// (delete_headless, verify_purged, purge, assert_one_issuer), and the GlitchTip
// token by upload-native-symbols.mjs, in the SAME e2e.yml job whose other two
// scripts pinned. A helper closes nothing by existing: a script that never calls it
// is exactly as open as before. This guard is what holds the class.
//
// ── THE SUBJECT ──────────────────────────────────────────────────────────────
// Every tracked .mjs/.js under tooling/ and extensions/scripts/, outside test/,
// fixtures and the app brick, read with comments blanked (text-reductions.mjs).
// The credential names and base-URL names are NOT listed here: they are
// CREDENTIAL_ENV in tooling/ops/credential-origin.mjs, the helper's own list, so a
// new credential is added in one place and this guard holds it from that commit.
//
// A file is IN SCOPE when it READS a credential: `process.env.K`,
// `process.env['K']`, `env.K`, `env['K']`, destructuring from `env` or `process.env`,
// or a call carrying the literal as ANY argument: `need('K')`, `vault.get('K')`, and
// the two-argument `cred('K', 'FALLBACK')`. ⏱ 2026-10-01 (review of #1097, finding
// 3): only a one-argument call matched, which kept verify-password-reset-revokes.mjs,
// a service-role caller, out of scope. A literal inside an array or object literal
// (a list of names) is not a read.
//
// ── THE LIMBS ─────────────────────────────────────────────────────────────────
//   P · PINNED. An in-scope file that sends — `fetch…(`, `http(s).request(`, or a
//       spawn/exec (a CLI given the token in its env) — calls credentialOrigin().
//       If it does not, EVERY credential read site in it is a finding of its own.
//   R · NO RAW BASE. In an in-scope file, every read of a base-URL variable is
//       either inside a credentialOrigin() call on the same line, or bound to a
//       name X (`const X = …`, `X = …`) that the file passes to
//       credentialOrigin(X …) and never uses raw: never `${X…}`, `X +`, `+ X`,
//       `fetch…(X`, `new URL(…, X)`, or an object value `key: X`. The pinned
//       RESULT is what a request may be built from. Reverting one call site to
//       the raw value is a finding (the red control in the test does exactly that
//       to the real tooling/e2e/delete_headless.mjs).
//   E · AN EXEMPTION IS A CALL SITE, AND LIVE. tooling/ci/credential-origin-exempt.json
//       rows, each {path, limb, at, reason}, suppress a finding only when the
//       finding's own line contains `at` (the read or use it excuses), never a whole
//       file: ⏱ 2026-10-01 (review of #1097, finding 2) a file-wide row let a NEW
//       service-role send, appended to an exempted file, pass green. A row that
//       suppresses nothing any more is itself a finding.
//
// A response-supplied URL (a server's `info.url` carrying the token onward) is not
// a base read and no static rule here sees it; upload-web-sourcemaps.mjs refuses it
// at run time and tooling/ci/test/web-sourcemaps.test.mjs holds that refusal.
//
// ⚠️ BLIND SPOTS, WRITTEN HERE: the flow is followed ONE binding deep. A base read
// into X, reshaped into Y (`const Y = X.replace(…)`) and Y sent, is caught only
// because X itself then has no credentialOrigin(X). A base that arrives as a
// function PARAMETER, or from a register file, is judged by limb P only. A
// credential passed to a helper module that sends it is judged in the helper.
//
// Exit 0 clean · 1 a finding (or a stale exemption) · 2 COVERAGE LOST: the scan
// read no file, the reducer stopped reducing, the helper's list could not be
// read, or a sentinel pinned caller fell out of scope (the read patterns broke).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { CREDENTIAL_ENV } from '../ops/credential-origin.mjs';

const NAME = 'assert-credential-origin';
const HERE = dirname(fileURLToPath(import.meta.url));
export const EXEMPT_REL = 'tooling/ci/credential-origin-exempt.json';

/** Files that pin today and read a credential themselves. If one of them is not in
 *  scope, the READ patterns stopped matching and every verdict is empty: exit 2. */
export const SENTINELS = Object.freeze([
  'tooling/e2e/provision_user.mjs',
  'tooling/ops/upload-web-sourcemaps.mjs',
  // Reads the service-role key through the TWO-argument cred('K', 'FALLBACK') (review of #1097, finding 3).
  'tooling/ops/verify-password-reset-revokes.mjs',
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every credential and base name, from the helper's own list. */
export function envNames(list = CREDENTIAL_ENV) {
  const credentials = [];
  const bases = [];
  for (const kind of Object.values(list)) {
    credentials.push(...kind.credentials);
    bases.push(...kind.bases);
  }
  return { credentials, bases };
}

/** The READ forms of an environment name, as one regex (global). */
export function readPattern(name) {
  const n = esc(name);
  return new RegExp(
    [
      // process.env.K · process.env['K'] · env.K · env['K']
      `process\\.env\\.${n}\\b|process\\.env\\[\\s*['"\`]${n}['"\`]\\s*\\]|(?<![\\w$.])env\\.${n}\\b|(?<![\\w$.])env\\[\\s*['"\`]${n}['"\`]\\s*\\]`,
      // f('K') · f('A', 'K') · cred('K', 'FALLBACK'): the literal as ANY argument, with no list or object before it
      `[\\w$.]+\\(\\s*(?:[^()\\[\\]{}\\n]*?,\\s*)?['"\`]${n}['"\`]\\s*[,)]`,
      // const { K } = process.env · const { K: k } = env
      `\\{[^{}]*?(?<![\\w$'"])${n}\\b[^{}]*\\}\\s*=\\s*(?:process\\.)?env\\b`,
    ].join('|'),
    'g',
  );
}

const SENDS = /(?<![\w$.])fetch\w*\s*\(|\bhttps?\.(?:request|get)\s*\(|(?<![\w$.])(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/;
const PINS = /(?<![\w$.])credentialOrigin\s*\(/;

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** The name a base read on this line is bound to, or null. */
function boundName(lineText, column) {
  const before = lineText.slice(0, column);
  const m = /(?:\b(?:const|let|var)\s+([\w$]+)\s*=|(?:^|[;{(\s])([\w$]+)\s*=)(?!=)[^=]*$/.exec(before);
  return m ? (m[1] ?? m[2]) : null;
}

/** The first raw use of X in the code, or null. */
export function rawUse(code, x) {
  const n = esc(x);
  const shapes = [
    [`\\$\\{\\s*${n}\\b`, 'interpolated into a string'],
    [`(?<![\\w$.])${n}\\s*\\+(?!\\+|=)`, 'concatenated'],
    [`\\+\\s*${n}\\b(?!\\s*\\()`, 'concatenated'],
    [`(?<![\\w$.])fetch\\w*\\s*\\(\\s*${n}\\b`, 'passed to a fetch'],
    [`new\\s+URL\\s*\\([^)]*,\\s*${n}\\s*\\)`, 'used as the base of a URL'],
    [`[\\w$'"\\]]\\s*:\\s*${n}\\s*[,}]`, 'handed on as an object value'],
  ];
  const lines = code.split('\n');
  for (const [re, what] of shapes) {
    for (const m of code.matchAll(new RegExp(re, 'g'))) {
      const line = lineAt(code, m.index);
      // Inside the pin itself (`credentialOrigin(\`https://${x}\`, …)`) is not raw.
      if (!PINS.test(lines[line - 1])) return { what, line };
    }
  }
  return null;
}

/**
 * PURE. Judge one file's comment-blanked code.
 * @returns {{ reads: string[], sends: boolean, pins: boolean, findings: {limb: 'P'|'R', line: number, what: string}[] }}
 */
export function scanSource(code, names = envNames()) {
  const reads = names.credentials.filter((k) => readPattern(k).test(code));
  const sends = SENDS.test(code);
  const pins = PINS.test(code);
  const findings = [];
  if (reads.length === 0) return { reads, sends, pins, findings };
  const lines = code.split('\n');
  if (sends && !pins) {
    // One finding per READ SITE, so an exemption names the site it excuses and a
    // new read in the same file is a new finding (review of #1097, finding 2).
    for (const k of reads) {
      for (const m of code.matchAll(readPattern(k))) {
        const line = lineAt(code, m.index);
        findings.push({
          limb: 'P',
          line,
          text: lines[line - 1].trim(),
          what: `reads ${k} here, the file sends a request, and it never calls credentialOrigin(): the credential goes to whatever host the configuration names`,
        });
      }
    }
  }
  for (const base of names.bases) {
    for (const m of code.matchAll(readPattern(base))) {
      const line = lineAt(code, m.index);
      const text = lines[line - 1];
      if (PINS.test(text)) continue;
      const column = m.index - (code.lastIndexOf('\n', m.index - 1) + 1);
      const x = boundName(text, column);
      if (!x) {
        findings.push({ limb: 'R', line, text: text.trim(), what: `reads ${base} and uses it unpinned (not inside credentialOrigin(), not bound to a name)` });
        continue;
      }
      if (!new RegExp(`(?<![\\w$.])credentialOrigin\\s*\\([^;\\n]*?(?<![\\w$.'"])${esc(x)}\\b`).test(code)) {
        findings.push({ limb: 'R', line, text: text.trim(), what: `reads ${base} into \`${x}\`, and \`${x}\` never passes through credentialOrigin()` });
        continue;
      }
      const raw = rawUse(code, x);
      if (raw) {
        findings.push({
          limb: 'R',
          line: raw.line,
          text: lines[raw.line - 1].trim(),
          what: `\`${x}\` holds the RAW ${base} (read at line ${line}) and is ${raw.what}; build requests from credentialOrigin()'s result`,
        });
      }
    }
  }
  return { reads, sends, pins, findings };
}

/**
 * PURE. Apply the exemptions. Returns the findings left, the stale rows, and the
 * in-scope paths.
 * @param {{path: string, code: string}[]} files
 * @param {{path: string, limb: string, at: string, reason: string}[]} exempt
 */
export function judge(files, exempt, names = envNames()) {
  const findings = [];
  const inScope = [];
  const used = new Set();
  for (const f of files) {
    const r = scanSource(f.code, names);
    if (r.reads.length > 0) inScope.push(f.path);
    for (const x of r.findings) {
      // A CALL SITE, never a file: the row's `at` must be on the finding's own line.
      const at = exempt.findIndex((e) => e.path === f.path && e.limb === x.limb && x.text.includes(e.at));
      if (at !== -1) {
        used.add(at);
        continue;
      }
      findings.push({ path: f.path, ...x });
    }
  }
  const stale = exempt.filter((_, i) => !used.has(i));
  return { findings, stale, inScope };
}

/** A well-formed exemption list, or a string saying why not. */
export function parseExempt(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return `does not parse (${e.message})`;
  }
  if (!Array.isArray(doc?.exempt)) return 'has no `exempt` array';
  for (const [i, e] of doc.exempt.entries()) {
    if (
      typeof e?.path !== 'string' ||
      !['P', 'R'].includes(e?.limb) ||
      typeof e?.at !== 'string' ||
      e.at.trim().length < 12 ||
      typeof e?.reason !== 'string' ||
      e.reason.trim().length < 40
    ) {
      return `row ${i} is not {path, limb: "P"|"R", at (the call site, 12+ characters), reason (40+ characters)}`;
    }
  }
  return doc.exempt;
}

/** The tracked files this guard reads. */
export function inSubject(path) {
  if (!/^(?:tooling|extensions\/scripts)\//.test(path)) return false;
  if (!/\.(?:mjs|js)$/.test(path)) return false;
  return !path.split('/').some((seg) => ['test', 'fixtures', 'node_modules', '__brick__'].includes(seg));
}

function main() {
  const ROOT = resolve(HERE, '..', '..');
  const coverage = [];
  const reduced = stripSourceComments('x // c', '.mjs');
  if (reduced === 'x // c') coverage.push('stripSourceComments() left a .mjs comment in place: every read would include prose.');
  const names = envNames();
  if (names.credentials.length === 0 || names.bases.length === 0) coverage.push('CREDENTIAL_ENV in tooling/ops/credential-origin.mjs lists no credential or no base.');

  const ls = spawnSync('git', ['ls-files', '-z', '--', 'tooling', 'extensions/scripts'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) {
    console.error(`${NAME}: COVERAGE LOST — git ls-files exited ${ls.status}; no file was read.`);
    coverageLost();
  }
  const files = [];
  for (const path of ls.stdout.split('\0').filter(Boolean).filter(inSubject)) {
    let text;
    try {
      text = readFileSync(join(ROOT, path), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    files.push({ path, code: stripSourceComments(text, extname(path)) });
  }
  if (files.length === 0) coverage.push('the subject (tracked .mjs/.js under tooling/ and extensions/scripts/) is empty.');

  let exempt;
  try {
    exempt = parseExempt(readFileSync(join(ROOT, EXEMPT_REL), 'utf8'));
  } catch (e) {
    exempt = `could not be read (${e.code ?? e.name})`;
  }
  if (typeof exempt === 'string') {
    console.error(`${NAME}: FAILED — ${EXEMPT_REL} ${exempt}.`);
    process.exit(1);
  }

  const { findings, stale, inScope } = judge(files, exempt, names);
  for (const s of SENTINELS) {
    if (!inScope.includes(s)) coverage.push(`${s} reads a credential and pins it, yet is not in scope: the READ patterns no longer match it.`);
  }

  if (coverage.length > 0) {
    console.error(`${NAME}: COVERAGE LOST — the scan cannot prove what it judged:`);
    for (const c of coverage) console.error(`    ${c}`);
    if (findings.length === 0 && stale.length === 0) coverageLost();
  }
  if (findings.length > 0 || stale.length > 0) {
    console.error(`${NAME}: FAILED — ${findings.length} finding(s), ${stale.length} stale exemption(s):`);
    for (const f of findings) console.error(`    ${f.path}${f.line ? `:${f.line}` : ''} [${f.limb}] ${f.what}`);
    for (const s of stale) console.error(`    ${EXEMPT_REL}: STALE — ${s.path} [${s.limb}] at ${JSON.stringify(s.at)} suppresses nothing any more. Delete the row.`);
    console.error('');
    console.error('  Route the base through credentialOrigin(url, kind) from tooling/ops/credential-origin.mjs and');
    console.error('  build every request from the origin it RETURNS, refusing before the first request. An');
    console.error(`  exemption is a row in ${EXEMPT_REL} with its reason.`);
    process.exit(1);
  }
  console.log(
    `ok  ${NAME} — ${files.length} file(s) read, ${inScope.length} read a credential ` +
      `(${names.credentials.length} names from CREDENTIAL_ENV), each pinned; ${exempt.length} exemption(s), all live.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

/** The one COVERAGE LOST stop: each could-not-look branch above prints its reason and
 *  ends here, so the run exits 2 — never 1, which would read as a finding. */
function coverageLost() {
  process.exit(2);
}
