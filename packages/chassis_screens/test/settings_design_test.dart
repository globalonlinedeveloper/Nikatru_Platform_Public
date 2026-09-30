import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SemanticsNode;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// Train ST-D4 — Settings on the chassis foundation, and the privacy notice.
///
/// Three things are measured here that `settings_view_test.dart` does not:
///  1. **The design**, photographed per window class × theme — the page is
///     now [SettingsSection]s on [AppCard]s, and a golden is the only check
///     that sees a card, a seam or a heading's tone.
///  2. **Every state the view can be in**, one case each, named for the
///     screen matrix's state column.
///  3. **The privacy-notice row**: drawn only when the adapter has a notice
///     to open, wired to that callback, and placed ABOVE the consent switch it
///     informs rather than among the legal links.
void main() {
  Widget view({
    bool hasSession = true,
    bool remindersAvailable = true,
    bool promoObjectionKnown = true,
    VoidCallback? onOpenPrivacyNotice,
    bool withNotice = true,
  }) => SettingsView(
    profile: hasSession
        ? const SettingsProfile(
            initial: 'S',
            displayName: 'Someone',
            email: 'someone@example.com',
          )
        : null,
    onEditProfile: () {},
    themeMode: ThemeMode.system,
    onThemeModeChanged: (ThemeMode _) {},
    languageCode: '',
    onLanguageChanged: (String _) {},
    remindersAvailable: remindersAvailable,
    remindersEnabled: false,
    onRemindersChanged: (bool _) {},
    analyticsGranted: false,
    onAnalyticsConsentChanged: (bool _) {},
    promoObjected: false,
    promoObjectionKnown: promoObjectionKnown,
    onPromoObjectionChanged: (bool _) {},
    hasSession: hasSession,
    planSectionLabel: 'Plan',
    managePlanLabel: 'Manage plan',
    onUpgrade: () {},
    onManagePlan: () {},
    onOpenPrivacyPolicy: () {},
    onOpenTerms: () {},
    onOpenRefundPolicy: () {},
    onOpenPrivacyNotice: withNotice ? (onOpenPrivacyNotice ?? () {}) : null,
    supportEmail: 'support@example.com',
    onContactSupport: () {},
    onSignOut: () {},
    onSignOutEverywhere: () {},
    onDeleteAccount: () {},
    applicationName: 'Probe',
    applicationVersion: '1.2.3',
  );

  // ── (1) THE DESIGN, PER WINDOW CLASS × THEME ──────────────────────────────
  //
  // The same four photographed sizes as the foundation's own golden, so a
  // repaint here and a repaint there are comparable at a glance.
  group('golden', () {
    const Map<String, Size> classes = <String, Size>{
      'compact': Size(390, 844),
      'medium': Size(700, 1000),
      'expanded': Size(1024, 900),
      'large': Size(1440, 900),
    };

    test('each photographed size is the class it is named for', () {
      expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
      expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
      expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
      expect(windowClassFor(classes['large']!.width), WindowClass.large);
    });

    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('settings · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: buildAppTheme(
                seed: const Color(0xFF6459F5),
                brightness: b,
              ),
              localizationsDelegates:
                  ChassisLocalizations.localizationsDelegates,
              supportedLocales: ChassisLocalizations.supportedLocales,
              home: view(),
            ),
          );
          await tester.pumpAndSettle();
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/settings_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });

  // ── (2) ONE CASE PER STATE ────────────────────────────────────────────────
  //
  // The view fetches nothing — every value arrives resolved from the adapter —
  // so its states are the INPUTS that change what it draws. Named for the
  // matrix's columns; where a column has no counterpart it says so rather
  // than inventing one.
  group('state', () {
    testWidgets('populated — signed in: profile, plan and account groups', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kDesktop, view());
      expect(find.byKey(SettingsView.editProfileTile), findsOneWidget);
      for (final Key k in <Key>[
        SettingsView.upgradeTile,
        SettingsView.managePlanTile,
        SettingsView.signOutTile,
        SettingsView.signOutEverywhereTile,
        SettingsView.deleteAccountTile,
      ]) {
        await tester.scrollUntilVisible(find.byKey(k), 200);
        expect(find.byKey(k), findsOneWidget);
      }
    });

    testWidgets('empty — signed out: no group offers what needs an account', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kDesktop, view(hasSession: false));
      await tester.scrollUntilVisible(find.text('About'), 200);
      for (final Key k in <Key>[
        SettingsView.editProfileTile,
        SettingsView.upgradeTile,
        SettingsView.managePlanTile,
        SettingsView.signOutTile,
        SettingsView.signOutEverywhereTile,
        SettingsView.deleteAccountTile,
      ]) {
        expect(find.byKey(k), findsNothing, reason: '$k');
      }
      // …and the groups that need none are all still there.
      expect(find.byKey(SettingsView.privacyNoticeTile), findsOneWidget);
      expect(find.byKey(SettingsView.privacyPolicyTile), findsOneWidget);
    });

    testWidgets('loading — the objection rail has not answered: no Stop/Resume '
        'control is offered', (WidgetTester tester) async {
      final ChassisLocalizations l10n = await ChassisLocalizations.delegate
          .load(const Locale('en'));
      await pumpChassis(tester, kDesktop, view(promoObjectionKnown: false));
      await tester.scrollUntilVisible(find.text(l10n.promotionalOffers), 200);
      expect(find.text(l10n.promoStopOffers), findsNothing);
      expect(find.text(l10n.promoResumeOffers), findsNothing);
    });

    testWidgets(
      'offline / unavailable — a platform that cannot schedule gets a '
      'disabled sentence, not a switch',
      (WidgetTester tester) async {
        final ChassisLocalizations l10n = await ChassisLocalizations.delegate
            .load(const Locale('en'));
        await pumpChassis(tester, kDesktop, view(remindersAvailable: false));
        await tester.scrollUntilVisible(
          find.text(l10n.remindersUnavailable),
          200,
        );
        final ListTile tile = tester.widget<ListTile>(
          find.ancestor(
            of: find.text(l10n.remindersUnavailable),
            matching: find.byType(ListTile),
          ),
        );
        expect(tile.enabled, isFalse);
        expect(find.text(l10n.remindersEnabled), findsNothing);
      },
    );

    // ERROR has no counterpart in this view, stated rather than faked: it
    // loads nothing, so nothing it draws can fail to load. The failures a
    // Settings page DOES have — a sign-out that could not finish, a profile
    // save that did not land — are reported by the adapter that ran the call
    // (the app's SnackBars, `sign_out_forgets_user_test.dart`).
  });

  // ── (3) THE PRIVACY NOTICE ────────────────────────────────────────────────
  group('privacy notice', () {
    testWidgets('present and wired when the adapter has a notice to open', (
      WidgetTester tester,
    ) async {
      int opened = 0;
      await pumpChassis(
        tester,
        kDesktop,
        view(onOpenPrivacyNotice: () => opened++),
      );
      final Finder row = find.byKey(SettingsView.privacyNoticeTile);
      await tester.scrollUntilVisible(row, 200);
      await tester.ensureVisible(row);
      await tester.pump();
      await tester.tap(row);
      expect(opened, 1);
    });

    testWidgets('absent when it has none — no row that opens "not yet '
        'published"', (WidgetTester tester) async {
      await pumpChassis(tester, kDesktop, view(withNotice: false));
      await tester.scrollUntilVisible(
        find.byKey(SettingsView.analyticsConsentSwitch),
        200,
      );
      expect(find.byKey(SettingsView.privacyNoticeTile), findsNothing);
    });

    testWidgets('it sits in the Privacy group, directly ABOVE the consent '
        'switch it informs, and not among the legal links', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kDesktop, view());
      final Finder notice = find.byKey(SettingsView.privacyNoticeTile);
      final Finder consent = find.byKey(SettingsView.analyticsConsentSwitch);
      await tester.scrollUntilVisible(consent, 200);
      await tester.ensureVisible(consent);
      await tester.pump();
      // One card holds both.
      final Finder card = find.ancestor(
        of: consent,
        matching: find.byType(AppCard),
      );
      expect(
        find.descendant(of: card, matching: notice),
        findsOneWidget,
        reason: 'the notice must share the consent switch\'s card',
      );
      expect(
        tester.getTopLeft(notice).dy,
        lessThan(tester.getTopLeft(consent).dy),
        reason: 'the notice comes first: the facts, then the decision',
      );
      expect(
        find.descendant(
          of: card,
          matching: find.byKey(SettingsView.privacyPolicyTile),
        ),
        findsNothing,
      );
    });
  });

  // ── (4) THE SECTION ITSELF ────────────────────────────────────────────────
  group('SettingsSection', () {
    Future<void> pumpSection(WidgetTester tester, Widget section) =>
        pumpChassis(
          tester,
          kPhone,
          Scaffold(body: ListView(children: <Widget>[section])),
        );

    testWidgets('one seam BETWEEN rows, none after the last', (
      WidgetTester tester,
    ) async {
      await pumpSection(
        tester,
        const SettingsSection(
          title: 'Group',
          children: <Widget>[Text('a'), Text('b'), Text('c')],
        ),
      );
      expect(find.byType(Divider), findsNWidgets(2));
      expect(find.byType(AppCard), findsOneWidget);
    });

    testWidgets('the heading is a header a reader can jump to, and is its own '
        'stop — not merged into the first row', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpSection(
          tester,
          const SettingsSection(
            title: 'Group',
            children: <Widget>[Text('first row')],
          ),
        );
        expect(
          tester.getSemantics(find.text('Group')),
          matchesSemantics(label: 'Group', isHeader: true),
        );
        final List<String> order = tester.semantics
            .simulatedAccessibilityTraversal()
            .map((SemanticsNode n) => n.getSemanticsData().label)
            .where((String l) => l.isNotEmpty)
            .toList();
        expect(order, <String>['Group', 'first row']);
      } finally {
        handle.dispose();
      }
    });

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('at ${size.width.toInt()} the card spans the pane it is '
          'given — the width decision is the page\'s, never the section\'s', (
        WidgetTester tester,
      ) async {
        await pumpChassis(
          tester,
          size,
          Scaffold(
            body: ContentPane(
              child: ListView(
                children: const <Widget>[
                  SettingsSection(
                    title: 'Group',
                    children: <Widget>[Text('a')],
                  ),
                ],
              ),
            ),
          ),
        );
        expect(
          tester.getSize(find.byType(AppCard)).width,
          tester.getSize(find.byType(ListView)).width,
        );
      });
    }

    testWidgets('no rows draws nothing — not an empty card under a heading', (
      WidgetTester tester,
    ) async {
      await pumpSection(
        tester,
        const SettingsSection(title: 'Group', children: <Widget>[]),
      );
      expect(find.text('Group'), findsNothing);
      expect(find.byType(AppCard), findsNothing);
    });

    testWidgets('the footer is drawn under the card', (
      WidgetTester tester,
    ) async {
      await pumpSection(
        tester,
        const SettingsSection(
          title: 'Group',
          footer: 'applies to new rows',
          children: <Widget>[Text('row')],
        ),
      );
      expect(
        tester.getTopLeft(find.text('applies to new rows')).dy,
        greaterThan(tester.getBottomLeft(find.byType(AppCard)).dy),
      );
    });
  });
}
