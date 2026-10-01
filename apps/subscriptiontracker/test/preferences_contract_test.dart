import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

/// ⏱ 2026-09-30 · review #1080 finding 6 — ONE fixture, read by this test and
/// by services/subscriptiontracker-api/test/preferences.test.ts. This side
/// asserts the app emits exactly the fixture's keys and values for the state it
/// names; that side asserts PATCH accepts them. A key added on one side and not
/// the other reddens one of the two.
void main() {
  test('the app’s preference keys and values are the Worker’s contract', () {
    final Map<String, Object?> fixture =
        jsonDecode(
              File(
                '../../services/subscriptiontracker-api/test/fixtures/'
                'preferences-contract.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    final Map<String, Object?> state =
        fixture['state']! as Map<String, Object?>;
    final Map<String, Object?> changes =
        fixture['changes']! as Map<String, Object?>;

    final Map<String, Object?> emitted = accountPreferenceValuesOf(
      SettingsState(
        currencyCode: state['currencyCode']! as String,
        prefs: (state['switches']! as Map<String, Object?>).map(
          (String k, Object? v) => MapEntry<String, bool>(k, v! as bool),
        ),
        reminderLeadDays: state['reminderLeadDays']! as int,
        reminderMinuteOfDay: state['reminderMinuteOfDay']! as int,
      ),
      ThemeMode.values.byName(state['themeMode']! as String),
      Locale(state['locale']! as String),
    );

    expect(emitted, <String, Object?>{
      for (final MapEntry<String, Object?> e in changes.entries)
        e.key: (e.value! as Map<String, Object?>)['value'],
    });
    // And every default switch the app ships is covered by the fixture.
    for (final String name in const SettingsState().prefs.keys) {
      expect(changes, contains(switchPreferenceKey(name)));
    }
  });
}
