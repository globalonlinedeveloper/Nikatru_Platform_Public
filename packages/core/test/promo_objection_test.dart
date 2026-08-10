// ─────────────────────────────────────────────────────────────────────────────
// THE Art 21 OBJECTION, AT THE SEAM — [research/44 rung 4].
//
// `promo_gate_test.dart` proves the gate refuses when `suppressed` is set. That
// leaves the interesting question untouched: WHO SETS IT. This file is about the
// road from the consent rail to that latch, and every case here is one where a
// plausible implementation gets it wrong in a way no gate test could see:
//
//   · a promo purpose read like an analytics purpose ⇒ nobody is ever shown an
//     offer, because `unknown` would block. The surface would look broken and
//     the "fix" would be to delete the check.
//   · the projection applied in ONE direction only ⇒ withdrawing an objection
//     does nothing, forever, and the person has no way to tell us.
//   · the objection read from the gate record instead of the rail ⇒ a GPC
//     signal, which writes no artifact at all, never reaches the gate.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A store whose read FAILS. Not exotic: a mobile key/value store throws on a
/// locked keychain, a revoked entitlement and a full disk, and `hydrate`'s
/// catch-all turns every one of them into `ConsentStatus.unknown`.
class _ThrowingStore implements KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => true;
  @override
  Future<String?> read(String key) async => throw StateError('store is gone');
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> write(String key, String value) async {}
}

/// A store whose bytes survive and do not parse — the interrupted-write shape.
class _UnparseableStore implements KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => true;
  @override
  Future<String?> read(String key) async => '{"purpose":"promo","gran';
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> write(String key, String value) async {}
}

class _MemStore implements KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A controller whose `promo` decision has been recorded as [granted].
Future<ConsentController> _railWith({required bool granted}) async {
  final ConsentController c = ConsentController(store: _MemStore());
  await c.record(
    ConsentPurpose.promo,
    granted: granted,
    policyVersion: '2026-08-01',
    anonId: 'install-1',
    now: DateTime.utc(2026, 8, 10),
  );
  return c;
}

void main() {
  group('the promo purpose is opt-OUT, and analytics stays opt-IN', () {
    test('an untouched promo purpose PERMITS, an untouched analytics does not',
        () async {
      final ConsentController c = ConsentController(store: _MemStore());
      expect(
        c.statusOf(ConsentPurpose.promo),
        ConsentStatus.unknown,
        reason: 'precondition: nobody has touched either control',
      );

      expect(
        c.permits(ConsentPurpose.promo),
        isTrue,
        reason:
            'in-app first-party promotion runs on LEGITIMATE INTEREST (GDPR '
            'Recital 47) and is lawful until objected to. Blocking on unknown '
            'here would be a consent gate in all but name — research/44 V4 is '
            'explicit that adding one is legally unnecessary friction that '
            'wrongly implies the processing becomes unlawful when refused',
      );
      expect(
        c.permits(ConsentPurpose.analytics),
        isFalse,
        reason:
            'and the asymmetry must not leak the other way: unknown analytics '
            'is a refusal, which is the rule the whole consent seam is built on',
      );
    });

    test('a purpose declared without a basis is opt-IN, not opt-out', () {
      const ConsentPurpose invented = ConsentPurpose('something_new');
      expect(
        invented.basis,
        ConsentBasis.consent,
        reason: 'the strict direction is the default so that a purpose added '
            'without thinking about its legal basis blocks rather than permits',
      );
    });

    test('objecting forbids; withdrawing the objection permits again',
        () async {
      final ConsentController objected = await _railWith(granted: false);
      expect(objected.permits(ConsentPurpose.promo), isFalse);
      expect(PromoObjection(objected).objected, isTrue);

      final ConsentController withdrawn = await _railWith(granted: true);
      expect(
        PromoObjection(withdrawn).objected,
        isFalse,
        reason:
            'Art 21 gives a right to object, not a duty to stay objected — a '
            'control that only travels one way is a trap',
      );
    });
  });

  group('the objection is an APPEND-ONLY artifact on the shared rail', () {
    test(
        'it persists as `promo`, survives a relaunch, and carries the policy version',
        () async {
      final _MemStore store = _MemStore();
      final ConsentController first = ConsentController(store: store);
      await first.record(
        ConsentPurpose.promo,
        granted: PromoObjection.grantedForObjection(objected: true),
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 10),
        platform: 'web',
      );

      // The key is purpose-scoped: an objection must not be readable as, or
      // overwrite, the analytics decision.
      expect(store.data.keys, contains('nikatru.consent.promo'));
      final Map<String, Object?> row =
          (jsonDecode(store.data['nikatru.consent.promo']!) as Map)
              .cast<String, Object?>();
      expect(row['purpose'], 'promo');
      expect(row['granted'], isFalse);
      expect(
        row['policy_version'],
        '2026-08-01',
        reason:
            'the artifact must say WHICH notice the person was objecting under '
            '— a record that proves a tap and not a text proves nothing',
      );

      final ConsentController reborn = ConsentController(store: store);
      expect(
        await reborn.hydrate(ConsentPurpose.promo),
        ConsentStatus.denied,
        reason: 'an objection that decays to unknown on the next launch is an '
            'objection that restarts the campaign it ended',
      );
      expect(PromoObjection(reborn).objected, isTrue);
    });

    test('an analytics decision does not move the promo one, or the reverse',
        () async {
      final _MemStore store = _MemStore();
      final ConsentController c = ConsentController(store: store);
      await c.record(
        ConsentPurpose.analytics,
        granted: false,
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 10),
      );
      expect(
        PromoObjection(c).objected,
        isFalse,
        reason:
            'declining analytics is not objecting to offers. Consent is per '
            'purpose — a blanket flag is the error this whole file rejects',
      );

      await c.record(
        ConsentPurpose.promo,
        granted: false,
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 10),
      );
      expect(
        c.statusOf(ConsentPurpose.analytics),
        ConsentStatus.denied,
        reason: 'and the promo write must not disturb the analytics decision',
      );
    });
  });

  group('GPC speaks for the promo purpose too (Art 21(5))', () {
    test(
        'a live signal objects without an artifact, and stops speaking when it stops',
        () async {
      final _MemStore store = _MemStore();
      final ConsentController gpc = ConsentController(
        store: store,
        privacySignal: const StaticPrivacySignal(optedOut: true),
      );
      expect(
        PromoObjection(gpc).objected,
        isTrue,
        reason: 'Art 21(5) names automated objection signals for exactly this '
            'right, and §1798.140(k) makes common ownership no carve-out for '
            'cross-context behavioural advertising',
      );
      expect(
        store.data,
        isEmpty,
        reason:
            'a signal is the DEVICE speaking, not the person deciding about '
            'this app. Writing it as an artifact would forge a decision that '
            'then survives the signal being switched off',
      );

      // Same store, signal off: the person's own (absent) decision is restored.
      final ConsentController quiet = ConsentController(store: store);
      expect(PromoObjection(quiet).objected, isFalse);
    });

    test('the signal is read live — sync-backup is still NOT governed by it',
        () {
      final ConsentController gpc = ConsentController(
        store: _MemStore(),
        privacySignal: const StaticPrivacySignal(optedOut: true),
      );
      expect(
        gpc.optedOutBySignal(ConsentPurpose.syncBackup),
        isFalse,
        reason: 'GPC says nothing about whether a user wants their own data on '
            'their own devices. Widening the promo purpose onto the signal '
            'list must not widen the list itself',
      );
      expect(gpc.optedOutBySignal(ConsentPurpose.promo), isTrue);
    });
  });

  group('the projection onto PromoGateState — BOTH directions', () {
    const PromoGate gate = PromoGate();
    final DateTime now = DateTime.utc(2026, 8, 10);

    test('an objection suppresses a record that knows nothing about it',
        () async {
      final ConsentController rail = await _railWith(granted: false);
      // A record straight off disk: shown once, never dismissed, never
      // suppressed. This is the exact shape a two-store implementation gets.
      const PromoGateState stored = PromoGateState();

      expect(
        gate
            .decide(
              stored,
              now: now,
              featureEnabled: true,
              hasContent: true,
            )
            .verdict,
        PromoGateVerdict.show,
        reason: 'precondition: the gate alone WOULD show this — so the refusal '
            'below is the rail talking, not the counters',
      );

      final PromoGateDecision d = PromoObjection(rail).decide(
        gate,
        stored,
        now: now,
        featureEnabled: true,
        hasContent: true,
      );
      expect(d.verdict, PromoGateVerdict.suppressedByUser);
      expect(d.show, isFalse);
    });

    test('withdrawing the objection clears a stale suppressed latch', () async {
      final ConsentController rail = await _railWith(granted: true);
      // The disk still says suppressed — written while they were objected.
      const PromoGateState stale = PromoGateState(suppressed: true);

      expect(
        gate
            .decide(stale, now: now, featureEnabled: true, hasContent: true)
            .verdict,
        PromoGateVerdict.suppressedByUser,
        reason:
            'precondition: read WITHOUT the rail, the stale latch wins forever '
            '— PromoGateState offers no copyWith for it on purpose',
      );

      expect(
        PromoObjection(rail)
            .decide(
              gate,
              stale,
              now: now,
              featureEnabled: true,
              hasContent: true,
            )
            .verdict,
        PromoGateVerdict.show,
        reason: 'the rail is the record. A one-directional projection leaves a '
            'person who withdrew their objection permanently suppressed by a '
            'value nothing can clear',
      );
    });

    test('🔴 AN UNREADABLE RAIL DOES NOT ERASE A PERSISTED OBJECTION',
        () async {
      // THE DEFECT THIS CASE WAS WRITTEN FOR, MEASURED ON THIS EXACT CODE.
      // `applyTo` used to clear the latch on `!objected`, and `objected` is
      // `!permits`, and `permits` reads `unknown` as permission for a
      // legitimate-interest purpose. `hydrate` returns `unknown` for a store
      // that THREW as readily as for a fresh device — so one failed disk read
      // produced `PromoGateVerdict.show` AND a state-to-persist carrying
      // `suppressed: false`, which the caller is instructed to write back. A
      // transient read failure showed a promotion to somebody who had objected
      // and then destroyed the objection permanently.
      //
      // Two stores, two failure shapes, same answer required.
      for (final KeyValueStore broken in <KeyValueStore>[
        _ThrowingStore(),
        _UnparseableStore(),
      ]) {
        final ConsentController rail = ConsentController(store: broken);
        expect(
          await rail.hydrate(ConsentPurpose.promo),
          ConsentStatus.unknown,
          reason: 'precondition: an unreadable rail is indistinguishable from '
              'an untouched one — that is why the RECORD has to remember',
        );
        expect(
          PromoObjection(rail).objected,
          isFalse,
          reason: 'precondition: "may we process now" is still yes — the basis '
              'is lawful until objected to, and this getter is unchanged',
        );

        const PromoGateState stored = PromoGateState(suppressed: true);
        expect(
          PromoObjection(rail).applyTo(stored).suppressed,
          isTrue,
          reason:
              'the latch is cleared by an explicit withdrawal, never by the '
              'mere absence of a denial (${broken.runtimeType})',
        );
        final PromoGateDecision d = PromoObjection(rail).decide(
          gate,
          stored,
          now: now,
          featureEnabled: true,
          hasContent: true,
        );
        expect(d.verdict, PromoGateVerdict.suppressedByUser);
        expect(
          d.state.suppressed,
          isTrue,
          reason: 'and the record the caller is told to PERSIST carries the '
              'objection forward — the fail-open was written back to disk',
        );
      }
    });

    test('an unread rail cannot invent an objection either', () async {
      // The other direction of the same asymmetry, so the fix is not a latch
      // that only ever grows. A record with no objection in it stays clean.
      final ConsentController rail = ConsentController(store: _ThrowingStore());
      await rail.hydrate(ConsentPurpose.promo);
      const PromoGateState clean = PromoGateState();
      expect(PromoObjection(rail).applyTo(clean).suppressed, isFalse);
      expect(
        PromoObjection(rail)
            .decide(gate, clean,
                now: now, featureEnabled: true, hasContent: true)
            .verdict,
        PromoGateVerdict.show,
      );
    });

    test('a HOLD is identical() to the state passed in, through the rail too',
        () async {
      // `PromoGateDecision.state` promises a hold is `identical` to the input so
      // a caller may skip the write — which matters on a home body that
      // rebuilds constantly, and matters more because `PromoGateState` defines
      // no `==` for callers to fall back on. The promise was tested only on the
      // DIRECT path; through `PromoObjection` — the path callers are TOLD to
      // use — `applyTo` allocated unconditionally and broke it on every rebuild.
      final ConsentController rail = await _railWith(granted: true);
      const PromoGateState before = PromoGateState(
        shownCount: 9,
        dismissed: true,
      );
      const PromoGate capped = PromoGate(maxShowsEver: 3);
      expect(
        identical(
          capped
              .decide(before, now: now, featureEnabled: true, hasContent: true)
              .state,
          before,
        ),
        isTrue,
        reason: 'precondition: the direct path keeps the promise',
      );
      expect(
        identical(
          PromoObjection(rail)
              .decide(
                capped,
                before,
                now: now,
                featureEnabled: true,
                hasContent: true,
              )
              .state,
          before,
        ),
        isTrue,
        reason: 'and so must the only sanctioned one',
      );
    });

    test('the projection never touches the DISMISSED latch', () async {
      final ConsentController rail = await _railWith(granted: true);
      const PromoGateState dismissed = PromoGateState(dismissed: true);
      expect(
        PromoObjection(rail).applyTo(dismissed).dismissed,
        isTrue,
        reason: 'withdrawing an objection re-enables the surface; it does not '
            'un-answer a card the person already closed',
      );
      expect(
        PromoObjection(rail)
            .decide(
              gate,
              dismissed,
              now: now,
              featureEnabled: true,
              hasContent: true,
            )
            .verdict,
        PromoGateVerdict.dismissedByUser,
      );
    });

    test('the feature switch still outranks everything, objection or not',
        () async {
      final ConsentController rail = await _railWith(granted: true);
      expect(
        PromoObjection(rail)
            .decide(
              gate,
              const PromoGateState(),
              now: now,
              featureEnabled: false,
              hasContent: true,
            )
            .verdict,
        PromoGateVerdict.featureOff,
        reason:
            'absent ⇒ off is the operator emergency stop, and projecting the '
            'rail must not have moved the order of the checks',
      );
    });

    test('grantedForObjection is the ONE place the inversion happens', () {
      expect(PromoObjection.grantedForObjection(objected: true), isFalse);
      expect(PromoObjection.grantedForObjection(objected: false), isTrue);
    });
  });
}
