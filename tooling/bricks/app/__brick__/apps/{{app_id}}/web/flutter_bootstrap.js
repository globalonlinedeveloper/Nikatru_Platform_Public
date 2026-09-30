{{=<% %>=}}<%!
  🔴 THE FIRST TAG ON THIS LINE IS A MUSTACHE DELIMITER CHANGE, AND IT IS THE
  WHOLE REASON THIS FILE CAN EXIST IN A BRICK AT ALL.

  Flutter's bootstrap template IS its two tokens: `flutter build web`
  substitutes {{flutter_js}} and {{flutter_build_config}} into whatever
  web/flutter_bootstrap.js contains. mason renders every template file as
  mustache, where {{name}} is a VARIABLE — and this brick declares neither, so
  under the default delimiters both tokens stamp as EMPTY STRINGS. That failure
  is silent in the worst way: the stamped file is still valid JavaScript, the
  app analyzes, tests and builds, and only a browser finds out that the loader
  was never defined.

  The delimiter change switches mason to the angle-percent pair for the rest of
  the file, so Flutter's tokens are left exactly as written. This comment is
  itself a mustache comment IN THE CHANGED DELIMITERS, so it is removed at stamp
  time and the stamped file is BYTE-IDENTICAL to
  apps/subscriptiontracker/web/flutter_bootstrap.js — asserted, both ways, by
  tooling/ci/test/self-host-fallback-fonts.test.mjs.

  ⚠️ Two rules for editing this file. Nothing below may need a var: the
  bootstrap carries no app-specific text (the fallback-fonts path is RELATIVE
  and resolves against each app's own base href). And nothing in THIS comment
  may contain the closing tag sequence, which would end the comment early and
  stamp the rest of it into every app.
%>{{flutter_js}}
{{flutter_build_config}}

// The engine's text fallback fonts (Roboto, and the Noto set it loads on demand
// for any glyph the app's own fonts lack) are served from THIS origin, not from
// Google's font CDN. deploy-web.yml copies them into build/web/fallback-fonts/
// with tooling/web/self-host-fallback-fonts.mjs, pinned by sha256, and refuses to
// deploy a bundle whose bootstrap does not carry this exact value. The path is
// relative, so it resolves against <base href> (/<app id>/). CanvasKit is served
// from canvaskit/ by `--no-web-resources-cdn`. Why: docs/ci/deploy-web.md.
_flutter.loader.load({
  config: {
    fontFallbackBaseUrl: "fallback-fonts/",
  },
});
