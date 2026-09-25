// ═════════════════════════════════════════════════════════════════════════════
// THE 2026-09-09 SIGNED-BUILD PASS — the three pure seams it added.
//
// A separate file rather than three more `test()` calls at the end of
// apple-signing.test.mjs, because these pin a CHANGE OF FACT (the certificates
// now exist) rather than a refinement of the old behaviour, and a reader
// bisecting "when did the .pkg stop being a printed intent" should land on one
// file whose whole subject is that question.
//
// 🔴 EVERY ONE OF THESE IS A RED-FIRST TEST. Each was run against the code as it
// stood on 2026-09-08 and failed there — `parseMobileProvision` returned null
// for the macOS profile, `pickIdentities` did not exist, `installerImportPlan`
// did not exist. A test written after the fact that has never been red proves
// the assertion compiles, not that it discriminates.
// ═════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, isAbsolute } from 'node:path';

import {
  parseMobileProvision,
  pickIdentities,
  installerImportPlan,
  xcodeProfileDirs,
  exportOptionsPlist,
  whitespaceShape,
} from '../apple-signing.mjs';

describe('whitespaceShape describes a secret without quoting any of it', () => {
  // 🔴 THE PROPERTY, AND IT IS THE WHOLE POINT: every string this can return is
  // a literal written inside the function. Nothing derived from the input — not
  // a character, not a length — can travel into a log through it. CodeQL flagged
  // the previous message (which printed two lengths) as js/clear-text-logging.
  test('names the CR case specifically — the one that actually happened', () => {
    assert.deepEqual(whitespaceShape('abc\r'), ['a trailing carriage return — the Windows `openssl rand` case']);
    assert.deepEqual(whitespaceShape('abc\r\n'), ['a trailing CRLF — the Windows `openssl rand` case']);
  });

  test('distinguishes newline, space/tab and leading whitespace', () => {
    assert.deepEqual(whitespaceShape('abc\n'), ['a trailing newline']);
    assert.deepEqual(whitespaceShape('abc '), ['a trailing space or tab']);
    assert.deepEqual(whitespaceShape('abc\t'), ['a trailing space or tab']);
    assert.deepEqual(whitespaceShape(' abc'), ['leading whitespace']);
    assert.deepEqual(whitespaceShape(' abc\r'), ['leading whitespace', 'a trailing carriage return — the Windows `openssl rand` case']);
  });

  test('🔴 NO FRAGMENT OF THE INPUT EVER APPEARS IN THE OUTPUT', () => {
    const secret = 'S3cr3tP4ssphrase';
    for (const pad of ['\r', '\n', ' ', '\t', '\r\n', '']) {
      const joined = whitespaceShape(`${secret}${pad}`).join(' | ');
      assert.ok(!joined.includes(secret), 'the secret leaked into the description');
      assert.ok(!joined.includes('S3cr'), 'a fragment of the secret leaked');
      assert.ok(!/\d{2,}/.test(joined), 'a length leaked into the description');
    }
  });

  test('a clean value still yields a non-empty description rather than an empty list', () => {
    // The caller only reaches this function when raw !== trimmed, but a
    // description that could be empty would print "Found: ." and read as a bug.
    assert.equal(whitespaceShape('clean').length, 1);
    assert.equal(whitespaceShape(null).length, 1);
    assert.equal(whitespaceShape(undefined).length, 1);
  });
});

describe('exportOptionsPlist refuses two profiles for one bundle id', () => {
  // 🔴 THIS BUG WAS CAUSED BY FIXING ANOTHER ONE, WHICH IS WHY IT NEEDS A PIN.
  // Subly is a universal purchase: its iOS and macOS profiles carry the SAME
  // bundle id, deliberately. While `parseMobileProvision` read only the iOS
  // spelling of `application-identifier`, the macOS profile resolved to
  // `bundleId: null` and was dropped by the `p.bundleId && p.name` filter — so
  // this map held one correct entry BY ACCIDENT. The moment the parser was
  // fixed, both landed under one key and the last won:
  //
  //     error: exportArchive Provisioning profile "… macOS App Store" has
  //     platform "macOS", which does not match the current platform "iOS".
  const ios = { bundleId: 'com.nikatru.subscriptiontracker', name: 'Nikatru Subscription Tracker iOS App Store' };
  const mac = { bundleId: 'com.nikatru.subscriptiontracker', name: 'Nikatru Subscription Tracker macOS App Store' };

  test('one platform maps cleanly', () => {
    const plist = exportOptionsPlist({ teamId: 'Q2B2BY33B6', profiles: [ios] });
    assert.match(plist, /<key>com\.nikatru\.subscriptiontracker<\/key>/);
    assert.match(plist, /<string>Nikatru Subscription Tracker iOS App Store<\/string>/);
    assert.doesNotMatch(plist, /macOS App Store/);
  });

  test('both platforms THROWS rather than emitting an order-dependent dict', () => {
    assert.throws(() => exportOptionsPlist({ teamId: 'Q2B2BY33B6', profiles: [ios, mac] }), /two profiles claim bundle id/);
    // …and in the other order too: a bug that depends on argument order is one
    // a single-order test would certify as fixed.
    assert.throws(() => exportOptionsPlist({ teamId: 'Q2B2BY33B6', profiles: [mac, ios] }), /two profiles claim bundle id/);
  });

  test('distinct bundle ids are still allowed — the refusal is about collisions, not about count', () => {
    const other = { bundleId: 'com.nikatru.other', name: 'Other' };
    const plist = exportOptionsPlist({ teamId: 'Q2B2BY33B6', profiles: [ios, other] });
    assert.match(plist, /com\.nikatru\.subscriptiontracker/);
    assert.match(plist, /com\.nikatru\.other/);
  });

  test('profiles with no bundle id are dropped before the collision check, not counted as one', () => {
    const unparsed = { bundleId: null, name: 'Unparsed' };
    assert.doesNotThrow(() => exportOptionsPlist({ teamId: 'Q2B2BY33B6', profiles: [ios, unparsed, unparsed] }));
  });
});

describe('xcodeProfileDirs names both locations Xcode has used', () => {
  // 🔴 THE FAILURE THIS CLOSES. Writing the profiles to $RUNNER_TEMP and
  // exporting the path is NOT installing them: PROVISIONING_PROFILE_SPECIFIER
  // names a profile and Xcode resolves that name by SCANNING its own directory.
  // Measured 2026-09-09, with manual signing correctly in force:
  //   error: No profile for team '…' matching 'Nikatru Subscription Tracker macOS App Store' found
  const dirs = xcodeProfileDirs('/Users/runner');

  test('the Xcode 16+ location comes first', () => {
    assert.equal(dirs[0], join('/Users/runner', 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'));
  });

  test('the pre-16 location is still written, so an older image does not fail mysteriously', () => {
    assert.equal(dirs[1], join('/Users/runner', 'Library', 'MobileDevice', 'Provisioning Profiles'));
    assert.equal(dirs.length, 2, 'exactly these two — a third would be a guess');
  });

  test('the paths are absolute and under the supplied home, never the process HOME', () => {
    for (const d of dirs) {
      assert.ok(isAbsolute(d), `${d} is not absolute`);
      assert.ok(d.startsWith(join('/Users/runner', 'Library')), `${d} escaped the supplied home`);
    }
  });
});

/** A provisioning profile is a CMS envelope with an XML plist inside; the parser
 *  looks for `<?xml` … `</plist>` and ignores the wrapper, so a bare plist with
 *  plausible surrounding bytes is a faithful stand-in for the two real files.
 *  The two real profiles this repository held on 2026-09-09 (against the App ID
 *  for com.nikatru.subscriptiontracker) were read with this parser before these
 *  fixtures were written; the key names below are what they measured. Their ids,
 *  and every later one, are in tooling/apple-provisioning.json (`protected`,
 *  `retired`) and nowhere in tooling/ci — assert-apple-entitlements.mjs refuses one.
 *
 *  🔴 THE IDS MOVED AND THE MEASUREMENT DID NOT. The first pair, against the App
 *  ID for com.nikatru.subly, was deleted on 2026-09-09
 *  when the owner moved the package identifier; the replacements were re-read
 *  with this same parser and carry the SAME two spellings of
 *  `application-identifier` — iOS bare, macOS `com.apple.`-prefixed. That is a
 *  property of the PLATFORM, so these fixtures pin a rule rather than a pair of
 *  files, and they would still be right had the identifier never moved. */
function profile({ idKey, appId, name = 'Nikatru Subscription Tracker', team = 'Q2B2BY33B6' }) {
  return Buffer.from(
    ` CMS-ish preamble ` +
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n' +
      `<key>Name</key><string>${name}</string>\n` +
      `<key>UUID</key><string>3ab74a5c-7b29-42a7-b0ba-fae1a4aa866e</string>\n` +
      `<key>TeamIdentifier</key><array><string>${team}</string></array>\n` +
      '<key>ExpirationDate</key><date>2027-09-09T03:12:16Z</date>\n' +
      '<key>Entitlements</key><dict>\n' +
      `<key>${idKey}</key><string>${appId}</string>\n` +
      '</dict>\n</dict></plist>\ntrailing bytes',
    'latin1',
  );
}

describe('parseMobileProvision reads the macOS spelling of application-identifier', () => {
  // 🔴 THE BUG THIS PINS WAS SILENT, WHICH IS WHY IT NEEDS A TEST AT ALL. Before
  // 2026-09-09 the parser read only `application-identifier`. The real
  // MAC_APP_STORE profile carries `com.apple.application-identifier`, so it
  // parsed to `bundleId: null` — and nothing FAILED on that. The profile was
  // simply dropped from the ExportOptions `provisioningProfiles` map (whose
  // builder filters on `p.bundleId && p.name`) and skipped by the bundle-id
  // cross-check. A missing map entry surfaces at upload, not at build.
  test('the macOS key `com.apple.application-identifier` yields the bundle id', () => {
    const p = parseMobileProvision(
      profile({ idKey: 'com.apple.application-identifier', appId: 'Q2B2BY33B6.com.nikatru.subscriptiontracker' }),
    );
    assert.notEqual(p, null);
    assert.equal(p.bundleId, 'com.nikatru.subscriptiontracker', 'this returned null before 2026-09-09');
    assert.equal(p.appIdentifier, 'Q2B2BY33B6.com.nikatru.subscriptiontracker');
    assert.deepEqual(p.teamIds, ['Q2B2BY33B6']);
  });

  test('the iOS key still wins, unchanged', () => {
    const p = parseMobileProvision(
      profile({ idKey: 'application-identifier', appId: 'Q2B2BY33B6.com.nikatru.subscriptiontracker' }),
    );
    assert.equal(p.bundleId, 'com.nikatru.subscriptiontracker');
  });

  // The `.` in `com.apple.application-identifier` is escaped in the pattern the
  // parser builds. Unescaped it is a wildcard, which would also match the iOS
  // key inside a longer string and — worse — match keys nobody intended. This
  // asserts the escaping by giving it a key that a wildcard WOULD match and the
  // literal must not.
  test('the added key is matched literally, not as a regex wildcard', () => {
    const p = parseMobileProvision(profile({ idKey: 'comXappleXapplication-identifier', appId: 'Q2B2BY33B6.evil' }));
    assert.equal(p.bundleId, null, 'a wildcard `.` would have matched comXappleX… and adopted its value');
  });

  test('a profile carrying BOTH spellings prefers the iOS one', () => {
    const both = Buffer.from(
      '<?xml version="1.0"?>\n<plist version="1.0"><dict>\n' +
        '<key>Name</key><string>Both</string>\n' +
        '<key>TeamIdentifier</key><array><string>Q2B2BY33B6</string></array>\n' +
        '<key>application-identifier</key><string>Q2B2BY33B6.ios.one</string>\n' +
        '<key>com.apple.application-identifier</key><string>Q2B2BY33B6.mac.one</string>\n' +
        '</dict></plist>',
      'latin1',
    );
    assert.equal(parseMobileProvision(both).bundleId, 'ios.one');
  });
});

describe('pickIdentities reads what is really in the keychain', () => {
  // Real `security find-identity -v` output shape, including the trailing
  // summary line that is NOT an identity.
  const REAL = [
    '  1) A1B2C3D4E5F60718293A4B5C6D7E8F9012345678 "Apple Distribution: Rajasekar Selvam (Q2B2BY33B6)"',
    '  2) 0F1E2D3C4B5A69788796A5B4C3D2E1F001234567 "3rd Party Mac Developer Installer: Rajasekar Selvam (Q2B2BY33B6)"',
    '     2 valid identities found',
  ].join('\n');

  test('separates the application identity from the installer identity', () => {
    const { names, application, installer } = pickIdentities(REAL);
    assert.equal(names.length, 2, 'the summary line is not an identity');
    assert.equal(application, 'Apple Distribution: Rajasekar Selvam (Q2B2BY33B6)');
    assert.equal(installer, '3rd Party Mac Developer Installer: Rajasekar Selvam (Q2B2BY33B6)');
  });

  // 🔴 THE PREFIX COLLISION THIS EXISTS FOR. "3rd Party Mac Developer Installer"
  // and "3rd Party Mac Developer Application" share eight words. Matching the
  // application slot on the shorter prefix would put the INSTALLER certificate
  // into CODE_SIGN_IDENTITY, which signs nothing and fails deep inside a build.
  test('the legacy application name is accepted and never confused with the installer', () => {
    const legacy = [
      '  1) AAAA111122223333444455556666777788889999 "3rd Party Mac Developer Installer: Someone (TEAMID1234)"',
      '  2) BBBB111122223333444455556666777788889999 "3rd Party Mac Developer Application: Someone (TEAMID1234)"',
    ].join('\n');
    const { application, installer } = pickIdentities(legacy);
    assert.match(application, /Application:/);
    assert.match(installer, /Installer:/);
  });

  test('an installer-only keychain yields no application identity rather than a wrong one', () => {
    const only = '  1) CCCC111122223333444455556666777788889999 "3rd Party Mac Developer Installer: X (T1)"';
    const { application, installer } = pickIdentities(only);
    assert.equal(application, null, 'main() dies on this — it must not silently pick the installer');
    assert.notEqual(installer, null);
  });

  test('empty and garbage input yield nulls, never a throw', () => {
    for (const input of ['', '   ', null, undefined, '0 valid identities found', 'not remotely identity output']) {
      const r = pickIdentities(input);
      assert.deepEqual(r.names, []);
      assert.equal(r.application, null);
      assert.equal(r.installer, null);
    }
  });
});

describe('installerImportPlan grants the installer key to productbuild and nothing else', () => {
  const [step] = installerImportPlan({ keychain: '/tmp/k.keychain-db', p12Path: '/tmp/i.p12', p12Password: 'pw' });

  test('it is a `security import` into the per-run keychain', () => {
    assert.equal(step.argv[0], 'security');
    assert.equal(step.argv[1], 'import');
    assert.equal(step.argv[2], '/tmp/i.p12');
    assert.ok(step.argv.includes('-k') && step.argv[step.argv.indexOf('-k') + 1] === '/tmp/k.keychain-db');
    assert.equal(step.argv[step.argv.indexOf('-f') + 1], 'pkcs12');
  });

  // 🔴 `-T /usr/bin/codesign` MUST NOT BE HERE. The installer certificate cannot
  // sign code, and handing it to codesign only widens what a compromised build
  // step can reach. The distribution import (keychainPlan) is the one that
  // grants codesign; these two lists are deliberately different.
  test('codesign is NOT granted this key', () => {
    const granted = step.argv.filter((_, i) => step.argv[i - 1] === '-T');
    assert.deepEqual(granted.sort(), ['/usr/bin/productbuild', '/usr/bin/productsign', '/usr/bin/security'].sort());
    assert.ok(!granted.includes('/usr/bin/codesign'), 'an installer certificate has no business signing code');
  });

  test('the password is passed through -P, so redactArgv can find and hide it', () => {
    assert.equal(step.argv[step.argv.indexOf('-P') + 1], 'pw');
  });
});
