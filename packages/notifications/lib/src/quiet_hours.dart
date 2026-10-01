import 'package:flutter/foundation.dart' show immutable;

/// A nightly window in which no LOCAL reminder fires — NO-13.
///
/// [startMinute] and [endMinute] are minutes after local midnight. A window
/// whose start is after its end wraps midnight (22:00–07:00), which is the
/// usual case. A reminder planned inside the window is DEFERRED to the end of
/// it, never dropped: a renewal reminder that never fires is worse than one
/// that fires at seven.
@immutable
class QuietHours {
  const QuietHours({required this.startMinute, required this.endMinute})
    : assert(startMinute >= 0 && startMinute < 24 * 60),
      assert(endMinute >= 0 && endMinute < 24 * 60);

  final int startMinute;
  final int endMinute;

  /// Whether the window is empty (start == end) — nothing is ever deferred.
  bool get isEmpty => startMinute == endMinute;

  bool _inside(int minute) => startMinute < endMinute
      ? minute >= startMinute && minute < endMinute
      : minute >= startMinute || minute < endMinute;

  /// [at] when it is outside the window; otherwise the window's END on the
  /// right day (the same day before midnight is crossed, the next day after).
  /// Read as a local wall clock, like `ScheduledNotification.at`.
  DateTime defer(DateTime at) {
    if (isEmpty) return at;
    final int minute = at.hour * 60 + at.minute;
    if (!_inside(minute)) return at;
    // Inside a window that wraps midnight and still before it: the end is
    // tomorrow. Otherwise (after midnight, or a same-day window) it is today.
    final bool tomorrow = startMinute > endMinute && minute >= startMinute;
    return DateTime(
      at.year,
      at.month,
      at.day + (tomorrow ? 1 : 0),
      endMinute ~/ 60,
      endMinute % 60,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is QuietHours &&
      other.startMinute == startMinute &&
      other.endMinute == endMinute;

  @override
  int get hashCode => Object.hash(startMinute, endMinute);
}
