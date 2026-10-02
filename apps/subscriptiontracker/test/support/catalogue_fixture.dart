// ST-T9 — a catalogue in the pack's shape for widget tests of the add sheet's
// pick step, so a test does not depend on the bundled asset loading inside
// the fake-async zone (it does not: rootBundle I/O never completes there, and
// the pick step would sit in its loading state for the whole test).
//
// Eight India-first services, the POPULAR grid's full count, then a few more
// a search can find. Netflix carries an INR price so a prefill has a price to
// fill; the SHIPPED pack authors none (no price page was read), which
// packages/core/test/service_catalogue_test.dart pins.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show Money, ServiceCatalogue, ServiceCycle, ServiceEntry;
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

ServiceEntry fixtureEntry(
  String id,
  String name,
  String category, {
  ServiceCycle cycle = ServiceCycle.monthly,
  Set<String> regions = const <String>{'*'},
  Map<String, Money> prices = const <String, Money>{},
  List<String> aliases = const <String>[],
}) => ServiceEntry(
  id: id,
  name: name,
  categoryId: category,
  cycle: cycle,
  cancelUrl: Uri.parse('https://example.com/$id/cancel'),
  playManageUrl: Uri.parse(
    'https://play.google.com/store/account/subscriptions',
  ),
  appStoreManageUrl: Uri.parse('https://apps.apple.com/account/subscriptions'),
  noticeDays: 1,
  regions: regions,
  prices: prices,
  aliases: aliases,
);

final ServiceCatalogue kFixtureCatalogue = ServiceCatalogue(<ServiceEntry>[
  fixtureEntry(
    'jiohotstar',
    'JioHotstar',
    'entertainment',
    regions: const <String>{'IN'},
    aliases: const <String>['hotstar'],
  ),
  fixtureEntry(
    'netflix',
    'Netflix',
    'entertainment',
    prices: const <String, Money>{'INR': Money(64900, 'INR')},
  ),
  fixtureEntry('spotify', 'Spotify', 'music'),
  fixtureEntry('youtube_premium', 'YouTube Premium', 'entertainment'),
  fixtureEntry(
    'amazon_prime',
    'Amazon Prime',
    'shopping',
    cycle: ServiceCycle.yearly,
    regions: const <String>{'IN'},
  ),
  fixtureEntry('chatgpt_plus', 'ChatGPT Plus', 'ai'),
  fixtureEntry('google_one', 'Google One', 'cloud'),
  fixtureEntry(
    'cultpass',
    'Cultpass',
    'fitness',
    regions: const <String>{'IN'},
  ),
  fixtureEntry('dropbox', 'Dropbox', 'cloud'),
  fixtureEntry('hulu', 'Hulu', 'entertainment', regions: const <String>{'US'}),
]);

/// The overrides that put [kFixtureCatalogue] behind the pick step, with the
/// device region pinned so the order does not follow the test host's locale.
List<Override> catalogueOverrides({String region = 'US'}) => <Override>[
  serviceCatalogueProvider.overrideWith(
    (Ref ref, String _) async => kFixtureCatalogue,
  ),
  deviceRegionProvider.overrideWithValue(region),
];
