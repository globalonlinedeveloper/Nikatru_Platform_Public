// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · ST-N6 (D23, F37, AB-M3-03) — WHEN A RETURN TO THE APP RE-READS
// THE SERVER.
//
// Every list in a stamped app was read ONCE per process: a web tab left open
// for a day, or a phone app brought back from the background, showed what the
// server said when it was opened — a subscription added on another device, or a
// purchase or refund made on another target, stayed invisible until a restart.
//
// This is the DECISION half, pure Dart so it is testable without a binding: the
// Flutter half (`RefreshOnResume` in packages/chassis_screens) feeds it the
// platform's "resumed" edge, which on web is the tab regaining focus or
// visibility. WHAT is re-read is the app's to say, and nothing else is.
// ─────────────────────────────────────────────────────────────────────────────

/// Runs [refresh] on a return to the app, at most once per [minInterval].
///
/// 🔴 THE INTERVAL IS NOT A NICETY. On desktop and web the "resumed" edge fires
/// on EVERY window focus — alt-tab twice and it has fired twice — so without a
/// floor one person switching windows is a request storm against every list
/// the app re-reads. A pull-to-refresh ([refreshNow]) is a deliberate gesture
/// and ignores the floor.
///
/// Never throws: a failed re-read keeps what the app already shows (a flat
/// network is not an empty account), so the error has nowhere useful to go.
class ResumeRefresh {
  ResumeRefresh({
    required Future<void> Function() refresh,
    this.minInterval = defaultMinInterval,
    Duration Function()? elapsed,
  }) : _refresh = refresh,
       _elapsed = elapsed ?? _monotonic() {
    _last = _elapsed();
  }

  /// Long enough that window switching is not traffic; short enough that a
  /// person who looks away and back sees the other device's change.
  static const Duration defaultMinInterval = Duration(seconds: 30);

  final Future<void> Function() _refresh;

  /// Time since an arbitrary origin, MONOTONIC: a device clock set back must
  /// not stop refresh-on-return until it catches up (review #1080 nit 12).
  final Duration Function() _elapsed;

  static Duration Function() _monotonic() {
    final Stopwatch watch = Stopwatch()..start();
    return () => watch.elapsed;
  }

  /// The floor between two resume-driven re-reads.
  final Duration minInterval;

  /// When the last re-read STARTED — construction counts as one, because the
  /// app's first frame has just read everything.
  /// Set in the constructor, NOT lazily: a `late` initialiser would run at
  /// the first resume and read that moment as the launch.
  late Duration _last;

  /// The re-read in flight, shared by every caller that arrives during it.
  Future<void>? _inFlight;

  /// The platform said the app is in front again. Returns whether a re-read
  /// was started (false inside [minInterval] of the last one).
  Future<bool> onResumed() async {
    if (_elapsed() - _last < minInterval) return false;
    await refreshNow();
    return true;
  }

  /// Re-read now, whatever the interval — the pull-to-refresh gesture.
  ///
  /// Two calls while one re-read is running share it rather than stacking a
  /// second request behind the first.
  Future<void> refreshNow() {
    final Future<void>? running = _inFlight;
    if (running != null) return running;
    _last = _elapsed();
    final Future<void> run = _run();
    _inFlight = run;
    // Cleared by identity, AFTER it is set: a refresh that throws before its
    // first await finishes `_run` synchronously, and clearing inside it would
    // run before the assignment above and leave a finished future "in flight"
    // for the life of the process.
    run.whenComplete(() {
      if (identical(_inFlight, run)) _inFlight = null;
    });
    return run;
  }

  Future<void> _run() async {
    try {
      await _refresh();
    } catch (_) {
      // See the class doc: the last good answer stays on screen.
    }
  }
}
