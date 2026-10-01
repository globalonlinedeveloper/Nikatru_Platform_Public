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
  LOCKFILE_NAMES,
  lockfilesFrom,
  parseFindings,
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

  test('the CLI refuses without --osv (exit 2), and an OSV that does not exist is COVERAGE LOST (exit 2)', () => {
    const noArg = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(noArg.status, 2, noArg.stderr);
    assert.match(noArg.stderr, /usage:/);
    const missing = spawnSync(process.execPath, [SCRIPT, '--osv', join(TMP, 'no-such-osv')], { encoding: 'utf8', cwd: REPO });
    assert.equal(missing.status, 2, `${missing.stdout}\n${missing.stderr}`);
    assert.match(missing.stderr, /the canary run could not start OSV/);
  });
});
