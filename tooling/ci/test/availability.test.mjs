// ─────────────────────────────────────────────────────────────────────────────
// availability.test.mjs — the availability derivation must be able to say YES,
// and assert-availability.mjs must be able to FAIL.
//
// 🔴 EVERY FIXTURE HERE IS A BYTE COPY OF THE REAL TREE, MUTATED —
// tooling/channel-register.json, catalog/apps.json and sites/nikatru as they are
// on disk. A hand-written toy register encodes the same misunderstanding as the
// derivation it is testing, and this component's original defect was exactly a
// hand-written stand-in for the register: the design canvas built its tiles from
// an ordered array and marked the first N live, which rendered "App Store" as
// LIVE when the only live channel is `web`. A fixture that reproduces the bug is
// worse than none.
//
// ⚠️ AND `edit()` THROWS WHEN ITS ANCHOR IS ABSENT, so a mutation that has
// drifted out of the tree fails loudly instead of quietly testing nothing.
//
// ⚠️ THE POSITIVE CONTROLS ARE NOT DECORATION. Without `the unmutated tree
// passes`, `the same link is clean once the listing is published` and `a block
// matching the derived shape passes`, every red below would be equally
// consistent with a guard that refuses everything — which is the failure shape
// this repository keeps deleting.
// ─────────────────────────────────────────────────────────────────────────────
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { availabilityOf, availabilityRow } from '../channel-arming.mjs';
import { availabilityColumns, channelLabels, renderAvailability } from '../../sites/availability.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const GUARD = join(ROOT, 'tooling/ci/assert-availability.mjs');

const REGISTER = JSON.parse(readFileSync(join(ROOT, 'tooling/channel-register.json'), 'utf8'));
const CHANNELS = REGISTER.channels;
const APPS = JSON.parse(readFileSync(join(ROOT, 'catalog/apps.json'), 'utf8'));
const LISTINGS = APPS[0].listings;

/** A byte copy of the three trees the guard reads. */
function tree() {
  const d = mkdtempSync(join(tmpdir(), 'avail-'));
  for (const rel of ['tooling', 'catalog', 'sites/nikatru']) {
    mkdirSync(join(d, rel), { recursive: true });
    cpSync(join(ROOT, rel), join(d, rel), { recursive: true });
  }
  return d;
}
const run = (d) => {
  const r = spawnSync(process.execPath, [GUARD, d], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
function edit(d, rel, from, to) {
  const p = join(d, rel);
  const s = readFileSync(p, 'utf8');
  assert.ok(s.includes(from), `ANCHOR GONE in ${rel}: ${JSON.stringify(from.slice(0, 60))}`);
  writeFileSync(p, s.replace(from, to));
}
const writeJson = (d, rel, v) => writeFileSync(join(d, rel), JSON.stringify(v, null, 2) + '\n');

/**
 * Re-run the real discovery generator over a fixture, after a catalogue change.
 *
 * The generator reads the SITE FEED (`sites/_shared/_data/apps.json`), which
 * `tooling/sites/generate-apps-data.mjs` derives from the catalogue; the fixture
 * copies neither, so both are written here from the same mutated rows. That is
 * the same two-step the real tree performs — catalogue, then feed, then pages —
 * and doing it by hand keeps this file's promise that every fixture is the real
 * tree mutated rather than a toy.
 */
function regenerate(d, catalogue) {
  mkdirSync(join(d, 'sites/_shared/_data'), { recursive: true });
  writeJson(d, 'sites/_shared/_data/apps.json', catalogue);
  const r = spawnSync(process.execPath, [join(ROOT, 'tooling/sites/generate-discovery.mjs'), d], { encoding: 'utf8' });
  assert.equal(r.status, 0, `the fixture generator must succeed: ${r.stdout}${r.stderr}`);
}

// ── THE DERIVATION, against the REAL register ────────────────────────────────

test('the real register yields 6 tiles for the real catalogue, and exactly one is live', () => {
  const row = availabilityRow(CHANNELS, LISTINGS);
  assert.equal(row.shown, 6);
  assert.equal(row.live, 1);
  assert.equal(row.soon, 5);
  assert.deepEqual(row.lost, []);
});

test('🔴 the ONE live channel is `web` — not the first row, and not the App Store', () => {
  const row = availabilityRow(CHANNELS, LISTINGS);
  const live = row.tiles.filter((t) => t.state === 'live').map((t) => t.id);
  assert.deepEqual(live, ['web']);
  for (const id of ['ios-appstore', 'macos-appstore', 'android-play', 'windows-store', 'linux-snap']) {
    assert.equal(row.tiles.find((t) => t.id === id).state, 'soon', `${id} must not be rendered live`);
  }
});

test('a row that is neither served nor submittable renders no tile at all', () => {
  const row = availabilityRow(CHANNELS, LISTINGS);
  const ids = row.tiles.map((t) => t.id);
  for (const id of ['windows-direct', 'linux-appimage', 'apps-gov-in', 'chrome-webstore', 'edge-addons', 'amo']) {
    assert.ok(!ids.includes(id), `${id} is neither served nor submittable and must be absent`);
  }
});

test('ONE renderable channel gives one tile and the count reads "1 of 1 channel live"', () => {
  const one = CHANNELS.map((c) => (c.id === 'web' ? c : { ...c, served: false, submittable: false }));
  const r = renderAvailability(one, LISTINGS);
  assert.equal(r.shown, 1);
  assert.equal(r.live, 1);
  assert.match(r.html, /1 of 1 channel live/);
  assert.equal((r.html.match(/<li\b/g) ?? []).length, 1);
  assert.match(r.html, /--avail-cols:1/);
});

test('SEVEN renderable channels give seven tiles once apps-gov-in is armed and keyed', () => {
  const seven = CHANNELS.map((c) =>
    c.id === 'apps-gov-in' ? { ...c, submittable: true, storefrontKey: 'appsgovin' } : c,
  );
  const r = renderAvailability(seven, { ...LISTINGS, appsgovin: null });
  assert.equal(r.shown, 7);
  assert.equal(r.live, 1);
  assert.match(r.html, /1 of 7 channels live/);
  assert.equal((r.html.match(/<li\b/g) ?? []).length, 7);
  assert.match(r.html, /--avail-cols:4/);
  assert.deepEqual(r.lost, []);
});

test('SEVEN channels all published render seven LIVE tiles', () => {
  const seven = CHANNELS.map((c) =>
    c.id === 'apps-gov-in' ? { ...c, submittable: true, storefrontKey: 'appsgovin' } : c,
  );
  const keys = Object.keys({ ...LISTINGS, appsgovin: null });
  const all = Object.fromEntries(keys.map((k) => [k, `https://example.test/${k}`]));
  const r = renderAvailability(seven, all);
  assert.equal(r.shown, 7);
  assert.equal(r.live, 7);
  assert.match(r.html, /7 of 7 channels live/);
  assert.equal((r.html.match(/class="avail-tile is-live"/g) ?? []).length, 7);
});

test('a submittable channel whose storefrontKey is null still renders nothing', () => {
  const a = availabilityOf({ id: 'x', name: 'X', submittable: true, served: false, storefrontKey: null }, {});
  assert.equal(a.renders, false);
  assert.equal(a.state, 'absent');
  assert.match(a.why, /storefrontKey/);
});

test('🔴 a renderable row the listings block never mentions is COVERAGE LOST, not a tile', () => {
  const gap = { ...LISTINGS };
  delete gap.appstore;
  const row = availabilityRow(CHANNELS, gap);
  assert.equal(row.shown, 5);
  assert.equal(row.lost.length, 1);
  assert.match(row.lost[0], /ios-appstore/);
  assert.match(row.lost[0], /Absent is not null/);
});

test('the three states are exactly live, soon and absent — a fourth is a design change', () => {
  const seen = new Set(CHANNELS.map((c) => availabilityOf(c, LISTINGS).state));
  for (const s of seen) assert.ok(['live', 'soon', 'absent'].includes(s), `unexpected state ${s}`);
});

// ── LABELS AND LAYOUT ────────────────────────────────────────────────────────

test('a trailing parenthetical is dropped only when the short label stays unique', () => {
  const row = availabilityRow(CHANNELS, LISTINGS);
  const labels = channelLabels(row.tiles);
  assert.ok(labels.includes('Web'), 'the web row shortens, because "Web" is unique');
  assert.ok(labels.includes('Apple App Store (iOS)'), 'the Apple pair keeps its parenthetical, because it collides');
  assert.ok(labels.includes('Apple App Store (macOS)'));
  assert.equal(new Set(labels).size, labels.length, 'no two tiles may read the same');
});

test('the column count balances rows and never exceeds four', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(availabilityColumns), [1, 2, 3, 4, 3, 3, 4, 4, 3]);
});

test('a coming-soon tile is not a link, and says so in words rather than in colour alone', () => {
  const r = renderAvailability(CHANNELS, LISTINGS);
  const soon = r.html.split('\n').filter((l) => l.includes('is-soon'));
  assert.equal(soon.length, 5);
  for (const line of soon) {
    assert.ok(!line.includes('<a '), 'a tile with no destination must not be focusable');
    assert.match(line, /Coming soon/);
  }
});

test('no bracketed placeholder reaches the rendered markup', () => {
  const r = renderAvailability(CHANNELS, LISTINGS);
  assert.ok(!/\[[A-Z][^\]]*\]/.test(r.html), 'a placeholder is fine on a canvas and is a defect on a served page');
});

// ── THE GUARD, over byte copies of the real tree ─────────────────────────────

test('GREEN CONTROL · the unmutated tree passes', () => {
  const d = tree();
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('a real link naming Google Play FAILS while the listing is null', () => {
  const d = tree();
  edit(d, 'sites/nikatru/contact.html', '</body>', '<a href="https://play.google.com/store/apps/details?id=x">Google Play</a></body>');
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /android-play/);
});

test('a store named only in an <img alt> inside the link is still caught', () => {
  const d = tree();
  edit(d, 'sites/nikatru/contact.html', '</body>', '<a href="https://apps.microsoft.com/x"><img src="/b.png" alt="Microsoft Store"></a></body>');
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /windows-store/);
});

test('POSITIVE CONTROL · the same link is clean once the catalogue publishes that listing', () => {
  const d = tree();
  edit(d, 'sites/nikatru/contact.html', '</body>', '<a href="https://play.google.com/store/apps/details?id=x">Google Play</a></body>');
  const cat = JSON.parse(readFileSync(join(d, 'catalog/apps.json'), 'utf8'));
  cat[0].listings.play = 'https://play.google.com/store/apps/details?id=x';
  writeJson(d, 'catalog/apps.json', cat);
  // 🔴 AND THE GENERATED PAGES ARE REGENERATED, because publishing a listing
  // legitimately changes the availability row from 1-of-6 live to 2-of-6 — and
  // sites/nikatru/apps/subly.html is COMMITTED (Cloudflare serves the repo with
  // no build step). Leaving the stale page in the fixture makes limb B fire on a
  // real disagreement, so this control would go red for the correct reason while
  // asserting nothing about limb C, the thing it exists to hold down. That limb
  // B fires at all here is the evidence it now has a domain: before the landings
  // rendered the row, the guard reported "0 generated availability block(s)".
  regenerate(d, cat);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('🔴 the committed landing IS re-derived — publish a listing and DO NOT regenerate, and limb B fires', () => {
  // The mutation the control above repairs, left in place. This is the drift
  // limb's own failing input: the register and the catalogue moved, the served
  // bytes did not, and what a visitor reads is the served bytes.
  const d = tree();
  const cat = JSON.parse(readFileSync(join(d, 'catalog/apps.json'), 'utf8'));
  cat[0].listings.play = 'https://play.google.com/store/apps/details?id=x';
  writeJson(d, 'catalog/apps.json', cat);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /an availability block renders 6 tile\(s\) of which 1 are links/);
  assert.match(r.out, /never regenerated/);
});

test('a store name inside a <script> string is not read as a link', () => {
  const d = tree();
  edit(d, 'sites/nikatru/contact.html', '</body>', '<script>var s="<a href=\'https://x\'>Google Play</a>";</script></body>');
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('a tile linking somewhere the catalogue never published FAILS', () => {
  const d = tree();
  edit(
    d,
    'sites/nikatru/contact.html',
    '</body>',
    '<ul class="avail-tiles"><li class="avail-tile is-live"><a class="avail-inner" href="https://evil.test/x">Web</a></li></ul></body>',
  );
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /evil\.test/);
});

test('a committed block whose counts no app derives FAILS as drift', () => {
  const d = tree();
  const live = LISTINGS.web;
  const tile = `<li class="avail-tile is-live"><a class="avail-inner" href="${live}">Web</a></li>`;
  edit(d, 'sites/nikatru/contact.html', '</body>', `<ul class="avail-tiles">${tile.repeat(2)}</ul></body>`);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /derives that shape/);
});

test('POSITIVE CONTROL · a block matching the derived shape passes', () => {
  const d = tree();
  const live = `<li class="avail-tile is-live"><a class="avail-inner" href="${LISTINGS.web}">Web</a></li>`;
  const soon = '<li class="avail-tile is-soon"><span class="avail-inner">Coming soon</span></li>';
  edit(d, 'sites/nikatru/contact.html', '</body>', `<ul class="avail-tiles">${live}${soon.repeat(5)}</ul></body>`);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  // TWO blocks, not one: this snippet's, plus the REAL one on
  // sites/nikatru/apps/subly.html since the landings started rendering the row
  // on 2026-09-09. The number is asserted rather than left loose precisely
  // because it is the guard's own floor against a shrinking subject — the run
  // that reported "0 generated availability block(s)" for weeks was a run whose
  // A and B limbs ranged over nothing, and it looked exactly like a pass.
  assert.match(r.out, /2 generated availability block\(s\) found, carrying 2 tile link\(s\)/);
});

// ── THE PARSING CONTRACT ─────────────────────────────────────────────────────
// 🔴 A REGEX OVER HTML IS ONLY AS GOOD AS THE SHAPES IT HAS BEEN SHOWN. Limb C's
// value is entirely in whether it survives the markup a person actually writes,
// and every one of these was a way the first draft could have missed a real
// badge while reporting clean. The three negatives are the other half: a limb
// that flags "Pricing" is a limb somebody switches off.

// ⚠️ THESE ARE EIGHT `test()` DECLARATIONS AND NOT A TABLE IN A LOOP, DELIBERATELY.
// assert-guard-coverage.mjs's ratchet counts DECLARATIONS in the source, while
// assert-case-count-honest.mjs counts what node REPORTED running. A loop over a
// table makes those two disagree by seven — the floor reads 1 where the run
// reports 8 — and a floor that cannot see seven of the cases it is meant to hold
// is exactly the coverage a ratchet exists to stop leaking.
/** Paste one snippet in front of `</body>` on a real page and run the guard. */
function withSnippet(snippet) {
  const d = tree();
  edit(d, 'sites/nikatru/contact.html', '</body>', `${snippet}</body>`);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  return r;
}

test('limb C catches a single-quoted href', () => {
  const r = withSnippet("<a href='https://play.google.com/x'>Google Play</a>");
  assert.equal(r.code, 1, r.out);
});

test('limb C catches an UPPERCASE tag and attribute', () => {
  const r = withSnippet('<A HREF="https://play.google.com/x">Google Play</A>');
  assert.equal(r.code, 1, r.out);
});

test('limb C catches newlines and padding around the link text', () => {
  const r = withSnippet('<a href="https://play.google.com/x">\n   Google Play\n </a>');
  assert.equal(r.code, 1, r.out);
});

test('limb C catches a <span> nested around the store name', () => {
  const r = withSnippet('<a href="https://play.google.com/x"><span>Google Play</span></a>');
  assert.equal(r.code, 1, r.out);
});

test('limb C catches the register name carried WITH its parenthetical', () => {
  const r = withSnippet('<a href="https://apps.apple.com/x">Apple App Store (iOS)</a>');
  assert.equal(r.code, 1, r.out);
});

test('limb C does not flag an ordinary internal link', () => {
  const r = withSnippet('<a href="/pricing">Pricing</a>');
  assert.equal(r.code, 0, r.out);
});

test('limb C does not flag a bare word that is only PART of a store name', () => {
  const r = withSnippet('<a href="/x">Play</a>');
  assert.equal(r.code, 0, r.out);
});

test('limb C does not flag a badge row commented out of the markup', () => {
  const r = withSnippet('<!-- <a href="https://play.google.com/x">Google Play</a> -->');
  assert.equal(r.code, 0, r.out);
});

test('COVERAGE LOST · an empty register refuses rather than reporting clean', () => {
  const d = tree();
  writeJson(d, 'tooling/channel-register.json', { ...REGISTER, channels: [] });
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 2);
  assert.match(r.out, /COVERAGE LOST/);
});

test('COVERAGE LOST · a renderable row the catalogue never mentions refuses', () => {
  const d = tree();
  const cat = JSON.parse(readFileSync(join(d, 'catalog/apps.json'), 'utf8'));
  delete cat[0].listings.appstore;
  writeJson(d, 'catalog/apps.json', cat);
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /COVERAGE LOST/);
  assert.match(r.out, /ios-appstore/);
});

test('COVERAGE LOST · a site with no HTML refuses', () => {
  const d = tree();
  rmSync(join(d, 'sites/nikatru'), { recursive: true, force: true });
  mkdirSync(join(d, 'sites/nikatru'), { recursive: true });
  const r = run(d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.code, 2);
  assert.match(r.out, /COVERAGE LOST/);
});
