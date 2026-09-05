// ─────────────────────────────────────────────────────────────────────────────
// THE WITHDRAWAL THAT OUTLIVES ITS OWN SCREEN.
//
// The claim under test is one sentence: **withdrawing consent must finish even
// if the widget that asked for it is gone before the upload comes back.**
//
// Why that is not a hypothetical. `recordAnalyticsConsent` and
// `recordPromoObjection` are handed a [WidgetRef] and then `await` twice — the
// rail from disk, then the artifact upload. Every `ref.read`, `ref.watch` and
// `ref.invalidate` after those awaits begins with `_assertNotDisposed()`, which
// throws `StateError: Cannot use "ref" after the widget was disposed.` — and it
// throws in RELEASE builds, not only under an `assert`. The DPDP §6(3) toggle
// in Settings rebuilds and can pop while the upload is still in the air, and
// its callers do not await the future, so in production the throw surfaces as
// an uncaught error on the consent-withdrawal path.
//
// 🔴 WHY THE CASES BELOW DISPOSE THE WIDGET RATHER THAN DRIVING THE TOGGLE.
// The happy path cannot see this defect: it keeps the widget mounted for the
// whole flow, so the assert never fires and a green run says nothing. The only
// test that measures anything here is one that races disposal against the
// awaits. Each case was watched go RED against the pre-fix file — a `StateError`
// out of the very future the toggle throws away — before it was kept.
//
// 🔴 AND WHY EACH CASE ALSO ASSERTS THE WORK STILL HAPPENED. The one-line
// "fix" for a disposed ref is to skip the tail of the function, and that is a
// worse bug wearing a green suit: `ConsentController.record` mutates the
// controller's own cache, so a container that is never invalidated keeps
// serving the stale decision for the rest of the session. The container
// outlives the widget — "the screen is gone" is not "nobody is watching". So
// every case checks the artifact was shipped and, where it can, that the
// invalidate genuinely replaced the controller object.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
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

/// A consent upload that HANGS until the test lets it go.
///
/// A slow or failing consent POST is all production needs to reproduce the
/// race; here it is made exact so the disposal lands in a known place — after
/// the artifact is recorded, before the invalidate that publishes it.
class _HangingConsentTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];
  final Completer<void> reached = Completer<void>();
  final Completer<void> release = Completer<void>();

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    sent.add(artifact);
    if (!reached.isCompleted) reached.complete();
    await release.future;
    return const core.Result<void>.ok(null);
  }
}

/// A consent upload that returns straight away.
class _FastConsentTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    sent.add(artifact);
    return const core.Result<void>.ok(null);
  }
}

typedef _Withdraw = Future<void> Function(WidgetRef ref);

const Key _withdrawKey = Key('withdraw');

/// The call site, reduced to the one property that matters: it hands its own
/// `ref` to the record function and then throws the future away, exactly as
/// `settings_screen.dart`'s `onChanged` does. The future is parked in [sink] so
/// the test can look at what the app deliberately does not.
class _Host extends ConsumerWidget {
  const _Host({required this.withdraw, required this.sink});

  final _Withdraw withdraw;
  final List<Future<void>> sink;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      home: Scaffold(
        body: TextButton(
          key: _withdrawKey,
          onPressed: () {
            sink.add(withdraw(ref));
          },
          child: const Text('withdraw'),
        ),
      ),
    );
  }
}

/// Whatever the abandoned future threw, or null.
Future<Object?> _errorFrom(Future<void> pending) async {
  try {
    await pending;
    return null;
  } catch (e) {
    return e;
  }
}

void main() {
  group('consent withdrawal survives the screen that started it', () {
    /// Disposal DURING THE UPLOAD. Everything the function reads has already
    /// been read; the only `ref` use left is the invalidate at the end, so this
    /// case isolates it.
    Future<void> raceTheUpload(
      WidgetTester tester, {
      required _Withdraw withdraw,
      required String expectedPurpose,
      required bool expectedGranted,
    }) async {
      final _MemStore store = _MemStore();
      final _HangingConsentTransport transport = _HangingConsentTransport();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          consentTransportProvider.overrideWithValue(transport),
        ],
      );
      addTearDown(c.dispose);

      // Warm the rail and the install id so the only thing still in flight when
      // the widget goes is the upload itself.
      final core.ConsentController before = await c.read(
        consentControllerProvider.future,
      );
      await c.read(installIdProvider.future);

      final List<Future<void>> sink = <Future<void>>[];
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: _Host(withdraw: withdraw, sink: sink),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(_withdrawKey));
      await tester.pump();
      expect(
        transport.reached.isCompleted,
        isTrue,
        reason:
            'PRECONDITION: the upload must actually be in flight. If it is '
            'not, the disposal below races nothing and this case is a '
            'tautology',
      );
      expect(sink, hasLength(1));

      // The screen goes. A rebuild-and-pop off the same toggle looks like this.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();

      transport.release.complete();
      final Object? thrown = await _errorFrom(sink.single);
      // SETTLE, not a single pump: `ProviderContainer.invalidate` posts a
      // zero-duration scheduler task, and a test that ends with it still queued
      // fails on `A Timer is still pending` — a harness complaint that says
      // nothing about the defect and would hide the assertions below it.
      await tester.pumpAndSettle();

      expect(
        thrown,
        isNull,
        reason:
            'the withdrawal path must not throw when its widget is disposed '
            'mid-flight. Against the pre-fix file this is a StateError from '
            'WidgetRef._assertNotDisposed, thrown in release as well as debug, '
            'out of a future nobody awaits',
      );

      // ── and the work still happened ──────────────────────────────────────
      final core.ConsentArtifact a = transport.sent.single;
      expect(a.purpose, expectedPurpose);
      expect(a.granted, expectedGranted);

      final core.ConsentController after = await c.read(
        consentControllerProvider.future,
      );
      expect(
        identical(before, after),
        isFalse,
        reason:
            'the invalidate is load-bearing and must NOT be skipped just '
            'because the widget is gone: record() mutates the controller in '
            'place, so without a fresh controller every watcher keeps the '
            'stale decision for the rest of the session',
      );
      await tester.pumpAndSettle();
    }

    testWidgets(
      'analytics: the DPDP withdrawal completes when the toggle is disposed '
      'mid-upload',
      (WidgetTester tester) async {
        await raceTheUpload(
          tester,
          withdraw: (WidgetRef ref) =>
              recordAnalyticsConsent(ref, granted: false),
          expectedPurpose: 'analytics',
          expectedGranted: false,
        );
      },
    );

    testWidgets(
      'promo: the Art 21 objection completes when the row is disposed '
      'mid-upload',
      (WidgetTester tester) async {
        await raceTheUpload(
          tester,
          withdraw: (WidgetRef ref) =>
              recordPromoObjection(ref, objected: true),
          expectedPurpose: 'promo',
          expectedGranted: false,
        );
      },
    );

    testWidgets(
      'the earlier reads are safe too: disposal while the rail is still being '
      'read from disk',
      (WidgetTester tester) async {
        // A DIFFERENT PLACE IN THE SAME FUNCTION. Here the widget dies during
        // the FIRST await, so the lookups between it and the upload — the
        // transport, the install id, the live recorder — are the ones that have
        // to survive. Hoisting only the invalidate leaves this one red.
        final Completer<core.KeyValueStore> slowDisk =
            Completer<core.KeyValueStore>();
        final _FastConsentTransport transport = _FastConsentTransport();
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) => slowDisk.future),
            consentTransportProvider.overrideWithValue(transport),
          ],
        );
        addTearDown(c.dispose);

        final List<Future<void>> sink = <Future<void>>[];
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: c,
            child: _Host(
              withdraw: (WidgetRef ref) =>
                  recordAnalyticsConsent(ref, granted: false),
              sink: sink,
            ),
          ),
        );
        await tester.pump();

        await tester.tap(find.byKey(_withdrawKey));
        await tester.pump();
        expect(
          transport.sent,
          isEmpty,
          reason:
              'PRECONDITION: nothing may have been recorded yet — the rail is '
              'still unreadable, so the function is parked on its first await',
        );
        expect(sink, hasLength(1));

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();

        slowDisk.complete(_MemStore());
        final Object? thrown = await _errorFrom(sink.single);
        await tester.pumpAndSettle();

        expect(
          thrown,
          isNull,
          reason:
              'every provider lookup after the first await runs in a '
              'continuation that can resume on a disposed widget, so the '
              'transport, the install id and the recorder must be read through '
              'something that outlives it',
        );
        expect(
          transport.sent,
          hasLength(1),
          reason:
              'the decision must still reach the append-only rail. A '
              'withdrawal abandoned because the screen closed is a withdrawal '
              'that never happened',
        );
        expect(transport.sent.single.granted, isFalse);
      },
    );
  });
}
