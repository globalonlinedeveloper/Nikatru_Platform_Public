import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  group('UnavailableReminderChannelsTransport', () {
    const UnavailableReminderChannelsTransport t =
        UnavailableReminderChannelsTransport();

    test('every call is a failure, never an answer', () async {
      final List<Result<Object?>> results = <Result<Object?>>[
        await t.readPrefs(appId: 'demo', accessToken: 'tok'),
        await t.writePrefs(appId: 'demo', accessToken: 'tok', emailOptIn: true),
        await t.mintCalendarFeed(appId: 'demo', accessToken: 'tok'),
      ];
      for (final Result<Object?> r in results) {
        expect(r.isOk, isFalse);
      }
    });
  });

  group('ReminderPrefs.tryParse', () {
    test('reads the host answer', () {
      expect(
        ReminderPrefs.tryParse(<String, Object?>{
          'app_id': 'demo',
          'email_opt_in': true,
          'lead_days': 7,
        }),
        const ReminderPrefs(emailOptIn: true, leadDays: 7),
      );
    });

    test('a half-understood answer is null, not the default', () {
      for (final Map<String, Object?> j in <Map<String, Object?>>[
        <String, Object?>{'email_opt_in': 'yes', 'lead_days': 3},
        <String, Object?>{'email_opt_in': true},
        <String, Object?>{'email_opt_in': true, 'lead_days': 31},
        <String, Object?>{'email_opt_in': true, 'lead_days': -1},
      ]) {
        expect(ReminderPrefs.tryParse(j), isNull, reason: '$j');
      }
    });
  });

  group('CalendarFeed.tryParse', () {
    test('reads both URLs', () {
      final CalendarFeed? f = CalendarFeed.tryParse(<String, Object?>{
        'https_url': 'https://h.test/v1/calendar/abc.ics',
        'webcal_url': 'webcal://h.test/v1/calendar/abc.ics',
      });
      expect(f?.httpsUrl, Uri.parse('https://h.test/v1/calendar/abc.ics'));
      expect(f?.webcalUrl, Uri.parse('webcal://h.test/v1/calendar/abc.ics'));
    });

    test('an http: or swapped URL is refused', () {
      for (final Map<String, Object?> j in <Map<String, Object?>>[
        <String, Object?>{
          'https_url': 'http://h.test/v1/calendar/abc.ics',
          'webcal_url': 'webcal://h.test/v1/calendar/abc.ics',
        },
        <String, Object?>{
          'https_url': 'https://h.test/v1/calendar/abc.ics',
          'webcal_url': 'http://h.test/v1/calendar/abc.ics',
        },
        <String, Object?>{
          'https_url': 'webcal://h.test/v1/calendar/abc.ics',
          'webcal_url': 'https://h.test/v1/calendar/abc.ics',
        },
        <String, Object?>{'https_url': 'https://h.test/x.ics'},
      ]) {
        expect(CalendarFeed.tryParse(j), isNull, reason: '$j');
      }
    });
  });
}
