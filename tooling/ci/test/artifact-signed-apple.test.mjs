// ─────────────────────────────────────────────────────────────────────────────
// artifact-signed-apple.test.mjs — tooling/ci/assert-artifact-signed-apple.mjs
// must be able to FAIL, and every way it can fail must be reachable from a
// machine with no Xcode on it.
//
// ⚠️ THE `codesign -dvv` FIXTURES BELOW ARE HAND-WRITTEN, NOT CAPTURED, AND
// THAT IS LABELLED HERE RATHER THAN LEFT TO BE DISCOVERED. This repository is
// developed on Windows and its guard lane runs on ubuntu; `codesign` ships with
// Xcode and exists on neither. There is also no Apple Developer account
// (none issued into the ACTIVE account, verified 2026-09-08), so even on a Mac there would be no distribution
// certificate to sign a fixture with. What the fixtures reproduce is the OUTPUT
// FORMAT — `Key=Value` per line, the `Authority=` chain printed leaf-first, the
// `Signature=adhoc` field, `TeamIdentifier=not set`, and the "code object is
// not signed at all" line — which is the entire surface the parser depends on.
//
// 📌 WHAT THAT MEANS FOR HOW MUCH THESE TESTS PROVE. They prove the parser and
// the verdict are correct GIVEN that format. They do not prove the format; a
// fixture agrees with whatever the author believed on the day, which is why the
// Android sibling generates real signatures with a real JDK and says so. The
// first real run on macOS is the thing that will confirm the field names, and
// until it happens the guard's own header carries that as an open gap rather
// than as a claim. This comment is the receipt for that honesty, and if the
// first real run disagrees with these fixtures, THE FIXTURES ARE WRONG.
// ⏱ 2026-09-24: it did — its CodeDirectory line is not `Key=Value`; the captured fixtures and their cases are at the foot of this file.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_SIGNED,
  UNSIGNED_PROOF,
  POSTURE_ENV,
  DISTRIBUTION_PREFIXES,
  codesignArgv,
  parseCodesign,
  leafAuthority,
  verdict,
  pinnedTeamId,
  unreadableSuffix,
  archiveKind,
  archiveRow,
  plistTopKeys,
  profileEntitlementKeys,
  entitlementProblems,
  workflowGlob,
  normaliseCond,
  main,
} from '../assert-artifact-signed-apple.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-artifact-signed-apple.mjs');
// REAL output from run 35741818599 — the citation and the two substitutions are in its README.md.
const CAPTURED = join(CI_DIR, 'test', 'fixtures', 'apple-run-35741818599');
const CAPTURED_APP = readFileSync(join(CAPTURED, 'codesign-macos-app.txt'), 'utf8');
const CAPTURED_IPA = readFileSync(join(CAPTURED, 'codesign-ipa-payload.txt'), 'utf8');

const TEAM = 'A1B2C3D4E5';
const OTHER_TEAM = 'Z9Y8X7W6V5';

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-apple-verify-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// ── the fixtures ─────────────────────────────────────────────────────────────
// ⚠️ HAND-WRITTEN (see the header). Shape: `codesign -dvv <bundle>`, whose
// report goes to STDERR.

/** A correctly signed Mac App Store / App Store build. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const DISTRIBUTION = `Executable=/Users/runner/work/app/build/macos/Build/Products/Release/Subly.app/Contents/MacOS/Subly
Identifier=com.nikatru.subscriptiontracker
Format=app bundle with Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=48213 flags=0x10000(runtime) hashes=1497+7 location=embedded
Signature size=8967
Authority=Apple Distribution: Rajasekar Selvam (${TEAM})
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
Timestamp=8 Aug 2026 at 11:04:19
Info.plist entries=32
TeamIdentifier=${TEAM}
Runtime Version=15.0.0
Sealed Resources version=2 rules=13 files=214
Internal requirements count=1 size=180
`;

/** The older Mac App Store application certificate, still issued to accounts
 *  created before Apple unified the two into `Apple Distribution`. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const LEGACY_MAS = DISTRIBUTION.replace(
  `Authority=Apple Distribution: Rajasekar Selvam (${TEAM})`,
  `Authority=3rd Party Mac Developer Application: Rajasekar Selvam (${TEAM})`,
);

/** 🔴 THE DEFECT THIS GUARD EXISTS FOR. `codesign -s -` — a real signature,
 *  locally valid, verifying happily, with NOBODY behind it. Xcode falls back to
 *  it, "is it signed?" answers yes, and App Store Connect refuses it. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const ADHOC = `Executable=/Users/runner/work/app/build/macos/Build/Products/Release/Subly.app/Contents/MacOS/Subly
Identifier=com.nikatru.subscriptiontracker
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=48120 flags=0x2(adhoc) hashes=1497+7 location=embedded
Signature=adhoc
Info.plist entries=32
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=214
Internal requirements count=0 size=0
`;

/** A development certificate: valid, verifies, refused by the store. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const DEVELOPMENT = DISTRIBUTION.replace(
  `Authority=Apple Distribution: Rajasekar Selvam (${TEAM})`,
  `Authority=Apple Development: Rajasekar Selvam (${TEAM})`,
);

/** Developer ID: the certificate for shipping OUTSIDE the store. Also valid,
 *  also verifies, also refused by the store — and the one most likely to be
 *  reached for by someone who has read about notarization. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const DEVELOPER_ID = DISTRIBUTION.replace(
  `Authority=Apple Distribution: Rajasekar Selvam (${TEAM})`,
  `Authority=Developer ID Application: Rajasekar Selvam (${TEAM})`,
);

/** A distribution build from a DIFFERENT team. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const OTHER_TEAM_SIGNED = DISTRIBUTION.split('\n').map((l) => l.replace(new RegExp(TEAM, 'g'), OTHER_TEAM)).join('\n');

// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const UNSIGNED = '/Users/runner/work/app/build/macos/Build/Products/Release/Subly.app: code object is not signed at all\n';

/** Output from a tool that is not codesign at all — a wrapper printing a
 *  message, a localisation, a future version with a different report. */
// HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
const GIBBERISH = 'some other tool wrote this and it has no fields the parser knows\n';

const at = (parsed, extra = {}) => ({ artifact: 'Subly.app', posture: RELEASE_SIGNED, parsed, pin: TEAM, ...extra });
const textOf = (v) => [...v.problems, ...v.prints].join('\n');

// ═════ the invocation ════════════════════════════════════════════════════════
describe('assert-artifact-signed-apple — the invocation', () => {
  test('it is `codesign -dv --verbose=4`, what the PROVE steps run — so the captured fixtures are what it reads', () => {
    assert.deepEqual(codesignArgv('/tmp/Subly.app'), ['codesign', '-dv', '--verbose=4', '/tmp/Subly.app']);
  });
});

// ═════ the parser ════════════════════════════════════════════════════════════
describe('assert-artifact-signed-apple — the parser', () => {
  test('a distribution signature yields the leaf, the team and the identifier', () => {
    const p = parseCodesign(DISTRIBUTION);
    assert.equal(p.signed, true);
    assert.equal(p.adhoc, false);
    assert.equal(p.teamId, TEAM);
    assert.equal(p.identifier, 'com.nikatru.subscriptiontracker');
    assert.equal(leafAuthority(p), `Apple Distribution: Rajasekar Selvam (${TEAM})`);
  });

  test('the authority chain is leaf-FIRST — asserting on a CA would be a different question', () => {
    const p = parseCodesign(DISTRIBUTION);
    assert.equal(p.authorities.length, 3);
    assert.match(p.authorities[2], /Apple Root CA/);
  });

  test('an AD-HOC signature is recognised, and `TeamIdentifier=not set` becomes null', () => {
    const p = parseCodesign(ADHOC);
    assert.equal(p.adhoc, true);
    assert.equal(p.teamId, null);
    assert.equal(p.authorities.length, 0);
  });

  test('the adhoc CodeDirectory flag alone is enough — the Signature field is corroboration', () => {
    const p = parseCodesign(ADHOC.replace('Signature=adhoc\n', ''));
    assert.equal(p.adhoc, true);
  });

  test('an UNSIGNED object is read from the message, never from an exit code', () => {
    const p = parseCodesign(UNSIGNED);
    assert.equal(p.signed, false);
  });

  test('output the parser does not understand is UNPARSEABLE, not "unsigned"', () => {
    assert.equal(parseCodesign(GIBBERISH).unparseable, true);
    assert.equal(parseCodesign('').unparseable, true);
  });

  test('a value containing "=" survives — only the FIRST separator splits', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    const p = parseCodesign('Identifier=com.nikatru.subscriptiontracker\nFormat=app bundle with Mach-O thin (arm64)\nTeamIdentifier=A1B2C3D4E5\n');
    assert.equal(p.format, 'app bundle with Mach-O thin (arm64)');
  });
});

// ═════ the verdict ═══════════════════════════════════════════════════════════
describe('assert-artifact-signed-apple — the happy paths really pass', () => {
  test('a distribution-signed bundle matching the pin passes with nothing printed', () => {
    const v = verdict(at(parseCodesign(DISTRIBUTION)));
    assert.deepEqual(v.problems, []);
    assert.deepEqual(v.prints, []);
    assert.equal(v.teamChecked, true);
  });

  test('the legacy Mac App Store application certificate is accepted too', () => {
    const v = verdict(at(parseCodesign(LEGACY_MAS)));
    assert.deepEqual(v.problems, []);
    assert.equal(v.teamChecked, true);
  });

  test('an unsigned bundle on a lane that DECLARED a build proof passes, and says so in capitals', () => {
    const v = verdict(at(parseCodesign(UNSIGNED), { posture: UNSIGNED_PROOF }));
    assert.deepEqual(v.problems, []);
    assert.match(textOf(v), /CANNOT BE UPLOADED TO APP STORE CONNECT/);
  });
});

describe('assert-artifact-signed-apple — the ad-hoc signature is the defect it exists for', () => {
  test('FAILS when the lane arranged signing and the bundle is ad-hoc signed', () => {
    const v = verdict(at(parseCodesign(ADHOC)));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /AD-HOC signature/);
    assert.match(textOf(v), /xcodebuild did not use them/);
  });

  test('an ad-hoc signature on a declared build-proof lane is the EXPECTED outcome', () => {
    const v = verdict(at(parseCodesign(ADHOC), { posture: UNSIGNED_PROOF }));
    assert.deepEqual(v.problems, []);
    assert.match(textOf(v), /AD-HOC/);
  });

  test('FAILS when the lane arranged signing and the bundle is not signed at all', () => {
    const v = verdict(at(parseCodesign(UNSIGNED)));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /NOT SIGNED AT ALL/);
  });

  test('FAILS when an identity appeared that the lane did NOT arrange', () => {
    const v = verdict(at(parseCodesign(DISTRIBUTION), { posture: UNSIGNED_PROOF }));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /a path the lane did not arrange/);
  });

  test('UNPARSEABLE output is never a verdict — it is reported and NOT counted as evaluated', () => {
    const v = verdict(at(parseCodesign(GIBBERISH)));
    assert.equal(v.evaluated, false);
    assert.match(textOf(v), /cannot parse/);
  });
});

describe('assert-artifact-signed-apple — valid Apple certificates the store refuses', () => {
  test('FAILS on a DEVELOPMENT certificate and says why it is not enough', () => {
    const v = verdict(at(parseCodesign(DEVELOPMENT)));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /DEVELOPMENT certificate/);
    assert.match(textOf(v), /Apple Distribution:/);
  });

  test('FAILS on a Developer ID certificate — valid, notarizable, and not for the store', () => {
    const v = verdict(at(parseCodesign(DEVELOPER_ID)));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /DIRECT-DISTRIBUTION certificate/);
  });

  test('an UNRECOGNISED leaf is refused, not accepted by default', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    const p = parseCodesign(DISTRIBUTION.replace(/Authority=Apple Distribution:[^\n]*/, 'Authority=Some Other CA: Nobody (XXXXXXXXXX)'));
    const v = verdict(at(p));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /not a recognised App Store distribution/);
  });

  test('the accepted prefixes are exactly the two App Store application certificates', () => {
    assert.deepEqual([...DISTRIBUTION_PREFIXES], ['Apple Distribution:', '3rd Party Mac Developer Application:']);
  });
});

describe('assert-artifact-signed-apple — the team pin', () => {
  test('FAILS when a DIFFERENT, perfectly valid distribution certificate signed the bundle', () => {
    const v = verdict(at(parseCodesign(OTHER_TEAM_SIGNED)));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /not the pinned one/);
    assert.match(textOf(v), new RegExp(OTHER_TEAM));
  });

  test('a NULL pin passes and PRINTS the gap — an unpinned team is weaker, not broken', () => {
    const v = verdict(at(parseCodesign(DISTRIBUTION), { pin: null }));
    assert.deepEqual(v.problems, []);
    assert.equal(v.teamChecked, false);
    assert.match(textOf(v), /NOT compared to a\s*pin/);
  });

  test('the summary never claims a team comparison that did not happen', () => {
    assert.equal(verdict(at(parseCodesign(DISTRIBUTION), { pin: null })).teamChecked, false);
    assert.equal(verdict(at(parseCodesign(UNSIGNED), { posture: UNSIGNED_PROOF })).teamChecked, false);
  });

  test('FAILS when the ARRANGED team and the signing team disagree, even with no pin', () => {
    const v = verdict(at(parseCodesign(OTHER_TEAM_SIGNED), { pin: null, arrangedTeamId: TEAM }));
    assert.equal(v.problems.length, 1);
    assert.match(textOf(v), /this lane arranged/);
  });
});

describe('assert-artifact-signed-apple — the pin comes out of the register', () => {
  const reg = (rows) => ({ channels: rows });

  test('both rows pinning the same team yields that pin', () => {
    const r = pinnedTeamId(reg([
      { id: 'ios-appstore', signing: { distributionCertificate: { teamId: TEAM } } },
      { id: 'macos-appstore', signing: { distributionCertificate: { teamId: TEAM } } },
    ]));
    assert.equal(r.pin, TEAM);
  });

  test('no pin anywhere is null and not an error — there is no account to pin yet', () => {
    const r = pinnedTeamId(reg([{ id: 'ios-appstore', signing: {} }, { id: 'macos-appstore', signing: {} }]));
    assert.equal(r.pin, null);
    assert.equal(r.missingRow, null);
  });

  test('a missing Apple row is COVERAGE, not a null pin', () => {
    const r = pinnedTeamId(reg([{ id: 'ios-appstore', signing: {} }]));
    assert.equal(r.missingRow, 'macos-appstore');
  });

  test('two rows pinning DIFFERENT teams is a record fault — one account cannot have two', () => {
    const r = pinnedTeamId(reg([
      { id: 'ios-appstore', signing: { distributionCertificate: { teamId: TEAM } } },
      { id: 'macos-appstore', signing: { distributionCertificate: { teamId: OTHER_TEAM } } },
    ]));
    assert.equal(r.pin, null);
    assert.ok(r.disagreement, 'the disagreement must be reported, not resolved by picking one');
  });
});

describe('assert-artifact-signed-apple — archives codesign cannot read', () => {
  for (const bad of ['Subly.app.zip', 'Subly.dmg', 'BUILD/SUBLY.DMG']) {
    test(`${bad} is refused BY NAME, never read as unsigned`, () => {
      assert.notEqual(unreadableSuffix(bad), null);
    });
  }

  test('a .app bundle and a bare Mach-O binary are readable', () => {
    assert.equal(unreadableSuffix('build/macos/Build/Products/Release/Subly.app'), null);
    assert.equal(unreadableSuffix('Subly.app/Contents/MacOS/Subly'), null);
  });

  test('an .ipa and a .pkg are OPENED, not refused — any case of the suffix', () => {
    // Until 2026-09-25 both were in the refused list above (O-APPLE-PROVER-SKIPS-THE-PKG).
    assert.equal(unreadableSuffix('build/ios/ipa/Subly.ipa'), null);
    assert.equal(unreadableSuffix('out/Subly.pkg'), null);
    assert.equal(archiveKind('BUILD/SUBLY.IPA'), '.ipa');
    assert.equal(archiveKind('out/Subly.pkg'), '.pkg');
    assert.equal(archiveKind('Subly.app'), null);
  });
});

// ═════ the guard, run as a process ═══════════════════════════════════════════
function makeRoot({ rows = ['ios-appstore', 'macos-appstore'], pin = null } = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(
    join(root, 'tooling', 'channel-register.json'),
    JSON.stringify({ channels: rows.map((id) => ({ id, signing: pin === null ? {} : { distributionCertificate: { teamId: pin } } })) }),
  );
  return root;
}

// APPLE_TEAM_ID defaults to TEAM: since 2026-09-24 a release-signed run without it is COVERAGE LOST, so
// the cases below that are about other stops pass a team, and the empty-team case says '' itself.
const runGuard = (root, artifacts, posture, teamId = TEAM) =>
  spawnSync(process.execPath, [GUARD, ...(root ? ['--repo-root', root] : []), ...artifacts], {
    encoding: 'utf8',
    env: { ...process.env, [POSTURE_ENV]: posture, APPLE_TEAM_ID: teamId },
  });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-artifact-signed-apple — coverage self-checks, run as a process', () => {
  test('COVERAGE LOST when APPLE_SIGNING_POSTURE is absent', () => {
    const r = runGuard(makeRoot(), ['Subly.app'], '');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /does not know what the lane intended/);
  });

  test('COVERAGE LOST on an unrecognised posture — it is never resolved to a default', () => {
    const r = runGuard(makeRoot(), ['Subly.app'], 'probably-fine');
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /neither "release-signed" nor "unsigned-build-proof"/);
  });

  test('COVERAGE LOST when no bundle path is given at all', () => {
    const r = runGuard(makeRoot(), [], RELEASE_SIGNED);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /evaluated nothing/);
  });

  test('off macOS the guard reports the check as IMPOSSIBLE, never as passing', () => {
    const r = runGuard(makeRoot(), ['Subly.app'], RELEASE_SIGNED);
    if (process.platform === 'darwin') {
      // On a Mac it proceeds to read the (absent) bundle instead.
      assert.doesNotMatch(out(r), /does not exist on "darwin"/);
    } else {
      assert.equal(r.status, 2, out(r));
      assert.match(out(r), new RegExp(`does not exist on "${process.platform}"`));
      assert.match(out(r), /COVERAGE/);
    }
  });

  test('the posture check runs BEFORE the platform check, so the message is about the wiring', () => {
    // Order matters: a job that forgot to run apple-signing.mjs must be told
    // that, not told it is on the wrong operating system.
    const r = runGuard(makeRoot(), ['Subly.app'], '');
    assert.match(out(r), /is not set/);
    assert.doesNotMatch(out(r), /ships with Xcode/);
  });
});

// ═════ the captured output, through main({ run }) ════════════════════════════
// REAL `codesign -dv --verbose=4` output from run 35741818599 (fixtures/apple-run-35741818599/README.md),
// fed through the guard's one seam: `main({ argv, env, platform, run })`. The fake `run` answers the way the
// macOS runner did — 🔬 the report on STDERR, where `codesign -dv` writes it, and stdout empty — so these
// cases take the same probe, parse, verdict, summary and exit as CI. `platform: 'darwin'` is injected; nothing
// else is faked.

/** A root with a register and one bundle directory at `bundle`; `pin` goes into both Apple rows. */
function rootWithBundle(bundle, { pin = null } = {}) {
  const root = makeRoot({ pin });
  mkdirSync(join(root, bundle), { recursive: true });
  return root;
}

/** A `run` that replays `report` as codesign's answer, and records every call it was asked to make. */
function replay(report, { status = 0 } = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'codesign' && args[0] === '--help') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'codesign') return { status, stdout: '', stderr: report };
    // Only reached on a COVERAGE LOST, to name the tool: made-up answers, not captured ones.
    if (cmd === 'which') return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
    if (cmd === 'sw_vers') return { status: 0, stdout: '26.0\n', stderr: '' };
    return { status: null, stdout: '', stderr: '', error: Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }) };
  };
  return { run, calls };
}

const releaseEnv = (teamId) => ({ [POSTURE_ENV]: RELEASE_SIGNED, APPLE_TEAM_ID: teamId });

describe('assert-artifact-signed-apple — the captured output of run 35741818599', () => {
  test('T1: the real .app, release-signed, APPLE_TEAM_ID matching — exit 0 and ONE team compared', () => {
    const bundle = 'build/macos/Build/Products/Release/Subscriptions.app';
    const root = rootWithBundle(bundle);
    const { run, calls } = replay(CAPTURED_APP);
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(TEAM), platform: 'darwin', run });
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /1 team\(s\) compared against APPLE_TEAM_ID/);
    assert.match(r.stdout, /leaf "Apple Distribution: <PERSONAL-NAME> \(A1B2C3D4E5\)" · team A1B2C3D4E5 · id com\.nikatru\.subscriptiontracker/);
    // The fixture is what the guard reads because the guard runs what PROVE ran.
    assert.deepEqual(calls.find((c) => c[0] === 'codesign' && c[1] !== '--help'), ['codesign', '-dv', '--verbose=4', join(root, bundle)]);
  });

  test('T2: the real .ipa payload against a DIFFERENT APPLE_TEAM_ID — exit 1, naming both teams', () => {
    const bundle = 'Payload/Runner.app';
    const root = rootWithBundle(bundle);
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(OTHER_TEAM), platform: 'darwin', run: replay(CAPTURED_IPA).run });
    assert.equal(r.code, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`signed by team ${TEAM} and this lane arranged ${OTHER_TEAM}`));
    assert.match(r.stderr, /assert-artifact-signed-apple: FAILED/);
  });

  test('T3: the CodeDirectory flags are read from BOTH captured reports — the line is not Key=Value', () => {
    const app = parseCodesign(CAPTURED_APP);
    const ipa = parseCodesign(CAPTURED_IPA);
    assert.equal(app.flags, '0x0(none)');
    assert.equal(ipa.flags, '0x0(none)');
    assert.equal(app.teamId, TEAM);
    assert.equal(ipa.format, 'app bundle with Mach-O thin (arm64)');
    assert.equal(app.adhoc, false);
    assert.equal(leafAuthority(ipa), 'Apple Distribution: <PERSONAL-NAME> (A1B2C3D4E5)');
  });

  test('T5: COVERAGE LOST prints what codesign returned — path, version, exit, the first 20 of 25 lines', () => {
    const bundle = 'Subly.app';
    const root = rootWithBundle(bundle);
    const lines25 = `${Array.from({ length: 25 }, (_, i) => `garbled ${i}`).join('\n')}\n`;
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(TEAM), platform: 'darwin', run: replay(lines25, { status: 1 }).run });
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /FAIL COVERAGE LOST — 1 bundle path\(s\) were given and NOT ONE yielded a readable signature report/);
    assert.match(r.stderr, /what codesign returned for Subly\.app:/);
    assert.match(r.stderr, /tool: \/usr\/bin\/codesign/);
    assert.match(r.stderr, /version: codesign has no --version; the host is macOS 26\.0/);
    assert.match(r.stderr, /exit: 1\n/);
    assert.match(r.stderr, /stderr: 25 line\(s\), \d+ bytes, first 20 shown/);
    const shown = r.stderr.split('\n').filter((l) => /^\s*stderr\| /.test(l)).map((l) => l.trim());
    assert.deepEqual(shown, Array.from({ length: 20 }, (_, i) => `stderr| garbled ${i}`));
  });

  test('T6: release-signed with an EMPTY APPLE_TEAM_ID is COVERAGE LOST, not a silent pass', () => {
    // `platform: 'darwin'` and a correctly signed bundle: without the stop, this run would reach a pass.
    const bundle = 'Subscriptions.app';
    const root = rootWithBundle(bundle);
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(''), platform: 'darwin', run: replay(CAPTURED_APP).run });
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /release-signed and APPLE_TEAM_ID is empty — the team cannot be compared/);
    assert.equal(r.stdout, '');
  });

  test('T7: a register teamId that disagrees with APPLE_TEAM_ID FAILS — the env is the pin', () => {
    const bundle = 'Subscriptions.app';
    const root = rootWithBundle(bundle, { pin: OTHER_TEAM });
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(TEAM), platform: 'darwin', run: replay(CAPTURED_APP).run });
    assert.equal(r.code, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /the register disagrees with APPLE_TEAM_ID; the env is the pin/);
  });

  test('a signature whose team cannot be read FAILS when APPLE_TEAM_ID is set — it is never skipped', () => {
    // HAND-WRITTEN SHAPE — not captured output; the captured fixtures are fixtures/apple-run-35741818599/.
    const noTeam = CAPTURED_APP.replace(`TeamIdentifier=${TEAM}`, 'TeamIdentifier=not set');
    const bundle = 'Subscriptions.app';
    const root = rootWithBundle(bundle);
    const r = main({ argv: ['--repo-root', root, bundle], env: releaseEnv(TEAM), platform: 'darwin', run: replay(noTeam).run });
    assert.equal(r.code, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /carries no readable TeamIdentifier/);
  });
});

// ═════ the archives, opened through main({ run }) — O-APPLE-PROVER-SKIPS-THE-PKG ══════════════════════
// ⚠️ SYNTHETIC: the pkgutil text, the two profiles and the signed-entitlements XML are HAND-WRITTEN
// (fixtures/apple-pkg-synthetic/README.md says so on its first line). The codesign reports are the captured
// ones above. The fake `run` builds the tree `unzip` and `pkgutil --expand-full` would write — through the
// guard's one seam, the same one every other tool call takes — so each case walks the path CI walks.
const SYNTH = join(CI_DIR, 'test', 'fixtures', 'apple-pkg-synthetic');
const synth = (f) => readFileSync(join(SYNTH, f), 'utf8');
const SLUG = 'subscriptiontracker';
const BUNDLE_ID = 'com.nikatru.subscriptiontracker';
const IPA = `apps/${SLUG}/build/ios/ipa/${SLUG}.ipa`;
const PKG = `apps/${SLUG}/build/macos/pkg/${SLUG}.pkg`;
const DIST = 'Apple Distribution: <PERSONAL-NAME> (A1B2C3D4E5)';
const INSTALLER = '3rd Party Mac Developer Installer: <PERSONAL-NAME> (A1B2C3D4E5)';
const plistOf = (keys) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${keys.map((k) => `\t<key>${k}</key>\n\t<true/>\n`).join('')}</dict>\n</plist>\n`;

/** A root holding the two Apple rows the way the register declares them, the app's entitlements files, and
 *  a non-empty file at each `extra` path (both archives by default). */
function archiveRoot(extra = [IPA, PKG]) {
  const root = join(TMP, `root${seq++}`);
  const row = (id, artifactGlob) => ({ id, signing: { seam: { artifactGlob } }, bundleIdentifier: { value: BUNDLE_ID } });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(
    join(root, 'tooling', 'channel-register.json'),
    JSON.stringify({ channels: [row('ios-appstore', 'apps/*/build/ios/ipa/*.ipa'), row('macos-appstore', 'apps/*/build/macos/pkg/*.pkg')] }),
  );
  // The profile limb reads the app's bundle id from the REAL provisioning register (bundleIdOf, per slug).
  copyFileSync(join(REPO_ROOT, 'tooling', 'apple-provisioning.json'), join(root, 'tooling', 'apple-provisioning.json'));
  mkdirSync(join(root, 'apps', SLUG, 'ios', 'Runner'), { recursive: true });
  mkdirSync(join(root, 'apps', SLUG, 'macos', 'Runner'), { recursive: true });
  writeFileSync(join(root, 'apps', SLUG, 'ios', 'Runner', 'Runner.entitlements'), plistOf(['com.apple.developer.declared-age-range']));
  writeFileSync(
    join(root, 'apps', SLUG, 'macos', 'Runner', 'Release.entitlements'),
    plistOf(['com.apple.security.app-sandbox', 'com.apple.security.network.client']),
  );
  for (const rel of extra) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), 'SYNTHETIC archive bytes\n');
  }
  return root;
}

/** The macOS runner, faked at `run`. Each key of `o` changes ONE tool's answer; a case sets one key. */
function archiveRun(o = {}) {
  const calls = [];
  const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const target = String(args[args.length - 1]);
    const ios = target.includes('Runner.app');
    if (cmd === 'unzip') {
      const app = join(args[3], 'Payload', 'Runner.app');
      if (o.ipaPayload !== false) mkdirSync(app, { recursive: true });
      if (o.ipaPayload !== false && o.iosProfile !== null) writeFileSync(join(app, 'embedded.mobileprovision'), o.iosProfile ?? synth('profile-ios.plist'));
      return ok();
    }
    if (cmd === 'pkgutil' && args[0] === '--check-signature') return ok(o.pkgText ?? synth('pkgutil-check-signature.txt'));
    if (cmd === 'pkgutil' && args[0] === '--expand-full') {
      if (o.expandStatus) return { status: o.expandStatus, stdout: '', stderr: 'Error: could not expand the package\n' };
      const contents = join(args[2], 'Subscriptions.pkg', 'Payload', 'Subscriptions.app', 'Contents');
      mkdirSync(contents, { recursive: true });
      writeFileSync(join(contents, 'embedded.provisionprofile'), o.macProfile ?? synth('profile-macos.plist'));
      return ok();
    }
    if (cmd === 'security') return o.cms ? { stdout: '', stderr: '', ...o.cms } : ok();
    if (cmd === 'codesign' && args[0] === '--help') return ok();
    if (cmd === 'codesign' && args[0] === '--verify') {
      return o.verifyStatus ? { status: o.verifyStatus, stdout: '', stderr: `${target}: a sealed resource is missing or invalid\n` } : ok();
    }
    if (cmd === 'codesign' && args.includes('--entitlements')) {
      return ok(o.signedEntitlements ?? synth(ios ? 'entitlements-ios.xml' : 'entitlements-macos.xml'));
    }
    if (cmd === 'codesign') return ok('', ios ? CAPTURED_IPA : CAPTURED_APP);
    if (cmd === process.execPath) {
      return o.plistStatus ? { status: o.plistStatus, stdout: '', stderr: 'FAIL CFBundleIdentifier is com.example.other\n' } : ok('assert-built-info-plist: OK\n');
    }
    if (cmd === 'which') return { status: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
    if (cmd === 'sw_vers') return { status: 0, stdout: '26.0\n', stderr: '' };
    return { status: null, stdout: '', stderr: '', error: Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }) };
  };
  return { run, calls };
}

/** Run the guard over `artifacts` (both archives by default), release-signed, with `envExtra` on top. */
function openArchives(o = {}, envExtra = {}, { root = archiveRoot(), artifacts = [IPA, PKG] } = {}) {
  const { run, calls } = archiveRun(o);
  const env = { ...releaseEnv(TEAM), APPLE_DIST_IDENTITY: DIST, APPLE_INSTALLER_IDENTITY: INSTALLER, RUNNER_TEMP: TMP, ...envExtra };
  const r = main({ argv: ['--repo-root', root, ...artifacts], env, platform: 'darwin', run });
  return { ...r, root, calls, all: `${r.stdout}${r.stderr}` };
}

describe('assert-artifact-signed-apple — the archive decisions, pure', () => {
  test('the archive is matched to its row by the row artifactGlob, and the glob first * is the slug', () => {
    const rows = [
      { id: 'ios-appstore', signing: { seam: { artifactGlob: 'apps/*/build/ios/ipa/*.ipa' } } },
      { id: 'macos-appstore', signing: { seam: { artifactGlob: 'apps/*/build/macos/pkg/*.pkg' } } },
    ];
    assert.equal(archiveRow(rows, PKG).row.id, 'macos-appstore');
    assert.equal(archiveRow(rows, IPA).slug, SLUG);
    // The glob this change replaced: a .pkg there is at no row's path.
    assert.equal(archiveRow(rows, `apps/${SLUG}/build/macos/Build/Products/Release/${SLUG}.pkg`), null);
  });

  test('a profile top-level keys are not its Entitlements keys — nested dicts are skipped', () => {
    const profile = synth('profile-ios.plist');
    assert.ok(plistTopKeys(profile).includes('Entitlements'));
    assert.ok(!plistTopKeys(profile).includes('application-identifier'));
    assert.ok(profileEntitlementKeys(profile).includes('com.apple.developer.declared-age-range'));
  });

  test('on macOS a com.apple.security.* key is held to the signature only; any other key to the profile too', () => {
    const p = entitlementProblems({
      kind: '.pkg',
      rel: PKG,
      declared: ['com.apple.security.app-sandbox', 'com.apple.developer.example'],
      signed: ['com.apple.security.app-sandbox', 'com.apple.developer.example'],
      profiled: [],
    });
    assert.deepEqual(p, [`entitlements: ${PKG}'s embedded profile lacks declared entitlement com.apple.developer.example.`]);
  });
});

describe('assert-artifact-signed-apple — the archives, opened (SYNTHETIC tool output)', () => {
  test('RC2: the .ipa and the .pkg, each matching its row — exit 0, both opened, every named limb run', () => {
    const r = openArchives();
    assert.equal(r.code, 0, r.all);
    assert.ok(r.stdout.includes(`ok   ${IPA} — opened`), r.stdout);
    assert.ok(r.stdout.includes(`ok   ${PKG} — opened`), r.stdout);
    assert.match(r.stdout, /2\/2 bundle\(s\) read with codesign/);
    const ran = r.calls.map((c) => c.slice(0, 2).join(' '));
    assert.ok(ran.includes('unzip -q'), JSON.stringify(ran));
    assert.ok(ran.includes('pkgutil --check-signature'), JSON.stringify(ran));
    assert.ok(ran.includes('pkgutil --expand-full'), JSON.stringify(ran));
    assert.ok(ran.includes('codesign --verify'), JSON.stringify(ran));
    assert.ok(ran.includes('codesign -d'), JSON.stringify(ran));
    assert.ok(ran.includes('security cms'), JSON.stringify(ran));
    assert.equal(r.calls.filter((c) => c[0] === process.execPath && c.includes('--app') && c.includes(SLUG)).length, 2);
    // The macOS profile carries no com.apple.security.* key and the sandbox keys are declared: exit 0 is the scope rule.
    assert.doesNotMatch(synth('profile-macos.plist'), /com\.apple\.security\./);
  });

  test('RC1: a .pkg whose embedded profile is for ANOTHER bundle id FAILS, naming the profile mismatch', () => {
    const other = synth('profile-macos.plist').replace(`${TEAM}.${BUNDLE_ID}`, `${TEAM}.com.nikatru.other`);
    assert.notEqual(other, synth('profile-macos.plist'));
    const r = openArchives({ macProfile: other });
    assert.equal(r.code, 1, r.all);
    assert.match(
      r.stderr,
      /FAIL profile: apps\/subscriptiontracker\/build\/macos\/pkg\/subscriptiontracker\.pkg's embedded profile is for "A1B2C3D4E5\.com\.nikatru\.other", not "A1B2C3D4E5\.com\.nikatru\.subscriptiontracker"/,
    );
  });

  test('profile: an embedded profile `security cms -D` cannot decode FAILS — a bare plist is not a CMS envelope', () => {
    const r = openArchives({ cms: { status: 1 } });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL profile: .*not a CMS envelope/);
  });

  test('profile: `security` that cannot be run is COVERAGE LOST, naming security cms -D', () => {
    const r = openArchives({ cms: { status: null, error: Object.assign(new Error('spawn security ENOENT'), { code: 'ENOENT' }) } });
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /COVERAGE LOST — profile: `security cms -D` could not be run/);
  });

  test('profile: an app the provisioning register does not name is COVERAGE LOST, naming the slug', () => {
    const root = archiveRoot();
    const reg = JSON.parse(readFileSync(join(root, 'tooling', 'apple-provisioning.json'), 'utf8'));
    reg.apps = { othertracker: reg.apps[SLUG] };
    writeFileSync(join(root, 'tooling', 'apple-provisioning.json'), JSON.stringify(reg));
    const r = openArchives({}, {}, { root });
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /COVERAGE LOST — profile: no bundle id for "subscriptiontracker"/);
  });

  test('profile: an .ipa whose app carries no embedded.mobileprovision FAILS', () => {
    const r = openArchives({ iosProfile: null });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL profile: apps\/subscriptiontracker\/build\/ios\/ipa\/subscriptiontracker\.ipa's wrapped app has no embedded\.mobileprovision/);
  });

  test('ipa-payload: an .ipa with no Payload/*.app FAILS by that name', () => {
    const r = openArchives({ ipaPayload: false });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL ipa-payload: apps\/subscriptiontracker\/build\/ios\/ipa\/subscriptiontracker\.ipa holds 0 Payload\/\*\.app/);
  });

  test('pkg-signature: pkgutil not reporting an Apple-issued certificate FAILS', () => {
    const r = openArchives({ pkgText: 'Package "subscriptiontracker.pkg":\n   Status: no signature\n' });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL pkg-signature: pkgutil does not report .*subscriptiontracker\.pkg as signed by a developer certificate issued by Apple/);
  });

  test('pkg-signature: a .pkg signed by an installer other than APPLE_INSTALLER_IDENTITY FAILS', () => {
    const r = openArchives({}, { APPLE_INSTALLER_IDENTITY: 'Developer ID Installer: <PERSONAL-NAME> (A1B2C3D4E5)' });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL pkg-signature: .*subscriptiontracker\.pkg is not signed by "Developer ID Installer: <PERSONAL-NAME> \(A1B2C3D4E5\)"/);
  });

  test('pkg-payload: a .pkg pkgutil cannot expand is COVERAGE LOST, never a pass', () => {
    const r = openArchives({ expandStatus: 1 });
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /FAIL COVERAGE LOST — pkg-payload: `pkgutil --expand-full` could not be run, or refused the archive/);
    assert.match(r.stderr, /Error: could not expand the package/);
  });

  test('identity: a wrapped app signed by an identity other than APPLE_DIST_IDENTITY FAILS', () => {
    const r = openArchives({}, { APPLE_DIST_IDENTITY: 'Apple Distribution: Someone Else (A1B2C3D4E5)' });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL identity: .*subscriptiontracker\.ipa's wrapped app is not signed by "Apple Distribution: Someone Else \(A1B2C3D4E5\)"/);
  });

  test('identity: release-signed with APPLE_DIST_IDENTITY empty is COVERAGE LOST', () => {
    const r = openArchives({}, { APPLE_DIST_IDENTITY: '' });
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /release-signed and APPLE_DIST_IDENTITY is empty/);
  });

  test('verify-strict: a wrapped app codesign --verify --strict rejects FAILS', () => {
    const r = openArchives({ verifyStatus: 3 });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL verify-strict: `codesign --verify --strict` rejects .*\(exit 3\): .*a sealed resource is missing or invalid/);
  });

  test('entitlements: a declared key missing from the SIGNATURE FAILS', () => {
    const r = openArchives({ signedEntitlements: plistOf([]) });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL entitlements: .*\.ipa's wrapped app lacks declared entitlement com\.apple\.developer\.declared-age-range in its signature/);
    assert.match(r.stderr, /FAIL entitlements: .*\.pkg's wrapped app lacks declared entitlement com\.apple\.security\.app-sandbox in its signature/);
  });

  test('entitlements: a declared iOS key missing from the embedded PROFILE FAILS', () => {
    const without = synth('profile-ios.plist').replace(/<key>com\.apple\.developer\.declared-age-range<\/key>\s*<true\/>/, '');
    assert.notEqual(without, synth('profile-ios.plist'));
    const r = openArchives({ iosProfile: without });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL entitlements: .*\.ipa's embedded profile lacks declared entitlement com\.apple\.developer\.declared-age-range/);
  });

  test('info-plist: C1 refusing the wrapped app FAILS, carrying what C1 said', () => {
    const r = openArchives({ plistStatus: 1 });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL info-plist: assert-built-info-plist\.mjs refuses .*\.pkg's wrapped app \(exit 1\): FAIL CFBundleIdentifier is com\.example\.other/);
  });

  test('an archive at no row artifactGlob FAILS — no row gives it a bundle id to be held to', () => {
    const stray = `apps/${SLUG}/build/macos/Build/Products/Release/${SLUG}.pkg`;
    const r = openArchives({}, {}, { root: archiveRoot([IPA, stray]), artifacts: [IPA, stray] });
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL apps\/subscriptiontracker\/build\/macos\/Build\/Products\/Release\/subscriptiontracker\.pkg is at no Apple row's signing\.seam\.artifactGlob/);
  });
});

// ═════ --static: build-platforms.yml held to the register's artifact globs ═══
// ⏱ ADDED 2026-09-25 (O-APPLE-PROVER-SKIPS-THE-PKG). `run` throws in every case
// below: --static reads text and must never reach a tool.
const REPO_ROOT = resolve(CI_DIR, '..', '..');
const WF_IPA = 'apps/${{ matrix.app }}/build/ios/ipa/*.ipa';
const WF_PKG = 'apps/${{ matrix.app }}/build/macos/pkg/*.pkg';
const RELEASE_IF = "if: env.APPLE_SIGNING_POSTURE == 'release-signed'";

/** A minimal build-platforms.yml: one prover step over `proved`, one upload of `uploaded`. */
function bpText({ proveIf = RELEASE_IF, proved = [WF_IPA, WF_PKG], uploaded = [WF_PKG, WF_IPA] } = {}) {
  return [
    'name: build-platforms',
    'on: workflow_dispatch',
    'jobs:',
    '  apple:',
    '    runs-on: macos-15',
    '    steps:',
    '      - name: PROVE the .ipa and .pkg are real and signed',
    ...(proveIf === null ? [] : [`        ${proveIf}`]),
    '        run: >',
    '          node tooling/ci/assert-artifact-signed-apple.mjs',
    ...proved.map((p) => `          ${p}`),
    '      - name: Upload the archives',
    '        uses: actions/upload-artifact@0000000000000000000000000000000000000000',
    '        with:',
    '          name: apple',
    '          path: |',
    ...uploaded.map((p) => `            ${p}`),
    '',
  ].join('\n');
}

/** archiveRoot's register, with `bp` written as build-platforms.yml (none when null) and `register` replacing the register. */
function staticRoot({ bp = bpText(), register } = {}) {
  const root = archiveRoot([]);
  if (register !== undefined) writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify(register));
  if (bp !== null) {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'build-platforms.yml'), bp);
  }
  return root;
}

function runStatic(root) {
  const r = main({
    argv: ['--repo-root', root, '--static'],
    env: {},
    platform: 'linux',
    run: () => {
      throw new Error('--static ran a tool');
    },
  });
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

const staticRow = (id, artifactGlob) => ({ id, signing: { seam: { artifactGlob } }, bundleIdentifier: { value: BUNDLE_ID } });

describe('assert-artifact-signed-apple --static — the decisions, pure', () => {
  test("a register glob's app `*` is bp's matrix app; an `if:` is compared as the expression it evaluates", () => {
    assert.equal(workflowGlob('apps/*/build/ios/ipa/*.ipa'), WF_IPA);
    assert.equal(workflowGlob('apps/*/build/macos/pkg/*.pkg'), WF_PKG);
    assert.equal(normaliseCond(null), null);
    assert.equal(normaliseCond('${{ env.APPLE_SIGNING_POSTURE  ==  "release-signed" }}'), "env.APPLE_SIGNING_POSTURE == 'release-signed'");
  });
});

describe('assert-artifact-signed-apple --static — bp held to the register', () => {
  test('the real tree: bp proves and uploads both register globs, and no tool is run', () => {
    const r = runStatic(REPO_ROOT);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /ok static-prove · ios-appstore: .*build-platforms\.yml:\d+ runs the prover on apps\/\$\{\{ matrix\.app \}\}\/build\/ios\/ipa\/\*\.ipa/);
    assert.match(r.stdout, /ok static-prove · macos-appstore: .*build-platforms\.yml:\d+ runs the prover on apps\/\$\{\{ matrix\.app \}\}\/build\/macos\/pkg\/\*\.pkg/);
    assert.match(r.stdout, /ok static-upload · macos-appstore: /);
    assert.match(r.stdout, /ok static-upload · ios-appstore: /);
  });

  test('green control: the release-signed `if:`, no `if:`, and the `${{ }}` spelling all pass', () => {
    assert.equal(runStatic(staticRoot()).code, 0);
    assert.equal(runStatic(staticRoot({ bp: bpText({ proveIf: null }) })).code, 0);
    const wrapped = runStatic(staticRoot({ bp: bpText({ proveIf: 'if: ${{ env.APPLE_SIGNING_POSTURE == "release-signed" }}' }) }));
    assert.equal(wrapped.code, 0, wrapped.all);
  });

  test('RC3: the register glob moved back to Release/*.pkg FAILS static-prove and static-upload for macos-appstore', () => {
    const register = {
      channels: [staticRow('ios-appstore', 'apps/*/build/ios/ipa/*.ipa'), staticRow('macos-appstore', 'apps/*/build/macos/Build/Products/Release/*.pkg')],
    };
    const r = runStatic(staticRoot({ register }));
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL static-prove · macos-appstore: no step in \.github\/workflows\/build-platforms\.yml runs tooling\/ci\/assert-artifact-signed-apple\.mjs on apps\/\$\{\{ matrix\.app \}\}\/build\/macos\/Build\/Products\/Release\/\*\.pkg/);
    assert.match(r.stderr, /FAIL static-upload · macos-appstore: /);
    assert.doesNotMatch(r.stderr, /· ios-appstore/);
  });

  test('RC4b: the prover step on `!= release-signed` FAILS static-posture — it would never see an archive', () => {
    const r = runStatic(staticRoot({ bp: bpText({ proveIf: "if: env.APPLE_SIGNING_POSTURE != 'release-signed'" }) }));
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL static-posture · ios-appstore: \.github\/workflows\/build-platforms\.yml:\d+ "PROVE the \.ipa and \.pkg are real and signed" runs the prover on .* only when `env\.APPLE_SIGNING_POSTURE != 'release-signed'`/);
    assert.match(r.stderr, /FAIL static-posture · macos-appstore: /);
  });

  test('an archive proven but not uploaded FAILS static-upload', () => {
    const r = runStatic(staticRoot({ bp: bpText({ uploaded: [WF_IPA] }) }));
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL static-upload · macos-appstore: no actions\/upload-artifact step .* uploads apps\/\$\{\{ matrix\.app \}\}\/build\/macos\/pkg\/\*\.pkg/);
    assert.doesNotMatch(r.stderr, /static-upload · ios-appstore/);
  });

  test('a QUOTED glob is not the glob — the shell would pass it to the prover unexpanded — and FAILS static-prove', () => {
    const r = runStatic(staticRoot({ bp: bpText({ proved: [`"${WF_IPA}"`, WF_PKG] }) }));
    assert.equal(r.code, 1, r.all);
    assert.match(r.stderr, /FAIL static-prove · ios-appstore: /);
    assert.doesNotMatch(r.stderr, /static-prove · macos-appstore/);
  });

  test('COVERAGE LOST (exit 2) when build-platforms.yml is absent', () => {
    const r = runStatic(staticRoot({ bp: null }));
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /FAIL COVERAGE LOST — --static: \.github\/workflows\/build-platforms\.yml does not exist/);
  });

  test('COVERAGE LOST (exit 2) when build-platforms.yml parses to no step', () => {
    const r = runStatic(staticRoot({ bp: 'name: build-platforms\non: workflow_dispatch\njobs:\n  apple:\n    runs-on: macos-15\n' }));
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /FAIL COVERAGE LOST — --static: no step was parsed out of/);
  });

  test('COVERAGE LOST (exit 2) when an Apple row has no artifactGlob', () => {
    const register = { channels: [staticRow('ios-appstore', 'apps/*/build/ios/ipa/*.ipa'), { id: 'macos-appstore', signing: {} }] };
    const r = runStatic(staticRoot({ register }));
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /FAIL COVERAGE LOST — --static: tooling\/channel-register\.json's "macos-appstore" row has no signing\.seam\.artifactGlob/);
  });

  test('COVERAGE LOST (exit 2) when an Apple row is missing', () => {
    const r = runStatic(staticRoot({ register: { channels: [staticRow('macos-appstore', 'apps/*/build/macos/pkg/*.pkg')] } }));
    assert.equal(r.code, 2, r.all);
    assert.match(r.stderr, /FAIL COVERAGE LOST — --static: tooling\/channel-register\.json declares no "ios-appstore" channel/);
  });
});
