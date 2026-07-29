// [pipeline C-13] The store-review gate.
//
// The screen was refused on "there are no users to ask" — an argument about
// WHEN, not about whether the mechanism can be built and proven. WHEN is this
// file, and it is decidable with no users at all: it is arithmetic over four
// persisted numbers.
//
// Every verdict is asserted, and each is reachable ONLY by its own input, so a
// single wrong comparison cannot pass by being masked by an earlier branch. The
// ordering test at the end is what pins that.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A state that passes every rule, so each test can break exactly one thing.
ReviewGateState _ready(DateTime now) => ReviewGateState(
      launches: 10,
      firstLaunch: now.subtract(const Duration(days: 30)),
      timesAsked: 0,
    );

void main() {
  final DateTime now = DateTime.utc(2026, 7, 29, 12);
  const ReviewGate gate = ReviewGate();

  group('ReviewGate — the open path', () {
    test('a settled, engaged install is asked', () {
      expect(
        gate.decide(_ready(now), now: now, platformCanAsk: true),
        ReviewGateVerdict.ask,
        reason: 'if this never returns ask, the whole feature is a seam that '
            'refuses correctly and is never asked to deliver — the C-6 shape',
      );
    });
  });

  group('ReviewGate — every refusal, one input at a time', () {
    test('a platform that cannot ask is refused first of all', () {
      // Checked BEFORE everything else on purpose: on Linux and web there is
      // nothing to spend, so no other reason is worth computing or reporting.
      expect(
        gate.decide(_ready(now), now: now, platformCanAsk: false),
        ReviewGateVerdict.platformCannotAsk,
      );
    });

    test('a user who said no is never asked again', () {
      expect(
        gate.decide(
          _ready(now).copyWith(suppressed: true),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.suppressedByUser,
      );
    });

    test('too few launches', () {
      expect(
        gate.decide(
          _ready(now).copyWith(launches: 4),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.tooFewLaunches,
      );
    });

    test('the boundary: the fifth launch is enough', () {
      expect(
        gate.decide(
          _ready(now).copyWith(launches: 5),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.ask,
        reason: 'an off-by-one here silently moves the whole rule by a launch',
      );
    });

    test('opened five times in one evening is still evaluating it', () {
      expect(
        gate.decide(
          ReviewGateState(
            launches: 10,
            firstLaunch: now.subtract(const Duration(days: 2)),
          ),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.tooSoonAfterInstall,
      );
    });

    test('the boundary: day three qualifies', () {
      expect(
        gate.decide(
          ReviewGateState(
            launches: 10,
            firstLaunch: now.subtract(const Duration(days: 3)),
          ),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.ask,
      );
    });

    // 🔴 THE ONE THAT COSTS REAL MONEY IF IT IS WRONG. iOS ignores requests
    // beyond roughly three a year WITHOUT SAYING SO — the call returns normally
    // and nothing appears. Asking too often does not annoy the user; it silently
    // burns the app's remaining requests on a dialog nobody sees.
    test('asked recently — the request would be silently discarded', () {
      expect(
        gate.decide(
          _ready(now).copyWith(
            timesAsked: 1,
            lastAskedAt: now.subtract(const Duration(days: 119)),
          ),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.askedTooRecently,
      );
    });

    test('the boundary: 120 days later it may ask again', () {
      expect(
        gate.decide(
          _ready(now).copyWith(
            timesAsked: 1,
            lastAskedAt: now.subtract(const Duration(days: 120)),
          ),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.ask,
      );
    });

    test('three asks is the lifetime cap', () {
      expect(
        gate.decide(
          _ready(now).copyWith(
            timesAsked: 3,
            lastAskedAt: now.subtract(const Duration(days: 400)),
          ),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.askedEnoughTimes,
      );
    });

    // An unknown install date must read as TOO SOON, never as long ago. Failing
    // open here asks on the first launch after the upgrade that introduced this
    // feature — the worst possible moment, and one that only ever happens once
    // per user, so it would never be caught in testing.
    test('an unknown install date is treated as too soon, not as ancient', () {
      expect(
        gate.decide(
          const ReviewGateState(launches: 99),
          now: now,
          platformCanAsk: true,
        ),
        ReviewGateVerdict.tooSoonAfterInstall,
      );
    });
  });

  // Each refusal must be reachable on its own. Without this, a rule ordered
  // wrongly still returns SOME refusal and every boolean assertion above passes
  // while the reported reason is nonsense — and the reason is the only thing
  // that tells a future reader which rule to change.
  group('ReviewGate — the verdicts do not mask each other', () {
    test('every verdict is produced by at least one input', () {
      final Set<ReviewGateVerdict> produced = <ReviewGateVerdict>{
        gate.decide(_ready(now), now: now, platformCanAsk: true),
        gate.decide(_ready(now), now: now, platformCanAsk: false),
        gate.decide(
          _ready(now).copyWith(suppressed: true),
          now: now,
          platformCanAsk: true,
        ),
        gate.decide(
          _ready(now).copyWith(launches: 1),
          now: now,
          platformCanAsk: true,
        ),
        gate.decide(
          const ReviewGateState(launches: 9),
          now: now,
          platformCanAsk: true,
        ),
        gate.decide(
          _ready(now).copyWith(timesAsked: 1, lastAskedAt: now),
          now: now,
          platformCanAsk: true,
        ),
        gate.decide(
          _ready(now).copyWith(timesAsked: 5),
          now: now,
          platformCanAsk: true,
        ),
      };
      expect(
        produced,
        hasLength(ReviewGateVerdict.values.length),
        reason: 'a verdict no input can produce is dead code that reports as a '
            'covered branch; a missing one means an earlier rule is masking it',
      );
    });
  });

  group('ReviewGateState — survives a restart', () {
    test('round-trips through json, dates included', () {
      final ReviewGateState s = ReviewGateState(
        launches: 7,
        firstLaunch: now.subtract(const Duration(days: 10)),
        lastAskedAt: now.subtract(const Duration(days: 5)),
        timesAsked: 2,
        suppressed: true,
      );
      final ReviewGateState back = ReviewGateState.fromJson(s.toJson());
      expect(back.launches, 7);
      expect(back.timesAsked, 2);
      expect(back.suppressed, isTrue);
      expect(back.firstLaunch, s.firstLaunch);
      expect(back.lastAskedAt, s.lastAskedAt);
      // The decision must be identical on both sides of a restart, which is the
      // thing the round-trip is actually for.
      expect(
        gate.decide(back, now: now, platformCanAsk: true),
        gate.decide(s, now: now, platformCanAsk: true),
      );
    });

    test('a corrupt or empty record reads as a fresh install, not a stale ask',
        () {
      final ReviewGateState s = ReviewGateState.fromJson(<String, Object?>{
        'launches': 'not a number',
        'first_launch': 'nonsense',
      });
      expect(s.launches, 0);
      expect(s.firstLaunch, isNull);
      expect(s.timesAsked, 0);
      expect(
        gate.decide(s, now: now, platformCanAsk: true),
        ReviewGateVerdict.tooFewLaunches,
        reason: 'unreadable history must never resolve to "safe to ask" — that '
            'spends the one request on a user we know nothing about',
      );
    });
  });
}
