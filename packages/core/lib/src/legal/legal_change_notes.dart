/// ⏱ 2026-10-01 · EN-23 — "what changed", for the re-acceptance interstitial.
///
/// `/reaccept-terms` said only "We have updated our Terms of Service and
/// Privacy Policy". A material change the user is asked to accept again should
/// say WHAT changed: one short note per changed document — its version, its
/// date and at most three lines — taken from the app's register of notes.
///
/// 🔴 A DOCUMENT WITH NO NOTE KEEPS THE PLAIN SENTENCE. A note is legal copy
/// written by the owner for one version; a missing one is never invented here.
library;

import 'legal_acceptance.dart';

/// The two documents [LegalVersions] carries.
enum LegalDocument { terms, privacy }

/// One owner-written summary of one version of one document.
class LegalChangeNote {
  const LegalChangeNote({
    required this.document,
    required this.version,
    required this.date,
    required this.lines,
  });

  final LegalDocument document;

  /// The version this note describes — the value of `kTermsVersion` or
  /// `kPrivacyPolicyVersion` it was written for.
  final String version;

  /// The date the version took effect, as it is printed (`2026-09-25`).
  final String date;

  /// What changed, in at most [maxLines] short lines.
  final List<String> lines;

  /// The interstitial is one screen the user cannot leave; three lines per
  /// document is a summary, more is the document again.
  static const int maxLines = 3;
}

/// The versions a `terms/<v>+privacy/<v>` [LegalVersions.stamp] names, or null
/// when [stamp] is absent or not that shape.
LegalVersions? legalVersionsOfStamp(String? stamp) {
  final RegExpMatch? m = RegExp(
    r'^terms/(.+)\+privacy/(.+)$',
  ).firstMatch(stamp ?? '');
  if (m == null) return null;
  return LegalVersions(terms: m.group(1)!, privacy: m.group(2)!);
}

/// The documents whose version moved past [acceptedStamp]. Every document,
/// when the stamp cannot be read — the user is asked about all of them.
List<LegalDocument> changedLegalDocuments({
  required String? acceptedStamp,
  required LegalVersions current,
}) {
  final LegalVersions? accepted = legalVersionsOfStamp(acceptedStamp);
  return <LegalDocument>[
    if (accepted == null || accepted.terms != current.terms)
      LegalDocument.terms,
    if (accepted == null || accepted.privacy != current.privacy)
      LegalDocument.privacy,
  ];
}

/// The notes to show: for each document that changed since [acceptedStamp],
/// the note in [register] written for its CURRENT version. A changed document
/// with no such note contributes nothing, and an empty answer means "show the
/// plain sentence". Lines beyond [LegalChangeNote.maxLines] are not shown.
List<LegalChangeNote> legalChangesSince({
  required String? acceptedStamp,
  required LegalVersions current,
  required List<LegalChangeNote> register,
}) {
  final List<LegalChangeNote> out = <LegalChangeNote>[];
  for (final LegalDocument d in changedLegalDocuments(
    acceptedStamp: acceptedStamp,
    current: current,
  )) {
    final String version = d == LegalDocument.terms
        ? current.terms
        : current.privacy;
    for (final LegalChangeNote n in register) {
      if (n.document != d || n.version != version) continue;
      final List<String> lines = <String>[
        for (final String l in n.lines)
          if (l.trim().isNotEmpty) l.trim(),
      ];
      if (lines.isEmpty) break;
      out.add(
        LegalChangeNote(
          document: d,
          version: n.version,
          date: n.date,
          lines: lines.take(LegalChangeNote.maxLines).toList(growable: false),
        ),
      );
      break;
    }
  }
  return out;
}
