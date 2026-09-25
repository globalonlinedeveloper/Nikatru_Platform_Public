// ─────────────────────────────────────────────────────────────────────────────
// no-generated-line-cites.test.mjs — assert-no-generated-line-cites.mjs must be
// able to FAIL, on each shape, and must refuse a tree it cannot read.
//
// The REAL-TREE red is the rider's own: before tooling/release/submit-play.mjs
// and tooling/ci/assert-stamp-properties.mjs were re-pointed at
// nikatru/owner-queue.json, the guard exited 1 naming exactly those two files.
//
// The generated file's name is assembled at runtime below, so this file carries
// neither shape itself.
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

const GUARD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assert-no-generated-line-cites.mjs');
const GEN = ['OWNER', 'QUEUE'].join('_');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-gen-cites-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
/** A git repository with one tracked text file under each scope root, plus `extra`. */
function tree(extra = {}, { roots = ['apps', 'docs', 'extensions', 'services', 'tooling'], git = true } = {}) {
  const root = join(TMP, `t${seq++}`);
  const files = { ...Object.fromEntries(roots.map((r) => [`${r}/README.md`, `# ${r}\n`])), ...extra };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  if (git) {
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-no-generated-line-cites', () => {
  test('GREEN CONTROL — naming the generated file, and pointing at its source row, passes', () => {
    const r = run(tree({ 'tooling/x.mjs': `// the row lives in nikatru/owner-queue.json; nikatru/${GEN}.md is generated from it\n` }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}no generated-file line cites — 6 tracked text file\(s\) read/);
  });

  test('RED — a LINE cite of the generated file, in a comment, is refused as file:line', () => {
    const r = run(tree({ 'tooling/x.mjs': `const a = 1;\n// see nikatru/${GEN}.md:${470}\n` }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`tooling/x\\.mjs:2 \`${GEN}\\.md:470\` cites a LINE of ${GEN}\\.md`));
  });

  test('RED — an instruction to append a row to the generated file is refused', () => {
    const r = run(tree({ 'tooling/release/y.mjs': `die(['A production release is a human act. Append a row to nikatru/${GEN}.md.']);\n` }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`tooling/release/y\\.mjs:1 \`Append a row to nikatru/${GEN}\\.md\` tells a person to add a row`));
  });

  test('COVERAGE LOST (2) — a tree with no git manifest is not read as clean', () => {
    const r = run(tree({ 'tooling/x.mjs': `// nikatru/${GEN}.md:${12}\n` }, { git: false }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — `git ls-files` returned no tracked file/);
  });

  test('COVERAGE LOST (2) — a scope root that contributes no text file is named, never covered by the others', () => {
    const r = run(tree({}, { roots: ['docs', 'extensions', 'services', 'tooling'] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — no tracked text file was read under apps/);
  });
});
