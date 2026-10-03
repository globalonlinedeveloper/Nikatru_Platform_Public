import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';
import 'package:nikatru_help/nikatru_help.dart';

class _Transport implements FeedbackTransport {
  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async => const FeedbackSendResult.sent('FB-0000000000');
}

final FeedbackHost _host = FeedbackHost(
  app: const FeedbackAppInfo(
    appId: 'demo',
    appVersion: '1.0.0',
    build: '1',
    channel: 'web',
    platform: 'web',
  ),
  outbox: FeedbackOutbox(
    store: Future<KeyValueStore>.value(InMemoryKeyValueStore()),
    transport: _Transport(),
    accessToken: () async => null,
  ),
  owner: () => kAnonymousOwner,
  signedIn: () => false,
  supportEmail: 'support@example.test',
  openMail: (Uri u) async {},
  errorCodes: () => <String>[],
);

HelpIndex _index({
  List<Map<String, Object?>> known = const <Map<String, Object?>>[],
}) => HelpIndex.fromJson(<String, Object?>{
  'version': 1,
  'locale': 'en',
  'avgdl': 10,
  'docs': <Object?>[
    <String, Object?>{
      'id': 'demo/sync',
      'scope': 'demo',
      'slug': 'sync',
      'title': 'Sync across devices',
      'summary': 'Sign in on each device.',
      'url': '/help/#demo-sync',
      'len': 10,
      'text': 'Sign in with the same account on each device.',
    },
  ],
  'postings': <String, Object?>{
    'sync': <Object?>[
      <Object?>[0, 3],
    ],
    'devic': <Object?>[
      <Object?>[0, 4],
    ],
  },
  'synonyms': <String, Object?>{},
  'knownIssues': known,
});

Widget _page({
  HelpIndex? index,
  HelpChatGate gate = HelpChatGate.off,
  List<String>? opened,
}) => MaterialApp(
  home: HelpCentrePage(
    index: index ?? _index(),
    scopes: const <String>{'demo'},
    appId: 'demo',
    feedbackHost: _host,
    openUrl: (String u) async => opened?.add(u),
    chatGate: gate,
    chatEntry: (_) => const Text('chat'),
  ),
);

void main() {
  testWidgets(
    '🔴 "Ask us" opens the report sheet, category question, with the search text',
    (WidgetTester tester) async {
      await tester.pumpWidget(_page());
      await tester.enterText(
        find.byKey(HelpCentreKeys.search),
        'sync is broken',
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(HelpCentreKeys.askUs));
      await tester.tap(find.byKey(HelpCentreKeys.askUs));
      await tester.pumpAndSettle();
      final ReportProblemPage sheet = tester.widget<ReportProblemPage>(
        find.byType(ReportProblemPage),
      );
      expect(sheet.initialCategory, FeedbackCategory.question);
      expect(sheet.initialDescription, 'sync is broken');
      expect(
        find.descendant(
          of: find.byKey(FeedbackKeys.description),
          matching: find.text('sync is broken'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('an empty search result still offers "Ask us" with the query', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_page());
    await tester.enterText(find.byKey(HelpCentreKeys.search), 'zzzz qqqq');
    await tester.pumpAndSettle();
    expect(find.byKey(HelpCentreKeys.noResults), findsOneWidget);
    await tester.ensureVisible(find.byKey(HelpCentreKeys.askUs));
    await tester.tap(find.byKey(HelpCentreKeys.askUs));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ReportProblemPage>(find.byType(ReportProblemPage))
          .initialDescription,
      'zzzz qqqq',
    );
  });

  testWidgets(
    'every article ends with "Ask us", which carries the article when nothing was typed',
    (WidgetTester tester) async {
      await tester.pumpWidget(_page());
      await tester.tap(find.byKey(HelpCentreKeys.article('demo/sync')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(HelpCentreKeys.articleAsk('demo/sync')));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ReportProblemPage>(find.byType(ReportProblemPage))
            .initialDescription,
        'Sync across devices',
      );
    },
  );

  testWidgets(
    '🔴 no known issue renders "No known issues", never a blank list',
    (WidgetTester tester) async {
      await tester.pumpWidget(_page());
      expect(find.byKey(HelpCentreKeys.noKnownIssues), findsOneWidget);
      expect(find.text('No known issues'), findsOneWidget);
    },
  );

  testWidgets(
    'a known issue for this app is listed, and its fixed version shown',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        _page(
          index: _index(
            known: <Map<String, Object?>>[
              <String, Object?>{
                'title': 'Reminders arrive late',
                'apps': <Object?>['demo'],
                'versions': '1.0.0',
                'status': 'fixed',
                'fixedIn': '1.0.1',
                'text': 'Update the app.',
              },
              <String, Object?>{
                'title': 'Another app',
                'apps': <Object?>['other'],
                'versions': '1.0.0',
                'status': 'open',
                'text': 'x',
              },
            ],
          ),
        ),
      );
      expect(find.byKey(HelpCentreKeys.noKnownIssues), findsNothing);
      expect(find.text('Reminders arrive late'), findsOneWidget);
      expect(find.text('Fixed in 1.0.1'), findsOneWidget);
      expect(find.text('Another app'), findsNothing);
    },
  );

  testWidgets('the accessibility statement is one tap away', (
    WidgetTester tester,
  ) async {
    final List<String> opened = <String>[];
    await tester.pumpWidget(_page(opened: opened));
    await tester.ensureVisible(find.byKey(HelpCentreKeys.accessibility));
    await tester.tap(find.byKey(HelpCentreKeys.accessibility));
    expect(opened, <String>['https://nikatru.com/accessibility']);
  });

  group(
    '🔴 the chat entry (help-ai-chat slot) renders only with flag AND Pro AND credits',
    () {
      testWidgets('Pro with zero credits: none', (WidgetTester tester) async {
        await tester.pumpWidget(
          _page(gate: const HelpChatGate(flagOn: true, hasPro: true)),
        );
        expect(find.byKey(HelpCentreKeys.chatEntry), findsNothing);
      });
      testWidgets('flag off: none', (WidgetTester tester) async {
        await tester.pumpWidget(
          _page(gate: const HelpChatGate(hasPro: true, aiCredits: 5)),
        );
        expect(find.byKey(HelpCentreKeys.chatEntry), findsNothing);
      });
      testWidgets('no Pro: none', (WidgetTester tester) async {
        await tester.pumpWidget(
          _page(gate: const HelpChatGate(flagOn: true, aiCredits: 5)),
        );
        expect(find.byKey(HelpCentreKeys.chatEntry), findsNothing);
      });
      testWidgets('all three: the slot is built', (WidgetTester tester) async {
        await tester.pumpWidget(
          _page(
            gate: const HelpChatGate(flagOn: true, hasPro: true, aiCredits: 5),
          ),
        );
        expect(find.byKey(HelpCentreKeys.chatEntry), findsOneWidget);
      });
    },
  );
}
