import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../auth/auth_error_text.dart';

/// ⏱ 2026-10-01 · SE-04 — "Connected accounts": the ways into this account,
/// one row each, with Connect (OAuth with link intent) and Remove.
///
/// It was an inert Settings row reading "Not available yet". Every decision
/// about WHICH button a row gets is `core.mayLinkMethod` / `core.mayUnlinkMethod`
/// — the same rule both adapters refuse by — so this view cannot offer a call
/// the seam would refuse.
///
/// 🔴 NEVER THE LAST METHOD. A row that is the account's only way in draws no
/// Remove button and says why, rather than drawing one that fails.
///
/// The ADAPTER supplies [available]: the OAuth methods THIS build can complete
/// (the platform can take the redirect and the server accepts the provider).
/// A method the account already holds is listed whether or not it is
/// available here, so a user can always see what their account carries.
class ConnectedAccountsView extends StatefulWidget {
  const ConnectedAccountsView({
    required this.user,
    required this.available,
    required this.onLink,
    required this.onUnlink,
    super.key,
  });

  /// The signed-in account, or null (nothing to show but the heading).
  final core.AuthUser? user;

  /// The OAuth methods this build can link.
  final Set<core.SignInMethod> available;

  /// Starts the link — a browser hop whose result arrives on the auth stream.
  final Future<void> Function(core.SignInMethod method) onLink;

  /// Removes [method]; resolves to the account as it is afterwards.
  final Future<core.AuthUser> Function(core.SignInMethod method) onUnlink;

  static const Key statusLine = Key('connectedAccountsStatus');
  static Key row(core.SignInMethod m) => Key('connectedAccounts-${m.name}');
  static Key linkButton(core.SignInMethod m) =>
      Key('connectedAccountsLink-${m.name}');
  static Key unlinkButton(core.SignInMethod m) =>
      Key('connectedAccountsUnlink-${m.name}');

  @override
  State<ConnectedAccountsView> createState() => _ConnectedAccountsViewState();
}

class _ConnectedAccountsViewState extends State<ConnectedAccountsView> {
  /// What the account looks like NOW — replaced by an unlink's answer, so the
  /// list does not wait for the auth stream to move a row.
  late core.AuthUser? _user = widget.user;
  bool _busy = false;
  String? _notice;

  @override
  void didUpdateWidget(ConnectedAccountsView old) {
    super.didUpdateWidget(old);
    if (old.user != widget.user) _user = widget.user;
  }

  Future<void> _run(Future<void> Function() call) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await call();
    } catch (e) {
      if (mounted) {
        setState(() => _notice = authErrorText(context.chassisL10n, e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _name(ChassisLocalizations l10n, core.SignInMethod m) => switch (m) {
    core.SignInMethod.password => l10n.connectedAccountsPassword,
    core.SignInMethod.apple => l10n.connectedAccountsApple,
    core.SignInMethod.google => l10n.connectedAccountsGoogle,
  };

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final core.AuthUser? user = _user;
    final List<core.SignInMethod> held = core.signInMethodsOf(user);
    final List<core.SignInMethod> rows = <core.SignInMethod>[
      for (final core.SignInMethod m in core.SignInMethod.values)
        if (held.contains(m) || widget.available.contains(m)) m,
    ];
    // The width decision: the form cap (`AppBreakpoints.form`). On a phone
    // the sheet is the window; on anything wider it is a dialog, and a list of
    // three rows with a button at the far end reads badly any wider.
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Align(
        alignment: AlignmentDirectional.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
          child: _list(context, l10n, user, held, rows),
        ),
      ),
    );
  }

  Widget _list(
    BuildContext context,
    ChassisLocalizations l10n,
    core.AuthUser? user,
    List<core.SignInMethod> held,
    List<core.SignInMethod> rows,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text(
            l10n.connectedAccountsTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          l10n.connectedAccountsBody,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: AppSpacing.md),
        for (final core.SignInMethod m in rows)
          _row(context, l10n, user, m, held.contains(m)),
        if (_notice != null) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          AuthMessage(
            message: _notice!,
            textKey: ConnectedAccountsView.statusLine,
            kind: StatusKind.danger,
          ),
        ],
      ],
    );
  }

  Widget _row(
    BuildContext context,
    ChassisLocalizations l10n,
    core.AuthUser? user,
    core.SignInMethod m,
    bool connected,
  ) {
    final Widget? action;
    final String status;
    if (connected) {
      // The only way in says so — it is why the row has no Remove button.
      status = core.signInMethodsOf(user).length == 1
          ? l10n.connectedAccountsOnlyMethod
          : l10n.connectedAccountsConnected;
      action = core.mayUnlinkMethod(user, m)
          ? TextButton(
              key: ConnectedAccountsView.unlinkButton(m),
              onPressed: _busy
                  ? null
                  : () => _run(() async {
                      final core.AuthUser after = await widget.onUnlink(m);
                      if (mounted) setState(() => _user = after);
                    }),
              child: Text(l10n.connectedAccountsRemove),
            )
          : null;
    } else {
      final bool mayLink = core.mayLinkMethod(user, m);
      status = mayLink || core.mayLinkIdentity(user)
          ? l10n.connectedAccountsNotConnected
          : l10n.connectedAccountsVerifyFirst;
      action = mayLink
          ? TextButton(
              key: ConnectedAccountsView.linkButton(m),
              onPressed: _busy ? null : () => _run(() => widget.onLink(m)),
              child: Text(l10n.connectedAccountsConnect),
            )
          : null;
    }
    return ListTile(
      key: ConnectedAccountsView.row(m),
      contentPadding: EdgeInsets.zero,
      title: Text(_name(l10n, m)),
      subtitle: Text(status),
      trailing: action,
    );
  }
}
