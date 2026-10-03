import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart' show RecentActivity;

import 'support.dart';

Widget _app(Widget page) => MaterialApp(home: page);

void main() {
  testWidgets('🔴 [Do 1] the sheet cannot submit without a description', (
    WidgetTester tester,
  ) async {
    final FakeFeedbackTransport t = FakeFeedbackTransport();
    await tester.pumpWidget(
      _app(ReportProblemPage(host: hostOver(outboxOver(t)))),
    );
    FilledButton send() =>
        tester.widget<FilledButton>(find.byKey(FeedbackKeys.send));
    expect(send().onPressed, isNull);
    await tester.enterText(find.byKey(FeedbackKeys.description), '   ');
    await tester.pump();
    expect(send().onPressed, isNull, reason: 'whitespace is not a description');
    await tester.tap(find.byKey(FeedbackKeys.send), warnIfMissed: false);
    await tester.pump();
    expect(t.requests, 0);
    await tester.enterText(
      find.byKey(FeedbackKeys.description),
      'The add button does nothing',
    );
    await tester.pump();
    expect(send().onPressed, isNotNull);
  });

  testWidgets(
    'a sent report shows its id, and the payload is what the preview showed',
    (WidgetTester tester) async {
      final FakeFeedbackTransport t = FakeFeedbackTransport();
      await tester.pumpWidget(
        _app(ReportProblemPage(host: hostOver(outboxOver(t)))),
      );
      await tester.enterText(
        find.byKey(FeedbackKeys.description),
        'Totals are wrong',
      );
      await tester.pump();
      await tester.ensureVisible(find.byKey(FeedbackKeys.send));
      await tester.tap(find.byKey(FeedbackKeys.send));
      await tester.pumpAndSettle();
      expect(find.byKey(FeedbackKeys.result), findsOneWidget);
      expect(find.textContaining('FB-0000000000'), findsOneWidget);
      final Map<String, Object?> sent = t.received.single.report;
      expect(sent['description'], 'Totals are wrong');
      expect(sent['appId'], 'demo');
      expect(
        (sent['diagnostics']! as Map<String, Object?>)['errorCodes'],
        <String>['StateError'],
      );
    },
  );

  testWidgets(
    '🔴 [Do 3] with the logs box unticked the payload has no `logs` key; ticked, the scrubbed breadcrumbs ride',
    (WidgetTester tester) async {
      final RecentActivity ring = RecentActivity()
        ..recordBreadcrumb('sync failed for asha@example.com');
      final FakeFeedbackTransport t = FakeFeedbackTransport();
      await tester.pumpWidget(
        _app(
          ReportProblemPage(
            host: hostOver(outboxOver(t), readLogs: ring.breadcrumbs),
          ),
        ),
      );
      await tester.enterText(
        find.byKey(FeedbackKeys.description),
        'Sync broke',
      );
      await tester.pump();
      await tester.ensureVisible(find.byKey(FeedbackKeys.send));
      await tester.tap(find.byKey(FeedbackKeys.send));
      await tester.pumpAndSettle();
      expect(
        (t.received.single.report['diagnostics']! as Map<String, Object?>)
            .containsKey('logs'),
        isFalse,
      );

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        _app(
          ReportProblemPage(
            host: hostOver(outboxOver(t), readLogs: ring.breadcrumbs),
          ),
        ),
      );
      await tester.enterText(
        find.byKey(FeedbackKeys.description),
        'Sync broke again',
      );
      await tester.ensureVisible(find.byKey(FeedbackKeys.logs));
      await tester.tap(find.byKey(FeedbackKeys.logs));
      await tester.pump();
      await tester.ensureVisible(find.byKey(FeedbackKeys.send));
      await tester.tap(find.byKey(FeedbackKeys.send));
      await tester.pumpAndSettle();
      final Object? logs =
          (t.received.last.report['diagnostics']!
              as Map<String, Object?>)['logs'];
      expect(logs, <String>['sync failed for [REDACTED]']);
    },
  );

  testWidgets(
    '🔴 [Do 10] with both boxes unticked no contact rides, even with an address typed earlier',
    (WidgetTester tester) async {
      final FakeFeedbackTransport t = FakeFeedbackTransport();
      await tester.pumpWidget(
        _app(ReportProblemPage(host: hostOver(outboxOver(t)))),
      );
      await tester.enterText(find.byKey(FeedbackKeys.description), 'Broken');
      await tester.ensureVisible(find.byKey(FeedbackKeys.reply));
      await tester.tap(find.byKey(FeedbackKeys.reply));
      await tester.pump();
      await tester.enterText(
        find.byKey(FeedbackKeys.email),
        'asha@example.com',
      );
      await tester.ensureVisible(find.byKey(FeedbackKeys.reply));
      await tester.tap(find.byKey(FeedbackKeys.reply));
      await tester.pump();
      await tester.ensureVisible(find.byKey(FeedbackKeys.send));
      await tester.tap(find.byKey(FeedbackKeys.send));
      await tester.pumpAndSettle();
      final Map<String, Object?> sent = t.received.single.report;
      expect(sent.containsKey('contactEmail'), isFalse);
      expect(sent['consent'], <String, Object?>{
        'reply': false,
        'notifyFixed': false,
      });
    },
  );

  testWidgets(
    'offline, the page says the report is saved, and offers the support mail',
    (WidgetTester tester) async {
      final FakeFeedbackTransport t = FakeFeedbackTransport()..online = false;
      final List<Uri> mails = <Uri>[];
      await tester.pumpWidget(
        _app(ReportProblemPage(host: hostOver(outboxOver(t), mails: mails))),
      );
      await tester.enterText(find.byKey(FeedbackKeys.description), 'Broken');
      await tester.pump();
      await tester.ensureVisible(find.byKey(FeedbackKeys.send));
      await tester.tap(find.byKey(FeedbackKeys.send));
      await tester.pumpAndSettle();
      expect(
        find.text(FeedbackStrings.of(const Locale('en')).queuedBody),
        findsOneWidget,
      );
      await tester.tap(find.byKey(FeedbackKeys.emailSupport));
      expect(mails.single.path, 'support@example.test');
    },
  );
}
