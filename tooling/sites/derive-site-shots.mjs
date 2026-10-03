#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// derive-site-shots.mjs — RE-DERIVE THE SITE'S COPY OF EVERY STORE FRAME THAT
// MOVED, the way tooling/site-shots.json says to, and re-record it.
//
// ⏱ 2026-10-03 · WHY THIS EXISTS (O-CAPTURE-LEAVES-DERIVED-SETS-STALE, the site
// half). tooling/site-shots.json is the DERIVATION RECORD of every product
// screenshot nikatru.com serves, and tooling/ci/check-site-integrity.mjs fails a
// served copy whose `from` frame no longer hashes to `sourceSha256` — "the store
// set was re-captured; the site must follow". The record named the command and
// the steps, and nothing ran them: the capture lane re-derives the apps.gov.in
// set (finish-capture.mjs) and proposed a Play set whose merge would turn the
// `sites` job red, because the web copies were made by hand on a machine with
// ImageMagick (#1151). The laptop that runs the lanes has none. The capture job
// runs on ubuntu-24.04, which does, so the derivation runs THERE, in the same
// job, and the copies arrive in the same pull request as the frames.
//
// WHAT IT DOES, per record entry whose `from` frame no longer hashes to
// `sourceSha256` (an entry whose frame is unchanged is left byte for byte):
//   1. the next version in the web name (`<slug>-<N>-v<V>.webp` → `-v<V+1>`),
//      because sites/nikatru/_headers serves /*.webp immutable for a year and a
//      re-cut under the old name would not reach a returning visitor;
//   2. `derivation.command` from the record, run as an ARGUMENT VECTOR (no
//      shell): `<from>` and the output path are substituted token by token;
//   3. the old copy removed — the record's own rule ("delete the old files"), and
//      check-site-integrity fails a served file the record does not name;
//   4. the entry re-recorded: file, sha256, bytes, sourceSha256.
// Then tooling/sites/generate-discovery.mjs re-renders the pages, which read
// whatever copies are on disk. stdout carries the repository paths the run
// changed, one per line, for the capture job's pull request; nothing else.
//
//   node tooling/sites/derive-site-shots.mjs [--check] [repoRoot]
//
//   --check   writes nothing: lists each stale entry and exits 1 if there is one.
// Exit 0 = every copy is current (or was just re-derived). 1 = a copy is stale
// (--check) or a derivation failed. 2 = COVERAGE LOST: the record cannot be read,
// names no copy, or its command has no `<from>` to substitute.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NAME = 'derive-site-shots';
export const RECORD_REL = 'tooling/site-shots.json';
/** `<slug>-<N>-v<V>.webp`, the generator's SHOT_NAME with the version captured. */
const VERSIONED = /^(.*\/)?([a-z0-9-]+?-\d+)-v(\d+)\.webp$/i;

export class DeriveRefused extends Error {
  constructor(code, lines) {
    super(lines[0]);
    this.code = code;
    this.lines = lines;
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const abs = (root, rel) => join(root, ...rel.split('/'));

/** The next version of a web name, or null when it carries none. */
export function nextVersion(file) {
  const m = VERSIONED.exec(file);
  if (!m) return null;
  return `${m[1] ?? ''}${m[2]}-v${Number(m[3]) + 1}.webp`;
}

/** The record's command as an argument vector for one entry. The template's
 *  last token is the output path (a `<slug>-<N>-v<V>.webp` placeholder); the
 *  token `<from>` is the frame. Anything else is passed through verbatim. */
export function commandFor(template, from, out) {
  const tokens = String(template ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || !tokens.includes('<from>')) return null;
  const last = tokens.length - 1;
  return tokens.map((t, i) => (t === '<from>' ? from : i === last ? out : t));
}

/** Read the record and work out which entries are stale. */
export function plan(root) {
  const recordAbs = abs(root, RECORD_REL);
  let record;
  try {
    record = JSON.parse(readFileSync(recordAbs, 'utf8'));
  } catch (e) {
    throw new DeriveRefused(2, [`${RECORD_REL} cannot be read (${e.message}), so no site copy can be traced or re-derived.`]);
  }
  const shots = Array.isArray(record?.shots) ? record.shots : null;
  if (!shots || shots.length === 0) throw new DeriveRefused(2, [`${RECORD_REL} names no site copy: a derivation over zero entries is no derivation.`]);
  const stale = [];
  for (const entry of shots) {
    const from = String(entry?.from ?? '');
    if (!from || !existsSync(abs(root, from))) {
      throw new DeriveRefused(1, [`${RECORD_REL} records ${entry?.file} as made from \`${from}\`, which does not exist: there is no frame to derive it from.`]);
    }
    const source = sha256(readFileSync(abs(root, from)));
    if (source !== entry.sourceSha256) stale.push({ entry, source });
  }
  return { record, stale };
}

/** Re-derive every stale entry. `convert(argv)` runs one derivation and returns
 *  `{ ok, err }`; it is injected so the test drives this without ImageMagick. */
export function derive(root, { convert, render } = {}) {
  const { record, stale } = plan(root);
  if (stale.length === 0) return { changed: [], record };
  const template = record?.derivation?.command;
  // Phase 1: every new copy is written BEFORE anything old is touched, so a
  // derivation that fails part-way leaves the served copies and the record as
  // they were (the copies this run wrote are taken back).
  const made = [];
  for (const { entry, source } of stale) {
    const next = nextVersion(entry.file);
    const argv = next === null ? null : commandFor(template, entry.from, next);
    let refusal = null;
    if (next === null) refusal = new DeriveRefused(2, [`${entry.file} carries no -v<N> version, so a re-cut has no new name (sites/nikatru/_headers serves /*.webp immutable).`]);
    else if (argv === null) refusal = new DeriveRefused(2, [`${RECORD_REL} derivation.command has no \`<from>\` token and an output path, so it cannot be run for ${entry.file}.`]);
    else {
      const r = convert(argv, root);
      if (!r.ok || !existsSync(abs(root, next))) {
        refusal = new DeriveRefused(1, [`the derivation of ${next} from ${entry.from} failed: ${r.err || 'it wrote no file'}`, `command: ${argv.join(' ')}`]);
      }
    }
    if (refusal) {
      for (const m of made) if (existsSync(abs(root, m.next))) unlinkSync(abs(root, m.next));
      throw refusal;
    }
    made.push({ entry, source, next });
  }
  // Phase 2: the old copies go and the entries are re-recorded.
  const changed = new Set();
  for (const { entry, source, next } of made) {
    const bytes = readFileSync(abs(root, next));
    if (existsSync(abs(root, entry.file))) unlinkSync(abs(root, entry.file));
    changed.add(entry.file.slice(0, entry.file.lastIndexOf('/')));
    entry.file = next;
    entry.sha256 = sha256(bytes);
    entry.bytes = statSync(abs(root, next)).size;
    entry.sourceSha256 = source;
  }
  writeFileSync(abs(root, RECORD_REL), `${JSON.stringify(record, null, 2)}\n`);
  changed.add(RECORD_REL);
  for (const p of render(root)) changed.add(p);
  return { changed: [...changed].sort(), record };
}

/** ImageMagick 6's `convert`, as the record names it. */
function realConvert(argv, root) {
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (r.error) return { ok: false, err: r.error.message };
  return r.status === 0 ? { ok: true } : { ok: false, err: (r.stderr || `exit ${r.status}`).trim().split('\n')[0] };
}

/** The pages that list the copies, re-rendered by the one generator that writes
 *  them. Returns the page paths it changed (git's word, not a guess). */
function realRender(root) {
  const g = spawnSync(process.execPath, ['tooling/sites/generate-discovery.mjs'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (g.status !== 0) throw new DeriveRefused(1, ['tooling/sites/generate-discovery.mjs failed after the copies were re-derived:', (g.stderr || '').trim().split('\n')[0]]);
  const d = spawnSync('git', ['-C', root, 'diff', '--name-only', '--', 'sites/nikatru/apps/*.html'], { encoding: 'utf8' });
  return (d.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function refuse(code, lines) {
  console.error('');
  console.error(`${code === 2 ? 'FAIL COVERAGE LOST' : 'FAIL'} — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const CHECK = argv.includes('--check');
  const ROOT = resolve(argv.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  try {
    if (CHECK) {
      const { stale } = plan(ROOT);
      for (const { entry } of stale) console.error(`stale ${entry.file} — ${entry.from} was re-captured`);
      console.error(`${NAME}: ${stale.length === 0 ? 'ok — every site copy is derived from the frame on disk' : `${stale.length} stale site copy(ies)`}`);
      process.exit(stale.length === 0 ? 0 : 1);
    }
    const { changed } = derive(ROOT, { convert: realConvert, render: realRender });
    for (const p of changed) console.log(p);
    console.error(`${NAME}: ${changed.length === 0 ? 'ok — no site copy was stale' : `re-derived; ${changed.length} path(s) changed`}`);
  } catch (e) {
    if (e instanceof DeriveRefused) refuse(e.code, e.lines);
    throw e;
  }
}
