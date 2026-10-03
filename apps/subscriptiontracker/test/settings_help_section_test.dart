// SETTINGS HEADINGS, ONE HELP SECTION AND THE FOOTER YEAR — ST-Y3 / ST-Y4
// (audit D8, D12, F53, D14).
//
//  * D8  — every group on Settings is a HEADER node a screen reader can jump
//          between, the three cards that had no heading at all included.
//  * D12/F53 — the contact page and the support mail sat in two different
//          cards, and there was no Rate and no Feedback row. Now one Help
//          section holds all four, the support mail exactly once.
//  * D14 — "© 2026" was a literal in both arb files; the year is the clock's.
//
// MUTATION PROOF (run 2026-09-30 on this tree): drop `header: true` from the
// chassis `SettingsHeading` and "every group is a header node" goes red; take the
// Contact-support row out of Help, or hide the Rate row, and "Help holds…"
// goes red; pass a literal '2026' as the footer's year and "a 2027 clock
// renders © 2027" goes red.

import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/help_section.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show kSupportedLocaleCodes;
import 'package:nikatru_feedback/nikatru_feedback.dart'
    show FeedbackKeys, FeedbackStrings, ReportProblemPage;
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// Tall enough that the ListView builds every row: a lazily built list would
/// make "not found" mean "not scrolled to" rather than "not there".
const Size kWholeScreen = Size(720, 6000);

final AppLocalizations en = lookupAppLocalizations(const Locale('en'));

class _Prompter implements core.ReviewPrompter {
  _Prompter(this.outcome);
  final core.StoreListingOutcome outcome;
  int listingOpens = 0;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<void> requestReview() async {}

  @override
  Future<core.StoreListingOutcome> openStoreListing() async {
    listingOpens++;
    return outcome;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  List<Override> overrides = const <Override>[],
}) async {
  await pumpAt(
    tester,
    kWholeScreen,
    const SettingsScreen(),
    overrides: overrides,
  );
  await tester.pumpAndSettle();
}

/// Every semantics node flagged as a heading, by label, in tree order.
List<String> _headers(WidgetTester tester) {
  final List<String> out = <String>[];
  void visit(SemanticsNode n) {
    final SemanticsData d = n.getSemanticsData();
    if (d.flagsCollection.isHeader) out.add(d.label);
    n.visitChildren((SemanticsNode c) {
      visit(c);
      return true;
    });
  }

  // Through the ROOT pipeline owner and its children, as
  // `a11y_semantics_test.dart` walks it: the binding's own `pipelineOwner` is
  // deprecated, and correct for one view only.
  void collect(PipelineOwner owner) {
    final SemanticsNode? root = owner.semanticsOwner?.rootSemanticsNode;
    if (root != null) visit(root);
    owner.visitChildren(collect);
  }

  collect(tester.binding.rootPipelineOwner);
  expect(out, isNotEmpty, reason: 'COVERAGE LOST — no semantics tree at all');
  return out;
}

void main() {
  group('D8 · every group on Settings is a heading', () {
    testWidgets('every section label is a header node, in reading order', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle h = tester.ensureSemantics();
      await _pump(tester);
      final List<String> headers = _headers(tester);
      // The groups a signed-out screen draws (the Plan group needs a session).
      final List<String> expected = <String>[
        en.appearance,
        en.language,
        en.currency,
        en.preferences,
        en.privacy,
        en.promotionalOffers,
        // The three cards that had NO heading at all before ST-Y3.
        en.settingsAccountSection,
        en.settingsHelpSection,
        en.legal,
        en.settingsAboutSection,
      ];
      expect(
        headers.where(expected.contains).toList(),
        expected,
        reason:
            'each group heading must be its own header node, heard in the '
            'order it is drawn — a styled Text is invisible to heading '
            'navigation. Found headers: $headers',
      );
      h.dispose();
    });

    testWidgets('a heading is read as written, not as upper-case letters', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle h = tester.ensureSemantics();
      await _pump(tester);
      expect(find.text(en.legal.toUpperCase()), findsOneWidget);
      expect(
        _headers(tester),
        isNot(contains(en.legal.toUpperCase())),
        reason:
            'the upper-casing is paint; "LEGAL" handed to a reader is '
            'spelled out letter by letter on some of them',
      );
      h.dispose();
    });
  });

  group('D12/F53 · one Help section', () {
    testWidgets('Help holds the contact page, the support mail, Rate and '
        'Report a problem — and the support mail appears once', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      final Finder help = find.text(en.settingsHelpSection.toUpperCase());
      final Finder legal = find.text(en.legal.toUpperCase());
      expect(help, findsOneWidget);
      expect(legal, findsOneWidget);
      final double helpY = tester.getTopLeft(help).dy;
      final double legalY = tester.getTopLeft(legal).dy;

      for (final Finder row in <Finder>[
        find.text(en.helpAndSupport),
        find.byKey(HelpKeys.contactSupport),
        find.byKey(HelpKeys.rate),
        find.byKey(HelpKeys.reportProblem),
      ]) {
        expect(row, findsOneWidget);
        final double y = tester.getTopLeft(row).dy;
        expect(
          y > helpY && y < legalY,
          isTrue,
          reason:
              '$row must sit under the Help heading and above Legal, i.e. '
              'in the ONE Help section (y=$y, help=$helpY, legal=$legalY)',
        );
      }
      expect(
        find.text(en.contactSupport),
        findsOneWidget,
        reason: 'the mailto moved to Help; a second copy in Legal is the split',
      );
      expect(find.text(en.rateApp(AppConfig.appName)), findsOneWidget);
      expect(find.text('Report a problem'), findsOneWidget);
    });

    testWidgets('no Rate row where there is no store listing (web, Linux)', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        overrides: <Override>[
          storeListingAvailableProvider.overrideWithValue(false),
        ],
      );
      expect(find.byKey(HelpKeys.rate), findsNothing);
      expect(
        find.byKey(HelpKeys.reportProblem),
        findsOneWidget,
        reason: 'Report a problem needs no store listing: it works everywhere',
      );
    });

    testWidgets(
      'Report a problem opens packages/feedback\'s page, not a mail',
      (WidgetTester tester) async {
        await _pump(tester);
        await tester.ensureVisible(find.byKey(HelpKeys.reportProblem));
        await tester.tap(find.byKey(HelpKeys.reportProblem));
        await tester.pumpAndSettle();
        expect(find.byType(ReportProblemPage), findsOneWidget);
        expect(find.byKey(FeedbackKeys.send), findsOneWidget);
      },
    );

    testWidgets('Rate opens the store listing', (WidgetTester tester) async {
      final _Prompter prompter = _Prompter(core.StoreListingOutcome.opened);
      await _pump(
        tester,
        overrides: <Override>[
          reviewPrompterProvider.overrideWithValue(prompter),
        ],
      );
      await tester.tap(find.byKey(HelpKeys.rate));
      await tester.pumpAndSettle();
      expect(prompter.listingOpens, 1);
      expect(find.text(en.rateAppUnavailable), findsNothing);
    });

    testWidgets('a Rate the store did not answer says so', (
      WidgetTester tester,
    ) async {
      final _Prompter prompter = _Prompter(
        core.StoreListingOutcome.notConfigured,
      );
      await _pump(
        tester,
        overrides: <Override>[
          reviewPrompterProvider.overrideWithValue(prompter),
        ],
      );
      await tester.tap(find.byKey(HelpKeys.rate));
      await tester.pumpAndSettle();
      expect(prompter.listingOpens, 1);
      expect(
        find.text(en.rateAppUnavailable),
        findsOneWidget,
        reason: 'a rate tap that silently did nothing is the defect',
      );
    });

    test(
      'Report a problem is translated: its label is its own package\'s, per locale',
      () {
        expect(
          FeedbackStrings.of(const Locale('ta')).reportProblem,
          isNot(FeedbackStrings.of(const Locale('en')).reportProblem),
        );
      },
    );
  });

  group('D14 · the © year is the clock\'s', () {
    for (final int year in <int>[2026, 2027]) {
      testWidgets('a $year clock renders © $year', (WidgetTester tester) async {
        await _pump(
          tester,
          overrides: <Override>[
            nowProvider.overrideWithValue(() => DateTime(year, 3, 1)),
          ],
        );
        expect(find.textContaining('© $year'), findsOneWidget);
        expect(
          find.textContaining('© ${year == 2026 ? 2027 : 2026}'),
          findsNothing,
        );
      });
    }

    test('neither arb file carries a year literal in the footer', () {
      for (final String locale in kSupportedLocaleCodes) {
        final AppLocalizations l = lookupAppLocalizations(Locale(locale));
        expect(
          l.versionFooter('A', '1', 'C', '1999'),
          contains('© 1999'),
          reason: '$locale: the year must come from the placeholder',
        );
      }
    });
  });
}
