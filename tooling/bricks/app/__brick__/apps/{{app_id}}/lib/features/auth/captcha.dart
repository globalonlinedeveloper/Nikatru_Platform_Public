import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';

import '../../core/app_config.dart';

export 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';

/// The captcha ADAPTER half ([ADR 084]; ST-A1, audit D29). The gate and the
/// token's lifecycle are the chassis's (`turnstile_gate.dart`): every gated call
/// spends its token through `consume()`, and a rendered challenge that has not
/// answered disables the gated action.
///
/// ⚠️ A STAMPED APP HAS NO VENDOR WIDGET YET. Rendering the challenge needs the
/// `cloudflare_turnstile` plugin (whose web assets each owe an app-scoped
/// licence row) and a `TURNSTILE_SITE_KEY` define in `core/app_config.dart`;
/// the flagship's `features/auth/turnstile_gate.dart` is the renderer to copy.
/// Until then no key is read, the challenge never renders or blocks, and a WEB
/// build against a live backend is REPORTED by the gate as `misconfigured`.
CaptchaTokenController newCaptchaController() => CaptchaTokenController(
  posture: captchaPostureFor(
    isWeb: kIsWeb,
    siteKey: '',
    backendLive: AppConfig.isBackendLive,
  ),
);

/// The renderer this app supplies to `TurnstileGate`. Never called while the
/// posture cannot be `challenge` (see above); replace it with the vendor call
/// when the app adds the plugin.
Widget renderTurnstile(BuildContext context, TurnstileChallenge challenge) =>
    const SizedBox.shrink();

/// One controller per gated surface, disposed with it. A CHANGE-NOTIFIER
/// provider so the adapter that `watch`es it rebuilds when the token arrives or
/// is spent — `captchaReady` follows it with no wrapper widget.
final AutoDisposeChangeNotifierProviderFamily<CaptchaTokenController, String>
captchaControllerProvider = ChangeNotifierProvider.autoDispose
    .family<CaptchaTokenController, String>(
      (ref, String surface) => newCaptchaController(),
    );
