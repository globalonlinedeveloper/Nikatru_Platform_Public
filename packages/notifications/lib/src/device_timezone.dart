import 'package:flutter/foundation.dart' show debugPrint, immutable;
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/timezone.dart' as tz;

import 'notification_capabilities.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE ONE PLACE `tz.local` IS DECIDED — for the chassis adapter AND for any
// app-owned scheduler that shares the plugin with it.
//
// 🔴 WHAT WAS BROKEN. `tz.local` is a process-global that the `timezone`
// package initialises to UTC. Subly's own scheduler
// (apps/subscriptiontracker/lib/services/notifications/notification_service.dart)
// called `initializeTimeZones()` and NEVER `setLocalLocation`, then built every
// reminder as `TZDateTime(tz.local, y, m, d, 9)`. That is 09:00 UTC — 14:30 in
// Chennai, 04:00 in New York — and nothing in the suite could see it because
// every app test pinned `tz.setLocalLocation(tz.UTC)`, the one value where the
// bug and the correct behaviour agree. The chassis adapter DID set local, but
// lazily, on the same global, with a fixed-offset fallback and no IANA
// resolver wired by anybody — so the zone a reminder was built in was whichever
// of the two services initialised last.
//
// ⚠️ WHY A REAL IANA ZONE AND NOT THE DEVICE OFFSET. A fixed offset is exact
// for a schedule made NOW and wrong across the next DST transition: a renewal
// reminder set in February for a date in April fires an hour out in every
// market that observes DST, until the app is next launched. An IANA location
// carries the rules, so `TZDateTime(America/New_York, 2030, 3, 11, 9)` is
// 13:00Z and `…, 3, 1, 9)` is 14:00Z, from the same call. `flutter_timezone`
// reads that name from the OS on all seven targets (Android, iOS, macOS,
// Linux, Windows, web; apps.gov.in is the Android artefact).
//
// 🔴 THE FALLBACK IS LOUD AND IT IS NEVER UTC. When the plugin is absent (a
// widget test, a host with no platform channel) or names a zone the bundled
// database does not carry, the answer degrades to the device's CURRENT offset —
// exact for today, one hour out across a DST change — and SAYS SO: the reason
// is printed and handed back to the caller, which is what lets a settings
// screen or a crash breadcrumb carry it. Falling back to UTC is indistinguishable
// from working, which is precisely how the original defect shipped.
// ═════════════════════════════════════════════════════════════════════════════

/// The device's IANA zone name (e.g. `Asia/Kolkata`), read from the OS through
/// `flutter_timezone`. The DEFAULT [LocalTimezoneResolver] everywhere; inject
/// another only from a test.
Future<String> deviceIanaTimezone() async =>
    (await FlutterTimezone.getLocalTimezone()).identifier;

/// What [resolveLocalTimezone] decided, and why.
@immutable
class LocalTimezoneResolution {
  const LocalTimezoneResolution._(this.location, this.fallbackReason);

  /// The location `tz.local` should be set to.
  final tz.Location location;

  /// Null when [location] is the device's real IANA zone. Otherwise the reason
  /// the resolver could not be used and [location] is a fixed device offset —
  /// a sentence a log or a settings screen can show, never an empty string.
  final String? fallbackReason;

  bool get isFallback => fallbackReason != null;
}

/// Resolve the zone every reminder must be anchored to.
///
/// Order: [resolver] (default [deviceIanaTimezone]) → `tz.getLocation(name)`;
/// on ANY failure, [deviceOffsetLocation] over [deviceUtcOffset] (default: the
/// host's `DateTime.now().timeZoneOffset`), with [onFallback] told why (default:
/// `debugPrint`). The caller installs the result with `tz.setLocalLocation`.
///
/// `initializeTimeZones()` must have run first — the caller owns that, because
/// it is a one-shot the two services would otherwise both pay for.
Future<LocalTimezoneResolution> resolveLocalTimezone({
  LocalTimezoneResolver? resolver,
  DeviceUtcOffset? deviceUtcOffset,
  void Function(String reason)? onFallback,
}) async {
  final LocalTimezoneResolver resolve = resolver ?? deviceIanaTimezone;
  String reason;
  try {
    final String name = await resolve();
    return LocalTimezoneResolution._(tz.getLocation(name), null);
  } on tz.LocationNotFoundException catch (e) {
    reason = 'the device named a zone the bundled tz database does not carry '
        '(${e.msg})';
  } catch (e) {
    reason = 'the timezone resolver failed ($e)';
  }
  final Duration offset = (deviceUtcOffset ?? _hostUtcOffset)();
  final tz.Location fixed = deviceOffsetLocation(offset);
  final String sentence =
      '🔴 [notifications] timezone fallback: $reason. Reminders are anchored '
      'to the device\'s CURRENT offset (${fixed.name}); they will be one hour '
      'out across the next DST change until the app is next launched.';
  (onFallback ?? debugPrint)(sentence);
  return LocalTimezoneResolution._(fixed, sentence);
}

Duration _hostUtcOffset() => DateTime.now().timeZoneOffset;

/// A [tz.Location] that is simply "wherever this device currently is": one zone,
/// no transitions, [offset] from UTC.
///
/// Exact for a schedule made now, and knowingly incomplete: with no DST rules it
/// cannot predict that the offset changes next month, so a schedule made before
/// a transition fires an hour out until it is re-armed. That is a bounded,
/// twice-a-year, one-hour error — against an unbounded, permanent, up-to-14-hour
/// one for the UTC default it replaces. It is the FALLBACK of
/// [resolveLocalTimezone], never its first answer.
///
/// `transitionAt` starts at [minTime] so the single zone covers all time; the
/// `timezone` package binary-searches that list and takes the last entry at or
/// before the instant it is asked about.
tz.Location deviceOffsetLocation(Duration offset) {
  final String label = _offsetLabel(offset);
  return tz.Location(
    // Not an IANA name, and deliberately shaped so it cannot be mistaken for
    // one if it ever shows up in a log.
    'device$label',
    <int>[_minTime],
    <int>[0],
    // timezone 0.11 takes the offset as a Duration (0.9.x took milliseconds).
    <tz.TimeZone>[tz.TimeZone(offset, isDst: false, abbreviation: label)],
  );
}

/// `timezone`'s own lower bound for an instant, inlined rather than imported:
/// the package exports `Location` but not its `minTime` constant.
const int _minTime = -8640000000000000;

String _offsetLabel(Duration offset) {
  final Duration abs = offset.isNegative ? -offset : offset;
  final String sign = offset.isNegative ? '-' : '+';
  final String h = abs.inHours.toString().padLeft(2, '0');
  final String m = (abs.inMinutes % 60).toString().padLeft(2, '0');
  return '$sign$h$m';
}
