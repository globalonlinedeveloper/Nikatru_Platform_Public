// ─────────────────────────────────────────────────────────────────────────────
// app-set.test.mjs — tooling/ci/app-set.mjs, the one reader of the workspace app
// set, must be able to REFUSE, and must read the list the lanes read.
//
// The reader moved here from assert-release-lane-generic.mjs on 2026-09-24
// (O-GUARDS-READ-A-HAND-LISTED-APP-SET). Its `--emit-apps` cases stay in
// release-lane-generic.test.mjs, because that alias is what four workflows call;
// these cases grade the module and its CLI directly.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appSet, workspaceApps, nestedIds } from '../app-set.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const CLI = join(CI_DIR, 'app-set.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-appset-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
/** A root whose pubspec.yaml is `body`, or no pubspec at all when `body` is null. */
function root(body) {
  const dir = join(TMP, `r${seq++}`);
  mkdirSync(dir, { recursive: true });
  if (body !== null) writeFileSync(join(dir, 'pubspec.yaml'), body);
  return dir;
}
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout.trim(), out: `${r.stdout}${r.stderr}` };
};

describe('app-set.mjs — the reader', () => {
  test('the real tree: every id is a directory under apps/, and the CLI agrees with the module', () => {
    const set = appSet(REPO);
    assert.ok(Array.isArray(set) && set.length >= 1, `the real workspace yielded ${JSON.stringify(set)}`);
    for (const a of set) assert.equal(a.dir, `apps/${a.id}`);
    const r = cli('--json', REPO);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), set.map((a) => a.id));
  });

  test('packages are members of the workspace and not apps', () => {
    const set = appSet(root('name: x\nworkspace:\n  - packages/core\n  - apps/one\n  - apps/two\n'));
    assert.deepEqual(set, [
      { id: 'one', dir: 'apps/one' },
      { id: 'two', dir: 'apps/two' },
    ]);
  });

  test('a commented-out member is not a member, a quoted one is, and a trailing slash is dropped', () => {
    const got = workspaceApps(root("workspace:\n  # - apps/ghost\n  - 'apps/one/'\n  - \"apps/two\" # note\n\nother: 1\n"));
    assert.deepEqual(got, ['apps/one', 'apps/two']);
  });

  test('the list ends at the next key — a later `- apps/x` is not a member', () => {
    const got = workspaceApps(root('workspace:\n  - apps/one\ndependencies:\n  - apps/notamember\n'));
    assert.deepEqual(got, ['apps/one']);
  });

  test('no pubspec and no `workspace:` block both read as null, not as an empty set', () => {
    assert.equal(appSet(root(null)), null);
    assert.equal(appSet(root('name: x\n')), null);
  });

  test('a nested member is reported by id', () => {
    assert.deepEqual(nestedIds(['apps/one', 'apps/one/inner']), ['one/inner']);
  });
});

describe('app-set.mjs — the CLI refuses rather than printing nothing', () => {
  test('one id per line by default', () => {
    const r = cli(root('workspace:\n  - apps/one\n  - apps/two\n'));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.stdout, 'one\ntwo');
  });

  test('RC1 · a workspace with no apps/ member is COVERAGE LOST (exit 2), naming the pubspec', () => {
    const dir = root('workspace:\n  - packages/core\n');
    const r = cli(dir);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — app-set: .*pubspec\.yaml declares no `workspace:` entry under apps\//);
  });

  test('a root with no pubspec is COVERAGE LOST (exit 2)', () => {
    const r = cli(root(null));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /has no readable `workspace:` block/);
  });

  test('a nested member is COVERAGE LOST (exit 2) — no per-app path can address it', () => {
    const r = cli(root('workspace:\n  - apps/one/inner\n'));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /one\/inner, nested below apps\/<id>/);
  });
});
