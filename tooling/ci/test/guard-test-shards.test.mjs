// ─────────────────────────────────────────────────────────────────────────────
// guard-test-shards.test.mjs — the guard-tests shards must run the guards' suite
// exactly once between them, and --merge must go red when they did not.
//
// The plan is graded on the REAL tree and the committed weights (it is a pure
// function of both, and ci.yml runs it on them); --merge is graded on fixture
// shard directories laid out the way actions/download-artifact writes them.
//
// Run:  node --test tooling/ci/test/guard-test-shards.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DURATIONS_REL,
  durationsFromJunit,
  junitBody,
  listTestFiles,
  makespan,
  mergeShards,
  partitionProblems,
  plan,
  readDurations,
  repoRelative,
  serializeDurations,
} from '../guard-test-shards.mjs';
import { parseJunitCases, tallyByBasename } from '../assert-case-count-honest.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'guard-test-shards.mjs');
const RUNNER = '/home/runner/work/Nikatru_Platform_Public/Nikatru_Platform_Public';

function cli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

/** A junit as node --test writes it: one <testcase> per name, file= absolute on the runner. */
function junit(cases) {
  const body = cases
    .map(([file, name, time = '0.5']) => `\t<testsuite name="s" tests="1">\n\t\t<testcase name="${name}" time="${time}" classname="s" file="${RUNNER}/${file}"/>\n\t</testsuite>\n`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${body}\t<!-- tests ${cases.length} -->\n</testsuites>\n`;
}

/** A results directory with one `guard-tests-junit-shard-<i>/` per shard, as download-artifact lays it out. */
function shardDir(shards) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-test-shards-'));
  for (const s of shards) {
    const d = join(dir, `guard-tests-junit-shard-${s.index}`);
    mkdirSync(d);
    writeFileSync(join(d, 'files.txt'), `${s.files.join('\n')}\n`);
    writeFileSync(join(d, 'guard-tests.junit.xml'), s.xml);
  }
  return dir;
}

const A = 'tooling/ci/test/a.test.mjs';
const B = 'tooling/ci/test/b.test.mjs';
const C = 'tooling/ci/test/c.test.mjs';

describe('the plan, on the real tree and the committed weights', () => {
  const files = listTestFiles(REPO);
  const durations = readDurations(REPO);

  test('the tree has suites to shard and weights to shard them by', () => {
    assert.ok(files.length > 100, `only ${files.length} suite(s) found under tooling/ci/test`);
    assert.ok(durations.size > 100, `only ${durations.size} weight(s) in ${DURATIONS_REL}`);
  });

  test('every shard count from 1 to 8 partitions the suite: each file in exactly one shard', () => {
    const counts = [1, 2, 3, 4, 5, 6, 7, 8];
    const bad = counts.flatMap((n) => partitionProblems(files, plan(files, durations, n).map((s) => s.files)).map((p) => `N=${n}: ${p}`));
    assert.deepEqual(bad, []);
  });

  test('the plan is a pure function of its inputs: two calls agree, whatever order the files arrive in', () => {
    const one = plan(files, durations, 4);
    const two = plan([...files].reverse(), durations, 4);
    assert.deepEqual(one, two);
  });

  test('the planned worst shard beats node --test-shard round-robin over the same weights', () => {
    const weight = (f) => durations.get(f.split('/').pop()) ?? 1;
    const ours = Math.max(...plan(files, durations, 4).map((s) => s.seconds));
    const robin = Math.max(...[0, 1, 2, 3].map((i) => makespan(files.filter((_, j) => j % 4 === i), weight)));
    assert.ok(ours < robin, `planned worst shard ${ours.toFixed(0)} s is not below round-robin's ${robin.toFixed(0)} s`);
    assert.ok(ours <= (files.reduce((s, f) => s + weight(f), 0) / 12) * 1.25, `planned worst shard ${ours.toFixed(0)} s is over 1.25x the ideal`);
  });

  test('a suite the weights do not name still lands in exactly one shard', () => {
    const extra = [...files, 'tooling/ci/test/zz-brand-new.test.mjs'];
    assert.deepEqual(partitionProblems(extra, plan(extra, durations, 4).map((s) => s.files)), []);
  });

  test('the committed weights are what --write-durations serialises (only the script writes them)', () => {
    const text = readFileSync(join(REPO, DURATIONS_REL), 'utf8');
    assert.equal(text, serializeDurations(JSON.parse(text).seconds));
  });
});

describe('partitionProblems — the three ways N lists fail to be the suite', () => {
  test('a clean partition has no problem', () => {
    assert.deepEqual(partitionProblems([A, B, C], [[A], [B, C]]), []);
  });
  test('a file in two shards ran twice', () => {
    assert.match(partitionProblems([A, B], [[A, B], [B]]).join('\n'), /b\.test\.mjs is in shard 1 AND shard 2/);
  });
  test('a file in no shard ran nowhere', () => {
    assert.match(partitionProblems([A, B, C], [[A], [B]]).join('\n'), /c\.test\.mjs is in no shard/);
  });
  test('a shard naming a file the tree does not have is red', () => {
    assert.match(partitionProblems([A], [[A], ['tooling/ci/test/gone.test.mjs']]).join('\n'), /gone\.test\.mjs, which is not a test file of this tree/);
  });
});

describe('mergeShards — what the shards RAN, not what they were told', () => {
  const s1 = { index: 1, files: [A], xml: junit([[A, 'a1'], [A, 'a2']]) };
  const s2 = { index: 2, files: [B, C], xml: junit([[B, 'b1'], [C, 'c1']]) };

  test('the green control: two shards that ran their files merge into one junit the floor guard can read', () => {
    const { problems, merged } = mergeShards([A, B, C], [s1, s2]);
    assert.deepEqual(problems, []);
    const { counts } = tallyByBasename(parseJunitCases(merged).cases);
    assert.deepEqual(Object.fromEntries(counts), { 'a.test.mjs': 2, 'b.test.mjs': 1, 'c.test.mjs': 1 });
    assert.ok(merged.startsWith('<?xml') && merged.trimEnd().endsWith('</testsuites>'));
  });
  test('a shard whose junit has no case from a file it was given ran nothing of it', () => {
    const silent = { ...s2, xml: junit([[B, 'b1']]) };
    assert.match(mergeShards([A, B, C], [s1, silent]).problems.join('\n'), /shard 2 was given tooling\/ci\/test\/c\.test\.mjs and its junit has no <testcase> from it/);
  });
  test('a junit crediting a file its shard was not given is red', () => {
    const stray = { ...s1, xml: junit([[A, 'a1'], [B, 'b-again']]) };
    assert.match(mergeShards([A, B, C], [stray, s2]).problems.join('\n'), /shard 1's junit credits tooling\/ci\/test\/b\.test\.mjs, which shard 1 was not given/);
  });
  test('a file of the tree that no shard listed is red', () => {
    assert.match(mergeShards([A, B, C, 'tooling/ci/test/d.test.mjs'], [s1, s2]).problems.join('\n'), /d\.test\.mjs is in no shard/);
  });
  test('a junit that is not a <testsuites> document is red', () => {
    assert.match(mergeShards([A, B, C], [s1, { ...s2, xml: 'not xml' }]).problems.join('\n'), /shard 2's junit is not a <testsuites> document/);
  });
});

describe('the junit helpers', () => {
  test('repoRelative strips the runner checkout, and refuses a path outside the suite', () => {
    assert.equal(repoRelative(`${RUNNER}/${A}`), A);
    assert.equal(repoRelative(`C:\\work\\repo\\tooling\\ci\\test\\a.test.mjs`), A);
    assert.equal(repoRelative('/elsewhere/x.test.mjs'), null);
  });
  test('junitBody is the inside of <testsuites>, and null for anything else', () => {
    assert.equal(junitBody('<?xml?>\n<testsuites>X</testsuites>'), 'X');
    assert.equal(junitBody('<testsuite>X</testsuite>'), null);
  });
  test('durationsFromJunit sums time= per suite, and a ">" inside a test name cannot end the tag', () => {
    const xml = junit([[A, 'a &gt; b', '1.25'], [A, 'a2', '0.75'], [B, 'b1', '2']]).replace('name="a &gt; b"', 'name="a > b"');
    assert.deepEqual(durationsFromJunit(xml), { 'a.test.mjs': 2, 'b.test.mjs': 2 });
  });
});

describe('the CLI', () => {
  test('--plan prints one shard of the real tree and writes the same list to --out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-test-shards-plan-'));
    try {
      const out = join(dir, 'files.txt');
      const r = cli(['--plan', '--shards', '4', '--shard', '2', '--out', out]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, readFileSync(out, 'utf8'));
      assert.match(r.stderr, /^ok {2}shard 2\/4: \d+ of \d+ suite\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('--shard outside 1..N is COVERAGE LOST, not an empty shard that passes', () => {
    const r = cli(['--plan', '--shards', '4', '--shard', '5']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--shard 5 is outside 1\.\.4/);
  });
  test('an empty suite directory is COVERAGE LOST', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-test-shards-empty-'));
    try {
      mkdirSync(join(root, 'tooling', 'ci', 'test'), { recursive: true });
      const r = cli(['--plan', '--shards', '2', '--shard', '1', '--root', root]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /holds no \*\.test\.mjs/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('--merge with a shard missing is COVERAGE LOST, and with every shard present it writes the merged junit', () => {
    const files = listTestFiles(REPO);
    const lists = plan(files, readDurations(REPO), 2);
    const shards = lists.map((l, i) => ({ index: i + 1, files: l.files, xml: junit(l.files.map((f) => [f, 'case'])) }));
    const whole = shardDir(shards);
    const half = shardDir(shards.slice(0, 1));
    try {
      const out = join(whole, 'merged.xml');
      const ok = cli(['--merge', '--shards', '2', '--dir', whole, '--out', out]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(parseJunitCases(readFileSync(out, 'utf8')).cases.length, files.length);
      const lost = cli(['--merge', '--shards', '2', '--dir', half, '--out', join(half, 'merged.xml')]);
      assert.equal(lost.status, 2);
      assert.match(lost.stderr, /shard 2 of 2 left no results/);
    } finally {
      rmSync(whole, { recursive: true, force: true });
      rmSync(half, { recursive: true, force: true });
    }
  });
  test('--merge over shards that skipped a file of the tree is a finding (exit 1)', () => {
    const files = listTestFiles(REPO);
    const lists = plan(files, readDurations(REPO), 2);
    const shards = lists.map((l, i) => ({ index: i + 1, files: l.files, xml: junit(l.files.map((f) => [f, 'case'])) }));
    shards[1] = { ...shards[1], files: shards[1].files.slice(1), xml: junit(shards[1].files.slice(1).map((f) => [f, 'case'])) };
    const dir = shardDir(shards);
    try {
      const r = cli(['--merge', '--shards', '2', '--dir', dir, '--out', join(dir, 'merged.xml')]);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes(`${lists[1].files[0]} is in no shard`), r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ci.yml runs the plan it was tested against', () => {
  const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
  test('the matrix holds shards 1..N, and the plan and the merge both say N', () => {
    const matrix = /\n {8}shard: \[([\d, ]+)\]/.exec(ci);
    assert.ok(matrix, 'ci.yml guard-tests has no `shard: [...]` matrix');
    const shards = matrix[1].split(',').map((s) => Number(s.trim()));
    assert.deepEqual(shards, shards.map((_, i) => i + 1), 'the matrix is not 1..N');
    const said = [...ci.matchAll(/guard-test-shards\.mjs --(?:plan|merge) --shards (\d+)/g)].map((m) => Number(m[1]));
    assert.equal(said.length, 2, 'ci.yml should run guard-test-shards.mjs --plan once and --merge once');
    assert.deepEqual(said, [shards.length, shards.length]);
  });
});
