// ─────────────────────────────────────────────────────────────────────────────
// THE Art 21 OBJECTION, DRIVEN THROUGH THE REAL CONTROLS — [research/44 rung 4].
//
// The claim under test is one sentence and it is the whole feature: **an
// objection means ZERO promotional renders.** Everything else here exists so
// that sentence cannot be true for a boring reason.
//
// 🔴 WHY THIS LIVES IN THE TEMPLATE AND NOT ONLY IN CI [pipeline C-16]. "A check
// that runs only on a throwaway stamp stops protecting the moment a real app
// leaves the factory." Every app this factory stamps inherits a promo surface
// and therefore inherits the objection obligation; an app that quietly drops the
// Settings row or wires the card past `PromoObjection` looks exactly like a
// working app until a regulator asks. Born with the assertion, or the assertion
// only ever protected `apps/probe`.
//
// 🔴 THE FALSE-GREEN THIS FILE IS SHAPED AGAINST. "Zero renders" passes
// trivially against a surface that renders nothing anyway — a feature switched
// off, an empty payload, a widget nobody mounts. So every negative case here is
// paired with the SAME tree proving the positive first: the card renders, then
// the objection is made through a real control, then the card is gone. A
// negative that has never been watched go the other way is not evidence.
//
// ⚠️ WHAT IS REAL AND WHAT IS A HARNESS, STATED RATHER THAN IMPLIED.
//   · REAL: `SettingsScreen`, pumped whole, with its row found by the control's
//     own key — not a two-button stand-in. That distinction is why
//     `assert-consent-withdrawal-surface.mjs` had to exist at all.
//   · REAL: the rail, the providers, `PromoObjection`, `PromoGate`,
//     `PromoSurface`, and the path from a tap to a persisted artifact.
//   · A HARNESS: WHERE the promotional card sits. The creative and its home in
//     the home body are research/44 rung 3 and do not exist yet, so `_PromoHost`
//     stands in for the call site. It holds no decision of its own — when rung 3
//     lands, that host is what its real call site must look like.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/core/app_config.dart';
import 'package:{{app_id.snakeCase()}}/features/settings/settings_screen.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

class _MemStore implements core.KeyValueStore {
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

/// Captures what the append-only rail actually shipped.
class _FakeConsentTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];
  final List<String> appIds = <String>[];

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    appIds.add(appId);
    sent.add(artifact);
    return const core.Result<void>.ok(null);
  }
}

/// The creative. A distinctive string, so "did anything promotional render"
/// cannot be answered by some other widget's copy.
const String _creative = 'A promotional payload';

/// The rung-3 call site, standing in until rung 3 exists.
///
/// It holds NO decision: the verdict comes from `PromoObjection.decide` over the
/// real rail, the objected flag from `promoObjectedProvider`, and the objection
/// it raises goes through `recordPromoObjection` — the same function the
/// Settings row calls. `featureEnabled` and `hasContent` are true because this
/// file is about the objection, and a card held back by the feature switch would
/// make every assertion below vacuous.
class _PromoHost extends ConsumerWidget {
  const _PromoHost();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.ConsentController? rail = ref
        .watch(consentControllerProvider)
        .valueOrNull;
    final core.PromoGateDecision? decision = rail == null
        ? null
        : core.PromoObjection(rail).decide(
            const core.PromoGate(),
            const core.PromoGateState(),
            now: DateTime.utc(2026, 8, 10),
            featureEnabled: true,
            hasContent: true,
          );
    return PromoSurface(
      show: decision?.show ?? false,
      objected: ref.watch(promoObjectedProvider),
      onObjectionChanged: (bool objected) =>
          recordPromoObjection(ref, objected: objected),
      child: const Text(_creative),
    );
  }
}

ProviderContainer _container({
  required _MemStore store,
  required _FakeConsentTransport consent,
  core.PrivacySignal signal = const core.NoPrivacySignal(),
}) {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => store),
      consentTransportProvider.overrideWithValue(consent),
      privacySignalProvider.overrideWithValue(signal),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

/// The REAL settings screen. TALL, deliberately: settings is a `ListView`, so a
/// row below the fold has no element and `findsNothing` would pass for a control
/// that exists and is merely off screen — which would make every negative
/// assertion in this file a tautology.
Future<void> _pumpSettings(WidgetTester tester, ProviderContainer c) async {
  await tester.binding.setSurfaceSize(const Size(1200, 4000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpPromo(WidgetTester tester, ProviderContainer c) async {
  // Blank first: pumping a second tree over the first reuses elements, and a
  // stale `PromoSurface` element would make "it disappeared" ambiguous.
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: _PromoHost()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final Finder _card = find.text(_creative);
final Finder _objectionAction = find.byKey(PromoObjectionControl.actionKey);

void main() {
  group('the Settings objection — the surface a store reviewer looks for', () {
    testWidgets('the real screen carries the control, and it ends every render', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _container(store: store, consent: consent);

      // ── the OPEN path first ──────────────────────────────────────────────
      await _pumpPromo(tester, c);
      expect(
        _card,
        findsOneWidget,
        reason:
            'PRECONDITION, and the most important line in this file: an '
            'untouched promo purpose PERMITS, because the surface runs on '
            'legitimate interest rather than consent. If this ever reads '
            'findsNothing, every "zero renders" assertion below has stopped '
            'meaning anything',
      );

      // ── the objection, through the REAL settings row ─────────────────────
      await _pumpSettings(tester, c);
      expect(
        _objectionAction,
        findsOneWidget,
        reason:
            'Art 21 needs a route that outlives the card. A control that lives '
            'only on the promotional surface disappears the moment it is used, '
            'and the person can never change their mind',
      );
      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();

      // ── what was recorded ────────────────────────────────────────────────
      expect(consent.sent, hasLength(1));
      final core.ConsentArtifact a = consent.sent.single;
      expect(a.purpose, 'promo');
      expect(
        a.granted,
        isFalse,
        reason:
            'the rail field means "may this purpose be processed", so an '
            'objection is granted:false. Inverting it once, in a named helper, '
            'is what stops one call site spelling it the other way',
      );
      expect(a.policyVersion, kPrivacyPolicyVersion);
      expect(consent.appIds.single, AppConfig.appId);
      expect(
        a.anonId,
        await c.read(installIdProvider.future),
        reason:
            'the same install id every event and every other artifact carries '
            '— two ids make the objection impossible to join to what it governs',
      );

      // ── ZERO promo renders ───────────────────────────────────────────────
      await _pumpPromo(tester, c);
      expect(
        _card,
        findsNothing,
        reason:
            'Art 21(3): after an objection "the personal data shall no longer '
            'be processed for such purposes." Not fewer, not smaller — none',
      );
      expect(
        find.byKey(PromoSurface.rootKey),
        findsNothing,
        reason:
            'the container goes too. An empty labelled frame is still a '
            'promotional surface on screen',
      );
    });

    testWidgets('🔴 THE ROW CLAIMS NOTHING WHILE THE RAIL IS STILL LOADING, AND A TAP '
        'THERE CANNOT FORGE A DECISION', (WidgetTester tester) async {
      // THE WINDOW EVERY OTHER CASE IN THIS FILE PUMPS PAST.
      // `promoObjectedProvider` answers TRUE while `consentControllerProvider`
      // is unresolved, and that is correct for a promotional CARD — an offer
      // shown against an objection nobody has read is what Art 21(3) forbids.
      // Reused verbatim in a CONTROL it becomes a lie: a person who has never
      // objected is shown "Offers are off" + "Show offers again" on every
      // launch of Settings, and one tap in that window writes AND UPLOADS a
      // `promo granted: true` artifact recording a withdrawal they never made.
      //
      // `pumpAndSettle` hides it, which is why the store here never resolves.
      final Completer<core.KeyValueStore> never =
          Completer<core.KeyValueStore>();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) => never.future),
          consentTransportProvider.overrideWithValue(consent),
        ],
      );
      addTearDown(c.dispose);

      await _pumpSettings(tester, c);
      expect(
        c.read(promoObjectionKnownProvider),
        isFalse,
        reason: 'precondition: this IS the loading window',
      );
      expect(
        c.read(promoObjectedProvider),
        isTrue,
        reason:
            'precondition: and the card-facing read is fail-closed in it '
            '— the two must not be the same answer',
      );

      expect(
        find.text('Offers are off'),
        findsNothing,
        reason:
            'a claim about what this person chose, made before anything '
            'about them has been read',
      );
      expect(find.text('Show offers again'), findsNothing);
      expect(
        _objectionAction,
        findsNothing,
        reason: 'and nothing to tap means nothing to forge',
      );
      expect(
        consent.sent,
        isEmpty,
        reason: 'nothing was uploaded in a window where nothing was decided',
      );
    });

    testWidgets('the objection does NOT touch the analytics decision', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = _container(
        store: store,
        consent: _FakeConsentTransport(),
      );

      await _pumpSettings(tester, c);
      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();

      expect(
        store.data.containsKey('nikatru.consent.analytics'),
        isFalse,
        reason:
            'consent is PER PURPOSE. An objection to offers that also wrote an '
            'analytics decision would be answering a question the user was '
            'never asked',
      );
      expect(c.read(analyticsConsentProvider), core.ConsentStatus.unknown);
    });
  });

  group('the objection is also reachable ON the card (Art 21(4))', () {
    testWidgets('the control inside the surface ends the surface', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _container(store: store, consent: consent);

      await _pumpPromo(tester, c);
      expect(_card, findsOneWidget);
      expect(
        _objectionAction,
        findsOneWidget,
        reason:
            'Art 21(4) wants the right presented clearly and separately AT THE '
            'LATEST at the time of the first communication. A person meeting '
            'their first offer has no reason to open Settings, so the frame '
            'carries the control and there is no constructor argument to '
            'switch it off',
      );

      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();

      expect(
        _card,
        findsNothing,
        reason:
            'objecting from the card must end the card in the SAME session — a '
            'decision that only applies at the next launch is a decision the '
            'user watched fail',
      );
      expect(consent.sent.single.purpose, 'promo');
      expect(consent.sent.single.granted, isFalse);
    });
  });

  group('it survives a relaunch, and it is reversible', () {
    testWidgets('a new container over the same store still shows nothing', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _container(
        store: store,
        consent: _FakeConsentTransport(),
      );
      await _pumpSettings(tester, first);
      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();

      final ProviderContainer next = _container(
        store: store,
        consent: _FakeConsentTransport(),
      );
      await _pumpPromo(tester, next);
      expect(
        _card,
        findsNothing,
        reason:
            'an objection that decays on relaunch restarts the campaign it '
            'ended, which is the one outcome Art 21(3) forbids outright',
      );
    });

    testWidgets('showing offers again restores the surface', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _container(store: store, consent: consent);

      await _pumpSettings(tester, c);
      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();
      await _pumpPromo(tester, c);
      expect(_card, findsNothing, reason: 'precondition: objected');

      await _pumpSettings(tester, c);
      await tester.tap(_objectionAction);
      await tester.pumpAndSettle();

      expect(consent.sent, hasLength(2));
      expect(
        consent.sent.last.granted,
        isTrue,
        reason:
            'append-only: the withdrawal of an objection is a NEW artifact, '
            'never an edit of the old one',
      );
      expect(consent.sent.last.consentId, isNot(consent.sent.first.consentId));

      await _pumpPromo(tester, c);
      expect(
        _card,
        findsOneWidget,
        reason:
            'a stale `suppressed` latch on the persisted gate record would '
            'keep the surface dead forever. The rail is the record, and the '
            'projection runs both ways',
      );
    });
  });

  group('GPC objects on the behalf of the person (Art 21(5))', () {
    testWidgets('a device signal alone means ZERO renders, and writes nothing', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer gpc = _container(
        store: store,
        consent: _FakeConsentTransport(),
        signal: const core.StaticPrivacySignal(optedOut: true),
      );

      await _pumpPromo(tester, gpc);
      expect(
        _card,
        findsNothing,
        reason:
            'Art 21(5) names automated objection signals for exactly this '
            'right, and California treats common ownership as no carve-out for '
            'cross-context behavioural advertising',
      );
      expect(
        store.data,
        isEmpty,
        reason:
            'a signal is the device speaking, not the person deciding about '
            'this app. Recording it would forge a decision that survives the '
            'signal being switched off',
      );
    });

    testWidgets('with the signal off, the same store shows the card', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer quiet = _container(
        store: store,
        consent: _FakeConsentTransport(),
      );
      await _pumpPromo(tester, quiet);
      expect(
        _card,
        findsOneWidget,
        reason:
            'the negative control for the case above: without it, "GPC blocks" '
            'is indistinguishable from "this harness never renders anything"',
      );
    });
  });
}
