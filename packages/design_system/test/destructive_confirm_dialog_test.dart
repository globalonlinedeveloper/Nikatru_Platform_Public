import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// ⚠️ IMPORTED BY SOURCE PATH, NOT THROUGH `nikatru_design_system.dart`. The
// barrel is owned elsewhere in this change and does not export these two
// widgets yet; a test that imports the barrel would fail for a reason that has
// nothing to do with the behaviour it measures. Same package, so this is not the
// `implementation_imports` case (that lint is about ANOTHER package's src).
import 'package:nikatru_design_system/src/widgets/destructive_confirm_dialog.dart';

/// THE DIALOG THAT TOLD PEOPLE A FALSEHOOD ABOUT THEIR OWN ACCOUNT.
///
/// Measured in the app brick on 2026-09-04, before this widget existed
/// (`tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/
/// settings_screen.dart`):
///
///   · `:776` — the destructive button was LIVE on an empty form.
///   · `:638-658` — one `catch` collapsed every failure to `unknown`, whose
///     sentence is "we cannot tell how much of it was removed" — shown even when
///     a mistyped password meant nothing was ever sent.
///   · `:650-657` — the result was a `SnackBar` posted to the `ScaffoldMessenger`
///     the sign-out was tearing down.
///   · `:637` — on SUCCESS nothing was shown at all.
///   · `:581` — `barrierDismissible` defaulted to true, with no `PopScope`.
///
/// The brick's Dart cannot be analyzed or run where it lives (its imports only
/// resolve in a stamped app), so the behaviour that can be proven is proven HERE,
/// on the primitive the stamped screen is built out of. That is also the
/// assertion that survives the screen being rewritten.
void main() {
  const Key kSecret = Key('dcd-secret');
  const Key kConfirm = Key('dcd-confirm');
  const Key kResult = Key('dcd-result');
  const Key kResultTitle = Key('dcd-result-title');

  /// Pumps the dialog inside a real route so `Navigator.pop` and `PopScope` mean
  /// what they mean in the app — a bare `home:` would let a pop assertion pass
  /// against a widget that is not on a route at all.
  Future<void> pump(
    WidgetTester tester, {
    required TextEditingController secret,
    required Future<DestructiveActionReport> Function() onConfirm,
    String cancelLabel = 'Cancel',
    String confirmLabel = 'Delete',
    String acknowledgeLabel = 'Got it',
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                barrierDismissible: false,
                builder: (BuildContext _) => DestructiveConfirmDialog(
                  title: 'Delete account?',
                  body: 'This cannot be undone.',
                  secretHint: 'Confirm your password to continue.',
                  secretLabel: 'Password',
                  secret: secret,
                  cancelLabel: cancelLabel,
                  confirmLabel: confirmLabel,
                  acknowledgeLabel: acknowledgeLabel,
                  onConfirm: onConfirm,
                  secretFieldKey: kSecret,
                  confirmKey: kConfirm,
                  resultKey: kResult,
                  resultTitleKey: kResultTitle,
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  FilledButton confirmButton(WidgetTester tester) =>
      tester.widget<FilledButton>(find.byKey(kConfirm));

  group('the destructive control is inert until the form is filled', () {
    testWidgets(
        'an EMPTY form leaves the button disabled, and tapping it runs '
        'nothing', (WidgetTester tester) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      int runs = 0;
      await pump(
        tester,
        secret: secret,
        onConfirm: () async {
          runs++;
          return const DestructiveActionReport(
            message: 'gone',
            succeeded: true,
          );
        },
      );

      expect(
        confirmButton(tester).onPressed,
        isNull,
        reason: 'the brick shipped this button live on an empty form '
            '(settings_screen.dart:776) — one stray tap sent an empty password '
            'at the re-authentication, on the one screen where a misfire '
            'destroys an account',
      );
      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();
      expect(runs, 0, reason: 'a disabled control must not reach the action');
      expect(find.byKey(kResult), findsNothing);
    });

    testWidgets('typing arms it, and the action runs', (
      WidgetTester tester,
    ) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      int runs = 0;
      await pump(
        tester,
        secret: secret,
        onConfirm: () async {
          runs++;
          return const DestructiveActionReport(
            message: 'gone',
            succeeded: true,
          );
        },
      );

      await tester.enterText(find.byKey(kSecret), 'hunter2');
      await tester.pump();
      expect(confirmButton(tester).onPressed, isNotNull);

      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();
      expect(runs, 1);
    });

    testWidgets(
        'clearing the field disarms it again — a change no keystroke '
        'caused still counts', (WidgetTester tester) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      await pump(
        tester,
        secret: secret,
        onConfirm: () async =>
            const DestructiveActionReport(message: 'gone', succeeded: true),
      );

      await tester.enterText(find.byKey(kSecret), 'hunter2');
      await tester.pump();
      expect(confirmButton(tester).onPressed, isNotNull);

      // Programmatic, not typed: an `onChanged`-driven implementation would miss
      // this, and so would a paste or an autofill.
      secret.clear();
      await tester.pump();
      expect(confirmButton(tester).onPressed, isNull);
    });
  });

  group('nothing may dismiss it while the request is in flight', () {
    testWidgets(
        'a pop is REFUSED mid-flight and the controls are locked, then '
        'allowed once the outcome is in', (WidgetTester tester) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      final Completer<DestructiveActionReport> gate =
          Completer<DestructiveActionReport>();
      await pump(tester, secret: secret, onConfirm: () => gate.future);

      await tester.enterText(find.byKey(kSecret), 'hunter2');
      await tester.pump();
      await tester.tap(find.byKey(kConfirm));
      // ⚠️ `pump`, NOT `pumpAndSettle`. The busy state runs a
      // CircularProgressIndicator, whose animation never settles — a settle here
      // would time out rather than fail.
      await tester.pump();

      expect(
        confirmButton(tester).onPressed,
        isNull,
        reason: 'a second tap must not send a second deletion',
      );
      expect(
        tester.widget<TextField>(find.byKey(kSecret)).enabled,
        isFalse,
        reason: 'the secret cannot be edited out from under a running request',
      );
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, 'Cancel'))
            .onPressed,
        isNull,
        reason:
            'cancelling mid-flight would leave the user believing they stopped '
            'something that is already running',
      );

      // The real thing a back gesture or an Escape does.
      final BuildContext ctx = tester.element(
        find.byType(DestructiveConfirmDialog),
      );
      await Navigator.maybePop(ctx);
      await tester.pump();
      expect(
        find.byType(DestructiveConfirmDialog),
        findsOneWidget,
        reason:
            'a stray back gesture mid-flight looks exactly like a cancelled '
            'deletion to the person doing it, while the request carries on '
            '(the brick had barrierDismissible defaulting to true at '
            'settings_screen.dart:581 and no PopScope at all)',
      );

      gate.complete(
        const DestructiveActionReport(message: 'gone', succeeded: true),
      );
      await tester.pumpAndSettle();

      final BuildContext after = tester.element(
        find.byType(DestructiveConfirmDialog),
      );
      await Navigator.maybePop(after);
      await tester.pumpAndSettle();
      expect(
        find.byType(DestructiveConfirmDialog),
        findsNothing,
        reason: 'the work is over — leaving must be allowed again',
      );
    });
  });

  group('the outcome is shown, in its own words', () {
    testWidgets('SUCCESS says so — the form is replaced by the report', (
      WidgetTester tester,
    ) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      await pump(
        tester,
        secret: secret,
        onConfirm: () async => const DestructiveActionReport(
          message: 'Your account has been deleted.',
          succeeded: true,
          title: 'Account deleted',
        ),
      );

      await tester.enterText(find.byKey(kSecret), 'hunter2');
      await tester.pump();
      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();

      expect(
        find.byKey(kResult),
        findsOneWidget,
        reason: 'the brick showed NOTHING at all on success '
            '(settings_screen.dart:637) — an irreversible action with no '
            'confirmation leaves the user unable to tell it happened',
      );
      expect(
        tester.widget<Text>(find.byKey(kResult)).data,
        'Your account has been deleted.',
      );
      expect(tester.widget<Text>(find.byKey(kResultTitle)).data,
          'Account deleted');
      expect(
        find.byKey(kSecret),
        findsNothing,
        reason: 'the form phase is over',
      );
    });

    testWidgets(
        'a FAILURE renders the sentence it was handed, not one of its '
        'own', (WidgetTester tester) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      const String reauth =
          'We could not confirm it was you, so nothing was deleted and nothing '
          'was sent. You are still signed in.';
      await pump(
        tester,
        secret: secret,
        onConfirm: () async => const DestructiveActionReport(
          message: reauth,
          succeeded: false,
          footnote: 'Write to support@example.test',
        ),
      );

      await tester.enterText(find.byKey(kSecret), 'wrong');
      await tester.pump();
      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(kResult)).data,
        reauth,
        reason:
            'one message for every failure is the defect [ADR 027] exists for — '
            'a mistyped password must not read like a half-finished deletion',
      );
      expect(find.text('Write to support@example.test'), findsOneWidget);
    });

    testWidgets('NO TITLE renders no heading rather than an English one', (
      WidgetTester tester,
    ) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      await pump(
        tester,
        secret: secret,
        onConfirm: () async => const DestructiveActionReport(
            message: 'nothing was sent', succeeded: false),
      );

      await tester.enterText(find.byKey(kSecret), 'wrong');
      await tester.pump();
      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();

      expect(find.byKey(kResult), findsOneWidget);
      expect(
        find.byKey(kResultTitle),
        findsNothing,
        reason:
            'a caller whose string catalogue has no key for the heading must '
            'not be given a hard-coded English one — it would ship '
            'untranslated in every app the factory stamps',
      );
    });

    testWidgets('acknowledging closes the dialog', (WidgetTester tester) async {
      final TextEditingController secret = TextEditingController();
      addTearDown(secret.dispose);
      await pump(
        tester,
        secret: secret,
        onConfirm: () async =>
            const DestructiveActionReport(message: 'gone', succeeded: true),
      );

      await tester.enterText(find.byKey(kSecret), 'hunter2');
      await tester.pump();
      await tester.tap(find.byKey(kConfirm));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Got it'));
      await tester.pumpAndSettle();
      expect(find.byType(DestructiveConfirmDialog), findsNothing);
    });
  });

  testWidgets(
      'the caller\'s controller OUTLIVES the dialog — this widget never '
      'disposes what it does not own', (WidgetTester tester) async {
    final TextEditingController secret = TextEditingController();
    addTearDown(secret.dispose);
    await pump(
      tester,
      secret: secret,
      onConfirm: () async =>
          const DestructiveActionReport(message: 'gone', succeeded: true),
    );

    await tester.enterText(find.byKey(kSecret), 'hunter2');
    await tester.pump();
    await tester.tap(find.byKey(kConfirm));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Got it'));
    await tester.pumpAndSettle();
    expect(find.byType(DestructiveConfirmDialog), findsNothing);

    // `ChangeNotifier.addListener` asserts against a disposed notifier, so this
    // is the cheapest true statement about the controller still being alive.
    // The caller owns disposal — see the note on `DestructiveConfirmDialog.secret`
    // for why the ownership cannot be the other way round.
    void noop() {}
    expect(() => secret.addListener(noop), returnsNormally);
    secret.removeListener(noop);
  });
}
