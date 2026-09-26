// ─────────────────────────────────────────────────────────────────────────────
// backup-headroom.test.mjs — tooling/scripts/backup-headroom.mjs reads the
// backup's own set table and counts each set the way Get-BackupFiles does.
//
// O-BACKUP-SET-BALLOON-HAS-NO-EARLY-WARNING (2026-09-26). The 10:00 backup
// refuses a set over its `Max` (SET BALLOONED) and the missed beat turns main
// red. This module warns at 80% and refuses at 100% at commit time, and refuses
// a nested checkout under Private research/ at any size.
//
// The ps1 here is a hand-written FIXTURE with the real table's shape
// (fixtures/backup-headroom/backup-offsite.ps1); the trees are built in
// os.tmpdir() and removed after. What these cases cannot prove — that
// `countSet` IS the PowerShell rule — is proven in Private by
// requirements/tooling/test/backup-headroom-parity.test.mjs, which runs the
// real Get-BackupFiles beside it.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBackupSets, resolveSkip, likeToRegExp, endsWithWildcard, countSet, grade, researchIntruders, evaluate,
} from '../../scripts/backup-headroom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..', '..', 'scripts', 'backup-headroom.mjs');
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'backup-headroom', 'backup-offsite.ps1'), 'utf8');

const TMP = mkdtempSync(join(tmpdir(), 'backup-headroom-'));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

let seq = 0;
const put = (path, text = 'x\n') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, 'utf8'); };
/** `n` files named f<k>.txt in `dir`. */
const plant = (dir, n) => { for (let k = 0; k < n; k++) put(join(dir, `f${k}.txt`)); };

/** A workspace the fixture's sets resolve into, every probe present, every
 *  in-anchor set well under its bound. `home` (the USERPROFILE) is OUTSIDE the
 *  anchor and holds a scheduled-tasks directory WITHOUT its probe: probing or
 *  walking it would be COVERAGE LOST. */
function workspace() {
  const base = join(TMP, `ws-${++seq}`);
  const anchor = join(base, 'Claude');
  const repo = join(anchor, 'Projects', 'Nikatru_Fixture_Public');
  const privatePath = join(anchor, 'Projects', 'Nikatru_Fixture_Private');
  const home = join(base, 'home');
  put(join(repo, 'pnpm-workspace.yaml'));
  put(join(repo, '.claude', 'vault.probe'));
  put(join(privatePath, 'runbooks', 'backup-restore.md'));
  put(join(privatePath, 'research', 'notes.md'));
  put(join(anchor, 'Projects', 'rescued-from-archive-fixture', 'rescued.bundle'));
  put(join(anchor, 'nikatru', 'business', 'company-master.md'));
  mkdirSync(join(home, '.claude', 'scheduled-tasks'), { recursive: true });
  return { base, anchor, repo, privatePath, home, ctx: { anchor, repo, privatePath, userProfile: home } };
}
const run = (w, text = FIXTURE) => evaluate({ parsed: parseBackupSets(text), ctx: w.ctx });
const churnSkip = () => resolveSkip('$repoChurnSkip', parseBackupSets(FIXTURE)).patterns;

describe('parseBackupSets — the backup\'s own table, read from its text', () => {
  test('parses the first $jobs table only, and ignores the second', () => {
    const p = parseBackupSets(FIXTURE);
    assert.deepEqual(p.sets.map((s) => s.name),
      ['platform repo', '.claude vault', 'brain', 'rescued archive', 'platform private', 'transcripts', 'scheduled-tasks', 'settings.json']);
    assert.ok(!p.sets.some((s) => s.name === 'git bundles'), 'the git-bundles table was read as a pre-flight set');
    assert.deepEqual(p.churn, ['.git', 'node_modules', 'build', '.dart_tool', 'dist', '.mason', '.worktrees']);
    assert.equal(p.churnSkipKnown, true);
    assert.equal(p.rescueLeaf, 'rescued-from-archive-fixture');
    // The running copy is CRLF (.gitattributes `*.ps1 eol=crlf`) and the tracked one carries a BOM: one parse.
    assert.deepEqual(parseBackupSets('\uFEFF' + FIXTURE.replace(/\r?\n/g, '\r\n')).sets, p.sets);
  });

  test('reads Name, Src, Probe, Max, Skip and ignores Filter, Exclude, Dest', () => {
    const p = parseBackupSets(FIXTURE);
    const byName = new Map(p.sets.map((s) => [s.name, s]));
    const repo = byName.get('platform repo');
    assert.deepEqual({ ...repo, line: undefined }, {
      name: 'platform repo', srcExpr: '$repo', probe: 'pnpm-workspace.yaml', max: 100,
      skipExpr: "(@('*\\.claude\\*') + $repoChurnSkip)", keepExpr: undefined, line: undefined,
    });
    assert.equal(FIXTURE.replace(/\r\n/g, '\n').split('\n')[repo.line - 1].trimStart().startsWith("@{ Name='platform repo'"), true, `line ${repo.line} is not where the entry opens`);
    assert.deepEqual(Object.keys(repo).sort(), ['keepExpr', 'line', 'max', 'name', 'probe', 'skipExpr', 'srcExpr']);
    assert.equal(byName.get('.claude vault').srcExpr, "(Join-Path $repo '.claude')");
    assert.equal(byName.get('.claude vault').skipExpr, undefined, 'Exclude is rclone\'s, not a Skip');
    assert.equal(byName.get('transcripts').max, undefined, 'a set with no Max');
    assert.equal(byName.get('transcripts').probe, 'MEMORY.md', 'a comment inside the Filter array broke the entry');
    assert.equal(byName.get('scheduled-tasks').srcExpr, '"$env:USERPROFILE\\.claude\\scheduled-tasks"');
    assert.equal(byName.get('platform private').skipExpr, '$repoChurnSkip');
  });

  test('a bounded set with an unknown Src expression is exit 2 naming it', () => {
    const w = workspace();
    assert.equal(run(w).code, 0, run(w).lines.join('\n'));
    const r = run(w, FIXTURE.replace('Src=$brainPath;', 'Src=$brainElsewhere;'));
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines[0], /^✗ COVERAGE LOST — backup-headroom: 'brain' \(ps1 line \d+\): its Src `\$brainElsewhere` is not one of the 6 forms/);
  });
});

describe('the Get-BackupFiles rule', () => {
  test('likeToRegExp matches PowerShell -like: * ? [] and case-insensitive', () => {
    assert.equal(likeToRegExp('*\\.git\\*').test('C:\\r\\.git\\HEAD'), true);
    assert.equal(likeToRegExp('*\\.git\\*').test('C:\\r\\.github\\ci.yml'), false);
    assert.equal(likeToRegExp('*\\.git\\*').test('C:\\r\\.git'), false, 'a trailing separator is part of the pattern');
    assert.equal(likeToRegExp('*\\NODE_MODULES\\*').test('c:\\r\\node_modules\\x.js'), true);
    assert.equal(likeToRegExp('a?c').test('abc'), true);
    assert.equal(likeToRegExp('a?c').test('ac'), false);
    assert.equal(likeToRegExp('[a-c]x').test('Bx'), true);
    assert.equal(likeToRegExp('[a-c]x').test('dx'), false);
    assert.equal(likeToRegExp('a`*b').test('a*b'), true, 'a backtick makes the next character literal');
    assert.equal(likeToRegExp('a`*b').test('axb'), false);
    assert.equal(likeToRegExp('a.b').test('axb'), false, 'a regex metacharacter is literal');
    assert.equal(endsWithWildcard('*\\build\\*'), true);
    assert.equal(endsWithWildcard('a`*'), false);
  });

  test('the churn Skip excludes .git, node_modules, build, .dart_tool, dist, .mason, .worktrees at any depth', () => {
    const src = join(TMP, `churn-${++seq}`);
    put(join(src, 'keep.md'));
    put(join(src, 'pkg', 'deep', 'keep.dart'));
    put(join(src, '.git', 'HEAD'));
    put(join(src, 'node_modules', 'x', 'index.js'));
    put(join(src, 'build', 'out.bin'));
    put(join(src, '.dart_tool', 'package_config.json'));
    put(join(src, 'dist', 'app.js'));
    put(join(src, '.mason', 'bricks.json'));
    put(join(src, '.worktrees', 'lane', 'README.md'));
    put(join(src, 'pkg', 'app', 'build', 'deep', 'out.bin'));
    put(join(src, 'pkg', 'app', '.dart_tool', 'x'));
    put(join(src, 'pkg', '.worktrees', 'lane', 'y'));
    put(join(src, 'pkg', 'sub', '.mason', 'z'));
    put(join(src, 'pkg', 'web', 'dist', 'w'));
    put(join(src, 'pkg', 'vendor', '.git', 'config'));
    put(join(src, 'pkg', 'web', 'node_modules', 'm.js'));
    assert.equal(countSet({ src, skip: churnSkip() }), 2);
    assert.equal(countSet({ src, skip: [] }), 14, 'with no Skip only the node_modules pre-filter applies');
  });

  test('a FILE named .git is counted; a DIRECTORY named .git is not', () => {
    const src = join(TMP, `dotgit-${++seq}`);
    put(join(src, 'linked', '.git'), 'gitdir: elsewhere\n');
    put(join(src, 'nested', '.git', 'HEAD'));
    put(join(src, 'nested', '.git', 'objects', 'ab', 'cdef'));
    assert.equal(countSet({ src, skip: churnSkip() }), 1);
  });

  test('worktrees, node_modules and _site are dropped before Skip, as Get-BackupFiles does', () => {
    const src = join(TMP, `pre-${++seq}`);
    put(join(src, 'x', 'worktrees', 'lane', 'a'));
    put(join(src, 'x', 'Node_Modules', 'b'));
    put(join(src, 'x', '_site', 'c'));
    put(join(src, 'x', '.worktrees', 'd'));
    put(join(src, 'x', 'ok.md'));
    // A keep-everything whitelist and no Skip: the three pre-filters still drop theirs,
    // and `.worktrees` (not a pre-filter; only the churn Skip names it) is counted.
    assert.equal(countSet({ src, skip: [], keep: ['*'] }), 2);
    assert.equal(countSet({ src, skip: [], keep: ['*\\ok.md'] }), 1, 'the Keep whitelist keeps only what it names');
  });
});

describe('grades and refusals', () => {
  test('RED CONTROL: a set at 81% of its bound warns, exits 0, and the line starts with ⬜', () => {
    const w = workspace();
    plant(join(w.repo, 'lib'), 80);   // + pnpm-workspace.yaml = 81 of Max 100
    const r = run(w);
    assert.equal(r.code, 0, r.lines.join('\n'));
    const line = r.lines.find((l) => l.includes('platform repo'));
    assert.match(line, /^⬜ warn platform repo {2}81\/100 \(81%\) — at or over 80% of its bound; largest subfolder 'lib' \(80 counted\)$/);
    assert.match(r.lines[0], /^backup-headroom: 5 of 6 bounded set\(s\) graded, 1 warn, 0 refuse, 0 research intruder\(s\)$/);
    assert.deepEqual(grade([{ name: 'n', count: 79, max: 100 }]).map((g) => g.verdict), ['ok']);
  });

  test('a set at 100% of its bound refuses, exit 1, naming the largest subfolder by counted files', () => {
    const w = workspace();
    plant(join(w.repo, 'big'), 60);
    plant(join(w.repo, 'small'), 39);   // + pnpm-workspace.yaml = 100 of Max 100
    plant(join(w.repo, '.git', 'objects'), 150);   // the most RAW files, and none counted
    const r = run(w);
    assert.equal(r.code, 1, r.lines.join('\n'));
    const line = r.lines.find((l) => l.includes('platform repo'));
    assert.match(line, /^✗ REFUSE platform repo {2}100\/100 \(100%\) — at or over its bound; the 10:00 backup throws SET BALLOONED at 101\. Largest subfolder 'big' \(60 counted\): move it to the session scratchpad, or raise the bound deliberately in backup-offsite\.ps1/);
    assert.match(r.lines[0], /1 refuse/);
  });

  test('RED CONTROL: a nested .git directory under research/ refuses at any size', () => {
    const w = workspace();
    const green = run(w);
    assert.equal(green.code, 0, green.lines.join('\n'));
    assert.ok(green.lines.some((l) => /^ {2}ok {3}research\/: no nested \.git or node_modules under /.test(l)));
    put(join(w.privatePath, 'research', 'probe-x', '.git', 'HEAD'));
    const r = run(w);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^✗ REFUSE research\/probe-x\/\.git — a \.git directory under research\/ refuses at any size/.test(l)), r.lines.join('\n'));
    assert.match(r.lines[0], /1 research intruder\(s\)$/);
  });

  test('a .git FILE under research/ refuses (a linked worktree)', () => {
    const w = workspace();
    put(join(w.privatePath, 'research', 'lane', '.git'), 'gitdir: C:/elsewhere/.git/worktrees/lane\n');
    const r = run(w);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^✗ REFUSE research\/lane\/\.git — a \.git file under research\//.test(l)), r.lines.join('\n'));
    assert.deepEqual(researchIntruders(w.privatePath).found, [{ rel: 'research/lane/.git', kind: 'file' }]);
  });

  test('a node_modules under research/ refuses at any size', () => {
    const w = workspace();
    mkdirSync(join(w.privatePath, 'research', 'tool', 'node_modules'), { recursive: true });   // empty: any size
    const r = run(w);
    assert.equal(r.code, 1, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^✗ REFUSE research\/tool\/node_modules — a node_modules directory under research\//.test(l)), r.lines.join('\n'));
  });
});

describe('COVERAGE LOST and what is not walked', () => {
  test('a missing probe file is exit 2 naming the set and the probe', () => {
    const w = workspace();
    const green = run(w);
    assert.equal(green.code, 0, green.lines.join('\n'));
    rmSync(join(w.repo, 'pnpm-workspace.yaml'));
    const r = run(w);
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines[0], /^✗ COVERAGE LOST — backup-headroom: 'platform repo' \(ps1 line \d+\): its probe 'pnpm-workspace\.yaml' is not at .*pnpm-workspace\.yaml, so .*Nikatru_Fixture_Public is not the tree the backup reads$/);
  });

  test('a Src outside the anchor is printed as not walked, by name', () => {
    const w = workspace();
    const r = run(w);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^⬜ not walked: 'scheduled-tasks' \(Max 200\) — its Src .*scheduled-tasks is outside the workspace anchor .*; the backup's own pre-flight still bounds it$/.test(l)), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => l === '  --   transcripts: no bound in the backup; not graded'), r.lines.join('\n'));
    assert.equal(r.sets.some((s) => s.name === 'scheduled-tasks'), false);
  });

  test('zero bounded sets graded is exit 2', () => {
    const w = workspace();
    const onlyOutside = [
      '$jobs = @(',
      "    @{ Name='transcripts';     Src=\"$env:USERPROFILE\\.claude\\projects\"; Probe='MEMORY.md'; Verb='copy' },",
      "    @{ Name='scheduled-tasks'; Src=\"$env:USERPROFILE\\.claude\\scheduled-tasks\"; Probe='driver/SKILL.md'; Max=200 }",
      ')',
      '',
    ].join('\n');
    const r = run(w, onlyOutside);
    assert.equal(r.code, 2, r.lines.join('\n'));
    assert.match(r.lines[0], /^✗ COVERAGE LOST — backup-headroom: zero of 1 bounded set\(s\) lie inside the workspace anchor .*, so nothing was graded$/);
  });

  test('the module never opens a file under a set (source scan)', () => {
    const src = readFileSync(MODULE, 'utf8').replace(/\r\n/g, '\n');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const reads = [...code.matchAll(/\b(readFileSync|openSync|createReadStream|readFile|readSync|open)\s*\(/g)];
    assert.deepEqual(reads.map((m) => m[1]), ['readFileSync'], 'exactly one file read in the module');
    const start = code.indexOf('function readPs1(');
    const end = code.indexOf('\n}\n', start);
    assert.ok(start !== -1 && end !== -1, 'readPs1 is gone');
    assert.ok(reads[0].index > start && reads[0].index < end, 'the one read is not inside readPs1');
    assert.doesNotMatch(code, /node:fs\/promises|from 'fs'/);
  });
});
