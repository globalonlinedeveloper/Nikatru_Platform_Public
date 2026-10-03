import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/nikatru_telemetry.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

void main() {
  setUp(RecentActivity.instance.clear);

  test(
    '🔴 [feedback Do 3] an e-mail inside a breadcrumb is scrubbed when read',
    () {
      final RecentActivity ring = RecentActivity();
      ring.recordBreadcrumb(
        'sync failed for asha@example.com',
        category: 'sync',
      );
      expect(ring.breadcrumbs(), <String>[
        '[sync] sync failed for $redactedToken',
      ]);
      expect(ring.breadcrumbs().join(), isNot(contains('asha@example.com')));
    },
  );

  test('an error is kept as its CODE (its type), never its message', () {
    final RecentActivity ring = RecentActivity();
    ring.recordError(const FormatException('card 4111 1111 1111 1111 refused'));
    expect(ring.errorCodes, <String>['FormatException']);
  });

  test('the rings are bounded, oldest dropped first', () {
    final RecentActivity ring = RecentActivity(
      codeCapacity: 2,
      breadcrumbCapacity: 2,
    );
    for (final String c in <String>['a', 'b', 'c']) {
      ring.recordCode(c);
      ring.recordBreadcrumb(c);
    }
    expect(ring.errorCodes, <String>['b', 'c']);
    expect(ring.breadcrumbs(), <String>['b', 'c']);
  });

  test('the crash sink remembers an event: its exception types and its id', () {
    final SentryEvent event = SentryEvent(
      exceptions: <SentryException>[
        SentryException(type: 'StateError', value: 'secret a@b.com'),
      ],
    );
    TelemetryBootstrap.remember(event);
    expect(RecentActivity.instance.errorCodes, <String>['StateError']);
    expect(RecentActivity.instance.lastCrashEventId, event.eventId.toString());
  });

  test('an event with no exception changes nothing', () {
    TelemetryBootstrap.remember(SentryEvent(message: SentryMessage('hello')));
    expect(RecentActivity.instance.errorCodes, isEmpty);
    expect(RecentActivity.instance.lastCrashEventId, isNull);
  });
}
