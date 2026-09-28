// ─────────────────────────────────────────────────────────────────────────────
// data_state_test.dart — the three states are three DIFFERENT screens, at every
// window class, and the two that look alike by default are the two this file
// spends the most assertions telling apart.
//
// 🔴 WHAT THIS SUITE IS ACTUALLY FOR. `DataStateView` exists because five
// surfaces rendered a FAILED fetch as an EMPTY one. A test that only checks
// "the error state shows the error title" passes on that original defect the
// moment somebody re-collapses the branches, because the empty state would show
// its own title too and both assertions are positive. So every case below that
// asserts a state is present ALSO asserts the other two are absent, by key. The
// negative half is the half that can fail.
//
// ⚠️ `pump`, NEVER `pumpAndSettle`. The loading branch is an indeterminate
// `CircularProgressIndicator`, which animates forever: `pumpAndSettle` on that
// tree times out after ten seconds and reports a timeout, which names neither
// the widget nor the cause.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The four window classes, written as `Size` literals because that is what
/// `assert-responsive-coverage.mjs` reads out of a package suite — this package
/// declares no `width_harness.dart` and the guard's own header says so.
const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);
const Size kWide = Size(1920, 1080);

Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: w)));
  await tester.pump();
}

/// Every state key that is NOT [present], asserted absent.
///
/// This is the whole point of the file — see the header. Keyed rather than
/// copy-matched so a translation can never satisfy it.
void expectOnly(Key present) {
  for (final Key k in <Key>[
    DataStateView.loadingKey,
    DataStateView.emptyKey,
    DataStateView.failedKey,
  ]) {
    expect(
      find.byKey(k),
      k == present ? findsOneWidget : findsNothing,
      reason: k == present
          ? 'the state under test did not render at all'
          : 'a second state rendered alongside the one under test — the three '
                'branches are meant to be mutually exclusive, and two of them '
                'on screen at once is how "empty" and "failed" merged in the '
                'first place',
    );
  }
}

void main() {
  group('the three states are mutually exclusive', () {
    testWidgets('loading shows a labelled spinner and nothing else', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const DataStateView.loading(label: 'Loading your subscriptions'),
      );
      expectOnly(DataStateView.loadingKey);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        find.text('Loading your subscriptions'),
        findsOneWidget,
        reason:
            'a spinner with no words is indistinguishable from a stalled '
            'screen, and to a screen reader it is indistinguishable from '
            'nothing at all',
      );
    });

    testWidgets('empty shows its title and offers NO retry', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const DataStateView.empty(
          title: 'No subscriptions yet',
          body: 'Add your first subscription to see it here.',
        ),
      );
      expectOnly(DataStateView.emptyKey);
      expect(find.text('No subscriptions yet'), findsOneWidget);
      expect(
        find.byKey(DataStateView.retryKey),
        findsNothing,
        reason:
            'a retry control on the empty state tells a user their empty '
            'account is a malfunction, and it is the single edit that would '
            'make this state look like the failed one',
      );
      expect(
        find.byType(FilledButton),
        findsNothing,
        reason:
            'not merely the keyed retry — the empty state carries no '
            'action at all, so a differently-keyed button would still be a '
            'regression',
      );
    });

    // ST-U6: the RED CONTROL for the action slot. Before it, an empty state had
    // no way to say "here is the first step" — every stamped app's first run
    // was a message with nothing to tap (audit B3/B42/C3 and §8).
    testWidgets('empty MAY offer a first step — keyed, working, and no retry', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpAt(
        tester,
        kPhone,
        DataStateView.empty(
          title: 'No subscriptions yet',
          actionLabel: 'Add subscription',
          onAction: () => taps++,
        ),
      );
      expectOnly(DataStateView.emptyKey);
      expect(find.byKey(DataStateView.emptyActionKey), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(DataStateView.emptyActionKey),
          matching: find.text('Add subscription'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(DataStateView.retryKey),
        findsNothing,
        reason: 'the first step out of an empty state is not a retry',
      );
      await tester.tap(find.byKey(DataStateView.emptyActionKey));
      await tester.pump();
      expect(
        taps,
        1,
        reason: 'an action that is drawn but not wired is a dead end',
      );
    });

    test(
      'empty refuses a label without an action, and an action without a label',
      () {
        expect(
          () => DataStateView.empty(title: 't', actionLabel: 'Add'),
          throwsAssertionError,
        );
        expect(
          () => DataStateView.empty(title: 't', onAction: () {}),
          throwsAssertionError,
        );
      },
    );

    testWidgets('failed shows its title AND a working retry', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpAt(
        tester,
        kPhone,
        DataStateView.failed(
          title: 'We could not load your subscriptions',
          body: 'Check your connection and try again.',
          retryLabel: 'Retry',
          onRetry: () => taps++,
        ),
      );
      expectOnly(DataStateView.failedKey);
      expect(find.text('We could not load your subscriptions'), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);

      await tester.tap(find.byKey(DataStateView.retryKey));
      await tester.pump();
      expect(
        taps,
        1,
        reason:
            'a retry affordance that is drawn but not wired is a dead end '
            'wearing the costume of a way out',
      );
    });

    testWidgets('empty and failed do not render identically', (
      WidgetTester tester,
    ) async {
      // 🔴 THE ORIGINAL DEFECT, ASSERTED DIRECTLY. The same copy is handed to
      // both states, so nothing about the WORDS can tell them apart — if the
      // two branches ever collapse into one, this is the case that notices.
      const String same = 'Same words on purpose';
      await pumpAt(tester, kPhone, const DataStateView.empty(title: same));
      final bool emptyHasAction = find
          .byKey(DataStateView.retryKey)
          .evaluate()
          .isNotEmpty;
      final Icon emptyIcon = tester.widget<Icon>(find.byType(Icon));

      await pumpAt(
        tester,
        kPhone,
        DataStateView.failed(title: same, retryLabel: 'Retry', onRetry: () {}),
      );
      final bool failedHasAction = find
          .byKey(DataStateView.retryKey)
          .evaluate()
          .isNotEmpty;
      final Icon failedIcon = tester.widget<Icon>(find.byType(Icon));

      expect(emptyHasAction, isFalse);
      expect(failedHasAction, isTrue);
      expect(
        emptyIcon.icon,
        isNot(failedIcon.icon),
        reason:
            'the glyph is the difference a sighted user reads first, and '
            'it must differ even when the copy does not',
      );
      expect(
        emptyIcon.color,
        isNot(failedIcon.color),
        reason:
            'and the tone is the second of the three independent '
            'differences — see the widget doc',
      );
    });
  });

  // ⚠️ THE ACCESSIBILITY SWEEP FOR THIS WIDGET IS NOT IN THIS FILE, AND THAT
  // IS NOT AN OMISSION. It lives in `a11y_data_state_test.dart`, because
  // `assert-a11y-coverage.mjs` reads a corpus of exactly `a11y_*_test.dart` —
  // semantics cases written here run green and are invisible to the accounting,
  // so the surface goes on being reported as unswept while it is swept. Two
  // copies of the same assertions would then drift; there is one copy, and it
  // is in the file the guard reads.

  group('width — the message is capped at the form width, not the window', () {
    for (final Size size in <Size>[kPhone, kTablet, kDesktop, kWide]) {
      testWidgets('at ${size.width.toInt()} the text block never exceeds '
          'AppBreakpoints.form', (WidgetTester tester) async {
        await pumpAt(
          tester,
          size,
          const DataStateView.empty(
            title: 'No subscriptions yet',
            body: 'Add your first subscription to see it here.',
          ),
        );
        final double w = tester
            .getSize(find.byKey(DataStateView.emptyKey))
            .width;
        expect(
          w,
          lessThanOrEqualTo(AppBreakpoints.form),
          reason:
              'without the cap a one-line message on a 1920 px window is a '
              'single sentence stretched edge to edge with nothing beside it',
        );
        if (size.width < AppBreakpoints.form) {
          expect(
            w,
            lessThanOrEqualTo(size.width),
            reason:
                'below the cap a ConstrainedBox may only tighten, so a '
                'phone must render exactly as it would with no cap at all',
          );
        }
      });
    }

    testWidgets('the loading state is capped on the same rule', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kWide,
        const DataStateView.loading(label: 'Loading your subscriptions'),
      );
      expect(
        tester.getSize(find.byKey(DataStateView.loadingKey)).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });
}
