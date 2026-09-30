// ─────────────────────────────────────────────────────────────────────────────
// scan-secrets.test.mjs — the RANGE limb of tooling/ci/scan-secrets.mjs. [rv2 A-1]
//
// The tree-only scan (`--no-git`) cannot see a secret a PR adds in one commit and
// removes in the next: by the time CI looks, the tree is clean and the key is in
// the pushed history for good. These cases build a REAL git repository per
// fixture, so the range the guard resolves, the ancestry it checks and the
// commits the stub reads are git's own answers, not a mock's.
//
// The stub scanner parses the REAL .gitleaks.toml, as guards.test.mjs's HONEST
// stub does (a hand-typed shape list drifted from the config on 2026-08-05), and
// adds gitleaks' git mode: without `--no-git` it reads `git log -p` over the
// `--log-opts` range and applies the rules to ADDED lines only. The tree-scan
// cases stay in guards.test.mjs's `scan-secrets` describe; this file is the
// history half.
//
// Run:  node --test tooling/ci/test/scan-secrets.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'scan-secrets.mjs');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-scan-history-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** A nikatru-shaped Cloudflare token, ASSEMBLED AT RUNTIME: written literally,
 *  this test file would be a finding in the real tree scan (scan-secrets.mjs's
 *  canary block documents the same trap). */
const LEAK = `CLOUDFLARE_API_TOKEN=${'cfut'}${'_'}${'Qp3'.repeat(16)}\n`;

/** HONEST plus git mode. Derived from the real config, never a shape list. */
const STUB = String.raw`
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-stub'); process.exit(0); }
const src = a[a.indexOf('--source') + 1];
const cfg = readFileSync(a[a.indexOf('--config') + 1], 'utf8');
const reportIdx = a.indexOf('--report-path');
const reportPath = reportIdx === -1 ? null : a[reportIdx + 1];
const RULES = [];
let cur = null, inAllow = false;
for (const raw of cfg.split(/\r?\n/)) {
  const line = raw.trim();
  if (line === '[[rules]]') { cur = { id: null, re: null, group: 0, allow: [] }; RULES.push(cur); inAllow = false; continue; }
  if (line === '[rules.allowlist]') { inAllow = true; continue; }
  if (!cur) continue;
  let m;
  if ((m = line.match(/^id = "(.+)"$/))) { cur.id = m[1]; continue; }
  if ((m = line.match(/^secretGroup = (\d+)$/))) { cur.group = Number(m[1]); continue; }
  if ((m = line.match(/^regex = '''(.*)'''$/))) { if (!inAllow) cur.re = m[1]; continue; }
  if ((m = line.match(/^regexes = \[(.*)\]$/))) {
    if (inAllow) for (const r of m[1].split(/''',\s*'''/)) cur.allow.push(r.replace(/'''/g, ''));
    continue;
  }
}
if (/useDefault\s*=\s*true/.test(cfg)) RULES.unshift({ id: 'private-key', re: 'BEGIN RSA PRIVATE KEY', group: 0, allow: [] });
const findings = [];
const match = (text, file, commit) => {
  for (const r of RULES) {
    if (!r.re || !r.id) continue;
    let re;
    try { re = new RegExp(r.re, 'g'); } catch { continue; }
    for (const hit of text.matchAll(re)) {
      const secret = r.group ? hit[r.group] : hit[0];
      if (secret === undefined) continue;
      if (r.allow.some((p) => { try { return new RegExp(p).test(secret); } catch { return false; } })) continue;
      findings.push({ RuleID: r.id, File: file, StartLine: 1, Commit: commit, Description: r.id });
    }
  }
};
const logOpts = a.find((x) => x.startsWith('--log-opts='));
if (!a.includes('--no-git') && !process.env.STUB_TREE_ONLY) {
  // git mode: the ADDED lines of every commit in the range.
  const range = logOpts ? logOpts.slice('--log-opts='.length) : '--all';
  const log = spawnSync('git', ['-C', src, 'log', '-p', '-U0', '--format=%x00commit %H', range], { encoding: 'utf8' });
  if (log.status !== 0) { console.error(log.stderr); process.exit(126); }
  let commit = null, file = null, commits = 0;
  for (const line of log.stdout.split('\n')) {
    if (line.startsWith('\u0000commit ')) { commit = line.slice(8); commits++; continue; }
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (line.startsWith('+')) match(line.slice(1), file, commit);
  }
  if (reportPath) writeFileSync(reportPath, JSON.stringify(findings));
  console.error('INF ' + (process.env.STUB_COMMITS_READ ?? commits) + ' commits scanned.');
} else {
  const walk = (d) => readdirSync(d).flatMap((e) => {
    if (e === '.git') return [];
    const p = join(d, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  let bytes = 0;
  for (const f of walk(src)) {
    const t = readFileSync(f, 'utf8');
    bytes += Buffer.byteLength(t);
    match(t, f, '');
  }
  if (reportPath) writeFileSync(reportPath, JSON.stringify(findings));
  console.error('INF scanned ~' + bytes + ' bytes (' + bytes + ') in 1ms');
}
process.exit(findings.length ? 1 : 0);
`;

const gitIn = (dir) => (...args) => {
  const r = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A git repository carrying the four marker directories and the REAL
 *  .gitleaks.toml, with one base commit. Returns helpers to grow its history. */
function repo(name) {
  const dir = join(ROOT, name, 'repo');
  const files = {
    'README.md': 'nothing secret here\n',
    '.github/workflows/ci.yml': 'name: ci\n',
    'tooling/ci/placeholder.mjs': '// guard\n',
    'packages/.keep': '',
    'apps/.keep': '',
    '.gitleaks.toml': readFileSync(join(REPO_ROOT, '.gitleaks.toml'), 'utf8'),
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const stub = join(ROOT, name, 'bin', 'stub.mjs');
  mkdirSync(dirname(stub), { recursive: true });
  writeFileSync(stub, STUB);
  const g = gitIn(dir);
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '--no-verify', '-m', 'base');
  const commit = (rel, body, msg) => {
    if (body === null) rmSync(join(dir, rel));
    else {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    g('add', '-A');
    g('commit', '-q', '--no-verify', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  return { dir, stub, g, commit, head: () => g('rev-parse', 'HEAD') };
}

function scan(r, extra = [], env = {}) {
  const out = spawnSync(process.execPath, [GUARD, r.dir, '--gitleaks', r.stub, ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: out.status, out: `${out.stdout ?? ''}${out.stderr ?? ''}` };
}

describe('scan-secrets — the range limb', () => {
  test('RED CONTROL: a key added in commit 1 and removed in commit 2 — the tree scan passes, the range scan FAILS', () => {
    const r = repo('add-then-remove');
    const base = r.head();
    r.commit('config/cf.env', LEAK, 'add a key');
    const head = r.commit('config/cf.env', null, 'remove it again');

    // The tree-only scan — the whole of CI's secret scan until this limb — is
    // clean over this repository, and says it read the tree only.
    const tree = scan(r);
    assert.equal(tree.code, 0, tree.out);
    assert.match(tree.out, /no findings in the working tree/);
    assert.match(tree.out, /history not scanned — no --range given/);

    const hist = scan(r, ['--range', `${base}..${head}`, '--range-kind', 'pr']);
    assert.equal(hist.code, 1, hist.out);
    assert.match(hist.out, /history self-test — a key added then removed inside a range is still detected/);
    assert.match(hist.out, /found something in the history of/);
    assert.match(hist.out, /config\/cf\.env:1 {2}rule=nikatru-cloudflare-api-token/);
    assert.doesNotMatch(hist.out, /ok {2}history scan/);
  });

  test('PASSES a clean range, and says how many commits it covered', () => {
    const r = repo('clean');
    const base = r.head();
    r.commit('docs/a.md', 'one\n', 'one');
    const head = r.commit('docs/b.md', 'two\n', 'two');
    const { code, out } = scan(r, ['--range', `${base}..${head}`]);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}history self-test/);
    assert.match(out, /ok {2}history scan — no findings in [0-9a-f]{12}\.\.[0-9a-f]{12} \(2 commit\(s\) in range, 2 commit\(s\) read\)/);
  });

  test('a PR range scans merge-base..head, so a base branch that moved on still finds the leak', () => {
    const r = repo('pr-base-moved');
    const fork = r.head();
    r.g('checkout', '-q', '-b', 'feature');
    r.commit('config/cf.env', LEAK, 'add a key');
    const head = r.commit('config/cf.env', null, 'remove it');
    r.g('checkout', '-q', 'main');
    const baseTip = r.commit('docs/moved.md', 'main moved on\n', 'main moves');
    assert.notEqual(baseTip, fork);

    const pr = scan(r, ['--range', `${baseTip}..${head}`, '--range-kind', 'pr']);
    assert.equal(pr.code, 1, pr.out);
    assert.match(pr.out, new RegExp(`history of ${fork}\\.\\.${head}`));
    // The same spec as a PUSH is a rewritten history: the base tip is not an
    // ancestor of head, so before..after is not "the pushed commits".
    const push = scan(r, ['--range', `${baseTip}..${head}`, '--range-kind', 'push']);
    assert.equal(push.code, 2, push.out);
  });

  test('RED CONTROL: a rewritten event.before (force-push) is COVERAGE LOST, not a pass', () => {
    const r = repo('force-push');
    r.commit('docs/x.md', 'x\n', 'x');
    const before = r.commit('config/cf.env', LEAK, 'the pushed commit that leaked');
    r.g('reset', '-q', '--hard', 'HEAD~1');
    const after = r.commit('docs/y.md', 'y\n', 'the force-pushed replacement');
    const { code, out } = scan(r, ['--range', `${before}..${after}`]);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — --range .*\(push\): event\.before [0-9a-f]{40} is not an ancestor/);
    assert.match(out, /REWROTE history/);
    assert.doesNotMatch(out, /ok {2}history scan/);
  });

  test('an event.before that is not in the clone at all is COVERAGE LOST', () => {
    const r = repo('before-absent');
    const after = r.commit('docs/x.md', 'x\n', 'x');
    const { code, out } = scan(r, ['--range', `${'ab'.repeat(20)}..${after}`]);
    assert.equal(code, 2, out);
    assert.match(out, /is not in this clone\. A force-push REWROTE history/);
  });

  test('an EMPTY event field (`..<head>`) is COVERAGE LOST, not git\'s empty HEAD..<head>', () => {
    const r = repo('empty-before');
    const after = r.commit('docs/x.md', 'x\n', 'x');
    const { code, out } = scan(r, ['--range', `..${after}`]);
    assert.equal(code, 2, out);
    assert.match(out, /not <40-hex base>\.\.<40-hex head>/);
  });

  test('`--range` with its value word-split away is COVERAGE LOST, not "no range requested"', () => {
    const r = repo('range-no-value');
    const { code, out } = scan(r, ['--range']);
    assert.equal(code, 2, out);
    assert.doesNotMatch(out, /history not scanned/);
  });

  test('the all-zero before of a ref-creating push is COVERAGE LOST', () => {
    const r = repo('zero-before');
    const after = r.commit('docs/x.md', 'x\n', 'x');
    const { code, out } = scan(r, ['--range', `${'0'.repeat(40)}..${after}`]);
    assert.equal(code, 2, out);
    assert.match(out, /all-zero SHA/);
  });

  test('an EMPTY range (base == head) is COVERAGE LOST — it reads nothing and would exit 0', () => {
    const r = repo('empty-range');
    const head = r.commit('docs/x.md', 'x\n', 'x');
    const { code, out } = scan(r, ['--range', `${head}..${head}`]);
    assert.equal(code, 2, out);
    assert.match(out, /holds 0 commits/);
  });

  test('a scanner that reports 0 commits read over a non-empty range is COVERAGE LOST', () => {
    const r = repo('zero-read');
    const base = r.head();
    const head = r.commit('docs/x.md', 'x\n', 'x');
    // Only the REAL range's log line is rewritten to zero; the self-test's
    // fixture range still reads its three commits and still finds its key.
    const { code, out } = scan(r, ['--range', `${base}..${head}`], { STUB_COMMITS_READ: '0' });
    assert.equal(code, 2, out);
    assert.match(out, /scanned 0 commits of/);
  });

  test('RED CONTROL: a scanner whose git mode reads only the tree FAILS the history self-test', () => {
    // `--no-git` creeping back into the history invocation, or a gitleaks
    // release whose git mode stopped reading `--log-opts`: the scan still runs,
    // still exits 0 — and the self-test is the only thing that can tell.
    const r = repo('tree-only-scanner');
    const base = r.head();
    const head = r.commit('docs/x.md', 'x\n', 'x');
    const { code, out } = scan(r, ['--range', `${base}..${head}`], { STUB_TREE_ONLY: '1' });
    assert.equal(code, 1, out);
    assert.match(out, /SELF-TEST FAILED — a "nikatru-cloudflare-api-token" key added in one commit and removed in the next/);
  });

  test('the --range value is never read as the positional repoRoot', () => {
    // Same off-by-one class as the --gitleaks one (corpus triage 2026-08-01,
    // #28): put the flags FIRST and the root last.
    const r = repo('flag-order');
    const base = r.head();
    const head = r.commit('docs/x.md', 'x\n', 'x');
    const out = spawnSync(
      process.execPath,
      [GUARD, '--range', `${base}..${head}`, '--range-kind', 'push', '--gitleaks', r.stub, r.dir],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
    assert.match(out.stdout, new RegExp(`under ${r.dir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')};`));
  });
});
