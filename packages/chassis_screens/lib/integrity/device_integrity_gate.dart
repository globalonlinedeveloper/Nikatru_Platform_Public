import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        defaultTargetPlatform,
        kDebugMode,
        kIsWeb,
        visibleForTesting;
import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../auth/turnstile_gate.dart';
import 'tampered_build_screen.dart';

export 'tampered_build_screen.dart';

/// ⏱ 2026-10-01 · DEVICE INTEGRITY, THE CHASSIS HALF (row
/// O-APPS-GOV-IN-VAPT-CHECKLIST): the boot step every stamped app inherits
/// through `bootstrapNikatru` and the re-authentication gate in front of the
/// sensitive actions. The once-per-session rooted notice is
/// `RootedDeviceNoticeHost`, beside `OfflineBannerHost` in shell/app_shell.dart.
///
/// The decisions are `core`'s ([core.assessDeviceIntegrity]); the probe is the
/// app's to pass (`platformDeviceIntegrityProbe()` from
/// `nikatru_platform_storage`), because this package declares no plugin.
///
/// 🔴 THE TWO FAILURE POLICIES, restated where they are applied:
///   · a re-signed copy ([core.DeviceIntegrity.blocksDataAccess]) gets
///     `TamperedBuildApp` from the boot step and nothing else;
///   · a rooted device gets `RootedDeviceNoticeHost`'s notice once per session
///     and a re-authentication before [core.SensitiveAction]s — never a block.

/// What a boot step does with the verdicts: record them (a crash-sink
/// breadcrumb, an event for a signer problem). Never shown to the user.
typedef DeviceIntegrityRecorder = void Function(core.DeviceIntegrity integrity);

/// THE RECORD every app keeps: a breadcrumb for every verdict (attached to any
/// later crash report of the session), and an EVENT of its own for a signer
/// problem ([core.DeviceIntegrity.reportsSigner]) — a re-signed copy crashes
/// nothing, so a breadcrumb alone would never reach anyone. Takes the app's
/// `TelemetryClient.addBreadcrumb` and `.captureMessage` as tear-offs, so this
/// package needs no telemetry dependency. The line carries no identifier
/// ([core.DeviceIntegrity.record]).
DeviceIntegrityRecorder integrityRecorder(
  void Function(String message, {String? category}) breadcrumb,
  Future<void> Function(String message) report,
) => (core.DeviceIntegrity integrity) {
  breadcrumb(integrity.record, category: 'integrity');
  if (integrity.reportsSigner) report(integrity.record).ignore();
};

/// The session's verdicts, set once by [checkDeviceIntegrity]. Until then —
/// and in every test that does not set it — nothing was checked, which never
/// warns and never gates.
abstract final class DeviceIntegrityScope {
  /// This session's verdicts. Written by [checkDeviceIntegrity], and by tests.
  static core.IntegritySession session = core.IntegritySession(
    core.DeviceIntegrity.unchecked,
  );
}

/// THE BOOT STEP. Runs both checks, records them, and makes them this
/// session's. The caller runs `TamperedBuildApp` instead of the app when the
/// result's `integrity.blocksDataAccess` is true.
///
/// [integrityProbe] null (web, desktop) checks nothing. The signer is checked
/// on android only; [isDebugBuild] (default `kDebugMode`) exempts a debug build
/// from it — a profile or release build is always checked. [appPins] is the
/// app's own pins (its `kAppSignerPins`): Play holds one app signing key per
/// app (⏱ 2026-10-03, ADR 030).
Future<core.IntegritySession> checkDeviceIntegrity({
  required Map<String, List<String>> appPins,
  required String releaseChannel,
  required core.DeviceIntegrityProbe? integrityProbe,
  DeviceIntegrityRecorder? record,
  bool isDebugBuild = kDebugMode,
  TargetPlatform? platform,
  bool isWeb = kIsWeb,
  @visibleForTesting core.SignerPinsLookup? pinsFor,
}) async {
  final bool isAndroid =
      !isWeb && (platform ?? defaultTargetPlatform) == TargetPlatform.android;
  final core.DeviceIntegrity integrity = integrityProbe == null
      ? core.DeviceIntegrity.unchecked
      : await core.assessDeviceIntegrity(
          probe: integrityProbe,
          appPins: appPins,
          releaseChannel: releaseChannel,
          isDebugBuild: isDebugBuild,
          checksSigner: isAndroid,
          pinsFor: pinsFor,
        );
  if (record != null) {
    try {
      record(integrity);
    } on Object {
      // A recorder that fails must not cost the user the app.
    }
  }
  final core.IntegritySession session = core.IntegritySession(integrity);
  DeviceIntegrityScope.session = session;
  return session;
}

/// THE BOOT STEP AND ITS ONE CONSEQUENCE, for a `main()` to call before its
/// notification adapter and identity: runs [checkDeviceIntegrity] and, when
/// the signer is not one of [releaseChannel]'s complete pins, runs
/// [TamperedBuildApp] instead of the app and answers true — the caller then
/// returns, so nothing that could reach the user's data is ever built.
/// `bootstrapNikatru` calls it for every stamped app.
Future<bool> modifiedCopyBlocked({
  required Map<String, List<String>> appPins,
  required String releaseChannel,
  required core.DeviceIntegrityProbe? integrityProbe,
  DeviceIntegrityRecorder? record,
  bool isDebugBuild = kDebugMode,
  TargetPlatform? platform,
  @visibleForTesting bool isWeb = kIsWeb,
  @visibleForTesting core.SignerPinsLookup? pinsFor,
}) async {
  final core.IntegritySession session = await checkDeviceIntegrity(
    appPins: appPins,
    releaseChannel: releaseChannel,
    integrityProbe: integrityProbe,
    record: record,
    isDebugBuild: isDebugBuild,
    platform: platform,
    isWeb: isWeb,
    pinsFor: pinsFor,
  );
  if (!session.integrity.blocksDataAccess) return false;
  runApp(const TamperedBuildApp());
  return true;
}

/// Whether [action] may proceed on this device: true at once unless the
/// session says the device is rooted, and then only after the signed-in user
/// re-authenticates ([reauthenticateUser]). [session] defaults to
/// [DeviceIntegrityScope.session].
Future<bool> confirmSensitiveAction(
  BuildContext context, {
  required core.SensitiveAction action,
  required core.AuthRepository auth,
  required CaptchaTokenController captcha,
  required TurnstileRenderer renderTurnstile,
  core.IntegritySession? session,
}) => core.confirmSensitiveAction(
  integrity: (session ?? DeviceIntegrityScope.session).integrity,
  action: action,
  reauthenticate: () => reauthenticateUser(
    context,
    auth: auth,
    captcha: captcha,
    renderTurnstile: renderTurnstile,
  ),
);

/// Asks the signed-in user to prove it is them again: their password for a
/// password account, their provider's sign-in otherwise
/// ([core.confirmIdentityWithProvider]). With nobody signed in there is no
/// identity to re-check and the data is this device's own, so it answers true.
/// A cancel, a wrong password or a failed sign-in answers false.
///
/// The password sign-in is a CAPTCHA-GATED endpoint, so [ReauthDialog] mounts
/// [TurnstileGate] on [captcha] and the call spends its token — the same wire
/// as the delete dialog. A rooted verdict exists only where a device-integrity
/// probe does (android, ios), where [ADR 084] renders no challenge
/// (`CaptchaPosture.notOnThisChannel`), so in practice no token is needed; the
/// wire is there so the surface never depends on that. The caller owns and
/// disposes [captcha].
Future<bool> reauthenticateUser(
  BuildContext context, {
  required core.AuthRepository auth,
  required CaptchaTokenController captcha,
  required TurnstileRenderer renderTurnstile,
}) async {
  final core.AuthUser? user = auth.currentUser;
  if (user == null) return true;
  if (!user.hasPasswordIdentity) {
    try {
      await core.confirmIdentityWithProvider(auth: auth, user: user);
      return true;
    } on Object {
      return false;
    }
  }
  final String? password = await showDialog<String>(
    context: context,
    builder: (BuildContext context) =>
        ReauthDialog(captcha: captcha, renderTurnstile: renderTurnstile),
  );
  if (password == null || password.isEmpty) return false;
  try {
    await captcha.untilReady();
    await auth.signInWithEmail(
      email: user.email,
      password: password,
      captchaToken: captcha.consume(),
    );
    return true;
  } on Object {
    return false;
  }
}

/// The password prompt [reauthenticateUser] shows. Pops the typed password,
/// or null on cancel.
class ReauthDialog extends StatefulWidget {
  const ReauthDialog({
    required this.captcha,
    required this.renderTurnstile,
    super.key,
  });

  /// The challenge the sign-in spends; rendered by [TurnstileGate].
  final CaptchaTokenController captcha;

  /// How this app draws the challenge.
  final TurnstileRenderer renderTurnstile;

  /// The password field, for tests.
  static const Key passwordField = ValueKey<String>('reauth-password');

  /// The confirm button, for tests.
  static const Key confirmButton = ValueKey<String>('reauth-confirm');

  @override
  State<ReauthDialog> createState() => _ReauthDialogState();
}

class _ReauthDialogState extends State<ReauthDialog> {
  final TextEditingController _password = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    return AlertDialog(
      title: Text(l10n.reauthTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(l10n.reauthMessage),
          const SizedBox(height: 16),
          TextField(
            key: ReauthDialog.passwordField,
            controller: _password,
            obscureText: true,
            autofillHints: const <String>[AutofillHints.password],
            decoration: InputDecoration(labelText: l10n.password),
            onSubmitted: (String v) => Navigator.of(context).pop(v),
          ),
          TurnstileGate(
            controller: widget.captcha,
            render: widget.renderTurnstile,
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: ReauthDialog.confirmButton,
          onPressed: () => Navigator.of(context).pop(_password.text),
          child: Text(l10n.continueLabel),
        ),
      ],
    );
  }
}
