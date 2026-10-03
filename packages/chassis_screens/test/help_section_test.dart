// SETTINGS' HELP SECTION AND HEADINGS — the chassis half of ST-Y3 / ST-Y4
// (audit D8, D12/F53). The app-level proof, on the shipping screen, is
// apps/subscriptiontracker/test/settings_help_section_test.dart.
//
// MUTATION PROOF (run 2026-10-01 on this tree): drop `header: true` from
// `SettingsHeading` and "announced as a header" goes red; drop `if (canRate)`
// and "no Rate row" goes red; make `rate()` return without the SnackBar and
// "a Rate the store did not answer says so" goes red; swap the two subjects
// and "the two mails" goes red.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/help_section.dart';
import 'package:nikatru_core/nikatru_core.dart' show StoreListingOutcome;

import 'support/width_harness.dart';

class _Row extends StatelessWidget {
  const _Row({
    super.key,
    required this.icon,
    required this.label,
    required this.last,
    this.subtitle,
    this.onTap,
  });

  final String icon;
  final String label;
  final bool last;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) =>
      InkWell(onTap: onTap, child: Text(last ? '$label (last)' : label));
}

void main() {
  final List<Uri> mails = <Uri>[];
  int listingOpens = 0;
  int reports = 0;

  Future<void> pump(
    WidgetTester tester, {
    bool canRate = true,
    StoreListingOutcome outcome = StoreListingOutcome.opened,
  }) async {
    mails.clear();
    listingOpens = 0;
    reports = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => helpCard(
              context,
              decoration: const BoxDecoration(),
              row: _Row.new,
              contactPageLabel: 'Help',
              openContactPage: () {},
              contactSupportLabel: 'Contact support',
              supportEmail: 'support@example.com',
              supportSubject: 'App support',
              reportProblemLabel: 'Report a problem',
              onReportProblem: () => reports++,
              openMail: (Uri mail) async => mails.add(mail),
              canRate: canRate,
              rateLabel: 'Rate App',
              openStoreListing: () async {
                listingOpens++;
                return outcome;
              },
              rateUnavailable: 'The store could not be opened.',
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('a heading is announced as a header, in the words as written', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SettingsHeading('Help', paint: 'HELP')),
      ),
    );
    expect(find.text('HELP'), findsOneWidget);
    expect(
      tester.getSemantics(find.byType(SettingsHeading)),
      matchesSemantics(label: 'Help', isHeader: true),
    );
    handle.dispose();
  });

  testWidgets('four rows in order, the last one marked last', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    final List<Key> order = <Key>[
      HelpKeys.contactPage,
      HelpKeys.contactSupport,
      HelpKeys.rate,
      HelpKeys.reportProblem,
    ];
    double y = -1;
    for (final Key k in order) {
      expect(find.byKey(k), findsOneWidget);
      final double top = tester.getTopLeft(find.byKey(k)).dy;
      expect(top, greaterThan(y), reason: '$k is out of order');
      y = top;
    }
    expect(find.text('Report a problem (last)'), findsOneWidget);
  });

  testWidgets('no Rate row where there is no store listing', (
    WidgetTester tester,
  ) async {
    await pump(tester, canRate: false);
    expect(find.byKey(HelpKeys.rate), findsNothing);
    expect(find.text('Report a problem (last)'), findsOneWidget);
  });

  testWidgets(
    'the support mail keeps its subject, and Report a problem opens the sheet, not a mail',
    (WidgetTester tester) async {
      await pump(tester);
      await tester.tap(find.byKey(HelpKeys.contactSupport));
      await tester.tap(find.byKey(HelpKeys.reportProblem));
      await tester.pump();
      expect(mails, <Uri>[supportMailUri('support@example.com', 'App support')]);
      expect(mails.single.scheme, 'mailto');
      expect(mails.single.path, 'support@example.com');
      expect(reports, 1);
    },
  );

  testWidgets('Rate opens the store listing and says nothing when it opened', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    await tester.tap(find.byKey(HelpKeys.rate));
    await tester.pumpAndSettle();
    expect(listingOpens, 1);
    expect(find.text('The store could not be opened.'), findsNothing);
  });

  testWidgets('a Rate the store did not answer says so', (
    WidgetTester tester,
  ) async {
    await pump(tester, outcome: StoreListingOutcome.notConfigured);
    await tester.tap(find.byKey(HelpKeys.rate));
    await tester.pumpAndSettle();
    expect(listingOpens, 1);
    expect(find.text('The store could not be opened.'), findsOneWidget);
  });

  Future<void> fits(WidgetTester tester, Size window) async {
    await pumpChassis(
      tester,
      window,
      Scaffold(
        body: Builder(
          builder: (BuildContext context) => ListView(
            children: <Widget>[
              const SettingsHeading('Help', paint: 'HELP'),
              helpCard(
                context,
                decoration: const BoxDecoration(),
                row: _Row.new,
                contactPageLabel: 'Help',
                openContactPage: () {},
                contactSupportLabel: 'Contact support',
                supportEmail: 'support@example.com',
                supportSubject: 'App support',
                reportProblemLabel: 'Report a problem',
                onReportProblem: () {},
                openMail: (Uri mail) async {},
                canRate: true,
                rateLabel: 'Rate App',
                openStoreListing: () async => StoreListingOutcome.opened,
                rateUnavailable: 'The store could not be opened.',
              ),
            ],
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    for (final Finder f in <Finder>[
      find.byType(SettingsHeading),
      find.byKey(HelpKeys.reportProblem),
    ]) {
      expect(
        tester.getRect(f).right,
        lessThanOrEqualTo(window.width),
        reason: '$f overflows a ${window.width} px window',
      );
    }
  }

  testWidgets(
    'heading and Help card fit at kPhone',
    (WidgetTester tester) => fits(tester, kPhone),
  );
  testWidgets(
    'heading and Help card fit at kTablet',
    (WidgetTester tester) => fits(tester, kTablet),
  );
  testWidgets(
    'heading and Help card fit at kDesktop',
    (WidgetTester tester) => fits(tester, kDesktop),
  );
}
