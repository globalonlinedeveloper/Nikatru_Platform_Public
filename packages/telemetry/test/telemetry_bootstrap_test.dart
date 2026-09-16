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
import 'package:nikatru_telemetry/src/telemetry_config.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

const TelemetryConfig _config = TelemetryConfig(
  dsn: 'https://publickey@glitchtip.example.invalid/7',
  release: 'probe@1.0.0+abc1234',
  environment: 'test',
);

void main() {
  // ── THE OPTIONS THEMSELVES, NOT THE LINE THAT SPELLS THEM ────────────────
  //
  // 🔴 O-CRASH-EVENT-IP-DROP, owner ruling 2026-09-15: a crash report carries
  // NO IP address, truncated or not. On the client the whole of that promise
  // rests on ONE assignment — `options.sendDefaultPii = false`, which is what
  // stops the SDK setting `user.ip_address = "{{auto}}"` and asking the ingest
  // to resolve one on its behalf.
  //
  // Until today NOTHING IN THIS SUITE CALLED `optionsCallback` AT ALL. Every
  // case below the next group drives `scrubEvent` with a hand-built event, so
  // the suite was fully green over a bootstrap that never installed
  // `beforeSend` and never turned default PII off. The one thing standing
  // between an edit and a silent regression was the LINE-TEXT ANCHOR in
  // tooling/ci/assert-sworn-store-files.mjs — a citation-integrity guard that
  // asks whether the sworn Play declaration still matches a string in the
  // source, not a test of what the SDK is configured to do. These cases make it
  // two independent nets: one on the text, one on the behaviour.
  group('TelemetryBootstrap.optionsCallback — the privacy posture', () {
    // 🔴 THE FLAG IS SET TO `true` FIRST, AND THAT IS THE WHOLE CASE.
    // MEASURED 2026-09-16 on the pinned sentry_flutter: `SentryFlutterOptions()`
    // is born with `sendDefaultPii == false`. So the obvious test — construct
    // the options, run the callback, assert false — PASSES AGAINST A CALLBACK
    // THAT DOES NOTHING AT ALL, and would go on passing if the assignment were
    // deleted tomorrow. An assertion that cannot fail is worse than none. The
    // pre-set is the input that makes this case able to go red, and the
    // `isTrue` line below is its own positive control: if a future SDK makes
    // the field read-only or ignores the write, that line fails rather than
    // the case quietly becoming vacuous again.
    test('never attaches default PII, so no IP is sent or inferred', () async {
      final options = SentryFlutterOptions()..sendDefaultPii = true;
      expect(options.sendDefaultPii, isTrue,
          reason: 'the pre-set did not take, so the assertion below could pass '
              'over a callback that assigns nothing');

      await TelemetryBootstrap.optionsCallback(_config, isWeb: false)(options);

      expect(options.sendDefaultPii, isFalse);
    });

    // Same shape, same reason — except that here the SDK default really is ON
    // (measured the same day), so the pre-set is belt and braces rather than
    // load-bearing. It is written the same way so the two cases cannot drift
    // into meaning different things.
    test('leaves auto session tracking off', () async {
      final options = SentryFlutterOptions()..enableAutoSessionTracking = true;
      expect(options.enableAutoSessionTracking, isTrue);

      await TelemetryBootstrap.optionsCallback(_config, isWeb: false)(options);

      expect(options.enableAutoSessionTracking, isFalse);
    });

    test('wires beforeSend, and it routes through scrubEvent', () async {
      final options = SentryFlutterOptions();
      expect(options.beforeSend, isNull);

      await TelemetryBootstrap.optionsCallback(_config, isWeb: false)(options);

      expect(options.beforeSend, isNotNull,
          reason: 'with no beforeSend every event reaches the sink unscrubbed');
      final event = SentryEvent(
        message: SentryMessage('connect failed to 198.18.7.9'),
        tags: <String, String>{'peer': '2001:db8::1'},
      );

      final out = await options.beforeSend!(event, Hint());

      expect(out, isNotNull, reason: 'the hook must scrub, never drop');
      expect(out!.message!.formatted, contains(redactedToken));
      expect(out.message!.formatted, isNot(contains('198.18')));
      expect(out.tags!['peer'], redactedToken);
    });

    test('the config it is given is passed through unaltered', () async {
      final options = SentryFlutterOptions();

      await TelemetryBootstrap.optionsCallback(_config, isWeb: false)(options);

      expect(options.dsn, _config.dsn);
      expect(options.release, _config.release);
      expect(options.environment, _config.environment);
    });
  });

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
