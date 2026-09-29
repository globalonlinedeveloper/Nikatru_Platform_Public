import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:test/test.dart';

/// Answers every request with a fixed status and body and records it.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;
  int calls = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    lastRequest = options;
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

const String _base = 'https://platform.example.test';

DioReminderChannelsTransport _transport(_FakeAdapter adapter) =>
    DioReminderChannelsTransport(
      platformBaseUrl: _base,
      httpClient: Dio()..httpClientAdapter = adapter,
    );

String _json(Map<String, Object?> m) => jsonEncode(m);

void main() {
  test(
    'PUT sends the pinned body with the bearer, and parses the reply',
    () async {
      final _FakeAdapter adapter = _FakeAdapter(
        _json(<String, Object?>{
          'app_id': 'demo',
          'email_opt_in': true,
          'lead_days': 7,
        }),
      );
      final core.Result<core.ReminderPrefs> r = await _transport(adapter)
          .writePrefs(
            appId: 'demo',
            accessToken: 'tok',
            emailOptIn: true,
            leadDays: 7,
          );

      expect(
        r.fold((core.ReminderPrefs v) => v, (_) => null),
        const core.ReminderPrefs(emailOptIn: true, leadDays: 7),
      );
      final RequestOptions req = adapter.lastRequest!;
      expect(req.method, 'PUT');
      expect(req.uri.toString(), '$_base/v1/reminders/prefs');
      expect(req.headers['authorization'], 'Bearer tok');
      expect(req.data, <String, Object?>{
        'app_id': 'demo',
        'email_opt_in': true,
        'lead_days': 7,
      });
    },
  );

  test(
    'PUT without a lead omits lead_days, so the stored one is kept',
    () async {
      final _FakeAdapter adapter = _FakeAdapter(
        _json(<String, Object?>{'email_opt_in': false, 'lead_days': 5}),
      );
      await _transport(
        adapter,
      ).writePrefs(appId: 'demo', accessToken: 'tok', emailOptIn: false);
      expect(adapter.lastRequest!.data, <String, Object?>{
        'app_id': 'demo',
        'email_opt_in': false,
      });
    },
  );

  test('GET reads the prefs for the app, with the bearer', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      _json(<String, Object?>{
        'app_id': 'demo',
        'email_opt_in': false,
        'lead_days': 3,
      }),
    );
    final core.Result<core.ReminderPrefs> r = await _transport(
      adapter,
    ).readPrefs(appId: 'demo', accessToken: 'tok');
    expect(
      r.fold((core.ReminderPrefs v) => v, (_) => null),
      core.ReminderPrefs.defaults,
    );
    final RequestOptions req = adapter.lastRequest!;
    expect(req.method, 'GET');
    expect(req.uri.toString(), '$_base/v1/reminders/prefs?app_id=demo');
    expect(req.headers['authorization'], 'Bearer tok');
  });

  test('a 2xx that is not a preference is a failure', () async {
    for (final String body in <String>[
      '[]',
      _json(<String, Object?>{'email_opt_in': 'yes', 'lead_days': 3}),
    ]) {
      final core.Result<core.ReminderPrefs> r = await _transport(
        _FakeAdapter(body),
      ).readPrefs(appId: 'demo', accessToken: 'tok');
      expect(r.isOk, isFalse, reason: body);
    }
  });

  test('POST feed parses both URLs', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      _json(<String, Object?>{
        'app_id': 'demo',
        'https_url': '$_base/v1/calendar/abc.ics',
        'webcal_url': 'webcal://platform.example.test/v1/calendar/abc.ics',
        'created_at': '2026-09-29T00:00:00.000Z',
      }),
      status: 201,
    );
    final core.Result<core.CalendarFeed> r = await _transport(
      adapter,
    ).mintCalendarFeed(appId: 'demo', accessToken: 'tok');

    final core.CalendarFeed feed = r.fold(
      (core.CalendarFeed v) => v,
      (core.Failure f) => fail('$f'),
    );
    expect(feed.httpsUrl, Uri.parse('$_base/v1/calendar/abc.ics'));
    expect(
      feed.webcalUrl,
      Uri.parse('webcal://platform.example.test/v1/calendar/abc.ics'),
    );
    final RequestOptions req = adapter.lastRequest!;
    expect(req.method, 'POST');
    expect(req.uri.toString(), '$_base/v1/calendar/feed');
    expect(req.headers['authorization'], 'Bearer tok');
    expect(req.data, <String, Object?>{'app_id': 'demo'});
  });

  test('a feed offering an http: URL is refused', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      _json(<String, Object?>{
        'app_id': 'demo',
        'https_url': 'http://platform.example.test/v1/calendar/abc.ics',
        'webcal_url': 'webcal://platform.example.test/v1/calendar/abc.ics',
      }),
      status: 201,
    );
    final core.Result<core.CalendarFeed> r = await _transport(
      adapter,
    ).mintCalendarFeed(appId: 'demo', accessToken: 'tok');
    expect(r.isOk, isFalse);
  });

  test('no session and an out-of-range lead never reach the network', () async {
    final _FakeAdapter adapter = _FakeAdapter('{}');
    final DioReminderChannelsTransport t = _transport(adapter);
    for (final String? token in <String?>[null, '']) {
      expect(
        (await t.readPrefs(appId: 'demo', accessToken: token)).isOk,
        isFalse,
      );
      expect(
        (await t.writePrefs(
          appId: 'demo',
          accessToken: token,
          emailOptIn: true,
        )).isOk,
        isFalse,
      );
      expect(
        (await t.mintCalendarFeed(appId: 'demo', accessToken: token)).isOk,
        isFalse,
      );
    }
    expect(
      (await t.writePrefs(
        appId: 'demo',
        accessToken: 'tok',
        emailOptIn: true,
        leadDays: 31,
      )).isOk,
      isFalse,
    );
    expect(adapter.calls, 0);
  });
}
