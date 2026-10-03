// [pipeline 10]D-8 — the wall's action on every channel the register declares
// (O-FORCE-UPDATE-VERSION-READ-UNPROVEN). Seven targets, one answer each; the
// served-data half is graded by tooling/ci/update-exit.mjs against this order.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

const String _fallback = 'https://nikatru.com';
const String _served = 'https://dl.nikatru.com/subscriptiontracker';

void main() {
  group('resolveUpdateExit', () {
    test('web reloads, even when a URL is served — the page IS the update', () {
      expect(
        resolveUpdateExit(
          channel: 'web',
          served: _served,
          fallbackUrl: _fallback,
        ),
        isA<ReloadPage>(),
      );
      expect(
        resolveUpdateExit(channel: 'web', served: null, fallbackUrl: _fallback),
        isA<ReloadPage>(),
      );
    });

    for (final String channel in kStoreListingChannels) {
      test(
        '$channel with nothing served opens its store listing, never the homepage',
        () {
          expect(
            resolveUpdateExit(
              channel: channel,
              served: null,
              fallbackUrl: _fallback,
            ),
            isA<OpenStoreListing>(),
          );
          expect(
            resolveUpdateExit(
              channel: channel,
              served: '',
              fallbackUrl: _fallback,
            ),
            isA<OpenStoreListing>(),
          );
        },
      );
      test(
        '$channel with a served URL opens it — the exit stays repointable',
        () {
          expect(
            resolveUpdateExit(
              channel: channel,
              served: _served,
              fallbackUrl: _fallback,
            ),
            const OpenUpdateUrl(_served),
          );
        },
      );
    }

    test(
      'the four store-listing channels are the four whose adapter can open a listing',
      () {
        expect(kStoreListingChannels, <String>{
          'android-play',
          'ios-appstore',
          'macos-appstore',
          'windows-store',
        });
      },
    );

    test('linux-snap opens the served snapcraft.io page', () {
      const String snap = 'https://snapcraft.io/nikatru-subscription-tracker';
      expect(
        resolveUpdateExit(
          channel: 'linux-snap',
          served: snap,
          fallbackUrl: _fallback,
        ),
        const OpenUpdateUrl(snap),
      );
    });

    test(
      'apps-gov-in never opens a store listing: Play cannot update a sideloaded .apk',
      () {
        expect(
          resolveUpdateExit(
            channel: 'apps-gov-in',
            served: null,
            fallbackUrl: _fallback,
          ),
          const OpenUpdateUrl(_fallback),
        );
      },
    );

    test(
      'a build with no channel stamped falls back to the compiled-in URL',
      () {
        expect(
          resolveUpdateExit(channel: '', served: null, fallbackUrl: _fallback),
          const OpenUpdateUrl(_fallback),
        );
      },
    );
  });

  group('openUpdateExit', () {
    Future<List<String>> run(String channel, String? served) async {
      final List<String> calls = <String>[];
      await openUpdateExit(
        served ?? _fallback,
        served,
        channel: channel,
        listing: () async => calls.add('listing'),
        open: (String url) async => calls.add('open $url'),
        reload: () => calls.add('reload'),
      );
      return calls;
    }

    test('a store build with nothing served opens its listing', () async {
      expect(await run('android-play', null), <String>['listing']);
    });

    test('a served URL opens, on a store build too', () async {
      expect(await run('ios-appstore', _served), <String>['open $_served']);
    });

    test('apps-gov-in opens the fallback, never a listing', () async {
      expect(await run('apps-gov-in', null), <String>['open $_fallback']);
    });

    test('web opens nothing — it reloads', () async {
      expect(await run('web', _served), <String>['reload']);
    });

    test('a throwing exit does not escape the button', () async {
      await openUpdateExit(
        _fallback,
        null,
        channel: 'windows-store',
        listing: () async => throw StateError('no store'),
        open: (String _) async => null,
      );
    });
  });

  group('readInstalledVersion', () {
    Future<(String?, List<String>)> run(Future<String> Function() read) async {
      final List<String> sent = <String>[];
      final String? v = await readInstalledVersion(
        read,
        channel: 'linux-snap',
        report: (String m) async => sent.add(m),
      );
      return (v, sent);
    }

    test('a resolved read is returned and reports nothing', () async {
      final (String? v, List<String> sent) = await run(() async => '1.2.3');
      expect(v, '1.2.3');
      expect(sent, isEmpty);
    });

    test('RED CONTROL: a failed read is null AND reported exactly once, '
        'naming the channel', () async {
      final (String? v, List<String> sent) = await run(
        () async => throw StateError('confined'),
      );
      expect(v, isNull);
      expect(sent, hasLength(1));
      expect(sent.single, contains('resolved null on channel "linux-snap"'));
    });

    test('an EMPTY version is a failed read too', () async {
      final (String? v, List<String> sent) = await run(() async => '');
      expect(v, isNull);
      expect(sent, hasLength(1));
    });

    test('a failing sink never turns the read into a throw', () async {
      expect(
        await readInstalledVersion(
          () async => throw StateError('x'),
          channel: 'web',
          report: (String _) async => throw StateError('sink down'),
        ),
        isNull,
      );
    });
  });
}
