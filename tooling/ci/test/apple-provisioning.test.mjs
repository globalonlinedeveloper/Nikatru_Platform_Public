// ─────────────────────────────────────────────────────────────────────────────
// apple-provisioning.test.mjs — the declared-capability rules, the tree guard
// assert-apple-entitlements.mjs, and the safety rails of
// tooling/ops/provision-apple.mjs must each be able to FAIL.
//
// O-STAMP-APPLE-PROVISIONING-MANUAL · [ADR 088].
//
// ⚠️ NOTHING HERE TOUCHES THE APPLE ACCOUNT OR THE NETWORK. The account half is
// driven through `ascClient` with a fetch that records calls and never leaves
// the process, and the exit contract of the live script is driven by
// withholding its credential. The LIVE proofs — a dry run against
// SubscriptionTracker making zero mutating requests, and a throwaway App ID
// exiting non-zero on the missing grouping step — are in the PR that landed
// this file, because they need the vault's key.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createVerify } from 'node:crypto';

import {
  validateRegister,
  expectedEntitlements,
  expectedMacosEntitlements,
  entitlementKeyFor,
  expectedProfileKeys,
  parseFlatDict,
  profileEntitlements,
  renderEntitlements,
  compareFileToDeclared,
  compareProfile,
  judgeCapabilities,
  capabilityWriteBody,
  planProfiles,
  zipStored,
  profileName,
  PROFILE_KINDS,
  bundleIdNameProblem,
} from '../apple-provisioning.mjs';
import { profileMembers, parseMobileProvision } from '../apple-signing.mjs';
import { ascClient, ascJwt } from '../../ops/provision-apple.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-apple-entitlements.mjs');
const OPS_SCRIPT = join(REPO, 'tooling', 'ops', 'provision-apple.mjs');
const REAL = JSON.parse(readFileSync(join(REPO, 'tooling', 'apple-provisioning.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

const ANCHOR = 'com.nikatru.platform';
const DAR = 'com.apple.developer.declared-age-range';
const SIWA = 'com.apple.developer.applesignin';

/** The three capabilities exactly as SubscriptionTracker's App ID read them
 *  back on 2026-09-16. */
const LIVE_GROUPED = [
  { capabilityType: 'IN_APP_PURCHASE', settings: null },
  { capabilityType: 'APPLE_ID_AUTH', settings: [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'RELATED_APP_CONSENT' }] }] },
  { capabilityType: 'DECLARED_AGE_RANGE', settings: null },
];
const judge = (live, primaries = [ANCHOR], reg = REAL) =>
  judgeCapabilities({ reg, slug: 'subscriptiontracker', live, primaries });

/** A profile-shaped buffer: DER-ish prefix, then the plist Apple stores as text. */
function fakeProfile({ name, bundleId, entitlements }) {
  const ent = [...entitlements].map(([k, v]) => `<key>${k}</key>${v === true ? '<true/>' : Array.isArray(v) ? `<array>${v.map((s) => `<string>${s}</string>`).join('')}</array>` : `<string>${v}</string>`}`).join('\n');
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>' +
    `<key>Name</key><string>${name}</string><key>UUID</key><string>u-1</string>` +
    '<key>TeamIdentifier</key><array><string>TEAM123456</string></array>' +
    '<key>ExpirationDate</key><date>2027-09-09T03:12:16Z</date>' +
    `<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM123456.${bundleId}</string>${ent}</dict>` +
    '</dict></plist>';
  return Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), Buffer.from(plist, 'latin1')]);
}

describe('the register', () => {
  test('the real register is sound — the green control', () => {
    assert.deepEqual(validateRegister(REAL), []);
  });
  test('a bundle id not derived from the slug is refused', () => {
    const r = clone(REAL);
    r.apps.subscriptiontracker.bundleId = 'com.nikatru.other';
    assert.match(validateRegister(r).join('\n'), /identity is derived/);
  });
  test('a declared capability the vocabulary does not define is refused', () => {
    const r = clone(REAL);
    r.apps.subscriptiontracker.capabilities.push('HEALTHKIT');
    assert.match(validateRegister(r).join('\n'), /does not define/);
  });
  test('a portal-only capability with no portal step is refused', () => {
    const r = clone(REAL);
    r.capabilities.DECLARED_AGE_RANGE.portalStep = null;
    assert.match(validateRegister(r).join('\n'), /must name its portal step/);
  });
  test('a per-type profileKey must name both profile types and nothing else', () => {
    const r = clone(REAL);
    r.capabilities.IN_APP_PURCHASE.profileKey = { IOS_APP_STORE: 'x' };
    assert.match(validateRegister(r).join('\n'), /one string per profile type/);
    r.capabilities.IN_APP_PURCHASE.profileKey = { IOS_APP_STORE: 'x', MAC_APP_STORE: 'y' };
    assert.deepEqual(validateRegister(r), []);
    r.apps.subscriptiontracker.capabilities = ['IN_APP_PURCHASE'];
    assert.deepEqual(expectedProfileKeys(r, 'subscriptiontracker', 'MAC_APP_STORE'), ['y']);
    assert.deepEqual(expectedProfileKeys(r, 'subscriptiontracker', 'IOS_APP_STORE'), ['x']);
  });
  test('the anchor cannot be declared as an app', () => {
    const r = clone(REAL);
    r.apps.platform = { bundleId: ANCHOR, capabilities: ['IN_APP_PURCHASE'] };
    assert.match(validateRegister(r).join('\n'), /IS the consent anchor/);
  });
  test('an App ID name with a special character is refused, as Apple refuses it', () => {
    assert.equal(bundleIdNameProblem('Nikatru Subscription Tracker'), null);
    assert.match(bundleIdNameProblem('Nikatru — Tracker'), /Apple refuses it/);
  });
  test('the real derivation: Runner.entitlements carries Declared Age Range only', () => {
    assert.deepEqual([...expectedEntitlements(REAL, 'subscriptiontracker')], [[DAR, true]]);
    assert.deepEqual(expectedProfileKeys(REAL, 'subscriptiontracker', 'IOS_APP_STORE').sort(), [SIWA, DAR].sort());
  });
});

describe('plist reading', () => {
  test('the real Runner.entitlements parses to exactly one key', () => {
    const r = parseFlatDict(readFileSync(join(REPO, 'apps/subscriptiontracker/ios/Runner/Runner.entitlements'), 'utf8'));
    assert.equal(r.ok, true);
    assert.deepEqual([...r.entries.keys()], [DAR]);
  });
  test('a key named only inside a comment is not a key', () => {
    const r = parseFlatDict(`<plist><dict><!-- <key>${DAR}</key><true/> --></dict></plist>`);
    assert.equal(r.ok, true);
    assert.equal(r.entries.size, 0);
  });
  test('a comment that a single strip pass would re-form is not left to confuse the parser', () => {
    // `<!<!---->--` collapses to `<!--` after ONE pass (CodeQL
    // js/incomplete-multi-character-sanitization). Here that re-formed opener
    // wraps a key: one pass would read the key as real; stripped to a fixed
    // point, the whole re-formed comment goes and the dict is empty.
    const r = parseFlatDict(`<plist><dict><!<!---->-- <key>${DAR}</key><true/> --></dict></plist>`);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual([...r.entries.keys()], []);
    // The bare collapse, and an opener that never closes, are refused — never read around.
    assert.equal(parseFlatDict(`<plist><dict><!<!---->--<key>${DAR}</key><true/></dict></plist>`).ok, false);
    assert.equal(parseFlatDict(`<plist><dict><!-- <key>${DAR}</key><true/></dict></plist>`).ok, false);
  });
  test('a nested dict, a data value and a repeated key are REFUSED, not skipped', () => {
    assert.equal(parseFlatDict('<dict><key>a</key><dict></dict></dict>').ok, false);
    assert.equal(parseFlatDict('<dict><key>a</key><data>AA==</data></dict>').ok, false);
    assert.equal(parseFlatDict('<dict><key>a</key><true/><key>a</key><false/></dict>').ok, false);
    assert.equal(parseFlatDict('no plist here').ok, false);
  });
  test('render → parse round-trips and compares clean', () => {
    const want = new Map([[DAR, true], [SIWA, ['Default']], ['x', 'y & z']]);
    const back = parseFlatDict(renderEntitlements(want));
    assert.equal(back.ok, true);
    assert.deepEqual(compareFileToDeclared(back.entries, want), []);
  });
  test('the Entitlements dict is read out of a profile', () => {
    const r = profileEntitlements(fakeProfile({ name: 'n', bundleId: 'com.nikatru.x', entitlements: new Map([[DAR, true], [SIWA, ['Default']]]) }));
    assert.equal(r.ok, true);
    assert.deepEqual([...r.entries.keys()].sort(), ['application-identifier', SIWA, DAR].sort());
  });
});

describe('the three-way comparison', () => {
  const want = new Map([[DAR, true]]);
  test('the file agrees — green control', () => {
    assert.deepEqual(compareFileToDeclared(new Map([[DAR, true]]), want), []);
  });
  test('a declared key the file lacks, an extra key, and a wrong value each fail', () => {
    assert.match(compareFileToDeclared(new Map(), want).join(), /declares no/);
    assert.match(compareFileToDeclared(new Map([[DAR, true], ['k', true]]), want).join(), /carries k/);
    assert.match(compareFileToDeclared(new Map([[DAR, false]]), want).join(), /requires true/);
  });
  const liveProfile = new Map([[DAR, true], [SIWA, ['Default']], ['application-identifier', 'x']]);
  test('the live profile agrees — green control', () => {
    assert.deepEqual(compareProfile({ reg: REAL, slug: 'subscriptiontracker', profileType: 'IOS_APP_STORE', profileEntries: liveProfile, fileEntries: want }), []);
  });
  test('a profile that predates a capability fails', () => {
    const p = new Map(liveProfile);
    p.delete(DAR);
    assert.match(compareProfile({ reg: REAL, slug: 'subscriptiontracker', profileType: 'IOS_APP_STORE', profileEntries: p, fileEntries: new Map() }).join(), /lacks .*declared-age-range.*re-mint/);
  });
  test('a profile carrying an undeclared capability fails', () => {
    const r = clone(REAL);
    r.apps.subscriptiontracker.capabilities = ['IN_APP_PURCHASE', 'APPLE_ID_AUTH'];
    assert.match(compareProfile({ reg: r, slug: 'subscriptiontracker', profileType: 'IOS_APP_STORE', profileEntries: liveProfile, fileEntries: null }).join(), /does not declare/);
  });
  test('a Runner.entitlements key the profile lacks fails — the build would be rejected', () => {
    const p = compareProfile({ reg: REAL, slug: 'subscriptiontracker', profileType: 'IOS_APP_STORE', profileEntries: liveProfile, fileEntries: new Map([[DAR, true], ['com.apple.developer.healthkit', true]]) });
    assert.match(p.join(), /healthkit, which Runner.entitlements carries/);
  });
});

describe('judging the App ID', () => {
  test('SubscriptionTracker as read back is settled — green control', () => {
    const v = judge(LIVE_GROUPED);
    assert.equal(v.settled, true);
    assert.deepEqual(v.present, ['IN_APP_PURCHASE', 'APPLE_ID_AUTH', 'DECLARED_AGE_RANGE']);
  });
  test('an UNGROUPED app (no Sign in with Apple) is not settled and names the grouping step', () => {
    const v = judge(LIVE_GROUPED.filter((c) => c.capabilityType !== 'APPLE_ID_AUTH'));
    assert.equal(v.settled, false);
    assert.equal(v.portal[0].capability, 'APPLE_ID_AUTH');
    assert.match(v.portal[0].step, /com\.nikatru\.subscriptiontracker .*Group with an existing primary App ID.*com\.nikatru\.platform/);
  });
  test('an app that is its OWN primary is wrong, not settled', () => {
    const live = clone(LIVE_GROUPED);
    live[1].settings[0].options[0].key = 'PRIMARY_APP_CONSENT';
    const v = judge(live);
    assert.equal(v.settled, false);
    assert.match(v.wrong.join(), /its OWN consent anchor/);
  });
  test('RELATED is not proof of grouping when the team has a second primary', () => {
    const v = judge(LIVE_GROUPED, [ANCHOR, 'com.nikatru.other']);
    assert.equal(v.settled, false);
    assert.match(v.wrong.join(), /grouping cannot be proven/);
  });
  test('RELATED is not proof of grouping when the anchor is not a primary', () => {
    assert.equal(judge(LIVE_GROUPED, []).settled, false);
  });
  test('a missing DECLARED_AGE_RANGE names its portal step', () => {
    const v = judge(LIVE_GROUPED.filter((c) => c.capabilityType !== 'DECLARED_AGE_RANGE'));
    assert.equal(v.portal[0].capability, 'DECLARED_AGE_RANGE');
    assert.match(v.portal[0].step, /Declared Age Range/);
  });
  test('a missing writable capability is proposed, not reported as portal work', () => {
    const v = judge(LIVE_GROUPED.filter((c) => c.capabilityType !== 'IN_APP_PURCHASE'));
    assert.deepEqual(v.toEnable, ['IN_APP_PURCHASE']);
    assert.equal(v.portal.length, 0);
  });
  test('an undeclared live capability is a finding', () => {
    const v = judge([...LIVE_GROUPED, { capabilityType: 'PUSH_NOTIFICATIONS', settings: null }]);
    assert.match(v.wrong.join(), /PUSH_NOTIFICATIONS, which the capability list does not declare/);
  });
  test('the only capability body ever built is a writable one — never APPLE_ID_AUTH', () => {
    assert.equal(capabilityWriteBody(REAL, 'ID1', 'IN_APP_PURCHASE').data.attributes.capabilityType, 'IN_APP_PURCHASE');
    assert.throws(() => capabilityWriteBody(REAL, 'ID1', 'DECLARED_AGE_RANGE'), /portal-only/);
    const r = clone(REAL);
    r.capabilities.APPLE_ID_AUTH.apiWritable = true;
    assert.throws(() => capabilityWriteBody(r, 'ID1', 'APPLE_ID_AUTH'), /only PRIMARY_APP_CONSENT/);
  });
});

describe('planning profiles', () => {
  const name = 'Nikatru Subscription Tracker';
  const full = new Map([[DAR, true], [SIWA, ['Default']]]);
  const prof = (id, kind, state, entries = full) => ({ id, name: profileName(name, kind), profileType: kind.profileType, profileState: state, entries });
  const [IOS, MAC] = PROFILE_KINDS;
  const plan = (profiles, settled = true, reg = REAL) => planProfiles({ reg, slug: 'subscriptiontracker', appName: name, settled, profiles });
  test('the names follow ADR 088 §5', () => {
    assert.equal(profileName(name, IOS), 'Nikatru Subscription Tracker iOS App Store');
    assert.equal(profileName(name, MAC), 'Nikatru Subscription Tracker macOS App Store');
  });
  test('ACTIVE profiles with every key are kept — green control', () => {
    assert.deepEqual(plan([prof('JWVU72A2N6', IOS, 'ACTIVE'), prof('26RV2N2Y4L', MAC, 'ACTIVE')]).map((x) => x.action), ['keep', 'keep']);
  });
  test('nothing is minted while the capabilities are unsettled', () => {
    assert.deepEqual(plan([], false).map((x) => x.action), ['deferred', 'deferred']);
  });
  test('an absent profile is minted once settled', () => {
    assert.deepEqual(plan([]).map((x) => x.action), ['mint', 'mint']);
  });
  test('an INVALID or key-lacking unprotected profile is re-minted', () => {
    const p = plan([prof('A', IOS, 'INVALID'), prof('B', MAC, 'ACTIVE', new Map([[SIWA, ['Default']]]))]);
    assert.deepEqual(p.map((x) => [x.action, x.id]), [['remint', 'A'], ['remint', 'B']]);
    assert.match(p[1].why, /declared-age-range/);
  });
  test('a PROTECTED profile is refused, never re-minted', () => {
    const p = plan([prof('JWVU72A2N6', IOS, 'INVALID'), prof('26RV2N2Y4L', MAC, 'ACTIVE')]);
    assert.equal(p[0].action, 'refused');
    assert.match(p[0].why, /PROTECTED/);
  });
});

describe('the profile-set container', () => {
  test('a built zip reads back through the release lane’s own parser', () => {
    const ios = fakeProfile({ name: 'Nikatru A iOS App Store', bundleId: 'com.nikatru.a', entitlements: new Map() });
    const mac = fakeProfile({ name: 'Nikatru A macOS App Store', bundleId: 'com.nikatru.a', entitlements: new Map() });
    const zip = zipStored([{ name: 'a.mobileprovision', bytes: ios }, { name: 'a.provisionprofile', bytes: mac }]);
    const { kind, members } = profileMembers(zip);
    assert.equal(kind, 'zip');
    assert.deepEqual(members.map((m) => m.name), ['a.mobileprovision', 'a.provisionprofile']);
    assert.equal(parseMobileProvision(members[1].bytes).name, 'Nikatru A macOS App Store');
    assert.equal(parseMobileProvision(members[0].bytes).bundleId, 'com.nikatru.a');
  });
});

describe('the live client’s safety rails', () => {
  const recorder = () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      return { status: init.method === 'DELETE' ? 204 : 200, json: async () => ({ data: [] }) };
    };
    return { calls, fetchImpl };
  };
  const PROT = new Set(['JWVU72A2N6', '26RV2N2Y4L', 'ND3WDZ2B5K', 'RDYD44LRCZ', 'D4GCNS78PP', '5Y2628ZNU7', 'com.nikatru.subscriptiontracker', ANCHOR]);
  const CERTS = new Set(['ND3WDZ2B5K', 'RDYD44LRCZ']);
  test('a dry run refuses every non-GET BEFORE it is sent, and counts zero mutating', async () => {
    const { calls, fetchImpl } = recorder();
    const api = ascClient({ jwt: 't', dryRun: true, fetchImpl });
    await api.read('/v1/bundleIds');
    await assert.rejects(api.call('POST', '/v1/bundleIds', {}), /dry run: refused POST/);
    await assert.rejects(api.call('DELETE', '/v1/profiles/X'), /dry run: refused DELETE/);
    assert.deepEqual(calls, ['GET https://api.appstoreconnect.apple.com/v1/bundleIds']);
    assert.deepEqual(api.counts, { GET: 1, mutating: 0, refused: 2 });
  });
  test('an apply refuses anything that names a protected resource', async () => {
    const { calls, fetchImpl } = recorder();
    const api = ascClient({ jwt: 't', dryRun: false, protectedIds: PROT, protectedCertificates: CERTS, fetchImpl });
    await assert.rejects(api.call('DELETE', '/v1/profiles/JWVU72A2N6'), /PROTECTED/);
    await assert.rejects(api.call('DELETE', '/v1/bundleIds/5Y2628ZNU7'), /PROTECTED/);
    await assert.rejects(api.call('DELETE', '/v1/certificates/ND3WDZ2B5K'), /PROTECTED/);
    await assert.rejects(api.call('POST', '/v1/bundleIdCapabilities', capabilityWriteBody(REAL, '5Y2628ZNU7', 'IN_APP_PURCHASE')), /PROTECTED/);
    await assert.rejects(api.call('POST', '/v1/bundleIds', { data: { attributes: { identifier: 'com.nikatru.subscriptiontracker' } } }), /PROTECTED/);
    assert.deepEqual(calls, []);
  });
  test('a new profile may NAME the protected distribution certificate — the green control', async () => {
    const { calls, fetchImpl } = recorder();
    const api = ascClient({ jwt: 't', dryRun: false, protectedIds: PROT, protectedCertificates: CERTS, fetchImpl });
    await api.call('POST', '/v1/profiles', { data: { relationships: { bundleId: { data: { id: 'NEWAPP' } }, certificates: { data: [{ id: 'ND3WDZ2B5K' }] } } } });
    assert.deepEqual(calls, ['POST https://api.appstoreconnect.apple.com/v1/profiles']);
    assert.equal(api.counts.mutating, 1);
  });
  test('the JWT is ES256 with an IEEE P1363 signature and a 900 s life', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwt = ascJwt({ issuerId: 'iss', keyId: 'KID', privateKey, now: 1000 });
    const [h, b, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KID', typ: 'JWT' });
    assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iss: 'iss', iat: 1000, exp: 1900, aud: 'appstoreconnect-v1' });
    const sig = Buffer.from(s, 'base64url');
    assert.equal(sig.length, 64, 'a DER signature would be ~70-72 bytes and is rejected by Apple');
    const v = createVerify('SHA256');
    v.update(`${h}.${b}`);
    assert.equal(v.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, sig), true);
  });
  test('without credentials the live script says COVERAGE LOST (2) and contacts nothing', () => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', NIKATRU_VAULT: join(tmpdir(), 'no-such-vault-apple.env') };
    const r = spawnSync(process.execPath, [OPS_SCRIPT, '--app', 'subscriptiontracker'], { env, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
  test('an app the register does not declare is a finding (1)', () => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', NIKATRU_VAULT: join(tmpdir(), 'no-such-vault-apple.env') };
    const r = spawnSync(process.execPath, [OPS_SCRIPT, '--app', 'nosuchapp'], { env, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /declares no app "nosuchapp"/);
  });
});

describe('assert-apple-entitlements — the tree guard, against a copied tree', () => {
  let TMP;
  let seq = 0;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-apple-ent-')); });
  after(() => { rmSync(TMP, { recursive: true, force: true }); });

  const APP = 'apps/subscriptiontracker';
  function tree({ mutate } = {}) {
    const root = join(TMP, `t${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    cpSync(join(REPO, 'tooling', 'apple-provisioning.json'), join(root, 'tooling', 'apple-provisioning.json'));
    for (const f of [
      'ios/Runner/Runner.entitlements',
      'ios/Runner.xcodeproj/project.pbxproj',
      // ⏱ 2026-09-18: the macOS limb reads these; without them the copied tree
      // would be COVERAGE LOST, not green.
      'macos/Runner/DebugProfile.entitlements',
      'macos/Runner/Release.entitlements',
      'macos/Runner.xcodeproj/project.pbxproj',
    ]) {
      mkdirSync(dirname(join(root, APP, f)), { recursive: true });
      cpSync(join(REPO, APP, f), join(root, APP, f));
    }
    mutate?.(root);
    return root;
  }
  const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  const edit = (root, rel, fn) => writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));

  test('the copied real tree is green — the control', () => {
    const r = run(tree());
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 iOS tree\(s\) and 1 macOS tree\(s\) agree/);
  });
  test('the declared key removed from Runner.entitlements fails', () => {
    const r = run(tree({ mutate: (t) => edit(t, `${APP}/ios/Runner/Runner.entitlements`, (s) => s.replace(`<key>${DAR}</key>`, '<key>other</key>')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares no com\.apple\.developer\.declared-age-range/);
  });
  test('the register no longer declaring the capability fails the other direction', () => {
    const r = run(tree({ mutate: (t) => edit(t, 'tooling/apple-provisioning.json', (s) => s.replace(', "DECLARED_AGE_RANGE"]', ']')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /which no declared capability requires/);
  });
  test('an Xcode project that never points at the file fails', () => {
    const r = run(tree({ mutate: (t) => edit(t, `${APP}/ios/Runner.xcodeproj/project.pbxproj`, (s) => s.replaceAll('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;', '')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /never sets CODE_SIGN_ENTITLEMENTS/);
  });
  test('a second entitlements file named by the project fails', () => {
    const r = run(tree({ mutate: (t) => edit(t, `${APP}/ios/Runner.xcodeproj/project.pbxproj`, (s) => s.replace('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;', 'CODE_SIGN_ENTITLEMENTS = Runner/Other.entitlements;')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /a second entitlements file/);
  });
  test('an app with an iOS tree and no register row fails', () => {
    const r = run(tree({ mutate: (t) => mkdirSync(join(t, 'apps', 'newapp', 'ios', 'Runner'), { recursive: true }) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /apps\/newapp has an iOS tree and no row/);
  });
  test('a register row for an app that does not exist fails', () => {
    const r = run(tree({ mutate: (t) => edit(t, 'tooling/apple-provisioning.json', (s) => { const j = JSON.parse(s); j.apps.ghost = { bundleId: 'com.nikatru.ghost', capabilities: ['IN_APP_PURCHASE'] }; return JSON.stringify(j); }) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /apps\.ghost, and apps\/ghost does not exist/);
  });
  test('no iOS tree anywhere is COVERAGE LOST (2), not a pass', () => {
    const r = run(tree({ mutate: (t) => rmSync(join(t, APP, 'ios'), { recursive: true, force: true }) }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
  test('an unreadable register is COVERAGE LOST (2)', () => {
    const r = run(tree({ mutate: (t) => writeFileSync(join(t, 'tooling', 'apple-provisioning.json'), '{') }));
    assert.equal(r.status, 2);
  });

  // ── ⏱ 2026-09-18 · O-STAMP-APPLE-MACOS-ENTITLEMENTS — the macOS limb ──────
  const REL = `${APP}/macos/Runner/Release.entitlements`;
  const DBG = `${APP}/macos/Runner/DebugProfile.entitlements`;
  const MAC_PBX = `${APP}/macos/Runner.xcodeproj/project.pbxproj`;
  /** Refuses to "mutate" a file that does not hold its target — a no-op mutant is the original. */
  const must = (s, target) => {
    assert.ok(s.includes(target), `mutation target not found: ${target}`);
    return s;
  };

  test('macOS · network.client dropped from Release fails — the key that lets the app reach its backend at all', () => {
    const k = '<key>com.apple.security.network.client</key>';
    const r = run(tree({ mutate: (t) => edit(t, REL, (s) => must(s, k).replace(k, '<key>com.apple.security.dropped</key>')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Release\.entitlements declares no com\.apple\.security\.network\.client/);
  });
  test('macOS · Declared Age Range in a macOS file fails — its only consumer is iOS-only', () => {
    const k = '<key>com.apple.security.app-sandbox</key>';
    const r = run(tree({ mutate: (t) => edit(t, REL, (s) => must(s, k).replace(k, `<key>${DAR}</key>\n\t<true/>\n\t${k}`)) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Release\.entitlements carries com\.apple\.developer\.declared-age-range, which no declared capability requires/);
  });
  test('macOS · the project naming a third entitlements file fails, and the one it stopped naming is inert', () => {
    const k = 'CODE_SIGN_ENTITLEMENTS = Runner/Release.entitlements;';
    const r = run(tree({ mutate: (t) => edit(t, MAC_PBX, (s) => must(s, k).replace(k, 'CODE_SIGN_ENTITLEMENTS = Runner/Other.entitlements;')) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /names Runner\/Other\.entitlements — a second entitlements file nothing compares/);
    assert.match(r.stderr, /never names Runner\/Release\.entitlements — that file is inert/);
  });
  test('macOS · DebugProfile is named TWICE by the project and that is one file, not a finding', () => {
    const text = readFileSync(join(REPO, MAC_PBX), 'utf8');
    assert.equal(text.match(/CODE_SIGN_ENTITLEMENTS = Runner\/DebugProfile\.entitlements;/g)?.length, 2, 'the real project changed shape — re-read it');
    assert.equal(run(tree()).status, 0);
  });
  test('macOS · a plain-string entitlementKey is demanded on BOTH platforms, so Declared Age Range as a string fails both macOS files', () => {
    const k = '{ "ios": "com.apple.developer.declared-age-range", "macos": null }';
    const r = run(tree({ mutate: (t) => edit(t, 'tooling/apple-provisioning.json', (s) => must(s, k).replace(k, `"${DAR}"`)) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DebugProfile\.entitlements declares no com\.apple\.developer\.declared-age-range/);
    assert.match(r.stderr, /Release\.entitlements declares no com\.apple\.developer\.declared-age-range/);
  });
  test('macOS · a register-named file missing from the tree fails', () => {
    const r = run(tree({ mutate: (t) => rmSync(join(t, DBG)) }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DebugProfile\.entitlements does not exist, and the register requires/);
  });
  test('macOS · no macOS tree anywhere is COVERAGE LOST (2) — every app ships macOS, so a limb that read nothing is not a pass', () => {
    const r = run(tree({ mutate: (t) => rmSync(join(t, APP, 'macos'), { recursive: true, force: true }) }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no apps\/<slug>\/macos\/Runner tree was found/);
  });
});

describe('macOS entitlements — the register and the derivation (O-STAMP-APPLE-MACOS-ENTITLEMENTS)', () => {
  test('the real derivation: each macOS file carries its base sandbox keys and NOT Declared Age Range', () => {
    const rel = expectedMacosEntitlements(REAL, 'subscriptiontracker', 'Runner/Release.entitlements');
    assert.deepEqual([...rel.keys()], ['com.apple.security.app-sandbox', 'com.apple.security.network.client']);
    const dbg = expectedMacosEntitlements(REAL, 'subscriptiontracker', 'Runner/DebugProfile.entitlements');
    assert.equal(dbg.has(DAR), false);
    assert.equal(dbg.has('com.apple.security.cs.allow-jit'), true);
    // …while the iOS derivation is exactly what it was.
    assert.deepEqual([...expectedEntitlements(REAL, 'subscriptiontracker').keys()], [DAR]);
  });
  test('entitlementKeyFor reads all three shapes', () => {
    assert.equal(entitlementKeyFor({ entitlementKey: null }, 'macos'), null);
    assert.equal(entitlementKeyFor({ entitlementKey: 'k' }, 'ios'), 'k');
    assert.equal(entitlementKeyFor({ entitlementKey: 'k' }, 'macos'), 'k');
    assert.equal(entitlementKeyFor({ entitlementKey: { ios: 'k', macos: null } }, 'macos'), null);
    assert.equal(entitlementKeyFor({ entitlementKey: { ios: null, macos: 'm' } }, 'macos'), 'm');
  });
  test('an entitlementKey object naming no key, an unknown platform, or an empty key is refused', () => {
    for (const bad of [{ ios: null, macos: null }, { ios: DAR, macos: null, tvos: null }, { ios: '', macos: null }, { ios: DAR }]) {
      const reg = clone(REAL);
      reg.capabilities.DECLARED_AGE_RANGE.entitlementKey = bad;
      assert.ok(validateRegister(reg).some((p) => /entitlementKey must be null, a string, or \{ ios, macos \}/.test(p)), JSON.stringify(bad));
    }
  });
  test('a missing macosEntitlementFiles block, a badly named file, and an empty file are refused', () => {
    const none = clone(REAL);
    delete none.macosEntitlementFiles;
    assert.ok(validateRegister(none).some((p) => /macosEntitlementFiles is missing/.test(p)));
    const named = clone(REAL);
    named.macosEntitlementFiles['Release.entitlements'] = { 'com.apple.security.app-sandbox': true };
    assert.ok(validateRegister(named).some((p) => /is not a Runner\/<Name>\.entitlements path/.test(p)));
    const empty = clone(REAL);
    empty.macosEntitlementFiles['Runner/Release.entitlements'] = {};
    assert.ok(validateRegister(empty).some((p) => /must be a non-empty dict of base keys/.test(p)));
  });
  test('a key owned by BOTH a base file and a capability is refused — one key, two owners', () => {
    const reg = clone(REAL);
    reg.capabilities.DECLARED_AGE_RANGE.entitlementKey = { ios: DAR, macos: 'com.apple.security.network.client' };
    assert.ok(validateRegister(reg).some((p) => /one key, two owners/.test(p)));
  });
});

describe('provision-apple --files-only — the tree half, with no App Store Connect request', () => {
  const env = { ...process.env };
  for (const k of ['APPLE_ASC_ISSUER_ID', 'APPLE_ASC_KEY_ID', 'APPLE_ASC_KEY_FILE']) delete env[k];

  test('a dry run reads every entitlements file and exits 0 without ever reaching the credentials', () => {
    // Without credentials the full script is COVERAGE LOST (2) — the case above.
    // --files-only returns BEFORE credentials() is called, so it answers 0 here.
    const r = spawnSync(process.execPath, [OPS_SCRIPT, '--app', 'subscriptiontracker', '--files-only'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /No App Store Connect request is made/);
    assert.match(r.stdout, /Release\.entitlements carries exactly/);
    assert.match(r.stdout, /DebugProfile\.entitlements carries exactly/);
    assert.match(r.stdout, /Runner\.entitlements carries exactly/);
    assert.doesNotMatch(r.stdout, /requests: /, 'the request counter belongs to the ASC path, which --files-only never enters');
  });
  test('--files-only cannot be combined with --profiles-zip, which needs the live profiles', () => {
    const r = spawnSync(process.execPath, [OPS_SCRIPT, '--app', 'subscriptiontracker', '--files-only', '--profiles-zip', join(tmpdir(), 'x.zip')], { env, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr + r.stdout, /--files-only reads no profile/);
  });
});
