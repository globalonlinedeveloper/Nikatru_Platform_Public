// Pure-Dart unit tests for the PII scrubber. Deliberately imports ONLY the
// scrubber (no Flutter widgets, no Sentry) so it runs fast anywhere.
//
// 🔴 EVERY FIXTURE IN THIS FILE MUST BE SYNTHETIC. NEVER PASTE A REAL IDENTIFIER.
//
// This is not a style rule, it is a repair. Until 2026-08-05 the PAN fixture below
// was the proprietor's REAL PAN, committed to this PUBLIC repository in 82a309d and
// pushed to origin/main. The Aadhaar fixtures beside it were synthetic all along —
// only the PAN was real, which is what made it easy to miss.
//
// 📌 NOTHING COULD HAVE CAUGHT IT, AND THAT IS THE POINT. .gitignore excludes
// `Personal/` precisely because "these carry PAN, salary figures and date of birth,
// and origin is a PUBLIC repository" — but that control is PATH-based, and this was
// a string literal in ordinary source. The only content scanner in CI is gitleaks,
// a CREDENTIAL scanner with no Indian-PII rule. So a green ci-gate and 100+ guards
// were all fully consistent with a PAN sitting in the public tree.
//
// And the irony is load-bearing: the test that proves PII is redacted at runtime
// was itself the disclosure. A fixture is production data the moment it is real.
//
// ABCDE1234F is the canonical documentation placeholder — correct PAN SHAPE
// (5 letters, 4 digits, 1 letter), which is all the scrubber's regex reads.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_telemetry/src/pii_scrubber.dart';

void main() {
  const scrubber = PiiScrubber();

  group('PiiScrubber.scrubText', () {
    test('redacts PAN numbers', () {
      final out = scrubber.scrubText('PAN ABCDE1234F submitted');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('ABCDE1234F')));
    });

    test('redacts Aadhaar numbers with spaces', () {
      final out = scrubber.scrubText('Aadhaar: 1234 5678 9012');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('1234 5678 9012')));
    });

    test('redacts Aadhaar numbers without spaces', () {
      final out = scrubber.scrubText('Aadhaar 123456789012 rejected');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('123456789012')));
    });

    // 🔴 HYPHENATED AADHAAR (2026-08-01 full-corpus triage #10). The two tests
    // above only ever exercised the space-separated and unseparated forms, so
    // the suite was green over a format that is printed on the card itself and
    // passed through the scrubber completely untouched — no rule matched it:
    // not Aadhaar (single `\s` separator only), not the phone rule and not the
    // 10+ digit catch-all, because no run is longer than four digits.
    test('redacts hyphen-grouped Aadhaar numbers', () {
      final out = scrubber.scrubText('Aadhaar 1111-2222-3333 on file');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('1111-2222-3333')));
      // Not one group may survive - a partial leak is still a leak.
      expect(out, isNot(contains('1111')));
      expect(out, isNot(contains('2222')));
      expect(out, isNot(contains('3333')));
    });

    test('redacts mixed-separator Aadhaar groupings', () {
      final out = scrubber.scrubText('id 1111-2222 3333 rejected');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('2222')));
    });

    test('redacts email addresses', () {
      final out = scrubber.scrubText('contact a@b.com for help');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('a@b.com')));
    });

    test('redacts +91 prefixed phone numbers', () {
      final out = scrubber.scrubText('call +91 9876543210 now');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('9876543210')));
    });

    test('redacts bare 10-digit phone numbers', () {
      final out = scrubber.scrubText('call 9876543210 now');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('9876543210')));
    });

    // 🔴 5-5 GROUPED MOBILE (2026-08-01 full-corpus triage #42). This is how an
    // Indian mobile is written everywhere a human types one, and the old rule
    // required ten CONSECUTIVE digits, so it matched nothing here - and neither
    // did the `\d{10,}` catch-all, for the same reason.
    test('redacts 5-5 space-grouped mobile numbers', () {
      final out = scrubber.scrubText('call 98765 43210 back');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('98765')));
      expect(out, isNot(contains('43210')));
    });

    test('redacts 5-5 hyphen-grouped mobile numbers', () {
      final out = scrubber.scrubText('sms to 98765-43210 failed');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('98765')));
      expect(out, isNot(contains('43210')));
    });

    test('redacts +91 prefixed 5-5 grouped mobile numbers', () {
      final out = scrubber.scrubText('otp to +91 98765 43210 timed out');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('98765')));
      expect(out, isNot(contains('43210')));
    });

    // An over-long digit run must not leave a crumb behind: the phone rule used
    // to eat exactly ten digits and hand the remainder back unredacted, so an
    // 11-digit run came out as `[REDACTED]1`.
    test('redacts an over-long digit run whole, leaving no stray digits', () {
      final out = scrubber.scrubText('ref 98765432101 closed');
      expect(out, 'ref $redactedToken closed');
    });

    test('leaves text without PII byte-identical', () {
      const control = 'User tapped checkout, cart total 499 INR';
      final out = scrubber.scrubText(control);
      expect(out, control);
      expect(out, isNot(contains(redactedToken)));
    });

    // ── The false-positive direction ────────────────────────────────────────
    // Widening the separators must not start eating ordinary log numerics.
    // Short ids, ISO dates, durations and build numbers all stay readable, or
    // the crash reports this package exists to produce become useless.
    test('leaves short numeric ids, ISO dates and durations untouched', () {
      const control =
          'order 4821 on 2026-08-01 finished in 1350 ms (build 41200)';
      final out = scrubber.scrubText(control);
      expect(out, control);
      expect(out, isNot(contains(redactedToken)));
    });

    test('leaves an 8-digit 4-4 grouping untouched', () {
      const control = 'codes 1234 5678 rotated';
      final out = scrubber.scrubText(control);
      expect(out, control);
    });

    // 🔴 THE ACCEPTED OVER-REDACTION, pinned so the trade is a test and not a
    // paragraph. The scrubber is FAIL-CLOSED on 12-digit identifiers: a 12-digit
    // order id is redacted even though it is not an Aadhaar. Documented on
    // PiiScrubber - the cost of this false positive is one unreadable field in
    // GlitchTip; the cost of the false negative is a DPDP-reportable leak.
    test('over-redacts a 12-digit non-PII identifier (accepted, fail-closed)',
        () {
      final out = scrubber.scrubText('order 480000123456 shipped');
      expect(out, 'order $redactedToken shipped');
    });

    // ── IP literals (O-CRASH-EVENT-IP-DROP, owner ruling 2026-09-15) ────────
    // The ruling is "NO IP at all". `sendDefaultPii = false` and the ingest's
    // header strip together remove the STRUCTURED field, and neither can see an
    // address typed into an exception value, a log message or a breadcrumb —
    // the server-side scrubber matches on field NAME, not on value. These are
    // the cases for that half. Every literal below is from a documentation
    // range that is NOT TEST-NET: 198.18.0.0/15 is RFC 2544 benchmarking and
    // 2001:db8::/32 is RFC 3849, chosen because the TEST-NET ranges
    // (203.0.113.x / 198.51.100.x) are DISCARDED by the ingest's own ipware and
    // so cannot appear in a live read-back either.
    test('redacts an IPv4 literal in free text', () {
      final out = scrubber.scrubText('connect failed to 198.18.7.9:443');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('198.18.7.9')));
      expect(out, isNot(contains('198.18')));
    });

    test('redacts a full 8-group IPv6 literal', () {
      final out = scrubber
          .scrubText('peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334 reset');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('2001')));
      expect(out, isNot(contains('8a2e')));
    });

    test('redacts a :: compressed IPv6 literal', () {
      final out = scrubber.scrubText('bound to 2001:db8::1 ok');
      expect(out, 'bound to $redactedToken ok');
    });

    test('redacts a bare loopback IPv6 literal', () {
      final out = scrubber.scrubText('listening on ::1 only');
      expect(out, 'listening on $redactedToken only');
    });

    // An IPv4-mapped IPv6 literal: the ADDRESS must go. The `::ffff:` mapping
    // prefix is not an address and may survive — what must not is any octet.
    test('redacts the address half of an IPv4-mapped IPv6 literal', () {
      final out = scrubber.scrubText('remote ::ffff:198.18.7.9 closed');
      expect(out, contains(redactedToken));
      expect(out, isNot(contains('198.18.7.9')));
      expect(out, isNot(contains('18.7')));
    });

    // 🔴 THE ACCEPTED IP OVER-REDACTION, pinned so the trade is a test and not a
    // paragraph — exactly as the 12-digit one above is. A four-part dotted
    // version is redacted because it is shaped like an address. Documented on
    // PiiScrubber: nothing in this portfolio numbers a release in four dotted
    // parts, and an unreadable version costs a lookup while an unredacted
    // address is the leak the owner ruled out entirely.
    test('over-redacts a four-part dotted version (accepted, fail-closed)', () {
      final out = scrubber.scrubText('engine 1.2.3.4 started');
      expect(out, 'engine $redactedToken started');
    });

    // ── The IP false-positive direction ────────────────────────────────────
    // 🔴 THE ONE THE OBVIOUS IPv6 REGEX GETS WRONG. A rule of "two or more
    // colon-separated hex groups" reads 12:30:45 as an address, i.e. EVERY
    // wall-clock time in every log line. That is not the fail-closed trade the
    // 12-digit rule makes; it is the most-read field in a crash report
    // destroyed over a shape that is not an address. The rule therefore
    // requires the full 8-group form or the `::` compression, and this case is
    // what holds it there.
    test('leaves a wall-clock time untouched', () {
      const control = 'retry scheduled at 12:30:45 after 2 failures';
      final out = scrubber.scrubText(control);
      expect(out, control);
      expect(out, isNot(contains(redactedToken)));
    });

    test('leaves an ISO-8601 instant untouched', () {
      const control = 'window closed 2026-09-16T12:30:45Z';
      final out = scrubber.scrubText(control);
      expect(out, control);
    });

    test('leaves a three-part release string untouched', () {
      const control = 'release 1.0.0+abc1234 on channel beta';
      final out = scrubber.scrubText(control);
      expect(out, control);
      expect(out, isNot(contains(redactedToken)));
    });

    // A `::`-bearing native symbol is not an address. The lookarounds exclude
    // every alphanumeric rather than every hex digit for exactly this string:
    // a hex-only lookaround matches `::ba` here and redacts the middle of it.
    test('leaves a C++-style scoped symbol untouched', () {
      const control = 'thrown from nikatru::backoff::retry';
      final out = scrubber.scrubText(control);
      expect(out, control);
      expect(out, isNot(contains(redactedToken)));
    });

    test('leaves a host:port with no address untouched', () {
      const control = 'GET glitchtip.nikatru.com:443 timed out';
      final out = scrubber.scrubText(control);
      expect(out, control);
    });
  });

  group('PiiScrubber.scrubMap', () {
    test('scrubs nested string values and preserves structure', () {
      final out = scrubber.scrubMap(<String, dynamic>{
        'note': 'mail a@b.com',
        'count': 3,
        'nested': <String, dynamic>{'phone': '+91 9876543210'},
        'list': <dynamic>['9876543210', 42],
      });

      expect(out['note'], contains(redactedToken));
      expect(out['count'], 3);

      final nested = out['nested'] as Map<String, dynamic>;
      expect(nested['phone'], contains(redactedToken));

      final list = out['list'] as List<Object?>;
      expect(list.first, contains(redactedToken));
      expect(list.last, 42);
    });

    test('scrubs IP literals nested in maps and lists', () {
      final out = scrubber.scrubMap(<String, dynamic>{
        'endpoint': '/v1/sync',
        'detail': 'no route to 198.18.7.9',
        'peers': <dynamic>['2001:db8::1', 8080],
      });

      expect(out['detail'], contains(redactedToken));
      expect(out['detail'], isNot(contains('198.18')));
      final peers = out['peers'] as List<Object?>;
      expect(peers.first, redactedToken);
      expect(peers.last, 8080);
      // A non-PII field is untouched, so the walk is not blanket-nuking.
      expect(out['endpoint'], '/v1/sync');
    });
  });
}
