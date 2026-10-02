import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/ai/ai_disclosure.dart';

import 'support/width_harness.dart';

/// The AI disclosure and the AI output label — train-st-ai-customer-pays (T17),
/// EU AI Act Art. 50. What is measured:
///   · the disclosure names the processor, says "AI-generated" and "can be
///     wrong" and "nothing is saved until you review it", and is in the
///     SEMANTICS tree (a screen reader reaches it), as a live region;
///   · the caller hears `true` only on the explicit accept — so no call can
///     start before the acknowledgement;
///   · every AI output carries its label as TEXT (never colour-only) and a
///     report action;
///   · the bring-your-own-key path renders the SAME label: it is one widget,
///     with no key-source parameter to vary it.
void main() {
  Future<bool?> openDisclosure(WidgetTester tester, Size size) async {
    bool? result;
    await pumpChassis(
      tester,
      size,
      Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () async {
              result = await AiDisclosureDialog.show(
                context,
                processor: 'Anthropic',
                onOpenPrivacy: () {},
              );
            },
            child: const Text('go'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();
    return result;
  }

  Future<void> disclosureFlow(WidgetTester tester, Size size) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await openDisclosure(tester, size);
    final Finder body = find.textContaining('processed by Anthropic');
    expect(body, findsOneWidget);
    expect(
      find.textContaining('AI-generated and can be wrong'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Nothing is saved until you review it'),
      findsOneWidget,
    );
    // In the semantics tree, inside a live region: announced when it opens.
    expect(
      find.bySemanticsLabel(RegExp('processed by Anthropic')),
      findsOneWidget,
    );
    final Finder live = find.byWidgetPredicate(
      (Widget w) => w is Semantics && (w.properties.liveRegion ?? false),
    );
    expect(find.descendant(of: live, matching: body), findsOneWidget);
    expect(find.byKey(AiDisclosureDialog.privacyLink), findsOneWidget);
    semantics.dispose();
  }

  testWidgets(
    'the disclosure is announced and complete — phone',
    (WidgetTester tester) => disclosureFlow(tester, kPhone),
  );
  testWidgets(
    'the disclosure is announced and complete — tablet',
    (WidgetTester tester) => disclosureFlow(tester, kTablet),
  );
  testWidgets(
    'the disclosure is announced and complete — desktop',
    (WidgetTester tester) => disclosureFlow(tester, kDesktop),
  );

  testWidgets(
    '🔴 only the explicit accept opts in; decline and dismiss do not',
    (WidgetTester tester) async {
      bool? result;
      Future<void> open() async {
        await pumpChassis(
          tester,
          kPhone,
          Builder(
            builder: (BuildContext context) => Center(
              child: TextButton(
                onPressed: () async {
                  result = await AiDisclosureDialog.show(
                    context,
                    processor: 'Anthropic',
                    onOpenPrivacy: () {},
                  );
                },
                child: const Text('go'),
              ),
            ),
          ),
        );
        await tester.tap(find.text('go'));
        await tester.pumpAndSettle();
      }

      await open();
      await tester.tap(find.byKey(AiDisclosureDialog.declineButton));
      await tester.pumpAndSettle();
      expect(result, isFalse);

      await open();
      await tester.tapAt(const Offset(4, 4)); // the barrier
      await tester.pumpAndSettle();
      expect(result, isFalse);

      await open();
      await tester.tap(find.byKey(AiDisclosureDialog.acceptButton));
      await tester.pumpAndSettle();
      expect(result, isTrue);
    },
  );

  Future<void> labelFlow(WidgetTester tester, Size size) async {
    int reports = 0;
    await pumpChassis(
      tester,
      size,
      Scaffold(
        body: Column(
          children: <Widget>[
            AiOutputLabel(
              kind: AiOutputKind.candidate,
              onReport: () => reports++,
            ),
            AiOutputLabel(
              kind: AiOutputKind.suggestion,
              onReport: () => reports++,
            ),
          ],
        ),
      ),
    );
    expect(find.text('Suggested by AI: check before saving'), findsOneWidget);
    expect(find.text('AI suggestion'), findsOneWidget);
    // The report action is reachable from every AI output.
    expect(find.byKey(AiOutputLabel.reportButton), findsNWidgets(2));
    expect(find.byTooltip('Report this AI result'), findsNWidgets(2));
    await tester.tap(find.byKey(AiOutputLabel.reportButton).first);
    await tester.tap(find.byKey(AiOutputLabel.reportButton).last);
    expect(reports, 2);
  }

  testWidgets(
    'every AI output is labelled in text and can be reported — phone',
    (WidgetTester tester) => labelFlow(tester, kPhone),
  );
  testWidgets(
    'every AI output is labelled in text and can be reported — tablet',
    (WidgetTester tester) => labelFlow(tester, kTablet),
  );
  testWidgets(
    'every AI output is labelled in text and can be reported — desktop',
    (WidgetTester tester) => labelFlow(tester, kDesktop),
  );

  testWidgets('the labels are translated, never left in English (ta, hi)', (
    WidgetTester tester,
  ) async {
    for (final Locale locale in const <Locale>[Locale('ta'), Locale('hi')]) {
      await pumpChassis(
        tester,
        kPhone,
        Scaffold(
          body: AiOutputLabel(kind: AiOutputKind.candidate, onReport: () {}),
        ),
        locale: locale,
      );
      expect(find.text('Suggested by AI: check before saving'), findsNothing);
      expect(find.textContaining('AI'), findsOneWidget);
    }
  });
}
