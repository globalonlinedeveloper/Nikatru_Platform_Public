/// ⏱ 2026-10-03 · lane dpdp-rights, Do 6 (F-05, O-CONSENT-NO-REPROMPT-ON-NOTICE-BUMP).
///
/// Every consent artifact records the privacy-notice version it was given
/// under ([ConsentArtifact.policyVersion]). When a later notice version
/// changes a consent purpose MATERIALLY, the person is asked again about THAT
/// purpose — once, and never as a gate on the app's core use: the same prompt,
/// the same Decline that keeps everything working.
///
/// 🔴 WHICH BUMP IS MATERIAL IS A DECISION, NOT A DIFF. A typo fix, a new
/// section about something the person never consented to, or a new provider
/// for a purpose they did not grant does not re-ask anybody. So the register
/// below names, per notice version, the purposes whose processing that version
/// changed. A version absent from it re-prompts nobody.
library;

import '../analytics/consent.dart';

/// One notice version that changed what a consent purpose covers.
class MaterialNoticeChange {
  const MaterialNoticeChange({required this.version, required this.purposes});

  /// The notice version (`data-policy-version`, `YYYY-MM-DD`).
  final String version;

  /// The [ConsentPurpose.value]s whose processing this version changed.
  final Set<String> purposes;
}

/// The register. EMPTY ON PURPOSE as of notice 2026-10-04: that version adds
/// the rights machinery, the itemised table and the cookies section and
/// removes the consent-by-use sentences, but changes what NO consent purpose
/// covers (usage statistics collect what they collected under 2026-10-03).
/// Add a row in the same commit as a bump that does.
const List<MaterialNoticeChange> kMaterialNoticeChanges =
    <MaterialNoticeChange>[];

/// Whether the person who gave [artifact] must be asked again under
/// [currentVersion]: true only when some version AFTER the one they answered
/// under, up to and including the current one, materially changed that
/// artifact's purpose. A fresh answer under [currentVersion] ends it, which is
/// what makes the re-prompt happen once.
///
/// No artifact is not a re-prompt — the person has never been asked, and the
/// first-run prompt covers that.
bool needsConsentReprompt({
  required ConsentArtifact? artifact,
  required String currentVersion,
  List<MaterialNoticeChange> register = kMaterialNoticeChanges,
}) {
  if (artifact == null) return false;
  final String answered = artifact.policyVersion;
  if (answered == currentVersion) return false;
  // Versions are ISO dates, so string order IS date order. An artifact whose
  // version cannot be read (empty, a stamp of another shape) was given under
  // an unknown notice and is treated as older than every change.
  final bool readable = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(answered);
  for (final MaterialNoticeChange c in register) {
    final bool after = !readable || c.version.compareTo(answered) > 0;
    final bool inForce = c.version.compareTo(currentVersion) <= 0;
    if (after && inForce && c.purposes.contains(artifact.purpose)) return true;
  }
  return false;
}
