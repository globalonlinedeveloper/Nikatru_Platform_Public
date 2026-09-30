import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AuthBrand, AuthBrandPanel;

import '../../l10n/app_localizations.dart';

/// ⏱ 2026-09-29 · ST-D10. This app's words for the shared auth frame: the
/// brand lockup above every auth form, and the promise the wide split
/// (`DesktopSignIn`, 1200 dp and up) carries on its leading side. The frame,
/// the split and every colour are `packages/design_system`'s `AuthFrame`; only
/// the copy is domain, so only the copy lives here.
AuthBrand authBrandOf(BuildContext context) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return AuthBrand(mark: l10n.authBrandMark, name: l10n.appTitle);
}

class AuthPanel extends StatelessWidget {
  const AuthPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AuthBrandPanel(
      brand: authBrandOf(context),
      headline: l10n.authPanelHeadline,
      body: l10n.authPanelBody,
      footnote: l10n.authPanelFootnote,
    );
  }
}
