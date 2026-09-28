// The web build shipped with NO accessibility tree. This file is the proof
// that the function which gives it one works; it has to prove two separate
// things, because the defect needed both to be true at once:
//
//   1. `enableWebSemantics` turns semantics collection ON for the web arm and
//      leaves the other six targets alone.
//   2. the boot path actually calls it.
//
// (1) is proven here. (2) is proven for every app at once by
// `tooling/ci/assert-a11y-primitives.mjs` limb 3 — `bootstrapNikatru` calls
// it before `runGuarded`, and every `lib/main.dart` (the brick's included)
// reaches it — and for the one app not yet on `bootstrapNikatru` by
// `apps/subscriptiontracker/test/web_semantics_test.dart`, which reads that
// app's own entry point and integration harnesses.
//
// ⏱ 2026-09-28 · ST-Y5 (audit D26): moved here from
// `apps/subscriptiontracker/test/`, beside the function it tests, when the
// function moved from that app's `lib/core/a11y/` into this package so every
// stamped app inherits it. The limbs below are unchanged, and each is
// mutation-proven in the header comment above it: it says what edit turns it
// red, so a future reader can check the limb still bites without guessing.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/web_semantics.dart';

void main() {
  // `SemanticsBinding.instance` needs a binding, and the delta assertions below
  // need one that is stable across the group.
  final TestWidgetsFlutterBinding binding =
      TestWidgetsFlutterBinding.ensureInitialized();

  group('enableWebSemantics', () {
    // MUTATION: delete the `if (!isWeb) return null;` line and this goes red —
    // the non-web arm would take a handle and the count would move.
    test('does nothing off web', () {
      final int before = binding.debugOutstandingSemanticsHandles;
      final bool held = enableWebSemantics(isWeb: false, binding: binding);
      expect(
        held,
        isFalse,
        reason:
            'the five desktop/mobile targets get their semantics tree when the '
            'platform asks for it; taking a permanent handle there would keep '
            'the tree compiled on every frame for readers that are not running',
      );
      expect(binding.debugOutstandingSemanticsHandles, before);
    });

    // MUTATION: invert the condition to `if (isWeb) return null;`, or replace
    // the body with `return null;`, and this goes red on both expectations.
    // This is the limb that stands in for the shipped defect: before the fix
    // the whole function did not exist and NOTHING in the tree called
    // `ensureSemantics()` outside a test harness.
    test('takes a semantics handle on web, and semantics become enabled', () {
      final int before = binding.debugOutstandingSemanticsHandles;
      expect(enableWebSemantics(isWeb: true, binding: binding), isTrue);
      expect(
        binding.debugOutstandingSemanticsHandles,
        before + 1,
        reason:
            'exactly one handle — the count is what SemanticsBinding drops to '
            'zero on to stop collecting, so "one more than before" is the '
            'whole mechanism',
      );
      expect(
        binding.semanticsEnabled,
        isTrue,
        reason:
            'the observable consequence: with a handle outstanding the '
            'framework compiles the semantics tree, which on web is what emits '
            'the aria nodes a screen reader reads',
      );
      // Released so the limbs do not depend on execution order and the
      // binding is handed back to the rest of the suite as it was found.
      releaseWebSemantics();
      expect(binding.debugOutstandingSemanticsHandles, before);
    });

    // MUTATION: replace `_heldHandle ??=` with `_heldHandle =` and this goes
    // red at `before + 1` — every boot stacks a handle and the release hands
    // back only the last. MUTATION: drop `_heldHandle = null;` from the release
    // and it goes red at the re-acquire — the next boot is handed the disposed
    // handle and semantics stay off. Run on 2026-09-11, both red.
    test('ONE handle however often main() boots, and a fresh one after a '
        'release', () {
      final int before = binding.debugOutstandingSemanticsHandles;
      // app_test.dart boots `app.main()` three times in one process.
      for (int boot = 0; boot < 3; boot++) {
        expect(enableWebSemantics(isWeb: true, binding: binding), isTrue);
      }
      expect(
        binding.debugOutstandingSemanticsHandles,
        before + 1,
        reason: 'three boots hold one handle, not three',
      );
      releaseWebSemantics();
      expect(binding.debugOutstandingSemanticsHandles, before);

      expect(enableWebSemantics(isWeb: true, binding: binding), isTrue);
      expect(
        binding.debugOutstandingSemanticsHandles,
        before + 1,
        reason:
            'a boot after a release must hold a live handle again — the next '
            'test in a harness boots main() again and needs a real tree',
      );
      releaseWebSemantics();
      expect(binding.debugOutstandingSemanticsHandles, before);
    });
  });

  // 🔴 THE NIGHTLY FAILURE, ON THE FRAMEWORK'S OWN CHECK, IN THE VM.
  //
  // e2e run 34453685391 failed `login rejects empty + invalid credentials` in
  // flutter_test's `_verifySemanticsHandlesWereDisposed`, which runs after a
  // `testWidgets` body returns. This body is `main()`'s semantics step booted
  // the way app_test.dart boots it (three times, web arm forced, because
  // `kIsWeb` is a compile-time false here), then the harness release. There is
  // deliberately NO expectation after the release: the assertion is the
  // framework's, and suppressing it would hide exactly the leak it caught.
  //
  // REPRODUCED 2026-09-11 before the fix: the same boot with the handle
  // discarded, as lib/main.dart did, went red in this runner with
  // "A SemanticsHandle was active at the end of the test." at
  // widget_tester.dart:1074:7 — the frame the nightly reported.
  // MUTATION: make `enableWebSemantics` discard the handle again
  // (`(binding ?? SemanticsBinding.instance).ensureSemantics(); return true;`)
  // and this test goes red with that same message.
  testWidgets('booting main() thrice then releasing leaves no handle active', (
    WidgetTester tester,
  ) async {
    for (int boot = 0; boot < 3; boot++) {
      expect(enableWebSemantics(isWeb: true, binding: tester.binding), isTrue);
    }
    releaseWebSemantics();
  });
}
