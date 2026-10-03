// help-search.test.mjs — lane help-search: the articles and their gates, the
// index and its budget, the measured recall, the one-search-two-runtimes
// fixture, and `--check` (tooling/help/build-index.mjs, tooling/help/search.mjs).
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONFORMANCE,
  DART_INDEX_REL,
  EXTENSION_BUNDLES,
  PRICE,
  articlesFor,
  buildIndex,
  checkArticle,
  collect,
  gateState,
  indexBudgetProblem,
  main,
  plan,
  readSynonyms,
  recallProblems,
} from '../../help/build-index.mjs';
import { search, stem, tokenize, withinOneEdit } from '../../help/search.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const EVAL = JSON.parse(read('content/help/_eval/en.json')).pairs;

/** The source-locale index over `articles`, as build-index builds it. */
const indexOf = (articles) => buildIndex('en', articlesFor(articles, 'en', 'en'), [], readSynonyms(ROOT, 'en'));

// ── the real tree ───────────────────────────────────────────────────────────

test('the committed outputs are current (build-index --check exits 0)', () => {
  const lines = [];
  assert.equal(main([ROOT, '--check'], (l) => lines.push(l)), 0, lines.join('\n'));
});

test('every article in the tree has a gate, and every gate is on', () => {
  const c = collect(ROOT);
  assert.deepEqual(c.problems, []);
  assert.ok(c.articles.length >= 20, `${c.articles.length} article(s)`);
  for (const a of c.articles) assert.ok(Array.isArray(a.fm.gate) && a.fm.gate.length > 0, a.id);
});

test('the eval set is at least 50 pairs, and recall@3 is at least 0.9 overall and per article', () => {
  const c = collect(ROOT);
  const r = recallProblems('en', indexOf(c.articles), EVAL, c.articles.filter((a) => a.locale === 'en'));
  assert.ok(EVAL.length >= 50);
  assert.deepEqual(r.problems, []);
  assert.ok(r.recall.recall >= 0.9, String(r.recall.recall));
});

// ── Do 1: gates and prices ──────────────────────────────────────────────────

test('🔴 a gate that is off refuses the article', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'help-gate-'));
  try {
    mkdirSync(path.join(tmp, 'services', 'platform', 'src'), { recursive: true });
    const cfg = JSON.parse(read('services/platform/src/app-config-data.json'));
    cfg.apps.subscriptiontracker.features.exports = false;
    writeFileSync(path.join(tmp, 'services', 'platform', 'src', 'app-config-data.json'), JSON.stringify(cfg));
    assert.equal(gateState(ROOT, 'config:subscriptiontracker.features.exports').on, true);
    const off = gateState(tmp, 'config:subscriptiontracker.features.exports');
    assert.equal(off.on, false);
    assert.match(off.why, /is false, not true/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('🔴 the paywall is off today, so a Pro article cannot ship', () => {
  assert.equal(gateState(ROOT, 'config:subscriptiontracker.paywall.enabled').on, false);
});

test('each gate kind reads its fact: dod, l10n, chassis l10n, ext, page and page#id', () => {
  for (const g of [
    'dod:subscriptiontracker:add subscription',
    'l10n:subscriptiontracker:exportDataCsv',
    'l10n:chassis:deleteAccount',
    'ext:Full_Screen_Shot:optionsHideFixed',
    'page:/delete-account',
    'page:/support#report-a-problem',
  ]) assert.equal(gateState(ROOT, g).on, true, g);
  for (const g of [
    'dod:subscriptiontracker:teleport',
    'l10n:subscriptiontracker:noSuchKey',
    'ext:Full_Screen_Shot:noSuchKey',
    'page:/no-such-page',
    'page:/support#no-such-id',
    'magic:anything',
  ]) assert.equal(gateState(ROOT, g).on, false, g);
});

const FM = { title: 'T', summary: 'S', minVersion: '1.0.0', updated: '2026-10-03', platforms: ['web'], gate: ['page:/support'], asked: ['a', 'b', 'c', 'd', 'e'] };

test('🔴 a price literal is refused, in any of its common shapes', () => {
  for (const body of ['It costs ₹199 a month.', 'Only $4.99.', 'Pay Rs. 99 once.', 'USD 5 a year', '499 rupees', 'Rs 1,499/-']) {
    assert.ok(checkArticle('x.md', FM, body).some((p) => /a price/.test(p)), body);
  }
  assert.deepEqual(checkArticle('x.md', FM, 'See [pricing](https://nikatru.com/pricing) for plans. Version 1.10.3 adds 3 modes.'), []);
  assert.ok(PRICE instanceof RegExp);
});

test('🔴 an article with no gate, or fewer than five asked lines, is refused', () => {
  assert.ok(checkArticle('x.md', { ...FM, gate: [] }, 'body').some((p) => /no gate/.test(p)));
  assert.ok(checkArticle('x.md', { ...FM, asked: ['a'] }, 'body').some((p) => /asked needs at least 5/.test(p)));
});

// ── Do 2: the index ─────────────────────────────────────────────────────────

test('🔴 an index over its budget is refused', () => {
  assert.equal(indexBudgetProblem('en', '{}'), null);
  assert.match(indexBudgetProblem('en', 'x'.repeat(11), 10), /11 bytes, over the 10 budget/);
});

test('🔴 a hand edit of a committed index fails --check', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'help-check-'));
  try {
    for (const rel of ['content', 'tooling/i18n/locales.json', 'services/platform/src/app-config-data.json', 'apps/subscriptiontracker/dod.json', 'apps/subscriptiontracker/lib/l10n/app_en.arb', 'packages/design_system/lib/src/l10n/chassis_en.arb', 'extensions/Extension/Full_Screen_Shot/_locales/en/messages.json', 'sites/nikatru', 'sites/status', 'apps/subscriptiontracker/pubspec.yaml', 'apps/subscriptiontracker/lib/help', 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/help', 'extensions/Extension/Full_Screen_Shot/pages', 'extensions/templates/tool/lib']) {
      cpSync(path.join(ROOT, rel), path.join(tmp, rel), { recursive: true });
    }
    const quiet = () => {};
    assert.equal(main([tmp, '--check'], quiet), 0);
    // The regen ORDER entry, run as regen.mjs runs it (node + path, no shebang):
    // it must exit exactly as build-index does, green here and red below.
    const wrapper = () =>
      spawnSync(process.execPath, [path.join(ROOT, 'tooling', 'sites', 'gen-help-centre.mjs'), tmp, '--check'], { encoding: 'utf8' });
    const green = wrapper();
    assert.equal(green.status, 0, green.stdout + green.stderr);
    const file = path.join(tmp, 'sites', 'nikatru', 'help', 'index.en.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"avgdl":', '"avgdl":1+'));
    const lines = [];
    assert.equal(main([tmp, '--check'], (l) => lines.push(l)), 1);
    assert.ok(lines.some((l) => l.includes('stale sites/nikatru/help/index.en.json')), lines.join('\n'));
    const red = wrapper();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout + red.stderr, /stale sites\/nikatru\/help\/index\.en\.json/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the stemmer, the one-edit test and the synonyms behave as documented', () => {
  assert.deepEqual(tokenize('Reminders renewing cancelled categories'), ['reminder', 'renew', 'cancell', 'category']);
  assert.equal(stem('sharing'), stem('shared'));
  assert.equal(withinOneEdit('reminder', 'remnder'), true);
  assert.equal(withinOneEdit('reminder', 'rmeinder'), true);
  assert.equal(withinOneEdit('reminder', 'rmnder'), false);
  const syn = readSynonyms(ROOT, 'en');
  assert.ok(syn.unsubscrib?.includes('cancel'), JSON.stringify(syn.unsubscrib));
});

// ── Do 3: recall is a number with a floor ───────────────────────────────────

test('🔴 deleting one article\'s asked list drops an article below the per-article floor', () => {
  // Measured over every article rather than pinned to one: which article's
  // `asked` lines carry its eval questions moves as articles and synonyms are
  // added. The claim is that the floor BITES for some single deletion, and the
  // overall average does not hide it.
  const c = collect(ROOT);
  const reds = [];
  for (const target of c.articles) {
    const gutted = c.articles.map((a) => (a.id === target.id ? { ...a, fm: { ...a.fm, asked: [] } } : a));
    const r = recallProblems('en', indexOf(gutted), EVAL, gutted);
    if (r.problems.some((p) => /under the 0\.9 floor/.test(p)) && r.recall.recall >= 0.9) reds.push(target.id);
  }
  assert.ok(reds.length > 0, 'no single asked-list deletion reds the per-article floor');
});

test('🔴 an eval query that is an article\'s own asked line is refused', () => {
  const c = collect(ROOT);
  const own = c.articles[0].fm.asked[0];
  const r = recallProblems('en', indexOf(c.articles), [...EVAL, { query: own, expect: c.articles[0].id }], c.articles);
  assert.ok(r.problems.some((p) => /own `asked` line/.test(p)));
});

test('🔴 fewer than 50 pairs is refused', () => {
  const c = collect(ROOT);
  assert.ok(recallProblems('en', indexOf(c.articles), EVAL.slice(0, 49), c.articles).problems.some((p) => /at least 50 are required/.test(p)));
});

// ── Do 4: one search, two runtimes ──────────────────────────────────────────

test('the conformance fixture is the JS ranking of every eval query', () => {
  const fixture = JSON.parse(read(CONFORMANCE));
  const index = JSON.parse(read('sites/nikatru/help/index.en.json'));
  assert.equal(fixture.cases.length, EVAL.length);
  for (const c of fixture.cases) assert.deepEqual(search(index, c.query, { limit: 5 }), c.hits, c.query);
});

test('🔴 a mutated JS ranker fails the conformance fixture', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'help-mutant-'));
  try {
    const mutant = path.join(tmp, 'search.mjs');
    writeFileSync(mutant, read('tooling/help/search.mjs').replace('export const K1 = 1.2;', 'export const K1 = 1.5;'));
    const { search: mutated } = await import(pathToFileURL(mutant).href);
    const fixture = JSON.parse(read(CONFORMANCE));
    const index = JSON.parse(read('sites/nikatru/help/index.en.json'));
    const differs = fixture.cases.filter((c) => JSON.stringify(mutated(index, c.query, { limit: 5 })) !== JSON.stringify(c.hits));
    assert.ok(differs.length > 0, 'a ranker with another k1 reproduced every score');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('each app gets its own Dart table — its scope and the platform — and the brick the platform only', () => {
  const tableOf = (rel) => {
    // The shape `dart format` leaves (ci.yml's apps/ format gate): a value past
    // 80 columns on its own line, so the key line `  'en': r'''…` is a red.
    const m = /^  'en':\n      r'''(.*)''',$/m.exec(read(rel));
    assert.ok(m, `${rel} carries no dart-format-clean en table`);
    return JSON.parse(m[1]);
  };
  const app = tableOf('apps/subscriptiontracker/lib/help/help_index.g.dart');
  assert.ok(app.docs.length > 0);
  assert.deepEqual([...new Set(app.docs.map((d) => d.scope))].sort(), ['platform', 'subscriptiontracker']);
  const brick = tableOf('tooling/bricks/app/__brick__/apps/{{app_id}}/lib/help/help_index.g.dart');
  assert.ok(brick.docs.length > 0 && brick.docs.every((d) => d.scope === 'platform'));
  // 🔴 shared code never carries an app's articles: packages/help has no table of its own.
  assert.throws(() => read('packages/help/lib/src/help_index.g.dart'));
});

// ── Do 5: everywhere, and every path POSIX ──────────────────────────────────

test('every output is a POSIX repo-relative path, so a Windows checkout writes the same files', () => {
  const p = plan(ROOT);
  for (const rel of p.files.keys()) assert.ok(!rel.includes('\\') && !path.isAbsolute(rel), rel);
  for (const b of EXTENSION_BUNDLES) assert.ok(!b.dir.includes('\\'), b.dir);
  assert.equal(path.win32.join('C:\\repo', ...'sites/nikatru/help/index.html'.split('/')), 'C:\\repo\\sites\\nikatru\\help\\index.html');
});

test('the extension bundles carry only their own scopes', () => {
  const fs = read('extensions/Extension/Full_Screen_Shot/pages/help-index.js');
  const idx = JSON.parse(fs.replace(/^\/\/.*\n/, '').replace(/^export default /, '').replace(/;\s*$/, ''));
  assert.ok(idx.docs.length > 0);
  assert.ok(idx.docs.every((d) => d.scope === 'fullshot'));
});

// ── Do 6 and 7 on the site: "Ask us" and known issues ───────────────────────

test('every article on /help/ ends with "Ask us", and the page carries known issues', () => {
  const html = read('sites/nikatru/help/index.html');
  const articles = html.match(/<article class="help-article"/g) ?? [];
  const asks = html.match(/class="ask-link" href="\/support\?category=question#report-a-problem"/g) ?? [];
  assert.ok(articles.length >= 20);
  assert.equal(asks.length, articles.length);
  assert.match(html, /id="known-issues"/);
});

test('🔴 an empty known-issues folder renders "No known issues", never a blank list', () => {
  assert.match(read('sites/nikatru/help/known-issues.html'), /<p class="known-none">No known issues\.<\/p>/);
});
