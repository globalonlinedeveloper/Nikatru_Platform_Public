import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ⏱ 2026-10-01 · EN-21 — the code's shape and the per-address cooldown.
void main() {
  final DateTime t0 = DateTime.utc(2026, 10, 1, 12);

  test('a code is six digits, spaces ignored', () {
    expect(isEmailCodeShape('123456'), isTrue);
    expect(isEmailCodeShape('123 456'), isTrue);
    expect(isEmailCodeShape('12345'), isFalse);
    expect(isEmailCodeShape('1234567'), isFalse);
    expect(isEmailCodeShape('12345a'), isFalse);
  });

  group('the cooldown', () {
    test('holds for 60 s for that address, and only that address', () {
      final EmailCodeCooldown c = EmailCodeCooldown()..record('A@x.com', t0);
      expect(c.remaining('a@x.com ', t0), emailCodeCooldown);
      expect(
        c.remaining('a@x.com', t0.add(const Duration(seconds: 45))),
        const Duration(seconds: 15),
      );
      expect(c.remaining('a@x.com', t0.add(emailCodeCooldown)), Duration.zero);
      expect(c.remaining('b@x.com', t0), Duration.zero);
    });

    test('🔴 survives a reload: encode → decode keeps the wait', () {
      final String saved = (EmailCodeCooldown()..record('a@x.com', t0)).encode(
        t0.add(const Duration(seconds: 10)),
      );
      final EmailCodeCooldown reloaded = EmailCodeCooldown.decode(saved);
      expect(
        reloaded.remaining('a@x.com', t0.add(const Duration(seconds: 10))),
        const Duration(seconds: 50),
      );
    });

    test('stores no address, and drops what has expired', () {
      final EmailCodeCooldown c = EmailCodeCooldown()
        ..record('a@x.com', t0)
        ..record('b@x.com', t0.add(const Duration(seconds: 30)));
      final String saved = c.encode(t0.add(const Duration(seconds: 61)));
      expect(saved, isNot(contains('@')));
      expect(saved.split(','), hasLength(1));
    });

    test('an unreadable value is an empty ledger', () {
      expect(
        EmailCodeCooldown.decode('garbage,=1,x=y').remaining('a@x.com', t0),
        Duration.zero,
      );
      expect(EmailCodeCooldown.decode(null).encode(t0), isEmpty);
    });
  });
}
