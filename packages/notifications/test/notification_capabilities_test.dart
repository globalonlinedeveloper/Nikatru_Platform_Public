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

    test('Linux shows and schedules, but not at an exact time (NO-04)', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.linux,
        isWeb: false,
      );
      expect(c.canNotify, isTrue);
      // The plugin has no zonedSchedule on Linux; this package's in-process
      // scheduler and the XDG autostart `--remind` entry broker it instead.
      expect(c.canSchedule, isTrue);
      expect(c.exactTime, isFalse);
      expect(c.canAct, isFalse);
    });

    test('actions and the pending pool, per target (NO-10, NO-11)', () {
      NotificationCapabilities of(TargetPlatform p) =>
          NotificationCapabilities.forPlatform(p, isWeb: false);
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
        TargetPlatform.windows,
      ]) {
        expect(of(p).canAct, isTrue, reason: '$p carries actions');
        expect(of(p).exactTime, isTrue, reason: '$p fires at the instant');
      }
      expect(of(TargetPlatform.iOS).pendingLimit, 64);
      expect(of(TargetPlatform.macOS).pendingLimit, 64);
      expect(of(TargetPlatform.android).pendingLimit, isNull);
      expect(of(TargetPlatform.windows).pendingLimit, isNull);
      expect(of(TargetPlatform.linux).pendingLimit, isNull);
      expect(
        NotificationCapabilities.forPlatform(
          TargetPlatform.android,
          isWeb: true,
        ).canAct,
        isFalse,
      );
    });

    test('Windows shows and schedules (the 22.x Windows plugin)', () {
      final NotificationCapabilities c = NotificationCapabilities.forPlatform(
        TargetPlatform.windows,
        isWeb: false,
      );
      expect(c.canNotify, isTrue);
      expect(c.canSchedule, isTrue);
    });

    test('resolve: Windows is on WITH the app identity, off without', () {
      const WindowsNotificationIdentity id = WindowsNotificationIdentity(
        appName: 'Probe',
        appUserModelId: 'Nikatru.Probe_0000000000000!probe',
        toastActivatorClsid: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      );
      final NotificationCapabilities on = NotificationCapabilities.resolve(
        TargetPlatform.windows,
        isWeb: false,
        windows: id,
      );
      final NotificationCapabilities off = NotificationCapabilities.resolve(
        TargetPlatform.windows,
        isWeb: false,
      );
      expect(on.canNotify && on.canSchedule, isTrue);
      expect(off.canNotify || off.canSchedule, isFalse);
      // Every other platform is forPlatform unchanged, identity or not.
      final NotificationCapabilities linux = NotificationCapabilities.resolve(
        TargetPlatform.linux,
        isWeb: false,
        windows: id,
      );
      expect(linux.canSchedule, isTrue);
      expect(linux.exactTime, isFalse);
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
