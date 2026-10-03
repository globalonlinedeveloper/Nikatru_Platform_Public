// ─────────────────────────────────────────────────────────────────────────────
// snap-update-row.test.mjs — a stamped app is served its snapcraft.io page on
// `linux-snap` by the stamp itself (tooling/kit/snap-update-row.mjs, run by
// stamp-app.mjs), so [10]D-8 grades a new app green without a hand-typed row.
//
// Every case runs against a COPY of the real services/platform/src/app-config-data.json
// and the real tooling/channel-register.json, in a throwaway root. The red
// control is the state the App brick lane measured on PR #1165: a stamped
// probe with no entry, which the real D-8 rules (update-exit.mjs) fail with
// "'probe' is served null on 'linux-snap', which is armed".
//
// Run:  node --test tooling/ci/test/snap-update-row.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, withSnapUpdateRow, servedSnapUrl, CONFIG_DATA } from '../../kit/snap-update-row.mjs';
import { updateExitFindings, parseStoreListingChannels, snapcraftUrl } from '../update-exit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_CONFIG = readFileSync(join(ROOT, ...CONFIG_DATA.split('/')), 'utf8');
const CHANNELS = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8')).channels;
const STORE_LISTING = parseStoreListingChannels(readFileSync(join(ROOT, 'packages', 'core', 'lib', 'src', 'config', 'update_exit.dart'), 'utf8'));
const SNAP = 'probe-s-e-book-co';
const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A throwaway root: the real config, and apps/<id> with the snap name a stamp writes. */
function fixture({ id = 'probe', snapName = SNAP, config = REAL_CONFIG } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snap-row-'));
  temps.push(root);
  mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
  writeFileSync(join(root, ...CONFIG_DATA.split('/')), config);
  if (snapName !== null) {
    mkdirSync(join(root, 'apps', id, 'store', 'linux-snap'), { recursive: true });
    writeFileSync(join(root, 'apps', id, 'store', 'linux-snap', 'snap-name.txt'), `${snapName}\n`);
  }
  return root;
}
const configOf = (root) => readFileSync(join(root, ...CONFIG_DATA.split('/')), 'utf8');
const run = (root, ...argv) => {
  const out = [];
  const code = main(argv, { root, log: (l) => out.push(l), error: (l) => out.push(l) });
  return { code, out: out.join('\n') };
};
/** The real D-8 findings for `id` on linux-snap, from the config text. */
function snapFindings(text, id, snapName = SNAP) {
  const data = JSON.parse(text);
  const served = new Map([['linux-snap', servedSnapUrl(data, id) ?? data.defaults.update_url['linux-snap'] ?? data.defaults.update_url.default]]);
  const rows = CHANNELS.filter((r) => r.id === 'linux-snap');
  assert.equal(rows.length, 1, 'tooling/channel-register.json declares no linux-snap row');
  return updateExitFindings({ rows, served, appId: id, storeListing: STORE_LISTING, snapName }).fail;
}

describe('snap-update-row.mjs — the stamp serves a new app its snapcraft.io page', () => {
  test('RED CONTROL: the real config leaves a stamped probe served null, and D-8 fails it; --check exits 1', () => {
    const fails = snapFindings(REAL_CONFIG, 'probe');
    assert.equal(fails.length, 1, `expected the PR #1165 App brick finding, got ${JSON.stringify(fails)}`);
    assert.match(fails[0], /'probe' is served null on 'linux-snap', which is armed/);
    const root = fixture();
    const r = run(root, '--check', '--app', 'probe');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'probe' is not served https:\/\/snapcraft\.io\/probe-s-e-book-co on linux-snap/);
    assert.equal(configOf(root), REAL_CONFIG, '--check wrote the config');
  });

  test('--write adds exactly one line, D-8 then passes the probe, --check exits 0, and a second --write changes nothing', () => {
    const root = fixture();
    const w = run(root, '--write', '--app', 'probe');
    assert.equal(w.code, 0, w.out);
    const after1 = configOf(root);
    const added = after1.split('\n').filter((l) => !REAL_CONFIG.split('\n').includes(l));
    assert.deepEqual(added, [`    "probe": { "update_url": { "linux-snap": "${snapcraftUrl(SNAP)}" } },`]);
    assert.equal(after1.split('\n').length, REAL_CONFIG.split('\n').length + 1);
    assert.deepEqual(snapFindings(after1, 'probe'), []);
    assert.equal(run(root, '--check', '--app', 'probe').code, 0);
    assert.equal(run(root, '--write', '--app', 'probe').code, 0);
    assert.equal(configOf(root), after1, 'a re-stamp rewrote the config');
  });

  test('app #1 is already served its page on the real tree: --write is a no-op', () => {
    const root = fixture({ id: 'subscriptiontracker', snapName: 'nikatru-subscription-tracker' });
    assert.equal(run(root, '--write', '--app', 'subscriptiontracker').code, 0);
    assert.equal(configOf(root), REAL_CONFIG);
  });

  test('an existing entry serving something else is refused, never rewritten', () => {
    const root = fixture({ id: 'subscriptiontracker', snapName: 'some-other-snap' });
    const r = run(root, '--write', '--app', 'subscriptiontracker');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /apps\.subscriptiontracker already exists and serves "https:\/\/snapcraft\.io\/nikatru-subscription-tracker"/);
    assert.equal(configOf(root), REAL_CONFIG);
  });

  test('no snap name, a malformed one, or a bad id is COVERAGE LOST / usage (exit 2), and nothing is written', () => {
    for (const [opts, argv] of [
      [{ snapName: null }, ['--write', '--app', 'probe']],
      [{ snapName: 'Not A Snap' }, ['--write', '--app', 'probe']],
      [{}, ['--write', '--app', '../probe']],
      [{}, ['--write', '--check', '--app', 'probe']],
      [{}, ['--write']],
    ]) {
      const root = fixture(opts);
      const r = run(root, ...argv);
      assert.equal(r.code, 2, `${JSON.stringify(argv)} ${JSON.stringify(opts)}: ${r.out}`);
      assert.equal(configOf(root), REAL_CONFIG);
    }
  });

  test('an insertion that is not exactly one entry is refused (no `  "apps": {` anchor)', () => {
    const r = withSnapUpdateRow('{"apps":{}}', 'probe', snapcraftUrl(SNAP));
    assert.equal(r.text, null);
    assert.match(r.problem, /no `  "apps": \{` line/);
  });
});
