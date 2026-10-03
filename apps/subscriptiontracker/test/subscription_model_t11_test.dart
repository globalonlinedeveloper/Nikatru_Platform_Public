// Train T11 — the model carries 0010's fields: the price after a trial (AD-08)
// and the "Still using?" answer (IN-08), the client half.
//
// Each case names the lib change that turns it red when reverted.
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

Map<String, dynamic> _wire({Map<String, dynamic> extra = const {}}) =>
    <String, dynamic>{
      'id': 's1',
      'name': 'JioHotstar',
      'category': 'Video',
      'price': 0,
      'price_minor': 0,
      'currency': 'INR',
      'cycle': 'monthly',
      'cycle_every': 1,
      'cycle_unit': 'month',
      'next_renewal': '2026-10-08',
      'status': 'trialing',
      'trial_ends_on': '2026-10-08',
      ...extra,
    };

void main() {
  group('AD-08 — the price after the trial', () {
    // Red: drop `priceAfterTrial: readPriceAfterTrial(...)` from fromJson.
    test(
      'is read in the row’s own currency, and round-trips through toJson',
      () {
        final Subscription s = Subscription.fromJson(
          _wire(extra: <String, dynamic>{'price_after_trial_minor': 89900}),
        );
        expect(s.priceAfterTrial, const Money(89900, 'INR'));
        final Subscription back = Subscription.fromJson(s.toJson());
        expect(back.priceAfterTrial, const Money(89900, 'INR'));
        expect(s.toJson()['price_after_trial_minor'], 89900);
      },
    );

    test('absent, null, negative or a decimal reads as none', () {
      for (final Object? raw in <Object?>[null, -1, 899.0, '89900']) {
        final Subscription s = Subscription.fromJson(
          _wire(extra: <String, dynamic>{'price_after_trial_minor': raw}),
        );
        expect(s.priceAfterTrial, isNull, reason: '$raw');
      }
      expect(Subscription.fromJson(_wire()).priceAfterTrial, isNull);
    });

    test(
      'a row with none still SENDS the key as null, so an edit can clear it',
      () {
        // The API (0010) serves the key, null included; a wire WITHOUT it is
        // an API that predates the column, which T9's capability gate keeps
        // the key away from (`priceAfterTrialSupported`).
        final Map<String, dynamic> json = Subscription.fromJson(
          _wire(extra: <String, dynamic>{'price_after_trial_minor': null}),
        ).toJson();
        expect(json.containsKey('price_after_trial_minor'), isTrue);
        expect(json['price_after_trial_minor'], isNull);
      },
    );

    // Red: drop the key from `toJson` — the edit sends nothing.
    test(
      'a changed post-trial price is sent alone (the API reads it in the stored currency)',
      () {
        final Subscription before = Subscription.fromJson(
          _wire(extra: <String, dynamic>{'price_after_trial_minor': 64900}),
        );
        final Subscription after = before.patched(<String, dynamic>{
          'price_after_trial_minor': 89900,
        });
        expect(after.changesFrom(before), <String, dynamic>{
          'price_after_trial_minor': 89900,
        });
      },
    );

    // Red: drop the currency rule from `_with` — the old amount, counted in
    // rupees, would stay on a row now in dollars and nothing would clear it.
    test('a move to another currency sends the CLEAR with the money', () {
      final Subscription before = Subscription.fromJson(
        _wire(extra: <String, dynamic>{'price_after_trial_minor': 64900}),
      );
      final Subscription after = before.withPrice(const Money(999, 'USD'));
      expect(after.changesFrom(before), <String, dynamic>{
        'price': 9.99,
        'price_minor': 999,
        'currency': 'USD',
        'price_after_trial_minor': null,
      });
    });

    test('an edit of the price alone does not send it', () {
      final Subscription before = Subscription.fromJson(
        _wire(extra: <String, dynamic>{'price_after_trial_minor': 64900}),
      );
      expect(
        before.withPrice(const Money(100, 'INR')).changesFrom(before).keys,
        unorderedEquals(<String>['price', 'price_minor', 'currency']),
      );
    });

    // Red: drop the currency rule from `patched`.
    test(
      'the PATCH twin drops it when the currency MOVES, keeps it when re-sent',
      () {
        final Subscription s = Subscription.fromJson(
          _wire(extra: <String, dynamic>{'price_after_trial_minor': 89900}),
        );
        expect(
          s.patched(<String, dynamic>{'currency': 'INR'}).priceAfterTrial,
          const Money(89900, 'INR'),
        );
        expect(
          s.patched(<String, dynamic>{'currency': 'JPY'}).priceAfterTrial,
          isNull,
        );
      },
    );

    test('a new amount in another currency cannot keep it (withPrice)', () {
      final Subscription s = Subscription.fromJson(
        _wire(extra: <String, dynamic>{'price_after_trial_minor': 89900}),
      );
      expect(s.withPrice(const Money(500, 'INR')).priceAfterTrial, isNotNull);
      expect(s.withPrice(const Money(500, 'USD')).priceAfterTrial, isNull);
    });
  });

  group('IN-08 — "Still using?" is a field of the row', () {
    // Red: drop `stillUsing:` / `stillUsingAt:` from fromJson.
    test('the answer and the server’s stamp are read and round-trip', () {
      final Subscription s = Subscription.fromJson(
        _wire(
          extra: <String, dynamic>{
            'still_using': 'yes',
            'still_using_at': '2026-10-01T09:00:00.000Z',
          },
        ),
      );
      expect(s.stillUsing, StillUsing.yes);
      expect(s.stillUsingAt, DateTime.utc(2026, 10, 1, 9));
      final Subscription back = Subscription.fromJson(s.toJson());
      expect(back.stillUsing, StillUsing.yes);
      expect(back.stillUsingAt, DateTime.utc(2026, 10, 1, 9));
    });

    test('anything but yes or no is "not answered"', () {
      for (final Object? raw in <Object?>[null, 'maybe', true, 'YES']) {
        expect(
          Subscription.fromJson(
            _wire(extra: <String, dynamic>{'still_using': raw}),
          ).stillUsing,
          isNull,
          reason: '$raw',
        );
      }
    });

    test(
      'an answer is a PATCH of `still_using` alone — the server stamps the time',
      () {
        final Subscription before = Subscription.fromJson(_wire());
        final Subscription after = before.patched(<String, dynamic>{
          'still_using': 'no',
        });
        expect(after.stillUsing, StillUsing.no);
        expect(after.stillUsingAt, isNotNull);
        expect(after.changesFrom(before), <String, dynamic>{
          'still_using': 'no',
        });
      },
    );

    test(
      'the twin keeps the stamp for a repeated answer and clears it with null',
      () {
        final Subscription s = Subscription.fromJson(
          _wire(
            extra: <String, dynamic>{
              'still_using': 'yes',
              'still_using_at': '2026-10-01T09:00:00.000Z',
            },
          ),
        );
        expect(
          s.patched(<String, dynamic>{'still_using': 'yes'}).stillUsingAt,
          DateTime.utc(2026, 10, 1, 9),
        );
        final Subscription cleared = s.patched(<String, dynamic>{
          'still_using': null,
        });
        expect(cleared.stillUsing, isNull);
        expect(cleared.stillUsingAt, isNull);
        expect(
          s.patched(<String, dynamic>{'notes': 'x'}).stillUsingAt,
          DateTime.utc(2026, 10, 1, 9),
          reason: 'an unrelated edit does not touch the answer',
        );
      },
    );
  });
}
