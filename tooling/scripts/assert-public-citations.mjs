#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-public-citations.mjs — every citation in the PUBLIC tree resolves.
//
// 🔴 WHY THIS EXISTS. Nothing has ever checked a citation in the public tree.
// `assert-spec` limb 3 checks the spec's own `guard` fields, and
// `assert-adr-citations` is scoped to `Private/` — so a public file could point
// at anything at all and no build would notice. Measured 2026-08-17, before this
// guard existed: 205 lines across 95 tracked public files named
// `Private/company/` or `Private/knowledge/` (deleted in the 2026-08-15 flatten),
// including the opening line of sixteen JSON registers.
//
// This is the public half of ST-3 ("every pointer resolves"). The private half is
// `assert-index-complete` + `assert-adr-citations`.
//
// TWO CLASSES, BOTH CHECKED:
//
//   1. PRIVATE PATH REFERENCES — any `Private/...` path named in a public file
//      must exist on disk. These rot loudly at review time and silently at read
//      time, which is the wrong way round.
//
//   2. `[pipeline <ids>]` REQUIREMENT TAGS — 1,453 of them across the tree, the
//      densest citation class in the repo. They are NOT dead: the prose corpus
//      they were named for was deleted, but each id still resolves to an `origin`
//      field in `Private/requirements/*.json` (`[pipeline C-6]` -> origin
//      `[2]C-6`). So they are live pointers with a stale vocabulary, and the
//      correct treatment is to CHECK them, not to rewrite 1,453 tags.
//
// 🔴 A TAG IS NOT ONE ID. This is the whole reason the guard exists rather than a
// grep. A first pass at this with a naive `[A-Z]-[0-9]+` regex reported 55 of 157
// distinct tags unresolved; nearly all of those were the regex failing on real
// syntax the corpus uses — `[pipeline C-2/C-7]`, `[pipeline C-3, C-9]`,
// `[pipeline N-4 clause 7]`, `[pipeline F-5a, F-10]`, `[pipeline 2 C-11]`. A
// diagnostic is a claim and needs the same evidence as a finding, so this
// tokenises the tag body and resolves every id inside it.
//
// DISCLOSURE CONVENTIONS, HONOURED — the same two `assert-enforcers-exist` used,
// because this corpus deliberately keeps records of enforcement that was claimed
// and never built, and a naive guard would demand their deletion:
//   · `~~struck through~~`  — retracted text, not a live claim. Not checked.
//   · an absence annotated on the same line — `(does not exist)`, `(never
//     existed)`, `(deleted`, `(retired`, `(gone` — is a DISCLOSED absence and
//     passes. An UNDISCLOSED one fails. That asymmetry is the point.
//
// EXIT CODES:  0 = every citation resolves (or the corpus is absent — printed)
//              1 = a citation does not resolve
//              2 = could not run (no subject, or the spec could not be parsed)
//
// 🔴 IT LIVES IN tooling/scripts/, NOT tooling/ci/, AND THAT IS THE PRECEDENT NOT A
// PREFERENCE. `check-dod-sync.mjs` is the same shape — a guard whose SUBJECT is
// under `Private/`, which CI can never read — and it sits here for that reason.
// A guard in `tooling/ci/` is expected by `assert-guard-coverage.mjs` to be
// invoked by a workflow; this one would answer NOT APPLICABLE on every CI run,
// which is a check that always passes, i.e. exactly the vacuous pass it exists to
// catch. It was written into tooling/ci/ first and moved the same day, after
// `assert-guard-coverage` correctly reported it as an orphan.
//
// Usage:  node tooling/scripts/assert-public-citations.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');   // tooling/scripts -> repo root
const PRIVATE = join(REPO, 'Private');
const SPEC = join(PRIVATE, 'requirements');

/* Same contract as tooling/scripts/spec-guards.mjs: the subject of the RESOLUTION
   is private, so a clone without it cannot perform this check. Say so and exit 0
   rather than failing a contributor's commit over a directory they are never
   given — and rather than passing silently, which would be the vacuous pass. */
if (!existsSync(PRIVATE) || !existsSync(SPEC)) {
  console.log('⬜  public citations — NOT APPLICABLE: no `Private/requirements/` on disk.');
  console.log('    This checkout has no private corpus, so no citation into it can be resolved.');
  console.log('    Nothing was checked, and that is said rather than reported as a pass.');
  process.exit(0);
}

/* The domain is `git ls-files`, never a filesystem walk: the question is what the
   PUBLIC repository publishes, and an untracked file is not published. This also
   makes the guard's domain identical to the thing it is making a claim about. */
const ls = spawnSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (ls.status !== 0) {
  console.error('✗  could not enumerate tracked files: ' + (ls.stderr || '').trim());
  process.exit(2);
}
const files = ls.stdout.split('\n').map((s) => s.trim()).filter(Boolean);

/* 🔴 COVERAGE FLOOR. A guard that finds no subject and prints ok has checked
   nothing — the defect this corpus has found about ten times. The floor is set
   well below today's 1,210 so it survives ordinary growth and deletion, and well
   above zero so an enumeration that breaks fails loudly. */
const FILE_FLOOR = 800;
if (files.length < FILE_FLOOR) {
  console.error(`✗  only ${files.length} tracked file(s) — below the floor of ${FILE_FLOOR}.`);
  console.error('   Refusing: an empty or truncated subject list would pass every assertion below.');
  process.exit(2);
}

/* Every `origin` the spec knows, plus the frozen harvest in origins.lock.json —
   which is DATA, not a cache: the prose it came from no longer exists, so it can
   never be regenerated. Both are read because an id can be declared in one and
   cited from the other. */
const origins = new Set();
let specFiles = 0;
for (const f of readdirSync(SPEC)) {
  if (!f.endsWith('.json')) continue;
  let j;
  try { j = JSON.parse(readFileSync(join(SPEC, f), 'utf8')); } catch { continue; }
  specFiles++;
  const walk = (v) => {
    if (typeof v === 'string') { if (/^\[\d+\][A-Za-z]/.test(v)) origins.add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.values(v).forEach(walk); }
  };
  walk(j);
}
/* 352 distinct origin refs on 2026-08-17: the union of every `origin` field in
   the spec arrays and the 221 `knownIds` + 204 `requirementHeadings` frozen in
   origins.lock.json. The floor sits below that with headroom, and it EARNED its
   place on the first run — it was initially written as 400, a number carried over
   from a throwaway measurement, and it refused rather than resolving 1,453
   citations against a table it could not justify. The number here is the measured
   one; the earlier one was a guess wearing a floor's clothes. */
const ORIGIN_FLOOR = 300;
if (origins.size < ORIGIN_FLOOR) {
  console.error(`✗  only ${origins.size} origin ref(s) parsed from ${specFiles} spec file(s) — below ${ORIGIN_FLOOR}.`);
  console.error('   Refusing: a thin resolution table would silently accept a dead citation.');
  process.exit(2);
}
/* Public tags usually omit the leading stage number (`[pipeline C-6]` for
   `[2]C-6`), so resolve on the bare id as well as the full form. */
const bareOrigins = new Set([...origins].map((o) => o.replace(/^\[\d+\]/, '')));

const RE_PRIVATE_PATH = /Private\/[A-Za-z0-9_.{}-]+(?:\/[A-Za-z0-9_.{}-]+)*/g;
const RE_PIPELINE_TAG = /\[pipeline ([^\]]{1,120})\]/g;
/* An id is a letter-block, a dash and a number, optionally sub-lettered: C-6,
   F-5a, N-4, S-12r. Extracted from ANYWHERE in the tag body, so `C-2/C-7`,
   `C-3, C-9` and `N-4 clause 7` each yield the ids they actually name. */
const RE_ID = /\b([A-Z]{1,2}-\d{1,3}[a-z]?)\b/g;

const DISCLOSED = /\(\s*(?:does not exist|never existed|no longer exists|deleted|retired|gone|removed|absent)/i;

const failures = [];
let pathsChecked = 0, tagsChecked = 0, idsChecked = 0, filesScanned = 0;
let skippedStruck = 0, skippedDisclosed = 0;

for (const rel of files) {
  const abs = join(REPO, rel);
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { continue; }
  if (text.includes(' ')) {
    /* Three tracked guard sources carry literal NUL bytes, so they read as binary
       to grep. They are still TEXT and still carry citations, so they are scanned
       here rather than skipped — the NUL is stripped for matching only. */
    text = text.split(' ').join('');
  }
  filesScanned++;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const disclosed = DISCLOSED.test(line);

    /* Strikethrough is retracted text. Strip the struck spans before matching so a
       retracted citation inside a live line is not checked, while the rest is. */
    let scan = line;
    if (scan.includes('~~')) {
      const stripped = scan.replace(/~~[^~]*~~/g, '');
      if (stripped !== scan) skippedStruck++;
      scan = stripped;
    }

    for (const m of scan.matchAll(RE_PRIVATE_PATH)) {
      const p = m[0].replace(/[.,;:)]+$/, '');
      if (p === 'Private' || p === 'Private/') continue;
      pathsChecked++;
      if (existsSync(join(REPO, p))) continue;
      if (disclosed) { skippedDisclosed++; continue; }
      failures.push({ rel, line: i + 1, kind: 'path', what: p, text: line.trim().slice(0, 130) });
    }

    for (const m of scan.matchAll(RE_PIPELINE_TAG)) {
      tagsChecked++;
      const body = m[1];
      const ids = [...body.matchAll(RE_ID)].map((x) => x[1]);
      if (!ids.length) continue;   // `[pipeline 7]` — a bare stage, nothing to resolve
      for (const id of ids) {
        idsChecked++;
        if (bareOrigins.has(id) || origins.has(id)) continue;
        if (disclosed) { skippedDisclosed++; continue; }
        failures.push({ rel, line: i + 1, kind: 'tag', what: id, text: line.trim().slice(0, 130) });
      }
    }
  }
}

const label = `${filesScanned} tracked file(s) · ${pathsChecked} Private/ path ref(s) · ` +
  `${tagsChecked} [pipeline] tag(s) yielding ${idsChecked} id(s), resolved against ` +
  `${origins.size} origin(s) from ${specFiles} spec file(s)`;

if (!failures.length) {
  console.log(`ok  public citations — every citation resolves. ${label}` +
    (skippedStruck || skippedDisclosed
      ? ` [${skippedStruck} struck-through span(s) and ${skippedDisclosed} disclosed absence(s) not checked, by convention]`
      : ''));
  process.exit(0);
}

/* Group by file so a 60-hit register reads as one problem, not sixty. */
const byFile = new Map();
for (const f of failures) {
  if (!byFile.has(f.rel)) byFile.set(f.rel, []);
  byFile.get(f.rel).push(f);
}
console.error(`✗  public citations — ${failures.length} unresolved citation(s) in ${byFile.size} file(s). ${label}\n`);
for (const [rel, hits] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${rel}  (${hits.length})`);
  for (const h of hits.slice(0, 6)) {
    console.error(`    :${h.line}  ${h.kind === 'path' ? 'no such path' : 'unknown requirement id'}  ${h.what}`);
  }
  if (hits.length > 6) console.error(`    … and ${hits.length - 6} more in this file`);
}
console.error('\n  A citation that still parses and no longer points at the right thing is this');
console.error('  corpus\'s most repeated defect. Repoint it, or disclose the absence on the same');
console.error('  line — `(deleted 2026-08-15)` — which this guard accepts and a reader can see.\n');
process.exit(1);
