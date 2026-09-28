import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';

void main() {
  // This matrix is pinned to flutter_local_notifications 22.x (shared with
  // apps/subscriptiontracker). If these expectations change, a version bump is the likely
  // cause — re-verify against the plugin's actual per-platform support.
  group(
      'NotificationCapabilities.forPlatform (flutter_local_notifications 22.x)',
      () {
    test('mobile + macOS can show AND repeat-schedule', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
      ]) {
        final NotificationCapabilities c = NotificationCapabilities.forPlatform(
          p,
          isWeb: false,
        );
        expect(c.canNotify, isTrue, reason: '$p should show');
        expect(c.canSchedule, isTrue, reason: '$p should schedule');
      }
    });

    test('Linux can show but not schedule (no zonedSchedule on Linux)', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.linux,
        isWeb: false,
      );
      expect(c.canNotify, isTrue);
      expect(c.canSchedule, isFalse);
    });

    test('Windows supports neither until an app supplies Windows init settings', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.windows,
        isWeb: false,
      );
      expect(c.canNotify, isFalse);
      expect(c.canSchedule, isFalse);
    });

    test('web supports neither, even on a notify-capable host platform', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.android,
        isWeb: true,
      );
      expect(c.canNotify, isFalse);
      expect(c.canSchedule, isFalse);
    });

    test('Fuchsia supports neither', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.fuchsia,
        isWeb: false,
      );
      expect(c.canNotify, isFalse);
      expect(c.canSchedule, isFalse);
    });
  });
}
