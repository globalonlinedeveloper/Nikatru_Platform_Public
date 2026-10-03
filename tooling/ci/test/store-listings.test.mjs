// ─────────────────────────────────────────────────────────────────────────────
// store-listings.test.mjs — tooling/ci/assert-store-listings.mjs, tooling/store/
// listing-locales.mjs, listing-qa.mjs and custom-listings.mjs. [lane aso-listings]
//
// Each case runs its GREEN control on the same fixture first, so a red proves the
// mutation and not the fixture:
//   T1  L: the real table maps or skips every register locale on every channel;
//       a locale removed from one block is a finding; a language literal in a
//       submit tool is a finding (the real submit-play.mjs had one)
//   T2  M: an Apple keywords field at 100 bytes passes and at 101 fails (Hindi,
//       three bytes a character); a draft subtitle one character over fails
//   T3  C: a listing naming a web price, the commission, "free AI", an AI claim
//       with no customer-pays row, or a competitor in Apple keywords fails; the
//       same AI claim with a customer-pays row passes
//   T4  R: a locale folder with no sheet, an unchecked sheet or a self-checked
//       sheet fails; a passing sheet passes; a draft that is not marked
//       machine-assisted fails
//   T5  S: a locale with text and no CAPTURE.json of its own is `pending`, even
//       when the English set has one and when a manifest names another locale
//   T6  A: custom listings and the promo calendar must exist and name a known
//       channel and locale; custom-listings.mjs refuses a publish without --publish
//   T7  listing-qa: a field over its limit is flagged; a checker's columns
//       survive a re-run on unchanged rows; a sheet with the wrong header fails
//   T8  every matcher is proven; a matcher that stopped matching is lost
//   T9  the real tree grades with no finding and no lost coverage
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  MATCHERS,
  byteCount,
  grade,
  gradeAsoData,
  gradeClaims,
  gradeLanguages,
  gradeLimits,
  gradeLiterals,
  gradeReview,
  listingTexts,
  proveMatchers,
} from '../assert-store-listings.mjs';
import { SHEET_HEAD, listingPlan, readSheet, storeLanguage } from '../../store/listing-locales.mjs';
import { listingQa, sheetText } from '../../store/listing-qa.mjs';
import { buildPayloads } from '../../store/custom-listings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP = 'fx';

/** A temp repository holding the real registers and a one-app store tree. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nk-listings-'));
  for (const rel of ['tooling/channel-register.json', 'tooling/i18n/locales.json', 'tooling/store/listing-languages.json', 'tooling/ports/ai.json']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(root, rel));
  }
  mkdirSync(join(root, 'tooling/release'), { recursive: true });
  writeFileSync(join(root, 'tooling/release/submit-fx.mjs'), "const LANG = storeLanguage('android-play', 'en');\n");
  const brick = join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/aso');
  mkdirSync(brick, { recursive: true });
  writeFileSync(join(brick, 'custom-listings.json'), '{"listings":[]}\n');
  writeFileSync(join(brick, 'promo-calendar.json'), '{"entries":[]}\n');
  for (const ch of ['android-play', 'ios-appstore', 'macos-appstore', 'windows-store', 'linux-snap', 'apps-gov-in']) {
    const d = join(root, 'apps', APP, 'store', ch);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'title.txt'), 'Nikatru Fixture\n');
    writeFileSync(join(d, 'short-description.txt'), 'Track every subscription in one place\n');
  }
  writeFileSync(join(root, 'apps', APP, 'store', 'ios-appstore', 'keywords.txt'), 'renewal,reminder\n');
  const aso = join(root, 'apps', APP, 'aso');
  mkdirSync(aso, { recursive: true });
  writeFileSync(join(aso, 'custom-listings.json'), '{"listings":[]}\n');
  writeFileSync(join(aso, 'promo-calendar.json'), '{"entries":[]}\n');
  writeFileSync(join(aso, 'research-2026-10-03.md'), '# research\n');
  return root;
}
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const sheetRow = (cells) => SHEET_HEAD.map((h) => cells[h] ?? '').join('\t');
const sheet = (rows) => `${[SHEET_HEAD.join('\t'), ...rows.map(sheetRow)].join('\n')}\n`;

describe('T1 · L: every register locale is mapped or skipped, and no submit tool spells one', () => {
  test('the real table is complete; a removed mapping is a finding', () => {
    const root = fixture();
    try {
      assert.deepEqual(gradeLanguages(root).problems, []);
      const p = join(root, 'tooling/store/listing-languages.json');
      const t = JSON.parse(readFileSync(p, 'utf8'));
      delete t.channels['android-play'].codes.ta;
      writeFileSync(p, JSON.stringify(t));
      const r = gradeLanguages(root).problems;
      assert.equal(r.length, 1);
      assert.match(r[0], /"android-play" neither maps nor skips register locale "ta"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a language literal in a submit tool is a finding; the table read is not', () => {
    const root = fixture();
    try {
      assert.deepEqual(gradeLiterals(root).problems, []);
      writeFileSync(join(root, 'tooling/release/submit-fx.mjs'), "const LISTING_LANGUAGE = 'en-US';\n");
      assert.match(gradeLiterals(root).problems[0], /submit-fx\.mjs:1 spells a listing language as a literal/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('storeLanguage spells each store its own way and refuses a skipped locale', () => {
    assert.equal(storeLanguage('android-play', 'hi', { root: ROOT }), 'hi-IN');
    assert.equal(storeLanguage('windows-store', 'ta', { root: ROOT }), 'ta-in');
    assert.throws(() => storeLanguage('linux-snap', 'hi', { root: ROOT }), /skips "hi" on "linux-snap"/);
  });
});

describe('T2 · M: the sourced limits hold in every language', () => {
  test('Apple keywords: 100 bytes passes, 101 fails (a byte limit, not a character one)', () => {
    const root = fixture();
    try {
      // 33 Devanagari characters = 99 bytes, plus one ASCII = 100.
      const at100 = `${'क'.repeat(33)}a`;
      assert.equal(byteCount(at100), 100);
      put(root, `apps/${APP}/store/ios-appstore/hi/title.txt`, 'Nikatru Fixture\n');
      put(root, `apps/${APP}/store/ios-appstore/hi/keywords.txt`, `${at100}\n`);
      assert.deepEqual(gradeLimits(root, listingTexts(root, APP)).problems, []);
      put(root, `apps/${APP}/store/ios-appstore/hi/keywords.txt`, `${at100}b\n`);
      const r = gradeLimits(root, listingTexts(root, APP)).problems;
      assert.equal(r.length, 1);
      assert.match(r[0], /ios-appstore\/hi\/keywords\.txt is 101 \(maxBytes\) and the limit is 100/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a draft subtitle one character over its 30 fails', () => {
    const root = fixture();
    try {
      const draft = (s) => put(root, `apps/${APP}/aso/pending/ta.json`, JSON.stringify({ machineAssisted: true, fields: { 'ios-appstore/subtitle.txt': { text: s, back: 'x' } } }));
      draft('அ'.repeat(30));
      assert.deepEqual(gradeLimits(root, listingTexts(root, APP)).problems, []);
      draft('அ'.repeat(31));
      assert.match(gradeLimits(root, listingTexts(root, APP)).problems[0], /pending\/ta\.json#ios-appstore\/subtitle\.txt is 31 \(maxChars\) and the limit is 30/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('T3 · C: no web price, no commission, no free or unpaid AI, no competitor keyword', () => {
  const t = (text, extra = {}) => ({ app: APP, channel: 'android-play', locale: 'hi', origin: 'folder', file: 'long-description.txt', rel: 'x', text, ...extra });
  test('clean copy passes', () => {
    assert.deepEqual(gradeClaims(ROOT, [t('हर सदस्यता को एक ही जगह ट्रैक करें')], { paid: false }).problems, []);
  });
  test('a web price is a finding', () => {
    assert.match(gradeClaims(ROOT, [t('Pro is ₹99 a month')], { paid: false }).problems[0], /names a price/);
  });
  test('the commission, and a steer to the web, are findings', () => {
    assert.match(gradeClaims(ROOT, [t('Skip the store commission')], { paid: false }).problems[0], /commission/);
    assert.match(gradeClaims(ROOT, [t('It is cheaper on our website')], { paid: false }).problems[0], /steers the buyer/);
  });
  test('an AI claim fails with no customer-pays row and passes with one; free AI never passes', () => {
    assert.match(gradeClaims(ROOT, [t('AI import from a screenshot')], { paid: false }).problems[0], /no customer-pays row/);
    assert.deepEqual(gradeClaims(ROOT, [t('AI import from a screenshot')], { paid: true }).problems, []);
    assert.match(gradeClaims(ROOT, [t('Free AI import')], { paid: true }).problems[0], /advertises free AI/);
  });
  test('a competitor in Apple keywords is a finding; the same word in a description is not graded as one', () => {
    const competitors = [{ name: 'Bobby', terms: ['bobby'], url: 'https://example.invalid', readAt: '2026-10-03' }];
    const kw = (text) => t(text, { channel: 'ios-appstore', file: 'keywords.txt' });
    assert.deepEqual(gradeClaims(ROOT, [kw('renewal,reminder')], { paid: false, competitors }).problems, []);
    assert.match(gradeClaims(ROOT, [kw('renewal,bobby,reminder')], { paid: false, competitors }).problems[0], /carries "bobby"/);
    assert.deepEqual(gradeClaims(ROOT, [t('unlike bobby')], { paid: false, competitors }).problems, []);
  });
});

describe('T4 · R: a locale folder reaches a store only on a passing, independent review sheet', () => {
  const setup = () => {
    const root = fixture();
    put(root, `apps/${APP}/store/android-play/hi/title.txt`, 'Nikatru Fixture\n');
    return root;
  };
  const review = (root) => gradeReview(root, APP, listingTexts(root, APP)).problems;
  test('no sheet, an unchecked sheet and a self-checked sheet each fail; a passing sheet passes', () => {
    const root = setup();
    try {
      assert.match(review(root)[0], /android-play\/hi\/ is a hi listing and .*review\/hi\.tsv does not exist/);
      put(root, `apps/${APP}/aso/review/hi.tsv`, sheet([{ key: 'title.txt', translation: 'x', filled_by: 'lane a', checked_by: '', verdict: '' }]));
      assert.match(review(root)[0], /carry no checked_by/);
      put(root, `apps/${APP}/aso/review/hi.tsv`, sheet([{ key: 'title.txt', translation: 'x', filled_by: 'lane a', checked_by: 'lane a', verdict: 'pass' }]));
      assert.match(review(root)[0], /checked by the lane that filled them/);
      put(root, `apps/${APP}/aso/review/hi.tsv`, sheet([{ key: 'title.txt', translation: 'x', filled_by: 'lane a', checked_by: 'lane b', verdict: 'fail' }]));
      assert.match(review(root)[0], /verdict other than pass/);
      put(root, `apps/${APP}/aso/review/hi.tsv`, sheet([{ key: 'title.txt', translation: 'x', filled_by: 'lane a', checked_by: 'lane b', verdict: 'pass' }]));
      assert.deepEqual(review(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a draft must be marked machine-assisted and must have a sheet', () => {
    const root = fixture();
    try {
      put(root, `apps/${APP}/aso/pending/ta.json`, JSON.stringify({ machineAssisted: true, fields: {} }));
      put(root, `apps/${APP}/aso/review/ta.tsv`, sheet([{ key: 'k' }]));
      assert.deepEqual(review(root), []);
      put(root, `apps/${APP}/aso/pending/ta.json`, JSON.stringify({ fields: {} }));
      assert.match(review(root)[0], /does not say `machineAssisted: true`/);
      rmSync(join(root, `apps/${APP}/aso/review/ta.tsv`));
      assert.ok(review(root).some((p) => /draft with no review sheet/.test(p)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('T5 · S: a language is never photographed in English', () => {
  test('pending until a CAPTURE.json records THAT locale', () => {
    const root = fixture();
    try {
      put(root, `apps/${APP}/store/android-play/screenshots/CAPTURE.json`, JSON.stringify({ locale: 'en' }));
      put(root, `apps/${APP}/store/android-play/hi/title.txt`, 'x\n');
      const hi = () => listingPlan(root, APP).find((p) => p.channel === 'android-play' && p.locale === 'hi');
      assert.equal(listingPlan(root, APP).find((p) => p.channel === 'android-play' && p.locale === 'en').screenshots, 'manifest');
      assert.equal(hi().screenshots, 'pending');
      put(root, `apps/${APP}/store/android-play/hi/screenshots/CAPTURE.json`, JSON.stringify({ locale: 'en' }));
      assert.equal(hi().screenshots, 'pending', 'a manifest naming another locale is not this locale\'s set');
      put(root, `apps/${APP}/store/android-play/hi/screenshots/CAPTURE.json`, JSON.stringify({ locale: 'hi' }));
      assert.equal(hi().screenshots, 'manifest');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('T6 · A: custom listings and the promotional calendar are data, and publishing is refused', () => {
  test('missing files and unknown channel or locale are findings', () => {
    const root = fixture();
    try {
      const codes = ['en', 'ta', 'hi'];
      assert.deepEqual(gradeAsoData(root, APP, { codes }).problems, []);
      put(root, `apps/${APP}/aso/custom-listings.json`, JSON.stringify({ listings: [{ id: 'x', channel: 'linux-snap', locale: 'fr', audience: 'somebody in particular', fields: {} }] }));
      const r = gradeAsoData(root, APP, { codes }).problems;
      assert.ok(r.some((p) => /names channel "linux-snap"/.test(p)));
      assert.ok(r.some((p) => /names locale "fr"/.test(p)));
      rmSync(join(root, `apps/${APP}/aso/promo-calendar.json`));
      assert.ok(gradeAsoData(root, APP, { codes }).problems.some((p) => /promo-calendar\.json does not exist/.test(p)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a publish-flagged entry, or a calendar entry live today, is a publish', () => {
    const root = fixture();
    try {
      put(root, `apps/${APP}/aso/custom-listings.json`, JSON.stringify({ listings: [{ id: 'a', channel: 'android-play', locale: 'en', audience: 'everyone in India', fields: {}, publish: false }] }));
      put(root, `apps/${APP}/aso/promo-calendar.json`, JSON.stringify({ entries: [{ id: 'p', from: '2026-11-01', to: '2026-11-30', channels: ['ios-appstore'], text: { en: 'x' } }] }));
      assert.equal(buildPayloads(root, APP, { today: '2026-10-03' }).payloads.filter((p) => p.publishes).length, 0);
      assert.equal(buildPayloads(root, APP, { today: '2026-11-02' }).payloads.filter((p) => p.publishes).length, 1);
      put(root, `apps/${APP}/aso/custom-listings.json`, JSON.stringify({ listings: [{ id: 'a', channel: 'android-play', locale: 'en', audience: 'everyone in India', fields: {}, publish: true }] }));
      const p = buildPayloads(root, APP, { today: '2026-10-03' }).payloads.find((x) => x.id === 'a');
      assert.equal(p.publishes, true);
      assert.equal(p.language, 'en-US');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('the CLI exits 1 on a publish without --publish, 0 with it, on the real data', () => {
    const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'tooling/store/custom-listings.mjs'), '--app', 'subscriptiontracker', ...a], { encoding: 'utf8' });
    assert.equal(run('--today', '2026-10-03').status, 0, 'before the first calendar window nothing publishes');
    const live = run('--today', '2026-10-15');
    assert.equal(live.status, 1);
    assert.match(live.stderr, /REFUSING — 2 payload\(s\) would publish/);
    assert.equal(run('--today', '2026-10-15', '--publish').status, 0);
  });
});

describe('T7 · listing-qa: the review sheet', () => {
  test('a field over its limit is flagged; a checker\'s columns survive an unchanged re-run', () => {
    const root = fixture();
    try {
      put(root, `apps/${APP}/aso/pending/hi.json`, JSON.stringify({ filledBy: 'lane a', fields: { 'ios-appstore/subtitle.txt': { text: 'क'.repeat(31), back: 'x' }, 'android-play/short-description.txt': { text: 'हर सदस्यता', back: 'every subscription' } } }));
      put(root, `apps/${APP}/store/ios-appstore/subtitle.txt`, 'Every subscription, one list\n');
      const r = listingQa(root, APP, 'hi');
      assert.equal(r.findings.length, 1);
      assert.match(r.findings[0].why, /31 characters, limit 30/);
      const first = readSheet(sheetText(r));
      assert.equal(first.passing, false);
      const checked = sheetText(r).replace(/\tlane a\t\t\n/g, '\tlane a\tlane b\tpass\n');
      assert.equal(readSheet(checked).passing, true);
      const again = readSheet(sheetText(r, readSheet(checked)));
      assert.equal(again.passing, true, 'an unchanged translation keeps its verdict');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('a sheet with another header is not a review', () => {
    assert.match(readSheet('key\tverdict\nx\tpass\n').why, /header is not translation-qa's/);
  });
});

describe('T8 · the matchers are proven before use', () => {
  test('every matcher catches its wording and spares the innocent', () => {
    assert.deepEqual(proveMatchers(), []);
  });
  test('a matcher that stopped matching is lost', () => {
    const broken = { ...MATCHERS, commission: { ...MATCHERS.commission, re: /\bnever-matches\b/ } };
    assert.match(proveMatchers(broken)[0], /matcher "commission" no longer matches/);
  });
});

describe('T9 · the real tree', () => {
  test('grades with no finding and no lost coverage', () => {
    const r = grade(ROOT);
    assert.deepEqual(r.lost, []);
    assert.deepEqual(r.problems, []);
  });
  test('the CLI exits 0', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'tooling/ci/assert-store-listings.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});
