// Pure Dart PII scrubbing. This file must not import Flutter or Sentry so it
// stays trivially unit-testable and reusable anywhere (isolates, CLIs, tools).

/// Replacement token used for every redacted PII match.
const String redactedToken = '[REDACTED]';

/// Deterministic redaction of common Indian PII from free-form text.
///
/// Rules run in a fixed order so the longer identifiers are consumed before
/// the broader digit rules get a chance to partially match them:
///
/// 1. PAN (5 uppercase letters, 4 digits, 1 uppercase letter)
/// 2. Aadhaar (4+4+4 digits, groups optionally space- OR hyphen-separated)
/// 3. Email addresses
/// 4. Indian mobile numbers (optional `+91`/`91` prefix, then 10 digits,
///    optionally split 5+5 by a space or hyphen)
/// 5. IPv4 literals, dotted-quad
/// 6. IPv6 literals, full form and `::`-compressed forms
/// 7. Any leftover run of 10 or more consecutive digits (catch-all)
///
/// PAN and Aadhaar MUST run before the phone rules; otherwise the 10-digit
/// phone pattern would eat 10 of an Aadhaar's 12 digits and leak the rest.
///
/// ## Separators (2026-08-01 full-corpus triage #10/#42)
///
/// The rules used to accept only a single whitespace between groups, so the two
/// commonest human-typed forms — `1234-5678-9012` and `98765 43210` — reached
/// GlitchTip in full. Nothing else caught them either: no digit run in either
/// string is long enough for the 10+ catch-all. `privacy.html` promises crash
/// logs carry no identifiers, so that gap was a DPDP-facing defect, not cosmetics.
///
/// ## The false-positive trade — DELIBERATELY FAIL-CLOSED
///
/// A 12-digit order id is not an Aadhaar, and two adjacent 5-digit numbers are
/// not a phone number, but both are redacted here anyway. That is the chosen
/// trade, not an oversight: the cost of a false positive is ONE unreadable field
/// in a crash report, while the cost of a false negative is a reportable leak of
/// a government identifier. Telemetry never needs a raw 12-digit id to be legible.
///
/// What the rules must NOT swallow is ordinary log numerics — short ids, ISO
/// dates (`2026-08-01`, a 4-2-2 shape no rule matches), millisecond durations
/// and build numbers all survive byte-identical, and `pii_scrubber_test.dart`
/// pins that direction too. Widen a separator class only with that test in view.
///
/// ## Why an IP LITERAL is on this list (O-CRASH-EVENT-IP-DROP, 2026-09-16)
///
/// The owner ruling of 2026-09-15 is that a crash report carries NO IP address,
/// truncated or not — a /24 is still personal data under DPDP, and
/// `sites/nikatru/privacy.html` does not disclose one. Two layers already
/// enforce that for the STRUCTURED field: the SDK never attaches one
/// (`options.sendDefaultPii = false`, `telemetry_bootstrap.dart`) and the
/// self-hosted ingest is starved of every client-IP header before it can infer
/// one (the eleven-header nginx strip in front of GlitchTip). NEITHER LAYER CAN
/// SEE AN IP TYPED INTO FREE TEXT: the server-side scrubber matches on FIELD
/// NAME, not on value, so `SocketException: connect failed to 198.18.7.9` in an
/// exception value, a log message or a breadcrumb reached the sink in full. That
/// is the hole rules 5 and 6 close, and this class is the only place it CAN be
/// closed, because free text is what this class exists to read.
///
/// ### The IP false-positive trade, stated the same way as the Aadhaar one
///
/// **IPv4 is fail-closed and eats a four-part version string.** `1.2.3.4` is
/// redacted. That collision is ACCEPTED, for the identical reason the 12-digit
/// one is: an unreadable version in one crash report costs a lookup, while an
/// unredacted address is a DPDP-facing leak of the thing the owner ruled out
/// entirely. It is cheap to live with because nothing in this portfolio numbers
/// a release in four dotted parts — a release is `probe@1.0.0+abc1234`, three
/// parts and a build suffix, which no rule here touches. `pii_scrubber_test.dart`
/// pins BOTH directions: the `1.2.3.4` over-redaction, and the three-part
/// version that must survive byte-identical.
///
/// **IPv6 is deliberately NARROWER than the obvious pattern, and that is not a
/// softening.** The obvious rule — two-or-more colon-separated hex groups —
/// eats `12:30:45`, i.e. EVERY WALL-CLOCK TIME IN EVERY LOG LINE, which would
/// make crash reports unreadable in the one field people read first. So the rule
/// matches only shapes an IPv6 address actually takes: the full 8-group form, or
/// a form containing the `::` compression. A timestamp has neither, and the test
/// file pins that a `12:30:45` survives.
class PiiScrubber {
  /// Const-constructible; the scrubber is stateless and thread-safe.
  const PiiScrubber();

  /// PAN, e.g. `ABCDE1234F`.
  static final RegExp _pan = RegExp(r'\b[A-Z]{5}[0-9]{4}[A-Z]\b');

  /// Aadhaar: 12 digits as 4+4+4, each group optionally separated by a single
  /// space/whitespace OR hyphen - `1234 5678 9012`, `1234-5678-9012` and
  /// `123456789012` are all the same number. The separators are matched
  /// independently rather than back-referenced on purpose: requiring the SAME
  /// separator in both slots would drop the mixed form `1234 56789012`, which
  /// the whitespace-only rule DID catch, i.e. the tightening would have been a
  /// silent regression.
  static final RegExp _aadhaar = RegExp(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b');

  /// Email: pragmatic RFC-lite pattern (local@domain.tld).
  static final RegExp _email =
      RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');

  /// Indian mobile: optional `+91`/`91` prefix (optionally followed by a
  /// space or hyphen), then 10 digits starting with 6-9, written either solid
  /// or split 5+5 by a single space or hyphen (`98765 43210`, `98765-43210`).
  ///
  /// The digit lookarounds make the match an EXACT 10-digit token. Without them
  /// an 11-digit run was chewed down to its first ten and the remainder handed
  /// back in the clear (`98765432101` -> `[REDACTED]1`); with them the phone
  /// rule declines and [_longDigitRun] swallows the run whole.
  static final RegExp _indianPhone =
      RegExp(r'(?:\+?91[- ]?)?(?<!\d)[6-9]\d{4}[- ]?\d{5}(?!\d)');

  /// IPv4, dotted-quad. Deliberately NOT validating the octet range (0-255): a
  /// looks-like-an-IP string in free text is exactly as sensitive as a real one,
  /// and a stricter regex would hand a typo'd-but-real address straight through.
  /// The `\b` at each end keeps it off the inside of a longer dotted run.
  static final RegExp _ipv4 = RegExp(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b');

  /// IPv6 — the FULL 8-group form, or any form carrying the `::` compression.
  ///
  /// 🔴 THE OBVIOUS PATTERN IS WRONG HERE AND THE WRONGNESS IS LOUD.
  /// `(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{0,4}` — two or more colon-separated
  /// hex groups — reads `12:30:45` as an address, so every wall-clock time in
  /// every log line, breadcrumb and exception value would come back
  /// `[REDACTED]`. That is not a fail-closed trade like the 12-digit one; it is
  /// the most-read field in a crash report destroyed for a shape that is not an
  /// address. So this rule requires a shape IPv6 ACTUALLY takes:
  ///   · `2001:0db8:85a3:0000:0000:8a2e:0370:7334` — eight groups, seven colons;
  ///   · `2001:db8::1`, `fe80::`, `::1` — anything with the `::` run.
  /// `12:30:45` has neither and survives; `1:2:3:4:5:6:7:8` does not, which is
  /// correct — that IS an address.
  ///
  /// The lookarounds do the job `\b` cannot: `:` is not a word character, so
  /// `\b` would anchor in the wrong places around `::`. They exclude every
  /// alphanumeric, not merely every HEX digit, and that width is load-bearing —
  /// a hex-only lookaround reads the C++ frame `nikatru::backoff` as `::ba`
  /// followed by a non-hex `c` and redacts the middle of a symbol name. They
  /// also keep the rule off the inside of an IPv4-mapped literal, whose address
  /// half [_ipv4] has already reduced one line earlier.
  static final RegExp _ipv6 = RegExp(
    r'(?<![0-9A-Za-z_:.])'
    r'(?:'
    r'(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}'
    r'|(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?'
    r'|::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})'
    r')'
    r'(?![0-9A-Za-z_:.])',
  );

  /// Catch-all: any remaining run of 10 or more consecutive digits.
  static final RegExp _longDigitRun = RegExp(r'\d{10,}');

  /// Returns [input] with all recognized PII replaced by [redactedToken].
  ///
  /// Text with no PII is returned unchanged (byte-identical).
  String scrubText(String input) {
    if (input.isEmpty) {
      return input;
    }
    var out = input;
    // Order matters - see class docs.
    out = out.replaceAll(_pan, redactedToken);
    out = out.replaceAll(_aadhaar, redactedToken);
    out = out.replaceAll(_email, redactedToken);
    out = out.replaceAll(_indianPhone, redactedToken);
    // IPv4 before IPv6: an IPv4-mapped literal (`::ffff:198.18.7.9`) is reduced
    // to its prefix here, so the address itself never depends on the narrower
    // IPv6 rule reaching it.
    out = out.replaceAll(_ipv4, redactedToken);
    out = out.replaceAll(_ipv6, redactedToken);
    out = out.replaceAll(_longDigitRun, redactedToken);
    return out;
  }

  /// Returns a deep copy of [data] with every `String` value scrubbed via
  /// [scrubText], recursing into nested maps and lists.
  ///
  /// Keys and non-string leaf values (numbers, bools, null, ...) are kept
  /// as-is. The input map is never mutated.
  Map<String, dynamic> scrubMap(Map<String, dynamic> data) {
    final result = <String, dynamic>{};
    data.forEach((key, value) {
      result[key] = _scrubValue(value);
    });
    return result;
  }

  Object? _scrubValue(Object? value) {
    if (value is String) {
      return scrubText(value);
    }
    if (value is Map<String, dynamic>) {
      return scrubMap(value);
    }
    if (value is Map) {
      // Defensive: normalize untyped maps before recursing.
      return scrubMap(
        value.map<String, dynamic>((k, v) => MapEntry(k.toString(), v)),
      );
    }
    if (value is List) {
      return value.map<Object?>(_scrubValue).toList();
    }
    return value;
  }
}
