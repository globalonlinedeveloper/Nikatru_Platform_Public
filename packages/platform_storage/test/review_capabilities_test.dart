// [pipeline C-7] / [pipeline C-13] The store-review matrix, and the adapter that
// consults it BEFORE touching the plugin.
//
// 🔴 WHY THE GATING IS THE POINT. `in_app_review` has no Linux and no web
// implementation, so calling it there throws MissingPluginException — a crash,
// at the exact moment the app was trying to be pleasant. A fake plugin that
// records its calls is what turns "we check the matrix first" from a claim in a
// comment into something a test can fail.
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_review/in_app_review.dart' as iar;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

/// Records what reached the plugin. NOT a mock of the store — the assertion is
/// "the adapter did or did not call through", which is the only thing a test can
/// honestly know here: neither store reports whether a prompt was drawn.
class _RecordingPlugin implements iar.InAppReview {
  int availableCalls = 0;
  int requestCalls = 0;
  int listingCalls = 0;
  bool available = true;
  bool throwOnEverything = false;

  @override
  Future<bool> isAvailable() async {
    availableCalls++;
    if (throwOnEverything) throw Exception('no plugin on this platform');
    return available;
  }

  @override
  Future<void> requestReview() async {
    requestCalls++;
    if (throwOnEverything) throw Exception('no plugin on this platform');
  }

  @override
  Future<void> openStoreListing({
    String? appStoreId,
    String? microsoftStoreId,
  }) async {
    listingCalls++;
    if (throwOnEverything) throw Exception('no plugin on this platform');
  }
}

ReviewCapabilities _caps(TargetPlatform p, {bool isWeb = false}) =>
    ReviewCapabilities.forPlatform(p, isWeb: isWeb);

void main() {
  group('ReviewCapabilities — all six platforms plus web', () {
    test('the inline prompt exists on Android, iOS and macOS', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
      ]) {
        expect(_caps(p).canPrompt, isTrue, reason: '$p should prompt');
        expect(_caps(p).canOpenStoreListing, isTrue);
      }
    });

    // 🔴 THE ROW THAT EXISTS TO BE ASYMMETRIC. Collapsing these two booleans
    // into one is how a Windows build silently loses its only route to the
    // store — the plugin implements openStoreListing() there and nothing else.
    test('Windows can open a listing but cannot prompt', () {
      final ReviewCapabilities w = _caps(TargetPlatform.windows);
      expect(w.canPrompt, isFalse);
      expect(w.canOpenStoreListing, isTrue);
      expect(w.note, isNotEmpty);
    });

    test('Linux, Fuchsia and web can do neither', () {
      for (final ReviewCapabilities c in <ReviewCapabilities>[
        _caps(TargetPlatform.linux),
        _caps(TargetPlatform.fuchsia),
        _caps(TargetPlatform.android, isWeb: true),
      ]) {
        expect(c.canPrompt, isFalse);
        expect(c.canOpenStoreListing, isFalse);
        expect(c.note, isNotEmpty, reason: 'a bare "no" teaches nobody why');
      }
    });

    // Web must win over the host platform: a web build reports a host
    // TargetPlatform and has no plugin behind it.
    test('web takes precedence over the host platform', () {
      expect(_caps(TargetPlatform.android, isWeb: true).canPrompt, isFalse);
      expect(_caps(TargetPlatform.iOS, isWeb: true).canPrompt, isFalse);
    });

    test('every platform that degrades explains why', () {
      for (final TargetPlatform p in TargetPlatform.values) {
        final ReviewCapabilities c = _caps(p);
        if (!c.canPrompt) {
          expect(
            c.note,
            isNotEmpty,
            reason: '$p cannot prompt and does not say why',
          );
        }
      }
    });
  });

  group('InAppReviewPrompter — the matrix is consulted BEFORE the plugin', () {
    test('on Linux the plugin is never touched at all', () async {
      final _RecordingPlugin plugin = _RecordingPlugin();
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.linux),
      );

      expect(await p.isAvailable(), isFalse);
      await p.requestReview();
      await p.openStoreListing();

      expect(
        <int>[plugin.availableCalls, plugin.requestCalls, plugin.listingCalls],
        <int>[0, 0, 0],
        reason:
            'in_app_review has no Linux implementation, so reaching it throws '
            'MissingPluginException — a crash while trying to be pleasant',
      );
    });

    test('on web the plugin is never touched either', () async {
      final _RecordingPlugin plugin = _RecordingPlugin();
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.android, isWeb: true),
      );
      expect(await p.isAvailable(), isFalse);
      await p.requestReview();
      expect(plugin.requestCalls, 0);
    });

    // Windows: prompting is refused, but the listing MUST still go through.
    test('Windows refuses the prompt and still opens the listing', () async {
      final _RecordingPlugin plugin = _RecordingPlugin();
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.windows),
      );

      await p.requestReview();
      expect(plugin.requestCalls, 0, reason: 'Windows has no inline prompt');

      await p.openStoreListing();
      expect(
        plugin.listingCalls,
        1,
        reason:
            'the listing is the ONLY route to the store on Windows; refusing '
            'it too would be the asymmetry collapsing',
      );
    });

    // 🔴 THE OPEN PATH. [pipeline C-6]: everything above asserts a refusal, and
    // refusing is the correct behaviour on those platforms — so on their own
    // they would all pass against an adapter that does nothing anywhere.
    test('on Android the request really reaches the plugin', () async {
      final _RecordingPlugin plugin = _RecordingPlugin();
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.android),
      );

      expect(await p.isAvailable(), isTrue);
      expect(plugin.availableCalls, 1);

      await p.requestReview();
      expect(
        plugin.requestCalls,
        1,
        reason:
            'if this never passes, the adapter refuses everywhere and no test '
            'goes red — the exact shape C-6 exists to catch',
      );
    });

    // The device half. A build-time matrix cannot know whether THIS handset has
    // the Play Store on it.
    test('a device with no store reports unavailable on Android', () async {
      final _RecordingPlugin plugin = _RecordingPlugin()..available = false;
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.android),
      );
      expect(
        await p.isAvailable(),
        isFalse,
        reason:
            'the matrix says the platform CAN; only the device can say whether '
            'a store is actually installed',
      );
    });

    test('a throwing plugin reads as unavailable and never escapes', () async {
      final _RecordingPlugin plugin = _RecordingPlugin()
        ..throwOnEverything = true;
      final InAppReviewPrompter p = InAppReviewPrompter(
        plugin: plugin,
        capabilities: _caps(TargetPlatform.android),
      );
      expect(await p.isAvailable(), isFalse);
      // Nothing here may throw: a failed pleasantry must never surface as an
      // error the user sees.
      await expectLater(p.requestReview(), completes);
      await expectLater(p.openStoreListing(), completes);
    });
  });
}
