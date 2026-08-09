// ─────────────────────────────────────────────────────────────────────────────
// THE REAL CONSENT PROMPT, DRIVEN BY ITS REAL CONTROLS — and specifically the
// REFUSAL half, which had no widget coverage anywhere in this repository.
//
// 🔴 WHAT WAS ALREADY COVERED AND WHY IT WAS NOT ENOUGH. The prompt the app
// actually mounts is the inline scrim `AnalyticsGate` stacks over the router
// (`lib/app.dart`). One test drove it — `chassis_properties_test.dart`'s "the
// app root asks for consent, and Allow opens the rail" — and it taps ALLOW ONLY.
// The single "No thanks" tap in the tree (`consent_gate_open_path_test.dart`)
// belongs to the RETIRED dialog-shaped `ConsentGate`, a widget the app no longer
// mounts: it can pass forever while the live refusal path is broken.
//
// So every claim below was, until this file, either unasserted or asserted only
// against a widget nobody sees:
//   · a refusal DISMISSES the prompt (a scrim that outlives its answer leaves
//     the app unusable behind a modal that has already been answered);
//   · a refusal is RECORDED and SHIPPED as `granted:false` — a decision, not a
//     silence. DPDP wants the "no" on file as much as the "yes";
//   · it PERSISTS, so the next launch does not re-ask (a prompt that reappears
//     after a no is how a user is worn into a yes);
//   · nothing is collected afterwards, AND the once-per-install `first_launch`
//     marker is not SPENT by a launch that collected nothing;
//   · the ALLOW artifact carries the policy version and platform THROUGH A REAL
//     TAP — those two fields were only ever proven by calling
//     `applyConsentDecision` directly, which is the seam, not the surface.
//
// 🔴 FINDERS ARE THE CONTROLS, NOT THE BODY COPY. The prompt's privacy sentence
// is under an unresolved owner decision (`consentPrivacy` vs the live dialog's
// `consentPrivacyLive`); pinning a test to either would make a copy decision
// break a behavioural lane. The two BUTTONS are stable, and their widget types
// carry the equal-prominence rule the prompt exists to honour.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/app.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/state/providers.dart';

/// In-memory store: `PrefsKeyValueStore` needs a platform channel a widget test
/// has not got, so the seam is overridden rather than the plugin mocked.
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

/// Captures what the analytics rail actually shipped. A refusal's whole claim is
/// that this list stays EMPTY, so only something recording real deliveries can
/// tell "collected nothing" from "collected and discarded the record of it".
class _FakeEventTransport implements core.EventTransport {
  final List<Map<String, Object?>> sent = <Map<String, Object?>>[];

  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    sent.addAll(events);
    return const core.Result<void>.ok(null);
  }
}

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

/// A container with the analytics switch FORCED ON.
///
/// `AppConfig.isBackendLive` is compile-time, so without this override the
/// prompt never mounts and none of the paths below exist to be driven.
ProviderContainer _analyticsContainer({
  required _MemStore store,
  required _FakeEventTransport events,
  required _FakeConsentTransport consent,
}) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    analyticsEnabledProvider.overrideWithValue(true),
    eventTransportProvider.overrideWithValue(events),
    consentTransportProvider.overrideWithValue(consent),
  ],
);

/// No animations and no timers here, but several provider futures resolve in
/// sequence and the decision path is deliberately un-awaited; `pumpAndSettle`
/// would be a lie about why we are waiting, so turn the loop a fixed number of
/// times instead.
Future<void> _turns(WidgetTester tester, [int n = 24]) async {
  for (int i = 0; i < n; i++) {
    await tester.pump();
  }
}

/// The refusal. Located by its CONTROL: `OutlinedButton` beside the allow
/// `FilledButton` is the equal-prominence pairing the prompt is required to
/// keep, so a finder that names it fails if the pair is ever made lopsided.
final Finder _decline = find.widgetWithText(OutlinedButton, 'No thanks');
final Finder _allow = find.widgetWithText(FilledButton, 'Allow');

/// Mount the REAL app root over [c].
///
/// 🔴 THE BLANK PUMP FIRST IS PART OF THE TEST WHEN THIS IS A RELAUNCH. Pumping
/// the app root twice reuses the existing element, so `_AnalyticsGateState`
/// survives with its latch intact and the second run is a rebuild, not a launch.
/// Blanking the tree is what makes the next pump a real process start.
Future<void> _launch(WidgetTester tester, ProviderContainer c) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpWidget(
    UncontrolledProviderScope(container: c, child: const SublyApp()),
  );
  await _turns(tester);
}

void main() {
  group('the real consent prompt — the DECLINE path', () {
    testWidgets('a refusal dismisses the scrim AND ships granted:false', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeEventTransport events = _FakeEventTransport();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: events,
        consent: consent,
      );
      addTearDown(c.dispose);

      await _launch(tester, c);
      expect(
        _allow,
        findsOneWidget,
        reason: 'precondition: the prompt mounted',
      );
      expect(
        _decline,
        findsOneWidget,
        reason: 'a one-sided prompt is a dark pattern, not a choice',
      );

      await tester.tap(_decline);
      await _turns(tester);

      expect(
        _decline,
        findsNothing,
        reason:
            'a scrim that outlives its own answer leaves the app unreachable '
            'behind a modal the user has already dealt with',
      );
      expect(_allow, findsNothing);

      expect(
        consent.sent,
        hasLength(1),
        reason:
            'a refusal is a DECISION and the append-only record has to carry '
            'it — an unrecorded no is indistinguishable from never asking',
      );
      expect(consent.sent.single.granted, isFalse);
      expect(consent.appIds.single, AppConfig.appId);
    });

    testWidgets('the refusal PERSISTS — the next launch does not ask again', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _analyticsContainer(
        store: store,
        events: _FakeEventTransport(),
        consent: _FakeConsentTransport(),
      );
      addTearDown(first.dispose);

      await _launch(tester, first);
      await tester.tap(_decline);
      await _turns(tester);

      // A fresh controller over the same store is what the next process gets.
      final core.ConsentController reborn = core.ConsentController(
        store: store,
      );
      expect(
        await reborn.hydrate(core.ConsentPurpose.analytics),
        core.ConsentStatus.denied,
        reason:
            'denied must survive as DENIED, not decay to unknown — unknown is '
            'the state the prompt reappears on',
      );

      // …and the relaunch for real: a new container over the same store, and a
      // blanked tree so the gate's state is not carried across.
      final ProviderContainer next = _analyticsContainer(
        store: store,
        events: _FakeEventTransport(),
        consent: _FakeConsentTransport(),
      );
      addTearDown(next.dispose);
      await _launch(tester, next);

      expect(
        _decline,
        findsNothing,
        reason:
            're-asking a user who already said no is how a no is worn into a '
            'yes, and it is the behaviour the persisted decision exists to stop',
      );
      expect(_allow, findsNothing);
    });

    testWidgets('after a refusal NOTHING reaches the event transport', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(c.dispose);

      await _launch(tester, c);
      await tester.tap(_decline);
      await _turns(tester);

      // The launch trio is what WOULD have shipped here: the gate calls
      // `logLaunchLifecycle` on the same rebuild that observes the decision, so
      // a gate that keyed off "answered" rather than "granted" would emit on
      // exactly this frame. Driving `log` as well covers the layer below it.
      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();

      expect(
        events.sent,
        isEmpty,
        reason:
            'a refusal that still ships events is not a partial failure, it is '
            'collection without a lawful basis',
      );
      expect(
        store.data[core.kFirstLaunchEmittedKey],
        isNull,
        reason:
            'the marker records EMISSION, not launch. Spending it on a run that '
            'collected nothing costs this install the only first_launch it will '
            'ever have — the denominator every activation ratio is divided by',
      );
    });

    testWidgets('a refusal raises nothing — the unmount races the decision', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: _FakeEventTransport(),
        consent: consent,
      );
      addTearDown(c.dispose);

      await _launch(tester, c);
      await tester.tap(_decline);
      expect(
        tester.takeException(),
        isNull,
        reason: 'the tap handler itself threw',
      );

      await _turns(tester);
      expect(
        tester.takeException(),
        isNull,
        reason:
            '`_answer` is deliberately un-awaited, so the decision path keeps '
            'running AFTER the prompt it was tapped on is unmounted. A `ref` '
            'touched past that point throws in debug and takes the rest of the '
            'decision — the upload and the invalidate — down with it',
      );
      expect(
        consent.sent.single.granted,
        isFalse,
        reason:
            'no exception AND no record is not "safe", it is a silent no-op — '
            'which is the shape of the defect this whole surface exists to fix',
      );
    });
  });

  group('the real consent prompt — what an ALLOW actually records', () {
    testWidgets('a real tap stamps the policy version, platform and anon id', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeEventTransport events = _FakeEventTransport();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: events,
        consent: consent,
      );
      addTearDown(c.dispose);

      await _launch(tester, c);
      await tester.tap(_allow);
      await _turns(tester);

      final core.ConsentArtifact artifact = consent.sent.single;
      expect(artifact.granted, isTrue);
      expect(
        artifact.policyVersion,
        kPrivacyPolicyVersion,
        reason:
            'without it the record proves a button was tapped, not what the '
            'user was shown — and the tap is the only path a real user takes',
      );
      expect(
        artifact.platform,
        isIn(const <String>[
          'web',
          'android',
          'ios',
          'macos',
          'windows',
          'linux',
        ]),
        reason:
            'the field falls back to "unknown" when the platform probe throws, '
            'and an artifact that cannot say where the consent was given is a '
            'weaker record than one that can',
      );
      expect(artifact.appVersion, AppConfig.appVersion);
      expect(
        artifact.anonId,
        await c.read(installIdProvider.future),
        reason:
            'the artifact must carry the SAME anon id the events carry, or the '
            'consent record cannot be joined to the data it governs',
      );
      expect(artifact.anonId, isNotEmpty);

      // Flushed here for the same reason the chassis property flushes: the
      // recorder arms a delivery deadline on its first event, and a timer still
      // pending when the tree is disposed fails the test body outright.
      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.flush();
      expect(
        events.sent.map((Map<String, Object?> e) => e['event']),
        contains('app_open'),
        reason: 'the tap that opens the rail must actually open it',
      );
    });
  });
}
