import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart' show initializeDateFormatting;
import 'package:nikatru_widgets/nikatru_widgets.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

// XP-04 · Subly's glance data provider: what the home-screen widget, the
// tray item and the web badge are handed on each sync.

final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
final DateTime now = DateTime.utc(2026, 10, 1, 9);

Subscription _sub(String name, int minor, DateTime next) => Subscription(
  id: name,
  name: name,
  category: 'Other',
  price: Money(minor, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: next,
);

final List<Subscription> _subs = <Subscription>[
  _sub('Spotify', 1199, DateTime.utc(2026, 10, 20)),
  _sub('Netflix', 1549, DateTime.utc(2026, 10, 3)),
  _sub('iCloud', 299, DateTime.utc(2026, 10, 6)),
];

void main() {
  // In the app MaterialApp's localization delegates load the date symbols;
  // a bare test loads them itself, as the app's own date screens' tests do.
  setUpAll(() => initializeDateFormatting('en'));

  test('RED CONTROL: a Pro glance renders the NEXT renewal first', () {
    final GlanceSnapshot g = sublyGlance(
      subs: _subs,
      locked: false,
      now: now,
      l10n: en,
    );
    expect(g.locked, isFalse);
    expect(g.facts.first.label, en.glanceNextRenewal);
    expect(g.facts.first.value, startsWith('Netflix · '));
    expect(g.facts.first.value, contains('3'));
    expect(g.facts[1].label, en.glanceThisMonth);
    expect(g.facts[1].value, isNotEmpty);
    // Netflix (3 Oct) and iCloud (6 Oct) fall in the next seven days.
    expect(g.badgeCount, 2);
  });

  test('RED CONTROL: a Free user sees the Pro prompt in the widget', () {
    final GlanceSnapshot g = sublyGlance(
      subs: _subs,
      locked: true,
      now: now,
      l10n: en,
    );
    expect(g.locked, isTrue);
    expect(g.proPrompt, en.glanceProPrompt);
    expect(g.facts, isEmpty);
    expect(g.toWidgetData().values.join(), isNot(contains('Netflix')));
  });

  test('an empty list still says what this month costs', () {
    final GlanceSnapshot g = sublyGlance(
      subs: const <Subscription>[],
      locked: false,
      now: now,
      l10n: en,
    );
    expect(g.facts.single.label, en.glanceThisMonth);
    expect(g.badgeCount, 0);
  });

  test('the add shortcut is the add sheet, and every title is translated', () {
    final List<AppShortcut> shortcuts = sublyShortcuts(en);
    expect(routeForShortcut('add_subscription', shortcuts), addSheetRoute);
    expect(routeForShortcut('what_renews_next', shortcuts), '/calendar');
    final AppLocalizations ta = lookupAppLocalizations(const Locale('ta'));
    for (final AppShortcut s in sublyShortcuts(ta)) {
      expect(
        s.title,
        isNot(anyOf(en.shortcutAddSubscription, en.shortcutWhatRenewsNext)),
      );
    }
  });

  test('RED CONTROL (#1155 review, finding 7): with the app lock on, the '
      'widget shows no figures', () {
    final GlanceSnapshot g = sublyGlance(
      subs: _subs,
      locked: false,
      now: now,
      l10n: en,
      appLocked: true,
    );
    expect(g.facts, isEmpty);
    expect(g.badgeCount, 0);
    expect(g.proPrompt, en.glanceAppLocked);
    expect(g.toWidgetData().values.join(), isNot(contains('Netflix')));
  });
}
