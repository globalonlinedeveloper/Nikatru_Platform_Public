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
/// 5. Any leftover run of 10 or more consecutive digits (catch-all)
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
