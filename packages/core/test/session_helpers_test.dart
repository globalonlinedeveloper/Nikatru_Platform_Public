// sessionIdOfAccessToken and emailChangeCompleted — the two reads the settings
// change and the e-mail-change sign-out stand on (review of #1129, findings 5
// and 2).
import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

String _jwt(Map<String, Object?> claims) {
  String part(Object o) =>
      base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${part(<String, String>{'alg': 'ES256'})}.${part(claims)}.sig';
}

AuthUser _user(String id, String email) => AuthUser(id: id, email: email);

void main() {
  group('sessionIdOfAccessToken', () {
    test('reads the session_id claim', () {
      expect(
        sessionIdOfAccessToken(_jwt(<String, Object?>{'session_id': 's-1'})),
        's-1',
      );
    });

    test('is null for no token, a non-JWT, junk, or no claim', () {
      expect(sessionIdOfAccessToken(null), isNull);
      expect(sessionIdOfAccessToken('tok'), isNull);
      expect(sessionIdOfAccessToken('a.%%%.c'), isNull);
      expect(
        sessionIdOfAccessToken(_jwt(<String, Object?>{'sub': 'u'})),
        isNull,
      );
      expect(
        sessionIdOfAccessToken(_jwt(<String, Object?>{'session_id': 7})),
        isNull,
      );
    });
  });

  group('emailChangeCompleted', () {
    test('🔴 the same account under a new address is a completed change', () {
      expect(
        emailChangeCompleted(
          _user('u1', 'old@test.dev'),
          _user('u1', 'new@test.dev'),
        ),
        isTrue,
      );
    });

    test('a different account, a case change, or a missing side is not', () {
      expect(
        emailChangeCompleted(
          _user('u1', 'old@test.dev'),
          _user('u2', 'new@test.dev'),
        ),
        isFalse,
      );
      expect(
        emailChangeCompleted(
          _user('u1', 'Ada@test.dev'),
          _user('u1', 'ada@test.dev'),
        ),
        isFalse,
      );
      expect(emailChangeCompleted(null, _user('u1', 'a@test.dev')), isFalse);
      expect(emailChangeCompleted(_user('u1', 'a@test.dev'), null), isFalse);
    });
  });
}
