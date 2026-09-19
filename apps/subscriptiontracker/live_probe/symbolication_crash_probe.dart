// SYMBOLICATION CRASH PROBE — an alternate entrypoint, NOT the app. Never shipped.
//
// Built ONLY by .github/workflows/symbolication-proof.yml, with
// `flutter build apk -t live_probe/symbolication_crash_probe.dart --obfuscate
// --split-debug-info=...`. It lives in live_probe/ and not lib/ so no store
// build can compile it: every release lane builds the default target,
// lib/main.dart, which does not import this file.
//
// What it does: initialise the REAL telemetry chassis (packages/telemetry, the
// same TelemetryBootstrap every shipped app uses), throw at ONE known source
// line, report the throw with its stack trace to GlitchTip, and print the raw
// (obfuscated, non-symbolic) trace to logcat between sentinels so the workflow
// can symbolize it offline as ground truth. The workflow finds the expected
// line by the THROW-SITE marker below; nothing hard-codes a line number.
//
// Row: O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN. docs/ci/symbolication-proof.md.
import 'package:flutter/widgets.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';

/// Every logcat line the workflow reads carries this prefix.
const String kLinePrefix = 'SYMPROBE|';

/// The thrown object. Its toString is the exception VALUE the event carries,
/// which is a string literal and so survives obfuscation.
class SymbolicationProbeError implements Exception {
  const SymbolicationProbeError(this.marker);
  final String marker;
  @override
  String toString() => 'symbolication-probe $marker';
}

@pragma('vm:never-inline')
void probeThrowSite(String marker) {
  throw SymbolicationProbeError(marker); // SYMBOLICATION-PROBE-THROW-SITE
}

/// debugPrint, not print: it reaches logcat (tag `flutter`) in a release build
/// too, keeps line order, and wraps nothing when no wrapWidth is given.
void _emit(String line) => debugPrint('$kLinePrefix$line');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final TelemetryClient client = await TelemetryBootstrap.init(
    const TelemetryConfig(
      dsn: String.fromEnvironment('GLITCHTIP_DSN'),
      release: 'subscriptiontracker@symbolication-probe',
      environment: 'symbolication-probe',
    ),
  );
  // Minted here, not passed in as a dart-define, so nothing new is compiled into
  // the artifact. Printed first; the workflow reads it back from logcat and
  // finds the GlitchTip event by it.
  final String marker = 'symprobe-${DateTime.now().toUtc().microsecondsSinceEpoch}';
  _emit('BEGIN $marker');
  try {
    probeThrowSite(marker);
  } catch (error, stackTrace) {
    _emit('TRACE-BEGIN');
    for (final String line in stackTrace.toString().split('\n')) {
      _emit(line);
    }
    _emit('TRACE-END');
    await client.captureException(error, stackTrace: stackTrace);
  }
  await client.close();
  _emit('SENT $marker');
  runApp(const SizedBox.shrink());
}
