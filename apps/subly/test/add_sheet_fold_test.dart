// ─────────────────────────────────────────────────────────────────────────────
// ADD SHEET — SUBMIT CTA REACHABILITY AT 360×640
//
// At the one viewport the store lane photographs, the add sheet's submit button
// is IN THE TREE but BELOW THE FOLD: `find.byKey` matches and `tap` throws
// nothing, and the tap still never reaches it. Presence is not reachability.
// Measured in `integration_test/store_screenshots_test.dart:528-539`, which runs
// `workflow_dispatch`-only; this file is the same property under `flutter test`.
//
// 🔴 BOTH HALVES OF THE VIEWPORT ARE PINNED ON PURPOSE. `setSurfaceSize` moves
// layout constraints but NOT `MediaQuery`, and this sheet's height cap is
// `MediaQuery…size.height * 0.86` — so surface-only pinning computes a 516 px
// sheet at every window and measures nothing. [_sizeSurface] pins the view too,
// and the `MediaQuery.sizeOf` assertion below is what keeps that half honest.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/core/theme/app_theme.dart';
import 'package:subly/features/add/add_subscription_sheet.dart';
import 'package:subly/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// The window the phone store set is captured at — `--browser-dimension=360x640@3`.
const Size kStorePhone = Size(360, 640);

/// Pins the surface AND the view — see the header for why one alone is a no-op
/// against this sheet. Shape borrowed from `a11y_semantics_test.dart`'s
/// `sizeSurface`, replicated because that file is not importable as a library.
Future<void> _sizeSurface(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(() async {
    tester.view.resetPhysicalSize();
    await tester.binding.setSurfaceSize(null);
  });
}

/// The sheet is opened by a button, not routed to. Delegates and the app's own
/// theme are load-bearing here for the same reasons `width_add_sheet_test.dart`
/// records against its identical host.
Widget _host() {
  return ProviderScope(
    overrides: defaultWidthOverrides(),
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => showAddSubscriptionSheet(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'add sheet at 360x640: submit is in the tree, off the fold, and reachable '
    'only by scrolling',
    (WidgetTester tester) async {
      await _sizeSurface(tester, kStorePhone);
      await tester.pumpWidget(_host());
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      final Finder submit = find.byKey(E2EKeys.addSubmit);
      expect(submit, findsOneWidget);

      // 🔴 THE ASSERTION THAT KEEPS THE PIN HONEST. The sheet's cap reads
      // `MediaQuery`, so if a later edit drops `tester.view.physicalSize` this
      // reads 800×600 and goes red HERE, naming the cause, rather than leaving
      // the rows below passing about a window nobody pinned.
      expect(
        MediaQuery.sizeOf(tester.element(submit)),
        kStorePhone,
        reason:
            'the sheet must be laid out against the pinned window, not the '
            'flutter_test 800x600 default',
      );

      expect(
        submit.hitTestable(),
        findsNothing,
        reason:
            'submit sits below the fold at $kStorePhone — a tap aimed at it '
            'lands on nothing, which is why presence is not reachability',
      );

      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();

      expect(
        submit.hitTestable(),
        findsOneWidget,
        reason:
            'submit is inside the scroll view, so scrolling to it must '
            'bring it into the window',
      );
    },
  );
}
