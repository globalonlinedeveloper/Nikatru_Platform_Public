// ─────────────────────────────────────────────────────────────────────────────
// new-product-plan.test.mjs — `tooling/kit/new-product.mjs plan <id>` reads each
// product step from the tree, and each step's reader agrees with the guard that
// owns its sentinel (O-NEW-PRODUCT-HAS-NO-READOUT).
//
// THE PAIRING. For each reader: one fixture where it says not-DONE, and in that
// same fixture the guard owning the sentinel is run BY PATH and is red; and the
// DONE fixture, where that guard is green. So the readout cannot disagree with
// the guards without a case here going red. Two guards print rather than fail
// by their own design, and their cases assert the print instead: an armed
// channel's pending store record (assert-store-identity.mjs, OWNER-GATED) and an
// app origin host with no monitor row (assert-monitor-coverage.mjs, "printed not
// hidden"). The product-row reader's guard lives in the private corpus, which no
// test here can run, so its cases grade the reader alone.
//
// THE FIXTURE is a copy of every tracked file (`git ls-files`) under
// os.tmpdir() (ADR 072), made once; each case mutates it and restores it in a
// `finally`. The guards read that copy through their own root argument, so a
// fixture that passes is the real tree passing, and one mutation away from red.
//
// Every case is written out by hand, never in a loop (assert-no-loop-cases.mjs).
//
// Run:  node --single-threaded --test tooling/ci/test/new-product-plan.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO, STEPS, planProduct, exitCodeOf, main } from '../../kit/new-product.mjs';
import { main as pagesOriginMain } from '../../web/pages-origin.mjs';
import { APPS_CATALOG } from '../../kit/product-steps/tree.mjs';

const APP = 'subscriptiontracker';
let TMP;
let FX;

const at = (rel) => join(FX, ...rel.split('/'));
const repoFile = (rel) => join(REPO, ...rel.split('/'));

/** Replace `rel`'s text by `edit(text)`; returns the restore. The mutation must change something. */
function mutate(rel, edit) {
  const before = readFileSync(at(rel), 'utf8');
  const next = edit(before);
  assert.notEqual(next, before, `the mutation of ${rel} changed nothing, so this case would test the unmutated tree`);
  writeFileSync(at(rel), next);
  return () => writeFileSync(at(rel), before);
}

/** Move `rel` aside; returns the restore. */
function remove(rel) {
  renameSync(at(rel), `${at(rel)}.np15b-aside`);
  return () => renameSync(`${at(rel)}.np15b-aside`, at(rel));
}

/** Run a guard of THIS repository by path over the fixture. */
function guard(rel, ...args) {
  const r = spawnSync(process.execPath, [repoFile(rel), ...args], { cwd: FX, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** One step's answer over the fixture. */
function stepOf(stepName, id = APP, ctx = { privateRoot: null }) {
  const a = planProduct(FX, id, ctx).find((s) => s.name === stepName);
  assert.ok(a, `the readout has no step "${stepName}"`);
  return a;
}

/** The CLI over the fixture: `{ code, out, err }`. */
function cli(...argv) {
  const out = [];
  const err = [];
  const code = main(['plan', ...argv, '--root', FX, '--no-private'], { log: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

before(() => {
  TMP = realpathSync.native(mkdtempSync(join(tmpdir(), 'np15b-plan-')));
  FX = join(TMP, 'tree');
  const ls = spawnSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(ls.status, 0, `git ls-files failed: ${ls.stderr}`);
  const files = ls.stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 1000, `git ls-files listed ${files.length} file(s); the fixture would not be the tree`);
  for (const rel of files) {
    const to = join(FX, ...rel.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    try {
      copyFileSync(repoFile(rel), to);
    } catch (e) {
      // A tracked path deleted in the working tree is not part of what the guards read.
      if (e.code !== 'ENOENT') throw e;
    }
  }
});

after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

describe('the readout', () => {
  test('app #1 reads with no NEXT step, so --check exits 0', () => {
    const r = cli(APP, '--check');
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.match(r.out, /^DONE stamp — /m);
    assert.match(r.out, /^UNREAD product row — /m);
    assert.doesNotMatch(r.out, /^NEXT /m);
  });

  test('the steps are the twelve of plan §3.2 (with the tag filter), in order, and none is a crash sink', () => {
    assert.deepEqual(STEPS.map((s) => s.reader.name), [
      'id', 'pages origin', 'stamp', 'tag filter', 'backend', 'store records',
      'name clearance', 'sworn files', 'price row', 'monitor row', 'product row', 'bundle join',
    ]);
  });

  test('--expect-next passes only on the exact NEXT set', () => {
    const restore = remove(`apps/${APP}/name-clearance.json`);
    try {
      assert.equal(cli(APP, '--check').code, 1);
      assert.equal(cli(APP, '--check', '--expect-next', 'name clearance').code, 0);
      assert.equal(cli(APP, '--check', '--expect-next', 'name clearance,tag filter').code, 1);
    } finally {
      restore();
    }
    assert.equal(cli(APP, '--check', '--expect-next', 'name clearance').code, 1, 'a NEXT that is no longer there must fail --expect-next too');
  });

  test('a usage error is exit 2', () => {
    assert.equal(cli('--check', '--expect-next', 'no such step', APP).code, 2);
    assert.equal(main(['plan'], { log: () => {}, err: () => {} }), 2);
  });

  test('exitCodeOf: LOST beats NEXT, and OWNER, AFTER-LIVE and UNREAD are not NEXT', () => {
    assert.equal(exitCodeOf([{ state: 'NEXT', name: 'a' }, { lost: 'x', name: 'b' }], { check: true }), 2);
    assert.equal(exitCodeOf([{ state: 'OWNER' }, { state: 'AFTER-LIVE' }, { state: 'UNREAD' }], { check: true }), 0);
    assert.equal(exitCodeOf([{ state: 'NEXT', name: 'a' }], { check: false }), 0);
  });
});

describe('RC-H8: a reader whose source file is gone is COVERAGE LOST, naming the reader', () => {
  test('tooling/channel-register.json deleted → exit 2, first line names "tag filter"', () => {
    const restore = remove('tooling/channel-register.json');
    try {
      const r = cli(APP, '--check');
      assert.equal(r.code, 2);
      assert.match(r.err.split('\n')[0], /^✗ COVERAGE LOST — reader "tag filter" \(tooling\/kit\/product-steps\/tag-filter\.mjs\)/);
    } finally {
      restore();
    }
  });

  test('tooling/monitor-register.json deleted → exit 2, naming "monitor row"', () => {
    const restore = remove('tooling/monitor-register.json');
    try {
      const r = cli(APP);
      assert.equal(r.code, 2);
      assert.match(r.err, /reader "monitor row"/);
    } finally {
      restore();
    }
  });
});

describe('step 1 · id', () => {
  test('a refused id is NEXT, stops the plan, and stamp-app.mjs refuses it too', () => {
    const answers = planProduct(FX, 'habit_tracker', { privateRoot: null });
    assert.equal(answers.length, 1);
    assert.equal(answers[0].state, 'NEXT');
    const vars = join(TMP, 'bad-id-vars.json');
    writeFileSync(vars, JSON.stringify({ app_id: 'habit_tracker' }));
    const g = guard('tooling/kit/stamp-app.mjs', '--vars', vars, '--dry-run');
    assert.equal(g.status, 1, g.out);
  });

  test('an admitted id is DONE, and stamp-app.mjs --dry-run admits it', () => {
    assert.equal(stepOf('id').state, 'DONE');
    const vars = join(TMP, 'good-id-vars.json');
    writeFileSync(vars, JSON.stringify({ app_id: APP }));
    const g = guard('tooling/kit/stamp-app.mjs', '--vars', vars, '--dry-run');
    assert.equal(g.status, 0, g.out);
  });
});

describe('step 2 · pages origin', () => {
  test('RC-H7: no hosts.pagesOrigin → NEXT with O-G1\'s command, exit 1; pages-origin.mjs --check is red', async () => {
    const restore = mutate(`apps/${APP}/app.yaml`, (t) => t.replace(/^  pagesOrigin: .*\n/m, ''));
    try {
      const a = stepOf('pages origin');
      assert.equal(a.state, 'NEXT');
      assert.equal(a.command, `node tooling/web/pages-origin.mjs --apply ${APP}`);
      assert.match(a.owner, /^O-G1 /);
      const r = cli(APP, '--check');
      assert.equal(r.code, 1);
      assert.match(r.out, /^NEXT pages origin — /m);
      assert.equal(await pagesOriginMain(['--check', APP], { root: FX, log: () => {}, err: () => {} }), 1);
    } finally {
      restore();
    }
  });

  test('declared → DONE; pages-origin.mjs --check is green', async () => {
    assert.equal(stepOf('pages origin').state, 'DONE');
    assert.equal(await pagesOriginMain(['--check', APP], { root: FX, log: () => {}, err: () => {} }), 0);
  });

  test('no app.yaml yet → NEXT (the origin comes before the stamp)', () => {
    assert.equal(stepOf('pages origin', 'nextapp').state, 'NEXT');
  });
});

describe('step 3 · stamp', () => {
  test('the catalogue row missing → NEXT; regen.mjs --check is red', () => {
    const restore = mutate(APPS_CATALOG, (t) => JSON.stringify(JSON.parse(t).filter((a) => a.slug !== APP), null, 2) + '\n');
    try {
      assert.equal(stepOf('stamp').state, 'NEXT');
      assert.equal(guard('tooling/sites/regen.mjs', FX, '--check').status, 1);
    } finally {
      restore();
    }
  });

  test('stamped and catalogued → DONE; regen.mjs --check is green', () => {
    const a = stepOf('stamp');
    assert.equal(a.state, 'DONE', a.detail);
    assert.match(a.detail, /flutter-release-build\.mjs subscriptiontracker web web --print composes/);
    const g = guard('tooling/sites/regen.mjs', FX, '--check');
    assert.equal(g.status, 0, g.out);
  });

  test('C6: a declaration that does not compose a web build → NEXT; the composer --print is red', () => {
    const restore = mutate('tooling/channel-register.json', (t) => {
      const j = JSON.parse(t);
      j.channels.find((c) => c.id === 'web').platforms = ['android'];
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('stamp');
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /does not compose a web build/);
      assert.equal(guard('tooling/ci/flutter-release-build.mjs', APP, 'web', 'web', '--print', '--root', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('C6: the composer absent from the tree read → DONE, and the detail says the check is absent', () => {
    const restore = remove('tooling/ci/flutter-release-build.mjs');
    try {
      const a = stepOf('stamp');
      assert.equal(a.state, 'DONE');
      assert.match(a.detail, /is absent, so the build-composes check is absent/);
    } finally {
      restore();
    }
  });
});

describe('step 4 · tag filter', () => {
  test('the app lane\'s tags: list lacks the app → NEXT tag filter; tag-owner.mjs --check is red', () => {
    const restore = mutate('.github/workflows/build-platforms.yml', (t) => t.replace(`      - '${APP}-v*'\n`, ''));
    try {
      const a = stepOf('tag filter');
      assert.equal(a.state, 'NEXT');
      assert.equal(a.command, 'node tooling/ci/tag-owner.mjs --write');
      assert.match(cli(APP, '--check').out, /^NEXT tag filter — /m);
      assert.equal(guard('tooling/ci/tag-owner.mjs', '--check', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('owned by exactly one app lane → DONE; tag-owner.mjs --check is green', () => {
    assert.equal(stepOf('tag filter').state, 'DONE');
    const g = guard('tooling/ci/tag-owner.mjs', '--check', FX);
    assert.equal(g.status, 0, g.out);
  });
});

describe('step 5 · backend', () => {
  test('APP_DB still the all-zeros placeholder → NEXT provision-backend; assert-d1-bindings.mjs is red', () => {
    const restore = mutate(`services/${APP}-api/wrangler.jsonc`, (t) =>
      t.replace(/("binding"\s*:\s*"APP_DB"[\s\S]{0,400}?"database_id"\s*:\s*")[^"]+(")/, '$100000000-0000-0000-0000-000000000000$2'),
    );
    try {
      const a = stepOf('backend');
      assert.equal(a.state, 'NEXT');
      assert.equal(a.command, `node tooling/scripts/provision-backend.mjs ${APP}`);
      assert.equal(guard('tooling/ci/assert-d1-bindings.mjs', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('provisioned → DONE; assert-d1-bindings.mjs is green', () => {
    assert.equal(stepOf('backend').state, 'DONE');
    const g = guard('tooling/ci/assert-d1-bindings.mjs', FX);
    assert.equal(g.status, 0, g.out);
  });

  test('client-only (no hosts.api) → DONE by the declaration', () => {
    const restore = mutate(`apps/${APP}/app.yaml`, (t) => t.replace(/^  api: .*\n/m, ''));
    try {
      const a = stepOf('backend');
      assert.equal(a.state, 'DONE');
      assert.match(a.detail, /^client-only/);
    } finally {
      restore();
    }
  });
});

describe('step 6 · store records', () => {
  test('a pending record is OWNER O-A4, and assert-store-identity.mjs prints it OWNER-GATED', () => {
    // Both Apple channels: one App Store Connect record covers iOS and macOS, and the guard fails the pair split.
    const restore = mutate(`apps/${APP}/app.yaml`, (t) =>
      t
        .replace(/  ios-appstore:\n    state: issued\n    recordId: "\d+"\n/, '  ios-appstore:\n    state: pending\n')
        .replace(/  macos-appstore:\n    state: issued\n    recordId: "\d+"\n/, '  macos-appstore:\n    state: pending\n'),
    );
    try {
      const a = stepOf('store records');
      assert.equal(a.state, 'OWNER');
      assert.match(a.owner, /^O-A4 /);
      assert.match(a.detail, /ios-appstore/);
      const g = guard('tooling/ci/assert-store-identity.mjs', FX);
      assert.equal(g.status, 0, g.out);
      assert.match(g.out, /OWNER-GATED · app "subscriptiontracker" × ios-appstore/);
    } finally {
      restore();
    }
  });

  test('every record issued → DONE, and assert-store-identity.mjs prints no OWNER-GATED line for the app', () => {
    const restore = mutate(`apps/${APP}/app.yaml`, (t) => {
      const lines = t.split('\n');
      const start = lines.indexOf('stores:');
      const end = lines.indexOf('legal:');
      const block = [
        'stores:',
        '  windows-store:',
        '    identityName: 60210NIKATRU.NikatruSubscriptionTracker',
        '    packageFamilyName: 60210NIKATRU.NikatruSubscriptionTracker_ab30hnb4490ma',
        '    productId: 9NFIXTURE000',
        '    state: issued',
        '    declaredOn: null',
        '  ios-appstore:',
        '    state: issued',
        '    recordId: "6814737675"',
        '    declaredOn: null',
        '  macos-appstore:',
        '    state: issued',
        '    recordId: "6814737675"',
        '    declaredOn: null',
        '  android-play:',
        '    state: issued',
        '    appSigningSha256:',
        '      - "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF"',
        '    declaredOn: null',
        '  linux-snap:',
        '    state: issued',
        '    declaredOn: null',
        '',
      ];
      return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n');
    });
    try {
      assert.equal(stepOf('store records').state, 'DONE');
      const g = guard('tooling/ci/assert-store-identity.mjs', FX);
      assert.doesNotMatch(g.out, /OWNER-GATED · app "subscriptiontracker"/);
    } finally {
      restore();
    }
  });
});

describe('step 7 · name clearance', () => {
  test('no record → NEXT with the probe\'s command; assert-name-clearance.mjs is red', () => {
    const restore = remove(`apps/${APP}/name-clearance.json`);
    try {
      const a = stepOf('name clearance');
      assert.equal(a.state, 'NEXT');
      assert.equal(a.command, `node tooling/store/name-clearance.mjs "Nikatru Subscription Tracker" --app ${APP} --execute`);
      assert.equal(guard('tooling/ci/assert-name-clearance.mjs', '--repo', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('a ruled record → DONE; assert-name-clearance.mjs is green', () => {
    assert.equal(stepOf('name clearance').state, 'DONE');
    const g = guard('tooling/ci/assert-name-clearance.mjs', '--repo', FX);
    assert.equal(g.status, 0, g.out);
  });

  test('an unruled record → OWNER (the owner\'s trademark ruling)', () => {
    const restore = mutate(`apps/${APP}/name-clearance.json`, (t) => t.replace('"ruling": "PROCEED"', '"ruling": null'));
    try {
      assert.equal(stepOf('name clearance').state, 'OWNER');
    } finally {
      restore();
    }
  });
});

describe('step 8 · sworn files', () => {
  test('a preview declaration → OWNER O-A2; the submission check is red', () => {
    const restore = mutate(`apps/${APP}/store/android-play/data-safety.json`, (t) => t.replace('"sworn": true', '"sworn": false'));
    try {
      const a = stepOf('sworn files');
      assert.equal(a.state, 'OWNER');
      assert.match(a.owner, /^O-A2 /);
      assert.match(a.detail, /data-safety\.json/);
      assert.equal(guard('tooling/ci/assert-sworn-store-files.mjs', '--for-submission=android-play', '--app', APP, FX).status, 1);
    } finally {
      restore();
    }
  });

  test('sworn but never declared in the console (app #1 today) → OWNER; the real-submission check is red', () => {
    const a = stepOf('sworn files');
    assert.equal(a.state, 'OWNER');
    // ⏱ 2026-10-01: windows-store carries a sworn file too (its IARC age-rating answers).
    assert.match(a.detail, /^declaredOn null on android-play, ios-appstore, windows-store$/);
    assert.equal(guard('tooling/ci/assert-sworn-store-files.mjs', '--for-submission=android-play', '--app', APP, '--real-submission', FX).status, 1);
  });

  test('sworn and declared → DONE; the real-submission check is green', () => {
    const restore = mutate(`apps/${APP}/app.yaml`, (t) => t.replace(/declaredOn: null/g, 'declaredOn: 2026-09-20'));
    try {
      assert.equal(stepOf('sworn files').state, 'DONE');
      const g = guard('tooling/ci/assert-sworn-store-files.mjs', '--for-submission=android-play', '--app', APP, '--real-submission', FX);
      assert.equal(g.status, 0, g.out);
    } finally {
      restore();
    }
  });
});

describe('step 9 · price row', () => {
  test('a served offering with no price-book entry → NEXT; render-rail-prices.mjs --check is red', () => {
    const restore = mutate('services/platform/src/app-config-data.json', (t) => {
      const j = JSON.parse(t);
      delete j.prices.apps[APP].pro_monthly;
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('price row');
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /pro_monthly/);
      assert.equal(guard('tooling/catalog/render-rail-prices.mjs', FX, '--check').status, 1);
    } finally {
      restore();
    }
  });

  test('every served offering priced → DONE; render-rail-prices.mjs --check is green', () => {
    assert.equal(stepOf('price row').state, 'DONE');
    const g = guard('tooling/catalog/render-rail-prices.mjs', FX, '--check');
    assert.equal(g.status, 0, g.out);
  });

  test('an app serving no offering → DONE, no entry owed', () => {
    const a = stepOf('price row', 'nextapp');
    assert.equal(a.state, 'DONE');
    assert.match(a.detail, /serves no offering/);
  });
});

describe('step 10 · monitor row', () => {
  test('the API host with no row → OWNER O-E2; assert-monitor-coverage.mjs is red', () => {
    const restore = mutate('tooling/monitor-register.json', (t) => {
      const j = JSON.parse(t);
      j.hosts = j.hosts.filter((h) => h.hostname !== `${APP}-api.nikatru.com`);
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('monitor row');
      assert.equal(a.state, 'OWNER');
      assert.match(a.owner, /^O-E2 /);
      assert.match(a.detail, /no row: subscriptiontracker-api\.nikatru\.com/);
      assert.equal(guard('tooling/ci/assert-monitor-coverage.mjs', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('the origin host with no row → OWNER; assert-monitor-coverage.mjs prints it, by its design', () => {
    const restore = mutate('tooling/monitor-register.json', (t) => {
      const j = JSON.parse(t);
      j.hosts = j.hosts.filter((h) => h.hostname !== `${APP}-7qg.pages.dev`);
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      assert.equal(stepOf('monitor row').state, 'OWNER');
      const g = guard('tooling/ci/assert-monitor-coverage.mjs', FX);
      assert.equal(g.status, 0, g.out);
      assert.match(g.out, /app ORIGIN host\(s\) with no row[\s\S]*subscriptiontracker-7qg\.pages\.dev/);
    } finally {
      restore();
    }
  });

  test('every served host has a row and a monitor → DONE; assert-monitor-coverage.mjs is green and prints no origin gap', () => {
    assert.equal(stepOf('monitor row').state, 'DONE');
    const g = guard('tooling/ci/assert-monitor-coverage.mjs', FX);
    assert.equal(g.status, 0, g.out);
    assert.doesNotMatch(g.out, /app ORIGIN host\(s\) with no row/);
  });
});

describe('step 11 · product row (the private corpus; its guard runs there, not here)', () => {
  const privateFixture = (list) => {
    const dir = mkdtempSync(join(TMP, 'private-'));
    mkdirSync(join(dir, 'platform-state'));
    if (list !== undefined) writeFileSync(join(dir, 'platform-state', 'manifest.json'), JSON.stringify({ products: { list } }));
    return dir;
  };

  test('listed → DONE', () => {
    const dir = privateFixture([{ id: APP, kind: 'app', status: 'live' }]);
    assert.equal(stepOf('product row', APP, { privateRoot: dir }).state, 'DONE');
  });

  test('not listed → NEXT', () => {
    const dir = privateFixture([{ id: 'fullshot', kind: 'extension', status: 'preview' }]);
    assert.equal(stepOf('product row', APP, { privateRoot: dir }).state, 'NEXT');
  });

  test('a private root with no manifest → COVERAGE LOST', () => {
    const dir = privateFixture(undefined);
    assert.match(stepOf('product row', APP, { privateRoot: dir }).lost, /manifest\.json does not exist/);
  });

  test('no private root → UNREAD, which --check counts as neither a pass nor a NEXT', () => {
    assert.equal(stepOf('product row', APP, { privateRoot: null }).state, 'UNREAD');
  });
});

describe('step 12 · bundle join', () => {
  test('a live product → DONE', () => {
    assert.equal(stepOf('bundle join').state, 'DONE');
  });

  test('a preview product → AFTER-LIVE, which --check does not count', () => {
    const restore = mutate(APPS_CATALOG, (t) => t.replace('"status": "live"', '"status": "preview"'));
    try {
      assert.equal(stepOf('bundle join').state, 'AFTER-LIVE');
    } finally {
      restore();
    }
  });
});
