/// ⏱ 2026-10-01 · DEVICE INTEGRITY — root/jailbreak detection and the runtime
/// signature check (row O-APPS-GOV-IN-VAPT-CHECKLIST).
///
/// 🔴 WHY. The apps.gov.in Developer Manual §11 says an app without root
/// detection, code obfuscation and a runtime signature check "may be rejected".
/// Obfuscation is a build flag (`tooling/ci/flutter-release-build.mjs`); the two
/// checks here are runtime behaviour, so they are a seam in `core` with the
/// platform half in `nikatru_platform_storage` (39-CHASSIS §2: platform
/// capabilities land there), and every stamped app inherits both through
/// `bootstrapNikatru`.
///
/// THE TWO CHECKS HAVE OPPOSITE FAILURE POLICIES, on purpose:
///   · ROOT is a property of the user's own device. A false positive must never
///     cost a paying user their own data, so a rooted verdict WARNS (one notice
///     per session), is RECORDED, and gates only the sensitive actions
///     ([SensitiveAction]) behind a re-authentication. It never blocks.
///   · SIGNER is a property of the artefact. A copy signed by a key that is not
///     one of the channel's pins was re-signed by someone else, and the only
///     honest screen is "install from the official store", with no data access
///     ([DeviceIntegrity.blocksDataAccess]). It BLOCKS — but only when the
///     channel's pins are complete ([SignerPins.complete]) and the build is not
///     a debug build. Anything the check cannot decide is recorded, never
///     blocked.
///
/// The expected digests are NOT read from the device or the network: they are
/// build-time constants in `signer_pins.g.dart`, generated from
/// `tooling/channel-register.json` by
/// `node tooling/ci/assert-runtime-signer-check.mjs --write`, and that guard
/// fails CI when the generated file and the register disagree.
///
/// ⏱ 2026-10-03 (ruling on PR #1198; ADR 030): Play App Signing holds one app
/// signing key PER APP, so that pin is the APP's. [kSignerPinsByChannel] keeps
/// only the factory-wide pins and never blocks for a per-app key it lacks;
/// each app renders its own (`kAppSignerPins` in its lib/core/
/// signer_pins.g.dart, from its app.yaml — shared code names no app) and hands
/// it to every check as `appPins`, which [signerPinsFor] adds to the default.
library;

import 'signer_pins.g.dart';

export 'signer_pins.g.dart' show kSignerPinsByChannel;

/// One reason the platform side believes the device is rooted or jailbroken.
/// The wire names are what `DeviceIntegrityHandler.kt` and the iOS plugin
/// answer with; an unknown name is ignored rather than trusted.
enum RootSignal {
  /// An `su` binary on one of the usual paths (android).
  suBinary('su_binary'),

  /// The OS build is signed with the AOSP test keys (android `Build.TAGS`).
  testKeys('test_keys'),

  /// A Magisk (or similar root manager) path or package exists (android).
  magiskPath('magisk_path'),

  /// `/system` is mounted read-write (android).
  writableSystem('writable_system'),

  /// A jailbreak artefact exists — Cydia, Sileo, apt, sshd (ios).
  jailbreakArtifact('jailbreak_artifact'),

  /// The app could write outside its own sandbox (ios).
  sandboxEscape('sandbox_escape');

  const RootSignal(this.wire);

  /// The name the native side answers with.
  final String wire;

  /// The signal [wire] names, or null for a name this build does not know.
  static RootSignal? named(String wire) {
    for (final RootSignal s in values) {
      if (s.wire == wire) return s;
    }
    return null;
  }
}

/// The signing certificates the running package reports.
final class SigningCertificates {
  const SigningCertificates({
    required this.sha256,
    this.multipleSigners = false,
  });

  /// SHA-256 of each certificate, in any of the spellings
  /// [normalizeCertificateDigest] accepts. With [multipleSigners] false this is
  /// the signing LINEAGE (rotation history, original first); with it true it is
  /// every signer of the package.
  final List<String> sha256;

  /// Whether the package is signed by more than one signer at once (android
  /// `SigningInfo.hasMultipleSigners`). Then EVERY signer must be pinned —
  /// one foreign signer is a foreign signature.
  final bool multipleSigners;
}

/// THE SEAM. The platform implementation is `MethodChannelDeviceIntegrityProbe`
/// in `nikatru_platform_storage`; tests use [FixedDeviceIntegrityProbe].
abstract interface class DeviceIntegrityProbe {
  /// The root/jailbreak signals present on this device. Empty is clean.
  Future<Set<RootSignal>> rootSignals();

  /// The running package's signing certificates.
  Future<SigningCertificates> signingCertificates();
}

/// A probe that answers what it was given — or throws, when told to. The fake
/// every detector test and every widget test drives.
final class FixedDeviceIntegrityProbe implements DeviceIntegrityProbe {
  const FixedDeviceIntegrityProbe({
    this.signals = const <RootSignal>{},
    this.certificates = const SigningCertificates(sha256: <String>[]),
    this.rootThrows = false,
    this.signerThrows = false,
  });

  final Set<RootSignal> signals;
  final SigningCertificates certificates;
  final bool rootThrows;
  final bool signerThrows;

  @override
  Future<Set<RootSignal>> rootSignals() async {
    if (rootThrows) throw StateError('root probe failed');
    return signals;
  }

  @override
  Future<SigningCertificates> signingCertificates() async {
    if (signerThrows) throw StateError('signer probe failed');
    return certificates;
  }
}

/// What the root check concluded.
enum RootStatus {
  /// No signal found.
  clean,

  /// At least one signal found. Warn, record, re-auth sensitive actions.
  rooted,

  /// The probe failed. Treated as [clean] for every decision — an unreadable
  /// device is never punished — and recorded as itself.
  unknown,
}

/// The root check's verdict and the signals behind it.
final class RootReport {
  const RootReport(this.status, [this.signals = const <RootSignal>{}]);

  final RootStatus status;
  final Set<RootSignal> signals;
}

/// Runs the root check. Never throws: a failed probe is [RootStatus.unknown].
Future<RootReport> detectRoot(DeviceIntegrityProbe probe) async {
  final Set<RootSignal> signals;
  try {
    signals = await probe.rootSignals();
  } on Object {
    return const RootReport(RootStatus.unknown);
  }
  if (signals.isEmpty) return const RootReport(RootStatus.clean);
  return RootReport(RootStatus.rooted, Set<RootSignal>.unmodifiable(signals));
}

/// [raw] as 64 uppercase hex digits — the spelling `keytool` prints with its
/// colons removed — or null when it is not a SHA-256 digest at all.
String? normalizeCertificateDigest(String raw) {
  final String hex = raw.replaceAll(RegExp(r'[\s:]'), '').toUpperCase();
  return RegExp(r'^[0-9A-F]{64}$').hasMatch(hex) ? hex : null;
}

/// The expected signer digests one channel's build compiles in.
final class SignerPins {
  const SignerPins({
    required this.digests,
    required this.complete,
    this.appPinCompletes,
  });

  /// Normalised SHA-256 digests ([normalizeCertificateDigest]).
  final List<String> digests;

  /// Whether EVERY pin the channel declares is set. Only a complete set may
  /// block: a missing pin is a key the check cannot recognise yet, and a
  /// recognisable install it would flag is a paying user locked out.
  final bool complete;

  /// ⏱ 2026-10-03: null for a channel that takes no per-app pin; otherwise
  /// whether the APP's own pin (one app signing key per app, ADR 030), added to
  /// these factory-wide digests, makes the set complete.
  final bool? appPinCompletes;
}

/// How a check finds a channel's pins: [signerPinsFor] in every build; a test
/// passes a complete set through it, because no channel's real set is
/// complete yet. ⏱ 2026-10-03: an app's own android-play set is complete once
/// its app.yaml records its Play app signing pin; a test passes any set through
/// this seam, complete or not.
typedef SignerPinsLookup = SignerPins? Function(String releaseChannel);

/// The pins compiled in for [releaseChannel] (`RELEASE_CHANNEL`), or null for
/// a channel the generated table has no row for — a channel no signer check
/// applies to (web, desktop, a build with no channel stamped).
///
/// ⏱ 2026-10-03: [appPins] is the app's OWN pins by channel (its
/// `kAppSignerPins`). On a channel that takes one ([SignerPins.appPinCompletes]
/// not null) they are added to the factory-wide default, and complete it when
/// the default says so; without them the default is incomplete and never
/// blocks — so no app is locked out for lacking another app's key.
SignerPins? signerPinsFor(
  String releaseChannel, {
  Map<String, List<String>> appPins = const <String, List<String>>{},
}) {
  final SignerPins? channel = kSignerPinsByChannel[releaseChannel];
  final List<String> own = appPins[releaseChannel] ?? const <String>[];
  if (channel == null || channel.appPinCompletes == null || own.isEmpty) {
    return channel;
  }
  return SignerPins(
    digests: <String>[...channel.digests, ...own],
    complete: channel.appPinCompletes!,
  );
}

/// What the runtime signature check concluded.
enum SignerVerdict {
  /// The package is signed by a pinned key.
  verified,

  /// The pins are complete and the package is NOT signed by any of them: this
  /// copy was re-signed. The one verdict that blocks.
  mismatch,

  /// Not signed by a pinned key, but the channel's pins are incomplete, so the
  /// mismatch is recorded and nothing is blocked.
  mismatchReported,

  /// A debug build. Exempt by construction — in debug ONLY; a profile or
  /// release build is always checked.
  exemptDebug,

  /// No check applies: not android, or a channel with no pins row.
  notChecked,

  /// The probe failed or reported no certificate. Recorded, never blocked.
  unreadable,
}

/// THE COMPARISON. Pure: the certificates the device reported, the pins this
/// build compiled in, and whether this is a debug build.
SignerVerdict compareSigner({
  required SigningCertificates actual,
  required SignerPins pins,
  required bool isDebugBuild,
}) {
  if (isDebugBuild) return SignerVerdict.exemptDebug;
  final List<String?> seen = actual.sha256
      .map(normalizeCertificateDigest)
      .toList(growable: false);
  if (seen.isEmpty || seen.any((String? d) => d == null)) {
    return SignerVerdict.unreadable;
  }
  final Set<String> pinned = pins.digests.toSet();
  final bool matches = actual.multipleSigners
      ? seen.every(pinned.contains)
      : seen.any(pinned.contains);
  if (matches) return SignerVerdict.verified;
  return pins.complete
      ? SignerVerdict.mismatch
      : SignerVerdict.mismatchReported;
}

/// An action a rooted device must re-authenticate before.
enum SensitiveAction {
  /// Exporting the user's data to a file.
  exportData,

  /// Deleting the account.
  deleteAccount,
}

/// Both verdicts, decided once at startup.
final class DeviceIntegrity {
  const DeviceIntegrity({required this.root, required this.signer});

  /// Nothing checked — the value tests and non-checking hosts carry.
  static const DeviceIntegrity unchecked = DeviceIntegrity(
    root: RootReport(RootStatus.unknown),
    signer: SignerVerdict.notChecked,
  );

  final RootReport root;
  final SignerVerdict signer;

  /// Whether this copy must show the "modified copy" screen and nothing else.
  bool get blocksDataAccess => signer == SignerVerdict.mismatch;

  /// Whether the root check found a signal.
  bool get rooted => root.status == RootStatus.rooted;

  /// Whether [action] needs a fresh re-authentication first. Only a rooted
  /// device does; a clean or unreadable one never does.
  bool requiresReauthFor(SensitiveAction action) => rooted;

  /// Whether the signer verdict is one the crash sink should receive as an
  /// event, not only a breadcrumb: a mismatch (blocking or reported) or a
  /// certificate that could not be read. A rooted device is a breadcrumb only
  /// — it is a fact about the user's device, not about our artefact.
  bool get reportsSigner =>
      signer == SignerVerdict.mismatch ||
      signer == SignerVerdict.mismatchReported ||
      signer == SignerVerdict.unreadable;

  /// The record: one line, no identifier, safe for a crash sink breadcrumb.
  String get record {
    final String signals = root.signals.map((RootSignal s) => s.wire).join('+');
    return 'integrity root=${root.status.name}'
        '${signals.isEmpty ? '' : '($signals)'} signer=${signer.name}';
  }
}

/// Runs both checks. Never throws.
///
/// [checksSigner] is true on android only — the one host with a signing
/// certificate the app can read about itself. [appPins] is the app's own
/// pins (its `kAppSignerPins`). [pinsFor] is the generated table
/// ([signerPinsFor] with [appPins]) outside tests.
Future<DeviceIntegrity> assessDeviceIntegrity({
  required DeviceIntegrityProbe probe,
  required Map<String, List<String>> appPins,
  required String releaseChannel,
  required bool isDebugBuild,
  required bool checksSigner,
  SignerPinsLookup? pinsFor,
}) async {
  final RootReport root = await detectRoot(probe);
  if (!checksSigner) {
    return DeviceIntegrity(root: root, signer: SignerVerdict.notChecked);
  }
  if (isDebugBuild) {
    return DeviceIntegrity(root: root, signer: SignerVerdict.exemptDebug);
  }
  final SignerPins? pins =
      (pinsFor ?? (String c) => signerPinsFor(c, appPins: appPins))(
        releaseChannel,
      );
  if (pins == null) {
    return DeviceIntegrity(root: root, signer: SignerVerdict.notChecked);
  }
  final SigningCertificates actual;
  try {
    actual = await probe.signingCertificates();
  } on Object {
    return DeviceIntegrity(root: root, signer: SignerVerdict.unreadable);
  }
  return DeviceIntegrity(
    root: root,
    signer: compareSigner(actual: actual, pins: pins, isDebugBuild: false),
  );
}

/// The per-session state: the verdicts, and the one-notice-per-session latch.
final class IntegritySession {
  IntegritySession(this.integrity);

  final DeviceIntegrity integrity;
  bool _rootNoticeShown = false;

  /// True exactly once per session on a rooted device — the caller shows the
  /// notice when it is — and false on every other call or device.
  bool takeRootNotice() {
    if (!integrity.rooted || _rootNoticeShown) return false;
    _rootNoticeShown = true;
    return true;
  }
}

/// Gates [action] behind [reauthenticate] when [integrity] says it must be.
/// Returns whether the action may proceed. A re-auth that throws is a refusal.
Future<bool> confirmSensitiveAction({
  required DeviceIntegrity integrity,
  required SensitiveAction action,
  required Future<bool> Function() reauthenticate,
}) async {
  if (!integrity.requiresReauthFor(action)) return true;
  try {
    return await reauthenticate();
  } on Object {
    return false;
  }
}
