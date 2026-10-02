// ─────────────────────────────────────────────────────────────────────────────
// stamp-shared-snap.test.mjs — the stamp serves a new app its Snap Store page
// (tooling/kit/stamp-shared.mjs planSnapUpdateUrls), graded by the SAME [10]D-8
// rules assert-stamp-properties.mjs runs (tooling/ci/update-exit.mjs).
//
// ⏱ 2026-10-02 · club rt-web fix round. The `linux-snap` row is ARMED, so D-8
// requires every catalogued app to be served https://snapcraft.io/<snap-name>.
// The brick stamps store/linux-snap/snap-name.txt and nothing served it, so the
// App brick job's freshly stamped probe failed assert-stamp-properties with
// "'probe' is served null on 'linux-snap'". The red control below is that
// finding, reproduced on a copy of the real register files.
//
// Run:  node --test tooling/ci/test/stamp-shared-snap.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSnapUpdateUrls, PLATFORM_CONFIG_DATA, CHANNEL_REGISTER } from '../../kit/stamp-shared.mjs';
import { parseStoreListingChannels, updateExitFindings } from '../update-exit.mjs';
import { CATALOG_DIR, readCatalogFile } from '../../catalog/read.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOGUE = `${CATALOG_DIR}/apps.json`;
const UPDATE_EXIT_DART = 'packages/core/lib/src/config/update_exit.dart';
const APP = 'probe';
const SNAP = 'probe-s-e-book-co';

let root;
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const copy = (rel) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  cpSync(join(REPO, rel), join(root, rel));
};

/** The served value per channel, merged the way the Worker and the guard merge it. */
function served(data, appId, channels) {
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = data.apps?.[appId];
  const d = data.defaults?.update_url;
  const merged = isMap(own) && Object.hasOwn(own, 'update_url') ? (isMap(own.update_url) && isMap(d) ? { ...d, ...own.update_url } : own.update_url) : d;
  const out = new Map();
  for (const row of channels) {
    if (!isMap(merged)) out.set(row.id, merged);
    else out.set(row.id, Object.hasOwn(merged, row.id) ? merged[row.id] : merged.default);
  }
  return out;
}

function grade(appId, snapName) {
  const channels = JSON.parse(read(CHANNEL_REGISTER)).channels;
  const storeListing = parseStoreListingChannels(readFileSync(join(REPO, UPDATE_EXIT_DART), 'utf8'));
  return updateExitFindings({ rows: channels, served: served(JSON.parse(read(PLATFORM_CONFIG_DATA)), appId, channels), appId, storeListing, snapName });
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'nikatru-stamp-snap-'));
  for (const rel of [PLATFORM_CONFIG_DATA, CHANNEL_REGISTER, CATALOGUE, 'apps/subscriptiontracker/store/linux-snap/snap-name.txt']) copy(rel);
  // What a stamp leaves: the catalogue row and the brick's snap-name.txt.
  const cat = readCatalogFile(root, CATALOGUE).value;
  cat.push({ ...cat.find((r) => r.slug === 'subscriptiontracker'), slug: APP });
  writeFileSync(join(root, CATALOGUE), JSON.stringify(cat, null, 2) + '\n');
  mkdirSync(join(root, 'apps', APP, 'store', 'linux-snap'), { recursive: true });
  writeFileSync(join(root, 'apps', APP, 'store', 'linux-snap', 'snap-name.txt'), `${SNAP}\n`);
});
after(() => rmSync(root, { recursive: true, force: true }));

describe('stamp-shared.mjs planSnapUpdateUrls — a stamped app is served its own snapcraft.io page', () => {
  test('RED CONTROL: before the plan, [10]D-8 fails the stamped app on linux-snap, exactly as the App brick job did', () => {
    const v = grade(APP, SNAP);
    assert.ok(v.fail.some((l) => l.includes(`'${APP}' is served null on 'linux-snap'`)), v.fail.join('\n'));
  });

  test('the plan writes apps.<id>.update_url["linux-snap"] only, and [10]D-8 then passes on every channel', () => {
    const before = read(PLATFORM_CONFIG_DATA);
    const plan = planSnapUpdateUrls(root);
    assert.deepEqual(plan.lost, []);
    assert.deepEqual(plan.added, [APP]);
    writeFileSync(join(root, PLATFORM_CONFIG_DATA), plan.after);
    const data = JSON.parse(plan.after);
    assert.deepEqual(data.apps[APP], { update_url: { 'linux-snap': `https://snapcraft.io/${SNAP}` } });
    // nothing else moved: every other app and the defaults are byte-for-byte what they were
    const was = JSON.parse(before);
    delete data.apps[APP];
    assert.deepEqual(data, was);
    assert.deepEqual(grade(APP, SNAP).fail, []);
    assert.deepEqual(grade('subscriptiontracker', 'nikatru-subscription-tracker').fail, []);
  });

  test('a re-stamp writes nothing, and a value already served on that key is never overwritten', () => {
    assert.equal(planSnapUpdateUrls(root).after, read(PLATFORM_CONFIG_DATA));
    const j = JSON.parse(read(PLATFORM_CONFIG_DATA));
    j.apps[APP].update_url['linux-snap'] = 'https://snapcraft.io/a-decision';
    writeFileSync(join(root, PLATFORM_CONFIG_DATA), JSON.stringify(j, null, 2) + '\n');
    const plan = planSnapUpdateUrls(root);
    assert.deepEqual(plan.added, []);
    assert.equal(plan.after, plan.before);
  });

  test('a snap-name.txt that is not a snap name is COVERAGE LOST, never a URL', () => {
    writeFileSync(join(root, 'apps', APP, 'store', 'linux-snap', 'snap-name.txt'), '../../evil\n');
    const j = JSON.parse(read(PLATFORM_CONFIG_DATA));
    delete j.apps[APP];
    writeFileSync(join(root, PLATFORM_CONFIG_DATA), JSON.stringify(j, null, 2) + '\n');
    const plan = planSnapUpdateUrls(root);
    assert.equal(plan.lost.length, 1);
    assert.match(plan.lost[0], /not a snap name/);
  });
});
