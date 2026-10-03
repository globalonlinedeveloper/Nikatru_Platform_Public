/// ⏱ 2026-10-01 · EN-21 — the e-mail one-time sign-in code: its shape, and
/// the per-address cooldown that keeps it from starving password resets.
///
/// 🔴 WHY A CLIENT COOLDOWN AT ALL. Every send is one auth mail out of the
/// sign-in container's quota (GoTrue `rate_limit_email_sent`), the SAME quota
/// a password reset spends. GoTrue's own limiter and the native limiters still
/// apply; this is the cheap half that stops one impatient tap-tap-tap from
/// spending three mails, and it survives a reload because it is persisted.
library;

/// How long after a send the same address may be sent another code.
const Duration emailCodeCooldown = Duration(seconds: 60);

/// GoTrue's default `GOTRUE_MAILER_OTP_LENGTH`.
const int emailCodeLength = 6;

/// Whether [code] is the shape of a code (exactly [emailCodeLength] digits,
/// spaces ignored) — checked before a request, never instead of one.
bool isEmailCodeShape(String code) =>
    RegExp('^[0-9]{$emailCodeLength}\$').hasMatch(code.replaceAll(' ', ''));

/// When each address was last sent a code, keyed by a HASH of the address —
/// what is persisted is a cooldown, not a list of the addresses typed here.
class EmailCodeCooldown {
  EmailCodeCooldown._(this._sentAtMs);

  /// An empty ledger.
  EmailCodeCooldown() : _sentAtMs = <String, int>{};

  /// The key the app's key-value store keeps [encode]'s output under.
  static const String storageKey = 'nikatru.auth.email_code_sent';

  final Map<String, int> _sentAtMs;

  /// Reads [encode]'s output back. Anything unreadable is an empty ledger:
  /// the worst a corrupt value can do is allow one send early, and GoTrue's
  /// own limiter still stands behind it.
  factory EmailCodeCooldown.decode(String? raw) {
    final Map<String, int> out = <String, int>{};
    for (final String entry in (raw ?? '').split(',')) {
      final int eq = entry.indexOf('=');
      if (eq <= 0) continue;
      final int? at = int.tryParse(entry.substring(eq + 1));
      if (at != null) out[entry.substring(0, eq)] = at;
    }
    return EmailCodeCooldown._(out);
  }

  /// The ledger as one string, expired entries dropped.
  String encode(DateTime now) {
    _prune(now);
    return <String>[
      for (final MapEntry<String, int> e in _sentAtMs.entries)
        '${e.key}=${e.value}',
    ].join(',');
  }

  /// How long [email] must still wait; [Duration.zero] when it may send now.
  Duration remaining(String email, DateTime now) {
    final int? at = _sentAtMs[_keyOf(email)];
    if (at == null) return Duration.zero;
    final Duration left = DateTime.fromMillisecondsSinceEpoch(
      at,
      isUtc: true,
    ).add(emailCodeCooldown).difference(now.toUtc());
    return left.isNegative ? Duration.zero : left;
  }

  /// Records a send to [email] at [now].
  void record(String email, DateTime now) {
    _prune(now);
    _sentAtMs[_keyOf(email)] = now.toUtc().millisecondsSinceEpoch;
  }

  void _prune(DateTime now) {
    final int cutoff = now
        .toUtc()
        .subtract(emailCodeCooldown)
        .millisecondsSinceEpoch;
    _sentAtMs.removeWhere((String _, int at) => at <= cutoff);
  }

  /// FNV-1a over the normalised address: stable across runs and platforms
  /// (`String.hashCode` is neither), and not the address itself.
  static String _keyOf(String email) {
    int h = 0x811c9dc5;
    for (final int c in email.trim().toLowerCase().codeUnits) {
      h ^= c;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return h.toRadixString(16);
  }
}
