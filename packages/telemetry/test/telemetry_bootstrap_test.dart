// Tests for the `beforeSend` choke point, driven through
// `TelemetryBootstrap.scrubEvent`.
//
// 🔴 THESE MUST BUILD THE EVENT BY HAND (2026-08-01 full-corpus triage #12).
// The obvious way to "test" this is to call a TelemetryClient method and assert
// the resulting event is clean — but `captureMessage`/`addBreadcrumb` never
// populate `tags`, `extra` or `breadcrumb.data` at all, so such a test passes
// against a scrubber that ignores all three. Every case below therefore starts
// from a SentryEvent whose map-bearing fields are POPULATED, which is the only
// shape that can distinguish "scrubbed" from "never present".
//
// All fixtures are obviously synthetic (`example.invalid`, sequential digits).
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/src/pii_scrubber.dart';
import 'package:nikatru_telemetry/src/telemetry_bootstrap.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

void main() {
  group('TelemetryBootstrap.scrubEvent', () {
    test('scrubs the message and its template', () {
      final event = SentryEvent(
        message: SentryMessage(
          'otp sent to 98765 43210',
          template: 'otp sent to %s',
        ),
      );

      final out = TelemetryBootstrap.scrubEvent(event);

      expect(out.message!.formatted, contains(redactedToken));
      expect(out.message!.formatted, isNot(contains('98765')));
    });

    test('scrubs exception values', () {
      final event = SentryEvent(
        exceptions: <SentryException>[
          SentryException(
            type: 'StateError',
            value: 'lookup failed for qa.tester@example.invalid',
          ),
        ],
      );

      final out = TelemetryBootstrap.scrubEvent(event);

      expect(out.exceptions!.single.value, contains(redactedToken));
      expect(
        out.exceptions!.single.value,
        isNot(contains('qa.tester@example.invalid')),
      );
    });

    test('scrubs event.tags', () {
      final event = SentryEvent(
        tags: <String, String>{
          'signup_channel': 'referral',
          'account_hint': 'qa.tester@example.invalid',
        },
      );

      final out = TelemetryBootstrap.scrubEvent(event);

      expect(out.tags!['account_hint'], contains(redactedToken));
      expect(
        out.tags!['account_hint'],
        isNot(contains('qa.tester@example.invalid')),
      );
      // Non-PII tags and the key set survive untouched.
      expect(out.tags!['signup_channel'], 'referral');
      expect(out.tags!.keys,
          containsAll(<String>['signup_channel', 'account_hint']));
    });

    test('scrubs event.extra, including nested maps and lists', () {
      final event = SentryEvent(
        // ignore: deprecated_member_use
        extra: <String, dynamic>{
          'support_note': 'reply to qa.tester@example.invalid',
          'retries': 2,
          'profile': <String, dynamic>{'mobile': '98765 43210'},
          'audit': <dynamic>['aadhaar 1111-2222-3333', 7],
        },
      );

      final out = TelemetryBootstrap.scrubEvent(event);
      // ignore: deprecated_member_use
      final extra = out.extra!;

      expect(extra['support_note'], contains(redactedToken));
      expect(extra['support_note'], isNot(contains('example.invalid')));
      // Non-string leaves and structure are preserved.
      expect(extra['retries'], 2);

      final profile = extra['profile'] as Map<String, dynamic>;
      expect(profile['mobile'], contains(redactedToken));
      expect(profile['mobile'], isNot(contains('98765')));

      final audit = extra['audit'] as List<Object?>;
      expect(audit.first, contains(redactedToken));
      expect(audit.first, isNot(contains('1111')));
      expect(audit.last, 7);
    });

    test('scrubs breadcrumb.data as well as breadcrumb.message', () {
      final event = SentryEvent(
        breadcrumbs: <Breadcrumb>[
          Breadcrumb(
            message: 'resend otp to 98765 43210',
            category: 'auth',
            data: <String, dynamic>{
              'endpoint': '/v1/otp',
              'msisdn': '+91 98765 43210',
              'requested_by': 'qa.tester@example.invalid',
            },
          ),
        ],
      );

      final out = TelemetryBootstrap.scrubEvent(event);
      final crumb = out.breadcrumbs!.single;

      expect(crumb.message, contains(redactedToken));
      expect(crumb.data!['msisdn'], contains(redactedToken));
      expect(crumb.data!['msisdn'], isNot(contains('98765')));
      expect(crumb.data!['requested_by'], contains(redactedToken));
      // A non-PII crumb field is untouched, so the walk is not blanket-nuking.
      expect(crumb.data!['endpoint'], '/v1/otp');
    });

    test('an event with no map surfaces is returned unchanged, not dropped',
        () {
      final event = SentryEvent(message: SentryMessage('checkout tapped'));

      final out = TelemetryBootstrap.scrubEvent(event);

      expect(out, same(event));
      expect(out.message!.formatted, 'checkout tapped');
      expect(out.tags, isNull);
      // ignore: deprecated_member_use
      expect(out.extra, isNull);
    });
  });
}
