import 'dart:math';

/// A RFC-4122 version-4 UUID from a cryptographically secure source.
///
/// Pure Dart on purpose: `event_id` is the exactly-once key for analytics
/// ingestion ([ADR 011]) and `core` must stay dependency-free, so this is ~10
/// lines rather than a `uuid` package dependency in the one package every app
/// and every stamped clone inherits.
String uuidV4([Random? rng]) {
  final Random r = rng ?? Random.secure();
  final List<int> b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  final String hex =
      b.map((int x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
