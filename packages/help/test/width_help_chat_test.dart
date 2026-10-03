import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_help/nikatru_help.dart';

/// The help chat at a phone and a desktop width (lane help-ai-chat): the
/// first-use notice, the credit prompt and an answered conversation. Each pump
/// fails on any overflow, and the control a person must reach stays on screen.

class _Fixed implements HelpChatTransport {
  @override
  Future<HelpChatReply> ask({
    required String question,
    required String locale,
  }) async => const HelpChatReply.answered(
    answer: 'Open Settings, then Your data, and choose Export data (CSV).',
    citations: <HelpChatCitation>[
      HelpChatCitation(
        id: 'subscriptiontracker/export-your-data',
        title: 'Export your data',
        url: 'https://nikatru.com/help/#subscriptiontracker-export-your-data',
      ),
    ],
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
  );
}

Future<void> _at(
  WidgetTester tester,
  Size size, {
  bool seen = true,
  bool needsCredits = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const SizedBox());
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: HelpChatPanel(
            transport: _Fixed(),
            locale: 'en',
            noticeSeen: seen,
            onNoticeSeen: () async {},
            onAskUs: (String q) {},
            openUrl: (String u) async {},
            needsCredits: needsCredits,
            onBuyCredits: () {},
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  for (final Size size in const <Size>[Size(375, 812), Size(1280, 800)]) {
    testWidgets(
      'HelpChatPanel at $size: the notice, the prompt and an answer, no overflow',
      (WidgetTester tester) async {
        await _at(tester, size, seen: false);
        expect(tester.takeException(), isNull);
        expect(find.byKey(HelpChatKeys.noticeOk).hitTestable(), findsOneWidget);

        await _at(tester, size, needsCredits: true);
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(HelpChatKeys.buyCredits).hitTestable(),
          findsOneWidget,
        );

        await _at(tester, size);
        await tester.enterText(
          find.byKey(HelpChatKeys.question),
          'How do I export my data?',
        );
        await tester.pump();
        await tester.tap(find.byKey(HelpChatKeys.send));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(HelpChatKeys.aiLabel), findsOneWidget);
      },
    );
  }
}
