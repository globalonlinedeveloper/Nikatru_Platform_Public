import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

// AB-O1-03 / review #1075 nit 15: on web a live region mounted with its text
// is often silent, so the notice ALSO announces itself once when it appears.
// kIsWeb is a compile-time constant, so the web branch is driven through
// announceOnAppear; the default (null) is the web-only decision.
void main() {
  Future<List<Map<Object?, Object?>>> announcementsFor(
    WidgetTester tester, {
    bool? announce,
  }) async {
    final List<Map<Object?, Object?>> sent = <Map<Object?, Object?>>[];
    tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(
      SystemChannels.accessibility,
      (Object? message) async {
        sent.add(message! as Map<Object?, Object?>);
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger
          .setMockDecodedMessageHandler<Object?>(
            SystemChannels.accessibility,
            null,
          ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OfflineNotice(
            message: 'Could not reach the network.',
            announceOnAppear: announce,
          ),
        ),
      ),
    );
    await tester.pump();
    return sent
        .where((Map<Object?, Object?> m) => m['type'] == 'announce')
        .toList();
  }

  testWidgets('announces its message once when it appears (the web path)', (
    WidgetTester tester,
  ) async {
    final List<Map<Object?, Object?>> sent = await announcementsFor(
      tester,
      announce: true,
    );
    expect(sent, hasLength(1));
    expect(
      (sent.single['data']! as Map<Object?, Object?>)['message'],
      'Could not reach the network.',
    );
  });

  testWidgets('off the web, the live region alone speaks it', (
    WidgetTester tester,
  ) async {
    expect(await announcementsFor(tester), isEmpty);
  });
}
