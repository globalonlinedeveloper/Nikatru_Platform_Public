{{flutter_js}}
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
