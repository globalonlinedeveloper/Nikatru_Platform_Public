// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY NAMES BY ID — ST-X8 (audit C6).
//
// 🔴 THE STORED CATEGORY IS AN ID, NOT A NAME. A row carries the English word
// its category was created under ('Streaming', 'Other'), and every surface
// that matches on it — `SubMath.categoryTotals`, the budget caps, the add
// sheet's vocabulary — matches on that exact string. So the string stays the
// KEY everywhere and only the PAINT is translated, here, in one place: a Tamil
// reader saw "Other" in the Insights legend because the legend printed the id.
//
// App-only on purpose: the vocabulary is Subly's (the seed budget caps, see
// `add_subscription_sheet.dart`'s `_categories`), not a chassis concept, and no
// other app has categories to name.
//
// An id this table does not know — a category a server introduced, or one
// typed before the vocabulary existed — is painted as it is stored. That is
// the honest fallback: the user wrote it, so it is already in their language.
// ─────────────────────────────────────────────────────────────────────────────
import '../../l10n/app_localizations.dart';

/// The display name of the category whose stored id is [id], in [l10n]'s
/// language — or [id] itself when the vocabulary does not know it.
String categoryLabel(AppLocalizations l10n, String id) => switch (id) {
  'Streaming' => l10n.categoryStreaming,
  'Music' => l10n.categoryMusic,
  'AI tools' => l10n.categoryAiTools,
  'Creative' => l10n.categoryCreative,
  'Fitness' => l10n.categoryFitness,
  'Developer' => l10n.categoryDeveloper,
  'Productivity' => l10n.categoryProductivity,
  'Cloud' => l10n.categoryCloud,
  'News' => l10n.categoryNews,
  'Security' => l10n.categorySecurity,
  'Other' => l10n.categoryOther,
  _ => id,
};
