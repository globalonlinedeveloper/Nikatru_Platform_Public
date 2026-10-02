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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO, STEPS, STEPS_BY_KIND, planProduct, exitCodeOf, main, resolveKind } from '../../kit/new-product.mjs';
import { main as pagesOriginMain } from '../../web/pages-origin.mjs';
import { APPS_CATALOG } from '../../kit/product-steps/tree.mjs';
import { main as stampServiceMain } from '../../kit/stamp-service.mjs';
import { run as runStampShared } from '../../kit/stamp-shared.mjs';
import { BUNDLES_REGISTER, isStampedExclusion } from '../../catalog/read.mjs';
import { TEST_NOW_VAR } from '../../scripts/test-clock.mjs';

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

/** Run the FIXTURE's copy of a script by path: for the extension scripts, which take
 *  their root from `--repo-root` and their schema from beside themselves. */
function fxScript(rel, ...args) {
  const r = spawnSync(process.execPath, [at(rel), ...args], { cwd: FX, encoding: 'utf8' });
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

  test('an app\'s steps are the twelve of plan §3.2 (with the tag filter) and its Worker\'s crash sink, in order', () => {
    assert.deepEqual(STEPS.map((s) => s.reader.name), [
      'id', 'pages origin', 'stamp', 'tag filter', 'backend', 'crash sink', 'store records',
      'name clearance', 'sworn files', 'price row', 'monitor row', 'product row', 'bundle join',
    ]);
  });

  test('each kind has its own steps, and only an app\'s stamp a Flutter app or a Pages origin', () => {
    assert.deepEqual(STEPS_BY_KIND.extension.map((s) => s.reader.name), ['id', 'catalogue row', 'store listings', 'product row', 'bundle join']);
    assert.deepEqual(STEPS_BY_KIND.service.map((s) => s.reader.name), ['id', 'stamp', 'register row', 'backend', 'crash sink', 'monitor row', 'product row']);
    assert.deepEqual(STEPS_BY_KIND.site.map((s) => s.reader.name), ['id', 'site directory', 'deploy', 'product row']);
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

  // rv2-newproduct-015. stamp-app.mjs reads the claimed set of its own tree, which the
  // fixture copies, so the claim on `platform` is the same one on both sides.
  test('an id another product claims (platform, a service) is NEXT naming each claim, stops the plan, and stamp-app.mjs refuses it too', () => {
    const answers = planProduct(FX, 'platform', { privateRoot: null, kind: 'app' });
    assert.equal(answers.length, 1);
    assert.equal(answers[0].state, 'NEXT');
    assert.match(answers[0].detail, /^"platform" is already claimed: service id \(services\/platform\/wrangler\.jsonc, owned by service:platform\)/);
    assert.match(answers[0].detail, /D1 database "platform_db"/);
    const vars = join(TMP, 'claimed-id-vars.json');
    writeFileSync(vars, JSON.stringify({ app_id: 'platform' }));
    const g = guard('tooling/kit/stamp-app.mjs', '--vars', vars, '--dry-run');
    assert.equal(g.status, 1, g.out);
    assert.match(g.out, /"platform" is already claimed/);
  });

  test('a host label the platform already answers on (vault.nikatru.com) is claimed for every kind', () => {
    const a = stepOf('id', 'vault', { privateRoot: null, kind: 'service' });
    assert.equal(a.state, 'NEXT');
    assert.match(a.detail, /host vault\.nikatru\.com \(tooling\/monitor-register\.json, owned by host:vault\.nikatru\.com\)/);
  });

  test('app #1\'s own Worker, database and API host are its own claims, not clashes', () => {
    const a = stepOf('id');
    assert.equal(a.state, 'DONE');
    assert.match(a.detail, /no other product claims it/);
  });

  test('a stamped app whose catalogue row is missing keeps its Worker: the id is still DONE, never a service clash', () => {
    const restore = mutate(APPS_CATALOG, (t) => JSON.stringify(JSON.parse(t).filter((a) => a.slug !== APP), null, 2) + '\n');
    try {
      assert.equal(stepOf('id').state, 'DONE');
    } finally {
      restore();
    }
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
    // ON THE REAL CLOCK, deliberately: --check grades the LIVE fee register's
    // asOf dates against today (a fee cell is re-read within 90 days), so on a
    // time-travel run it would grade a future nobody has re-read yet. The date
    // that register next goes stale is an ops obligation, not a test fuse.
    const r = spawnSync(process.execPath, [repoFile('tooling/catalog/render-rail-prices.mjs'), FX, '--check'], {
      cwd: FX,
      encoding: 'utf8',
      env: { ...process.env, [TEST_NOW_VAR]: '' },
    });
    assert.equal(r.status, 0, `${r.stdout ?? ''}${r.stderr ?? ''}`);
  });

  // rv2-newproduct-002. The absent row is served the defaults, so no guard of this
  // repository is red on it (render-rail-prices joins only declared offerings,
  // assert-render-payload overlays the defaults): the reader leads the guards here,
  // and the case grades the reader alone.
  test('no apps.<id> row → NEXT, never "free": the price is undecided, not declared', () => {
    const a = stepOf('price row', 'nextapp', { privateRoot: null, kind: 'app' });
    assert.equal(a.state, 'NEXT');
    assert.match(a.detail, /has no apps\.nextapp row/);
    assert.match(a.command, /"offerings": \[\]\}` declares it free/);
  });

  // ⏱ 2026-10-02 · the stamp now writes apps.<id> (its Snap Store update_url only,
  // stamp-shared.mjs planSnapUpdateUrls). Red control: the reader that took any
  // row's absent offerings as `[]` answered DONE here.
  test('apps.<id> carrying only the stamped update_url → NEXT: a row is not a paywall decision', () => {
    const restore = mutate('services/platform/src/app-config-data.json', (t) => {
      const j = JSON.parse(t);
      j.apps.nextapp = { update_url: { 'linux-snap': 'https://snapcraft.io/nextapp' } };
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('price row', 'nextapp', { privateRoot: null, kind: 'app' });
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /declares no paywall\.offerings/);
      assert.match(a.command, /"offerings": \[\]\}` declares it free/);
    } finally {
      restore();
    }
  });

  test('apps.<id> declaring no offering → DONE, free by declaration; render-rail-prices.mjs --check is green', () => {
    const restore = mutate('services/platform/src/app-config-data.json', (t) => {
      const j = JSON.parse(t);
      j.apps.nextapp = { features: {}, paywall: { enabled: false, offerings: [] } };
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('price row', 'nextapp', { privateRoot: null, kind: 'app' });
      assert.equal(a.state, 'DONE');
      assert.match(a.detail, /declares no offering/);
      const g = guard('tooling/catalog/render-rail-prices.mjs', FX, '--check');
      assert.equal(g.status, 0, g.out);
    } finally {
      restore();
    }
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
  const BUNDLE_GUARD = 'tooling/ci/assert-bundle-availability.mjs';

  test('a live product → DONE, and the bundle guard is green', () => {
    assert.equal(stepOf('bundle join').state, 'DONE');
    const g = guard(BUNDLE_GUARD, FX);
    assert.equal(g.status, 0, g.out);
  });

  // ⏱ 2026-10-01 (rv2-newproduct-011). A stamp renders the new app's catalogue
  // row, and limb F of the bundle guard requires every catalogue product to be a
  // member or excluded BY NAME — so before this, app #2's first commit turned
  // ci.yml's bundle step red. The stamp now writes the exclusion
  // (tooling/kit/stamp-shared.mjs); these cases pair each reader answer with the
  // guard over the same fixture.
  /** Adds a catalogue row for `probe`, cloned from app #1's, at `status`; returns the restore. */
  const addProbeRow = (status) =>
    mutate(APPS_CATALOG, (t) => {
      const rows = JSON.parse(t);
      rows.push({ ...rows[0], slug: 'probe', name: 'Probe', status });
      return `${JSON.stringify(rows, null, 2)}\n`;
    });

  test('a stamped product the stamp did NOT place: the guard is red (the defect), and the stamp places it', () => {
    const restoreRow = addProbeRow('preview');
    const restoreBundles = mutate(BUNDLES_REGISTER, (t) => `${t} `);
    try {
      const red = guard(BUNDLE_GUARD, FX);
      assert.equal(red.status, 1, red.out);
      assert.match(red.out, /`probe` is a catalogue product and catalog\/bundles\.json neither lists it in `members` nor names it in `excluded`/);
      const w = runStampShared(FX);
      assert.equal(w.code, 0, w.lines.join('\n'));
      assert.ok(isStampedExclusion(JSON.parse(readFileSync(at(BUNDLES_REGISTER), 'utf8'))[0].excluded.find((x) => x.slug === 'probe')));
      const green = guard(BUNDLE_GUARD, FX);
      assert.equal(green.status, 0, green.out);
      assert.equal(stepOf('bundle join', 'probe').state, 'AFTER-LIVE');
    } finally {
      restoreBundles();
      restoreRow();
    }
  });

  test('a LIVE product still carrying the stamp\'s placeholder → NEXT, and the guard is red', () => {
    const restoreRow = addProbeRow('live');
    const restoreBundles = mutate(BUNDLES_REGISTER, (t) => `${t} `);
    try {
      assert.equal(runStampShared(FX).code, 0);
      const a = stepOf('bundle join', 'probe');
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /the stamp's placeholder exclusion/);
      const g = guard(BUNDLE_GUARD, FX);
      assert.equal(g.status, 1, g.out);
      assert.match(g.out, /still excludes `probe` with the STAMP's placeholder why, and `probe` is live/);
    } finally {
      restoreBundles();
      restoreRow();
    }
  });

  test('a live product excluded BY DECISION → DONE, and the guard is green', () => {
    const restoreRow = addProbeRow('live');
    const restoreBundles = mutate(BUNDLES_REGISTER, (t) => {
      const rows = JSON.parse(t);
      rows[0].excluded = [{ slug: 'probe', why: 'a CI probe: it is never sold, so no bundle may count it.' }];
      return `${JSON.stringify(rows, null, 2)}\n`;
    });
    try {
      assert.equal(stepOf('bundle join', 'probe').state, 'DONE');
      // Limb F — the limb this step owns — is green. The run as a whole is not:
      // a SECOND live product meets limb C's floor while fullshot keeps the gate
      // shut, and limb C refuses that story by design. That is the bundle's own
      // go-live question, not this step's, so it is asserted here as what it is.
      const g = guard(BUNDLE_GUARD, FX);
      assert.match(g.out, /ok {2}the 3 catalogue product\(s\) equal members ∪ excluded \(members: subscriptiontracker, fullshot; excluded: probe\)/);
      assert.doesNotMatch(g.out, /placeholder why/);
      assert.match(g.out, /the gate is closed but NOT because there are too few live products/);
    } finally {
      restoreBundles();
      restoreRow();
    }
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

// ── kinds (rv2-newproduct-014, -016, -017) ───────────────────────────────────
describe('the kind is read from where the id is published', () => {
  test('fullshot reads as the extension it is: no Pages origin, no Flutter stamp', () => {
    const r = cli('fullshot', '--check');
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.match(r.out, /^new-product plan fullshot \(extension\)$/m);
    assert.doesNotMatch(r.out, /^\S+ (pages origin|stamp) — /m);
    assert.doesNotMatch(r.out, /run: +node tooling\/(web\/pages-origin|kit\/stamp-app)\.mjs/);
    assert.match(r.out, /^OWNER store listings — no listing on chrome, edge, firefox$/m);
  });

  test('platform reads as a service, nikatru as a site, app #1 as an app', () => {
    assert.deepEqual(resolveKind(FX, 'platform'), { kind: 'service' });
    assert.deepEqual(resolveKind(FX, 'nikatru'), { kind: 'site' });
    assert.deepEqual(resolveKind(FX, APP), { kind: 'app' });
  });

  test('a --kind the register contradicts is a usage error (exit 2), naming the register', () => {
    const r = cli('fullshot', '--kind', 'app');
    assert.equal(r.code, 2);
    assert.match(r.err, /"fullshot" is published as extension \(extensions\/catalog\/extensions\.json\), and --kind says app/);
  });

  test('a new id with no --kind is a usage error (exit 2); with one, it reads that kind\'s steps', () => {
    assert.equal(cli('nextapp').code, 2);
    const r = cli('nextsvc', '--kind', 'service');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^NEXT stamp — no Worker directory services\/nextsvc-api/m);
    assert.match(r.out, /run: {3}node tooling\/kit\/stamp-service\.mjs nextsvc/);
  });

  test('an id two kinds publish needs --kind, and its id step is NEXT on the other kind\'s claim', () => {
    const restore = mutate('extensions/catalog/extensions.json', (t) => {
      const j = JSON.parse(t);
      j.push({ ...j[0], slug: APP });
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const r = cli(APP);
      assert.equal(r.code, 2);
      assert.match(r.err, /published as app \(catalog\/apps\.json\), extension \(extensions\/catalog\/extensions\.json\): name the one to plan with --kind/);
      const a = stepOf('id', APP, { privateRoot: null, kind: 'app' });
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /extension id \(extensions\/catalog\/extensions\.json, owned by extension:subscriptiontracker\)/);
    } finally {
      restore();
    }
  });
});

describe('extension · catalogue row', () => {
  test('the row missing → NEXT new-tool.mjs; publish-catalog.mjs --check is red', () => {
    const restore = mutate('extensions/catalog/extensions.json', (t) => JSON.stringify(JSON.parse(t).filter((x) => x.slug !== 'fullshot'), null, 2) + '\n');
    try {
      const a = stepOf('catalogue row', 'fullshot', { privateRoot: null, kind: 'extension' });
      assert.equal(a.state, 'NEXT');
      assert.match(a.command, /^node extensions\/scripts\/new-tool\.mjs --category Extension .* --id fullshot /);
      assert.equal(fxScript('extensions/scripts/publish-catalog.mjs', '--check', '--repo-root', at('extensions')).status, 1);
    } finally {
      restore();
    }
  });

  test('present → DONE; publish-catalog.mjs --check is green', () => {
    assert.equal(stepOf('catalogue row', 'fullshot', { privateRoot: null, kind: 'extension' }).state, 'DONE');
    const g = fxScript('extensions/scripts/publish-catalog.mjs', '--check', '--repo-root', at('extensions'));
    assert.equal(g.status, 0, g.out);
  });
});

describe('extension · store listings', () => {
  test('no listing (fullshot today) → OWNER; check-catalog.mjs prints the owner action, and --owner-actions-fatal is red', () => {
    const a = stepOf('store listings', 'fullshot', { privateRoot: null, kind: 'extension' });
    assert.equal(a.state, 'OWNER');
    const plain = fxScript('extensions/scripts/check-catalog.mjs', '--repo-root', at('extensions'));
    assert.equal(plain.status, 0, plain.out);
    assert.match(plain.out, /Unlisted: fullshot/);
    assert.equal(fxScript('extensions/scripts/check-catalog.mjs', '--repo-root', at('extensions'), '--owner-actions-fatal').status, 1);
  });

  // The DONE half is graded on the reader alone: a listed row is also `live` and its tool.json
  // `shipping`, three files the owner's listing changes together, which no fixture here invents.
  test('every store listed → DONE', () => {
    const restore = mutate('extensions/catalog/extensions.json', (t) => {
      const j = JSON.parse(t);
      const row = j.find((x) => x.slug === 'fullshot');
      for (const k of Object.keys(row.listings)) row.listings[k] = `https://example.invalid/${k}`;
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      assert.equal(stepOf('store listings', 'fullshot', { privateRoot: null, kind: 'extension' }).state, 'DONE');
    } finally {
      restore();
    }
  });
});

describe('app and service · crash sink (rv2-newproduct-001)', () => {
  test('app #1\'s secret undeclared by the called deploy workflow → NEXT; assert-worker-error-sink.mjs is red', () => {
    const restore = mutate('tooling/platform-register.json', (t) => {
      const j = JSON.parse(t);
      j.appWorkers[0].dsnSecret = 'GLITCHTIP_DSN_SUBSCRIPTIONTRACKER';
      return JSON.stringify(j, null, 2) + '\n';
    });
    try {
      const a = stepOf('crash sink');
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /names GLITCHTIP_DSN_SUBSCRIPTIONTRACKER, and \.github\/workflows\/deploy-workers\.yml does not declare it/);
      assert.equal(guard('tooling/ci/assert-worker-error-sink.mjs', FX).status, 1);
    } finally {
      restore();
    }
  });

  test('named and delivered → DONE; assert-worker-error-sink.mjs is green', () => {
    assert.equal(stepOf('crash sink').state, 'DONE');
    const g = guard('tooling/ci/assert-worker-error-sink.mjs', FX);
    assert.equal(g.status, 0, g.out);
  });

  test('client-only (no hosts.api) → DONE by the declaration', () => {
    const restore = mutate(`apps/${APP}/app.yaml`, (t) => t.replace(/^  api: .*\n/m, ''));
    try {
      const a = stepOf('crash sink');
      assert.equal(a.state, 'DONE');
      assert.match(a.detail, /^client-only/);
    } finally {
      restore();
    }
  });
});

describe('service (rv2-newproduct-016)', () => {
  test('the platform Worker reads DONE at every step but its corpus row; worker-set.mjs and provision-backend.mjs --check are green', () => {
    const r = cli('platform', '--check');
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.match(r.out, /^DONE register row — tooling\/platform-register\.json servingWorker names services\/platform\/wrangler\.jsonc$/m);
    assert.equal(guard('tooling/ci/worker-set.mjs', FX).status, 0);
    const g = guard('tooling/scripts/provision-backend.mjs', '--check');
    assert.equal(g.status, 0, g.out);
  });

  test('a stamped scratch service → its register row, backend, crash sink and monitor row are NEXT; provision-backend.mjs --check and assert-d1-bindings.mjs are red', () => {
    const code = stampServiceMain(['probesvc', '--root', FX], { log: () => {}, err: () => {} });
    assert.equal(code, 0);
    try {
      const r = cli('probesvc', '--check', '--expect-next', 'register row,backend,crash sink,monitor row');
      assert.equal(r.code, 0, `${r.out}\n${r.err}`);
      assert.match(r.out, /^new-product plan probesvc \(service\)$/m);
      assert.equal(guard('tooling/ci/worker-set.mjs', FX).status, 0, 'a stamped Worker is a member of the set');
      const check = guard('tooling/scripts/provision-backend.mjs', '--check');
      assert.equal(check.status, 1);
      assert.match(check.out, /services\/probesvc-api holds a wrangler\.jsonc/);
      assert.equal(guard('tooling/ci/assert-d1-bindings.mjs', FX).status, 1);
    } finally {
      rmSync(at('services/probesvc-api'), { recursive: true, force: true });
    }
    assert.equal(existsSync(at('services/probesvc-api')), false);
  });

  test('a Worker template tag stamp-service.mjs does not render refuses the stamp (exit 1), writing nothing', () => {
    const readme = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/README.md';
    const restore = mutate(readme, (t) => `${t}\nOwner: {{owner_name}}\n`);
    try {
      const err = [];
      assert.equal(stampServiceMain(['probesvc', '--root', FX], { log: () => {}, err: (s) => err.push(s) }), 1);
      assert.match(err.join('\n'), /README\.md: \{\{owner_name\}\}/);
      assert.equal(existsSync(at('services/probesvc-api')), false, 'a refused stamp wrote the Worker directory');
    } finally {
      restore();
    }
  });

  test('a service id already claimed is refused by stamp-service.mjs (exit 1), writing nothing', () => {
    const err = [];
    assert.equal(stampServiceMain(['platform', '--root', FX], { log: () => {}, err: (s) => err.push(s) }), 1);
    assert.match(err.join('\n'), /"platform" is already claimed/);
    assert.equal(existsSync(at('services/platform-api')), false);
  });
});

describe('site (rv2-newproduct-017)', () => {
  test('nikatru → its directory and its deploy are DONE; site-set.mjs is green', () => {
    assert.equal(stepOf('site directory', 'nikatru', { privateRoot: null, kind: 'site' }).state, 'DONE');
    assert.equal(stepOf('deploy', 'nikatru', { privateRoot: null, kind: 'site' }).state, 'DONE');
    assert.equal(guard('tooling/ci/site-set.mjs', FX).status, 0);
  });

  test('a site directory with no index.html → NEXT; site-set.mjs is red, naming it', () => {
    mkdirSync(at('sites/newsite'), { recursive: true });
    writeFileSync(at('sites/newsite/draft.html'), '<html></html>\n');
    try {
      const a = stepOf('site directory', 'newsite', { privateRoot: null, kind: 'site' });
      assert.equal(a.state, 'NEXT');
      assert.match(a.detail, /ships no index\.html/);
      const g = guard('tooling/ci/site-set.mjs', FX);
      assert.equal(g.status, 1);
      assert.match(g.out, /sites\/newsite is neither _shared nor a site/);
    } finally {
      rmSync(at('sites/newsite'), { recursive: true, force: true });
    }
  });

  test('a site no deploy workflow names (rajasekarselvam) → UNREAD, which --check does not count', () => {
    const r = cli('rajasekarselvam', '--check');
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.match(r.out, /^UNREAD deploy — no deploy workflow names sites\/rajasekarselvam/m);
  });
});
