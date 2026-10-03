import 'pii_scrubber.dart';

/// The last few things telemetry saw, kept ON THE DEVICE for a "Report a
/// problem" report (lane feedback-intake, Do 3) and never sent by telemetry
/// itself:
///
/// * [errorCodes] — the last [codeCapacity] error CODES: an exception's type,
///   never its message, so a report says WHAT failed without carrying the
///   text an error may have been built from.
/// * [breadcrumbs] — the last [breadcrumbCapacity] breadcrumb messages, the
///   report's opt-in "logs". Read back through [PiiScrubber], the same scrub
///   every telemetry event gets in `beforeSend`, so an e-mail address inside
///   a breadcrumb is redacted before the person even sees the preview.
/// * [lastCrashEventId] — the crash sink's id for the last exception it
///   captured. It is set only by a client that reports crashes, and the app
///   builds that client only with crash-reporting consent, so without consent
///   it stays null and a report carries none.
class RecentActivity {
  RecentActivity({this.codeCapacity = 20, this.breadcrumbCapacity = 50});

  /// The one ring every telemetry client records into.
  static final RecentActivity instance = RecentActivity();

  final int codeCapacity;
  final int breadcrumbCapacity;

  final List<String> _codes = <String>[];
  final List<String> _crumbs = <String>[];

  /// The crash sink's event id for the last captured exception, or null.
  String? lastCrashEventId;

  /// Records [error]'s code: its runtime type, never its message.
  void recordError(Object error) => recordCode(errorCodeOf(error));

  /// Records an error code the crash sink already reduced to a type name.
  void recordCode(String code) => _push(
    _codes,
    code.length > 64 ? code.substring(0, 64) : code,
    codeCapacity,
  );

  /// Records one breadcrumb message (scrubbed again when read).
  void recordBreadcrumb(String message, {String? category}) => _push(
    _crumbs,
    category == null ? message : '[$category] $message',
    breadcrumbCapacity,
  );

  /// The recorded error codes, oldest first.
  List<String> get errorCodes => List<String>.unmodifiable(_codes);

  /// The recorded breadcrumbs, oldest first, each through [scrubber].
  List<String> breadcrumbs({PiiScrubber scrubber = const PiiScrubber()}) =>
      List<String>.unmodifiable(_crumbs.map(scrubber.scrubText));

  /// Forgets everything (sign-out, and tests).
  void clear() {
    _codes.clear();
    _crumbs.clear();
    lastCrashEventId = null;
  }

  static void _push(List<String> ring, String value, int capacity) {
    ring.add(value);
    if (ring.length > capacity) ring.removeRange(0, ring.length - capacity);
  }
}

/// An error's CODE: its runtime type name, which carries no user text.
String errorCodeOf(Object error) {
  final String t = error.runtimeType.toString();
  return t.length > 64 ? t.substring(0, 64) : t;
}
