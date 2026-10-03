import 'dart:convert';

import 'help_index.g.dart';
import 'search.dart';

/// The help index for [languageCode]: its own when the build wrote one, else
/// the source locale's (the articles are then in English, and the page says
/// so). Parsed once per language.
HelpIndex helpIndexFor(String languageCode) => _cache.putIfAbsent(
  kHelpIndexJson.containsKey(languageCode) ? languageCode : kHelpSourceLocale,
  () => HelpIndex.fromJson(
    jsonDecode(
          kHelpIndexJson[kHelpIndexJson.containsKey(languageCode)
              ? languageCode
              : kHelpSourceLocale]!,
        )
        as Map<String, Object?>,
  ),
);

/// Whether [languageCode] has articles of its own.
bool helpIndexIsTranslated(String languageCode) =>
    kHelpIndexJson.containsKey(languageCode);

final Map<String, HelpIndex> _cache = <String, HelpIndex>{};
