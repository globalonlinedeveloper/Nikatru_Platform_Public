// ─────────────────────────────────────────────────────────────────────────────
// update-exit.test.mjs — the [10]D-8 rules tooling/ci/update-exit.mjs owns
// (O-FORCE-UPDATE-VERSION-READ-UNPROVEN): every live OR ARMED app row is graded
// by how its force-update wall exits. Each red case below is one of the row's
// red controls; the same controls were run against the real tree by mutating
// services/platform/src/app-config-data.json and tooling/channel-register.json.
//
// Run:  node --test tooling/ci/test/update-exit.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseStoreListingChannels,
  isHomepage,
  gradedBecause,
  updateExitFindings,
  snapcraftUrl,
} from '../update-exit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LANE = { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' };
const DEFERRED = { reason: 'deferred' };
const STORE_LISTING = new Set(['android-play', 'ios-appstore', 'macos-appstore', 'windows-store']);

const row = (id, extra = {}) => ({ id, kind: 'store', surface: 'app', platforms: ['android'], served: false, submittable: false, lane: null, deferral: DEFERRED, ...extra });
const armed = (r) => ({ ...r, submittable: true, lane: LANE });
const grade = (rows, served, snapName = 'nikatru-subscription-tracker') =>
  updateExitFindings({ rows, served: new Map(Object.entries(served)), appId: 'subscriptiontracker', storeListing: STORE_LISTING, snapName });

describe('update-exit.mjs — which rows are graded', () => {
  test('served, ARMED (submittable + lane) and undeferred rows are graded; web and extension rows never', () => {
    assert.equal(gradedBecause(row('a', { served: true })), 'served: true');
    assert.match(gradedBecause(armed(row('a'))), /^armed/);
    assert.equal(gradedBecause(row('a', { deferral: null })), 'no deferral');
    assert.equal(gradedBecause(row('a')), null, 'deferred, unserved and unarmed is not graded');
    assert.equal(gradedBecause(row('a', { submittable: true })), null, 'submittable with NO lane is not armed');
    assert.equal(gradedBecause(row('a', { submittable: true, lane: {} })), null, 'a malformed lane arms nothing');
    assert.equal(gradedBecause({ ...armed(row('w')), kind: 'web' }), null);
    assert.equal(gradedBecause({ ...armed(row('amo')), surface: 'extension' }), null);
    const { surface, ...noSurface } = armed(row('a'));
    assert.equal(surface, 'app');
    assert.match(gradedBecause(noSurface), /^armed/, 'a row that does not SAY it is not an app is graded');
  });
});

describe('update-exit.mjs — the rules', () => {
  test('GREEN: an armed store-listing row may be served null — its wall opens the listing', () => {
    assert.deepEqual(grade([armed(row('android-play'))], { 'android-play': null }).fail, []);
  });

  test('RED: a store row served a HOMEPAGE fails, armed or not', () => {
    for (const url of ['https://nikatru.com', 'https://nikatru.com/', 'https://example.org/']) {
      const r = grade([armed(row('android-play'))], { 'android-play': url });
      assert.equal(r.fail.length, 1, url);
      assert.match(r.fail[0], /HOMEPAGE/);
    }
    assert.match(grade([row('android-play')], { 'android-play': 'https://nikatru.com' }).fail[0], /HOMEPAGE/);
    assert.deepEqual(grade([armed(row('android-play'))], { 'android-play': 'https://play.google.com/store/apps/details?id=x' }).fail, []);
  });

  test('isHomepage: a site root only, never a path or a query', () => {
    assert.equal(isHomepage('https://nikatru.com'), true);
    assert.equal(isHomepage('https://nikatru.com/'), true);
    assert.equal(isHomepage('https://snapcraft.io/x'), false);
    assert.equal(isHomepage('https://nikatru.com/?a=1'), false);
    assert.equal(isHomepage('not a url'), false);
  });

  test('linux-snap: GREEN on its own snapcraft.io page, RED on null or any other URL', () => {
    const snap = armed({ ...row('linux-snap'), platforms: ['linux'] });
    assert.deepEqual(grade([snap], { 'linux-snap': snapcraftUrl('nikatru-subscription-tracker') }).fail, []);
    assert.match(grade([snap], { 'linux-snap': null }).fail[0], /must be the snap's own page/);
    assert.match(grade([snap], { 'linux-snap': 'https://snapcraft.io/other' }).fail[0], /must be the snap's own page/);
    assert.match(grade([snap], { 'linux-snap': null }, null).fail[0], /^COVERAGE LOST/);
  });

  test('apps-gov-in: unarmed with a dated pending note is GREEN', () => {
    const gov = row('apps-gov-in', { updateListingUrl: null, _updateListingUrlPending: '⏱ 2026-10-01 · waits for the portal' });
    assert.deepEqual(grade([gov], { 'apps-gov-in': null }).fail, []);
  });

  test('RED: apps-gov-in ARMED with no listing URL fails — the brief\'s second red control', () => {
    const gov = armed(row('apps-gov-in', { updateListingUrl: null, _updateListingUrlPending: '⏱ 2026-10-01 · waits for the portal' }));
    const r = grade([gov], { 'apps-gov-in': null });
    assert.equal(r.fail.length, 1);
    assert.match(r.fail[0], /records no `updateListingUrl`/);
  });

  test('RED: a null listing with no DATED pending note fails even unarmed', () => {
    assert.match(grade([row('apps-gov-in', { updateListingUrl: null })], {}).fail[0], /no dated `_updateListingUrlPending`/);
    assert.match(grade([row('apps-gov-in', { updateListingUrl: null, _updateListingUrlPending: 'soon' })], {}).fail[0], /no dated/);
  });

  test('apps-gov-in armed WITH a listing must be served exactly it', () => {
    const url = 'https://apps.mgov.gov.in/details?appid=123';
    const gov = armed(row('apps-gov-in', { updateListingUrl: url }));
    assert.deepEqual(grade([gov], { 'apps-gov-in': url }).fail, []);
    assert.match(grade([gov], { 'apps-gov-in': null }).fail[0], /the one place its wall may open/);
    assert.match(grade([row('apps-gov-in', { updateListingUrl: 'http://x' })], {}).fail[0], /not an https URL/);
  });

  test('a live DIRECT row still needs a served string (the pre-existing rule, kept)', () => {
    const direct = { ...row('linux-appimage'), kind: 'direct', platforms: ['linux'], deferral: null };
    assert.match(grade([direct], { 'linux-appimage': null }).fail[0], /an update_url of null while linux-appimage \(kind=direct, served=false, deferral=none\)/);
    assert.deepEqual(grade([direct], { 'linux-appimage': 'https://dl.nikatru.com/subscriptiontracker/linux' }).fail, []);
  });
});

describe('update-exit.mjs — the Dart half is read, not copied', () => {
  test("parseStoreListingChannels reads core's kStoreListingChannels, and nothing else", () => {
    const dart = readFileSync(join(ROOT, 'packages', 'core', 'lib', 'src', 'config', 'update_exit.dart'), 'utf8');
    assert.deepEqual(parseStoreListingChannels(dart), STORE_LISTING);
    assert.equal(parseStoreListingChannels('const x = 1;'), null);
    assert.equal(parseStoreListingChannels('kStoreListingChannels = <String>{};'), null);
  });

  test('every store-listing channel is a register row, and apps-gov-in and linux-snap are not among them', () => {
    const rows = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8')).channels;
    for (const id of STORE_LISTING) assert.ok(rows.some((r) => r.id === id), id);
    assert.ok(!STORE_LISTING.has('apps-gov-in'));
    assert.ok(!STORE_LISTING.has('linux-snap'));
  });
});
