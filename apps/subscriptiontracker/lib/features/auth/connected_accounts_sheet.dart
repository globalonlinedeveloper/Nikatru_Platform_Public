import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthProviders;
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../state/providers.dart';

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
      onLink: (core.SignInMethod m) => switch (m) {
        core.SignInMethod.apple => auth.linkAppleIdentity(),
        core.SignInMethod.google => auth.linkGoogleIdentity(),
        // Never offered (`SignInMethod.linkable`): a password is set through
        // the reset flow. Refused, never a silent no-op.
        core.SignInMethod.password => throw core.AuthFailure(
          'A password is set from the password reset.',
        ),
      },
      onUnlink: auth.unlinkIdentity,
    );
  }
}
