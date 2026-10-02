/// ⏱ 2026-10-01 · SE-04 — the sign-in methods on an account, and the ONE rule
/// for which of them may be linked or unlinked.
///
/// Stated here, in pure Dart, so the Connected accounts screen that draws the
/// buttons and every adapter that performs the call answer the same question
/// the same way — the same reason `mayLinkIdentity` lives beside it.
library;

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
