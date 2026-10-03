import 'package:flutter/widgets.dart' show BuildContext;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show platformDeviceIntegrityProbe;
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

import '../features/auth/turnstile_gate.dart'
    show CaptchaTokenController, newCaptchaController, renderTurnstile;
import '../features/shared/chassis_adapters.dart'
    show
        DeviceIntegrityScope,
        integrityRecorder,
        modifiedCopyBlocked,
        reauthenticateUser;
import 'app_config.dart';
import 'signer_pins.g.dart';

/// ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — this app's boot step for root
/// detection and the runtime signature check: the chassis step 3½ that
/// `bootstrapNikatru` runs for every stamped app. This app predates that
/// bootstrap, so `main()` calls this in ONE line (main.dart is a fork that may
/// not grow, assert-chassis-parity); the chassis pieces arrive through
/// features/shared/chassis_adapters.dart, the app's one door to them.
///
/// 🔴 Call it BEFORE the notification adapter and identity: when the signer is
/// not one of the compiled channel's complete pins it runs the modified-copy
/// app and answers true, `main()` returns, and no data is reached. A rooted
/// device answers false and runs on — the notice is `RootedDeviceNoticeHost`
/// (app.dart), the re-auth gate guards the export
/// ([exportAllowedOnThisDevice]), and account deletion re-authenticates every
/// user already. The verdicts go to [telemetry]'s crash sink.
Future<bool> integrityBootBlocks(TelemetryConfig telemetry) {
  final TelemetryClient sink = TelemetryBootstrap.clientFor(telemetry);
  return modifiedCopyBlocked(
    appPins: kAppSignerPins,
    releaseChannel: AppConfig.releaseChannel,
    integrityProbe: platformDeviceIntegrityProbe(),
    record: integrityRecorder(sink.addBreadcrumb, sink.captureMessage),
  );
}

/// Whether the export may run on this device: at once, unless the boot step
/// found it rooted — then only after the signed-in user re-authenticates
/// (`core.SensitiveAction.exportData`). A cancel or a failed re-auth is false.
Future<bool> exportAllowedOnThisDevice(
  BuildContext context,
  core.AuthRepository Function() auth,
) async {
  if (!DeviceIntegrityScope.session.integrity.requiresReauthFor(
    core.SensitiveAction.exportData,
  )) {
    return true;
  }
  final CaptchaTokenController captcha = newCaptchaController();
  try {
    return await reauthenticateUser(
      context,
      auth: auth(),
      captcha: captcha,
      renderTurnstile: renderTurnstile,
    );
  } finally {
    captcha.dispose();
  }
}
