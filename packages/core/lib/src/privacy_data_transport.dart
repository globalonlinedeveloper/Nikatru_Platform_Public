import 'result.dart';

/// The one person an account holder names to exercise their privacy rights
/// if they die or become incapacitated (India's DPDP Act s.14) — a name and
/// an e-mail address, nothing more. Lane dpdp-rights, Do 4.
///
/// Mirrors the platform Worker's `GET|PUT /v1/account/nominee` answer
/// (`services/platform/src/routes/account-data.ts`).
class PrivacyNominee {
  const PrivacyNominee({required this.name, required this.email});

  /// `NOMINEE_NAME_MAX` there: the host answers 422 to a longer name.
  static const int maxNameLength = 120;

  final String name;
  final String email;

  static final RegExp _email = RegExp(
    r'^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$',
  );

  /// Whether the host will accept [name] and [email] (checked here so a bad
  /// field is named on this side, not spent as a request).
  static bool isValid(String name, String email) {
    final String n = name.trim();
    return n.isNotEmpty &&
        n.runes.length <= maxNameLength &&
        _email.hasMatch(email.trim());
  }

  /// The `nominee` object of the host's answer, or null when it is not one.
  static PrivacyNominee? tryParse(Object? j) {
    if (j is! Map) return null;
    final Object? name = j['name'];
    final Object? email = j['email'];
    if (name is! String || email is! String) return null;
    return PrivacyNominee(name: name, email: email);
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'name': name.trim(),
    'email': email.trim(),
  };

  @override
  bool operator ==(Object other) =>
      other is PrivacyNominee && other.name == name && other.email == email;

  @override
  int get hashCode => Object.hash(name, email);
}

/// The client half of the DPDP access export and the nominee (lane
/// dpdp-rights, Do 3 and Do 4): `GET /v1/account/export` and
/// `GET|PUT|DELETE /v1/account/nominee` on the platform Worker.
///
/// AUTHENTICATED: each is about the signed-in PERSON; a signed-out call is
/// refused on this side.
abstract interface class PrivacyDataTransport {
  /// Everything the platform holds server-side about the signed-in account,
  /// as the JSON text of one file. [anonId] adds this install's pseudonymous
  /// rows (usage statistics and consent records).
  Future<Result<String>> exportData({
    required String? accessToken,
    String? anonId,
  });

  /// The nominee, or `Ok(null)` when none is set.
  Future<Result<PrivacyNominee?>> readNominee({required String? accessToken});

  Future<Result<PrivacyNominee>> writeNominee({
    required String? accessToken,
    required PrivacyNominee nominee,
  });

  Future<Result<void>> removeNominee({required String? accessToken});
}

/// The transport when the backend is not live: every call fails, so a screen
/// shows its "not available" state rather than inventing an answer.
class UnavailablePrivacyDataTransport implements PrivacyDataTransport {
  const UnavailablePrivacyDataTransport();

  static const Failure _off = Failure('privacy data: the backend is not live');

  @override
  Future<Result<String>> exportData({
    required String? accessToken,
    String? anonId,
  }) async => const Result<String>.err(_off);

  @override
  Future<Result<PrivacyNominee?>> readNominee({
    required String? accessToken,
  }) async => const Result<PrivacyNominee?>.err(_off);

  @override
  Future<Result<PrivacyNominee>> writeNominee({
    required String? accessToken,
    required PrivacyNominee nominee,
  }) async => const Result<PrivacyNominee>.err(_off);

  @override
  Future<Result<void>> removeNominee({required String? accessToken}) async =>
      const Result<void>.err(_off);
}
