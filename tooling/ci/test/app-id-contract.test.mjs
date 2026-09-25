// ─────────────────────────────────────────────────────────────────────────────
// app-id-contract.test.mjs — contracts/app-id and assert-app-id-contract.mjs
// must be able to FAIL.
//
// Row O-APP-ID-FORM-UNVALIDATED, limb (a). Cases 1-5 hold the rule itself;
// case 6 holds the generated JSON; cases 7-13 hold the guard, one limb at a
// time, each against a COPY of the real files it reads with exactly one thing
// broken. Every red case asserts the guard's own message, not only its exit
// code: `habit_tracker` already exited 1 in provision-backend.mjs before the
// contract existed, for an unrelated reason.
//
// Run:  node --test tooling/ci/test/app-id-contract.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appIdProblems } from '../../../contracts/app-id/app-id.js';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-app-id-contract.mjs');

/** Every file the guard reads, plus what the contract needs to import and run. */
const FILES = [
  'contracts/package.json',
  'contracts/app-id/app-id.js',
  'contracts/app-id/app-id.json',
  'contracts/app-id/generate.mjs',
  'services/platform/src/config.ts',
  'tooling/scripts/provision-backend.mjs',
  'tooling/ci/assert-store-identity.mjs',
  'tooling/ci/assert-catalog-contract.mjs',
  'tooling/bricks/app/hooks/pre_gen.dart',
  'tooling/app-yaml/schema/app.schema.json',
  'tooling/app-yaml/schema/privacy.schema.json',
  'contracts/release.schema.json',
];

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-appid-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A copy of the real files. `edit` maps a path to a function of its text;
 *  `drop` lists paths left out. */
function fixture({ edit = {}, drop = [] } = {}) {
  const root = join(TMP, `f${seq++}`);
  for (const rel of FILES) {
    if (drop.includes(rel)) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    copyFileSync(join(REPO, rel), abs);
    if (edit[rel]) {
      const before = readFileSync(abs, 'utf8');
      const after = edit[rel](before);
      assert.notEqual(after, before, `the fixture edit to ${rel} changed nothing`);
      writeFileSync(abs, after);
    }
  }
  return root;
}

const node = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const run = (root) => node([GUARD, root]);

describe('contracts/app-id — the rule', () => {
  test('accepts subscriptiontracker, probe, probeapi and ab', () => {
    assert.deepEqual(appIdProblems('subscriptiontracker'), []);
    assert.deepEqual(appIdProblems('probe'), []);
    assert.deepEqual(appIdProblems('probeapi'), []);
    assert.deepEqual(appIdProblems('ab'), []);
  });

  test('refuses habit_tracker, naming the underscore', () => {
    const p = appIdProblems('habit_tracker');
    assert.equal(p.length, 1, p.join('\n'));
    assert.match(p[0], /app id "habit_tracker" breaks the pattern \^\[a-z\]\[a-z0-9\]\*\$ \(contracts\/app-id\): it contains "_"/);
  });

  test('refuses habit-tracker, 1app, Habit and a', () => {
    assert.match(appIdProblems('habit-tracker').join('\n'), /it contains "-"/);
    assert.match(appIdProblems('1app').join('\n'), /it starts with "1", not a lowercase letter/);
    assert.match(appIdProblems('Habit').join('\n'), /it starts with "H", not a lowercase letter/);
    assert.match(appIdProblems('a').join('\n'), /app id "a" is 1 character\(s\); the minimum is 2 \(contracts\/app-id\)/);
  });

  test('accepts 32 characters and refuses 33', () => {
    const at32 = `a${'b'.repeat(31)}`;
    const at33 = `a${'b'.repeat(32)}`;
    assert.equal(at32.length, 32);
    assert.deepEqual(appIdProblems(at32), []);
    assert.match(appIdProblems(at33).join('\n'), /is 33 characters; the maximum is 32 \(contracts\/app-id\)/);
    assert.match(appIdProblems(at33).join('\n'), /APP_ID_PATTERN drops a longer id/);
  });

  test('refuses a reserved word (class)', () => {
    assert.match(appIdProblems('class').join('\n'), /app id "class" is a reserved word in Dart, Java or Kotlin \(contracts\/app-id\)/);
  });

  test('generate --check exits 1 on a hand-edited app-id.json and writes nothing', () => {
    const root = fixture({
      edit: { 'contracts/app-id/app-id.json': (t) => t.replace('"maxLength": 32', '"maxLength": 40') },
    });
    const json = join(root, 'contracts/app-id/app-id.json');
    const before = readFileSync(json, 'utf8');
    const { code, out } = node([join(root, 'contracts/app-id/generate.mjs'), '--check']);
    assert.equal(code, 1, out);
    assert.match(out, /contracts\/app-id\/app-id\.json does not match what app-id\.js would generate/);
    assert.equal(readFileSync(json, 'utf8'), before, '--check rewrote the file it was checking');
  });
});

describe('assert-app-id-contract', () => {
  test('the guard is green on the real tree', () => {
    const { code, out } = node([GUARD]);
    assert.equal(code, 0, out);
    assert.match(out, /✓ assert-app-id-contract — contracts\/app-id\/app-id\.js is the one app-id rule/);
    assert.match(out, /limb 1 · contracts\/app-id\/app-id\.json is what generate\.mjs writes/);
    assert.match(out, /limb 2 · services\/platform\/src\/config\.ts APP_ID_PATTERN .* accepts all \d+ sampled id\(s\)/);
    assert.match(out, /limb 3 · 4 caller\(s\) use the contract/);
    assert.match(out, /limb 4 · tooling\/app-yaml\/schema\/app\.schema\.json properties\.id accepts none/);
    assert.match(out, /limb 4 · tooling\/app-yaml\/schema\/privacy\.schema\.json properties\.app accepts none/);
    assert.match(out, /limb 4 · contracts\/release\.schema\.json properties\.unit accepts none/);
  });

  test("the guard exits 1 when the contract's max exceeds APP_ID_PATTERN", () => {
    const root = fixture({
      edit: { 'contracts/app-id/app-id.js': (t) => t.replace('maxLength: 32,', 'maxLength: 40,') },
    });
    // Regenerate the copy's JSON, so limb 2 is the only limb with anything to say.
    const gen = node([join(root, 'contracts/app-id/generate.mjs')]);
    assert.equal(gen.code, 0, gen.out);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb 2 — services\/platform\/src\/config\.ts APP_ID_PATTERN .* refuses 8 id\(s\) the contract accepts, first "a[a-z0-9]{32}" \(33 characters\): the Worker would drop/);
    assert.doesNotMatch(out, /limb 1 —/);
  });

  test('the guard exits 1 when pre_gen carries its own app-id regex', () => {
    const root = fixture({
      edit: {
        // A replacer FUNCTION: in a replacement string, `$'` means "the rest of the input".
        'tooling/bricks/app/hooks/pre_gen.dart': (t) =>
          t.replace(
            'final _AppIdContract idRule = _readAppIdContract();',
            () => "final _AppIdContract idRule = _readAppIdContract();\n  final bool oldRule = RegExp(r'^[a-z][a-z0-9_]*$').hasMatch(appId);",
          ),
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb 3 — tooling\/bricks\/app\/hooks\/pre_gen\.dart:\d+ carries its own app-id regex \(RegExp\(r'\^\[a-z\]\[a-z0-9_\]\*\$'\)/);
  });

  test('the guard exits 1 when a caller stops importing the contract', () => {
    const root = fixture({
      edit: {
        'tooling/scripts/provision-backend.mjs': (t) => t.replace("import { appIdProblems } from '../../contracts/app-id/app-id.js';\n", ''),
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb 3 — tooling\/scripts\/provision-backend\.mjs does not import appIdProblems from '\.\.\/\.\.\/contracts\/app-id\/app-id\.js'/);
  });

  test('the guard exits 2 when a caller file is missing', () => {
    const root = fixture({ drop: ['tooling/ci/assert-store-identity.mjs'] });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/ci\/assert-store-identity\.mjs is not present under/);
  });

  test('the guard exits 1 when app.schema.json allows more than the contract', () => {
    const root = fixture({
      edit: {
        'tooling/app-yaml/schema/app.schema.json': (t) => {
          const doc = JSON.parse(t);
          doc.properties.id.maxLength = 40;
          return `${JSON.stringify(doc, null, 2)}\n`;
        },
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb 4 — tooling\/app-yaml\/schema\/app\.schema\.json properties\.id accepts 8 id\(s\) the contract refuses, first "a[a-z0-9]{32}" \(33 characters\)/);
    assert.doesNotMatch(out, /privacy\.schema\.json properties\.app accepts [1-9]/);
  });

  // A release's `unit` is the same id; before this case the schema carried the
  // pattern and no length bound, and limb 4 did not read it.
  test('the guard exits 1 when release.schema.json unit allows more than the contract', () => {
    const root = fixture({
      edit: {
        'contracts/release.schema.json': (t) => {
          const doc = JSON.parse(t);
          doc.properties.unit.maxLength = 40;
          return `${JSON.stringify(doc, null, 2)}\n`;
        },
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb 4 — contracts\/release\.schema\.json properties\.unit accepts 8 id\(s\) the contract refuses, first "a[a-z0-9]{32}" \(33 characters\)/);
    assert.doesNotMatch(out, /app\.schema\.json properties\.id accepts [1-9]/);
  });
});
