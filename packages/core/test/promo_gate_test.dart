// [ADR 040 · research/44 §7 rung 2] The in-app promo frequency governor.
//
// Three things are asserted here that a boolean-returning gate could not be
// asked about at all:
//
//   1. every verdict is reachable by ONE input, so a rule ordered wrongly still
//      returns SOME refusal and would otherwise pass every assertion while
//      reporting a reason that is nonsense;
//   2. the two latches survive every path that could clear them — a counter
//      rollover, a `copyWith`, a corrupt record, a lifetime cap being reached.
//      The suppression latch is the GDPR Art 21 objection, so "it got cleared"
//      is not a UX regression, it is processing someone's data for a purpose
//      they exercised an absolute right to stop;
//   3. the decision depends on the `now` it is HANDED and on nothing else —
//      pinned by deciding the same state against two clocks a century apart.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 8, 10, 9);
  const PromoGate gate = PromoGate();

  /// A campaign that is on, has a creative, and a user who has done nothing —
  /// so each test can break exactly one thing.
  PromoGateDecision decide(
    PromoGateState state, {
    DateTime? at,
    bool featureEnabled = true,
    bool hasContent = true,
  }) =>
      gate.decide(
        state,
        now: at ?? now,
        featureEnabled: featureEnabled,
        hasContent: hasContent,
      );

  group('PromoGate — the open path', () {
    test('a fresh install on a live campaign is shown, once', () {
      const PromoGateState before = PromoGateState();
      final PromoGateDecision d = decide(before);

      expect(
        d.verdict,
        PromoGateVerdict.show,
        reason: 'if this never returns show, the governor is a seam that '
            'refuses correctly and is never asked to deliver — the C-6 shape',
      );
      expect(d.show, isTrue);
      expect(d.state.shownCount, 1);
      expect(d.state.lastShownAt, now);
    });

    test('the returned state is what stops it showing twice', () {
      final PromoGateDecision first = decide(const PromoGateState());
      final PromoGateDecision second = decide(first.state);

      expect(first.verdict, PromoGateVerdict.show);
      expect(
        second.verdict,
        PromoGateVerdict.shownTooRecently,
        reason:
            'the increment has to be carried by the decision; a caller that '
            'has to remember to count is a caller that produces a card on '
            'every rebuild',
      );
    });

    test('three shows a week apart, then the lifetime cap', () {
      PromoGateState s = const PromoGateState();
      final List<PromoGateVerdict> got = <PromoGateVerdict>[];
      for (int week = 0; week < 4; week++) {
        final PromoGateDecision d =
            decide(s, at: now.add(Duration(days: 7 * week)));
        got.add(d.verdict);
        s = d.state;
      }
      expect(got, <PromoGateVerdict>[
        PromoGateVerdict.show,
        PromoGateVerdict.show,
        PromoGateVerdict.show,
        PromoGateVerdict.shownEnoughTimes,
      ]);
      expect(s.shownCount, 3);
    });
  });

  group('PromoGate — every refusal, one input at a time', () {
    test('the kill switch is answered first of all', () {
      // research/44 §4.5: `features.promo_card_enabled` absent ⇒ render
      // nothing. An app that has never reached the network shows no promo.
      expect(
        decide(const PromoGateState(), featureEnabled: false).verdict,
        PromoGateVerdict.featureOff,
      );
    });

    // 🔴 THE ONE THAT IS NOT A PREFERENCE. GDPR Art 21(2)/(3): the objection is
    // absolute, and after it "the personal data shall no longer be processed
    // for such purposes". It outranks the campaign, the counters and the flag.
    test('a user who objected is never promoted to again', () {
      expect(
        decide(const PromoGateState(suppressed: true)).verdict,
        PromoGateVerdict.suppressedByUser,
      );
    });

    test('a closed card stays closed', () {
      expect(
        decide(const PromoGateState(dismissed: true)).verdict,
        PromoGateVerdict.dismissedByUser,
      );
    });

    // research/44's DO-NOT-BUILD list opens with the empty portfolio directory:
    // wired, guarded, green and useless. An empty payload gets a verdict of its
    // own so it cannot be reported as a healthy `show` the widget then swallows.
    test('an eligible user and nothing to promote is not a show', () {
      expect(
        decide(const PromoGateState(), hasContent: false).verdict,
        PromoGateVerdict.nothingToShow,
      );
    });

    test('inside the cooldown', () {
      expect(
        decide(
          PromoGateState(
            shownCount: 1,
            lastShownAt: now.subtract(const Duration(days: 6)),
          ),
        ).verdict,
        PromoGateVerdict.shownTooRecently,
      );
    });

    test('the boundary: on day seven it may show again', () {
      expect(
        decide(
          PromoGateState(
            shownCount: 1,
            lastShownAt: now.subtract(const Duration(days: 7)),
          ),
        ).verdict,
        PromoGateVerdict.show,
        reason: 'an off-by-one here silently moves the whole governor by a day',
      );
    });

    test('the boundary: the third show is allowed, the fourth is not', () {
      final PromoGateState twoShown = PromoGateState(
        shownCount: 2,
        lastShownAt: now.subtract(const Duration(days: 30)),
      );
      expect(decide(twoShown).verdict, PromoGateVerdict.show);
      expect(
        decide(twoShown.copyWith(shownCount: 3)).verdict,
        PromoGateVerdict.shownEnoughTimes,
      );
    });

    // An unreadable date must read as "just now", never as "long ago". Failing
    // open here restarts the campaign for exactly the users whose record was
    // damaged, once each, on one launch — never reproducible, never noticed.
    test('shown at an unknown time holds; never shown does not', () {
      expect(
        decide(const PromoGateState(shownCount: 2)).verdict,
        PromoGateVerdict.shownTooRecently,
      );
      expect(
        decide(const PromoGateState()).verdict,
        PromoGateVerdict.show,
      );
    });

    test('a clock moved backwards is not a way to reset the cap', () {
      expect(
        decide(
          PromoGateState(
            shownCount: 1,
            lastShownAt: now.add(const Duration(days: 400)),
          ),
        ).verdict,
        PromoGateVerdict.shownTooRecently,
        reason: 'a negative elapsed time is inside every cooldown, and the '
            'device clock is a thing the user can set',
      );
    });
  });

  // Without this, a rule ordered wrongly still returns SOME refusal: every
  // assertion above passes and the reported reason — the only thing that tells
  // a future reader which rule to change — is nonsense.
  group('PromoGate — the verdicts do not mask each other', () {
    test('every verdict is produced by at least one input', () {
      final Set<PromoGateVerdict> produced = <PromoGateVerdict>{
        decide(const PromoGateState()).verdict,
        decide(const PromoGateState(), featureEnabled: false).verdict,
        decide(const PromoGateState(suppressed: true)).verdict,
        decide(const PromoGateState(dismissed: true)).verdict,
        decide(const PromoGateState(), hasContent: false).verdict,
        decide(const PromoGateState(shownCount: 3)).verdict,
        decide(
          PromoGateState(shownCount: 1, lastShownAt: now),
        ).verdict,
      };
      expect(
        produced,
        hasLength(PromoGateVerdict.values.length),
        reason: 'a verdict no input can produce is dead code that reports as a '
            'covered branch; a missing one means an earlier rule masks it',
      );
    });

    test('the objection outranks everything a campaign can say', () {
      // Every other input says "show": the flag is on, there is a creative, the
      // counters are fresh. Only the objection is set.
      expect(
        decide(const PromoGateState(suppressed: true)).verdict,
        PromoGateVerdict.suppressedByUser,
      );
      // And it outranks the other refusals too, so it can never be reported as
      // a cooldown — which a future reader would "fix" by waiting.
      expect(
        decide(
          PromoGateState(
            shownCount: 99,
            lastShownAt: now,
            dismissed: true,
            suppressed: true,
          ),
        ).verdict,
        PromoGateVerdict.suppressedByUser,
      );
    });
  });

  group('PromoGate — what the caller must write back', () {
    test('a hold returns the SAME instance, so there is nothing to persist',
        () {
      const PromoGateState before = PromoGateState(dismissed: true);
      expect(identical(decide(before).state, before), isTrue);

      const PromoGateState fresh = PromoGateState();
      expect(
          identical(decide(fresh, featureEnabled: false).state, fresh), isTrue);
      expect(identical(decide(fresh, hasContent: false).state, fresh), isTrue);
    });

    test('a show returns a new instance carrying the increment', () {
      const PromoGateState before = PromoGateState();
      final PromoGateDecision d = decide(before);
      expect(identical(d.state, before), isFalse);
      expect(before.shownCount, 0, reason: 'the input must not be mutated');
    });

    test('deciding is idempotent — the write is the moment of truth', () {
      // Two decisions from the same STORED state both say show. That is the
      // contract the card depends on: a rebuild that re-decides before the
      // write must not make the card vanish under its own cooldown.
      const PromoGateState before = PromoGateState();
      expect(decide(before).verdict, PromoGateVerdict.show);
      expect(decide(before).verdict, PromoGateVerdict.show);
    });

    test('the stamp is UTC, so crossing time zones is not a fresh campaign',
        () {
      final DateTime local = DateTime.utc(2026, 8, 10, 9).toLocal();
      final PromoGateDecision d = decide(const PromoGateState(), at: local);
      expect(d.state.lastShownAt!.isUtc, isTrue);
      expect(d.state.lastShownAt, local.toUtc());
    });
  });

  group('PromoGateState — the latches only travel one way', () {
    test('copyWith cannot clear either latch — there is no parameter for it',
        () {
      const PromoGateState latched =
          PromoGateState(dismissed: true, suppressed: true);
      final PromoGateState after =
          latched.copyWith(shownCount: 0, lastShownAt: null);
      expect(after.dismissed, isTrue);
      expect(after.suppressed, isTrue);
      expect(
        decide(after).verdict,
        PromoGateVerdict.suppressedByUser,
        reason: 'zeroing the counters is exactly the rollover the latch exists '
            'to survive',
      );
    });

    test('a counter rollover cannot clear the objection', () {
      // Drive the state the way the chassis would: cap reached, a year passes,
      // the record is re-read from disk.
      PromoGateState s = const PromoGateState().objectToPromotion();
      for (int week = 0; week < 6; week++) {
        s = decide(s, at: now.add(Duration(days: 7 * week))).state;
      }
      s = PromoGateState.fromJson(s.toJson());
      expect(s.suppressed, isTrue);
      expect(
        decide(s, at: now.add(const Duration(days: 365))).verdict,
        PromoGateVerdict.suppressedByUser,
      );
    });

    test('dismiss and object are independent controls', () {
      const PromoGateState fresh = PromoGateState();
      expect(fresh.dismiss().dismissed, isTrue);
      expect(fresh.dismiss().suppressed, isFalse);
      expect(fresh.objectToPromotion().suppressed, isTrue);
      expect(fresh.objectToPromotion().dismissed, isFalse);
    });

    test(
        'withdrawing an objection re-enables promotion but does not un-close '
        'a card the person already closed', () {
      final PromoGateState both =
          const PromoGateState().dismiss().objectToPromotion();
      final PromoGateState back = both.withdrawObjection();
      expect(back.suppressed, isFalse);
      expect(back.dismissed, isTrue);
      expect(decide(back).verdict, PromoGateVerdict.dismissedByUser);

      // And on a state that was only suppressed, withdrawing really does open
      // the path again — otherwise the toggle is a one-way trap.
      expect(
        decide(const PromoGateState().objectToPromotion().withdrawObjection())
            .verdict,
        PromoGateVerdict.show,
      );
    });

    test('the transitions preserve the counters', () {
      final PromoGateState s = PromoGateState(shownCount: 2, lastShownAt: now);
      for (final PromoGateState t in <PromoGateState>[
        s.dismiss(),
        s.objectToPromotion(),
        s.withdrawObjection(),
      ]) {
        expect(t.shownCount, 2);
        expect(t.lastShownAt, now);
      }
    });
  });

  group('PromoGateState — a restart, and a damaged record', () {
    test('round-trips through json, dates and latches included', () {
      final PromoGateState s = PromoGateState(
        shownCount: 2,
        lastShownAt: now.subtract(const Duration(days: 3)),
        dismissed: true,
        suppressed: true,
      );
      final PromoGateState back = PromoGateState.fromJson(s.toJson());
      expect(back.shownCount, 2);
      expect(back.lastShownAt, s.lastShownAt);
      expect(back.dismissed, isTrue);
      expect(back.suppressed, isTrue);
      // The decision must be identical on both sides of a restart, which is the
      // thing the round-trip is actually for.
      expect(decide(back).verdict, decide(s).verdict);
    });

    test('an empty record is a fresh install and may be shown', () {
      final PromoGateState s = PromoGateState.fromJson(<String, Object?>{});
      expect(s.shownCount, 0);
      expect(s.dismissed, isFalse);
      expect(s.suppressed, isFalse);
      expect(decide(s).verdict, PromoGateVerdict.show);
    });

    // 🔴 THE ASYMMETRY THAT DECIDES EVERY DEFAULT IN fromJson. A corrupt record
    // read as "never objected" promotes to someone who exercised an absolute
    // right to stop. A corrupt record read as "objected" costs one un-shown
    // card. The failure is made to fall the second way, deliberately.
    test('a latch present but unreadable reads as SET, not as absent', () {
      for (final Object? junk in <Object?>['yes', 'false', 1, 0, null]) {
        expect(
          PromoGateState.fromJson(<String, Object?>{'suppressed': junk})
              .suppressed,
          isTrue,
          reason: 'corruption in the field whose job is to say stop is read as '
              'stop — junk was ${junk.runtimeType} $junk',
        );
        expect(
          PromoGateState.fromJson(<String, Object?>{'dismissed': junk})
              .dismissed,
          isTrue,
        );
      }
    });

    test('a latch written honestly false reads false', () {
      final PromoGateState s = PromoGateState.fromJson(<String, Object?>{
        'suppressed': false,
        'dismissed': false,
      });
      expect(s.suppressed, isFalse);
      expect(s.dismissed, isFalse);
      expect(decide(s).verdict, PromoGateVerdict.show);
    });

    test('an unreadable or negative count reads as shown-at-an-unknown-time',
        () {
      for (final Object? junk in <Object?>['two', -1, 3.5, null]) {
        final PromoGateState s =
            PromoGateState.fromJson(<String, Object?>{'shown_count': junk});
        expect(s.shownCount, greaterThan(0));
        expect(s.lastShownAt, isNull);
        expect(
          decide(s).verdict,
          PromoGateVerdict.shownTooRecently,
          reason: 'a damaged counter must never resolve to "safe to show" — '
              'that restarts a campaign against a user we already promoted to',
        );
      }
    });

    test('an unreadable date on a real count holds rather than showing', () {
      final PromoGateState s = PromoGateState.fromJson(<String, Object?>{
        'shown_count': 2,
        'last_shown_at': 'nonsense',
      });
      expect(s.shownCount, 2);
      expect(s.lastShownAt, isNull);
      expect(decide(s).verdict, PromoGateVerdict.shownTooRecently);
    });

    test('toJson omits a null date rather than writing a null', () {
      expect(
        const PromoGateState().toJson().containsKey('last_shown_at'),
        isFalse,
        reason: 'a written null would be read back by _latch-style code as a '
            'present key; the absent/present distinction is load-bearing here',
      );
    });
  });

  group('PromoGate — no clock lives inside it', () {
    // The whole point of the split. Every branch above is decided against a
    // `now` this file chose; here that is pinned explicitly by deciding the
    // SAME state against two clocks a century apart and getting the answer each
    // one implies. A gate that read DateTime.now() would fail both halves.
    test('the answer follows the now it is handed, not the real one', () {
      final PromoGateState shownInThePast = PromoGateState(
        shownCount: 1,
        lastShownAt: DateTime.utc(1999, 12, 31),
      );
      expect(
        decide(shownInThePast, at: DateTime.utc(2000, 1, 2)).verdict,
        PromoGateVerdict.shownTooRecently,
      );
      expect(
        decide(shownInThePast, at: DateTime.utc(2000, 1, 8)).verdict,
        PromoGateVerdict.show,
      );
      expect(
        decide(shownInThePast, at: DateTime.utc(2099, 1, 1)).verdict,
        PromoGateVerdict.show,
      );
    });

    test('a custom governor is honoured, so the numbers are not baked in', () {
      const PromoGate strict =
          PromoGate(minDaysBetweenShows: 30, maxShowsEver: 1);
      final PromoGateState onceShown = PromoGateState(
          shownCount: 1, lastShownAt: now.subtract(const Duration(days: 60)));
      expect(
        strict
            .decide(onceShown, now: now, featureEnabled: true, hasContent: true)
            .verdict,
        PromoGateVerdict.shownEnoughTimes,
      );
      expect(
        strict
            .decide(const PromoGateState(),
                now: now, featureEnabled: true, hasContent: true)
            .verdict,
        PromoGateVerdict.show,
      );
    });
  });
}
