import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/l10n/app_localizations.dart';

/// THE CLICKWRAP IS A LEGAL CONTROL, SO ITS THREE ACCESSIBILITY PROPERTIES ARE
/// ASSERTED, NOT ASSUMED — backlog B-4.
///
/// `LegalConsentFields` is the widget that BLOCKS registration. Three separate
/// defects were measured on the app brick's fork of it on 2026-09-04, and
/// `apps/subly` had already fixed all three; nothing pinned any of them here,
/// so a revert of any one would have been silent. Each group below is one
/// defect, and each names what a mutation of the fix does:
///
///   1. THE TICK BOX HAD NO NAME. A bare `Checkbox` contributes a node with a
///      CHECKED state and no label — the clickwrap announced as "not checked,
///      checkbox", the subject never spoken.
///   2. THE LINKS WERE KEYBOARD-DEAD. `Semantics(link: true)` round a
///      `GestureDetector` creates no `FocusNode`, so `Tab` passed over the two
///      documents the user is being asked to accept. SC 2.1.1, Level A.
///   3. 🔴 TAPPING A LINK TICKED THE CONSENT BOX. The toggling detector wrapped
///      the whole column, links included, so a tap in the gutter beside
///      "Privacy" recorded a legal acceptance. That is the worst of the three:
///      an affirmative act attributed to somebody who was reaching for a
///      document.
///
/// ⚠️ THESE ARE PROPERTIES OF THE WIDGET, NOT OF A SCREEN. The suite's
/// `a11y_semantics_test.dart` and `keyboard_traversal_test.dart` sweep real
/// routes and would go green if somebody deleted the control. These cases fail
/// if the clickwrap ever stops being nameable, reachable, or separable from its
/// own links.
void main() {
  /// Whatever the app really handed to `url_launcher`, in order — the platform
  /// channel, not a seam we invented, so a link that opens nothing shows up as
  /// an empty list rather than as a satisfied stub.
  List<String> captureLaunches() {
    const MethodChannel channel = MethodChannel(
      'plugins.flutter.io/url_launcher',
    );
    final List<String> launched = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
          if (call.method == 'launch') {
            launched.add(
              (call.arguments as Map<Object?, Object?>)['url']! as String,
            );
          }
          // `canLaunch` is asked first by `openExternalUrl`; answering false
          // would make every case below pass with the launch never attempted.
          return true;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null),
    );
    return launched;
  }

  /// Mounts the real widget with the real delegates. State lives here, exactly
  /// as it does in the parent screens, so a toggle is observable as a value
  /// rather than as a callback nobody checked.
  Future<_Host> pump(WidgetTester tester, {bool showMarketing = true}) async {
    await tester.binding.setSurfaceSize(const Size(375, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final _Host host = _Host(showMarketing: showMarketing);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: const Color(0xFF6459F5)),
        home: Scaffold(
          body: Padding(padding: const EdgeInsets.all(16), child: host),
        ),
      ),
    );
    await tester.pumpAndSettle();
    tester.binding.focusManager.primaryFocus?.unfocus();
    await tester.pump();
    return host;
  }

  _HostState stateOf(WidgetTester tester) =>
      tester.state<_HostState>(find.byType(_Host));

  Future<AppLocalizations> en() =>
      AppLocalizations.delegate.load(const Locale('en'));

  // ───────────────────────────────────────────────────────────────────────────
  group('1 · the blocking tick box has an accessible name', () {
    testWidgets('the terms box is named by its own sentence', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester);
      final AppLocalizations l10n = await en();

      final SemanticsData d = tester.semantics
          .find(find.byKey(LegalConsentFields.termsCheckbox))
          .getSemanticsData();

      expect(
        d.flagsCollection.isChecked.name,
        'isFalse',
        reason:
            'precondition: this really is the checkbox node, and it arrives '
            'UNTICKED. `none` here would mean the node carries no checked '
            'state at all, i.e. we found the wrong node.',
      );
      expect(
        d.label,
        l10n.legalAcceptTerms,
        reason:
            'THE DEFECT: a bare Checkbox announces "not checked, checkbox" and '
            'nothing else. The sentence beside it is not a substitute — it sits '
            'on a DIFFERENT node, which a reader reaches on a separate swipe '
            'and can just as easily reach afterwards. This is the control that '
            'legally blocks registration.',
      );
      handle.dispose();
    });

    testWidgets('the marketing box is named too, and by its own sentence', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester);
      final AppLocalizations l10n = await en();

      expect(
        tester.semantics
            .find(find.byKey(LegalConsentFields.marketingCheckbox))
            .getSemanticsData()
            .label,
        l10n.legalMarketingOptIn,
        reason:
            'the two boxes have completely different legal characters, so a '
            'reader that hears the same name for both cannot tell the '
            'mandatory one from the optional one.',
      );
      handle.dispose();
    });

    testWidgets('the sentence is spoken ONCE, not by a second nameless node', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester);
      final AppLocalizations l10n = await en();

      expect(
        find.bySemanticsLabel(l10n.legalAcceptTerms),
        findsOneWidget,
        reason:
            'the label detector is a second HIT TARGET for the box, not a '
            'second control, so it is excluded from the tree rather than '
            'annotated. Two nodes claiming one tick leaves a reader with no way '
            'to know they are the same box.',
      );
      handle.dispose();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('2 · the legal links are reachable by keyboard (SC 2.1.1, Level A)', () {
    testWidgets('Tab lands on Terms and on Privacy', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      final AppLocalizations l10n = await en();

      final Set<String> reached = <String>{};
      for (int i = 0; i < 8; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        final BuildContext? c =
            tester.binding.focusManager.primaryFocus?.context;
        if (c == null) continue;
        for (final String word in <String>[
          l10n.linkTermsShort,
          l10n.linkPrivacyShort,
        ]) {
          final bool onIt = find
              .descendant(
                of: find.byWidget(c.widget),
                matching: find.text(word),
              )
              .evaluate()
              .isNotEmpty;
          if (onIt) reached.add(word);
        }
      }

      expect(
        reached,
        <String>{l10n.linkTermsShort, l10n.linkPrivacyShort},
        reason:
            'THE DEFECT: Semantics(link: true) tells a screen reader what the '
            'control IS and creates no FocusNode, so Tab passed straight over '
            'both. A keyboard-only user could not open the documents they were '
            'being asked to agree to, on the one screen where agreeing is the '
            'point.',
      );
    });

    testWidgets('and activating one from the keyboard opens that document', (
      WidgetTester tester,
    ) async {
      final List<String> launched = captureLaunches();
      await pump(tester);
      final AppLocalizations l10n = await en();

      for (int i = 0; i < 8; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        final BuildContext? c =
            tester.binding.focusManager.primaryFocus?.context;
        if (c == null) continue;
        if (find
            .descendant(
              of: find.byWidget(c.widget),
              matching: find.text(l10n.linkTermsShort),
            )
            .evaluate()
            .isNotEmpty) {
          await tester.sendKeyEvent(LogicalKeyboardKey.enter);
          await tester.pumpAndSettle();
          break;
        }
      }

      expect(
        launched,
        <String>[AppConfig.termsUrl],
        reason:
            'reachable AND operable. A focus stop that no key press can '
            'activate is the same failure one step further along.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⚠️ WHICH CASE IN THIS GROUP ACTUALLY CARRIES THE FALSIFICATION, MEASURED.
  // Restoring the pre-fix shape — the toggling `GestureDetector` back around the
  // whole column, links included — reddens the GUTTER case and only that one.
  // The two direct-tap cases stay green even with the defect present, because
  // the link's own recogniser is deeper in the hit-test path and wins the
  // gesture arena outright. So the gutter is not a nicety here: it is the only
  // place the defect is observable, and it is also where a real thumb lands
  // when it misses a 12 px word by a few pixels. The direct-tap cases are kept
  // for the launch assertion they carry, not as the proof.
  group('3 · tapping a link cannot record a legal acceptance', () {
    testWidgets('tapping Terms opens the document and leaves the box UNTICKED', (
      WidgetTester tester,
    ) async {
      final List<String> launched = captureLaunches();
      await pump(tester);
      final AppLocalizations l10n = await en();

      expect(
        stateOf(tester).terms,
        isFalse,
        reason: 'precondition: consent is never pre-ticked',
      );

      await tester.tap(find.text(l10n.linkTermsShort));
      await tester.pumpAndSettle();

      expect(
        launched,
        <String>[AppConfig.termsUrl],
        reason:
            'precondition for the real assertion: the tap has to have LANDED '
            'on the link, or "the box did not move" is vacuous.',
      );
      expect(
        stateOf(tester).terms,
        isFalse,
        reason:
            '🔴 THE DEFECT. The toggling detector used to wrap the whole '
            'column, links included, so a tap on or beside a document link '
            'TICKED THE CONSENT BOX. A legal acceptance recorded by a mis-tap, '
            'on the control that blocks registration.',
      );
    });

    testWidgets('the same for Privacy', (WidgetTester tester) async {
      final List<String> launched = captureLaunches();
      await pump(tester);
      final AppLocalizations l10n = await en();

      await tester.tap(find.text(l10n.linkPrivacyShort));
      await tester.pumpAndSettle();

      expect(launched, <String>[AppConfig.privacyUrl]);
      expect(stateOf(tester).terms, isFalse);
    });

    testWidgets('the gutter BESIDE the links does not toggle either', (
      WidgetTester tester,
    ) async {
      captureLaunches();
      await pump(tester);
      final AppLocalizations l10n = await en();

      // 16 px to the right of the "Privacy" word's trailing edge — inside the
      // Wrap's run spacing, which is exactly where the old opaque detector
      // claimed the hit and turned a miss into an acceptance.
      final Rect r = tester.getRect(find.text(l10n.linkPrivacyShort));
      await tester.tapAt(Offset(r.right + 8, r.center.dy));
      await tester.pumpAndSettle();

      expect(
        stateOf(tester).terms,
        isFalse,
        reason:
            'the links gutter is deliberately inert. It is the strip a person '
            'hits when they miss "Privacy" by a few pixels.',
      );
    });

    testWidgets('THE FALSIFIER — the sentence itself still DOES toggle', (
      WidgetTester tester,
    ) async {
      captureLaunches();
      await pump(tester);
      final AppLocalizations l10n = await en();

      await tester.tap(find.text(l10n.legalAcceptTerms));
      await tester.pumpAndSettle();

      expect(
        stateOf(tester).terms,
        isTrue,
        reason:
            'without this, "tapping does not tick" is satisfied by deleting '
            'the label hit target altogether — which would leave a 20 px '
            'square as the only way to accept the terms, below every '
            "platform's minimum touch size.",
      );
    });

    testWidgets('and the box itself still toggles, independently', (
      WidgetTester tester,
    ) async {
      captureLaunches();
      await pump(tester);

      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      expect(stateOf(tester).terms, isTrue);
      expect(
        stateOf(tester).marketing,
        isFalse,
        reason: 'the optional box is not dragged along by the mandatory one',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4 · THE 18+ ATTESTATION RIDES ON THE BLOCKING CONTROL ([ADR 068])
  //
  // [ADR 068] sets the audience floor at 18 and requires the sign-up clickwrap
  // to carry it. It is only CARRIED if the sentence the tick names says so.
  // A line of prose beside the box is a notice, not an attestation — nobody has
  // to act on it — and a second checkbox would be a second blocking consent
  // that `tooling/ci/assert-signup-consent-shape.mjs` does not know about.
  //
  // ⚠️ BOTH LOCALES, AND THE TAMIL CASE IS THE ONE THAT ROTS. gen-l10n falls
  // back to English for a missing key without failing, so a Tamil reader can be
  // shown an English sentence — or, worse, a Tamil sentence written before the
  // floor existed, which still has the key and still omits the age.
  group('4 · the terms tick carries the 18+ attestation [ADR 068]', () {
    Future<AppLocalizations> ta() =>
        AppLocalizations.delegate.load(const Locale('ta'));

    testWidgets('the sentence a user reads states the 18 floor', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      final AppLocalizations l10n = await en();

      expect(
        l10n.legalAcceptTerms,
        contains('18'),
        reason:
            'the clickwrap sentence is the attestation. Without the age in it, '
            'the tick is an agreement to the Terms and nothing was attested — '
            'and [ADR 068] is a published audience claim, not a preference.',
      );
      expect(
        find.text(l10n.legalAcceptTerms),
        findsOneWidget,
        reason:
            'precondition: the sentence with the attestation is the one the '
            'widget actually renders, not a key nothing reads.',
      );
    });

    testWidgets('the Tamil sentence states it too, and is not English', (
      WidgetTester tester,
    ) async {
      await pump(tester);
      final AppLocalizations enL = await en();
      final AppLocalizations taL = await ta();

      expect(
        taL.legalAcceptTerms,
        contains('18'),
        reason:
            'a Tamil reader shown a sentence without the age has attested to '
            'nothing, and no guard in this repo reads Tamil.',
      );
      expect(
        taL.legalAcceptTerms,
        isNot(enL.legalAcceptTerms),
        reason:
            'gen-l10n falls back to English silently. Byte-equality here is '
            'what "the key is missing" looks like from this side.',
      );
    });

    testWidgets('the attestation is the NAME of the control that blocks', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester);

      final SemanticsData d = tester.semantics
          .find(find.byKey(LegalConsentFields.termsCheckbox))
          .getSemanticsData();

      expect(
        d.flagsCollection.isChecked.name,
        'isFalse',
        reason:
            'precondition: this is the blocking checkbox, unticked',
      );
      expect(
        d.label,
        contains('18'),
        reason:
            'a screen-reader user hears the NAME of the control. If the age '
            'floor is only in prose the label omits, they tick a box whose '
            'subject they were never told — which is the same defect group 1 '
            'exists for, one sentence later.',
      );
      handle.dispose();
    });
  });
}

/// A stateful host, because the flags live in the PARENT by design — the widget
/// has no `initial…` argument and cannot be asked to arrive pre-ticked.
class _Host extends StatefulWidget {
  const _Host({required this.showMarketing});
  final bool showMarketing;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  bool terms = false;
  bool marketing = false;

  @override
  Widget build(BuildContext context) {
    return LegalConsentFields(
      termsAccepted: terms,
      marketingAccepted: marketing,
      showMarketing: widget.showMarketing,
      onTermsChanged: (bool v) => setState(() => terms = v),
      onMarketingChanged: (bool v) => setState(() => marketing = v),
    );
  }
}
