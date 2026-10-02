// ─────────────────────────────────────────────────────────────────────────────
// scan-dependencies.test.mjs — the OSV wrapper must be able to FAIL, both ways.
//
// [rv2-security-004, rv2-security-018] A working OSV always flags the canary and a
// healthy tree always reads every lockfile, so the paths that matter most — a
// canary NOT flagged, a lockfile NOT read — cannot be reached with the real binary.
// These cases hand scanDependencies() a fake OSV (`run`) that reads the files the
// wrapper really wrote and answers the way OSV 2.6.0 was measured to answer
// (stderr "Scanned <abs path> file and found N packages", stdout --format json).
// No network. The real binary's run over the real tree is recorded in the commit.
//
// Run:  node --test tooling/ci/test/scan-dependencies.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  CANARIES,
  CoverageLost,
  EXPIRY_WARN_DAYS,
  LOCKFILE_NAMES,
  expiringIgnores,
  ignoredVulnsFrom,
  lockfilesFrom,
  parseArgs,
  parseFindings,
  prChangedFiles,
  prScopeFrom,
  parseScanned,
  relativeTo,
  scanDependencies,
  trackedLockfiles,
} from '../scan-dependencies.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'scan-dependencies.mjs');

let TMP;
let ROOT;
const TRACKED = ['pnpm-lock.yaml', 'pubspec.lock', 'sites/_shared/package-lock.json', 'services/platform/package-lock.json'];
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-osvtest-'));
  ROOT = join(TMP, 'repo');
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'osv-scanner.toml'), '# empty\n');
});
after(() => rmSync(TMP, { recursive: true, force: true }));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const json = (results) => JSON.stringify({ results, experimental_config: {} });
const result = (path, name, version, ecosystem, ids) => ({
  source: { path, type: 'lockfile' },
  packages: [{ package: { name, version, ecosystem }, vulnerabilities: ids.map((id) => ({ id })) }],
});

/** A fake OSV. Canary runs (cwd outside ROOT) read the lockfiles the wrapper wrote
 *  and flag each one that really pins its canary package, unless `canary.miss`
 *  names its format. Tree runs (cwd === ROOT) answer from `tree`. */
function fakeOsv({ canary = {}, tree = {} } = {}) {
  const calls = [];
  const run = (osv, args, cwd) => {
    calls.push({ osv, args, cwd });
    if (resolve(cwd) !== resolve(ROOT)) {
      if (canary.error) return { status: null, stdout: '', stderr: '', error: 'ENOENT' };
      const files = walk(cwd).filter((p) => LOCKFILE_NAMES.has(p.split(sep).pop()));
      const hits = [];
      for (const p of files) {
        const f = p.split(sep).pop();
        const { pkg } = CANARIES.get(f);
        const body = readFileSync(p, 'utf8');
        if (!canary.miss?.includes(f) && body.includes(pkg.name) && body.includes(pkg.version)) {
          hits.push(result(p, pkg.name, pkg.version, 'npm', ['GHSA-canary-0000-0000']));
        }
      }
      const stderr = files.map((p) => `Scanned ${p} file and found 1 package`).join('\n');
      const status = canary.status ?? (hits.length ? 1 : 0);
      return { status, stdout: canary.badJson ? 'not json' : json(hits), stderr, error: null };
    }
    const listed = (tree.lockfiles ?? TRACKED).filter((p) => !(tree.skip ?? []).includes(p));
    const stderr = [
      'Scanning dir .',
      ...listed.map((p) => `Scanned ${join(ROOT, p)} file and found ${(tree.zero ?? []).includes(p) ? 0 : 7} packages`),
      'End status: 1 dirs visited',
    ].join('\n');
    const findings = (tree.findings ?? []).map((f) => result(join(ROOT, f.path), f.name, f.version, 'npm', f.ids));
    const status = tree.status ?? (findings.length ? 1 : 0);
    return { status, stdout: tree.badJson ? '{' : json(findings), stderr, error: null };
  };
  return { run, calls };
}

/** Exit 2 is a THROWN CoverageLost carrying the lines printed before it; folded back to
 *  `{ code: 2, lines }` here so every case reads one shape. */
const scan = (fake, extra = {}) => {
  try {
    return scanDependencies({ root: ROOT, osv: 'osv-fake', lockfiles: TRACKED, run: fake.run, tmp: TMP, ...extra });
  } catch (e) {
    if (e instanceof CoverageLost) return { code: 2, lines: e.lines };
    throw e;
  }
};

describe('scan-dependencies — green control first', () => {
  test('GREEN CONTROL — canary flagged, every lockfile read, no advisory: exit 0', () => {
    const fake = fakeOsv();
    const r = scan(fake);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => l.startsWith(`✓ floor ${TRACKED.length}/${TRACKED.length}`)));
    for (const f of ['pnpm-lock.yaml', 'pubspec.lock', 'package-lock.json']) assert.ok(r.lines.some((l) => l.startsWith(`✓ canary ${f}:`)), f);
    assert.equal(fake.calls.length, 2, 'one canary run, one tree run');
    assert.deepEqual(fake.calls[1].args, ['scan', 'source', '-r', '--config', join(ROOT, 'osv-scanner.toml'), '--format', 'json', '.']);
    assert.deepEqual(fake.calls[0].args, fake.calls[1].args, 'the canary runs with the SAME config as the tree');
  });

  test('the canary is written under the temp dir, never under the repository, and removed afterwards', () => {
    const fake = fakeOsv();
    scan(fake);
    const cwd = resolve(fake.calls[0].cwd);
    assert.ok(!cwd.startsWith(resolve(ROOT)), `the canary ran inside the repo: ${cwd}`);
    assert.equal(existsSync(cwd), false, 'the canary directory was left behind');
  });
});

describe('scan-dependencies — exit 1 is an advisory', () => {
  test('RED CONTROL — a vulnerable package in a tracked lockfile exits 1 and names it', () => {
    const r = scan(fakeOsv({ tree: { findings: [{ path: 'sites/_shared/package-lock.json', name: 'markdown-it', version: '14.3.0', ids: ['GHSA-253c-mchw-3w2r'] }] } }));
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.includes('✗ sites/_shared/package-lock.json: markdown-it@14.3.0 (npm) — GHSA-253c-mchw-3w2r'), r.lines.join('\n'));
  });
});

describe('scan-dependencies — exit 2 is COVERAGE LOST, never a pass', () => {
  const lostOn = (r, re) => {
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines.at(-1), re);
  };

  test('RED CONTROL — the pubspec.lock canary NOT flagged exits 2, even with the tree clean', () => {
    lostOn(scan(fakeOsv({ canary: { miss: ['pubspec.lock'] } })), /the pubspec\.lock canary \(http@0\.13\.0\) was NOT flagged/);
  });

  test('RED CONTROL — the canary run exiting 0 (nothing flagged at all) exits 2', () => {
    lostOn(scan(fakeOsv({ canary: { miss: ['pubspec.lock', 'pnpm-lock.yaml', 'package-lock.json'] } })), /the canary run exited 0, not 1/);
  });

  test('the canary run exiting 127 (OSV failing) exits 2', () => {
    lostOn(scan(fakeOsv({ canary: { status: 127 } })), /the canary run exited 127/);
  });

  test('an OSV that cannot be started exits 2', () => {
    lostOn(scan(fakeOsv({ canary: { error: true } })), /could not start OSV/);
  });

  test('canary JSON that does not parse exits 2', () => {
    lostOn(scan(fakeOsv({ canary: { badJson: true } })), /canary: OSV's --format json output did not parse/);
  });

  test('RED CONTROL — a tracked lockfile OSV did not read breaks the FLOOR: exit 2 naming it', () => {
    lostOn(scan(fakeOsv({ tree: { skip: ['pubspec.lock'] } })), /FLOOR is 4 \(git ls-files\) and OSV read 3 .*Not read: pubspec\.lock\./);
  });

  test('a tracked lockfile read with 0 packages breaks the FLOOR: exit 2', () => {
    lostOn(scan(fakeOsv({ tree: { zero: ['pnpm-lock.yaml'] } })), /Read with 0 packages: pnpm-lock\.yaml\./);
  });

  test('the floor holds even when the tree HAS findings — a missing lockfile beats an advisory (2 beats 1)', () => {
    lostOn(
      scan(fakeOsv({ tree: { skip: ['pubspec.lock'], findings: [{ path: 'pnpm-lock.yaml', name: 'x', version: '1.0.0', ids: ['GHSA-x'] }] } })),
      /Not read: pubspec\.lock/,
    );
  });

  test('the tree run exiting 128 (no packages) or 127 exits 2', () => {
    lostOn(scan(fakeOsv({ tree: { status: 128 } })), /the tree run exited 128/);
    lostOn(scan(fakeOsv({ tree: { status: 127 } })), /the tree run exited 127/);
  });

  test('exit 1 with no finding in the JSON, and exit 0 with one, both exit 2 (the answers disagree)', () => {
    lostOn(scan(fakeOsv({ tree: { status: 1 } })), /OSV exited 1 \(findings\) and its JSON names no vulnerable package/);
    lostOn(scan(fakeOsv({ tree: { status: 0, findings: [{ path: 'pnpm-lock.yaml', name: 'x', version: '1', ids: ['G'] }] } })), /OSV exited 0 \(clean\)/);
  });

  test('tree JSON that does not parse exits 2', () => {
    lostOn(scan(fakeOsv({ tree: { badJson: true } })), /tree: OSV's --format json output did not parse/);
  });

  test('no tracked lockfile at all exits 2 before OSV is asked anything', () => {
    const fake = fakeOsv();
    lostOn(scan(fake, { lockfiles: [] }), /names no lockfile/);
    assert.equal(fake.calls.length, 0);
  });

  test('a tracked lockfile FORMAT with no canary exits 2 before OSV is asked anything', () => {
    const fake = fakeOsv();
    lostOn(scan(fake, { lockfiles: [...TRACKED, 'crates/x/Cargo.lock'] }), /tracks Cargo\.lock and CANARIES has no canary/);
    assert.equal(fake.calls.length, 0);
  });

  test('a missing osv-scanner.toml exits 2 — the explicit --config is not optional', () => {
    lostOn(scan(fakeOsv(), { config: 'nope.toml' }), /nope\.toml does not exist/);
  });
});

// PR #1154 ruling item 4: an ignore WARNS before it expires, so 90 ids expiring on
// one day are not first seen as a red ops-watch page.
describe('scan-dependencies — an osv-scanner.toml ignore warns before it expires', () => {
  const NOW = new Date('2026-10-02T12:00:00Z');
  const toml = (entries) =>
    entries
      .map(([id, until]) => `[[IgnoredVulns]]\nid = "${id}"\n${until ? `ignoreUntil = ${until}\n` : ''}reason = "x" # note`)
      .join('\n\n');
  const withConfig = (text, fn) => {
    writeFileSync(join(ROOT, 'osv-expiry.toml'), text);
    try {
      return fn();
    } finally {
      rmSync(join(ROOT, 'osv-expiry.toml'), { force: true });
    }
  };

  test('RED CONTROL — an ignore expiring in 7 days warns, naming its id and date; the exit code is unchanged', () => {
    const r = withConfig(toml([['GHSA-seven-days-0000', '2026-10-09T00:00:00Z']]), () =>
      scan(fakeOsv(), { config: 'osv-expiry.toml', now: NOW }),
    );
    assert.equal(r.code, 0, 'a warning, never a finding');
    assert.equal(r.expiring.length, 1);
    const line = r.lines.find((l) => l.startsWith('⚠'));
    assert.ok(line, r.lines.join('\n'));
    assert.match(line, /GHSA-seven-days-0000/);
    assert.match(line, /expire on 2026-10-09 \(in 7 days\)/);
  });

  test('GREEN CONTROL — an ignore 30 days out does not warn', () => {
    const r = withConfig(toml([['GHSA-thirty-days-000', '2026-11-01T12:00:00Z']]), () =>
      scan(fakeOsv(), { config: 'osv-expiry.toml', now: NOW }),
    );
    assert.equal(r.code, 0);
    assert.deepEqual(r.expiring, []);
    assert.ok(!r.lines.some((l) => l.startsWith('⚠')), r.lines.join('\n'));
  });

  test('the window edge is EXPIRY_WARN_DAYS (14): 14 days warns, 15 does not; past and undated warn', () => {
    assert.equal(EXPIRY_WARN_DAYS, 14);
    const entries = ignoredVulnsFrom(
      toml([
        ['GHSA-at-14', '2026-10-16T12:00:00Z'],
        ['GHSA-at-15', '2026-10-17T12:00:00Z'],
        ['GHSA-past', '2026-09-30T00:00:00Z'],
        ['GHSA-undated', null],
        ['GHSA-bad-date', 'soon'],
      ]),
    );
    const groups = expiringIgnores(entries, NOW);
    const ids = groups.flatMap((g) => g.ids).sort();
    assert.deepEqual(ids, ['GHSA-at-14', 'GHSA-bad-date', 'GHSA-past', 'GHSA-undated']);
  });

  test('ids sharing one date are ONE warning (the 2026-10-31 cohort)', () => {
    const text = toml(Array.from({ length: 90 }, (_, i) => [`GHSA-cohort-${i}`, '2026-10-31T00:00:00Z']));
    const groups = expiringIgnores(ignoredVulnsFrom(text), new Date('2026-10-24T00:00:00Z'));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].ids.length, 90);
    assert.equal(groups[0].daysLeft, 7);
  });

  test('the REAL osv-scanner.toml parses: every entry has an id and a readable ignoreUntil', () => {
    const entries = ignoredVulnsFrom(readFileSync(join(REPO, 'osv-scanner.toml'), 'utf8'));
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.match(e.id ?? '', /^GHSA-/);
      assert.ok(e.until instanceof Date, `${e.id} has no readable ignoreUntil`);
    }
  });
});

// [rv2-security-004, part 1] The PR gate grades only the lockfiles the PR changed.
// `prDiff` stands in for git: it returns what `git diff --name-only -z` would.
describe('scan-dependencies — a pull request is graded on the lockfiles IT changed', () => {
  const MB = 'b'.repeat(40);
  const HEAD = 'c'.repeat(40);
  const RANGE = `${'a'.repeat(40)}..${HEAD}`;
  const diff = (...paths) => () => ({ from: MB, head: HEAD, diffZ: paths.map((p) => `${p}\0`).join('') });
  const MARKDOWN_IT = { path: 'sites/_shared/package-lock.json', name: 'markdown-it', version: '14.3.0', ids: ['GHSA-253c-mchw-3w2r'] };
  const LINE = 'sites/_shared/package-lock.json: markdown-it@14.3.0 (npm) — GHSA-253c-mchw-3w2r';

  test('RED CONTROL — a PR that bumps a lockfile to a vulnerable version exits 1 and names it', () => {
    const r = scan(fakeOsv({ tree: { findings: [MARKDOWN_IT] } }), { prRange: RANGE, prDiff: diff('sites/_shared/package-lock.json', 'sites/_shared/package.json') });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.includes(`✗ ${LINE}`), r.lines.join('\n'));
    assert.match(r.lines.at(-1), /1 vulnerable package\(s\) in lockfile\(s\) this pull request changed/);
  });

  test('GREEN CONTROL — the SAME advisory in a lockfile the PR did not change exits 0, and is PRINTED', () => {
    const r = scan(fakeOsv({ tree: { findings: [MARKDOWN_IT] } }), { prRange: RANGE, prDiff: diff('apps/x/lib/main.dart', 'pubspec.lock') });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.deferred, 1);
    assert.ok(r.lines.includes(`· not this pull request's: ${LINE}`), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /did not change — printed, not graded here\. ops-watch\.yml's dependency-advisories job grades main daily/.test(l)), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /2 file\(s\) changed, 1 of them lockfile\(s\) \(pubspec\.lock\)/.test(l)), r.lines.join('\n'));
  });

  test('a mix: the changed lockfile\'s advisory fails, the unchanged one is printed beside it', () => {
    const r = scan(fakeOsv({ tree: { findings: [MARKDOWN_IT, { path: 'pnpm-lock.yaml', name: 'qs', version: '6.0.0', ids: ['GHSA-qs'] }] } }), { prRange: RANGE, prDiff: diff('pnpm-lock.yaml') });
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.includes('✗ pnpm-lock.yaml: qs@6.0.0 (npm) — GHSA-qs'));
    assert.ok(r.lines.includes(`· not this pull request's: ${LINE}`));
    assert.ok(!r.lines.includes(`✗ ${LINE}`));
  });

  test('a PR that changes osv-scanner.toml (or this script) is graded on EVERY lockfile', () => {
    for (const p of ['osv-scanner.toml', 'tooling/ci/scan-dependencies.mjs']) {
      const r = scan(fakeOsv({ tree: { findings: [MARKDOWN_IT] } }), { prRange: RANGE, prDiff: diff(p) });
      assert.equal(r.code, 1, `${p}\n${r.lines.join('\n')}`);
      assert.ok(r.lines.some((l) => l.includes(`changes ${p}, so EVERY lockfile is graded`)), r.lines.join('\n'));
    }
  });

  test('the canary and the floor still run in full on a PR — an unchanged lockfile OSV did not read is still exit 2', () => {
    const fake = fakeOsv({ tree: { skip: ['pubspec.lock'] } });
    const r = scan(fake, { prRange: RANGE, prDiff: diff('pnpm-lock.yaml') });
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines.at(-1), /Not read: pubspec\.lock\./);
    assert.equal(fake.calls.length, 2, 'one canary run, one tree run');
    const missed = scan(fakeOsv({ canary: { miss: ['pubspec.lock'] } }), { prRange: RANGE, prDiff: diff('README.md') });
    assert.equal(missed.code, 2, missed.lines.join('\n'));
  });

  test('a range git cannot resolve is COVERAGE LOST before OSV is asked anything', () => {
    const fake = fakeOsv({ tree: { findings: [MARKDOWN_IT] } });
    const r = scan(fake, { prRange: RANGE, prDiff: () => { throw new Error('--pr-range base aaaa is not in this clone'); } });
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines.at(-1), /COVERAGE LOST — --pr-range base aaaa is not in this clone/);
    assert.equal(fake.calls.length, 0);
  });

  test('no prRange (a push, the daily scan of main) grades every lockfile, exactly as before', () => {
    const r = scan(fakeOsv({ tree: { findings: [MARKDOWN_IT] } }));
    assert.equal(r.code, 1);
    assert.ok(r.lines.includes(`✗ ${LINE}`));
    assert.ok(!r.lines.some((l) => l.startsWith('· not this pull request')));
  });

  test('prScopeFrom keeps lockfiles by basename and widens on the config or the script', () => {
    assert.deepEqual([...prScopeFrom('a/package-lock.json\0a/package.json\0x/pubspec.lock\0').lockfiles], ['a/package-lock.json', 'x/pubspec.lock']);
    assert.equal(prScopeFrom('a/package.json\0').all, false);
    assert.equal(prScopeFrom('osv-scanner.toml\0').all, true);
    assert.equal(prScopeFrom('cfg/osv.toml\0', { config: 'cfg/osv.toml' }).all, true, 'a --config elsewhere widens too');
  });

  test('parseArgs reads --pr-range, and refuses one given with no value (an empty event field)', () => {
    assert.equal(parseArgs(['--osv', 'o', '--pr-range', RANGE, '/r']).prRange, RANGE);
    assert.equal(parseArgs(['--osv', 'o']).prRange, null);
    assert.equal(parseArgs(['--osv', 'o', '--pr-range']), null);
    assert.equal(parseArgs(['--osv', 'o', '--pr-range', '']), null);
  });
});

// prChangedFiles against a REAL git repository: main moves on after the PR forks,
// and the PR's range must be merge-base..head, not base..head.
describe('scan-dependencies — prChangedFiles reads merge-base..head from git', () => {
  let G;
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: G, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (files, msg) => {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(join(G, p)), { recursive: true });
      writeFileSync(join(G, p), body);
    }
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  let BASE_TIP;
  let PR_HEAD;
  before(() => {
    G = join(TMP, 'git');
    mkdirSync(G, { recursive: true });
    git('init', '-q', '-b', 'main');
    commit({ 'a/package-lock.json': '{"v":1}\n', 'pubspec.lock': 'v1\n', 'README.md': 'x\n' }, 'root');
    git('checkout', '-q', '-b', 'pr');
    PR_HEAD = commit({ 'a/package-lock.json': '{"v":2}\n', 'a/package.json': '{}\n' }, 'pr bumps a lockfile');
    git('checkout', '-q', 'main');
    BASE_TIP = commit({ 'pubspec.lock': 'v2\n' }, 'main moves on');
  });

  test('the PR\'s own change only — main\'s later lockfile change is not the PR\'s', () => {
    const r = prChangedFiles(G, `${BASE_TIP}..${PR_HEAD}`);
    assert.deepEqual(r.diffZ.split('\0').filter(Boolean).sort(), ['a/package-lock.json', 'a/package.json']);
    assert.deepEqual([...prScopeFrom(r.diffZ).lockfiles], ['a/package-lock.json']);
  });

  test('a malformed or empty range, and a sha not in the clone, each throw (COVERAGE LOST upstream)', () => {
    assert.throws(() => prChangedFiles(G, `..${PR_HEAD}`), /is not <40-hex base>\.\.<40-hex head>/);
    assert.throws(() => prChangedFiles(G, ''), /is not <40-hex base>/);
    assert.throws(() => prChangedFiles(G, `${'d'.repeat(40)}..${PR_HEAD}`), /base d{40} is not in this clone/);
  });
});

describe('scan-dependencies — the parsers', () => {
  test('parseScanned reads OSV 2.6.0\'s line, singular and plural, and nothing else', () => {
    const got = parseScanned([
      'Scanning dir .',
      'Scanned C:\\r\\pnpm-lock.yaml file and found 129 packages',
      'Scanned /r/x/package-lock.json file and found 1 package',
      'Scanned something without a count',
      'End status: 611 dirs visited',
    ].join('\r\n'));
    assert.deepEqual(got, [{ path: 'C:\\r\\pnpm-lock.yaml', packages: 129 }, { path: '/r/x/package-lock.json', packages: 1 }]);
  });

  test('relativeTo maps Windows and POSIX absolute paths, and restores the brick\'s {{/needs_backend}}', () => {
    const win = 'C:\\w\\rv2';
    assert.equal(
      relativeTo(win, 'C:\\w\\rv2\\tooling\\bricks\\app\\__brick__\\{{#needs_backend}}services{{\\needs_backend}}\\{{app_id}}-api\\package-lock.json', { caseless: true }),
      'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package-lock.json',
    );
    assert.equal(relativeTo('/home/r', '/home/r/pubspec.lock', { caseless: false }), 'pubspec.lock');
    assert.equal(relativeTo('/home/r', '/home/rx/pubspec.lock', { caseless: false }), null, 'a sibling with a shared prefix is not inside the root');
  });

  test('parseFindings refuses a document with no results array', () => {
    assert.throws(() => parseFindings('{"foo":1}'), /no `results` array/);
    assert.deepEqual(parseFindings(json([])), []);
  });
});

describe('scan-dependencies — the REAL tree', () => {
  test('every lockfile format the real tree tracks has a canary, and the set is not empty', () => {
    const real = trackedLockfiles(REPO);
    assert.ok(real.length > 0, 'git ls-files found no lockfile in the real tree — this case reads nothing');
    // ⏱ 2026-10-01 · DERIVED, NEVER NAMED. This line used to require `pnpm-lock.yaml` by name, and
    // #1102 retired pnpm the same morning #1095 landed: each PR was green alone and main went red
    // together. The expected set is now a SECOND, independent `git ls-files` read — one pathspec
    // per LOCKFILE_NAMES entry — so a package-manager switch moves both sides at once.
    const byPathspec = spawnSync('git', ['ls-files', '-z', '--', ...[...LOCKFILE_NAMES].flatMap((n) => [n, `**/${n}`])], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(byPathspec.status, 0, byPathspec.stderr);
    assert.deepEqual(real, [...new Set(byPathspec.stdout.split('\0').filter(Boolean))].sort());
    for (const f of new Set(real.map((p) => p.split('/').pop()))) assert.ok(CANARIES.has(f), `the real tree tracks ${f} with no canary`);
  });

  test('lockfilesFrom keeps only lockfile names, matched by basename, not by suffix', () => {
    assert.deepEqual(lockfilesFrom('a/package-lock.json\0b/package-lock.json.fixture\0pubspec.lock\0x/not-pubspec.lock\0'), ['a/package-lock.json', 'pubspec.lock']);
  });

  // .github/dependabot.yml declares the npm and pub directories [rv2-security-004]. Parsed in
  // its one authored shape: `- package-ecosystem: <eco>` blocks, each with a `directories:` list.
  const dependabotDirs = (text) => {
    const out = new Map();
    let eco = null;
    let inDirs = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, '');
      const e = line.match(/^ {2}- package-ecosystem:\s*"?([\w-]+)"?\s*$/);
      if (e) { eco = e[1]; inDirs = false; if (!out.has(eco)) out.set(eco, new Set()); continue; }
      if (/^ {4}directories:\s*$/.test(line)) { inDirs = true; continue; }
      const d = line.match(/^ {6}- "([^"]+)"\s*$/);
      if (inDirs && d && eco) { out.get(eco).add(d[1]); continue; }
      if (/^ {4}\S/.test(line)) inDirs = false;
    }
    return out;
  };
  const TEMPLATE = /^tooling\/bricks\/app\/__brick__\//;
  const expectedDirs = (lockfiles) => {
    const want = new Map([['npm', new Set()], ['pub', new Set()]]);
    for (const p of lockfiles) {
      if (TEMPLATE.test(p)) continue;
      const f = p.split('/').pop();
      const dir = `/${p.split('/').slice(0, -1).join('/')}`;
      if (f === 'pubspec.lock') want.get('pub').add(dir);
      else if (f === 'package-lock.json' || f === 'pnpm-lock.yaml') want.get('npm').add(dir);
    }
    return want;
  };
  const dependabotProblems = (text, lockfiles) => {
    const have = dependabotDirs(text);
    const want = expectedDirs(lockfiles);
    const problems = [];
    for (const [eco, dirs] of want) {
      for (const d of dirs) if (!have.get(eco)?.has(d)) problems.push(`${eco} ${d} holds a tracked lockfile and is not declared`);
      for (const d of have.get(eco) ?? []) if (!dirs.has(d)) problems.push(`${eco} ${d} is declared and holds no tracked lockfile`);
    }
    const blocks = String(text).split(/\n(?= {2}- package-ecosystem:)/).slice(1);
    for (const b of blocks) if (!/\n {4}open-pull-requests-limit: 0\s*(\n|$)/.test(b)) problems.push(`an entry opens version-update PRs (no open-pull-requests-limit: 0): ${b.split('\n')[0].trim()}`);
    if (blocks.length === 0) problems.push('no update entries parsed');
    return problems;
  };

  test('GREEN — .github/dependabot.yml declares exactly the tracked npm and pub lockfile directories, each with no version-update PRs', () => {
    const text = readFileSync(join(REPO, '.github', 'dependabot.yml'), 'utf8');
    const real = trackedLockfiles(REPO);
    assert.ok(dependabotDirs(text).get('npm')?.size > 0 && dependabotDirs(text).get('pub')?.size > 0, 'the parser read no directories — this case would pass on nothing');
    assert.deepEqual(dependabotProblems(text, real), []);
  });

  test('RED — a new lockfile directory, a stale entry and a limit that is not 0 are each refused', () => {
    const text = readFileSync(join(REPO, '.github', 'dependabot.yml'), 'utf8');
    const real = trackedLockfiles(REPO);
    assert.deepEqual(dependabotProblems(text, [...real, 'services/new-api/package-lock.json']), ['npm /services/new-api holds a tracked lockfile and is not declared']);
    assert.deepEqual(dependabotProblems(text, real.filter((p) => p !== 'tooling/wrangler/package-lock.json')), ['npm /tooling/wrangler is declared and holds no tracked lockfile']);
    const opened = text.replace(/(package-ecosystem: pub[\s\S]*?open-pull-requests-limit: )0/, '$15');
    assert.notEqual(opened, text, 'the mutation did not apply');
    assert.deepEqual(dependabotProblems(opened, real), ['an entry opens version-update PRs (no open-pull-requests-limit: 0): - package-ecosystem: pub']);
  });

  // [rv2-security-004 part 3] The PR half of advisory coverage: Renovate reads OSV itself and
  // raises the fix PR outside the weekly window. Pinned so the line cannot leave quietly.
  const renovateOsvProblems = (cfg) => {
    const out = [];
    if (cfg.osvVulnerabilityAlerts !== true) out.push('osvVulnerabilityAlerts is not true');
    if (!(cfg.vulnerabilityAlerts?.schedule ?? []).includes('at any time')) out.push('vulnerabilityAlerts PRs wait for the weekly window');
    if (!/RE-CHECK BY \d{4}-\d{2}-\d{2}/.test([].concat(cfg.vulnerabilityAlerts?.description ?? []).join(' '))) out.push('the experimental option carries no dated re-check');
    return out;
  };
  test('GREEN — renovate.json raises OSV-sourced fix PRs at any time, with a dated re-check; RED when switched off', () => {
    const cfg = JSON.parse(readFileSync(join(REPO, 'renovate.json'), 'utf8'));
    assert.deepEqual(renovateOsvProblems(cfg), []);
    assert.deepEqual(renovateOsvProblems({ ...cfg, osvVulnerabilityAlerts: false }), ['osvVulnerabilityAlerts is not true']);
    assert.deepEqual(renovateOsvProblems({ ...cfg, vulnerabilityAlerts: { ...cfg.vulnerabilityAlerts, schedule: ['on monday'] } }), ['vulnerabilityAlerts PRs wait for the weekly window']);
  });

  test('the CLI: a malformed --pr-range is COVERAGE LOST (exit 2) before OSV is started', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--osv', join(TMP, 'no-such-osv'), '--pr-range', 'nope'], { encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST — --pr-range "nope" is not <40-hex base>\.\.<40-hex head>/);
  });

  // The wiring: without it the scope above is code no gate runs.
  test('GREEN — ci.yml passes --pr-range on pull_request only, and ops-watch grades main in full', () => {
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const calls = ci.split('\n').filter((l) => /node tooling\/ci\/scan-dependencies\.mjs/.test(l) && !/^\s*#/.test(l));
    assert.equal(calls.filter((l) => /--pr-range "\$\{SCAN_BASE\}\.\.\$\{SCAN_HEAD\}"/.test(l)).length, 1, calls.join('\n'));
    assert.equal(calls.filter((l) => !/--pr-range/.test(l)).length, 1, 'the push path runs the scan with no range');
    assert.match(ci, /if \[ "\$SCAN_KIND" = pr \]; then\n\s+node tooling\/ci\/scan-dependencies\.mjs [^\n]*--pr-range/);
    assert.match(ci, /SCAN_KIND: \$\{\{ github\.event_name == 'pull_request' && 'pr' \|\| 'push' \}\}/);
    const ops = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    assert.ok(/node tooling\/ci\/scan-dependencies\.mjs --osv/.test(ops) && !/scan-dependencies\.mjs[^\n]*--pr-range/.test(ops), 'the daily scan of main must grade every lockfile');
  });

  test('the CLI refuses without --osv (exit 2), and an OSV that does not exist is COVERAGE LOST (exit 2)', () => {
    const noArg = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(noArg.status, 2, noArg.stderr);
    assert.match(noArg.stderr, /usage:/);
    const missing = spawnSync(process.execPath, [SCRIPT, '--osv', join(TMP, 'no-such-osv')], { encoding: 'utf8', cwd: REPO });
    assert.equal(missing.status, 2, `${missing.stdout}\n${missing.stderr}`);
    assert.match(missing.stderr, /the canary run could not start OSV/);
  });
});
