// ─────────────────────────────────────────────────────────────────────────────
// apple-signing.test.mjs — the seam that arranges the Apple distribution
// identity must be able to FAIL:
//   tooling/ci/apple-signing.mjs                    arranges the credential
//   tooling/ci/assert-artifact-signed-apple.mjs     reads what actually signed it
// (the second file's own failing cases are in artifact-signed-apple.test.mjs)
//
// 🔬 WHY THESE FIXTURES ARE NOT REAL CRYPTO, UNLIKE THE ANDROID ONES.
// android-signing.test.mjs generates real keystores with `keytool` and signs
// real archives with `jarsigner`, and says so proudly, because a JDK is on every
// runner. The Apple equivalent would need `security`, `codesign` and a real
// Apple distribution certificate — the first two exist ONLY on macOS, and the
// third does not exist at all (no Apple distribution certificate; the Developer
// account). So the split is explicit rather than apologetic:
//
//   · every DECISION in apple-signing.mjs is a pure exported function and is
//     tested here directly, on any platform, including both sides of the
//     darwin/non-darwin branch — `resolvePosture` takes the platform as an
//     ARGUMENT so the branch that cannot run here can still be asserted;
//   · the byte-level validators (base64 round-trip, PKCS#12 DER, the zip reader,
//     the provisioning-profile plist reader) are tested against real bytes built
//     in this file, because those are platform-independent;
//   · what is NOT tested anywhere is the six `security` invocations actually
//     succeeding against a real keychain. That is stated in the guard's header
//     and printed by the guard at runtime; it is a gap, not a silence.
//
// ⚠️ THE .p12 AND .mobileprovision FIXTURES ARE HAND-BUILT, NOT CAPTURED.
// They are labelled at each construction site. What the guard actually reads
// from them — the DER opening byte, and the XML plist embedded in the CMS
// envelope — is real and is what a genuine file carries; what they are NOT is a
// cryptographically valid certificate or a signed envelope, and no assertion
// here pretends they are.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import {
  ROLE_ENV,
  WANTED,
  ROW_ONLY_ENV,
  expectedNames,
  registerDrift,
  homeRowOf,
  RELEASE_SIGNED,
  UNSIGNED_PROOF,
  KEYLESS_ENV,
  secretSetLaw,
  releaseLane,
  resolvePosture,
  keychainPlan,
  redactArgv,
  teamIdProblem,
  parseMobileProvision,
  exportOptionsPlist,
  signedExportPlan,
  newlineOffenders,
  unzip,
  profileMembers,
} from '../apple-signing.mjs';
import { armingOf } from '../channel-arming.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CI_DIR, '..', '..');
const PREPARE = join(CI_DIR, 'apple-signing.mjs');

const TEAM = 'A1B2C3D4E5';
const OTHER_TEAM = 'Z9Y8X7W6V5';
const SUBMIT_WF = '.github/workflows/submit-appstore.yml';

let TMP;
let seq = 0;

before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-apple-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// ── fixtures ─────────────────────────────────────────────────────────────────

/** ⚠️ HAND-BUILT, NOT A REAL CERTIFICATE. A PKCS#12 is DER, and DER opens with
 *  a SEQUENCE tag (0x30) and a length. That opening byte is the ONLY thing
 *  apple-signing.mjs asserts about the bytes, deliberately — see its header on
 *  why there is no `openssl pkcs12 -info` here. */
function fakeP12(size = 512) {
  const b = Buffer.alloc(size, 0x41);
  b[0] = 0x30;
  b[1] = 0x82;
  b.writeUInt16BE(size - 4, 2);
  return b;
}

/** ⚠️ HAND-BUILT. A real .mobileprovision is a CMS (PKCS#7) envelope whose
 *  content is this exact XML plist, stored as plain text — which is why the
 *  guard can read it without parsing ASN.1. The DER wrapper here is a stub; the
 *  plist is the real shape, field for field, including the `Entitlements` dict
 *  that carries `application-identifier` as `<TEAM>.<bundle id>`. */
function fakeProfile({ name = 'Subly App Store', team = TEAM, bundleId = 'com.nikatru.subscriptiontracker', expires = '2027-07-31T00:00:00Z' } = {}) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AppIDName</key>
	<string>Subly</string>
	<key>ApplicationIdentifierPrefix</key>
	<array>
	<string>${team}</string>
	</array>
	<key>CreationDate</key>
	<date>2026-08-01T00:00:00Z</date>
	<key>Entitlements</key>
	<dict>
		<key>application-identifier</key>
		<string>${team}.${bundleId}</string>
		<key>com.apple.developer.team-identifier</key>
		<string>${team}</string>
		<key>get-task-allow</key>
		<false/>
	</dict>
	<key>ExpirationDate</key>
	<date>${expires}</date>
	<key>Name</key>
	<string>${name}</string>
	<key>Platform</key>
	<array>
		<string>iOS</string>
	</array>
	<key>TeamIdentifier</key>
	<array>
	<string>${team}</string>
	</array>
	<key>TeamName</key>
	<string>Rajasekar Selvam</string>
	<key>UUID</key>
	<string>3f9c2a10-7b4e-4f1a-9d55-1c2e3f4a5b6c</string>
	<key>Version</key>
	<integer>1</integer>
</dict>
</plist>`;
  // The stub CMS wrapper: a SEQUENCE tag so `profileMembers` classifies it as a
  // single DER profile, then the plist, then trailing bytes standing in for the
  // signature block a real envelope carries after the content.
  const head = Buffer.from([0x30, 0x82, 0x0f, 0xff, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  return Buffer.concat([head, Buffer.from(plist, 'utf8'), Buffer.alloc(64, 0x00)]);
}

/** A real zip, central directory and all. `{ zip64: true }` promotes it to the
 *  ZIP64 form MakeAppx writes for every .msix — EOCD64 record, its locator, and
 *  0xFFFF/0xFFFFFFFF sentinels in the 32-bit records — which is the shape that
 *  threw ERR_OUT_OF_RANGE out of unzip() on build-platforms run 32814517717.
 *  The members are byte-identical either way, so the two forms are directly
 *  comparable and the tests below compare them. */
function makeZip(entries, { zip64 = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const deflate = e.method === 8;
    const data = deflate ? deflateRawSync(e.bytes) : e.bytes;
    const method = e.method ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(e.bytes), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(e.bytes), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.bytes.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    if (zip64) {
      // ZIP64 promotion of THIS entry. The sizes become sentinels and move into
      // the 0x0001 extra field; the local-header offset does too — EXCEPT for
      // the first member, which sits at 0 and therefore keeps its 32-bit field.
      // That asymmetry is not decoration: it is what a real writer emits, and it
      // is the case a reader gets wrong by taking the extra field's slots
      // positionally instead of conditionally.
      const offsetIsSentinel = offset !== 0;
      // `declaredUncompressed` lets a case state an uncompressed size LARGER
      // than the archive that holds it, which is what a compressed member of any
      // real package does and which no fixture could express while this was
      // hard-wired to the byte length.
      const declaredU = BigInt(e.declaredUncompressed ?? e.bytes.length);
      const localExtra = Buffer.alloc(20);
      localExtra.writeUInt16LE(0x0001, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(declaredU, 4);
      localExtra.writeBigUInt64LE(BigInt(data.length), 12);
      local.writeUInt32LE(0xffffffff, 18);
      local.writeUInt32LE(0xffffffff, 22);
      local.writeUInt16LE(localExtra.length, 28);
      const centralExtra = Buffer.alloc(offsetIsSentinel ? 28 : 20);
      centralExtra.writeUInt16LE(0x0001, 0);
      centralExtra.writeUInt16LE(offsetIsSentinel ? 24 : 16, 2);
      centralExtra.writeBigUInt64LE(declaredU, 4);
      centralExtra.writeBigUInt64LE(BigInt(data.length), 12);
      if (offsetIsSentinel) centralExtra.writeBigUInt64LE(BigInt(offset), 20);
      central.writeUInt32LE(0xffffffff, 20);
      central.writeUInt32LE(0xffffffff, 24);
      central.writeUInt16LE(centralExtra.length, 30);
      if (offsetIsSentinel) central.writeUInt32LE(0xffffffff, 42);
      locals.push(local, nameBuf, localExtra, data);
      centrals.push(central, nameBuf, centralExtra);
      offset += local.length + nameBuf.length + localExtra.length + data.length;
      continue;
    }
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const tail = [];
  if (zip64) {
    // The EOCD64 record carries the true count/size/offset; the locator says
    // where it is. MakeAppx writes both and then fills the 32-bit EOCD with
    // sentinels REGARDLESS OF SIZE, which is the shape that crashed the guard.
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(entries.length), 24);
    rec.writeBigUInt64LE(BigInt(entries.length), 32);
    rec.writeBigUInt64LE(BigInt(centralBuf.length), 40);
    rec.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + centralBuf.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(rec, locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : centralBuf.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, centralBuf, ...tail, eocd]);
}

// ── fixture repository roots ─────────────────────────────────────────────────
function makeRoot({
  channelIds = ['ios-appstore', 'macos-appstore'],
  /** 🔴 PER ROW, NOT ONE LIST FOR BOTH — the two Apple rows do not declare the
   *  same set. `null` (the default) makes every row declare exactly what the
   *  script expects OF THAT ROW: the four shared names, plus
   *  APPLE_INSTALLER_CERT_P12_BASE64 on macos-appstore. An ARRAY is applied to
   *  every row, which is what the drift cases below want; `namesFor` overrides
   *  a single row by id, which is how "the right name on the wrong row" is
   *  built. A fixture that hardcoded one list for both rows is how the live red
   *  of 2026-08-21 stayed invisible to this file. */
  names = null,
  namesFor = {},
  register = true,
  apps = [{ slug: 'subscriptiontracker' }],
  submissionWorkflow = SUBMIT_WF,
  // ── THE ARMING FIELDS ──────────────────────────────────────────────────────
  // Defaulted to the REAL register's values for both Apple rows: `submittable:
  // true`, `served: false`, and — the field that decides it — `lane: null`.
  // Nothing in this repository emits an .ipa or a .pkg, so a release from these
  // rows would produce nothing to submit, signed or not. A test that wants the
  // release-lane FAILURE arms a row explicitly, and two below do.
  submittable = true,
  served = false,
  lane = null,
  /** Per-row overrides, keyed by channel id. ONE identity signs both Apple rows,
   *  so "either row armed ⇒ fatal" is a real property and needs a fixture that
   *  can arm exactly one of them. */
  rowOverrides = {},
} = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  if (register) {
    const channels = channelIds.map((id) => {
      const row = {
        id,
        submittable,
        served,
        lane,
        ...(rowOverrides[id] ?? {}),
        signing: { ciSecrets: { names: [...(namesFor[id] ?? names ?? expectedNames(id))] } },
      };
      if (submissionWorkflow !== null) row.submission = { workflow: submissionWorkflow };
      return row;
    });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels }));
  }
  if (apps !== null) writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(apps));
  return root;
}

const out = (r) => `${r.stdout}${r.stderr}`;

function runPrepare(root, env, { app = 'subscriptiontracker' } = {}) {
  const outDir = join(TMP, `out${seq++}`);
  const ghEnv = join(TMP, `ghenv${seq++}.txt`);
  const blank = Object.fromEntries(WANTED.map((n) => [n, '']));
  const r = spawnSync(
    process.execPath,
    [PREPARE, '--app', app, '--repo-root', root, '--out', outDir, '--github-env', ghEnv],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...blank,
        // Blanked rather than inherited: these tests may run INSIDE a GitHub
        // job, where both are set to this repository's own values, and a
        // release-lane derivation that read the surrounding run would answer a
        // question about ci.yml instead of about the fixture.
        GITHUB_REF: '',
        GITHUB_WORKFLOW_REF: '',
        ...env,
      },
    },
  );
  return { r, outDir, ghEnv, exported: existsSync(ghEnv) ? readFileSync(ghEnv, 'utf8') : '' };
}

const FULL = () => ({
  [ROLE_ENV.p12]: fakeP12().toString('base64'),
  [ROLE_ENV.p12Password]: 'fixture-passphrase',
  [ROLE_ENV.profiles]: fakeProfile().toString('base64'),
  [ROLE_ENV.teamId]: TEAM,
});

const ON_TAG = { GITHUB_REF: 'refs/tags/subscriptiontracker-v1.0.0' };
const ON_SUBMISSION_WF = { GITHUB_WORKFLOW_REF: `globalonlinedeveloper/repo/${SUBMIT_WF}@refs/heads/main` };

// ═════ the all-or-none law ═══════════════════════════════════════════════════
describe('apple-signing — the all-or-none law', () => {
  test('all four present is "all"', () => {
    const law = secretSetLaw(Object.fromEntries(WANTED.map((n) => [n, 'x'])));
    assert.equal(law.kind, 'all');
    assert.deepEqual(law.missing, []);
  });

  test('none present is "none", and an EMPTY STRING counts as absent', () => {
    const law = secretSetLaw(Object.fromEntries(WANTED.map((n) => [n, '   '])));
    assert.equal(law.kind, 'none');
    assert.deepEqual(law.supplied, []);
  });

  test('three of four is "partial" and names exactly the missing one', () => {
    const values = Object.fromEntries(WANTED.map((n) => [n, 'x']));
    values[ROLE_ENV.profiles] = '';
    const law = secretSetLaw(values);
    assert.equal(law.kind, 'partial');
    assert.deepEqual(law.missing, [ROLE_ENV.profiles]);
  });

  test('the wanted set is exactly the four names PR #202 declared', () => {
    assert.deepEqual([...WANTED].sort(), [
      'APPLE_DIST_CERT_P12_BASE64',
      'APPLE_DIST_CERT_PASSWORD',
      'APPLE_PROVISIONING_PROFILES_BASE64',
      'APPLE_TEAM_ID',
    ]);
  });

  test('🔴 the installer certificate is RECOGNISED but NOT wanted — the law must not range over it', () => {
    // The distinction the fix rests on. The name is in the role map so the
    // register may declare it; it is out of WANTED so the all-or-none law never
    // sees it. Folding it in would turn "the four dist secrets are supplied" —
    // the only state OWNER_QUEUE A-4 can ever produce first — into `partial`,
    // which is fatal on every lane, and would reverse the deliberate decision
    // recorded in this script's header to PRINT the installer gap, not fail on it.
    assert.ok(Object.values(ROLE_ENV).includes('APPLE_INSTALLER_CERT_P12_BASE64'));
    assert.ok(!WANTED.includes('APPLE_INSTALLER_CERT_P12_BASE64'));
    const all = secretSetLaw(Object.fromEntries(WANTED.map((n) => [n, 'x'])));
    assert.equal(all.kind, 'all', 'the four dist secrets alone must still be a COMPLETE set');
  });
});

// ═════ the role map is scoped PER ROW ════════════════════════════════════════
describe('apple-signing — the role map is compared per ROW, both directions', () => {
  // 🔴 THE THIRD COPY OF THE NAME LIST, AND THE ONLY THING THAT KEEPS IT HONEST.
  // apple-signing.mjs now enumerates the names three times — ROLE_ENV (5, the
  // vocabulary), WANTED (4, the shared set the all-or-none law ranges over) and
  // ROW_ONLY_ENV (1, scoped to macos-appstore) — and its own header calls "two
  // copies of a list drift" the defect it exists to prevent. Nothing asserted
  // that the last two PARTITION the first, so a sixth role could be added to
  // ROLE_ENV and reach neither WANTED nor ROW_ONLY_ENV: `expectedNames()` would
  // never expect it, `homeRowOf()` would return null for it, and a row that
  // correctly declared it would be reported as drift. Measured 2026-08-21 in a
  // scratch mirror with `notary: 'APPLE_NOTARY_PASSWORD_BASE64'` added to
  // ROLE_ENV and declared on the ios row: `node tooling/ci/apple-signing.mjs
  // --app subscriptiontracker` EXIT 1, "⚠️ APPLE_NOTARY_PASSWORD_BASE64 IS known here — but
  // only on the null row". This test is the negative half of that.
  test('🔴 WANTED and ROW_ONLY_ENV PARTITION ROLE_ENV — no role can be known but unreachable', () => {
    assert.deepEqual(
      [...WANTED, ...Object.values(ROW_ONLY_ENV).flat()].sort(),
      Object.values(ROLE_ENV).sort(),
      'every name in the role map must be either shared (WANTED) or scoped to exactly one row (ROW_ONLY_ENV), and nothing may be in both',
    );
  });

  test('ios-appstore expects the four shared names and nothing else', () => {
    assert.deepEqual(expectedNames('ios-appstore').sort(), [...WANTED].sort());
  });

  test('macos-appstore expects the four PLUS the installer certificate', () => {
    assert.deepEqual(expectedNames('macos-appstore').sort(), [...WANTED, ROLE_ENV.installerP12].sort());
  });

  test('an exactly-matching row drifts in neither direction', () => {
    for (const id of ['ios-appstore', 'macos-appstore']) {
      const d = registerDrift(id, expectedNames(id));
      assert.deepEqual(d.extra, [], id);
      assert.deepEqual(d.absent, [], id);
      assert.deepEqual(d.misplaced, [], id);
    }
  });

  test('order does not matter — the comparison is on SETS', () => {
    const d = registerDrift('macos-appstore', [...expectedNames('macos-appstore')].reverse());
    assert.deepEqual(d.extra, []);
    assert.deepEqual(d.absent, []);
  });

  test('a name declared and unknown here comes out as `extra`', () => {
    const d = registerDrift('ios-appstore', [...WANTED, 'APPLE_NOTARY_PASSWORD_BASE64']);
    assert.deepEqual(d.extra, ['APPLE_NOTARY_PASSWORD_BASE64']);
    assert.deepEqual(d.misplaced, [], 'an unknown name is not a misplaced one');
  });

  test('a name expected here and dropped there comes out as `absent`', () => {
    const d = registerDrift('macos-appstore', [...WANTED]);
    assert.deepEqual(d.absent, [ROLE_ENV.installerP12]);
    assert.deepEqual(d.extra, []);
  });

  test('the installer certificate on the ios row is `extra` AND `misplaced`, and names its home row', () => {
    const d = registerDrift('ios-appstore', [...WANTED, ROLE_ENV.installerP12]);
    assert.deepEqual(d.extra, [ROLE_ENV.installerP12]);
    assert.deepEqual(d.misplaced, [ROLE_ENV.installerP12]);
    assert.equal(homeRowOf(ROLE_ENV.installerP12), 'macos-appstore');
    assert.equal(homeRowOf(ROLE_ENV.p12), null, 'a shared name has no single home row');
  });

  test('a channel this script does not scope gets the shared four, not a crash', () => {
    assert.deepEqual(expectedNames('android-play').sort(), [...WANTED].sort());
  });

  test('a non-array `names` is treated as declaring NOTHING, never as agreeing', () => {
    const d = registerDrift('ios-appstore', undefined);
    assert.deepEqual(d.absent.sort(), [...WANTED].sort());
  });
});

// ═════ the release lane, derived ═════════════════════════════════════════════
describe('apple-signing — a release lane is DERIVED, not declared in YAML', () => {
  test('a TAG push requires signing and says which signal decided it', () => {
    const lane = releaseLane({ gitRef: 'refs/tags/subscriptiontracker-v1.0.0', submissionWorkflows: [SUBMIT_WF] });
    assert.equal(lane.required, true);
    assert.match(lane.reasons.join('\n'), /TAG push/);
  });

  test("the channel's DECLARED submission workflow requires signing", () => {
    const lane = releaseLane({ workflowRef: `owner/repo/${SUBMIT_WF}@refs/heads/main`, submissionWorkflows: [SUBMIT_WF] });
    assert.equal(lane.required, true);
    assert.match(lane.reasons.join('\n'), /declared Apple submission workflow/);
  });

  test('the workflow ref is matched on its PATH, so a branch name cannot change the answer', () => {
    const lane = releaseLane({ workflowRef: `owner/other-repo/${SUBMIT_WF}@refs/tags/whatever`, submissionWorkflows: [SUBMIT_WF] });
    assert.equal(lane.required, true);
  });

  test('ANOTHER workflow on a branch does NOT — the build proof stays legal', () => {
    const lane = releaseLane({
      gitRef: 'refs/heads/feat/whatever',
      workflowRef: 'owner/repo/.github/workflows/build-platforms.yml@refs/heads/feat/whatever',
      submissionWorkflows: [SUBMIT_WF],
    });
    assert.equal(lane.required, false);
  });

  test('a register with no submission.workflow PRINTS the narrowed derivation rather than hiding it', () => {
    const lane = releaseLane({ workflowRef: `owner/repo/${SUBMIT_WF}@refs/heads/main`, submissionWorkflows: [] });
    assert.equal(lane.required, false);
    assert.match(lane.blind.join('\n'), /limb \(b\) contributed nothing/);
  });

  test('an unset GITHUB_WORKFLOW_REF is reported as a signal that could not contribute', () => {
    const lane = releaseLane({ workflowRef: '', submissionWorkflows: [SUBMIT_WF] });
    assert.match(lane.blind.join('\n'), /GITHUB_WORKFLOW_REF is unset/);
  });
});

// ═════ the four endings ══════════════════════════════════════════════════════
describe('apple-signing — posture resolution', () => {
  const all = secretSetLaw(Object.fromEntries(WANTED.map((n) => [n, 'x'])));
  const none = secretSetLaw(Object.fromEntries(WANTED.map((n) => [n, ''])));
  const partial = (() => {
    const v = Object.fromEntries(WANTED.map((n) => [n, 'x']));
    v[ROLE_ENV.teamId] = '';
    return secretSetLaw(v);
  })();

  test('none + non-release lane → the labelled unsigned build proof', () => {
    const d = resolvePosture({ law: none, required: false, platform: 'darwin' });
    assert.equal(d.posture, UNSIGNED_PROOF);
    assert.equal(d.fatal, null);
  });

  // RE-PINNED 2026-09-08. This used to assert /OWNER_QUEUE A-4/, a pin on a claim
  // that stopped being true: the enrolment completed 2026-08-31, A-4 closed with
  // it, and an authenticated App Store Connect call answered HTTP 200 on
  // 2026-09-08. The named item is now the CERTIFICATE and the pin says so - a
  // regex matching either wording could not tell this change from a revert.
  test('none + RELEASE lane → fatal, naming the missing certificate rather than a secret', () => {
    const d = resolvePosture({ law: none, required: true, platform: 'darwin' });
    assert.equal(d.posture, null);
    const text = d.fatal.lines.join('\n');
    assert.match(text, /RELEASE lane/);
    assert.match(text, /NO LONGER A CERTIFICATE: App Store screenshots and the owner-run first submission/);
    assert.doesNotMatch(text, /IT IS AN ACCOUNT/, 'the account exists; that sentence was the defect');
    // 2026-09-09: and it is no longer a certificate either — one was issued today.
    assert.doesNotMatch(text, /IT IS A CERTIFICATE/, 'the certificate exists; that sentence is the new defect');
    for (const n of WANTED) assert.match(text, new RegExp(n));
  });

  test('🔴 `armed: []` leaves the release-lane message BYTE FOR BYTE what it was', () => {
    // The rescope's whole claim is that it changed WHEN the failure fires, not
    // WHAT it says. `armed` defaulting to nothing must therefore be invisible —
    // and this compares the two forms rather than trusting the reading.
    const before = resolvePosture({ law: none, required: true, platform: 'darwin' }).fatal.lines;
    const withEmpty = resolvePosture({ law: none, required: true, platform: 'darwin', armed: [] }).fatal.lines;
    assert.deepEqual(withEmpty, before);
    assert.ok(!before.join('\n').includes('IS ARMED'), 'an empty armed set must contribute no lines at all');
  });

  test('an ARMED row adds the field that armed it to the same message', () => {
    const armed = [armingOf({ id: 'ios-appstore', submittable: true, served: true, lane: null })];
    const text = resolvePosture({ law: none, required: true, platform: 'darwin', armed }).fatal.lines.join('\n');
    assert.match(text, /channel "ios-appstore" IS ARMED/);
    assert.match(text, /`served: true`/);
    // …and the original message survives underneath it.
    assert.match(text, /NO LONGER A CERTIFICATE: App Store screenshots and the owner-run first submission/);
  });

  test('partial → fatal on EVERY lane, release or not', () => {
    // `partial` here is the three KEY-MATERIAL names with the team id missing,
    // which is fatal on every lane including a build proof — the 2026-09-07
    // narrowing below goes the other way round and does not reach this fixture.
    for (const required of [true, false]) {
      const d = resolvePosture({ law: partial, required, platform: 'darwin' });
      assert.equal(d.posture, null, `required=${required} must still be fatal`);
      assert.match(d.fatal.lines.join('\n'), /HALF configured/);
    }
  });

  // ── the team-id-only build proof (2026-09-07) ──────────────────────────────
  // Run 34094776599's Apple job died on `supplied: APPLE_TEAM_ID` one line after
  // printing `lane requires signing: no`. Run 33870692144 had passed the same
  // step four days earlier with no code change between them — an APPLE_TEAM_ID
  // repository secret was created in between. These cases pin the narrowing AND
  // its four edges, because a rule that only ever says yes is not a rule.
  const teamIdOnly = (() => {
    const v = Object.fromEntries(WANTED.map((n) => [n, '']));
    v[ROLE_ENV.teamId] = 'ABCDE12345';
    return secretSetLaw(v);
  })();

  test('🔴 team id ONLY on a BUILD PROOF lane → the labelled unsigned proof, not a failure', () => {
    const d = resolvePosture({ law: teamIdOnly, required: false, platform: 'darwin', proofLane: true });
    assert.equal(d.posture, UNSIGNED_PROOF);
    assert.equal(d.fatal, null);
    // The supplied name is carried back so the caller can PRINT that it was
    // ignored. Silently treating a supplied value as absent is the failure shape
    // this whole file exists to refuse.
    assert.deepEqual(d.ignoredIdentity, [ROLE_ENV.teamId]);
  });

  test('🔴 team id only on a RELEASE lane is STILL fatal — the all-or-none law did not move', () => {
    const d = resolvePosture({ law: teamIdOnly, required: true, platform: 'darwin', proofLane: false });
    assert.equal(d.posture, null);
    assert.match(d.fatal.lines.join('\n'), /HALF configured/);
  });

  test('🔴 `proofLane` DEFAULTS to false, so every pre-existing caller is unchanged', () => {
    const d = resolvePosture({ law: teamIdOnly, required: false, platform: 'darwin' });
    assert.equal(d.posture, null, 'omitting proofLane must not open the narrowing');
    assert.match(d.fatal.lines.join('\n'), /HALF configured/);
  });

  test('🔴 KEY MATERIAL on a build proof lane is still fatal — with the team id and without it', () => {
    // The narrowing is "no key material", never "some names are optional". A
    // .p12 with no password would go on to sign with something nobody chose.
    for (const extra of [[ROLE_ENV.p12], [ROLE_ENV.p12, ROLE_ENV.teamId], [ROLE_ENV.profiles]]) {
      const v = Object.fromEntries(WANTED.map((n) => [n, '']));
      for (const n of extra) v[n] = 'x';
      const d = resolvePosture({ law: secretSetLaw(v), required: false, platform: 'darwin', proofLane: true });
      assert.equal(d.posture, null, `${extra.join('+')} must stay fatal on a build proof lane`);
      assert.match(d.fatal.lines.join('\n'), /HALF configured/);
    }
  });

  test('🔴 KEYLESS_ENV holds NO name that can sign or unlock anything', () => {
    // The guard on the guard: the day somebody adds a name here, this refuses
    // any of the three that hold or unlock key material.
    assert.deepEqual([...KEYLESS_ENV], [ROLE_ENV.teamId]);
    for (const n of [ROLE_ENV.p12, ROLE_ENV.p12Password, ROLE_ENV.profiles, ROLE_ENV.installerP12]) {
      assert.ok(!KEYLESS_ENV.includes(n), `${n} carries key material and must never be keyless`);
    }
    for (const n of KEYLESS_ENV) assert.ok(WANTED.includes(n), `${n} must be one of the WANTED names`);
  });

  test('the partial failure names the missing secret and the supplied ones', () => {
    const d = resolvePosture({ law: partial, required: false, platform: 'darwin' });
    const text = d.fatal.lines.join('\n');
    assert.match(text, new RegExp(`missing:\\s+${ROLE_ENV.teamId}`));
    assert.match(text, new RegExp(ROLE_ENV.p12));
  });

  test('all four on macOS → release-signed', () => {
    const d = resolvePosture({ law: all, required: true, platform: 'darwin' });
    assert.equal(d.posture, RELEASE_SIGNED);
    assert.equal(d.fatal, null);
  });

  test('all four on a NON-macOS runner → fatal, and it names the platform', () => {
    // The branch that cannot be exercised by running the script on a Mac, and
    // the reason `platform` is an argument rather than a read of process.
    const d = resolvePosture({ law: all, required: false, platform: 'linux' });
    assert.equal(d.posture, null);
    assert.match(d.fatal.lines.join('\n'), /"linux", not macOS/);
    assert.match(d.fatal.lines.join('\n'), /COVERAGE/);
  });

  test('a posture is NEVER produced alongside a fatal — the caller cannot export both', () => {
    for (const platform of ['darwin', 'win32']) {
      for (const law of [all, none, partial]) {
        for (const required of [true, false]) {
          const d = resolvePosture({ law, required, platform });
          assert.ok(
            (d.posture === null) !== (d.fatal === null),
            `exactly one of posture/fatal must be set (${law.kind}/${platform}/${required})`,
          );
        }
      }
    }
  });
});

// ═════ the keychain plan ═════════════════════════════════════════════════════
describe('apple-signing — the keychain plan', () => {
  const plan = () =>
    keychainPlan({
      keychain: '/tmp/subscriptiontracker-signing.keychain-db',
      keychainPassword: 'per-run-random',
      p12Path: '/tmp/subscriptiontracker-distribution.p12',
      p12Password: 'the-passphrase',
      existingKeychains: ['/Users/runner/Library/Keychains/login.keychain-db'],
    });

  test('the keychain is created, unlocked and imported into — in that order', () => {
    const verbs = plan().map((s) => s.argv[1]);
    assert.deepEqual(verbs, [
      'create-keychain', 'set-keychain-settings', 'unlock-keychain', 'import',
      'set-key-partition-list', 'list-keychains',
    ]);
  });

  test('set-key-partition-list is present — without it the first key use HANGS a headless runner', () => {
    const step = plan().find((s) => s.argv[1] === 'set-key-partition-list');
    assert.ok(step, 'the step that suppresses the macOS UI prompt is missing');
    assert.ok(step.argv.includes('apple-tool:,apple:,codesign:'));
  });

  test('import grants named tools with -T and never the blanket -A', () => {
    const step = plan().find((s) => s.argv[1] === 'import');
    assert.ok(step.argv.includes('/usr/bin/codesign'));
    assert.ok(!step.argv.includes('-A'), '-A allows ANY application to use the key; -T is the bounded form');
  });

  test('list-keychains KEEPS the existing search list — replacing it breaks the rest of the job', () => {
    const step = plan().find((s) => s.argv[1] === 'list-keychains');
    assert.ok(step.argv.includes('/Users/runner/Library/Keychains/login.keychain-db'));
  });

  test('redactArgv hides BOTH passwords and leaves the paths readable', () => {
    for (const step of plan()) {
      const shown = redactArgv(step.argv, ['per-run-random', 'the-passphrase']).join(' ');
      assert.doesNotMatch(shown, /per-run-random/);
      assert.doesNotMatch(shown, /the-passphrase/);
    }
    const created = redactArgv(plan()[0].argv, ['per-run-random']).join(' ');
    assert.match(created, /subscriptiontracker-signing\.keychain-db/);
  });

  test('redactArgv does not blank an argument merely because a secret is EMPTY', () => {
    assert.deepEqual(redactArgv(['security', 'unlock-keychain', '-p', ''], ['']), ['security', 'unlock-keychain', '-p', '']);
  });
});

// ═════ the record-shaped validators ══════════════════════════════════════════
describe('apple-signing — the team identifier', () => {
  test('a real-shaped team id passes', () => {
    assert.equal(teamIdProblem(TEAM), null);
  });

  for (const bad of ['A1B2C3D4E', 'A1B2C3D4E56', 'a1b2c3d4e5', 'A1B2-C3D4E', '']) {
    test(`${JSON.stringify(bad)} is refused as a team identifier`, () => {
      assert.match(String(teamIdProblem(bad)), /10-character Apple team identifier/);
    });
  }

  test('the refusal never prints the value it refused', () => {
    assert.doesNotMatch(String(teamIdProblem('SECRETVAL1X')), /SECRETVAL1X/);
  });
});

describe('apple-signing — the provisioning profile reader', () => {
  test('name, team, bundle id and expiry come out of the embedded plist', () => {
    const p = parseMobileProvision(fakeProfile());
    assert.equal(p.name, 'Subly App Store');
    assert.deepEqual(p.teamIds, [TEAM]);
    assert.equal(p.bundleId, 'com.nikatru.subscriptiontracker');
    assert.equal(p.expires, '2027-07-31T00:00:00Z');
  });

  test('the `Name` key is not confused with `AppIDName`, which sits above it', () => {
    // The fixture carries both. A looser matcher reads "Subly" as the profile
    // name and ExportOptions.plist then addresses a profile that does not exist.
    assert.equal(parseMobileProvision(fakeProfile()).name, 'Subly App Store');
  });

  test('bytes with no plist inside are NOT a profile', () => {
    assert.equal(parseMobileProvision(Buffer.from([0x30, 0x82, 0x01, 0x00, 0x41, 0x41])), null);
  });

  test('an HTML error page is not a profile', () => {
    assert.equal(parseMobileProvision(Buffer.from('<html><body>404</body></html>')), null);
  });
});

describe('apple-signing — the profiles container', () => {
  test('a single DER profile is accepted as one member', () => {
    const { kind, members } = profileMembers(fakeProfile());
    assert.equal(kind, 'single');
    assert.equal(members.length, 1);
  });

  test('a zip of two profiles yields two members, stored and deflated alike', () => {
    const zip = makeZip([
      { name: 'subscriptiontracker-ios.mobileprovision', bytes: fakeProfile({ name: 'Subly iOS' }), method: 0 },
      { name: 'subscriptiontracker-macos.provisionprofile', bytes: fakeProfile({ name: 'Subly macOS' }), method: 8 },
    ]);
    const { kind, members } = profileMembers(zip);
    assert.equal(kind, 'zip');
    assert.equal(members.length, 2);
    assert.equal(parseMobileProvision(members[0].bytes).name, 'Subly iOS');
    assert.equal(parseMobileProvision(members[1].bytes).name, 'Subly macOS');
  });

  test('a zip member using an unsupported method is REPORTED, never silently dropped', () => {
    const zip = makeZip([{ name: 'weird.mobileprovision', bytes: fakeProfile(), method: 0 }]);
    // Rewrite the compression method in both headers to 12 (bzip2), which no
    // Apple tool produces and this reader does not implement.
    const patched = Buffer.from(zip);
    for (let i = 0; i + 4 < patched.length; i++) {
      if (patched.readUInt32LE(i) === 0x04034b50) patched.writeUInt16LE(12, i + 8);
      if (patched.readUInt32LE(i) === 0x02014b50) patched.writeUInt16LE(12, i + 10);
    }
    const { members } = profileMembers(patched);
    assert.equal(members.length, 1);
    assert.equal(members[0].bytes, null);
    assert.equal(members[0].unsupportedMethod, 12);
  });

  test('bytes that are neither DER nor a zip are refused', () => {
    const { kind, members } = profileMembers(Buffer.from('not a profile at all'));
    assert.equal(kind, 'unknown');
    assert.equal(members, null);
  });

  test('unzip returns null on a truncated archive rather than a partial list', () => {
    const zip = makeZip([{ name: 'a.mobileprovision', bytes: fakeProfile(), method: 0 }]);
    assert.equal(unzip(zip.slice(0, 10)), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unzip — ZIP64, WHICH IS NOT AN APPLE CASE AND IS WHY IT IS TESTED HERE
//
// 🔴 unzip() HAS TWO CALLERS AND ONLY ONE OF THEM IS APPLE.
// tooling/ci/assert-artifact-signed-msix.mjs hands it a Windows .msix, and an
// .msix is an OPC/APPX package: the packaging tool writes the ZIP64 end-of-
// central-directory record, its locator and the 0xFFFF/0xFFFFFFFF sentinels
// REGARDLESS OF SIZE. On build-platforms run 32814517717 a 16,585,912-byte
// package made this function evaluate `buffer.readUInt32LE(4294967295)` and
// throw `RangeError [ERR_OUT_OF_RANGE]`; the guard did not fail, it CRASHED,
// and the Windows leg had been dead for weeks behind an earlier defect.
//
// ⚠️ THE ZIP64 CASES LIVE IN THE APPLE SUITE ON PURPOSE. The function is on the
// Apple RELEASE-SIGNING path, which is green. Whatever ZIP64 costs, it must cost
// the Apple side nothing — so the pin below ('a classic archive is read by the
// same statements…') is in the same file as everything that reads a profile
// bundle, where a change to unzip() cannot be reviewed without seeing it.
// ─────────────────────────────────────────────────────────────────────────────
describe('apple-signing — unzip and ZIP64', () => {
  const members = () => [
    { name: 'AppxManifest.xml', bytes: Buffer.from('<Package><Identity Name="X" /></Package>', 'utf8'), method: 8 },
    { name: 'subscriptiontracker.exe', bytes: Buffer.from('PE-BYTES'), method: 0 },
    { name: 'Assets/icon.png', bytes: Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), Buffer.alloc(200, 0x78)]), method: 8 },
  ];
  const find = (buf, sig) => buf.indexOf(Buffer.from([sig & 0xff, (sig >>> 8) & 0xff, (sig >>> 16) & 0xff, (sig >>> 24) & 0xff]));
  const eocdOf = (buf) => buf.length - 22;
  const cdStart = (buf) => Number(buf.readBigUInt64LE(find(buf, 0x06064b50) + 48));
  /** The LAST central-directory entry — the one with nothing after it to absorb
   *  an over-long extra field, which is what the two bound checks are about. */
  const lastCdEntry = (buf) => {
    let p = cdStart(buf);
    const n = Number(buf.readBigUInt64LE(find(buf, 0x06064b50) + 32));
    for (let i = 0; i < n - 1; i++) p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    return p;
  };

  test('the fixture really is ZIP64 — locator, record and sentinels, none of them assumed', () => {
    const zip = makeZip(members(), { zip64: true });
    assert.notEqual(find(zip, 0x07064b50), -1, 'EOCD64 locator signature 0x07064b50 must be present');
    assert.notEqual(find(zip, 0x06064b50), -1, 'EOCD64 record signature 0x06064b50 must be present');
    assert.equal(zip.readUInt16LE(eocdOf(zip) + 10), 0xffff, 'EOCD entry count must be the sentinel');
    assert.equal(zip.readUInt32LE(eocdOf(zip) + 16), 0xffffffff, 'EOCD central-directory offset must be the sentinel');
    // And the classic form of the SAME members must carry none of it, or the
    // non-regression pin below would be comparing ZIP64 against ZIP64.
    const classic = makeZip(members());
    assert.equal(find(classic, 0x07064b50), -1);
    assert.equal(classic.readUInt32LE(eocdOf(classic) + 16) === 0xffffffff, false);
  });

  // 🔴 THE CASE NO CONSTRUCTED FIXTURE COULD REACH UNTIL THE REAL PACKAGE WAS IN
  // HAND. The first ZIP64 fix made unzip() stop CRASHING on the .msix and start
  // REFUSING it — `could not be read as a zip` — because the slot reader applied
  // one bound to every 64-bit field: "nothing inside this archive can sit past
  // its own end". True of an OFFSET. True of a COMPRESSED size. FALSE of an
  // UNCOMPRESSED one, which describes the decompressed content and is routinely
  // larger than the whole archive. That is what compression IS.
  //
  // MEASURED on the real subscriptiontracker.msix (build-platforms 32823633046, the first run
  // to keep the package after the guard refused it — see PR #372): 96 members,
  // every one carrying sentinels, and entry [2] `flutter_windows.dll` declaring
  // an uncompressed size of 21,284,864 bytes inside a 16,585,733-byte archive.
  // 1.28x the file containing it, and entirely ordinary for a DLL.
  //
  // The fixture could not express this while it wrote `e.bytes.length` into that
  // slot — the declared size was the real one by construction, so the bound was
  // never violated and every ZIP64 test passed over an archive that could not
  // occur. `declaredUncompressed` exists for exactly this.
  test('an uncompressed size LARGER than the archive is read, not refused', () => {
    const big = members().map((m, i) => (i === 1 ? { ...m, declaredUncompressed: 21284864 } : m));
    const zip = makeZip(big, { zip64: true });
    assert.ok(21284864 > zip.length, 'the declared size must exceed the archive, or this pins nothing');
    const out = unzip(zip);
    assert.notEqual(out, null, 'a member that decompresses to more than the archive holds must still open');
    assert.deepEqual(out.map((e) => e.name), ['AppxManifest.xml', 'subscriptiontracker.exe', 'Assets/icon.png']);
    for (const [i, m] of members().entries()) assert.deepEqual(out[i].bytes, m.bytes);
  });

  // The bound still HOLDS where it is true: an OFFSET past the end is corruption
  // and must still be refused, or the repair would have removed the check rather
  // than aimed it.
  test('an OFFSET past the end of the archive is still refused', () => {
    const zip = makeZip(members(), { zip64: true });
    const cd = zip.readBigUInt64LE(Number(zip.readBigUInt64LE(eocdOf(zip) - 20 + 8)) + 48);
    let p = Number(cd);
    // second entry: its local offset is a sentinel, so the extra field carries it
    p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraStart = p + 46 + nameLen;
    // slots: uncompressed, compressed, offset -> the offset is the third
    zip.writeBigUInt64LE(BigInt(zip.length + 4096), extraStart + 4 + 16);
    assert.equal(unzip(zip), null, 'a local-header offset beyond the archive must still be refused');
  });

  test('a ZIP64 archive is READ — the exact shape that threw ERR_OUT_OF_RANGE', () => {
    const zip = makeZip(members(), { zip64: true });
    const out = unzip(zip);
    assert.notEqual(out, null, 'a ZIP64 archive must open, not return null');
    assert.deepEqual(out.map((e) => e.name), ['AppxManifest.xml', 'subscriptiontracker.exe', 'Assets/icon.png']);
    for (const [i, m] of members().entries()) assert.deepEqual(out[i].bytes, m.bytes);
  });

  test('ZIP64 and classic forms of the same members yield IDENTICAL bytes', () => {
    const a = unzip(makeZip(members()));
    const b = unzip(makeZip(members(), { zip64: true }));
    assert.deepEqual(a, b);
  });

  // ── every refusal below is a `return null`, which both callers already read
  //    as "not a readable zip". None of them is a crash and none is a pass. ──
  test('an EOCD sentinel with NO locator behind it is refused, not indexed', () => {
    const zip = makeZip(members(), { zip64: true });
    zip.writeUInt32LE(0x07064b51, find(zip, 0x07064b50)); // one bit off the locator signature
    assert.equal(unzip(zip), null);
  });

  test('a locator pointing at something that is not an EOCD64 record is refused', () => {
    const zip = makeZip(members(), { zip64: true });
    zip.writeUInt32LE(0x06064b51, find(zip, 0x06064b50));
    assert.equal(unzip(zip), null);
  });

  test('an EOCD64 record pointed outside the archive is refused, not read', () => {
    const zip = makeZip(members(), { zip64: true });
    zip.writeBigUInt64LE(0xffffffffn, find(zip, 0x07064b50) + 8);
    assert.equal(unzip(zip), null);
  });

  test('the entry count comes from the EOCD64 record, not from the sentinel', () => {
    const zip = makeZip(members(), { zip64: true });
    const rec = find(zip, 0x06064b50);
    assert.equal(Number(zip.readBigUInt64LE(rec + 32)), 3);
    zip.writeBigUInt64LE(2n, rec + 32);
    assert.equal(unzip(zip).length, 2, 'a reader taking the count from anywhere else would still say 3');
  });

  test('the central-directory offset comes from the EOCD64 record', () => {
    const zip = makeZip(members(), { zip64: true });
    const rec = find(zip, 0x06064b50);
    zip.writeBigUInt64LE(BigInt(cdStart(zip) + 1), rec + 48); // one byte off the real start
    assert.equal(unzip(zip), null, 'a central directory that does not start with 0x02014b50 is refused');
  });

  test('the UNCOMPRESSED-size slot is stepped over, never read as the compressed size', () => {
    // The first member's extra field carries [uncompressed, compressed] and no
    // offset; the later members carry [uncompressed, compressed, offset]. A
    // reader that takes slot 0 as the compressed size decompresses the wrong
    // byte range — and for a STORED member it silently returns the wrong length
    // instead of throwing, which is the failure that looks like a pass.
    const zip = makeZip(members(), { zip64: true });
    const out = unzip(zip);
    assert.equal(out[1].name, 'subscriptiontracker.exe');
    assert.equal(out[1].bytes.length, 8, 'stored member must carry its 8 real bytes');
    assert.equal(out[1].bytes.toString(), 'PE-BYTES');
    assert.equal(out[0].bytes.toString('utf8'), '<Package><Identity Name="X" /></Package>');
  });

  test('a ZIP64 extra field truncated mid-slot is refused rather than guessed', () => {
    const zip = makeZip(members(), { zip64: true });
    const cd = cdStart(zip);
    const nameLen = zip.readUInt16LE(cd + 28);
    zip.writeUInt16LE(8, cd + 46 + nameLen + 2); // payload says 8 bytes; two slots need 16
    assert.equal(unzip(zip), null);
  });

  test('an entry whose extra field is not ZIP64 at all is refused, not defaulted', () => {
    const zip = makeZip(members(), { zip64: true });
    const cd = cdStart(zip);
    const nameLen = zip.readUInt16LE(cd + 28);
    zip.writeUInt16LE(0x5455, cd + 46 + nameLen); // 0x5455 = extended timestamp
    assert.equal(unzip(zip), null);
  });

  test('an extra field claiming MORE payload than the extra area holds is refused', () => {
    // One byte over. Every slot the reader wants is still inside the area, so a
    // reader without this bound answers CORRECTLY and never notices — which is
    // why the mutation of this line has to be caught by an input where being
    // wrong looks like being right.
    const zip = makeZip(members(), { zip64: true });
    const cd = lastCdEntry(zip);
    const nameLen = zip.readUInt16LE(cd + 28);
    assert.equal(zip.readUInt16LE(cd + 46 + nameLen + 2), 24, 'the last entry carries all three slots');
    zip.writeUInt16LE(25, cd + 46 + nameLen + 2);
    assert.equal(unzip(zip), null);
  });

  test('an extra AREA declared past the end of the archive is refused', () => {
    const zip = makeZip(members(), { zip64: true });
    zip.writeUInt16LE(0xffff, lastCdEntry(zip) + 30);
    assert.equal(unzip(zip), null);
  });

  test('a 64-bit value larger than the archive is refused, not turned into an index', () => {
    const zip = makeZip(members(), { zip64: true });
    const cd = cdStart(zip);
    const nameLen = zip.readUInt16LE(cd + 28);
    // Slot 1 of the first entry is its compressed size; make it absurd.
    zip.writeBigUInt64LE(0xfffffffffn, cd + 46 + nameLen + 4 + 8);
    assert.equal(unzip(zip), null);
  });

  test('a classic archive is read by the same statements — ZIP64 cost the Apple path nothing', () => {
    // 🔴 THE PIN. unzip() is on the Apple RELEASE-SIGNING path; macOS and iOS
    // were GREEN on the run that killed Windows. Every non-ZIP64 answer this
    // function can give — members, null, and the RangeError it throws on a
    // corrupt central directory — is fixed here, over a real profile bundle and
    // over every truncation of it, so that widening the reader cannot quietly
    // narrow it.
    // 🔴 THESE TWO MEMBER NAMES ARE PINNED BYTES, NOT AN APP IDENTITY, AND THEY
    // DO NOT MOVE WITH THE SLUG. The member name is written twice into the
    // archive (local header and central directory), so renaming it changes the
    // archive's LENGTH — and the two constants at the bottom of this test are
    // measurements over that exact length: `answers.length` is the archive size
    // divided by the smear stride, and the digest is over every answer unzip()
    // gives across it. The `subly` -> `subscriptiontracker` rename on 2026-09-09
    // grew the archive by 84 bytes and took both of them red.
    //
    // Restoring the names is the fix rather than repasting node's new numbers,
    // because the digest's whole claim is HISTORICAL: it is what this function
    // answered BEFORE ZIP64 support was added to it, and that comparison exists
    // only against these bytes. Re-baselining it over a renamed fixture would
    // leave a constant that looks identical and proves nothing — the pre-ZIP64
    // reader can no longer be run to re-derive it. A profile bundle's member
    // names are arbitrary strings chosen by whoever zipped it; nothing about the
    // app's published identity is asserted here, and nothing downstream reads
    // them.
    // The same applies to the BUNDLE ID: `fakeProfile`'s default is the app's
    // real one, so leaving it defaulted let the store-identifier change of the
    // same day into these bytes too. This test therefore states every field it
    // depends on instead of inheriting one, which is what makes the pin immune
    // to the next identity change rather than merely repaired after this one.
    const PINNED_IOS_MEMBER = 'subly-ios.mobileprovision';
    const PINNED_MACOS_MEMBER = 'subly-macos.provisionprofile';
    const PINNED_BUNDLE_ID = 'com.nikatru.subly';
    const zip = makeZip([
      { name: PINNED_IOS_MEMBER, bytes: fakeProfile({ name: 'Subly iOS', bundleId: PINNED_BUNDLE_ID }), method: 0 },
      { name: PINNED_MACOS_MEMBER, bytes: fakeProfile({ name: 'Subly macOS', bundleId: PINNED_BUNDLE_ID }), method: 8 },
    ]);
    assert.equal(zip.length, 1888, 'the pinned fixture is no longer the 1888-byte archive the two constants below were measured over');
    assert.equal(zip.readUInt32LE(eocdOf(zip) + 16) === 0xffffffff, false, 'the fixture must not be ZIP64');
    const full = unzip(zip);
    assert.equal(full.length, 2);
    assert.equal(parseMobileProvision(full[0].bytes).name, 'Subly iOS');
    assert.equal(parseMobileProvision(full[1].bytes).name, 'Subly macOS');

    // MEASURED, not asserted in the abstract: of the 1889 prefixes of this
    // 1888-byte archive, exactly ONE (the whole of it) yields a member list and
    // every other yields null. Not "at least one" — the exact partition, so that
    // a reader which started refusing or started guessing is equally visible.
    let lists = 0;
    let nulls = 0;
    let threw = 0;
    for (let n = 0; n <= zip.length; n++) {
      let r;
      try { r = unzip(zip.subarray(0, n)); } catch { threw++; continue; }
      if (r === null) { nulls++; continue; }
      lists++;
      assert.deepEqual(r, full, `truncation at ${n} produced a DIFFERENT member list`);
    }
    assert.deepEqual({ lists, nulls, threw }, { lists: 1, nulls: zip.length, threw: 0 });

    // ── AND THE CORRUPTED CASES, PINNED BY DIGEST ────────────────────────────
    // A byte smeared to 0xff at every fourth offset gives 472 answers: member
    // lists, nulls, and the RangeError unzip() has always thrown when a
    // corrupted header sends it past the end of the buffer. Some of those lists
    // are WRONG — a smeared name length shifts a member's data — and that is
    // the point: they are what this function did before ZIP64 was added, and
    // "cost the Apple path nothing" is a claim about ALL of them, not only the
    // ones that look tidy. The digest is over structure and error CODE only, so
    // it does not move with a Node release that rewords a message.
    const answers = [];
    for (let n = 0; n < zip.length; n += 4) {
      const smeared = Buffer.from(zip);
      smeared[n] = 0xff;
      let r;
      try { r = unzip(smeared); } catch (e) { answers.push(`${n}:threw:${e.code}`); continue; }
      if (r === null) { answers.push(`${n}:null`); continue; }
      answers.push(`${n}:${r.map((m) => `${m.name}=${m.bytes === null ? `m${m.unsupportedMethod}` : createHash('sha256').update(m.bytes).digest('hex').slice(0, 16)}`).join(',')}`);
    }
    assert.equal(answers.length, 472);
    assert.equal(
      createHash('sha256').update(answers.join('\n')).digest('hex'),
      '8c5a93e65bd0fab84d88911a54b62f3cfdada2d340c1521fe72640c5240e1959',
      'unzip() answers differently on a corrupted NON-ZIP64 archive than it did before ZIP64 was added',
    );
  });
});

describe('apple-signing — the ExportOptions.plist', () => {
  test('it carries the team, the method and MANUAL signing', () => {
    const plist = exportOptionsPlist({ teamId: TEAM, profiles: [{ bundleId: 'com.nikatru.subscriptiontracker', name: 'Subly App Store' }] });
    assert.match(plist, new RegExp(`<key>teamID</key>\\s*<string>${TEAM}</string>`));
    assert.match(plist, /<string>app-store-connect<\/string>/);
    assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  });

  test('every profile is addressed by BUNDLE ID → NAME, which is what xcodebuild reads', () => {
    const plist = exportOptionsPlist({ teamId: TEAM, profiles: [{ bundleId: 'com.nikatru.subscriptiontracker', name: 'Subly App Store' }] });
    assert.match(plist, /<key>com\.nikatru\.subscriptiontracker<\/key>\s*<string>Subly App Store<\/string>/);
  });

  test('no profiles yields an EMPTY dict, not a malformed one', () => {
    const plist = exportOptionsPlist({ teamId: TEAM, profiles: [] });
    assert.match(plist, /<key>provisioningProfiles<\/key>\s*<dict>\s*<\/dict>/);
  });
});

describe('apple-signing — the signed-export intents', () => {
  const plan = () => signedExportPlan({ appSlug: 'subscriptiontracker', exportOptionsPath: '/tmp/eo.plist', keychain: '/tmp/kc', teamId: TEAM, outDir: '/tmp' });

  test('the iOS intent is `flutter build ipa` against the plist this step wrote', () => {
    const ios = plan().find((s) => s.channel === 'ios-appstore');
    assert.deepEqual(ios.argv, ['flutter', 'build', 'ipa', '--release', '--export-options-plist', '/tmp/eo.plist']);
  });

  // 🔴 THE TWO GAPS CLOSE ON DIFFERENT DAYS AND THIS PINS WHICH ONE IS OPEN.
  // Until 2026-08-20 the register named no installer certificate, so the gap was
  // "not declared" — an ENGINEERING omission, closable in a commit. The
  // macos-appstore row now declares APPLE_INSTALLER_CERT_P12_BASE64 with its
  // reason, so what remains is that the certificate DOES NOT EXIST. CORRECTED
  // 2026-09-08: that is no longer the owner's - the account is ACTIVE and the ASC
  // API issues certificates, so an agent holding the key can close it. Asserting
  // the old sentence would keep a closed gap open in the log; asserting only
  // /OWNER_QUEUE A-4/ would pass on either, which is a pin that cannot tell the
  // change apart - so the pin below names the certificate and the closure date.
  // ⏱ REWRITTEN 2026-09-09. This test used to pin the WORDING of a gap on the
  // .pkg intent, and it had already been rewritten twice as that gap moved
  // (declaration → account → certificate). The gap is now CLOSED: a
  // MAC_INSTALLER_DISTRIBUTION certificate exists, the secret carries it,
  // apple-signing.mjs imports it, and build-platforms.yml runs productbuild. So
  // the pin inverts — it asserts the ABSENCE of a gap, which is the only form
  // that can catch a re-introduction, and a wording test could not.
  test('the macOS .pkg intent is productbuild and carries NO gap — the installer certificate exists', () => {
    const pkg = plan().find((s) => s.argv[0] === 'productbuild');
    assert.ok(pkg, 'the .pkg intent is missing');
    assert.equal(pkg.gap, undefined, 'the installer certificate was issued 2026-09-09; there is no gap left to print');
    assert.equal(pkg.channel, 'macos-appstore');
    assert.match(pkg.produces, /\.pkg$/);
    // The two certificates are still distinct, and the intent must still sign
    // the package with the INSTALLER one — that has not changed and is the
    // mistake this intent exists to prevent.
    assert.ok(pkg.argv.includes('--sign'));
    assert.match(pkg.argv[pkg.argv.indexOf('--sign') + 1], /3rd Party Mac Developer Installer:/);
  });

  test('every intent names the channel it belongs to', () => {
    for (const step of plan()) assert.ok(['ios-appstore', 'macos-appstore'].includes(step.channel));
  });
});

describe('apple-signing — $GITHUB_ENV is line-oriented', () => {
  test('a value carrying a newline is named as an offender', () => {
    assert.deepEqual(newlineOffenders({ A: 'fine', B: 'evil\nPATH=/tmp' }), ['B']);
  });

  test('an ordinary set has no offenders', () => {
    assert.deepEqual(newlineOffenders({ APPLE_TEAM_ID: TEAM }), []);
  });
});

// ═════ the script, end to end ════════════════════════════════════════════════
describe('apple-signing — the endings, run as a process', () => {
  test('no secrets on a NON-release lane is a labelled build proof, and passes', () => {
    const { r, exported } = runPrepare(makeRoot(), {});
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /UNSIGNED-BUILD-PROOF/);
    assert.match(exported, /APPLE_SIGNING_POSTURE=unsigned-build-proof/);
  });

  test('the unsigned ending prints the gap IN CAPITALS and names the owner item', () => {
    const { r } = runPrepare(makeRoot(), {});
    // ⏱ MOVED 2026-09-09, for the third time, and the two negative pins below
    // are the history: the print said ACCOUNT until 2026-09-08, CERTIFICATE
    // until today, and now names the only thing actually left. Each superseded
    // wording stays pinned as `doesNotMatch` so a revert to any of them is a
    // red test rather than a quiet regression in a log nobody reads.
    assert.match(
      out(r),
      /THE MISSING ITEM IS THE APP STORE SCREENSHOTS AND THE OWNER-RUN FIRST SUBMISSION \(THE SIGNING INFRASTRUCTURE NOW EXISTS\)/,
    );
    assert.doesNotMatch(out(r), /THE MISSING ITEM IS THE APPLE DEVELOPER ACCOUNT/, 'the account exists - that print was the defect');
    assert.doesNotMatch(out(r), /THE MISSING ITEM IS THE APPLE DISTRIBUTION CERTIFICATE/, 'issued 2026-09-09 - that print is the newer defect');
    assert.match(out(r), /CANNOT BE UPLOADED TO APP STORE CONNECT/);
  });

  // ── 🔴 THE RESCOPE, AND THE PAIR THAT MAKES IT A RESCOPE AND NOT A DELETION ──
  // A tag push with no secrets PASSES while both Apple rows are `lane: null`,
  // and FAILS the moment either one can actually ship. Before 2026-08-09 the
  // first two of these expected exit 1, and the consequence was measured: a
  // `subscriptiontracker-v*` tag killed the `apple` job, build-platforms.yml's `release` job
  // `needs:` it, and the first Release this repository would ever publish was
  // skipped — over an enrolment guarding a submission no lane in the tree can
  // even produce an artifact for.
  test('🔴 no secrets on a TAG run with BOTH rows unarmed PRINTS the gap and PASSES', () => {
    const { r, exported } = runPrepare(makeRoot(), ON_TAG);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /RELEASE LANE, NO SIGNING SECRETS — PRINTED IN FULL AND NOT FAILED/);
    assert.match(out(r), /this run IS a release lane — the run is a TAG push/);
    // BOTH rows are named. One identity signs both, so a print that mentioned
    // only one would leave a reader unable to check the other.
    assert.match(out(r), /channel "ios-appstore" is NOT ARMED/);
    assert.match(out(r), /channel "macos-appstore" is NOT ARMED/);
    assert.match(out(r), /`submittable: true` but `lane: null`/);
    assert.match(out(r), /TRIPWIRE, NOT A WAIVER/);
    // The LABEL is asserted, not only the item. ⏱ INVERTED 2026-09-09: this
    // pinned CODE-GATED, on the ground that an agent holding the ASC key could
    // issue the missing certificate. An agent did, on 2026-09-09 — so that item
    // is closed and OWNER_GAP moved on to screenshots and the first submission,
    // which no agent may do. The label has to move with the item, and pinning
    // both directions is what stops it drifting back on either.
    assert.match(out(r), /THE BLOCKER IS OWNER-GATED: App Store screenshots and the owner-run first submission/);
    assert.doesNotMatch(out(r), /THE BLOCKER IS CODE-GATED/, 'the certificate exists; what is left is the owner’s');
    assert.doesNotMatch(out(r), /An agent CAN close this one/, 'no agent may create an app record or submit');
    for (const n of WANTED) assert.match(out(r), new RegExp(n));
    assert.match(exported, /APPLE_SIGNING_POSTURE=unsigned-build-proof/);
  });

  test('no secrets on the DECLARED submission workflow, both rows unarmed, prints and passes too', () => {
    const { r } = runPrepare(makeRoot(), ON_SUBMISSION_WF);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /declared Apple submission workflow/);
    assert.match(out(r), /RELEASE LANE, NO SIGNING SECRETS/);
  });

  test('🔴 no secrets on a TAG run FAILS when a row is ARMED, and names every secret to create', () => {
    const { r } = runPrepare(makeRoot({ served: true }), ON_TAG);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /this is a RELEASE lane and no Apple signing secrets are configured/);
    assert.match(out(r), /IS ARMED/);
    assert.match(out(r), /`served: true`/);
    for (const n of WANTED) assert.match(out(r), new RegExp(n));
  });

  test('🔴 ONE armed row is enough — one identity signs both, so a partial answer is not on offer', () => {
    const { r } = runPrepare(
      makeRoot({
        rowOverrides: {
          'macos-appstore': {
            submittable: true,
            served: false,
            lane: { workflow: '.github/workflows/build-platforms.yml', job: 'apple' },
          },
        },
      }),
      ON_TAG,
    );
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /channel "macos-appstore" IS ARMED/);
    assert.match(out(r), /build-platforms\.yml · job "apple"/);
    // The unarmed sibling is NOT reported as armed — the split has to be real.
    assert.doesNotMatch(out(r), /channel "ios-appstore" IS ARMED/);
  });

  test('🔴 the rescope is RELEASE-LANE-ONLY: a branch push prints not one word of it', () => {
    const { r } = runPrepare(makeRoot(), {});
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /RELEASE LANE, NO SIGNING SECRETS/);
    assert.doesNotMatch(out(r), /TRIPWIRE/);
    assert.doesNotMatch(out(r), /NOT ARMED/);
  });

  test('HALF the secrets FAIL on EVERY lane, release or not', () => {
    const partial = { ...FULL() };
    delete partial[ROLE_ENV.p12Password];
    for (const lane of [{}, ON_TAG]) {
      const { r } = runPrepare(makeRoot(), { ...partial, [ROLE_ENV.p12Password]: '', ...lane });
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /HALF configured/);
      assert.match(out(r), new RegExp(`missing:\\s+${ROLE_ENV.p12Password}`));
    }
  });

  test('🔴 THE TEAM ID ALONE, ON A BRANCH PUSH: the build proof PASSES and says the name was ignored', () => {
    // The end-to-end form of run 34094776599's failure. Everything else absent,
    // no tag, no submission workflow — exactly the six-platform proof's state
    // after an APPLE_TEAM_ID secret was created for the store-metadata work.
    const { r } = runPrepare(makeRoot(), { [ROLE_ENV.teamId]: 'ABCDE12345' });
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /HALF configured/);
    assert.match(out(r), /SIGNING POSTURE: UNSIGNED-BUILD-PROOF/);
    assert.match(out(r), new RegExp(`SUPPLIED AND DELIBERATELY UNUSED ON THIS LANE: ${ROLE_ENV.teamId}`));
    // …and the run must not claim the secret is absent, which it plainly is not.
    assert.doesNotMatch(out(r), /NO APPLE SIGNING SECRETS ARE SET/);
  });

  test('🔴 THE TEAM ID ALONE, ON A TAG: still HALF configured, still exit 1', () => {
    const { r } = runPrepare(makeRoot(), { [ROLE_ENV.teamId]: 'ABCDE12345', ...ON_TAG });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /HALF configured/);
    assert.match(out(r), new RegExp(`supplied:\\s+${ROLE_ENV.teamId}`));
  });

  test('the platform gate is honest about which side of it this box is on', () => {
    const { r } = runPrepare(makeRoot(), FULL());
    if (process.platform === 'darwin') {
      // On a Mac the run proceeds past validation into `security`; what must NOT
      // happen is the non-macOS refusal.
      assert.doesNotMatch(out(r), /not macOS/);
    } else {
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), new RegExp(`"${process.platform}", not macOS`));
      assert.match(out(r), /COVERAGE/);
    }
  });

  test('nothing is written to disk by a run that fails the platform gate', () => {
    const { r, outDir } = runPrepare(makeRoot(), FULL());
    if (process.platform !== 'darwin') {
      assert.equal(r.status, 1, out(r));
      assert.ok(!existsSync(join(outDir, 'subscriptiontracker-distribution.p12')), 'key material was left on disk by a run that failed');
    } else {
      assert.ok(true, 'on macOS this run proceeds; the half-state rule is asserted by the validation tests below');
    }
  });

  // ── 🔴 THE RECORDED FAILING CASE, 2026-09-09 ───────────────────────────────
  // This cost two full CI runs. The .p12 was exported on Windows with a
  // passphrase from `openssl rand -base64 24 | tr -d '\n='`; Windows openssl
  // writes CRLF, `tr` took only the LF, and the archive was encrypted with a
  // passphrase ending in a CARRIAGE RETURN. Every local `openssl pkcs12 -in`
  // passed — it was handed the same stray byte. The script's own `.trim()` then
  // removed it, and macOS said "the passphrase you entered is not correct",
  // which is true and points nowhere. Refusing the difference is the fix; these
  // pin that it is refused rather than silently absorbed.
  test('a p12 password with a trailing CR is REFUSED, not quietly trimmed', () => {
    const full = FULL();
    const { r } = runPrepare(makeRoot(), { ...full, [ROLE_ENV.p12Password]: `${full[ROLE_ENV.p12Password]}\r` });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /carries leading or trailing whitespace, and it is being REFUSED rather than trimmed/);
    // The DIAGNOSIS is the whole value of this failure over the macOS one.
    assert.match(out(r), /openssl rand` writes CRLF/);
    // ⏱ TIGHTENED 2026-09-09 after CodeQL flagged the first version as
    // `js/clear-text-logging` (high). That version printed the raw and trimmed
    // LENGTHS. A length is not the secret — but the alert is right in spirit,
    // and the message now draws only from a fixed allowlist of literals, so
    // NOTHING derived from the password can reach a log through this path.
    assert.match(out(r), /Found: a trailing carriage return/);
    assert.doesNotMatch(out(r), /character\(s\)/, 'not even a length is derived from the secret any more');
    assert.ok(!out(r).includes(full[ROLE_ENV.p12Password]), 'the passphrase itself must not be printed');
  });

  test('the same refusal covers a trailing newline and leading space, not just CR', () => {
    const full = FULL();
    for (const pad of ['\n', ' ', '\t', '\r\n']) {
      const { r } = runPrepare(makeRoot(), { ...full, [ROLE_ENV.p12Password]: `${full[ROLE_ENV.p12Password]}${pad}` });
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /REFUSED rather than trimmed/);
    }
    const { r: lead } = runPrepare(makeRoot(), { ...full, [ROLE_ENV.p12Password]: ` ${full[ROLE_ENV.p12Password]}` });
    assert.equal(lead.status, 1, out(lead));
  });

  test('GREEN CONTROL — a clean password gets past this check', () => {
    // Without this the refusal above is consistent with a check that fires on
    // every password, which would fail the lane it exists to protect.
    const { r } = runPrepare(makeRoot(), FULL());
    assert.doesNotMatch(out(r), /REFUSED rather than trimmed/);
  });

  test('the secret values never appear anywhere in the output', () => {
    const full = FULL();
    const { r } = runPrepare(makeRoot(), full);
    const text = out(r);
    assert.doesNotMatch(text, /fixture-passphrase/);
    assert.ok(!text.includes(full[ROLE_ENV.p12].slice(0, 40)), 'a fragment of the .p12 base64 was printed');
  });
});

describe('apple-signing — a secret that is not what it claims to be', () => {
  test('FAILS when the .p12 base64 does not round-trip', () => {
    const { r } = runPrepare(makeRoot(), { ...FULL(), [ROLE_ENV.p12]: 'this is not base64 !!!' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not valid base64/);
  });

  test('FAILS on valid base64 of something that is not a PKCS#12', () => {
    const { r } = runPrepare(makeRoot(), {
      ...FULL(),
      [ROLE_ENV.p12]: Buffer.from('<html><body>404</body></html>').toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /are not a PKCS#12/);
  });

  test('FAILS on a malformed team identifier before touching any key material', () => {
    const { r, outDir } = runPrepare(makeRoot(), { ...FULL(), [ROLE_ENV.teamId]: 'nope' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /10-character Apple team identifier/);
    assert.ok(!existsSync(join(outDir, 'subscriptiontracker-distribution.p12')));
  });

  test('FAILS when a profile belongs to a DIFFERENT team than APPLE_TEAM_ID', () => {
    const { r } = runPrepare(makeRoot(), {
      ...FULL(),
      [ROLE_ENV.profiles]: fakeProfile({ team: OTHER_TEAM }).toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /belonging to a different team/);
  });

  test('FAILS on an EXPIRED provisioning profile, with the date in the message', () => {
    const { r } = runPrepare(makeRoot(), {
      ...FULL(),
      [ROLE_ENV.profiles]: fakeProfile({ expires: '2020-01-01T00:00:00Z' }).toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /EXPIRED provisioning profile/);
    assert.match(out(r), /2020-01-01/);
  });

  test('FAILS when the profiles blob is not a profile or an archive', () => {
    const { r } = runPrepare(makeRoot(), {
      ...FULL(),
      [ROLE_ENV.profiles]: Buffer.from('just some text').toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /cannot read as profiles/);
  });

  test('a value carrying a newline is refused and no key material is written', () => {
    const { r, outDir } = runPrepare(makeRoot(), { ...FULL(), [ROLE_ENV.teamId]: `${TEAM}\nPATH=/evil` });
    assert.equal(r.status, 1, out(r));
    assert.ok(!existsSync(join(outDir, 'subscriptiontracker-distribution.p12')));
  });
});

describe('apple-signing — coverage self-checks', () => {
  test('COVERAGE LOST when the register is gone — the decision would default to "proof is fine"', () => {
    const { r } = runPrepare(makeRoot({ register: false }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the ios-appstore row is gone', () => {
    const { r } = runPrepare(makeRoot({ channelIds: ['macos-appstore'] }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declares no "ios-appstore" channel/);
  });

  test('COVERAGE LOST when the macos-appstore row is gone', () => {
    const { r } = runPrepare(makeRoot({ channelIds: ['ios-appstore'] }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declares no "macos-appstore" channel/);
  });

  test('COVERAGE LOST when a row declares NO ciSecrets — the register is the authority', () => {
    const root = makeRoot();
    const reg = JSON.parse(readFileSync(join(root, 'tooling', 'channel-register.json'), 'utf8'));
    delete reg.channels[0].signing.ciSecrets;
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify(reg));
    const { r } = runPrepare(root, {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declares no `signing\.ciSecrets\.names`/);
  });

  test('COVERAGE LOST when the register RENAMES a secret and this script is not taught', () => {
    // The drift case. A script carrying only its own copy of the list would go on
    // reading the four names it knows and report a complete set forever.
    const renamed = WANTED.map((n) => (n === 'APPLE_TEAM_ID' ? 'APPLE_TEAM_IDENTIFIER' : n));
    const { r } = runPrepare(makeRoot({ names: renamed }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /disagree about which secrets sign an Apple build/);
    assert.match(out(r), /APPLE_TEAM_IDENTIFIER/);
  });

  test('COVERAGE LOST when the register declares an EXTRA signing secret nobody here handles', () => {
    // 🔴 THIS TEST USED TO USE APPLE_INSTALLER_CERT_P12_BASE64 AS ITS "UNKNOWN"
    // NAME, AND THAT IS PRECISELY WHY IT COULD NOT SEE THE RED. 2d2f51b added
    // that exact name to the real macos-appstore row on 2026-08-20; this file
    // went on asserting the name was unknown, agreed with the script, and
    // stayed green while `node tooling/ci/apple-signing.mjs --app subscriptiontracker` EXITED
    // 1 in CI. The example is now a name THE REGISTER DECLARES NOWHERE — measured
    // 2026-08-21, `grep -rn APPLE_NOTARY_PASSWORD_BASE64` over the worktree
    // (excluding .git/.bundles/node_modules) returns 6 hits and every one is in
    // THIS FILE, as fixture text; tooling/channel-register.json and
    // .github/workflows/ have none. So it cannot repeat the 2d2f51b trap.
    // (An earlier draft of this line said "exists nowhere in the tree", which
    // its own file falsifies. The distinction is the whole point of the case:
    // what must be absent is a REGISTER DECLARATION, not the string.)
    // The installer certificate has its own two cases below.
    const { r } = runPrepare(makeRoot({ names: [...WANTED, 'APPLE_NOTARY_PASSWORD_BASE64'] }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /APPLE_NOTARY_PASSWORD_BASE64/);
  });

  test('🔴 the installer certificate on macos-appstore is ACCEPTED — the case that was red on 2026-08-21', () => {
    // The positive control for the whole row-scoping change. Without it every
    // negative result here is consistent with a script that refuses the name
    // everywhere, which is the state this increment repaired. The fixture is
    // asserted to actually CARRY the name first — a default that quietly went
    // back to four names would make this pass while proving nothing.
    const root = makeRoot();
    const reg = JSON.parse(readFileSync(join(root, 'tooling', 'channel-register.json'), 'utf8'));
    const mac = reg.channels.find((c) => c.id === 'macos-appstore');
    assert.ok(mac.signing.ciSecrets.names.includes(ROLE_ENV.installerP12), 'the fixture must declare the name it is testing');
    const { r } = runPrepare(root, {});
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /COVERAGE LOST/);
    assert.match(out(r), /UNSIGNED-BUILD-PROOF/);
  });

  test('COVERAGE LOST when the installer certificate is copied onto the ios-appstore row', () => {
    // The register's own `why` says it in capitals: macOS ONLY, do not copy it
    // onto ios-appstore, because an .ipa needs no installer certificate and the
    // iOS lane could never use one. Row scoping that accepted the name anywhere
    // would be four names checked twice again, under a new spelling.
    const { r } = runPrepare(
      makeRoot({ namesFor: { 'ios-appstore': [...WANTED, ROLE_ENV.installerP12] } }),
      {},
    );
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /ios-appstore row and this script disagree/);
    assert.match(out(r), /IS known here — but only on the macos-appstore row/);
  });

  test('COVERAGE LOST when the macos-appstore row DROPS the installer certificate', () => {
    // The other direction, and the one that makes this a bidirectional check
    // rather than a permissive one: the register silently losing the name must
    // be as loud as the register gaining one.
    const { r } = runPrepare(makeRoot({ namesFor: { 'macos-appstore': [...WANTED] } }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /macos-appstore row and this script disagree/);
    assert.match(out(r), /expected here and not declared in the register: APPLE_INSTALLER_CERT_P12_BASE64/);
  });

  test('COVERAGE LOST when apps.json is missing', () => {
    const { r } = runPrepare(makeRoot({ apps: null }), {});
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an unknown --app fails and lists the apps it knows', () => {
    const { r } = runPrepare(makeRoot(), {}, { app: 'notanapp' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /Known: subscriptiontracker/);
  });

  test('an EMPTY $GITHUB_ENV is treated as unset, not as a file named ""', () => {
    const blank = Object.fromEntries(WANTED.map((n) => [n, '']));
    const r = spawnSync(process.execPath, [PREPARE, '--app', 'subscriptiontracker', '--repo-root', makeRoot()], {
      encoding: 'utf8',
      env: { ...process.env, ...blank, GITHUB_ENV: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '' },
    });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NOT EXPORTED/);
    assert.doesNotMatch(out(r), /ENOENT/);
  });
});

// ═════ the real register — the anti-drift check ══════════════════════════════
describe('apple-signing — against the REAL tooling/channel-register.json', () => {
  const realRows = () => {
    const p = join(REPO_ROOT, 'tooling', 'channel-register.json');
    assert.ok(existsSync(p), `${p} does not exist — this seam reads it and cannot be checked against it`);
    const reg = JSON.parse(readFileSync(p, 'utf8'));
    return ['ios-appstore', 'macos-appstore'].map((id) => {
      const row = reg.channels.find((c) => c.id === id);
      assert.ok(row, `the register declares no ${id} row`);
      return row;
    });
  };

  // 🔴 THE CHECK THIS FILE DID NOT HAVE ON 2026-08-21, AND ITS ABSENCE IS WHY
  // A RED RELEASE LANE WAS INVISIBLE FOR A DAY. Everything else in this describe
  // block reads the real register for ARMING — `served` / `submittable` / `lane`
  // — which is a different question from the one the runtime script fails on.
  // apple-signing.mjs compares its role map to `signing.ciSecrets.names` on
  // every run, per row, in both directions; nothing here compared the same two
  // sets, so the register could gain or lose a name and this suite stayed green
  // while `node tooling/ci/apple-signing.mjs --app subscriptiontracker` exited 1 in CI.
  // Measured 2026-08-21 before the fix: that command EXIT 1, "COVERAGE LOST …
  // declared in the register and unknown here: APPLE_INSTALLER_CERT_P12_BASE64";
  // this file EXIT 0, 74 `test(` declarations / 78 runner cases, 0 failing.
  // (Both numbers re-measured at HEAD 2026-08-21 in a scratch mirror, because
  // the two DIFFER and an earlier draft of this line wrote the declaration
  // count — the ratchet number, from the comment-stripped `^\s*(test|it)\s*\(`
  // count coverage-manifest.json records — under the word "tests", which is the
  // runner's word for cases. A parameterised loop declares once and runs many.)
  //
  // ⚠️ WHAT THESE TWO TESTS DO NOT DO: they do not run the script, so they
  // cannot see a failure that lives anywhere else in it, and they say nothing
  // about whether a declared secret is ever PASSED to the step (that is
  // assert-channel-register.mjs §8's subject, which prints rather than fails).
  // They pin exactly the two sets that drifted.
  test('🔴 the REAL register and the role map agree in BOTH directions, per row', () => {
    for (const row of realRows()) {
      const declared = row.signing?.ciSecrets?.names;
      assert.ok(
        Array.isArray(declared) && declared.length > 0,
        `${row.id} declares no signing.ciSecrets.names — this comparison would range over nothing and print ok`,
      );
      const d = registerDrift(row.id, declared);
      assert.deepEqual(
        d.extra,
        [],
        `${row.id} declares ${d.extra.join(', ')}, which tooling/ci/apple-signing.mjs does not recognise. ` +
          'Teach ROLE_ENV the name and its role — the script EXITS 1 on this today, and build-platforms.yml ' +
          'runs it with no `if:` guard, so the `apple` job and the `release` job that needs it are both dead.',
      );
      assert.deepEqual(
        d.absent,
        [],
        `${row.id} no longer declares ${d.absent.join(', ')}, which apple-signing.mjs expects of that row ` +
          'and would read from an environment nobody declares.',
      );
    }
  });

  test('🔴 the two rows are ASYMMETRIC, and the register says which name is macOS-only', () => {
    // Pinned separately from the agreement above, because the agreement would
    // also hold if both rows declared five names — and the register's own `why`
    // for APPLE_INSTALLER_CERT_P12_BASE64 forbids exactly that: an .ipa needs no
    // installer certificate, so naming it on ios-appstore would declare a
    // credential that lane can never use.
    const [ios, macos] = realRows();
    const iosNames = ios.signing.ciSecrets.names;
    const macNames = macos.signing.ciSecrets.names;
    assert.ok(!iosNames.includes(ROLE_ENV.installerP12), 'ios-appstore must NOT declare the installer certificate');
    assert.ok(macNames.includes(ROLE_ENV.installerP12), 'macos-appstore must declare the installer certificate');
    assert.deepEqual(
      macNames.filter((n) => !iosNames.includes(n)),
      [...ROW_ONLY_ENV['macos-appstore']],
      'the ONLY difference between the two rows is the row-only set this script scopes',
    );
    assert.deepEqual(iosNames.filter((n) => !macNames.includes(n)), [], 'ios declares nothing macOS does not');
  });

  // ⏱ THE DAY ARRIVED, 2026-09-09. These two tests were written to ANNOUNCE the
  // moment either Apple row became armed — "the day either is not, a tag stops
  // being survivable without the enrolment" — and they did exactly that, on the
  // branch that armed them. They are inverted rather than deleted, because the
  // announcement is only worth making once and the state it announced is now the
  // state worth pinning.
  //
  // 🔴 WHAT MADE THE ARMING SAFE IS NOT THAT THE TEST WAS EDITED. It is that the
  // condition the old test was guarding against no longer holds: the secrets
  // exist. `submittable: true` plus a real lane makes the release lane FATAL
  // without the signing secrets, and that is now the correct behaviour, because
  // a tag push in this repository has them. The tripwire's own instruction was
  // that arming a channel and creating its secrets belong in ONE change; this is
  // that change, and the test moving is the evidence the instruction was read
  // rather than stepped over.
  test('🔴 BOTH Apple rows are NOW ARMED — the enrolment, the certificates and the secrets all exist', () => {
    for (const row of realRows()) {
      const a = armingOf(row);
      assert.equal(a.armed, true, `${row.id} is expected to be armed as of 2026-09-09: ${a.blockers.join(' | ')}`);
    }
  });

  test('what arms them is `submittable` PLUS a real lane on the apple job, and `served` is still false', () => {
    // Worth pinning the parts separately: `served: true` would also arm a row,
    // and it would mean something entirely different — that something publishes
    // from this channel. Nothing does, and no app record exists. The arming came
    // from the lane alone, which is a statement that the artifact is BUILT.
    for (const row of realRows()) {
      const a = armingOf(row);
      assert.equal(a.submittable, true, `${row.id} is expected to be a submittable store row`);
      assert.notEqual(a.lane, null, `${row.id} is expected to name the lane that emits its artifact`);
      assert.equal(a.lane.job, 'apple');
      assert.match(a.lane.workflow, /build-platforms\.yml$/);
      assert.equal(row.served, false, `${row.id} must NOT be served — submitting remains the owner's call`);
      assert.deepEqual(a.blockers, [], `${row.id} still reports a blocker: ${a.blockers.join(' | ')}`);
    }
  });
});
