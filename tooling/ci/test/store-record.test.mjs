// ─────────────────────────────────────────────────────────────────────────────
// store-record.test.mjs — tooling/store/store-record.mjs, the one reader of an
// app's per-channel store record (O-STORE-RECORDS-ARE-ONE-PER-CHANNEL, 9a).
//
// It never returns a default: every way the record cannot be read is a thrown
// error naming its cause. And `declaredOn` gates a REAL submission only (owner row
// O-APP1-CONSOLE-DECLARATIONS-UNSUBMITTED): `declaredOnRefusal` is the one sentence that refusal says.
//
// Run:  node --test tooling/ci/test/store-record.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  storeRecordOf, readAppStores, missingIdsOf, declaredOnRefusal, STORE_CHANNELS, STORE_ID_FIELDS, bundleIdOf,
} from '../../store/store-record.mjs';
import { bundleIdOf as provisioningBundleIdOf } from '../apple-provisioning.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-store-record-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A root holding one app declaration, `apps/<id>/app.yaml`, with `text`. */
const declare = (id, text) => {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'apps', id), { recursive: true });
  writeFileSync(join(root, 'apps', id, 'app.yaml'), text);
  return root;
};

const FULL = [
  'id: zzone',
  'stores:',
  '  ios-appstore:',
  '    state: issued',
  "    recordId: \"1234567890\"",
  '    declaredOn: null',
  '  macos-appstore:',
  '    state: issued',
  "    recordId: \"1234567890\"",
  '    declaredOn: 2026-09-01',
  '  android-play:',
  '    state: pending',
  '    declaredOn: null',
  '  windows-store:',
  '    state: pending',
  '    identityName: PARTNER-CENTER-PENDING',
  '    packageFamilyName: PARTNER-CENTER-PENDING',
  '    declaredOn: null',
  '  linux-snap:',
  '    state: pending',
  '    declaredOn: null',
  '  apps-gov-in:',
  '    state: pending',
  '    declaredOn: null',
  '',
].join('\n');

describe('store-record — the channels come from the schema', () => {
  test('the six store channels, each with its id fields', () => {
    // ⏱ 2026-10-01 (rv2-newproduct-012, AA-16): apps-gov-in joined, with no id field.
    assert.deepEqual([...STORE_CHANNELS].sort(), ['android-play', 'apps-gov-in', 'ios-appstore', 'linux-snap', 'macos-appstore', 'windows-store']);
    assert.deepEqual(STORE_ID_FIELDS['apps-gov-in'], []);
    assert.deepEqual(STORE_ID_FIELDS['ios-appstore'], ['recordId']);
    assert.deepEqual(STORE_ID_FIELDS['macos-appstore'], ['recordId']);
    assert.deepEqual(STORE_ID_FIELDS['android-play'], ['appSigningSha256']);
    assert.deepEqual([...STORE_ID_FIELDS['windows-store']].sort(), ['identityName', 'packageFamilyName', 'productId']);
    assert.deepEqual(STORE_ID_FIELDS['linux-snap'], []);
  });

  test('bundleIdOf is re-exported from apple-provisioning, not re-implemented', () => {
    assert.equal(bundleIdOf, provisioningBundleIdOf);
  });
});

describe('store-record — storeRecordOf answers or throws, never defaults', () => {
  test('a record reads back with its state, its declaredOn and its ids', () => {
    const root = declare('zzone', FULL);
    assert.deepEqual(storeRecordOf(root, 'zzone', 'ios-appstore'), {
      rel: 'apps/zzone/app.yaml', state: 'issued', declaredOn: null, recordId: '1234567890',
    });
    assert.equal(storeRecordOf(root, 'zzone', 'macos-appstore').declaredOn, '2026-09-01');
    assert.deepEqual(storeRecordOf(root, 'zzone', 'linux-snap'), { rel: 'apps/zzone/app.yaml', state: 'pending', declaredOn: null });
  });

  test('an unknown channel throws, naming the known ones', () => {
    assert.throws(() => storeRecordOf(declare('zzone', FULL), 'zzone', 'web'), /"web" is not a store channel with a per-app record \(known: /);
  });

  test('an app with no declaration throws', () => {
    assert.throws(() => storeRecordOf(join(TMP, 'nowhere'), 'zzone', 'ios-appstore'), /apps\/zzone\/app\.yaml does not exist/);
  });

  test('a declaration with no record for the channel throws', () => {
    assert.throws(() => storeRecordOf(declare('zzone', 'id: zzone\n'), 'zzone', 'android-play'), /declares no stores\.android-play record/);
  });

  test('a state outside pending | issued throws', () => {
    const root = declare('zzone', FULL.replace('  android-play:\n    state: pending', '  android-play:\n    state: live'));
    assert.throws(() => storeRecordOf(root, 'zzone', 'android-play'), /stores\.android-play\.state is "live"; it is one of pending, issued/);
  });

  test('a record with no declaredOn key throws: null is written, never implied', () => {
    const root = declare('zzone', FULL.replace('  linux-snap:\n    state: pending\n    declaredOn: null\n', '  linux-snap:\n    state: pending\n'));
    assert.throws(() => storeRecordOf(root, 'zzone', 'linux-snap'), /stores\.linux-snap has no declaredOn/);
  });

  test('a declaredOn that is not a date throws', () => {
    const root = declare('zzone', FULL.replace('declaredOn: 2026-09-01', 'declaredOn: yesterday'));
    assert.throws(() => storeRecordOf(root, 'zzone', 'macos-appstore'), /declaredOn is "yesterday"; it is null or a YYYY-MM-DD date/);
  });

  test('readAppStores says absent and unparseable apart', () => {
    assert.equal(readAppStores(join(TMP, 'nowhere'), 'zzone').absent, true);
    assert.match(readAppStores(declare('zzone', 'stores: [\n'), 'zzone').parseError ?? '', /./);
  });

  test("the live app's records all read, and iOS and macOS name one App Store Connect record", () => {
    for (const c of STORE_CHANNELS) {
      const r = storeRecordOf(REPO_ROOT, 'subscriptiontracker', c);
      assert.ok(['pending', 'issued'].includes(r.state), `${c}: ${JSON.stringify(r)}`);
    }
    assert.equal(
      storeRecordOf(REPO_ROOT, 'subscriptiontracker', 'ios-appstore').recordId,
      storeRecordOf(REPO_ROOT, 'subscriptiontracker', 'macos-appstore').recordId,
    );
  });
});

describe('store-record — what an issued record lacks', () => {
  test('an issued record with no id lacks it; a pending one lacks nothing', () => {
    assert.deepEqual(missingIdsOf('ios-appstore', { state: 'issued', declaredOn: null }), ['recordId']);
    assert.deepEqual(missingIdsOf('ios-appstore', { state: 'pending', declaredOn: null }), []);
    assert.deepEqual(missingIdsOf('android-play', { state: 'issued', appSigningSha256: [] }), ['appSigningSha256']);
  });

  test("a windows id still at the channel's sentinel is not issued", () => {
    const rec = { state: 'issued', identityName: 'PARTNER-CENTER-PENDING', packageFamilyName: 'ZZTest.AppOne_aaaaaaaaaaaaa', productId: '9ZZZZZZZZZZZ' };
    assert.deepEqual(missingIdsOf('windows-store', rec, { sentinel: 'PARTNER-CENTER-PENDING' }), ['identityName']);
  });
});

// ── O-APP1-CONSOLE-DECLARATIONS-UNSUBMITTED: declaredOn gates a REAL submission ──────────
describe('store-record — declaredOnRefusal', () => {
  test('a null declaredOn is refused, naming the files the console form is submitted from', () => {
    const rec = storeRecordOf(declare('zzone', FULL), 'zzone', 'android-play');
    const msg = declaredOnRefusal(rec, { appId: 'zzone', channelId: 'android-play', files: ['apps/zzone/store/android-play/data-safety.json'] });
    assert.match(msg, /apps\/zzone\/app\.yaml stores\.android-play\.declaredOn is null/);
    assert.match(msg, /Submit that console form from apps\/zzone\/store\/android-play\/data-safety\.json first, then record the date/);
  });

  test('a dated record is not refused', () => {
    const rec = storeRecordOf(declare('zzone', FULL), 'zzone', 'macos-appstore');
    assert.equal(declaredOnRefusal(rec, { appId: 'zzone', channelId: 'macos-appstore' }), null);
  });

  test('the schema, not this file, is where the record is shaped', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'tooling', 'app-yaml', 'schema', 'app.schema.json'), 'utf8'));
    for (const c of STORE_CHANNELS) {
      assert.deepEqual(schema.properties.stores.properties[c].required.slice(0, 2), ['state', 'declaredOn'], c);
    }
  });
});

// ── the brick stamps every channel's record (9a C6; RC5) ────────────────────
// A text read of tooling/bricks/app/hooks/post_gen.dart: the host cannot run a
// real `mason make` here, and CI's app-brick job grades the stamped probe with
// assert-app-yaml and assert-store-identity. RC5 (the brick stamps no stores)
// is the deletion of the call below.
describe('store-record — the brick stamps a record for every store channel', () => {
  const POST_GEN = readFileSync(join(REPO_ROOT, 'tooling', 'bricks', 'app', 'hooks', 'post_gen.dart'), 'utf8');

  test('🔴 RC5 — post_gen calls the stores writer from the app.yaml writer', () => {
    assert.match(POST_GEN, /^ {2}_writeStoreRecords\(context, buffer\);$/m);
  });

  test("the writer takes its channels from the schema's stores properties, never a typed list", () => {
    assert.match(POST_GEN, /File\('tooling\/app-yaml\/schema\/app\.schema\.json'\)/);
    assert.match(POST_GEN, /\(\(decoded\['properties'\] as Map\)\['stores'\] as Map\)\['properties'\] as Map/);
    for (const c of STORE_CHANNELS) assert.ok(!POST_GEN.includes(`'${c}'`), `post_gen types the channel id ${c}`);
  });

  test('every stamped record is pending and undeclared', () => {
    assert.match(POST_GEN, /\.\.writeln\('    state: pending'\)\n\s+\.\.writeln\('    declaredOn: null'\);/);
  });
});
