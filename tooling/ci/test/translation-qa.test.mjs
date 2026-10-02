// ─────────────────────────────────────────────────────────────────────────────
// translation-qa.test.mjs — tooling/i18n/translation-qa.mjs, the placeholder-
// safety step and review-sheet writer. Lane i18n-pipeline (item 7).
//
// The green control is the real tree (ta and hi are clean of placeholder and
// ICU defects today, which the parity tests also hold). Each red case breaks one
// thing in a copy of the real ARBs and requires the harness to name it.
//
// Run:  node --test tooling/ci/test/translation-qa.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { qa, accept, sheet, compareMessage, icuShape, EMAIL } from '../../i18n/translation-qa.mjs';
import { REGISTER, supportedCodes } from '../../i18n/locales.mjs';
import { l10nRoots } from '../assert-locale-register.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling/i18n/translation-qa.mjs');
const real = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
const TRANSLATIONS = supportedCodes(real).filter((c) => c !== real.sourceLocale);

describe('the real tree', () => {
  test('green control: every translation has no missing key, placeholder or ICU defect', () => {
    assert.ok(TRANSLATIONS.length >= 1, 'the register has no translation to grade');
    for (const code of TRANSLATIONS) {
      const r = qa(REPO, code);
      assert.equal(r.coverage, null, code);
      assert.deepEqual(r.findings.filter((f) => f.kind !== 'changed'), [], code);
      assert.ok(r.checked > 700, `${code}: ${r.checked} keys`); // 852 measured 2026-10-02, after the app stopped re-declaring chassis keys
      assert.ok(r.units.some((u) => u.surface === `${EMAIL}#digest`), 'the server copy is graded too');
    }
  });

  test('an unknown locale and the source locale are COVERAGE LOST, never clean', () => {
    assert.match(qa(REPO, 'zz').coverage, /not a row/);
    assert.match(qa(REPO, real.sourceLocale).coverage, /source locale/);
    const r = spawnSync(process.execPath, [SCRIPT, 'zz'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});

describe('the message comparator', () => {
  test('a dropped or invented placeholder is named', () => {
    assert.deepEqual(compareMessage('{name} renews on {date}', '{name} புதுப்பிக்கப்படும்').map((x) => x[1]), ['drops {date}']);
    assert.deepEqual(compareMessage('Hi', 'नमस्ते {name}').map((x) => x[1]), ['invents {name}']);
  });

  test('a placeholder inside a plural arm counts; arms are not placeholders', () => {
    const s = icuShape('{count, plural, =1{{name} renews in 1 day} other{{name} renews in {count} days}}');
    assert.deepEqual([...s.placeholders].sort(), ['count', 'name']);
    assert.deepEqual([...s.args.get('count').arms], ['=1', 'other']);
  });

  test('a plural without other, a lost plural and select arms that differ are each named', () => {
    const en = '{count, plural, =1{one day} other{{count} days}}';
    assert.match(compareMessage(en, '{count, plural, =1{1 दिन}}')[0][1], /no other arm/);
    assert.match(compareMessage(en, '{count} दिन')[0][1], /translation does not/);
    assert.match(
      compareMessage('{u, select, week{week} month{month} other{day}}', '{u, select, week{வாரம்} other{நாள்}}')[0][1],
      /arms differ \(missing: month/,
    );
  });

  test('a plural missing a category the register requires is named', () => {
    const r = compareMessage('{n, plural, other{{n} items}}', '{n, plural, other{{n} x}}', ['one', 'few', 'other']);
    assert.match(r[0][1], /lacks the one, few categories/);
  });
});

describe('on a copy of the real ARBs', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tqa-'));
    const files = [REGISTER, EMAIL];
    for (const r of l10nRoots(REPO)) {
      files.push(`${r.dir}/l10n.yaml`);
      for (const c of supportedCodes(real)) files.push(`${r.dir}/${r.arbDir}/${r.prefix}_${c}.arb`);
    }
    for (const f of files) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      copyFileSync(join(REPO, f), join(root, f));
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const editJson = (rel, fn) => {
    const p = join(root, rel);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    fn(j);
    writeFileSync(p, JSON.stringify(j, null, 2));
  };

  test('a key removed from the Hindi chassis ARB is MISSING, with its surface', () => {
    editJson('packages/design_system/lib/src/l10n/chassis_hi.arb', (j) => delete j.signInTitle);
    const f = qa(root, 'hi').findings;
    assert.deepEqual(f.map((x) => [x.kind, x.key, x.surface]), [['missing', 'signInTitle', 'packages/design_system/lib/src/l10n/chassis_hi.arb']]);
  });

  test('a Tamil translation that drops a placeholder is named', () => {
    editJson('packages/design_system/lib/src/l10n/chassis_ta.arb', (j) => {
      assert.ok(j.paywallTermMonthlyWithTrial.includes('{count}'));
      j.paywallTermMonthlyWithTrial = j.paywallTermMonthlyWithTrial.replace('{count}', '');
    });
    const f = qa(root, 'ta').findings;
    assert.deepEqual(f.map((x) => [x.kind, x.key, x.why]), [['placeholder', 'paywallTermMonthlyWithTrial', 'drops {count}']]);
  });

  test('--accept fingerprints the English; an English edit afterwards is CHANGED', () => {
    accept(root, 'ta');
    assert.deepEqual(qa(root, 'ta').findings, []);
    editJson('packages/design_system/lib/src/l10n/chassis_en.arb', (j) => {
      j.signInTitle = 'Sign in to continue';
    });
    const f = qa(root, 'ta').findings;
    assert.deepEqual(f.map((x) => [x.kind, x.key]), [['changed', 'signInTitle']]);
  });

  test('a PENDING locale lists every key as missing, and the sheet has a back-translation slot per row', () => {
    editJson(REGISTER, (j) => {
      j.locales.push({ ...j.locales[1], code: 'bn', status: 'pending', englishName: 'Bengali', nativeName: 'বাংলা', script: 'Beng', apple: 'bn', android: 'bn', msix: 'bn-in' });
    });
    const r = qa(root, 'bn');
    assert.ok(r.findings.length > 700);
    assert.ok(r.findings.every((x) => x.kind === 'missing'));
    const tsv = sheet(r).split('\n');
    assert.deepEqual(tsv[0].split('\t'), ['surface', 'key', 'source_en', 'translation', 'back_translation', 'flags', 'filled_by', 'checked_by', 'verdict']);
    assert.equal(tsv.length - 2, r.rows.length);
    const out = join(root, 'bn.tsv');
    const cli = spawnSync(process.execPath, [SCRIPT, 'bn', '--root', root, '--sheet', out], { encoding: 'utf8' });
    assert.equal(cli.status, 1, 'a locale with work left is not clean');
    assert.ok(existsSync(out));
  });
});
