import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart' show openExternalUrl;

/// ⏱ 2026-10-01 · EN-23 — the app's half of "what changed" on
/// `/reaccept-terms`: which notes to show and where each document's link goes.
///
/// A file of its own because `reaccept_terms_screen.dart` is a chassis fork
/// with a line ceiling (`tooling/chassis-parity.json`): the decision is
/// `core.legalChangesSince` and the rendering is `ReacceptTermsView`, so all
/// that is app-specific is the register below and the two published URLs.

/// The register of "what changed" notes: one per document VERSION, each with
/// its date and at most three lines.
///
/// 🔴 EMPTY UNTIL THE OWNER WRITES ONE, AND THAT IS NOT AN OVERSIGHT. A note is
/// legal copy describing a published change, which is the owner's to sign off
/// ([ADR 031] class B); a summary invented here could misstate the document a
/// user is about to accept. With no note for the current version the screen
/// keeps its plain sentence. Add the note in the SAME commit that moves
/// `kTermsVersion` or `kPrivacyPolicyVersion` (`state/analytics_providers.dart`).
const List<core.LegalChangeNote> kLegalChangeNotes = <core.LegalChangeNote>[];

/// The notes for every document that moved past [acceptedStamp], from
/// [kLegalChangeNotes]. Empty — the plain sentence — when none was written.
List<core.LegalChangeNote> legalChangesFor(String? acceptedStamp) =>
    core.legalChangesSince(
      acceptedStamp: acceptedStamp,
      current: kLegalVersions,
      register: kLegalChangeNotes,
    );

/// Opens the LIVE published document, the same URLs the clickwrap links.
void openLegalDocument(core.LegalDocument document) =>
    openExternalUrl(switch (document) {
      core.LegalDocument.terms => AppConfig.termsUrl,
      core.LegalDocument.privacy => AppConfig.privacyUrl,
    });
