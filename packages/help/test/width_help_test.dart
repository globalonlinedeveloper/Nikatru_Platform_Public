import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';
import 'package:nikatru_help/nikatru_help.dart';

/// The help centre at a phone and a desktop width (lane help-search): each pump
/// fails on any overflow, and "Ask us" stays reachable.
class _Transport implements FeedbackTransport {
  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async => const FeedbackSendResult.sent('FB-0000000000');
}

Widget _page() => MaterialApp(
  home: HelpCentrePage(
    index: HelpIndex.fromJson(
      jsonDecode(
            File('../../sites/nikatru/help/index.en.json').readAsStringSync(),
          )
          as Map<String, Object?>,
    ),
    scopes: const <String>{'subscriptiontracker', 'platform'},
    appId: 'subscriptiontracker',
    feedbackHost: FeedbackHost(
      app: const FeedbackAppInfo(
        appId: 'subscriptiontracker',
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
    ),
    openUrl: (String u) async {},
  ),
);

Future<void> _at(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_page());
  await tester.pump();
}

void main() {
  testWidgets('HelpCentrePage at 375 x 812: no overflow, Ask us reachable', (
    WidgetTester tester,
  ) async {
    await _at(tester, const Size(375, 812));
    expect(tester.takeException(), isNull);
    // The page is a lazy ListView: scroll until "Ask us" is built and shown.
    await tester.scrollUntilVisible(
      find.byKey(HelpCentreKeys.askUs),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(HelpCentreKeys.askUs).hitTestable(), findsOneWidget);
  });

  testWidgets('HelpCentrePage at 1280 x 800: no overflow, Ask us reachable', (
    WidgetTester tester,
  ) async {
    await _at(tester, const Size(1280, 800));
    expect(tester.takeException(), isNull);
    // The page is a lazy ListView: scroll until "Ask us" is built and shown.
    await tester.scrollUntilVisible(
      find.byKey(HelpCentreKeys.askUs),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(HelpCentreKeys.askUs).hitTestable(), findsOneWidget);
  });
}
