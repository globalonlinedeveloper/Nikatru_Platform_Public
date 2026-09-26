// ─────────────────────────────────────────────────────────────────────────────
// gen-issue-forms.test.mjs — tooling/ci/gen-issue-forms.mjs, the generated
// extension dropdown of the two root issue forms (O-NEW-TOOL-IS-A-COPIER-NOT-THE-COMMAND).
//
// Graded here, each case written out by hand:
//   - the real tree is green, and --write changes nothing in it;
//   - an id missing from a form, a stale option, a missing form, a form with no
//     marker pair, and a tree with no tool are each refused with their exit code
//     (1, 1, 2, 2, 2) — RC-F8 is the missing id;
//   - --write adds a new tool's option to both forms, in each form's wording, and
//     --check is green after it;
//   - the walk is the old `find`: a tool.json under templates/ or one level too
//     deep is not a tool.
//
// Run:  node --test tooling/ci/test/gen-issue-forms.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { walkTools, renderForm, missingIds, FORMS, BEGIN, END } from '../gen-issue-forms.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ci', 'gen-issue-forms.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'gen-issue-forms-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const run = (...argv) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let n = 0;
/** A root with the real two forms and the given tools, each `[dir, { id, name }]`. */
function rootWith(tools) {
  const root = join(TMP, 'case-' + (++n));
  mkdirSync(join(root, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  cpSync(join(REPO, '.github', 'ISSUE_TEMPLATE', 'bad-page.yml'), join(root, '.github', 'ISSUE_TEMPLATE', 'bad-page.yml'));
  cpSync(join(REPO, '.github', 'ISSUE_TEMPLATE', 'bug.yml'), join(root, '.github', 'ISSUE_TEMPLATE', 'bug.yml'));
  for (const [dir, t] of tools) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'tool.json'), JSON.stringify(t, null, 2) + '\n');
  }
  return root;
}
const FULLSHOT = ['extensions/Extension/Full_Screen_Shot', { id: 'fullshot', name: 'FullShot' }];
const form = (root, f) => readFileSync(join(root, '.github', 'ISSUE_TEMPLATE', f), 'utf8');

describe('the real tree', () => {
  test('--check is green, graded against at least one tool id', () => {
    const r = run('--check', '--root', REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /graded against [1-9]\d* tool id\(s\)/);
  });
  test('--write on a copy of the real forms and tools changes nothing', () => {
    const root = rootWith([FULLSHOT]);
    const before = form(root, 'bad-page.yml') + form(root, 'bug.yml');
    const r = run('--write', '--root', root);
    assert.equal(r.code, 0, r.out);
    assert.equal(form(root, 'bad-page.yml') + form(root, 'bug.yml'), before);
  });
});

describe('refusals', () => {
  test('RC-F8: an id missing from a form exits 1, naming it', () => {
    const root = rootWith([FULLSHOT]);
    const p = join(root, '.github', 'ISSUE_TEMPLATE', 'bad-page.yml');
    writeFileSync(p, readFileSync(p, 'utf8').replace('        - FullShot (fullshot)\n', ''));
    const r = run('--check', '--root', root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /tool id 'fullshot' is missing from the extension dropdown/);
  });
  test('an option for a tool that no longer exists exits 1 (the region is stale)', () => {
    const root = rootWith([FULLSHOT]);
    const p = join(root, '.github', 'ISSUE_TEMPLATE', 'bug.yml');
    writeFileSync(p, readFileSync(p, 'utf8').replace('        - FullShot extension (fullshot)\n', '        - FullShot extension (fullshot)\n        - Gone extension (gone)\n'));
    const r = run('--check', '--root', root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /generated region differs/);
  });
  test('a missing form exits 2, COVERAGE LOST', () => {
    const root = rootWith([FULLSHOT]);
    rmSync(join(root, '.github', 'ISSUE_TEMPLATE', 'bug.yml'));
    const r = run('--check', '--root', root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — gen-issue-forms: \.github\/ISSUE_TEMPLATE\/bug\.yml does not exist/);
  });
  test('a form with no marker pair exits 2, COVERAGE LOST', () => {
    const root = rootWith([FULLSHOT]);
    const p = join(root, '.github', 'ISSUE_TEMPLATE', 'bad-page.yml');
    writeFileSync(p, readFileSync(p, 'utf8').replace(END + '\n', ''));
    const r = run('--check', '--root', root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no single BEGIN\/END marker pair/);
  });
  test('a tree with no tool exits 2, COVERAGE LOST', () => {
    const root = rootWith([]);
    const r = run('--check', '--root', root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /graded against zero ids/);
  });
  test('a tool.json with no id exits 1, naming the file', () => {
    const root = rootWith([FULLSHOT, ['extensions/Extension/No_Id', { name: 'No Id' }]]);
    const r = run('--check', '--root', root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /extensions\/Extension\/No_Id\/tool\.json: tool\.json has no "id"/);
  });
});

describe('--write', () => {
  test('a new tool gets an option in each form, in that form\'s wording, and --check is then green', () => {
    const root = rootWith([FULLSHOT, ['extensions/Extension/Probe_Tool', { id: 'probetool', name: 'Probe Tool' }]]);
    assert.equal(run('--check', '--root', root).code, 1);
    const w = run('--write', '--root', root);
    assert.equal(w.code, 0, w.out);
    assert.match(form(root, 'bad-page.yml'), /\n {8}- FullShot \(fullshot\)\n {8}- Probe Tool \(probetool\)\n {8}# END GENERATED/);
    assert.match(form(root, 'bug.yml'), /\n {8}- FullShot extension \(fullshot\)\n {8}- Probe Tool extension \(probetool\)\n {8}# END GENERATED/);
    const c = run('--check', '--root', root);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /graded against 2 tool id\(s\)/);
  });
});

describe('the walk is the old find', () => {
  test('a tool.json under templates/ is not a tool', () => {
    const root = rootWith([FULLSHOT, ['extensions/templates/tool', { id: 'skeleton', name: 'SKELETON' }]]);
    assert.deepEqual(walkTools(root).map((t) => t.id), ['fullshot']);
  });
  test('a tool.json one level too deep is not a tool', () => {
    const root = rootWith([FULLSHOT, ['extensions/Extension/Full_Screen_Shot/test/fixture', { id: 'deep', name: 'Deep' }]]);
    assert.deepEqual(walkTools(root).map((t) => t.id), ['fullshot']);
  });
  test('a tool.json one level too shallow is not a tool', () => {
    const root = rootWith([FULLSHOT, ['extensions/Extension', { id: 'shallow', name: 'Shallow' }]]);
    assert.deepEqual(walkTools(root).map((t) => t.id), ['fullshot']);
  });
});

describe('the pure functions', () => {
  test('renderForm refuses a form whose END comes before its BEGIN', () => {
    assert.ok(renderForm(`a\n${END}\n${BEGIN}\nb`, [], FORMS[0].option).lost);
  });
  test('missingIds reads only the marked region', () => {
    const text = `x (fullshot)\n${BEGIN}\n- Other (other)\n${END}\n`;
    assert.deepEqual(missingIds(text, [{ id: 'fullshot', name: 'FullShot' }]), ['fullshot']);
  });
});
