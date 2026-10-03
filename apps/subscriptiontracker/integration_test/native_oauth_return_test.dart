// ─────────────────────────────────────────────────────────────────────────────
// THE PER-TARGET OAUTH-RETURN PROOF (AB-A1-02), run by
// `tooling/e2e/native_auth_proof.mjs --oauth-return` on each native target's
// own device.
//
// ⏱ 2026-10-01 · O-NATIVE-AUTH-CALLBACK-UNBUILT. The callback step of
// `native_auth_proof_test.dart` sits behind a real sign-in, and a CI device
// cannot attest, so since the native route went attested-only (#1070) no
// native build had been watched taking an auth callback. The OAuth return
// needs neither: this suite launches the app, waits on the sign-in surface,
// and has the target deliver
// `com.nikatru.<app>://auth-callback?nk_auth=oauth&code=…` — the URL GoTrue
// ends an Apple or Google sign-in at. It passes only when the native
// repository logs [kOAuthReturnCallbackLine]: the PKCE exchange RAN for that
// URL (and failed, since no flow minted the code), classed as OAuth.
//
// It signs nobody in and answers NO consent prompt, so it writes no
// consent row and leaves nothing for a purge.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' show ErrorWidget, ErrorWidgetBuilder;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_chassis_screens/shell/web_semantics.dart'
    show releaseWebSemantics;
import 'package:subscriptiontracker/main.dart' as app;

import 'native_auth_proof_steps.dart';

/// On iOS the app opens its own return (see [openCallbackFromApp]); empty on
/// every other target, where the drive has the OS deliver it.
const String _openFromApp = String.fromEnvironment('NK_PROOF_OPEN_FROM_APP');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('AB-A1-02 native OAuth return reaches the session exchange', (
    WidgetTester tester,
  ) async {
    final List<String> log = <String>[];
    final DebugPrintCallback original = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) log.add(message);
      original(message, wrapWidth: wrapWidth);
    };
    // main() installs the app's own error widget; the binding refuses a test
    // that leaves it changed, as in native_auth_proof_test.dart.
    final ErrorWidgetBuilder builderBeforeTest = ErrorWidget.builder;
    try {
      await app.main();
      // Long enough for the first frames and the auth seam's first listener —
      // the one that starts the callback log — without touching the UI.
      for (int i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 250));
      }
      debugPrint(kAwaitCallbackMarker);
      if (_openFromApp.isNotEmpty) {
        await openCallbackFromApp(tester, _openFromApp);
      }
      final DateTime deadline = DateTime.now().add(
        const Duration(seconds: 180),
      );
      while (!log.contains(kOAuthReturnCallbackLine) &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 250));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
      }
      expect(
        log,
        contains(kOAuthReturnCallbackLine),
        reason:
            'the OAuth return never reached the session exchange as an OAuth '
            'flow. Callback lines seen: '
            '${log.where((String l) => l.startsWith('nk_auth_callback')).toList()}',
      );
      debugPrint(kOAuthReturnOkLine);
    } finally {
      debugPrint = original;
      ErrorWidget.builder = builderBeforeTest;
      // A no-op on the native targets this runs on (web_semantics_test.dart).
      releaseWebSemantics();
    }
  });
}
