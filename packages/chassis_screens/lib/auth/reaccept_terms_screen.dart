import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';
import 'legal_consent_fields.dart';

/// The MATERIAL-CHANGE re-acceptance interstitial (research/43, adopted as an
/// auth-increment rider by the owner on 2026-08-09 night).
///
/// 🏗️ THE BODY OF `ReacceptTermsScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. The consent FLAG lives here with the box it belongs to, and
/// `assert-signup-consent-shape.mjs` follows the delegation to find it — the
/// surface is read as the adapter's code UNIONED with this file, so limb 1
/// (the unticked `_accepted` initialiser) and limb 2 (the early-return guard
/// AND the button disable) are both asserted over exactly the text that decides
/// them.
///
/// Shown when `kTermsVersion` / `kPrivacyPolicyVersion` have moved past the
/// stamp the user accepted. The router puts them here and nothing else is
/// reachable until they accept — which is why the screen is deliberately small:
/// it states what changed, links the live documents, takes one affirmative act,
/// and offers a way out that is not "agree".
///
/// 🔴 RE-ACCEPTANCE IS NOT A VERSION BUMP. Both constants are hand-edited and
/// moving either one puts this screen in front of every signed-in user of every
/// stamped app. That is the mechanism working; it is also why a wording tidy-up
/// must not touch them.
///
/// 🔴 THE TICK ARRIVES UNTICKED HERE TOO. Carrying the previous acceptance
/// forward as a pre-ticked box makes the "acceptance" a re-render of a decision
/// taken against a document that no longer exists — the same Planet49/EDPB
/// objection as any other pre-ticked consent, and the whole reason this screen
/// is being shown at all.
///
/// ⚠️ THE MARKETING BOX IS ABSENT ON PURPOSE (`showMarketing: false`). Asking
/// for a marketing opt-in on a screen the user cannot leave is exactly the
/// conditionality research/43 declined; their existing `marketing-email`
/// artifact stands untouched, whichever way it went.
class ReacceptTermsView extends StatefulWidget {
  const ReacceptTermsView({
    required this.onAccept,
    required this.onSignOut,
    required this.consentFields,
    this.panel,
    this.changes = const <core.LegalChangeNote>[],
    this.onOpenDocument,
    super.key,
  });

  static const Key acceptButton = Key('reacceptTermsAccept');
  static const Key plainBody = Key('reacceptTermsPlainBody');

  /// The "Read the …" link under one document's note.
  static Key openDocument(core.LegalDocument d) =>
      Key('reacceptTermsOpen-${d.name}');
  static const Key signOutButton = Key('reacceptTermsSignOut');
  static const Key statusLine = Key('reacceptTermsStatus');

  /// Records the acceptance. `acceptTermsOnly` in the adapter, never
  /// `accept(marketingEmail: false)` — see there.
  final Future<void> Function() onAccept;

  /// Declining, which is signing out. Goes through the SPINE in the adapter.
  final Future<void> Function() onSignOut;

  /// Renders the tick boxes. The ADAPTER builds them, so the brick's own
  /// `LegalConsentFields` — which owns the published URLs and the platform call
  /// that opens them — stays mounted. See [ConsentFieldsBuilder].
  final ConsentFieldsBuilder consentFields;

  /// ST-D10: the leading half of the wide split (`AuthFrame.panel`), in the
  /// adapter's own words. Null keeps the form alone at every width.
  final Widget? panel;

  /// ⏱ 2026-10-01 · EN-23 — what changed: one note per changed document,
  /// from the app's register (`core.legalChangesSince`). EMPTY keeps the
  /// plain sentence, which is the honest answer when no note was written.
  final List<core.LegalChangeNote> changes;

  /// Opens the live [core.LegalDocument] a note is about. Null draws no link.
  final ValueChanged<core.LegalDocument>? onOpenDocument;

  @override
  State<ReacceptTermsView> createState() => _ReacceptTermsViewState();
}

class _ReacceptTermsViewState extends State<ReacceptTermsView> {
  /// 🔴 FALSE, ALWAYS, AND `assert-signup-consent-shape.mjs` FAILS THE BUILD IF
  /// THIS LINE EVER SAYS OTHERWISE. A pre-ticked clickwrap is not consent in any
  /// market this factory ships to.
  bool _accepted = false;
  bool _busy = false;
  String? _notice;

  /// ⏱ 2026-10-01 · EN-05 — the last accept failed, so the button offers the
  /// same tap again as Retry beside the sentence that says why.
  bool _failed = false;

  /// 🔴 THE DECLINE PATH IS AWAITED, HOLDS THE BUSY FLAG, AND SHOWS ITS OWN
  /// FAILURE — it was `onPressed: () => auth.signOut()` and none of the three.
  /// On a screen whose entire premise is that there is no other way out, a
  /// sign-out that throws became an unhandled async error and the user was left
  /// looking at a button that had visibly done nothing.
  ///
  /// Inline notice rather than a SnackBar: a SUCCESSFUL sign-out replaces this
  /// page via the router's gate, and a SnackBar riding on a page being torn
  /// down is a message nobody reads ([ADR 027]).
  Future<void> _signOut() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await widget.onSignOut();
    } catch (e) {
      // ⏱ 2026-09-24 — through the mapper, like every auth view. This was
      // `'$e'` "rather than a localized fallback" because the chassis had no
      // generic auth-error string; it has `authUnknownError` now, which the
      // shared mapper needed anyway, so that reason is gone.
      if (mounted) {
        setState(() => _notice = authErrorText(context.chassisL10n, e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() async {
    if (_busy || !_accepted) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await widget.onAccept();
    } catch (e) {
      // ⏱ 2026-09-29 · ST-D10 (M1 §2.31, gap 17, `ReacceptTerms`): an accept
      // that FAILED said nothing — this was try/finally with no catch, so the
      // button re-enabled and the user could not tell a refusal from a slow
      // save (offline included). The same mapper and the same line the
      // sign-out failure already used.
      if (mounted) {
        setState(() {
          _notice = authErrorText(context.chassisL10n, e);
          _failed = true;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    // No navigation — the router's gate moves the user, and it re-runs because
    // `routerRefreshProvider` listens to the acceptance provider. Navigating
    // here would race that gate, which is also why this widget takes no
    // navigation callback at all.
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

    return AuthFrame(
      panel: widget.panel,
      title: l10n.reacceptTermsTitle,
      // No back button: there is nowhere behind this. The router put the user
      // here from wherever they were, and popping would return to a route the
      // gate immediately redirects out of.
      showBack: false,
      children: <Widget>[
        if (widget.changes.isEmpty)
          Text(
            l10n.reacceptTermsBody,
            key: ReacceptTermsView.plainBody,
            style: Theme.of(context).textTheme.bodyLarge,
          )
        else ...<Widget>[
          Text(
            l10n.reacceptTermsChangedIntro,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          for (final core.LegalChangeNote n in widget.changes)
            _ChangeNote(note: n, onOpen: widget.onOpenDocument),
        ],
        const SizedBox(height: 20),
        widget.consentFields(
          termsAccepted: _accepted,
          marketingAccepted: false,
          enabled: !_busy,
          onTermsChanged: (bool v) => setState(() => _accepted = v),
          onMarketingChanged: (_) {},
        ),
        if (_notice != null) ...<Widget>[
          const SizedBox(height: 12),
          AuthMessage(
            message: _notice!,
            textKey: ReacceptTermsView.statusLine,
            kind: StatusKind.danger,
          ),
        ],
        const SizedBox(height: 20),
        // 🔴 DISABLED UNTIL TICKED. The tick is the affirmative act; a
        // button that works without it makes the box decorative, which is
        // the difference between a clickwrap and a notice.
        FilledButton(
          key: ReacceptTermsView.acceptButton,
          onPressed: (_busy || !_accepted) ? null : _accept,
          child: Text(_failed ? l10n.retry : l10n.reacceptTermsAccept),
        ),
        const SizedBox(height: 12),
        // Declining has to be possible, and it is signing out — not a
        // silent dismissal that leaves them using the product under terms
        // they refused.
        TextButton(
          key: ReacceptTermsView.signOutButton,
          onPressed: _busy ? null : _signOut,
          child: Text(l10n.signOut),
        ),
      ],
    );
  }
}

/// One document's note: what it is, which version and when, its lines, and
/// a link to the live document — EN-23.
class _ChangeNote extends StatelessWidget {
  const _ChangeNote({required this.note, required this.onOpen});

  final core.LegalChangeNote note;
  final ValueChanged<core.LegalDocument>? onOpen;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final TextTheme text = Theme.of(context).textTheme;
    final String document = switch (note.document) {
      core.LegalDocument.terms => l10n.termsOfService,
      core.LegalDocument.privacy => l10n.privacyPolicy,
    };
    final ValueChanged<core.LegalDocument>? open = onOpen;
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              l10n.reacceptTermsNoteHeading(document, note.version, note.date),
              style: text.titleSmall,
            ),
          ),
          for (final String line in note.lines)
            Text(l10n.reacceptTermsNoteLine(line), style: text.bodyMedium),
          if (open != null)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                key: ReacceptTermsView.openDocument(note.document),
                onPressed: () => open(note.document),
                child: Text(l10n.reacceptTermsReadDocument(document)),
              ),
            ),
        ],
      ),
    );
  }
}
