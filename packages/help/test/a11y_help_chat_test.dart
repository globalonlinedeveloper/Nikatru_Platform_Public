import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_help/nikatru_help.dart';

/// The help chat against flutter_test's own guidelines (lane help-ai-chat):
/// 48 x 48 hit areas, a name on every control, and text contrast — on the
/// first-use notice and on an answered conversation, whose AI label is
/// announced, not colour-only.

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

void main() {
  testWidgets(
    'HelpChatPanel meets the tap-target, label and contrast guidelines, notice and answer',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        for (final bool seen in <bool>[false, true]) {
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
                  ),
                ),
              ),
            ),
          );
          if (seen) {
            await tester.enterText(
              find.byKey(HelpChatKeys.question),
              'How do I export my data?',
            );
            await tester.pump();
            await tester.tap(find.byKey(HelpChatKeys.send));
          }
          await tester.pumpAndSettle();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        }
      } finally {
        handle.dispose();
      }
    },
  );
}
