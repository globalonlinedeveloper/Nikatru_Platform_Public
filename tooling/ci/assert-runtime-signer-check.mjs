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
// ⏱ 2026-10-03 (ruling on PR #1198; ADR 030 — Play App Signing holds ONE app
// signing key PER APP, while the upload key is factory-wide). A channel entry may
// name `perAppPin`, a field of each app's apps/<id>/app.yaml store record. The
// generated file then has two tables: the channel default (factory pins only,
// never complete while a per-app pin is declared) and kSignerPinsByApp (factory
// pins + the app's own); the binary looks itself up by AppConfig.appId.
//   S8 per app   each app's own pin is a colon-separated uppercase SHA-256 and
//                no other app's; an app ON the store (a `listings` URL or an
//                `issued` record) that records none FAILS — its installs carry a
//                key nothing names.
//   S9 sharing   while `internalAppSharing.pin` is null, no workflow or release
//                script uploads to Play's internal app sharing: those installs
//                carry a third, Google-generated key.
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
import { composeReleaseBuild, signerPinsOf, appPinsAt, unpinnedReleaseRefusal, RELEASE_SIGNING_ENV } from './flutter-release-build.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

export const REGISTER = 'tooling/channel-register.json';
const SHA256_COLON = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

/** Each file the check lives in, and what must be in it. `order` lists
 *  patterns that must appear in that order. */
export const WIRING = [
  {
    file: 'packages/core/lib/src/integrity/device_integrity.dart',
    must: [/import 'signer_pins\.g\.dart';/, /kSignerPinsByApp\[appId\]\?\[releaseChannel\]/, /kSignerPinsByChannel\[releaseChannel\]/],
    why: 'the comparison reads the GENERATED pins, never a literal — the app\'s own set first, then the channel default',
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
    must: [/core\.assessDeviceIntegrity\(/, /appId:\s*appId/, /checksSigner:\s*isAndroid/],
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
    order: [/if \(await modifiedCopyBlocked\(/, /appId:\s*appId/, /return;/, /await notifications\.init\(\)/, /await initialiseIdentity\(\)/],
    why: 'the boot step blocks a re-signed copy BEFORE the notification adapter and identity (and so any data) are touched',
  },
];

/** A main() on the chassis bootstrap passes its app id, the compiled channel
 *  and the probe — the app id selects its own per-app pins. */
const BOOTSTRAP_MAIN = [/bootstrapNikatru\(/, /appId:\s*AppConfig\.appId/, /releaseChannel:\s*AppConfig\.releaseChannel/, /integrityProbe:\s*platformDeviceIntegrityProbe\(\)/];
/** A main() that predates it calls ONE app helper first, and returns when it blocks. */
const DIRECT_MAIN_CALL = /if \(await (\w+)\(\w*\)\) return;/;
/** ...and that helper, in a file main() imports, runs the chassis step. */
const DIRECT_HELPER = [/modifiedCopyBlocked\(/, /appId:\s*AppConfig\.appId/, /releaseChannel:\s*AppConfig\.releaseChannel/, /integrityProbe:\s*platformDeviceIntegrityProbe\(\)/];

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

/** One `'<key>': SignerPins(…),` entry at `indent`, shaped as `dart format`
 *  leaves it, so formatting the file is not a diff. */
function pinsEntry(indent, key, digests, complete) {
  const oneLine = `${indent}'${key}': SignerPins(digests: <String>[], complete: ${complete}),`;
  if (digests.length === 0 && oneLine.length <= 80) return [oneLine];
  const out = [`${indent}'${key}': SignerPins(`];
  if (digests.length === 0) out.push(`${indent}  digests: <String>[],`);
  else out.push(`${indent}  digests: <String>[`, ...digests.map((d) => `${indent}    '${bareHex(d)}',`), `${indent}  ],`);
  out.push(`${indent}  complete: ${complete},`, `${indent}),`);
  return out;
}

/** THE GENERATED FILE, rendered from the register and each app's per-app pin.
 *  Deterministic: channels in the register's order, apps sorted, pins in their
 *  declared order, set pins only.
 *
 *  ⏱ 2026-10-03 (ruling on PR #1198, ADR 030 — Play App Signing holds one key
 *  PER APP). Two tables. `kSignerPinsByChannel` is the CHANNEL DEFAULT: the
 *  factory-wide pins only, never complete while the channel declares a
 *  `perAppPin`, so an app with no row of its own reports and is never blocked.
 *  `kSignerPinsByApp` holds, for each app that records its per-app pin, the
 *  factory-wide pins plus its own. `appPins` is `{ <app>: { <channel>: [sha…] } }`. */
export function renderSignerPins(register, appPins = {}) {
  const channels = register?.runtimeSignerCheck?.channels ?? {};
  const lines = [
    '// GENERATED by `node tooling/ci/assert-runtime-signer-check.mjs --write` from',
    '// tooling/channel-register.json `runtimeSignerCheck` and each app\'s per-app pin',
    '// in apps/<id>/app.yaml. NEVER HAND-EDIT: the guard fails CI when this file and',
    '// those sources disagree.',
    '//',
    '// The expected signing-certificate digests (SHA-256, uppercase hex) an Android',
    '// build compiles in. `complete` is true only when EVERY pin the set declares is',
    '// set; an incomplete set reports and never blocks. A per-app pin (Play App',
    '// Signing holds one key per app) is never in a channel default.',
    "import 'device_integrity.dart' show SignerPins;",
    '',
    '/// The CHANNEL DEFAULT by `RELEASE_CHANNEL`: the factory-wide pins, for an app',
    '/// with no row of its own in [kSignerPinsByApp].',
    'const Map<String, SignerPins> kSignerPinsByChannel = <String, SignerPins>{',
  ];
  for (const id of Object.keys(channels)) {
    const p = signerPinsOf(register, id);
    for (const x of p.pins) lines.push(`  // ${x.path}${x.value === null ? ' — not set' : ''}`);
    if (p.perAppPin !== null) lines.push(`  // per app: ${p.perAppPin} — kSignerPinsByApp`);
    lines.push(...pinsEntry('  ', id, p.pins.filter((x) => x.value !== null).map((x) => x.value), p.complete));
  }
  lines.push('};', '');
  lines.push(
    '/// The pins by app id, then `RELEASE_CHANNEL`: the factory-wide pins plus the',
    '/// app\'s own, for each app whose apps/<id>/app.yaml records its per-app pin.',
  );
  const apps = Object.keys(appPins)
    .filter((a) => Object.values(appPins[a] ?? {}).some((v) => Array.isArray(v) && v.length > 0))
    .sort();
  if (apps.length === 0) {
    lines.push('const Map<String, Map<String, SignerPins>> kSignerPinsByApp =', '    <String, Map<String, SignerPins>>{};', '');
    return lines.join('\n');
  }
  // Shaped as `dart format` leaves a non-empty map here (measured 3.47.5).
  lines.push('const Map<String, Map<String, SignerPins>>', 'kSignerPinsByApp = <String, Map<String, SignerPins>>{');
  for (const app of apps) {
    lines.push(`  '${app}': <String, SignerPins>{`);
    for (const id of Object.keys(channels)) {
      const own = appPins[app]?.[id];
      if (!Array.isArray(own) || own.length === 0) continue;
      const p = signerPinsOf(register, id, own);
      lines.push(`    // apps/${app}/app.yaml ${p.perAppPin}`);
      const digests = [...p.pins.filter((x) => x.value !== null).map((x) => x.value), ...own];
      lines.push(...pinsEntry('    ', id, digests, p.complete));
    }
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}

/** Each app's per-app pins, `{ <app>: { <channel>: [sha…] | null } }`, for every
 *  channel whose entry names a `perAppPin`. An unreadable app.yaml is a
 *  `problems` entry, never a silent "no pin". */
export function readAppPins(root, register, appIds) {
  const channels = register?.runtimeSignerCheck?.channels ?? {};
  const appPins = {};
  const problems = [];
  for (const app of appIds) {
    appPins[app] = {};
    for (const [id, entry] of Object.entries(channels)) {
      if (typeof entry?.perAppPin !== 'string' || entry.perAppPin === '') continue;
      try {
        appPins[app][id] = appPinsAt(root, app, entry.perAppPin);
      } catch (e) {
        problems.push(`S8 apps/${app}/app.yaml cannot be read for ${entry.perAppPin} (${e.message}).`);
      }
    }
  }
  return { appPins, problems };
}

/** The app ids with an apps/<id>/app.yaml, sorted. */
function appIdsAt(root) {
  if (!existsSync(join(root, 'apps'))) return [];
  return listDir(join(root, 'apps'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'apps', d.name, 'app.yaml')))
    .map((d) => d.name)
    .sort();
}

/** Whether apps/<app>/app.yaml says the app is ON the store a channel row
 *  names: a real listing under `listings.<storefrontKey>`, or an `issued`
 *  `stores.<channel>` record. Either means real installs exist, signed by a key
 *  that must be pinned. */
function hasStorePresence(root, app, row) {
  const decl = parseYaml(readFileSync(join(root, 'apps', app, 'app.yaml'), 'utf8'));
  const key = row?.storefrontKey;
  const listing = typeof key === 'string' ? decl?.listings?.[key] : null;
  if (typeof listing === 'string' && listing.trim() !== '') return `listings.${key} is ${JSON.stringify(listing)}`;
  if (decl?.stores?.[row.id]?.state === 'issued') return `stores.${row.id}.state is issued`;
  return null;
}

/** The release paths S9 reads for an upload to Play's internal app sharing. */
const INTERNAL_SHARING_DIRS = ['.github/workflows', 'tooling/release', 'tooling/store'];
const INTERNAL_SHARING = /internalappsharing|internal[_-]app[_-]sharing/i;
/** How deep S9 descends below each of those directories. */
const INTERNAL_SHARING_DEPTH = 4;

/** The files under `dir` (root-relative, `/`-separated), at most
 *  INTERNAL_SHARING_DEPTH directories down; none when `dir` is absent. */
function filesUnder(root, dir, depth = 0) {
  const abs = join(root, dir);
  if (!existsSync(abs) || depth > INTERNAL_SHARING_DEPTH) return [];
  const out = [];
  for (const d of listDir(abs, { withFileTypes: true })) {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) out.push(...filesUnder(root, rel, depth + 1));
    else if (d.isFile()) out.push(rel);
  }
  return out;
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
  const counts = { channels: 0, pinsSet: 0, pinsNull: 0, appPins: 0, apps: 0, wired: 0, evidence: 0, refused: 0 };
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
    if (pins.perAppPin !== null) {
      if (!pins.perAppPin.startsWith(`stores.${id}.`)) problems.push(`S1 runtimeSignerCheck.channels.${id}.perAppPin is "${pins.perAppPin}", not a field of the app's stores.${id} record — the store record is where a per-app id lives.`);
      const ias = entry.internalAppSharing;
      if (ias === null || typeof ias !== 'object' || !Object.hasOwn(ias, 'pin') || !(ias.pin === null || (typeof ias.pin === 'string' && ias.pin !== ''))) {
        problems.push(`S1 runtimeSignerCheck.channels.${id} names a perAppPin and no internalAppSharing { pin: null | <path> }: an internal-app-sharing install carries a third, Google-generated key, and nothing would say whether a release path relies on it.`);
      }
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

  // S8 per-app pins (⏱ 2026-10-03, ADR 030: one app signing key PER APP). Each
  // app's own pin is well-formed and its own; an app ON the store with none
  // recorded fails — its genuine installs carry a key nothing names.
  const appIds = appIdsAt(root);
  const read = readAppPins(root, register, appIds);
  problems.push(...read.problems);
  const appPins = read.appPins;
  for (const id of entries) {
    const perAppPin = block.channels[id]?.perAppPin;
    if (typeof perAppPin !== 'string' || perAppPin === '') continue;
    const seen = new Map();
    for (const app of appIds) {
      if (!Object.hasOwn(appPins[app] ?? {}, id)) continue;
      const own = appPins[app][id];
      if (own === null) {
        let presence = null;
        try {
          presence = hasStorePresence(root, app, rows.get(id));
        } catch (e) {
          problems.push(`S8 apps/${app}/app.yaml cannot be read for its ${id} presence (${e.message}).`);
          continue;
        }
        if (presence !== null) {
          problems.push(
            `S8 apps/${app}/app.yaml says the app is on ${id} (${presence}) and records no ${perAppPin}: every genuine install carries this app's own app signing key, which no pin names. ` +
              'Read it (Play Console > App integrity > App signing key certificate, or the Play Developer API generatedApks), record it there, and run `node tooling/ci/assert-runtime-signer-check.mjs --write`.',
          );
        }
        continue;
      }
      for (const fp of own) {
        if (typeof fp !== 'string' || !SHA256_COLON.test(fp)) {
          problems.push(`S8 apps/${app}/app.yaml ${perAppPin} holds ${JSON.stringify(fp)}: not a colon-separated uppercase SHA-256.`);
          continue;
        }
        counts.appPins++;
        if (seen.has(fp)) problems.push(`S8 apps/${app}/app.yaml and apps/${seen.get(fp)}/app.yaml record the same ${perAppPin} ${fp}: Play holds one app signing key PER APP, so one of them is a copy.`);
        else seen.set(fp, app);
      }
    }
  }

  // S9 internal app sharing: a release path that uploads to it while the
  // channel pins no internal-sharing key ships installs no pin recognises.
  for (const id of entries) {
    const ias = block.channels[id]?.internalAppSharing;
    if (ias === undefined || ias === null || ias.pin !== null) continue;
    for (const dir of INTERNAL_SHARING_DIRS) {
      for (const rel of filesUnder(root, dir)) {
        if (!/\.(ya?ml|mjs|js|sh)$/.test(rel)) continue;
        let text;
        try {
          text = readFileSync(join(root, rel), 'utf8');
        } catch {
          continue;
        }
        if (INTERNAL_SHARING.test(text)) {
          problems.push(`S9 ${rel} uploads to Play's internal app sharing, and runtimeSignerCheck.channels.${id}.internalAppSharing.pin is null: those installs carry Google's internal app sharing key, which no pin names, so a release build would call them modified copies. Pin that certificate first.`);
        }
      }
    }
  }

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
    const want = renderSignerPins(register, appPins);
    if (have !== want) {
      problems.push(`S3 ${genRel} ${have === null ? 'does not exist' : 'is not what the register and the apps\' per-app pins render'}: the binary would compile in pins they do not hold. Run \`node tooling/ci/assert-runtime-signer-check.mjs --write\`.`);
    }
  }

  // S4 refusal and S5 stamp.
  const releaseEnv = Object.fromEntries(RELEASE_SIGNING_ENV.map((n) => [n, 'set']));
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
      if (miss !== null) problems.push(`S6 ${appRoot}/lib/main.dart: /${miss.source}/ is missing or out of order — bootstrapNikatru must get AppConfig.appId (its own per-app pins), the compiled channel and the platform probe.`);
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
    if (miss !== null) problems.push(`S6 ${appRoot}: ${call[1]}() is not defined in a file lib/main.dart imports, or lacks /${miss.source}/ — it must run modifiedCopyBlocked with AppConfig.appId, AppConfig.releaseChannel and the platform probe.`);
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
    const read = readAppPins(root, register, appIdsAt(root));
    if (read.problems.length) {
      console.error(`FAIL ${read.problems[0]}`);
      return 1;
    }
    writeFileSync(join(root, rel), renderSignerPins(register, read.appPins));
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
    `ok  runtime signer check — ${counts.channels} Android channel(s), ${counts.pinsSet} pin(s) set and ${counts.pinsNull} not yet set, ${counts.appPins} per-app pin(s) ` +
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
