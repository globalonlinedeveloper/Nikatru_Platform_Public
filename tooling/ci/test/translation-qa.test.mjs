// ─────────────────────────────────────────────────────────────────────────────
// translation-qa.test.mjs — tooling/i18n/translation-qa.mjs, the translation QA
// harness (no API calls). Every finding kind has a red control here, on a fixture
// tree built from a copy of the REAL chassis ARBs with one thing broken, and the
// review-sheet protocol (lane A fills, lane B checks) is driven end to end.
//
// Run:  node --test tooling/ci/test/translation-qa.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { messageProblems, parseIcu } from '../../i18n/translation-qa.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(REPO, 'tooling/i18n/translation-qa.mjs');
const CHASSIS = 'packages/design_system/lib/src/l10n';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nikatru-tqa-'));
  for (const rel of ['tooling/i18n/locales.json', `${CHASSIS}/chassis_en.arb`, `${CHASSIS}/chassis_ta.arb`, `${CHASSIS}/chassis_hi.arb`]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, [TOOL, '--root', root, ...args], { encoding: 'utf8' });
const arb = (l) => JSON.parse(readFileSync(join(root, CHASSIS, `chassis_${l}.arb`), 'utf8'));
const setArb = (l, v) => writeFileSync(join(root, CHASSIS, `chassis_${l}.arb`), JSON.stringify(v, null, 2));
const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });

describe('translation-qa — the real tree', () => {
  test('GREEN CONTROL: every supported locale of the real tree is clean', () => {
    const r = spawnSync(process.execPath, [TOOL, '--all'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^ok {2}ta: \d+ message\(s\) in 3 set\(s\)/m);
    assert.match(r.stdout, /^ok {2}hi: \d+ message\(s\) in 3 set\(s\)/m);
  });

  test('GREEN CONTROL: the fixture copy is clean too', () => {
    const r = run('--locale', 'ta');
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });

  test('a locale with no ARB anywhere is COVERAGE LOST, not clean', () => {
    const r = run('--locale', 'fr');
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, /COVERAGE LOST — fr: no ARB file/);
  });
});

describe('translation-qa — each finding kind', () => {
  test('missing and extra keys', () => {
    const ta = arb('ta');
    delete ta.settingsTitle;
    ta.notInEnglish = 'x';
    setArb('ta', ta);
    const r = run('--locale', 'ta');
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /\[missing\] chassis settingsTitle: no translation/);
    assert.match(r.stderr, /\[extra\] chassis notInEnglish: not in the English template/);
  });

  test('a dropped placeholder and an invented one', () => {
    const en = arb('en');
    const key = Object.keys(en).find((k) => !k.startsWith('@') && /\{appName\}/.test(en[k]));
    assert.ok(key, 'the chassis ARB no longer has an {appName} message — re-aim this case');
    const hi = arb('hi');
    hi[key] = hi[key].replace('{appName}', '{appTitle}');
    setArb('hi', hi);
    const r = run('--locale', 'hi');
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, new RegExp(`\\[placeholder\\] chassis ${key}: drops \\{appName\\}`));
    assert.match(r.stderr, new RegExp(`\\[placeholder\\] chassis ${key}: invents \\{appTitle\\}`));
  });

  test('ICU: select arms that differ, a plural without other, a category Tamil never selects, a type swap', () => {
    assert.deepEqual(
      messageProblems('{u, select, week{w} month{m} other{o}}', '{u, select, week{w} other{o}}', ['one', 'other']).map((p) => p.detail),
      ['{u, select} arms are [other, week], English has [month, other, week]'],
    );
    assert.deepEqual(messageProblems('{n, plural, one{1} other{#}}', '{n, plural, one{1}}', ['one', 'other']).map((p) => p.kind), ['icu']);
    assert.match(messageProblems('{n, plural, one{1} other{#}}', '{n, plural, few{f} other{#}}', ['one', 'other'])[0].detail, /uses few, which this locale's CLDR rules \(one, other\) never select/);
    assert.match(messageProblems('{n, plural, one{1} other{#}}', '{n, select, one{1} other{#}}', ['one', 'other'])[0].detail, /is a plural in English and a select here/);
    // =0 is an exact match, allowed in every locale.
    assert.deepEqual(messageProblems('{n, plural, =0{none} one{1} other{#}}', '{n, plural, =0{none} other{#}}', ['one', 'other']), []);
  });

  test('a real chassis plural mutated to drop `other` FAILS through the CLI', () => {
    const en = arb('en');
    const key = Object.keys(en).find((k) => !k.startsWith('@') && /, plural,/.test(en[k]));
    assert.ok(key, 'the chassis ARB no longer has a plural — re-aim this case');
    const ta = arb('ta');
    ta[key] = ta[key].replace(/\s*other\{[^}]*\}/, '');
    setArb('ta', ta);
    const r = run('--locale', 'ta');
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, new RegExp(`\\[icu\\] chassis ${key}: \\{\\w+, plural\\} has no "other" arm`));
  });

  test('an arm body is not mistaken for a placeholder; a mason tag is not ICU', () => {
    assert.deepEqual([...parseIcu('{count}-{unit, select, week{week} other{day}} for {term}').placeholders].sort(), ['count', 'term', 'unit']);
    assert.deepEqual(messageProblems('{{{display_name_json}}}', '{{{display_name_json}}}', ['one', 'other']), []);
  });

  test('changed: English edited since a ref while the translation stayed', () => {
    g('init', '-q');
    g('config', 'user.email', 't@example.test');
    g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false');
    g('add', '-A');
    g('commit', '-qm', 'base');
    const en = arb('en');
    en.settingsTitle = `${en.settingsTitle} and more`;
    setArb('en', en);
    const r = run('--locale', 'ta', '--since', 'HEAD');
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /\[changed\] chassis settingsTitle: the English changed since HEAD and the translation did not/);
  });
});

describe('translation-qa — the review sheet, two lanes', () => {
  const fill = (sheet, lane, checker) => {
    for (const r of sheet.rows) {
      r.backTranslation = 'back';
      r.verdict = 'ok';
      r.filledBy = lane;
      r.check = 'agree';
      r.checkedBy = checker;
    }
    return sheet;
  };

  test('a generated sheet carries source, translation, note and empty slots, and an unfilled one is refused', () => {
    const out = join(root, 'ta.review.json');
    const w = run('--locale', 'ta', '--set', 'chassis', '--sheet', out);
    assert.equal(w.status, 0, w.stderr + w.stdout);
    const sheet = JSON.parse(readFileSync(out, 'utf8'));
    const row = sheet.rows.find((r) => r.key === 'settingsTitle');
    assert.equal(row.source, arb('en').settingsTitle);
    assert.equal(row.translation, arb('ta').settingsTitle);
    assert.equal(row.backTranslation, '');
    const c = run('--check-sheet', out);
    assert.equal(c.status, 1);
    assert.match(c.stderr, /`backTranslation` is empty/);
  });

  test('filled by lane A and checked by lane B passes; checked by lane A again is refused', () => {
    const out = join(root, 'hi.review.json');
    run('--locale', 'hi', '--set', 'chassis', '--sheet', out);
    const sheet = JSON.parse(readFileSync(out, 'utf8'));
    writeFileSync(out, JSON.stringify(fill(sheet, 'lane-a', 'lane-b')));
    assert.equal(run('--check-sheet', out).status, 0);
    writeFileSync(out, JSON.stringify(fill(sheet, 'lane-a', 'lane-a')));
    const r = run('--check-sheet', out);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /checked by the lane that filled it \(lane-a\)/);
  });

  test('a sheet whose translation changed after review is stale', () => {
    const out = join(root, 'ta.review.json');
    run('--locale', 'ta', '--set', 'chassis', '--sheet', out);
    writeFileSync(out, JSON.stringify(fill(JSON.parse(readFileSync(out, 'utf8')), 'lane-a', 'lane-b')));
    const ta = arb('ta');
    ta.settingsTitle = 'மாற்றம்';
    setArb('ta', ta);
    const r = run('--check-sheet', out);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /chassis settingsTitle\): the translation is no longer what the sheet reviewed/);
  });
});
