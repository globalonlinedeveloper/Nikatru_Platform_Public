import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';
import 'package:nikatru_help/nikatru_help.dart';

/// The help centre against flutter_test's own guidelines (lane help-search):
/// 48 x 48 hit areas, a name on every control, and text contrast — the same
/// three the chassis sweeps run.
class _Transport implements FeedbackTransport {
  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async => const FeedbackSendResult.sent('FB-0000000000');
}

void main() {
  testWidgets(
    'HelpCentrePage meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: HelpCentrePage(
              index: HelpIndex.fromJson(
                jsonDecode(
                      File(
                        '../../sites/nikatru/help/index.en.json',
                      ).readAsStringSync(),
                    )
                    as Map<String, Object?>,
              ),
              scopes: const <String>{'subscriptiontracker', 'account'},
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
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    },
  );
}
