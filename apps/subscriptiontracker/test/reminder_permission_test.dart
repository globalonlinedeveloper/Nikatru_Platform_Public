// ST-R5 (audit C25, D9): the permission answer is READ.
//
// `SettingsController.toggle` used to discard `requestPermissions()`'s result,
// so after an OS refusal "Renewal alerts" read ON over a channel that delivers
// nothing. A refusal now leaves the switch OFF and the row says "Blocked in
// system settings"; the switch is primed first, one dialog for every
// reminder-bearing switch; and a failed sync is a banner.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/settings/reminder_settings.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/recording_seam.dart';
import 'support/width_harness.dart' show MemStore;

ProviderContainer _container({required bool granted}) {
  final RecordingSeam seam = RecordingSeam(granted: granted);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      renewalRemindersProvider.overrideWithValue(
        RenewalReminders.forTesting(service: seam),
      ),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

Widget _host(ProviderContainer c, Widget child) => UncontrolledProviderScope(
  container: c,
  child: MaterialApp(
    localizationsDelegates: <LocalizationsDelegate<dynamic>>[
      ...AppLocalizations.localizationsDelegates,
      ChassisLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: child),
  ),
);

void main() {
  test('🔴 a DENIAL leaves the switch OFF, marked blocked', () async {
    final ProviderContainer c = _container(granted: false);
    await c.read(settingsControllerProvider.notifier).hydration;
    final bool now = await c
        .read(settingsControllerProvider.notifier)
        .toggle('weekly');
    final SettingsState s = c.read(settingsControllerProvider);
    expect(now, isFalse);
    expect(s.prefs['weekly'], isFalse);
    expect(s.blocked, contains('weekly'));
  });

  test(
    'a grant leaves it ON, and turning it on again clears "blocked"',
    () async {
      final ProviderContainer c = _container(granted: true);
      await c.read(settingsControllerProvider.notifier).hydration;
      expect(
        await c.read(settingsControllerProvider.notifier).toggle('weekly'),
        isTrue,
      );
      expect(c.read(settingsControllerProvider).blocked, isEmpty);
    },
  );

  test('an in-app pref never asks (unused draws for the app only)', () async {
    final RecordingSeam seam = RecordingSeam(granted: false);
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => MemStore()),
        renewalRemindersProvider.overrideWithValue(
          RenewalReminders.forTesting(service: seam),
        ),
      ],
    );
    addTearDown(c.dispose);
    await c.read(settingsControllerProvider.notifier).toggle('unused');
    expect(seam.permissionAsks, 0);
  });

  testWidgets('the blocked row SAYS so', (WidgetTester tester) async {
    final ProviderContainer c = _container(granted: false);
    await c.read(settingsControllerProvider.notifier).toggle('weekly');
    await tester.pumpWidget(
      _host(
        c,
        Consumer(
          builder: (BuildContext context, WidgetRef ref, _) => Text(
            reminderPrefSubtitle(
              context,
              ref.watch(settingsControllerProvider),
              'weekly',
              'desc',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Blocked in system settings'), findsOneWidget);
  });

  testWidgets(
    'turning a reminder switch ON primes first; "Not now" asks nothing',
    (WidgetTester tester) async {
      final RecordingSeam seam = RecordingSeam();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          renewalRemindersProvider.overrideWithValue(
            RenewalReminders.forTesting(service: seam),
          ),
        ],
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        _host(
          c,
          Consumer(
            builder: (BuildContext context, WidgetRef ref, _) => TextButton(
              onPressed: () => toggleReminderPref(context, ref, 'weekly'),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('settings.reminder.priming')),
        findsOneWidget,
      );
      await tester.tap(find.text('Not now'));
      await tester.pumpAndSettle();
      expect(seam.permissionAsks, 0);
      expect(c.read(settingsControllerProvider).prefs['weekly'], isFalse);

      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(seam.permissionAsks, 1);
      expect(c.read(settingsControllerProvider).prefs['weekly'], isTrue);
    },
  );

  testWidgets('a failed reminder sync is a banner', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(granted: true);
    await tester.pumpWidget(_host(c, const ReminderSyncBanner()));
    expect(find.byKey(const Key('settings.reminder.syncFailed')), findsNothing);
    c.read(reminderSyncFailureProvider.notifier).state = StateError('boom');
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('settings.reminder.syncFailed')),
      findsOneWidget,
    );
  });
}
