#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// finish-capture.mjs — after a capture, re-derive every listing set whose
// register entry declares `derivedFrom` on the captured channel, and print each
// derived set's path, one per line.
//
// Row O-CAPTURE-LEAVES-DERIVED-SETS-STALE (AR-D3b, 2026-09-27). Until this file,
// .github/workflows/store-screenshots.yml proposed the capture directories and
// nothing else: the apps.gov.in set is DERIVED from the Play phone set, a Play
// re-capture changed its source, and the pull request the lane opens is
// GITHUB_TOKEN's, so ci.yml (whose apps-gov-in step would have said so) never ran
// on it. Now each capture job runs this, then tooling/ci/assert-derived-sets.mjs,
// and its pull request adds the capture directories plus what this printed.
//
//   node --single-threaded tooling/store/finish-capture.mjs --app <app> --channel <channel> [<repo-root>]
//
//   1. reads tooling/channel-register.json;
//   2. checks that every set of the captured channel holding a frame carries its
//      CAPTURE.json (the capture's own record), and that some set holds a frame;
//   3. runs DERIVER.write (tooling/store/derived-sets.mjs, the contract) for every
//      deriver whose `derivedFrom.channel` is the captured channel, then for every
//      channel derived from THOSE, in dependency order, once per deriver and
//      channel, for the app's listing directory of that channel when it exists;
//   4. prints each derived set's path (repo-relative) on stdout, one per line.
//      Everything else goes to stderr, so stdout is exactly the list to `git add`.
//
// A channel no set is derived from prints nothing and exits 0. Run twice, the
// second run leaves every byte as the first left it (RC10, finish-capture.test.mjs).
//
// Exit codes: 0 done · 1 the capture left a set unrecorded, or nothing was
// captured · 2 COVERAGE LOST (the register, a declaration or a deriver could not
// be read, or the arguments name no capture channel — never reported as done).
//
// Runs with V8 background tasks OFF (single-threaded-relaunch.mjs): the deriver
// decodes and re-encodes every frame in this process.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';
import { relaunchSingleThreaded } from '../ci/single-threaded-relaunch.mjs';
import { derivedSets, shapeProblems, derivationOrder, storeDirOf, loadDeriver, REGISTER_REL, RECORD, IMAGE } from './derived-sets.mjs';

const NAME = 'finish-capture';

/** A refusal with its exit code and its lines. */
export class FinishRefused extends Error {
  constructor(code, lines) {
    super(lines[0]);
    this.code = code;
    this.lines = lines;
  }
}

/** The captured channel's set directories, relative to its listing directory. */
function capturedSets(pc) {
  const s = pc?.graphicAssets?.screenshots;
  if (!s || typeof s !== 'object') return null;
  const dirs = Object.values(s.deviceTypeCoverage?.sets ?? {}).map((v) => v?.dir).filter((d) => typeof d === 'string');
  if (!dirs.length && typeof s.dir === 'string') dirs.push(s.dir);
  return dirs.length ? { dirs: [...new Set(dirs)], record: typeof s.provenanceFile === 'string' ? s.provenanceFile : RECORD } : null;
}

/** Finish one capture. Returns `{ paths, notes }`; throws FinishRefused. */
export async function finishCapture(root, app, channel) {
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER_REL), 'utf8'));
  } catch (e) {
    throw new FinishRefused(2, [`${REGISTER_REL} could not be read (${e.message}).`]);
  }
  const per = register?.storeMetadataContract?.perChannel ?? {};
  const sets = capturedSets(per[channel]);
  const captureDir = storeDirOf(register, channel, app);
  if (!sets || captureDir === null) {
    throw new FinishRefused(2, [`--channel ${channel} is not a capture channel: the register declares no graphicAssets.screenshots set or no storeMetadataDir for it.`]);
  }
  const notes = [];
  let framed = 0;
  for (const dir of sets.dirs) {
    const abs = join(root, captureDir, dir);
    const frames = existsSync(abs) ? listDir(abs).filter((n) => IMAGE.test(n)) : [];
    if (!frames.length) continue;
    framed++;
    if (!existsSync(join(abs, sets.record))) {
      throw new FinishRefused(1, [`${captureDir}/${dir} holds ${frames.length} frame(s) and no ${sets.record}: the capture did not record this set, and nothing is derived from an unrecorded set.`]);
    }
  }
  if (!framed) throw new FinishRefused(1, [`no set of ${captureDir} holds a frame: there is no capture to finish.`]);

  const entries = derivedSets(register);
  const bad = entries.flatMap((e) => shapeProblems(e, register));
  if (bad.length) throw new FinishRefused(2, ['the register\'s derivedFrom declarations cannot be read as written:', ...bad]);
  let order;
  try {
    order = derivationOrder(entries, channel);
  } catch (e) {
    throw new FinishRefused(2, [e.message]);
  }
  if (!order.length) notes.push(`no set declares derivedFrom on ${channel}; nothing to re-derive.`);

  // Every deriver is loaded BEFORE the first write: one that cannot run leaves
  // the tree exactly as the capture left it.
  const jobs = [];
  for (const derived of order) {
    const here = entries.filter((e) => e.channel === derived);
    const dir = storeDirOf(register, derived, app);
    if (dir === null) throw new FinishRefused(2, [`channels[] row "${derived}" has no storeMetadataDir template, so its derived sets have no place to be written.`]);
    if (!existsSync(join(root, dir))) {
      notes.push(`${dir} does not exist: ${app} does not list on ${derived}.`);
      continue;
    }
    for (const deriverRel of [...new Set(here.map((e) => e.derivedFrom.deriver))]) jobs.push({ here, dir, deriverRel });
  }
  const loaded = new Map();
  for (const deriverRel of new Set(jobs.map((j) => j.deriverRel))) {
    const got = await loadDeriver(deriverRel);
    if (got.lost) throw new FinishRefused(2, [got.lost]);
    loaded.set(deriverRel, got.deriver);
  }

  const paths = [];
  for (const { here, dir, deriverRel } of jobs) {
    try {
      await loaded.get(deriverRel).write(root, app, { register });
    } catch (e) {
      throw new FinishRefused(1, [`${deriverRel} could not derive ${dir}: ${e.message}`]);
    }
    for (const e of here.filter((x) => x.derivedFrom.deriver === deriverRel)) {
      const p = `${dir}/${e.set}`;
      if (existsSync(join(root, p))) paths.push(p);
      else throw new FinishRefused(1, [`${deriverRel} ran and ${p} does not exist: the deriver did not write a set the register says it derives.`]);
    }
  }
  return { paths, notes };
}

function refuse(code, lines) {
  console.error('');
  console.error(`${code === 2 ? 'FAIL COVERAGE LOST' : 'FAIL'} — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const APP = flag('--app');
  const CHANNEL = flag('--channel');
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--app' && argv[i - 1] !== '--channel');
  const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (!APP || !/^[a-z][a-z0-9_-]*$/.test(APP)) refuse(2, [`--app <app> is required (got ${JSON.stringify(APP ?? null)}).`]);
  if (!CHANNEL || !/^[a-z][a-z0-9-]*$/.test(CHANNEL)) refuse(2, [`--channel <channel> is required (got ${JSON.stringify(CHANNEL ?? null)}).`]);
  let out;
  try {
    out = await finishCapture(ROOT, APP, CHANNEL);
  } catch (e) {
    if (e instanceof FinishRefused) refuse(e.code, e.lines);
    throw e;
  }
  for (const n of out.notes) console.error(`   ⬜ ${n}`);
  for (const p of out.paths) console.log(p);
  console.error(`${NAME}: ${out.paths.length} derived set(s) re-derived from the ${CHANNEL} capture of ${APP}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
// Inside `isMain`: finish-capture.test.mjs imports finishCapture, and a
// module-level relaunch would spawn this file with the test runner's arguments.
if (isMain) {
  const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), (lines) => refuse(2, lines));
  if (relaunched !== null) process.exit(relaunched);
  await main();
}
