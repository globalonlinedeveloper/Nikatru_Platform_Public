// ST-X5 — the service catalogue, read from the PRODUCED pack through the REAL
// loader, then typed by ServiceCatalogue.fromPack.
//
// The pack under test is the one committed at
// apps/subscriptiontracker/assets/content_pack/ — the bytes the app bundles —
// not a fixture written beside this test. assert-pack-roundtrip.mjs proves
// those bytes are what the recipe produces; this proves the client reads them.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

const String _appId = 'subscriptiontracker';
const String _testKeyId = 'test-k1';
const String _testPublicKeyBase64 =
    'SKwspmiis26bCdVVXZBZeWt+cpflQXrfqio6g9iOxBY=';

/// A file-backed [ContentPackSource] — the dart:io stand-in for the app's
/// AssetContentPackSource, reading the same four members.
class _DirSource implements ContentPackSource {
  _DirSource(this.dir);
  final Directory dir;
  final List<String> reads = <String>[];

  @override
  Future<List<int>?> read(String entry) async {
    reads.add(entry);
    final File f = File('${dir.path}/$entry');
    if (!f.existsSync()) return null;
    return f.readAsBytesSync();
  }
}

Directory _bundledPack() {
  // `dart test` runs with the package root (packages/core) as cwd; melos may
  // run from the repo root. Try both and FAIL LOUDLY if neither holds the pack
  // — a path that resolves to nothing would make every assertion a test of
  // the no-bundled-base refusal.
  for (final String root in <String>['../..', '.']) {
    final Directory d = Directory('$root/apps/$_appId/assets/content_pack');
    if (File('${d.path}/manifest.json').existsSync()) return d;
  }
  throw StateError(
      'apps/$_appId/assets/content_pack/manifest.json not found from '
      '${Directory.current.path} — the bundled pack is missing, so this test '
      'would prove nothing');
}

/// The supported codes of tooling/i18n/locales.json (core cannot import the
/// design system's generated table, so it reads the register itself).
List<String> _supportedLocales() {
  for (final String root in <String>['../..', '.']) {
    final File f = File('$root/tooling/i18n/locales.json');
    if (!f.existsSync()) continue;
    final Map<String, dynamic> reg =
        jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
    return <String>[
      for (final dynamic row in reg['locales'] as List<dynamic>)
        if ((row as Map<String, dynamic>)['status'] == 'supported')
          row['code'] as String,
    ];
  }
  throw StateError('tooling/i18n/locales.json not found from '
      '${Directory.current.path}');
}

/// An in-memory pack with a correct content hash, for the refusal cases.
Future<ContentPack> _memPack(Map<String, Map<String, String>> content) async {
  final List<int> contentBytes = utf8.encode(jsonEncode(content));
  final InMemoryContentPackSource src =
      InMemoryContentPackSource(<String, List<int>>{
    'manifest.json': utf8.encode(jsonEncode(<String, Object?>{
      'pack_id': _appId,
      'version': '1.0.0',
      'content_hash': '',
    })),
    'content.json': contentBytes,
  });
  final Result<ContentPack> r =
      await const ContentPackLoader().load(expectPackId: _appId, bundled: src);
  return (r as Ok<ContentPack>).value;
}

String _facts(String id,
        {String? category = 'music',
        String cycle = 'monthly',
        String cancel = 'https://example.com/cancel',
        List<String> regions = const <String>['*']}) =>
    jsonEncode(<String, Object?>{
      'id': id,
      'category': ?category,
      'cycle': cycle,
      'cancel_url': cancel,
      'manage_play': 'https://play.google.com/store/account/subscriptions',
      'manage_appstore': 'https://apps.apple.com/account/subscriptions',
      'notice_days': 1,
      'regions': regions,
    });

Map<String, String> _oneService({
  String? category = 'music',
  String cycle = 'monthly',
  String cancel = 'https://example.com/cancel',
  Map<String, String> extra = const <String, String>{},
}) =>
    <String, String>{
      'catalogue.services': 'svc_a',
      'svc.svc_a.name': 'Service A',
      'svc.svc_a.facts':
          _facts('svc_a', category: category, cycle: cycle, cancel: cancel),
      ...extra,
    };

String _failure(Result<ServiceCatalogue> r) =>
    r.fold((_) => 'Ok', (Failure f) => f.message);

void main() {
  group('the PRODUCED pack, through the REAL loader', () {
    late ContentPack pack;
    late ServiceCatalogue catalogue;

    setUpAll(() async {
      final Result<ContentPack> r = await const ContentPackLoader().load(
        expectPackId: _appId,
        bundled: _DirSource(_bundledPack()),
      );
      expect(r.isOk, isTrue,
          reason: 'the bundled pack did not load: '
              '${r.fold((_) => '', (Failure f) => f.message)}');
      pack = (r as Ok<ContentPack>).value;
      final Result<ServiceCatalogue> c = ServiceCatalogue.fromPack(pack);
      expect(c.isOk, isTrue, reason: _failure(c));
      catalogue = (c as Ok<ServiceCatalogue>).value;
    });

    test('is the app\'s own pack, and its content hash was checked', () {
      expect(pack.manifest.packId, _appId);
      expect(pack.manifest.contentHash, hasLength(64),
          reason: 'a bundled pack MAY omit its hash; this one must not, or '
              'the loader skipped the integrity check');
      // One shard per SUPPORTED locale of the locale register, in its order.
      expect(pack.manifest.locales, _supportedLocales());
    });

    test('its signature ALSO verifies against the test key it was built with',
        () async {
      // The bundled tier never checks it (requireSignature:false), so this is
      // the only place a bundled pack with a broken signature would show.
      final Result<ContentPack> r = await ContentPackLoader(
        verifier: Ed25519PackVerifier(
          pinnedKeys: const <String, String>{_testKeyId: _testPublicKeyBase64},
        ),
        pinnedKeys: const <String, String>{_testKeyId: _testPublicKeyBase64},
      ).loadFrom(_DirSource(_bundledPack()),
          requireSignature: true, expectPackId: _appId);
      expect(r.isOk, isTrue, reason: r.fold((_) => '', (Failure f) => f.message));
    });

    // ST-T9 (AD-04): pack v2 is the market's floor — 150 or more services.
    test('holds a catalogue of 150 to 600 services', () {
      expect(catalogue.entries.length, greaterThanOrEqualTo(150));
      expect(catalogue.entries.length, lessThanOrEqualTo(600));
      expect(catalogue.entries.map((ServiceEntry e) => e.id).toSet().length,
          catalogue.entries.length);
    });

    test('every entry cancels on an https page and manages on both stores', () {
      for (final ServiceEntry e in catalogue.entries) {
        expect(e.cancelUrl.scheme, 'https', reason: e.id);
        expect(e.cancelUrl.host, isNotEmpty, reason: e.id);
        expect(e.playManageUrl.toString(),
            'https://play.google.com/store/account/subscriptions');
        expect(e.appStoreManageUrl.toString(),
            'https://apps.apple.com/account/subscriptions');
        expect(kServiceCategories, contains(e.categoryId), reason: e.id);
        expect(e.noticeDays, greaterThanOrEqualTo(0), reason: e.id);
      }
    });

    test('the region filter drops an India-only service for the US', () {
      final ServiceEntry? swiggy = catalogue.byId('swiggy_one');
      expect(swiggy, isNotNull);
      expect(swiggy!.regions, <String>{'IN'});
      expect(catalogue.forRegion('IN').map((ServiceEntry e) => e.id),
          contains('swiggy_one'));
      expect(catalogue.forRegion('US').map((ServiceEntry e) => e.id),
          isNot(contains('swiggy_one')));
      // …and a global one is in both, so the filter is not just "drop all".
      expect(catalogue.forRegion('US').map((ServiceEntry e) => e.id),
          contains('netflix'));
      expect(catalogue.forRegion('us').length, catalogue.forRegion('US').length);
      expect(catalogue.forRegion('US').length,
          lessThan(catalogue.entries.length));
    });

    test('no price is authored, so priceFor is null for every entry', () {
      for (final ServiceEntry e in catalogue.entries) {
        expect(e.priceFor('INR'), isNull, reason: e.id);
        expect(e.priceFor('USD'), isNull, reason: e.id);
      }
    });

    test('ta names are Tamil transliterations; a missing ta key falls back', () {
      final ServiceCatalogue ta =
          (ServiceCatalogue.fromPack(pack, locale: 'ta') as Ok<ServiceCatalogue>)
              .value;
      expect(ta.byId('netflix')!.name, isNot('Netflix'));
      expect(ta.byId('netflix')!.name, contains('நெட்'));
      expect(ta.entries.length, catalogue.entries.length);
      // A locale the pack does not carry falls back to en, whole.
      final ServiceCatalogue fr =
          (ServiceCatalogue.fromPack(pack, locale: 'fr') as Ok<ServiceCatalogue>)
              .value;
      expect(fr.byId('netflix')!.name, 'Netflix');
    });
  });

  // 🔴 THE RED-ON-MAIN STATE, DOCUMENTED. The app asked for its own pack with
  // no remote pointer and, before ST-X5, no bundled base: the loader has
  // nothing to serve and says so. This is the Failure the app's
  // contentPackProvider used to fold to null on every launch.
  test('with NO bundled source the loader refuses with "no bundled base"',
      () async {
    final Result<ContentPack> r =
        await const ContentPackLoader().load(expectPackId: _appId);
    expect(r.isOk, isFalse);
    expect(r.fold((_) => '', (Failure f) => f.message),
        'content pack: none available (offline, no bundled base)');
  });

  // ST-T9 (AD-03): the pick step's search runs over THIS pack, offline.
  group('search and region order over the PRODUCED pack', () {
    late ServiceCatalogue catalogue;
    setUpAll(() async {
      final Result<ContentPack> r = await const ContentPackLoader()
          .load(expectPackId: _appId, bundled: _DirSource(_bundledPack()));
      final ContentPack pack = (r as Ok<ContentPack>).value;
      catalogue = (ServiceCatalogue.fromPack(pack) as Ok<ServiceCatalogue>).value;
    });

    test('typing "hot" finds JioHotstar', () {
      expect(catalogue.search('hot', region: 'IN').map((ServiceEntry e) => e.id),
          contains('jiohotstar'));
      expect(catalogue.search('HOT').first.id, 'jiohotstar');
    });

    test('an alias finds its service; nonsense finds nothing', () {
      expect(catalogue.search('tata sky').single.id, 'tata_play');
      expect(catalogue.search('zzzz-no-such-service'), isEmpty);
    });

    test('India first for IN: every India-only service precedes every US-only one',
        () {
      final List<String> ids =
          catalogue.orderedFor('IN').map((ServiceEntry e) => e.id).toList();
      expect(ids.indexOf('jiohotstar'), lessThan(ids.indexOf('netflix')));
      expect(ids.indexOf('netflix'), lessThan(ids.indexOf('hulu')));
      final List<String> us =
          catalogue.orderedFor('US').map((ServiceEntry e) => e.id).toList();
      expect(us.indexOf('hulu'), lessThan(us.indexOf('jiohotstar')));
    });

    test('v2 records carry aliases and a telecom category', () {
      expect(catalogue.byId('jiohotstar')!.aliases, contains('hotstar'));
      expect(catalogue.byId('airtel_postpaid')!.categoryId, 'telecom');
      expect(catalogue.entries.every((ServiceEntry e) => e.logo == null), isTrue,
          reason: 'no licensed mark ships in v2 (asset-register.json)');
    });
  });

  group('refusals — a pack the reader cannot read honestly is refused whole',
      () {
    test('a v1 record with no aliases reads as none; a bad alias list is refused',
        () async {
      final ContentPack ok = await _memPack(<String, Map<String, String>>{
        'en': _oneService(),
      });
      final Result<ServiceCatalogue> r = ServiceCatalogue.fromPack(ok);
      expect((r as Ok<ServiceCatalogue>).value.entries.single.aliases, isEmpty);
      final Map<String, Object?> facts =
          jsonDecode(_facts('svc_a')) as Map<String, Object?>;
      final ContentPack bad = await _memPack(<String, Map<String, String>>{
        'en': <String, String>{
          ..._oneService(),
          'svc.svc_a.facts': jsonEncode(<String, Object?>{
            ...facts,
            'aliases': 'not-a-list',
          }),
        },
      });
      expect(_failure(ServiceCatalogue.fromPack(bad)), contains('aliases'));
    });

    test('a valid price key round-trips through priceFor, exactly', () async {
      final ContentPack p = await _memPack(<String, Map<String, String>>{
        'en': _oneService(extra: <String, String>{
          'svc.svc_a.price.INR': '649',
          'svc.svc_a.price.USD': '15.49',
          'svc.svc_a.price.JPY': '1490',
        }),
      });
      final Result<ServiceCatalogue> r = ServiceCatalogue.fromPack(p);
      expect(r.isOk, isTrue, reason: _failure(r));
      final ServiceEntry e = (r as Ok<ServiceCatalogue>).value.entries.single;
      expect(e.priceFor('INR'), const Money(64900, 'INR'));
      // 15.49 * 100 is 1548.999… in binary floating point; the parse is exact.
      expect(e.priceFor('USD'), const Money(1549, 'USD'));
      expect(e.priceFor('usd'), const Money(1549, 'USD'));
      expect(e.priceFor('JPY'), const Money(1490, 'JPY'));
      expect(e.priceFor('EUR'), isNull);
    });

    test('a non-ISO currency code in a price key is refused', () async {
      for (final String code in <String>['XYZ', 'inr', 'RUPEE', 'KRW']) {
        final ContentPack p = await _memPack(<String, Map<String, String>>{
          'en': _oneService(
              extra: <String, String>{'svc.svc_a.price.$code': '10'}),
        });
        final Result<ServiceCatalogue> r = ServiceCatalogue.fromPack(p);
        expect(r.isOk, isFalse, reason: code);
        expect(_failure(r), contains('not an accepted ISO 4217 code'),
            reason: code);
      }
    });

    test('an amount finer than the currency allows is refused, not rounded',
        () async {
      final ContentPack p = await _memPack(<String, Map<String, String>>{
        'en': _oneService(
            extra: <String, String>{'svc.svc_a.price.USD': '15.499'}),
      });
      expect(_failure(ServiceCatalogue.fromPack(p)), contains('plain'));
    });

    test('a missing category is refused', () async {
      final ContentPack p = await _memPack(
          <String, Map<String, String>>{'en': _oneService(category: null)});
      expect(_failure(ServiceCatalogue.fromPack(p)), contains('no category'));
    });

    test('an unknown category is refused', () async {
      final ContentPack p = await _memPack(
          <String, Map<String, String>>{'en': _oneService(category: 'misc')});
      expect(
          _failure(ServiceCatalogue.fromPack(p)), contains('unknown category'));
    });

    test('an unknown cycle is refused', () async {
      final ContentPack p = await _memPack(
          <String, Map<String, String>>{'en': _oneService(cycle: 'weekly')});
      expect(_failure(ServiceCatalogue.fromPack(p)), contains('unknown cycle'));
    });

    test('a non-https cancel URL is refused', () async {
      for (final String url in <String>[
        'http://example.com/cancel',
        'javascript:alert(1)',
        'https:///no-host',
      ]) {
        final ContentPack p = await _memPack(
            <String, Map<String, String>>{'en': _oneService(cancel: url)});
        expect(_failure(ServiceCatalogue.fromPack(p)), contains('not https'),
            reason: url);
      }
    });

    test('a facts record filed under another id is refused', () async {
      final ContentPack p = await _memPack(<String, Map<String, String>>{
        'en': <String, String>{
          ..._oneService(),
          'svc.svc_a.facts': _facts('svc_b'),
        },
      });
      expect(_failure(ServiceCatalogue.fromPack(p)), contains('declares id'));
    });

    test('a missing index is refused, not read as an empty catalogue', () async {
      final ContentPack p = await _memPack(<String, Map<String, String>>{
        'en': <String, String>{'svc.svc_a.name': 'Service A'},
      });
      expect(_failure(ServiceCatalogue.fromPack(p)), contains('no "catalogue'));
    });
  });
}
