#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-runtime-signer-check.mjs — the runtime signature check is wired into
// every Android release build, and its expected digests ARE the register's pins.
//
// Register row: O-APPS-GOV-IN-VAPT-CHECKLIST. The apps.gov.in Developer Manual
// §11 says an app without root detection, code obfuscation and a runtime
// signature check "may be rejected". Obfuscation is graded by
// assert-obfuscation-coupled.mjs; this guard grades the other two's wiring.
//
// ── WHY A GUARD AND NOT A TEST ───────────────────────────────────────────────
// The check is three halves in three languages — the expected digests (Dart,
// generated from tooling/channel-register.json), the certificate read (Kotlin,
// PackageManager) and the boot step that blocks a re-signed copy (Dart, in the
// chassis and in every app's main()). Each half has its own unit tests, and
// every one of them stays green when a pin is edited in the register and the
// generated table is not, or when an app's main() stops calling the check: the
// tests exercise the halves, never the joint. A re-signed copy then installs
// and runs, and the store reviewer is the first to find out.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   S1 register  `runtimeSignerCheck.channels` names Android channel rows, each
//                pin path exists on its row and holds null or a colon-separated
//                uppercase SHA-256, `unpinnedReleaseBuild` is allowed|refused —
//                and `refused` on a row whose keyKind is app-signing-key.
//   S2 coverage  every Android channel row carrying ANY non-null signing pin
//                (`signing.*.sha256`) has an entry — a release build for a
//                channel with a pinned fingerprint and no runtime check fails.
//   S3 generated packages/core/lib/src/integrity/signer_pins.g.dart is byte-
//                for-byte what the register renders (`--write` regenerates).
//   S4 refusal   for every `refused` channel with a null pin, a release-signed
//                build is refused by flutter-release-build.mjs
//                (`unpinnedReleaseRefusal`) and a debug-signed one is not.
//   S5 stamp     every such channel's composed release build passes
//                --dart-define=RELEASE_CHANNEL=<id> — the binary selects its
//                pins by that define, so a build that stamps another channel
//                compiles another channel's pins.
//   S6 wiring    the certificate read, the channel, the probe, the gate, the
//                notice host and the boot step exist where WIRING says; every
//                app's main() and the brick's run the check with
//                AppConfig.releaseChannel and the platform probe BEFORE the
//                notification adapter and identity (through bootstrapNikatru,
//                or — for an app that predates it — one helper it imports);
//                and every app.dart mounts RootedDeviceNoticeHost.
//   S7 review    every file the apps-gov-in row's `storeReview.answers` cites as
//                evidence exists.
//
// Exit 0 = green. 1 = a finding. 2 = COVERAGE LOST: the register has no
// `runtimeSignerCheck`, it names no channel, or no app was found to grade.
//
// Usage: node tooling/ci/assert-runtime-signer-check.mjs [--write] [--root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { composeReleaseBuild, signerPinsOf, unpinnedReleaseRefusal, RELEASE_SIGNING_ENV } from './flutter-release-build.mjs';

export const REGISTER = 'tooling/channel-register.json';
const SHA256_COLON = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

/** Each file the check lives in, and what must be in it. `order` lists
 *  patterns that must appear in that order. */
export const WIRING = [
  {
    file: 'packages/core/lib/src/integrity/device_integrity.dart',
    must: [/import 'signer_pins\.g\.dart';/, /kSignerPinsByChannel\[releaseChannel\]/],
    why: 'the comparison reads the GENERATED pins, never a literal',
  },
  {
    file: 'packages/core/lib/nikatru_core.dart',
    must: [/export 'src\/integrity\/device_integrity\.dart';/],
    why: 'the seam is public',
  },
  {
    file: 'packages/platform_storage/android/src/main/kotlin/com/nikatru/platform_storage/DeviceIntegrityHandler.kt',
    must: [/PackageManager\.GET_SIGNING_CERTIFICATES/, /PackageManager\.GET_SIGNATURES/, /MessageDigest\.getInstance\("SHA-256"\)/, /"signingCertificates"/],
    why: 'the certificate is read with GET_SIGNING_CERTIFICATES on API 28+ and GET_SIGNATURES below, and hashed with SHA-256',
  },
  {
    file: 'packages/platform_storage/android/src/main/kotlin/com/nikatru/platform_storage/AgeSignalsPlugin.kt',
    must: [/"nikatru\/device_integrity"/, /DeviceIntegrityHandler\(/],
    why: 'the package\'s one pluginClass registers the handler',
  },
  {
    file: 'packages/platform_storage/lib/src/device_integrity_probe.dart',
    must: [/MethodChannel\(\s*'nikatru\/device_integrity'/, /'signingCertificates'/],
    why: 'the Dart probe calls the same channel and method',
  },
  {
    file: 'packages/chassis_screens/lib/integrity/device_integrity_gate.dart',
    must: [/core\.assessDeviceIntegrity\(/, /checksSigner:\s*isAndroid/],
    order: [/Future<bool> modifiedCopyBlocked\(/, /await checkDeviceIntegrity\(/, /\.blocksDataAccess\) return false;/, /runApp\(const TamperedBuildApp\(\)\)/, /return true;/],
    why: 'the gate runs the check on android, and a blocked copy runs the modified-copy app and nothing else',
  },
  {
    file: 'packages/chassis_screens/lib/shell/app_shell.dart',
    must: [/class RootedDeviceNoticeHost /, /\.takeRootNotice\(\)/],
    why: 'the once-per-session rooted notice exists beside OfflineBannerHost',
  },
  {
    file: 'packages/chassis_screens/lib/shell/bootstrap.dart',
    order: [/if \(await modifiedCopyBlocked\(/, /return;/, /await notifications\.init\(\)/, /await initialiseIdentity\(\)/],
    why: 'the boot step blocks a re-signed copy BEFORE the notification adapter and identity (and so any data) are touched',
  },
];

/** A main() on the chassis bootstrap passes the compiled channel and the probe. */
const BOOTSTRAP_MAIN = [/bootstrapNikatru\(/, /releaseChannel:\s*AppConfig\.releaseChannel/, /integrityProbe:\s*platformDeviceIntegrityProbe\(\)/];
/** A main() that predates it calls ONE app helper first, and returns when it blocks. */
const DIRECT_MAIN_CALL = /if \(await (\w+)\(\w*\)\) return;/;
/** ...and that helper, in a file main() imports, runs the chassis step. */
const DIRECT_HELPER = [/modifiedCopyBlocked\(/, /releaseChannel:\s*AppConfig\.releaseChannel/, /integrityProbe:\s*platformDeviceIntegrityProbe\(\)/];

function inOrder(text, patterns) {
  let from = 0;
  for (const p of patterns) {
    const m = new RegExp(p.source, p.flags.replace('g', '') + 'g');
    m.lastIndex = from;
    const hit = m.exec(text);
    if (hit === null) return p;
    from = hit.index + hit[0].length;
  }
  return null;
}

/** `43:C8:…` → `43C8…`. */
export const bareHex = (sha) => sha.replaceAll(':', '');

/** THE GENERATED FILE, rendered from the register. Deterministic: channels in
 *  the register's order, pins in their declared order, set pins only. */
export function renderSignerPins(register) {
  const channels = register?.runtimeSignerCheck?.channels ?? {};
  const lines = [
    '// GENERATED by `node tooling/ci/assert-runtime-signer-check.mjs --write` from',
    '// tooling/channel-register.json `runtimeSignerCheck`. NEVER HAND-EDIT: the',
    '// guard fails CI when this file and the register disagree.',
    '//',
    '// The expected signing-certificate digests (SHA-256, uppercase hex) each',
    '// Android channel\'s build compiles in. `complete` is true only when EVERY pin',
    '// the channel declares is set; an incomplete set reports and never blocks.',
    "import 'device_integrity.dart' show SignerPins;",
    '',
    '/// The pins by `RELEASE_CHANNEL`.',
    'const Map<String, SignerPins> kSignerPinsByChannel = <String, SignerPins>{',
  ];
  for (const id of Object.keys(channels)) {
    const p = signerPinsOf(register, id);
    const set = p.pins.filter((x) => x.value !== null);
    for (const x of p.pins) lines.push(`  // ${x.path}${x.value === null ? ' — not set' : ''}`);
    // Shaped as `dart format` leaves it, so formatting the file is not a diff.
    const oneLine = `  '${id}': SignerPins(digests: <String>[], complete: ${p.complete}),`;
    if (set.length === 0 && oneLine.length <= 80) {
      lines.push(oneLine);
      continue;
    }
    lines.push(`  '${id}': SignerPins(`);
    if (set.length === 0) {
      lines.push('    digests: <String>[],');
    } else {
      lines.push('    digests: <String>[');
      for (const x of set) lines.push(`      '${bareHex(x.value)}',`);
      lines.push('    ],');
    }
    lines.push(`    complete: ${p.complete},`);
    lines.push('  ),');
  }
  lines.push('};', '');
  return lines.join('\n');
}

/** The signing pins an Android row carries, wherever under `signing` they sit. */
function rowPins(row) {
  const out = [];
  for (const [k, v] of Object.entries(row?.signing ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'sha256')) out.push({ path: `signing.${k}.sha256`, value: v.sha256 });
  }
  return out;
}

/** The whole check over the tree at `root`. Pure apart from reading files. */
export function check(root) {
  const problems = [];
  const lost = [];
  const counts = { channels: 0, pinsSet: 0, pinsNull: 0, apps: 0, wired: 0, evidence: 0, refused: 0 };
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    lost.push(`${REGISTER} is unreadable (${e.code ?? e.message}), so there are no pins to grade.`);
    return { problems, lost, counts, register: null };
  }
  const block = register.runtimeSignerCheck;
  const entries = block?.channels && typeof block.channels === 'object' ? Object.keys(block.channels) : [];
  if (entries.length === 0) {
    lost.push(`${REGISTER} has no \`runtimeSignerCheck.channels\`, so no channel's runtime signature check can be graded.`);
    return { problems, lost, counts, register };
  }
  const rows = new Map((register.channels ?? []).map((c) => [c.id, c]));

  // S1 register shape.
  for (const id of entries) {
    counts.channels++;
    const row = rows.get(id);
    const entry = block.channels[id];
    if (row === undefined) {
      problems.push(`S1 runtimeSignerCheck names "${id}", which is not a channel row of ${REGISTER}.`);
      continue;
    }
    if (!(row.platforms ?? []).includes('android')) problems.push(`S1 runtimeSignerCheck names "${id}", whose platforms ${JSON.stringify(row.platforms)} are not android.`);
    if (!['allowed', 'refused'].includes(entry?.unpinnedReleaseBuild)) problems.push(`S1 runtimeSignerCheck.channels.${id}.unpinnedReleaseBuild is ${JSON.stringify(entry?.unpinnedReleaseBuild)}, not "allowed" or "refused".`);
    else if (row.signing?.keyKind === 'app-signing-key' && entry.unpinnedReleaseBuild !== 'refused') {
      problems.push(`S1 runtimeSignerCheck.channels.${id}.unpinnedReleaseBuild is "allowed", and "${id}" signs with an app-signing-key — the key every install is bound to. Its release build must be refused until it is pinned.`);
    }
    if (!Array.isArray(entry?.pins) || entry.pins.length === 0) {
      problems.push(`S1 runtimeSignerCheck.channels.${id}.pins names no pin, so its build could recognise no signer.`);
      continue;
    }
    let pins;
    try {
      pins = signerPinsOf(register, id);
    } catch (e) {
      problems.push(`S1 ${e.message}`);
      continue;
    }
    for (const p of pins.pins) {
      if (p.value === null) counts.pinsNull++;
      else if (typeof p.value === 'string' && SHA256_COLON.test(p.value)) counts.pinsSet++;
      else problems.push(`S1 ${id} ${p.path} is ${JSON.stringify(p.value)}: neither null nor a colon-separated uppercase SHA-256.`);
    }
  }

  // S2 coverage: a pinned Android channel with no runtime check.
  for (const row of rows.values()) {
    if (!(row.platforms ?? []).includes('android')) continue;
    const pinned = rowPins(row).filter((p) => p.value !== null);
    if (pinned.length > 0 && !entries.includes(row.id)) {
      problems.push(`S2 channel "${row.id}" pins ${pinned.map((p) => p.path).join(', ')} and has no runtimeSignerCheck entry: its release build would ship with no runtime signature check.`);
    }
    for (const p of rowPins(row)) {
      if (entries.includes(row.id) && !(block.channels[row.id].pins ?? []).includes(p.path)) {
        problems.push(`S2 channel "${row.id}" carries pin ${p.path}, which its runtimeSignerCheck entry does not list: a genuine install signed by that key would be called a modified copy.`);
      }
    }
  }
  if (problems.length > 0) return { problems, lost, counts, register };

  // S3 generated file.
  const genRel = block.generated;
  if (typeof genRel !== 'string' || genRel === '') {
    problems.push('S3 runtimeSignerCheck.generated names no file.');
  } else {
    let have = null;
    try {
      have = readFileSync(join(root, genRel), 'utf8');
    } catch {
      have = null;
    }
    const want = renderSignerPins(register);
    if (have !== want) {
      problems.push(`S3 ${genRel} ${have === null ? 'does not exist' : 'is not what the register renders'}: the binary would compile in pins the register does not hold. Run \`node tooling/ci/assert-runtime-signer-check.mjs --write\`.`);
    }
  }

  // S4 refusal and S5 stamp.
  const releaseEnv = Object.fromEntries(RELEASE_SIGNING_ENV.map((n) => [n, 'set']));
  const appIds = existsSync(join(root, 'apps')) ? listDir(join(root, 'apps'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, 'apps', d.name, 'app.yaml'))).map((d) => d.name) : [];
  for (const id of entries) {
    const pins = signerPinsOf(register, id);
    if (block.channels[id].unpinnedReleaseBuild === 'refused' && !pins.complete) {
      counts.refused++;
      if (unpinnedReleaseRefusal({ root, channel: id, env: releaseEnv }) === null) problems.push(`S4 a release-signed build of "${id}" is not refused while ${pins.pins.filter((p) => p.value === null).map((p) => p.path).join(', ')} is null.`);
      if (unpinnedReleaseRefusal({ root, channel: id, env: {} }) !== null) problems.push(`S4 a debug-signed build of "${id}" is refused — the NOT-FOR-UPLOAD build proof must still build.`);
    }
    for (const app of appIds) {
      let argv;
      try {
        argv = composeReleaseBuild({ root, app, channel: id, target: 'apk' }).argv;
      } catch (e) {
        problems.push(`S5 the release build of ${app} for "${id}" does not compose: ${e.message}`);
        continue;
      }
      if (!argv.includes(`--dart-define=RELEASE_CHANNEL=${id}`)) problems.push(`S5 the release build of ${app} for "${id}" does not pass --dart-define=RELEASE_CHANNEL=${id}, so it compiles another channel's pins.`);
    }
  }

  // S6 wiring.
  for (const w of WIRING) {
    let text;
    try {
      text = readFileSync(join(root, w.file), 'utf8');
    } catch {
      problems.push(`S6 ${w.file} does not exist — ${w.why}.`);
      continue;
    }
    const missing = (w.must ?? []).filter((p) => !p.test(text));
    const outOfOrder = w.order ? inOrder(text, w.order) : null;
    if (missing.length) problems.push(`S6 ${w.file} lacks ${missing.map((p) => `/${p.source}/`).join(', ')} — ${w.why}.`);
    else if (outOfOrder !== null) problems.push(`S6 ${w.file}: /${outOfOrder.source}/ is missing or out of order — ${w.why}.`);
    else counts.wired++;
  }
  const roots = appIds.map((a) => `apps/${a}`);
  roots.push(BRICK_APP);
  for (const appRoot of roots) {
    const read = (rel) => {
      try {
        return readFileSync(join(root, appRoot, rel), 'utf8');
      } catch {
        return null;
      }
    };
    const main = read('lib/main.dart');
    const shell = read('lib/app.dart');
    if (main === null || shell === null) {
      if (appRoot === BRICK_APP) lost.push(`${BRICK_APP}/lib/main.dart or app.dart is unreadable, so app #2's boot cannot be graded.`);
      else problems.push(`S6 ${appRoot}/lib/main.dart or app.dart does not exist.`);
      continue;
    }
    counts.apps++;
    if (!/RootedDeviceNoticeHost\(/.test(shell)) problems.push(`S6 ${appRoot}/lib/app.dart mounts no RootedDeviceNoticeHost: a rooted device would never see its once-per-session notice.`);
    if (/bootstrapNikatru\(/.test(main)) {
      const miss = inOrder(main, BOOTSTRAP_MAIN);
      if (miss !== null) problems.push(`S6 ${appRoot}/lib/main.dart: /${miss.source}/ is missing or out of order — bootstrapNikatru must get the compiled channel and the platform probe.`);
      continue;
    }
    const call = DIRECT_MAIN_CALL.exec(main);
    const identity = main.search(/initNikatruAuth\(|\.init\(\);/);
    if (call === null || (identity !== -1 && call.index > identity)) {
      problems.push(`S6 ${appRoot}/lib/main.dart neither calls bootstrapNikatru nor runs an \`if (await <check>(…)) return;\` before its notification adapter and identity — a re-signed copy would reach the user's data.`);
      continue;
    }
    const helper = [...main.matchAll(/^import '([^':]+\.dart)'/gm)]
      .map((m) => read(join('lib', m[1])))
      .find((t) => t !== null && new RegExp(`Future<bool> ${call[1]}\\(`).test(t));
    const miss = helper === undefined ? DIRECT_HELPER[0] : inOrder(helper, DIRECT_HELPER);
    if (miss !== null) problems.push(`S6 ${appRoot}: ${call[1]}() is not defined in a file lib/main.dart imports, or lacks /${miss.source}/ — it must run modifiedCopyBlocked with AppConfig.releaseChannel and the platform probe.`);
  }
  if (appIds.length === 0) lost.push('no apps/<app>/app.yaml exists, so no app\'s boot could be graded.');

  // S7 review evidence.
  for (const row of rows.values()) {
    for (const a of row.storeReview?.answers ?? []) {
      for (const f of a.evidence ?? []) {
        counts.evidence++;
        if (!existsSync(join(root, f))) problems.push(`S7 ${row.id} storeReview "${a.item}" cites ${f}, which does not exist — an answer whose evidence moved cannot be shown to the reviewer.`);
      }
    }
  }
  return { problems, lost, counts, register };
}

function main(args) {
  const rootAt = args.indexOf('--root');
  const root = rootAt === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') : resolve(args[rootAt + 1] ?? '');
  if (args.includes('--write')) {
    const register = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
    const rel = register.runtimeSignerCheck?.generated;
    if (typeof rel !== 'string' || rel === '') {
      console.error(`COVERAGE LOST ${REGISTER} names no runtimeSignerCheck.generated file to write.`);
      return 2;
    }
    writeFileSync(join(root, rel), renderSignerPins(register));
    console.log(`wrote ${rel}`);
  }
  const { problems, lost, counts } = check(root);
  if (lost.length) {
    console.error(`COVERAGE LOST runtime signer check — ${lost[0]}`);
    for (const l of lost.slice(1)) console.error(`    ${l}`);
    return 2;
  }
  if (problems.length) {
    console.error(`✗ runtime signer check — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    console.error('  O-APPS-GOV-IN-VAPT-CHECKLIST — apps.gov.in §11: root detection, obfuscation and a runtime signature check.');
    return 1;
  }
  console.log(
    `ok  runtime signer check — ${counts.channels} Android channel(s), ${counts.pinsSet} pin(s) set and ${counts.pinsNull} not yet set ` +
      `(an incomplete set reports, never blocks); ${counts.refused} channel(s) refuse a release-signed build until pinned; ` +
      `the generated pins match the register; ${counts.wired} wiring file(s) and ${counts.apps} main() (apps + the brick) run the check; ` +
      `${counts.evidence} store-review evidence file(s) exist.`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`FAIL ${e.message}`);
    process.exit(1);
  }
}
