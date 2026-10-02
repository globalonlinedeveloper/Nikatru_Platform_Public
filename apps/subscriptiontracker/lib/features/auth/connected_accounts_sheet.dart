import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show ApiException, RestClient, checkSignInMethodChange;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthProviders;
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../state/providers.dart';
import '../shared/chassis_adapters.dart' show reauthenticateUser;
import 'turnstile_gate.dart'
    show CaptchaTokenController, newCaptchaController, renderTurnstile;

/// ⏱ 2026-10-01 · SE-04 — Settings' "Connected accounts" row opens this. It
/// was inert, subtitled "Not available yet".
///
/// The ADAPTER half: the view (`ConnectedAccountsView`) decides every button
/// by `core.mayLinkMethod` / `core.mayUnlinkMethod`; this supplies the user,
/// the methods THIS build can link — the platform can take the redirect AND
/// the server accepts the provider, the same two answers the sign-in screen
/// asks — and the two seam calls.
///
/// 🔴 A FILE OF ITS OWN, AND NOT UNDER `features/settings/`.
/// `tooling/ci/chassis-delegation.mjs` reads a routed screen that imports
/// exactly one `package:nikatru_chassis_screens/…` path as a screen emptied
/// into it — the reason `auth_error_sentence.dart` exists — and
/// `assert-deletion-control` / `assert-consent-withdrawal-surface` union every
/// delegating file under `features/settings/` into the settings surface they
/// judge. This sheet is neither of those controls; it is an auth surface.
Future<void> showConnectedAccountsSheet(BuildContext context) =>
    showAdaptiveSheet<void>(
      context: context,
      builder: (_) => const ConnectedAccountsSheet(),
    );

/// The sheet's body. Public so a test can pump it without a route.
class ConnectedAccountsSheet extends ConsumerWidget {
  const ConnectedAccountsSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
    final AuthProviders providers = ref.watch(authProvidersProvider);
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final core.AuthUser? user =
        ref.watch(authUserProvider).value ?? auth.currentUser;
    return ConnectedAccountsView(
      user: user,
      available: <core.SignInMethod>{
        if (caps.oauthRedirect && providers.apple) core.SignInMethod.apple,
        if (caps.oauthRedirect && providers.google) core.SignInMethod.google,
      },
      // ⏱ 2026-10-02 · review of #1155, finding 3. Both go through
      // `core.guardSignInMethodChange`: a sign-in older than five minutes asks
      // for the password or the provider again, and the server re-checks the
      // token's own sign-in time before anything changes. This was one tap
      // from an unlocked phone, and a linked identity is a way in that
      // survives a password change.
      onLink: (core.SignInMethod m) => _guarded<void>(
        context,
        ref,
        user,
        () => switch (m) {
          core.SignInMethod.apple => auth.linkAppleIdentity(),
          core.SignInMethod.google => auth.linkGoogleIdentity(),
          // Never offered (`SignInMethod.linkable`): a password is set through
          // the reset flow. Refused, never a silent no-op.
          core.SignInMethod.password => throw core.AuthFailure(
            'A password is set from the password reset.',
          ),
        },
      ),
      onUnlink: (core.SignInMethod m) => _guarded<core.AuthUser>(
        context,
        ref,
        user,
        () => auth.unlinkIdentity(m),
      ),
    );
  }
}

Future<T> _guarded<T>(
  BuildContext context,
  WidgetRef ref,
  core.AuthUser? user,
  Future<T> Function() change,
) => core.guardSignInMethodChange<T>(
  user: user,
  reauthenticate: () => context.mounted
      ? ref.read(signInMethodReauthProvider)(context)
      : Future<bool>.value(false),
  serverCheck: ref.read(signInMethodServerCheckProvider),
  change: change,
);

/// How a stale session proves it is the owner before a sign-in method
/// changes: the password, or the provider's sheet ([reauthenticateUser], the
/// same prompt the rooted-device export gate uses). A provider so a test can
/// answer it without a password dialog or a browser.
final Provider<Future<bool> Function(BuildContext)> signInMethodReauthProvider =
    Provider<Future<bool> Function(BuildContext)>(
      (ref) => (BuildContext context) async {
        final CaptchaTokenController captcha = newCaptchaController();
        try {
          return await reauthenticateUser(
            context,
            auth: ref.read(authRepositoryProvider),
            captcha: captcha,
            renderTurnstile: renderTurnstile,
          );
        } finally {
          captcha.dispose();
        }
      },
    );

/// The server's half, as a provider for the same reason.
final Provider<Future<void> Function()> signInMethodServerCheckProvider =
    Provider<Future<void> Function()>(
      (ref) =>
          () => confirmSignInMethodChangeAtServer(
            ref.read(platformRestClientProvider),
          ),
    );

/// ⏱ 2026-10-02 · review of #1155, finding 3 — the server's half of the
/// re-authentication: `POST /account/identity-change` reads the token's own
/// sign-in time. Its 403 is the auth layer's `reauth_required`, and no
/// answer at all is the network failure it is; nothing is changed after
/// either.
Future<void> confirmSignInMethodChangeAtServer(RestClient client) async {
  try {
    await checkSignInMethodChange(client);
  } on ApiException catch (e) {
    final core.AuthFailure? failure = signInMethodChangeFailureForStatus(
      e.statusCode,
      offline: e.isOffline,
    );
    if (failure != null) throw failure;
    rethrow;
  }
}

/// The route's STATUS SET is its wire contract: `assert-analytics-contract`
/// (`account-identity-change`) parses the `case`s below against every status
/// `identity-change.ts` answers, and 403 is its floor. `null` = rethrow as is.
core.AuthFailure? signInMethodChangeFailureForStatus(
  int status, {
  required bool offline,
}) {
  switch (status) {
    case 403:
      return core.AuthFailure(
        'Sign in again to change how you sign in.',
        code: core.AuthFailure.reauthRequired,
      );
  }
  if (offline) {
    return core.AuthFailure(
      'Could not reach the server.',
      code: core.AuthFailure.network,
    );
  }
  return null;
}
