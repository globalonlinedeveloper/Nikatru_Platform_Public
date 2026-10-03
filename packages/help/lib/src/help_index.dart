import 'dart:convert';

import 'search.dart';

/// An app's help index for [languageCode], from the table
/// tooling/help/build-index.mjs generates INTO the app
/// (`lib/help/help_index.g.dart`: its own articles and the platform's — never
/// in this package, which carries no app's articles). The language's own index
/// when the table has one, else [sourceLocale]'s; [helpIndexIsTranslated] says
/// which, so the page can say the articles are in English. Parsed once per table
/// and language.
HelpIndex helpIndexFrom(
  Map<String, String> table,
  String languageCode, {
  required String sourceLocale,
}) {
  final code = table.containsKey(languageCode) ? languageCode : sourceLocale;
  final byCode = _cache[table] ??= <String, HelpIndex>{};
  return byCode.putIfAbsent(
    code,
    () => HelpIndex.fromJson(jsonDecode(table[code]!) as Map<String, Object?>),
  );
}

/// Whether [table] has articles of [languageCode]'s own.
bool helpIndexIsTranslated(Map<String, String> table, String languageCode) =>
    table.containsKey(languageCode);

final Expando<Map<String, HelpIndex>> _cache = Expando<Map<String, HelpIndex>>();
