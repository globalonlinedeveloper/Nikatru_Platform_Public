import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/report_content_dialog.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';
import 'package:nikatru_core/nikatru_core.dart';

import 'support/width_harness.dart';

/// `ReportContentDialog` and the Settings tile that opens it —
/// O-PLAY-AI-CONTENT-REPORTING. What is measured here is the SURFACE: the send
/// control is inert until the report names something, the report carries what
/// the person chose, and the second phase says which of "sent" and "not sent"
/// happened. The wire half is api_client's `dio_content_report_transport_test`.
void main() {
  Future<Result<ContentReportReceipt>> accept(ContentReport _) async =>
      const Result<ContentReportReceipt>.ok(ContentReportReceipt(id: 'r-1'));

  // The eighth row is below the fold on a phone, so every pick scrolls first.
  Future<void> pickReason(WidgetTester tester, ContentReportReason r) async {
    final Finder row = find.byKey(ReportContentDialog.reasonKey(r));
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
  }

  FilledButton submit(WidgetTester tester) =>
      tester.widget<FilledButton>(find.byKey(ReportContentDialog.submitButton));

  // One body, three NAMED window classes: assert-responsive-coverage reads the
  // sizes a case pumps statically, and a loop variable is not a size it can see.
  Future<void> settingsFlow(WidgetTester tester, Size size) async {
    ContentReport? sent;
    await pumpChassis(
      tester,
      size,
      ReportContentDialog(
        onSubmit: (ContentReport r) {
          sent = r;
          return accept(r);
        },
      ),
    );
    expect(submit(tester).onPressed, isNull);

    await pickReason(tester, ContentReportReason.hate);
    await tester.pump();
    // A reason alone names nothing: the host would refuse it.
    expect(submit(tester).onPressed, isNull);

    await tester.enterText(
      find.byKey(ReportContentDialog.excerptField),
      'the generated text',
    );
    await tester.enterText(
      find.byKey(ReportContentDialog.noteField),
      'it happened twice',
    );
    await tester.pump();
    expect(submit(tester).onPressed, isNotNull);

    await tester.ensureVisible(find.byKey(ReportContentDialog.submitButton));
    await tester.tap(find.byKey(ReportContentDialog.submitButton));
    await tester.pumpAndSettle();

    expect(sent!.reason, ContentReportReason.hate);
    expect(sent!.contentExcerpt, 'the generated text');
    expect(sent!.note, 'it happened twice');
    expect(sent!.contentRef, isNull);
    expect(
      tester.widget<Text>(find.byKey(ReportContentDialog.resultText)).data,
      'Thanks, your report was sent. We review every report.',
    );
  }

  testWidgets(
      'from Settings (nothing attached) at kPhone: inert until a '
      'reason AND a description, then sends both and says it was sent',
      (WidgetTester tester) => settingsFlow(tester, kPhone));
  testWidgets('the same at kTablet',
      (WidgetTester tester) => settingsFlow(tester, kTablet));
  testWidgets('the same at kDesktop',
      (WidgetTester tester) => settingsFlow(tester, kDesktop));

  testWidgets('from a generated item: the reference is enough, and it is sent',
      (WidgetTester tester) async {
    ContentReport? sent;
    await pumpChassis(
      tester,
      kPhone,
      ReportContentDialog(
        contentRef: 'msg-42',
        onSubmit: (ContentReport r) {
          sent = r;
          return accept(r);
        },
      ),
    );
    await pickReason(tester, ContentReportReason.other);
    await tester.pump();
    expect(submit(tester).onPressed, isNotNull);
    await tester.ensureVisible(find.byKey(ReportContentDialog.submitButton));
    await tester.tap(find.byKey(ReportContentDialog.submitButton));
    await tester.pumpAndSettle();
    expect(sent!.contentRef, 'msg-42');
  });

  testWidgets('a failed send says plainly that it was NOT sent', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      ReportContentDialog(
        contentRef: 'msg-42',
        onSubmit: (ContentReport _) async =>
            const Result<ContentReportReceipt>.err(Failure('429')),
      ),
    );
    await pickReason(tester, ContentReportReason.offensive);
    await tester.pump();
    await tester.ensureVisible(find.byKey(ReportContentDialog.submitButton));
    await tester.tap(find.byKey(ReportContentDialog.submitButton));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Text>(find.byKey(ReportContentDialog.resultText)).data,
      'Your report was not sent. Check your connection and try again later.',
    );
  });

  testWidgets('renders in Tamil with every reason labelled', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      ReportContentDialog(onSubmit: accept),
      locale: const Locale('ta'),
    );
    expect(find.text('புகாரை அனுப்பு'), findsOneWidget);
    for (final ContentReportReason r in ContentReportReason.values) {
      expect(find.byKey(ReportContentDialog.reasonKey(r)), findsOneWidget);
    }
  });

  group('the Settings tile', () {
    Widget settings({VoidCallback? onReportContent}) => SettingsView(
          themeMode: ThemeMode.system,
          onThemeModeChanged: (ThemeMode _) {},
          languageCode: '',
          onLanguageChanged: (String _) {},
          remindersAvailable: true,
          remindersEnabled: false,
          onRemindersChanged: (bool _) {},
          analyticsGranted: false,
          onAnalyticsConsentChanged: (bool _) {},
          promoObjected: false,
          promoObjectionKnown: true,
          onPromoObjectionChanged: (bool _) {},
          hasSession: true,
          planSectionLabel: 'Plan',
          managePlanLabel: 'Manage plan',
          onUpgrade: () {},
          onManagePlan: () {},
          onOpenPrivacyPolicy: () {},
          onOpenTerms: () {},
          onOpenRefundPolicy: () {},
          supportEmail: 'support@example.com',
          onContactSupport: () {},
          onSignOut: () {},
          onDeleteAccount: () {},
          applicationName: 'Probe',
          applicationVersion: '1.2.3',
          onReportContent: onReportContent,
        );

    testWidgets('absent in an app that generates no AI content', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, settings());
      expect(find.byKey(SettingsView.reportContentTile), findsNothing);
    });

    testWidgets('present and wired when the adapter passes the callback', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpChassis(
          tester, kPhone, settings(onReportContent: () => taps++));
      await tester.scrollUntilVisible(
        find.byKey(SettingsView.reportContentTile),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(SettingsView.reportContentTile));
      expect(taps, 1);
    });
  });
}
