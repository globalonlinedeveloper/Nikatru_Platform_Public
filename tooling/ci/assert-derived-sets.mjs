#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-derived-sets.mjs — every listing set that declares `derivedFrom` was
// derived from the source files that are in the tree NOW, and no screenshot
// README restates what its CAPTURE.json records.
//
// Row O-CAPTURE-LEAVES-DERIVED-SETS-STALE (AR-D3b, 2026-09-27). The apps.gov.in
// set is derived from the Play phone set. A Play re-capture changed its source,
// the lane proposed the capture directories only, and its pull request (opened by
// GITHUB_TOKEN) ran no ci.yml, so nothing said the derived set was stale. This
// guard runs INSIDE .github/workflows/store-screenshots.yml, after
// tooling/store/finish-capture.mjs and before the pull request opens, and in
// ci.yml's guards-store job.
//
// CHEAP BY DESIGN: it decodes no image. The pixel re-derivation stays in each
// deriver's own check mode and CI step (for apps.gov.in,
// tooling/ci/assert-apps-gov-in-media.mjs), so no frame is decoded twice.
//
// LIMBS
//   SHAPE    every `derivedFrom` is { channel, set, deriver }, names a real
//            channel other than its own, and sits on a set that carries no
//            `generatedBy` (both on one set is refused: exit 1).
//   DERIVER  the deriver file exists and exports DERIVER { write, check }
//            (tooling/store/derived-sets.mjs); otherwise nothing can re-derive
//            the set, and that is COVERAGE LOST (exit 2), not a finding.
//   SOURCES  per app with a listing directory for the derived channel: the
//            record (CAPTURE.json) lists `derivation.sources` in the source set;
//            each still exists with its recorded sha256; and every image in a
//            source DIRECTORY is one of them. A mismatch is exit 1, naming
//            `node tooling/store/finish-capture.mjs --app <app> --channel <source>`.
//   README   no screenshot README.md restates a scalar its sibling CAPTURE.json
//            records: `pixels` or `viewport` as W x H (x, X or ×, spaces
//            allowed), `count` or `deviceType` next to its field name. Exit 1.
//
// Usage:  node tooling/ci/assert-derived-sets.mjs [<repo-root>]
// Exit codes: 0 green · 1 a finding · 2 COVERAGE LOST (nothing declared, a
// deriver missing, nothing checked — never reported as a pass).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { derivedSets, shapeProblems, storeDirOf, recordOf, loadDeriver, REGISTER_REL, RECORD, IMAGE } from '../store/derived-sets.mjs';

const NAME = 'assert-derived-sets';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const finishCmd = (app, channel) => `node tooling/store/finish-capture.mjs --app ${app} --channel ${channel}`;

/** W x H, with x, X or × and optional spaces, not inside a longer number. */
const sizeRe = (w, h) => new RegExp(`(?<![0-9])${w}\\s*[xX×]\\s*${h}(?![0-9])`);
const fieldRe = (field, value) => new RegExp(`\\b${field}\\b[^A-Za-z0-9\\n]{0,6}${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);

/** The README limb over one set directory. Returns problems. */
export function readmeProblems(root, setDirRel) {
  const out = [];
  const recAbs = join(root, setDirRel, RECORD);
  const readmeAbs = join(root, setDirRel, 'README.md');
  if (!existsSync(recAbs) || !existsSync(readmeAbs)) return out;
  let rec;
  try {
    rec = JSON.parse(readFileSync(recAbs, 'utf8'));
  } catch (e) {
    return [`${setDirRel}/${RECORD} does not parse (${e.message}).`];
  }
  const text = readFileSync(readmeAbs, 'utf8');
  for (const field of ['pixels', 'viewport']) {
    const m = typeof rec[field] === 'string' ? /^(\d+)x(\d+)/.exec(rec[field]) : null;
    if (m && sizeRe(m[1], m[2]).test(text)) {
      out.push(`${setDirRel}/README.md restates ${field} ${m[1]}x${m[2]}, which ${RECORD} beside it records. A README keeps the procedure; the record is where the value is read.`);
    }
  }
  for (const field of ['count', 'deviceType']) {
    const v = rec[field];
    if ((typeof v === 'number' || typeof v === 'string') && fieldRe(field, v).test(text)) {
      out.push(`${setDirRel}/README.md restates ${field} ${JSON.stringify(v)}, which ${RECORD} beside it records. A README keeps the procedure; the record is where the value is read.`);
    }
  }
  return out;
}

/** The SOURCES limb for one declaration and one app. Returns { problems, notes, checked }. */
export function sourceProblems(root, register, entries, entry, app) {
  const problems = [];
  const notes = [];
  let checked = 0;
  const df = entry.derivedFrom;
  const derivedDir = storeDirOf(register, entry.channel, app);
  const sourceDir = storeDirOf(register, df.channel, app);
  const recordRel = recordOf(entries, entry);
  const redo = finishCmd(app, df.channel);
  if (derivedDir === null || sourceDir === null) return { problems, notes, checked, lost: `channels[] rows "${entry.channel}" and "${df.channel}" must both carry a storeMetadataDir template.` };
  if (recordRel === null) return { problems, notes, checked, lost: `${entry.where} is a file set, and ${entry.channel} declares no single directory set derived by ${df.deriver} whose ${RECORD} would record its sources.` };
  const derivedAbs = join(root, derivedDir, entry.set);
  const recordAbs = join(root, derivedDir, recordRel);
  const sourceRel = `${sourceDir}/${df.set}`;
  const sourceAbs = join(root, sourceRel);
  const sourceIsDir = isDir(sourceAbs);
  const derivedHolds = entry.kind === 'dir' ? isDir(derivedAbs) && listDir(derivedAbs).some((n) => IMAGE.test(n)) : existsSync(derivedAbs);
  if (!existsSync(recordAbs)) {
    if (derivedHolds) problems.push(`${derivedDir}/${entry.set} exists and ${derivedDir}/${recordRel} does not: nothing records what it was derived from. Run \`${redo}\`.`);
    else notes.push(`${app}: ${derivedDir}/${entry.set} is not derived yet (a freshly stamped app); \`${redo}\` derives it after the first capture.`);
    return { problems, notes, checked };
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(recordAbs, 'utf8'));
  } catch (e) {
    problems.push(`${derivedDir}/${recordRel} does not parse (${e.message}).`);
    return { problems, notes, checked };
  }
  const sources = Array.isArray(rec?.derivation?.sources) ? rec.derivation.sources : null;
  if (sources === null) {
    problems.push(`${derivedDir}/${recordRel} records no derivation.sources, so nothing can say whether ${derivedDir}/${entry.set} is current. Run \`${redo}\`.`);
    return { problems, notes, checked };
  }
  // A file set's source is its own path; a directory set's sources sit under it.
  const mine = sources.filter((s) => typeof s?.file === 'string' && (s.file === sourceRel || s.file.startsWith(`${sourceRel}/`)));
  if (!mine.length) {
    problems.push(`${derivedDir}/${recordRel} records no source in ${sourceRel}, which ${entry.where} is derived from. Run \`${redo}\`.`);
    return { problems, notes, checked };
  }
  for (const s of mine) {
    const abs = join(root, s.file);
    if (!existsSync(abs)) {
      problems.push(`${derivedDir}/${entry.set} is STALE: its recorded source ${s.file} no longer exists. Run \`${redo}\` and commit the result.`);
      continue;
    }
    const now = sha256(readFileSync(abs));
    if (now !== s.sha256) {
      problems.push(`${derivedDir}/${entry.set} is STALE: ${s.file} has changed since it was derived (sha256 ${now.slice(0, 12)}…, recorded ${String(s.sha256).slice(0, 12)}…). Run \`${redo}\` and commit the result.`);
      continue;
    }
    checked++;
  }
  if (sourceIsDir) {
    const recorded = new Set(mine.map((s) => s.file));
    for (const n of listDir(sourceAbs).filter((x) => IMAGE.test(x)).sort()) {
      if (!recorded.has(`${sourceRel}/${n}`)) problems.push(`${derivedDir}/${entry.set} is STALE: ${sourceRel}/${n} is in the source set and was never derived from. Run \`${redo}\` and commit the result.`);
    }
  }
  return { problems, notes, checked };
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let register;
  try {
    register = JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} could not be read under ${ROOT} (${e.message}).`]);
  }
  const entries = derivedSets(register);
  if (!entries.length) coverageLost([`${REGISTER_REL} declares no derivedFrom on any storeMetadataContract.perChannel graphicAssets entry.`, 'The apps.gov.in sets declare two; zero means the read looked in the wrong place, not that nothing is derived.']);

  const problems = [];
  const notes = [];
  const lost = [];
  // SHAPE
  for (const e of entries) problems.push(...shapeProblems(e, register));
  // DERIVER
  const derivers = [...new Set(entries.map((e) => e.derivedFrom?.deriver).filter((d) => typeof d === 'string'))];
  for (const d of derivers) {
    const got = await loadDeriver(d);
    if (got.lost) lost.push(got.lost);
  }
  if (lost.length) coverageLost([...lost, 'A set that declares a deriver nobody can run has no way to be re-derived after a capture.']);
  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(1);
  }

  // SOURCES
  const appsDir = join(ROOT, 'apps');
  if (!isDir(appsDir)) coverageLost([`${appsDir} does not exist; there is no tree to check.`]);
  const apps = listDir(appsDir).filter((a) => isDir(join(appsDir, a))).sort();
  let checked = 0;
  let trees = 0;
  for (const e of entries) {
    for (const app of apps) {
      const dir = storeDirOf(register, e.channel, app);
      if (dir === null || !isDir(join(ROOT, dir))) continue;
      trees++;
      const r = sourceProblems(ROOT, register, entries, e, app);
      if (r.lost) coverageLost([r.lost]);
      problems.push(...r.problems.map((p) => `${app}: ${p}`));
      notes.push(...r.notes);
      checked += r.checked;
    }
  }

  // README
  let readmes = 0;
  for (const app of apps) {
    const storeRoot = join(ROOT, 'apps', app, 'store');
    if (!isDir(storeRoot)) continue;
    for (const ch of listDir(storeRoot).filter((c) => isDir(join(storeRoot, c)))) {
      for (const set of listDir(join(storeRoot, ch)).filter((s) => isDir(join(storeRoot, ch, s)))) {
        const rel = `apps/${app}/store/${ch}/${set}`;
        if (!existsSync(join(ROOT, rel, RECORD)) || !existsSync(join(ROOT, rel, 'README.md'))) continue;
        readmes++;
        problems.push(...readmeProblems(ROOT, rel));
      }
    }
  }

  for (const n of notes) console.log(`   ⬜ ${n}`);
  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(1);
  }
  if (!trees || !checked) coverageLost([`${entries.length} derivedFrom declaration(s), ${trees} derived listing tree(s) and ${checked} recorded source(s) checked.`, 'A check that compared no source hash is not a pass.']);
  console.log(`${NAME}: ok — ${entries.length} derived set(s), ${derivers.length} deriver(s), ${checked} source hash(es) current across ${trees} tree(s); ${readmes} screenshot README(s) restate nothing their CAPTURE.json records`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
