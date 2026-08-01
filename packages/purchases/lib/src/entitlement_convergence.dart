import 'package:flutter/foundation.dart' show immutable;
import 'package:nikatru_core/nikatru_core.dart' as core;

/// How a wait for the unlock ended. Every one of these is TERMINAL — the poller
/// never returns "still going", because a UI that can be handed that state is a
/// UI that can spin forever.
enum ConvergenceOutcome {
  /// The server confirmed the entitlement. The only value that unlocks.
  unlocked,

  /// The server answered, and it still does not see the payment, after every
  /// attempt in the plan. The purchase may yet land — this is PENDING, not
  /// FAILED, and the copy has to say so.
  stillPending,

  /// We could not ask (no session, no transport, no network). Distinct from
  /// [stillPending]: "we do not know" and "we asked and the answer is not yet"
  /// need different sentences and different retry advice.
  couldNotAsk,
}

/// The result of converging, including how much work it took.
@immutable
class ConvergenceResult {
  const ConvergenceResult({
    required this.outcome,
    required this.attempts,
    required this.entitlements,
  });

  final ConvergenceOutcome outcome;

  /// Server reads actually performed. Asserted in tests: a bound nobody counts
  /// is a bound nobody enforces.
  final int attempts;

  /// The last answer received, or [core.Entitlements.none] if none was.
  final core.Entitlements entitlements;

  bool get isUnlocked => outcome == ConvergenceOutcome.unlocked;
}

/// 🔒 THE BOUND. Five attempts over roughly a minute.
///
/// ## Why the bound is a portfolio constraint, not a UX preference
/// The whole factory shares a **100k Worker-requests/day free ceiling, account
/// wide, across ~50 apps**. An unbounded "poll until it arrives" loop is a
/// client-side denial of service against every other app's config resolution and
/// analytics ingest — and it would be written by somebody being helpful.
///
/// The delays grow, so a webhook that lands in two seconds costs one extra read
/// and a slow one costs five, not fifty.
const List<Duration> kCheckoutConvergenceDelays = <Duration>[
  Duration(seconds: 2),
  Duration(seconds: 4),
  Duration(seconds: 8),
  Duration(seconds: 16),
  Duration(seconds: 30),
];

/// Waits for an asynchronous unlock to show up on the server — [pipeline 5]M-6.
///
/// ## The problem this exists for
/// A hosted checkout returns the buyer to the app the instant they pay. The
/// merchant of record's notification reaches our Worker some time after that,
/// and the entitlement row is written then. So there is a window — usually
/// seconds, occasionally longer — in which the user has genuinely paid and the
/// server genuinely does not know.
///
/// The two obvious answers are both wrong:
/// - Unlock on the checkout's return. That unlocks on an abandoned checkout, a
///   declined card and a back button, because none of those are distinguishable
///   from success at the client.
/// - Show "purchase failed". That tells a paying customer their money vanished.
///
/// So the client re-reads with bounded backoff, shows PENDING while it does, and
/// lands in a stated terminal state either way.
class EntitlementConvergence {
  EntitlementConvergence({
    required core.EntitlementTransport transport,
    required core.EntitlementCache cache,
    List<Duration> delays = kCheckoutConvergenceDelays,
    Future<void> Function(Duration)? sleep,
  })  : _transport = transport,
        _cache = cache,
        _delays = delays,
        // Injectable so a test can drive five attempts in microseconds instead of
        // a minute. `Future.delayed` inside a widget test is the trap the repo
        // has hit before: `tester.pump()` with no duration runs no timers at all,
        // so a real sleep here would make every such test hang or lie.
        _sleep = sleep ?? Future<void>.delayed;

  final core.EntitlementTransport _transport;
  final core.EntitlementCache _cache;
  final List<Duration> _delays;
  final Future<void> Function(Duration) _sleep;

  /// The number of server reads this can ever perform: one immediately, then one
  /// after each delay.
  int get maxAttempts => _delays.length + 1;

  /// Poll until the entitlement appears, the plan is exhausted, or we find we
  /// cannot ask at all.
  ///
  /// Every SUCCESSFUL read is written through [core.EntitlementCache.saveVerified]
  /// — including the ones that say "not Pro". Persisting the negative answers is
  /// what makes the staleness ceiling ([pipeline 5]M-8) work: a cache that only
  /// ever recorded grants would keep the last grant looking freshly verified
  /// forever.
  Future<ConvergenceResult> awaitUnlock({
    required String appId,
    required Future<String?> Function() accessToken,
    DateTime Function()? clock,
  }) async {
    final DateTime Function() now = clock ?? DateTime.now;
    core.Entitlements last = core.Entitlements.none;
    bool everAnswered = false;
    int attempts = 0;

    for (int i = 0; i < maxAttempts; i++) {
      if (i > 0) {
        await _sleep(_delays[i - 1]);
      }
      attempts++;
      final core.Result<core.Entitlements> r = await _transport.fetch(
        appId: appId,
        accessToken: await accessToken(),
      );
      final core.Entitlements? value = r.fold(
        (core.Entitlements e) => e,
        (core.Failure _) => null,
      );
      // Could not ask this time; the plan continues.
      if (value == null) {
        continue;
      }
      everAnswered = true;
      last = value;
      await _cache.saveVerified(value, now: now());
      if (value.isProAt(now())) {
        return ConvergenceResult(
          outcome: ConvergenceOutcome.unlocked,
          attempts: attempts,
          entitlements: value,
        );
      }
    }

    return ConvergenceResult(
      // Never asked successfully ⇒ we do not know. Reporting `stillPending`
      // here would claim the server said no when nothing ever answered.
      outcome: everAnswered
          ? ConvergenceOutcome.stillPending
          : ConvergenceOutcome.couldNotAsk,
      attempts: attempts,
      entitlements: last,
    );
  }
}
