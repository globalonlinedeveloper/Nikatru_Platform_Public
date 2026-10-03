import 'dart:collection';

/// A sliding-window bound on how many events leave the device.
///
/// 🔴 WHY THE CLIENT BOUNDS ITSELF. A crash loop — an error thrown on every
/// frame, or on every retry of a failing request — turns one fault into
/// hundreds of identical events a minute. Every one of them costs the user
/// battery and data, and the self-hosted sink a row. The sink's own 429 cannot
/// be relied on to stop it: GlitchTip answers 429 only when its own limit is
/// configured, and a dropped connection answers nothing at all. So the bound
/// lives on the device, in the `beforeSend` hook every event passes through
/// (`TelemetryBootstrap.configureCore`), whichever path captured it.
///
/// Over the bound an event is DROPPED, never queued and never thrown: the
/// first events of a burst are the ones worth reading, and a telemetry client
/// that blocks or throws is worse than one that stays quiet.
class TelemetryRateBound {
  /// At most [maxEvents] events in any [window]; [now] is injectable for tests.
  TelemetryRateBound({
    this.maxEvents = defaultMaxEvents,
    this.window = defaultWindow,
    DateTime Function()? now,
  })  : assert(maxEvents > 0, 'a bound of zero is "telemetry off"; use the no-op client'),
        _now = now ?? DateTime.now;

  /// The default bound: 30 events a minute, per app process.
  static const int defaultMaxEvents = 30;

  /// The default window.
  static const Duration defaultWindow = Duration(minutes: 1);

  /// The most events allowed in one [window].
  final int maxEvents;

  /// The sliding window [maxEvents] is counted over.
  final Duration window;

  final DateTime Function() _now;
  final Queue<DateTime> _sent = Queue<DateTime>();

  /// How many events the bound has dropped since it was made.
  int get dropped => _dropped;
  int _dropped = 0;

  /// True, and the event is counted, when one more event fits in the window.
  bool tryAcquire() {
    final now = _now();
    while (_sent.isNotEmpty && now.difference(_sent.first) >= window) {
      _sent.removeFirst();
    }
    if (_sent.length >= maxEvents) {
      _dropped++;
      return false;
    }
    _sent.addLast(now);
    return true;
  }
}
