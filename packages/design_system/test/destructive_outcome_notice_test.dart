import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// Imported by source path for the reason recorded in
// `destructive_confirm_dialog_test.dart` — the barrel does not export these two
// widgets yet.
import 'package:nikatru_design_system/src/widgets/destructive_confirm_dialog.dart';
import 'package:nikatru_design_system/src/widgets/destructive_outcome_notice.dart';

/// THE SURFACE THE SIGN-OUT REDIRECT CANNOT TAKE AWAY.
///
/// Deleting an account signs the user out, so the router replaces the page stack
/// — and a `SnackBar` or a dialog, both pageless routes on the page being
/// removed, go with it. The brick posted its result to exactly such a messenger
/// (`settings_screen.dart:650-657`); `apps/subly` measured the same thing from
/// the other side and found ZERO widgets with the result key once the redirect
/// settled (`apps/subly/lib/state/providers/auth.dart:568-574`).
///
/// This widget is the half that survives. What it must do is small and exact:
/// render nothing when there is nothing to say, render the sentence it is handed
/// when there is, mark a failure as a failure, keep the developer's cause out of
/// a release build, and give the user a way to clear it so it cannot resurface
/// at some later, unrelated sign-out.
void main() {
  const Key kMessage = Key('don-message');
  const Key kDetail = Key('don-detail');

  Future<void> pump(
    WidgetTester tester, {
    required DestructiveActionReport? report,
    String? detail,
    VoidCallback? onDismiss,
    Brightness brightness = Brightness.light,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: brightness),
        home: Scaffold(
          body: DestructiveOutcomeNotice(
            report: report,
            detail: detail,
            dismissLabel: 'Dismiss',
            onDismiss: onDismiss ?? () {},
            messageKey: kMessage,
            detailKey: kDetail,
          ),
        ),
      ),
    );
  }

  /// The border colour the notice actually painted.
  Color borderColour(WidgetTester tester) {
    final Container box = tester.widget<Container>(
      find
          .descendant(
            of: find.byType(DestructiveOutcomeNotice),
            matching: find.byType(Container),
          )
          .first,
    );
    final BoxDecoration decoration = box.decoration! as BoxDecoration;
    return decoration.border!.top.color;
  }

  testWidgets(
      'NOTHING to say renders nothing, so a host screen can place it '
      'unconditionally', (WidgetTester tester) async {
    await pump(tester, report: null);
    expect(find.byKey(kMessage), findsNothing);
    expect(find.text('Dismiss'), findsNothing);
    expect(find.byType(Container), findsNothing);
  });

  testWidgets('the parked outcome is rendered — heading, sentence and footnote',
      (WidgetTester tester) async {
    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'Your data was deleted, but your sign-in was NOT.',
        succeeded: false,
        title: 'Not deleted',
        footnote: 'Write to support@example.test',
      ),
    );

    expect(
      tester.widget<Text>(find.byKey(kMessage)).data,
      'Your data was deleted, but your sign-in was NOT.',
      reason: 'this is the 502 case — the one state a user cannot discover for '
          'themselves, and the message the old flow destroyed before it could '
          'be read [ADR 027]',
    );
    expect(find.text('Not deleted'), findsOneWidget);
    expect(find.text('Write to support@example.test'), findsOneWidget);
  });

  testWidgets('a FAILURE keeps a danger edge and a success does not', (
    WidgetTester tester,
  ) async {
    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'nothing was sent',
        succeeded: false,
      ),
    );
    final Color failed = borderColour(tester);

    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'your account has been deleted',
        succeeded: true,
      ),
    );
    final Color succeeded = borderColour(tester);

    expect(
      failed,
      isNot(succeeded),
      reason:
          'the notice must not look the same whether the account survived or '
          'not — the colour is the only part of it read at a glance',
    );
  });

  testWidgets(
      'the developer detail is rendered in a debug build, and only '
      'when there is one', (WidgetTester tester) async {
    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'we could not tell',
        succeeded: false,
      ),
      detail: 'AccountDeletionFailure(unknown) [HTTP 404]',
    );
    expect(
      find.byKey(kDetail),
      findsOneWidget,
      reason:
          '"we cannot tell how much was removed" is the same sentence for a '
          '404, a 500 and a client-side throw that never sent a request — which '
          'is exactly how the 2026-08-09 delete leg stayed unexplained across '
          'three sessions',
    );
    expect(
      tester.widget<Text>(find.byKey(kDetail)).data,
      'debug: AccountDeletionFailure(unknown) [HTTP 404]',
    );

    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'we could not tell',
        succeeded: false,
      ),
    );
    expect(find.byKey(kDetail), findsNothing);
  });

  testWidgets('dismissing hands the clear back to the caller', (
    WidgetTester tester,
  ) async {
    int cleared = 0;
    await pump(
      tester,
      report: const DestructiveActionReport(
        message: 'your account has been deleted',
        succeeded: true,
      ),
      onDismiss: () => cleared++,
    );

    await tester.tap(find.text('Dismiss'));
    await tester.pumpAndSettle();
    expect(
      cleared,
      1,
      reason:
          'the outcome is parked above the screen, so nothing else can clear '
          'it — left set, it resurfaces at the next sign-out attached to an '
          'action the user did not take',
    );
  });
}
