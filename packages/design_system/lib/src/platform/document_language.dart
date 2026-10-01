// ⏱ 2026-10-01 · EN-09 — the web page's language, said to the browser.
//
// `<html lang>` is what a screen reader picks its voice by, what a browser's
// translate offer reads, and what WCAG 3.1.1 (Language of Page) asks for. The
// page shipped with a bare `<html>`, so a Tamil session was announced in an
// English voice, and nothing at runtime said otherwise. `web/index.html` now
// carries a static `en` for the first paint, and each app hands
// [resolveAndLabelPage] to `MaterialApp.localeListResolutionCallback`, so the
// page follows the locale the app RESOLVED, every time it is resolved again.
//
// Here rather than in an app because every web build of every app has the same
// page and the same gap ([pipeline] owner lock 2026-09-28: what applies to more
// than one app goes in `packages/*`). Not in `nikatru_core`, which is pure Dart
// by allowlist. A no-op off web.
import 'package:flutter/widgets.dart';

import 'document_language_stub.dart'
    if (dart.library.js_interop) 'document_language_web.dart'
    as impl;

/// Sets the page's `<html lang>` to [languageTag] (a BCP 47 tag such as `en`
/// or `ta`). Idempotent and cheap; never throws.
void setDocumentLanguage(String languageTag) =>
    impl.setDocumentLanguage(languageTag);

/// A `localeListResolutionCallback` that resolves exactly as Flutter does with
/// none ([basicLocaleListResolution]) and labels the page with the answer.
///
/// `WidgetsApp` calls it for the device's list and, when the app pins a
/// language, with that one locale — so the page follows an in-app language
/// change too, not only the device's.
Locale resolveAndLabelPage(
  List<Locale>? preferredLocales,
  Iterable<Locale> supportedLocales,
) {
  final Locale resolved = basicLocaleListResolution(
    preferredLocales,
    supportedLocales,
  );
  setDocumentLanguage(resolved.toLanguageTag());
  return resolved;
}
