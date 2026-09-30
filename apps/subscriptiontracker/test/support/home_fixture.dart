// The ONE board Home's state and golden tests render (train ST-D1): six
// subscriptions and a pinned clock, so every due label, every sum and the
// greeting are the same on every run and on every day.
//
// Chosen to reach every branch the dashboard has: a renewal tomorrow (the warn
// status), two plans marked unused (the decision strip), a yearly plan (the
// per-year caption), usage bands in all three tones, and a plan with no usage
// data at all (category alone).
import 'package:subscriptiontracker/data/models/subscription.dart';

/// A Monday morning: the greeting is "Good morning" on every run.
final DateTime kHomeFixtureNow = DateTime(2026, 9, 28, 9);

DateTime _in(int days) => kHomeFixtureNow.add(Duration(days: days));

List<Subscription> homeFixture() => <Subscription>[
  Subscription(
    id: 'nfx',
    name: 'Netflix',
    category: 'Streaming',
    price: const Money(1549, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: _in(1),
    glyph: 'NFX',
    usedPct: 80,
  ),
  Subscription(
    id: 'spt',
    name: 'Spotify',
    category: 'Music',
    price: const Money(1199, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: _in(3),
    glyph: 'SPT',
    usedPct: 90,
  ),
  Subscription(
    id: 'gym',
    name: 'City Gym',
    category: 'Fitness',
    price: const Money(4000, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: _in(9),
    glyph: 'GYM',
    unused: true,
  ),
  Subscription(
    id: 'icl',
    name: 'iCloud+',
    category: 'Storage',
    price: const Money(299, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: _in(14),
    glyph: 'ICL',
  ),
  Subscription(
    id: 'adb',
    name: 'Adobe CC',
    category: 'Creative',
    price: const Money(23988, 'USD'),
    cycle: BillingCycle.yearly,
    nextRenewal: _in(40),
    glyph: 'ADB',
    usedPct: 30,
  ),
  Subscription(
    id: 'nws',
    name: 'Daily News',
    category: 'News',
    price: const Money(999, 'USD'),
    cycle: BillingCycle.monthly,
    nextRenewal: _in(20),
    glyph: 'NWS',
    unused: true,
  ),
];
