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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  for (const bad of ['build/ios/ipa/Subly.ipa', 'out/Subly.pkg', 'Subly.app.zip', 'Subly.dmg', 'BUILD/SUBLY.IPA']) {
    test(`${bad} is refused BY NAME, never read as unsigned`, () => {
      assert.notEqual(unreadableSuffix(bad), null);
    });
  }

  test('a .app bundle and a bare Mach-O binary are readable', () => {
    assert.equal(unreadableSuffix('build/macos/Build/Products/Release/Subly.app'), null);
    assert.equal(unreadableSuffix('Subly.app/Contents/MacOS/Subly'), null);
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
