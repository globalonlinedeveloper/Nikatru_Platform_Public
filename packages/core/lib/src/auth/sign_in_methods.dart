/// ⏱ 2026-10-01 · SE-04 — the sign-in methods on an account, and the ONE rule
/// for which of them may be linked or unlinked.
///
/// Stated here, in pure Dart, so the Connected accounts screen that draws the
/// buttons and every adapter that performs the call answer the same question
/// the same way — the same reason `mayLinkIdentity` lives beside it.
library;

import 'account_deletion.dart' show kProviderReauthFreshness;
import 'auth_models.dart';
import 'identity_assurance.dart';

/// A way into an account. [id] is the provider name GoTrue writes into
/// `app_metadata.providers` (`email` is the password identity).
enum SignInMethod {
  password('email'),
  apple('apple'),
  google('google');

  const SignInMethod(this.id);

  final String id;

  /// The methods an account can LINK from the app: OAuth, with link intent.
  /// A password is set through the reset flow, never linked here.
  bool get linkable => this != SignInMethod.password;
}

/// Every method [user] can sign in with today, in [SignInMethod] order.
/// Empty for no user.
List<SignInMethod> signInMethodsOf(AuthUser? user) {
  if (user == null) return const <SignInMethod>[];
  return <SignInMethod>[
    if (user.hasPasswordIdentity) SignInMethod.password,
    for (final SignInMethod m in SignInMethod.values)
      if (m.linkable && user.oauthProviders.contains(m.id)) m,
  ];
}

/// Whether [method] may be linked to [user]: not already on the account, a
/// linkable kind, and — the takeover rule — only from a verified address.
bool mayLinkMethod(AuthUser? user, SignInMethod method) =>
    method.linkable &&
    mayLinkIdentity(user) &&
    !signInMethodsOf(user).contains(method);

/// Whether [method] may be unlinked from [user].
///
/// 🔴 NEVER THE LAST METHOD. An account with one way in that loses it is an
/// account nobody can open again — support cannot tell its owner from anyone
/// else who asks. GoTrue refuses it too (`single_identity_not_deletable`),
/// and this does not lean on that: the button is never drawn.
///
/// ⚠️ ONLY AN OAUTH METHOD. Removing the password identity strands the
/// address the account is known by; it is not offered from this screen.
bool mayUnlinkMethod(AuthUser? user, SignInMethod method) {
  final List<SignInMethod> methods = signInMethodsOf(user);
  return method.linkable && methods.contains(method) && methods.length > 1;
}

/// ⏱ 2026-10-02 · review of #1155, finding 3 — A SIGN-IN METHOD IS ADDED OR
/// REMOVED ONLY BY A PERSON WHO HAS JUST PROVED WHO THEY ARE.
///
/// Linking an identity adds a PERSISTENT way in, one that survives the owner
/// changing their password; unlinking removes one of the owner's. Both were
/// one tap from an unlocked, signed-in device — the exact borrower the app
/// lock exists for. So, in this order, and [change] runs only after all three:
///   1. a sign-in older than [freshness] (the deletion path's five minutes,
///      [kProviderReauthFreshness]) asks [reauthenticate] — the password, or
///      the provider's sheet — and a cancel or a failure refuses;
///   2. the SERVER is asked ([serverCheck], `POST /account/identity-change`),
///      which reads the token's own `amr` time and answers 403
///      `reauth_required` to a stale session — this function's word is not
///      taken for it;
///   3. [change].
/// A refusal throws [AuthFailure] with code [AuthFailure.reauthRequired],
/// and nothing was changed.
Future<T> guardSignInMethodChange<T>({
  required AuthUser? user,
  required Future<bool> Function() reauthenticate,
  required Future<void> Function() serverCheck,
  required Future<T> Function() change,
  DateTime Function() now = DateTime.now,
  Duration freshness = kProviderReauthFreshness,
}) async {
  if (user == null) {
    throw AuthFailure('Not signed in', code: AuthFailure.reauthRequired);
  }
  final DateTime? last = user.lastSignInAt;
  final bool fresh =
      last != null && now().toUtc().difference(last.toUtc()) < freshness;
  if (!fresh && !await reauthenticate()) {
    throw AuthFailure(
      'Sign in again to change how you sign in.',
      code: AuthFailure.reauthRequired,
    );
  }
  await serverCheck();
  return change();
}
