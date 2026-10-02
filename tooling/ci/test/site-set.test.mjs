// ─────────────────────────────────────────────────────────────────────────────
// site-set.test.mjs — tooling/ci/site-set.mjs reads the site set off sites/
// (O-SITE-SET-HAND-LISTED, rv2-newproduct-017), and refuses the two quiet
// answers: a stray directory (exit 1) and an empty or absent set (exit 2).
//
// Every case is written out by hand, never in a loop (assert-no-loop-cases.mjs).
//
// Run:  node --test tooling/ci/test/site-set.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { siteSet, main } from '../site-set.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'site-set-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

/** A tree holding `files` (`{ rel: text }`). */
function tree(name, files) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** The CLI over `root`: `{ code, out, err }`. */
function cli(root, ...flags) {
  const out = [];
  const err = [];
  const code = main([...flags, root], { log: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('site-set.mjs', () => {
  test('the set is every sites/<dir> with an index.html, _shared and a source package excluded, sorted', () => {
    const root = tree('ok', {
      'sites/zeta/index.html': '<html></html>\n',
      'sites/alpha/index.html': '<html></html>\n',
      'sites/_shared/index.html': '<html></html>\n',
      'sites/layer/package.json': '{}\n',
    });
    assert.deepEqual(siteSet(root), { sites: ['alpha', 'zeta'], strays: [] });
    const r = cli(root, '--emit');
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, 'sites/alpha sites/zeta');
  });

  test('a directory that ships no index.html and is no package is a finding (exit 1), naming it', () => {
    const root = tree('stray', { 'sites/alpha/index.html': '<html></html>\n', 'sites/beta/home.html': '<html></html>\n' });
    const r = cli(root, '--emit');
    assert.equal(r.code, 1);
    assert.match(r.err, /sites\/beta is neither _shared nor a site/);
    assert.equal(r.out, '', 'a refused set must print nothing a shell could pass on');
  });

  test('an empty set is COVERAGE LOST (exit 2)', () => {
    const root = tree('empty', { 'sites/_shared/README.md': 'x\n' });
    const r = cli(root, '--emit');
    assert.equal(r.code, 2);
    assert.match(r.err, /^✗ COVERAGE LOST — sites\/ holds no directory/);
  });

  test('no sites/ at all is COVERAGE LOST (exit 2)', () => {
    const root = tree('none', { 'README.md': 'x\n' });
    assert.equal(cli(root).code, 2);
  });

  test('an unknown flag is COVERAGE LOST (exit 2)', () => {
    assert.equal(main(['--emitt'], { log: () => {}, err: () => {} }), 2);
  });

  test('this repository: both sites ci.yml used to type by hand, and the CLI agrees by path', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling', 'ci', 'site-set.mjs'), '--emit', REPO], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'sites/nikatru sites/rajasekarselvam');
  });
});
