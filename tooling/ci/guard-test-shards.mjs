#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// guard-test-shards.mjs — split the guards' own suite across N runners by
// MEASURED duration, and prove afterwards that the N runners ran it whole.
//
// ⏱ 2026-10-01 · WHY. `node --test "tooling/ci/test/*.test.mjs"` was ONE step of
// ci.yml guard-meta and the longest thing on every CI run: 737 s median over 32
// runs (research/session-2026-10-01/ci-speed/measure.md §2), 358 files and
// 2,072 test-case-seconds, run 3 wide on a 4-vCPU runner. Every pull request
// and every push to main waited on it.
//
// WHY NOT `node --test --test-shard=i/N`. Node's own shard is round-robin over
// the sorted file list. Simulated over the measured per-file times it leaves the
// worst of 4 shards at 248 s against a best of 143 s. Node also runs a shard's
// files in SORTED order whatever order they are given in, so balancing on total
// seconds is not enough either: a 142 s file that sorts last starts last. The
// plan below assigns the heaviest file first to the shard whose SIMULATED
// makespan (sorted order, `--test-concurrency` wide) grows least: 175 s on every
// one of 4 shards for the same weights.
//
// THE WEIGHTS are tooling/ci/test/guard-test-durations.json, seconds per test
// file summed from the junit `time=` of a green ci.yml run on main. A file the
// weights do not name (a new suite) weighs the median. A stale weight costs
// balance, never coverage: every file lands in exactly one shard whatever it
// weighs, and --plan refuses (exit 1) a plan that is not a partition.
//
//   node tooling/ci/guard-test-shards.mjs --plan --shards N --shard I [--out <file>]
//     Prints shard I's files (repo-relative, one per line) and writes them to
//     --out. ALL N shards are planned on every call and checked to partition the
//     tree's test files, so each runner checks the whole plan, not its slice.
//
//   node tooling/ci/guard-test-shards.mjs --merge --shards N --dir <dir> --out <file>
//     <dir>/<anything>-<I>/ holds shard I's `files.txt` and `guard-tests.junit.xml`
//     (what actions/download-artifact writes for artifacts named `…-<I>`). Red
//     (exit 1) when the N lists overlap or miss a test file of THIS tree, when a
//     listed file has no <testcase> in its shard's junit (it ran nothing), or
//     when a junit credits a file its shard was not given. Then writes ONE junit
//     — every shard's <testsuite>s under one <testsuites> — to --out, the
//     document assert-case-count-honest.mjs and the guard-tests-junit artifact
//     have always carried.
//
//   node tooling/ci/guard-test-shards.mjs --write-durations <junit>
//     Rewrites the weights from a junit (a maintainer's step; CI never writes).
//
// Exit 0 = planned / merged / written. 1 = a finding: the plan or the shards do
// not cover the suite exactly once. 2 = COVERAGE LOST: no test files found, the
// weights unreadable, a shard's files missing, or bad arguments.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basenameOf, parseJunitCases, unescapeXml } from './assert-case-count-honest.mjs';
import { listDir } from './tree-walk.mjs';

export const TEST_DIR_REL = 'tooling/ci/test';
export const DURATIONS_REL = 'tooling/ci/test/guard-test-durations.json';
/** node --test's default width on the 4-vCPU ubuntu-24.04 runner: availableParallelism() - 1. */
export const RUNNER_CONCURRENCY = 3;
export const SHARD_FILES = 'files.txt';
export const SHARD_JUNIT = 'guard-tests.junit.xml';

class CoverageLost extends Error {}

/** The tree's guard suites, repo-relative and sorted — the glob ci.yml used to pass. */
export function listTestFiles(root) {
  const dir = join(root, TEST_DIR_REL);
  if (!existsSync(dir)) throw new CoverageLost(`${TEST_DIR_REL} does not exist under ${root}`);
  const files = listDir(dir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => `${TEST_DIR_REL}/${f}`);
  if (files.length === 0) throw new CoverageLost(`${TEST_DIR_REL} holds no *.test.mjs, so there is no suite to shard`);
  return files;
}

/** The weights document → Map(basename → seconds). */
export function readDurations(root) {
  const p = join(root, DURATIONS_REL);
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CoverageLost(`${DURATIONS_REL} could not be read (${e.message})`);
  }
  const seconds = doc?.seconds;
  if (seconds === null || typeof seconds !== 'object' || Array.isArray(seconds) || Object.keys(seconds).length === 0) {
    throw new CoverageLost(`${DURATIONS_REL} has no \`seconds\` map`);
  }
  const out = new Map();
  for (const [k, v] of Object.entries(seconds)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new CoverageLost(`${DURATIONS_REL} weight for ${k} is not a non-negative number`);
    out.set(k, v);
  }
  return out;
}

/** The finish time of `files` run in sorted order, `width` at a time, each taking weight(f). */
export function makespan(files, weight, width = RUNNER_CONCURRENCY) {
  const slots = new Array(width).fill(0);
  for (const f of [...files].sort()) {
    let min = 0;
    for (let i = 1; i < width; i++) if (slots[i] < slots[min]) min = i;
    slots[min] += weight(f);
  }
  return Math.max(...slots);
}

/**
 * N lists that partition `files`. Heaviest first (ties by name, so the plan is a
 * pure function of its inputs and every runner computes the same one); each goes
 * to the shard whose simulated makespan it raises least, ties to the lighter
 * total, then the lower index.
 */
export function plan(files, durations, shards, width = RUNNER_CONCURRENCY) {
  if (!Number.isInteger(shards) || shards < 1) throw new CoverageLost(`--shards must be a whole number >= 1 (got ${shards})`);
  const known = [...durations.values()].sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (f) => durations.get(basenameOf(f)) ?? median;
  const out = Array.from({ length: shards }, () => ({ files: [], total: 0, span: 0 }));
  const order = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const f of order) {
    let best = -1;
    let bestSpan = Infinity;
    for (let i = 0; i < shards; i++) {
      const span = makespan([...out[i].files, f], weight, width);
      const better = span < bestSpan - 1e-9 || (Math.abs(span - bestSpan) <= 1e-9 && out[i].total < out[best].total);
      if (better) {
        best = i;
        bestSpan = span;
      }
    }
    out[best].files.push(f);
    out[best].total += weight(f);
    out[best].span = bestSpan;
  }
  return out.map((s) => ({ files: [...s.files].sort(), seconds: s.span }));
}

/** Problems with `lists` as a partition of `files`: a file in two lists, a file in none, a file not in the tree. */
export function partitionProblems(files, lists) {
  const problems = [];
  const want = new Set(files);
  const seen = new Map();
  lists.forEach((list, i) => {
    for (const f of list) {
      if (!want.has(f)) problems.push(`shard ${i + 1} names ${f}, which is not a test file of this tree`);
      if (seen.has(f)) problems.push(`${f} is in shard ${seen.get(f) + 1} AND shard ${i + 1}, so it ran twice`);
      else seen.set(f, i);
    }
  });
  for (const f of files) if (!seen.has(f)) problems.push(`${f} is in no shard, so nothing ran it`);
  return problems;
}

/** Repo-relative form of a junit file= path (absolute on the runner that wrote it). */
export function repoRelative(file) {
  const norm = String(file).replace(/\\/g, '/');
  const at = norm.lastIndexOf(`/${TEST_DIR_REL}/`);
  if (at >= 0) return norm.slice(at + 1);
  return norm.startsWith(`${TEST_DIR_REL}/`) ? norm : null;
}

/** The `<testsuites>` body of one junit: everything between its root tags. */
export function junitBody(xml) {
  const text = String(xml);
  const open = text.indexOf('<testsuites');
  const close = text.lastIndexOf('</testsuites>');
  if (open < 0 || close < 0 || close < open) return null;
  const openEnd = text.indexOf('>', open);
  if (openEnd < 0 || openEnd > close) return null;
  return text.slice(openEnd + 1, close);
}

/**
 * Check N shards against the tree and join their junits. `shards` is
 * [{ index, files: [repo-relative], xml }]. Returns { problems, merged }.
 */
export function mergeShards(treeFiles, shards) {
  const problems = partitionProblems(
    treeFiles,
    shards.map((s) => s.files),
  );
  const bodies = [];
  for (const s of shards) {
    const body = junitBody(s.xml);
    if (body === null) {
      problems.push(`shard ${s.index}'s junit is not a <testsuites> document`);
      continue;
    }
    bodies.push(body);
    const { cases } = parseJunitCases(s.xml);
    const ran = new Set();
    for (const c of cases) {
      const rel = repoRelative(c.file);
      if (rel === null) continue;
      ran.add(rel);
    }
    const given = new Set(s.files);
    for (const f of s.files) if (!ran.has(f)) problems.push(`shard ${s.index} was given ${f} and its junit has no <testcase> from it, so it ran nothing`);
    for (const f of ran) if (!given.has(f)) problems.push(`shard ${s.index}'s junit credits ${f}, which shard ${s.index} was not given`);
  }
  const merged = `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>${bodies.join('')}</testsuites>\n`;
  return { problems, merged };
}

/** Every `<testcase …>` opening tag, walked with quote state as parseJunitCases
 *  does, so a `>` inside a test name cannot end the tag. */
function* testcaseTags(xml) {
  const text = String(xml ?? '');
  let i = 0;
  for (;;) {
    const at = text.indexOf('<testcase', i);
    if (at < 0) return;
    let k = at + '<testcase'.length;
    if (k < text.length && !/[\s/>]/.test(text[k])) {
      i = at + 1;
      continue;
    }
    let quote = null;
    for (; k < text.length; k++) {
      const c = text[k];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    yield text.slice(at, k);
    i = k + 1;
  }
}

/** Seconds per test file, summed over every <testcase time="…"> of a junit. */
export function durationsFromJunit(xml) {
  const out = {};
  for (const tag of testcaseTags(xml)) {
    const attrs = {};
    for (const m of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[m[1]] = unescapeXml(m[3] ?? m[4] ?? '');
    const base = basenameOf(attrs.file ?? '');
    const t = Number(attrs.time);
    if (!base || attrs.time === undefined || !Number.isFinite(t)) continue;
    out[base] = (out[base] ?? 0) + t;
  }
  return out;
}

export function serializeDurations(seconds) {
  const sorted = Object.fromEntries(
    Object.entries(seconds)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, Math.round(v * 10) / 10]),
  );
  return `${JSON.stringify(
    {
      _readme:
        'Seconds per guard suite, summed from the junit time= of a green ci.yml run on main. Read by ' +
        'tooling/ci/guard-test-shards.mjs --plan to balance the guard-tests shards; a missing suite weighs ' +
        'the median, so a stale file costs balance and never coverage. Rewrite with ' +
        '`node tooling/ci/guard-test-shards.mjs --write-durations <guard-tests.junit.xml>`.',
      seconds: sorted,
    },
    null,
    2,
  )}\n`;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 1);
}

function intArg(argv, name) {
  const raw = arg(argv, name);
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n)) throw new CoverageLost(`${name} <whole number> is required (got ${raw ?? 'nothing'})`);
  return n;
}

/** Each shard directory under `dir`, keyed by the trailing `-<index>` of its name. */
function readShardDirs(dir, shards) {
  if (!existsSync(dir)) throw new CoverageLost(`--dir ${dir} does not exist, so no shard's results can be read`);
  const found = new Map();
  for (const name of listDir(dir)) {
    const m = /-(\d+)$/.exec(name);
    if (!m) continue;
    const index = Number(m[1]);
    if (found.has(index)) throw new CoverageLost(`two directories under ${dir} claim shard ${index}`);
    found.set(index, join(dir, name));
  }
  const out = [];
  for (let index = 1; index <= shards; index++) {
    const d = found.get(index);
    if (!d) throw new CoverageLost(`shard ${index} of ${shards} left no results under ${dir} (found: ${[...found.keys()].sort().join(', ') || 'none'})`);
    const filesPath = join(d, SHARD_FILES);
    const junitPath = join(d, SHARD_JUNIT);
    if (!existsSync(filesPath) || !existsSync(junitPath)) throw new CoverageLost(`shard ${index}'s ${SHARD_FILES} or ${SHARD_JUNIT} is missing from ${d}`);
    const files = readFileSync(filesPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (files.length === 0) throw new CoverageLost(`shard ${index}'s ${SHARD_FILES} names no file`);
    out.push({ index, files, xml: readFileSync(junitPath, 'utf8') });
  }
  const extra = [...found.keys()].filter((i) => i < 1 || i > shards);
  if (extra.length) throw new CoverageLost(`results for shard(s) ${extra.join(', ')} exist, outside 1..${shards}: --shards does not match the matrix`);
  return out;
}

function main(argv) {
  const root = resolve(arg(argv, '--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const durationsFrom = arg(argv, '--write-durations');
  if (durationsFrom !== undefined) {
    if (!existsSync(durationsFrom)) throw new CoverageLost(`--write-durations ${durationsFrom} does not exist`);
    const seconds = durationsFromJunit(readFileSync(durationsFrom, 'utf8'));
    if (Object.keys(seconds).length === 0) throw new CoverageLost(`${durationsFrom} carries no <testcase> with both file= and time=`);
    writeFileSync(join(root, DURATIONS_REL), serializeDurations(seconds));
    console.log(`ok  ${DURATIONS_REL} — ${Object.keys(seconds).length} suite(s) weighed from ${durationsFrom}`);
    return 0;
  }
  const shards = intArg(argv, '--shards');
  if (shards < 1) throw new CoverageLost(`--shards must be >= 1 (got ${shards})`);
  const files = listTestFiles(root);
  if (argv.includes('--plan')) {
    const shard = intArg(argv, '--shard');
    if (shard < 1 || shard > shards) throw new CoverageLost(`--shard ${shard} is outside 1..${shards}`);
    const lists = plan(files, readDurations(root), shards);
    const problems = partitionProblems(files, lists.map((l) => l.files));
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`);
      console.error('\nguard-test-shards --plan: FAILED — the plan does not run the suite exactly once');
      return 1;
    }
    const mine = lists[shard - 1];
    const out = arg(argv, '--out');
    if (out) writeFileSync(out, `${mine.files.join('\n')}\n`);
    console.error(
      `ok  shard ${shard}/${shards}: ${mine.files.length} of ${files.length} suite(s), simulated ${mine.seconds.toFixed(0)} s ` +
        `(all shards: ${lists.map((l) => `${l.files.length}/${l.seconds.toFixed(0)}s`).join(' · ')})`,
    );
    process.stdout.write(`${mine.files.join('\n')}\n`);
    return 0;
  }
  if (argv.includes('--merge')) {
    const dir = arg(argv, '--dir');
    const out = arg(argv, '--out');
    if (!dir || !out) throw new CoverageLost('--merge needs --dir <shard results> and --out <merged junit>');
    const { problems, merged } = mergeShards(files, readShardDirs(dir, shards));
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`);
      console.error(`\nguard-test-shards --merge: FAILED — ${shards} shard(s) did not run the ${files.length} suite(s) exactly once`);
      return 1;
    }
    writeFileSync(out, merged);
    const { cases } = parseJunitCases(merged);
    console.log(`ok  ${shards} shard(s) ran all ${files.length} suite(s) exactly once — ${cases.length} <testcase>(s) merged into ${out}`);
    return 0;
  }
  throw new CoverageLost('one of --plan, --merge or --write-durations is required');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof CoverageLost)) throw e;
    console.error(`FAIL COVERAGE LOST — ${e.message}`);
    console.error('\nguard-test-shards: FAILED (exit 2 — it could not tell what ran, which is never a pass)');
    process.exitCode = 2;
  }
}
