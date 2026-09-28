# CAPTURED from build-platforms.yml run 36229543907: what the shipped Apple bundles embed

Not hand-written. Read on 2026-09-26 out of that run's own artifacts (main `b1fc8bd1`, a
`workflow_dispatch` on the commit that landed the archive-opening prover, AR-B4a) for
`apple-privacy-manifest.test.mjs`, which rebuilds each bundle's privacy surface from it and holds
`assert-apple-privacy-manifest.mjs --built` to it (O-APPLE-PROVER-SKIPS-THE-PKG, apps-review B4b).

| File | What it is | Read from |
|---|---|---|
| `bundles.json` | per platform: the embedded frameworks, the top-level SDK resource bundles and every `PrivacyInfo.xcprivacy` path with its sha256, as `readBuiltBundle()` returns them | `store-subscriptiontracker-ios-release-signed` (`subscriptiontracker.ipa`) and `store-subscriptiontracker-macos-pkg` (`subscriptiontracker.pkg`); each archive's sha256 equals the one its `.channel.json` stamp records |
| `Sentry.xcprivacy` | `Sentry.framework`'s manifest (Sentry-Cocoa 8.58.4) | both bundles; the same bytes |
| `RevenueCat.xcprivacy` | `RevenueCat_RevenueCat.bundle`'s manifest | both bundles; the same bytes |
| `OrderedSet.xcprivacy` | `OrderedSet_privacy.bundle`'s manifest (OrderedSet 6.0.3) | both bundles; the same bytes |
| `privacy-manifest.json` | the audit this capture is graded against in `apple-privacy-manifest.test.mjs`: `apps/subscriptiontracker/store/ios-appstore/privacy-manifest.json` as it stood at main `1cd269b7`, the last audit graded against these bundles (W36 wrote its SDK rows from them) | committed 2026-09-27 with the Flutter majors train, when M7 moved the live audit to `flutter_secure_storage_darwin`; re-capture from the first release-signed build-platforms run after it and retire this file |

How the archives were opened: the `.ipa` with `unzip`; the `.pkg` with bsdtar, which reads its xar
table of contents (a product archive with one component, `com.nikatru.subscriptiontracker.pkg`,
beside `Distribution`) and the component's gzip cpio `Payload`. That is the
`<component>.pkg/Payload/<App>.app` layout the prover's `pkgutil --expand-full` writes under
`$RUNNER_TEMP`; the run's PROVE step printed the wrapped app as `→ Payload/Subscriptions.app`.

The app's own `PrivacyInfo.xcprivacy` in both bundles was byte for byte the committed
`apps/subscriptiontracker/{ios,macos}/Runner/PrivacyInfo.xcprivacy`, so `bundles.json` marks it
`"captured": "self"` and the test copies the committed file.

Only the three manifests the audit pins (`manifest: read`) are committed. The other eleven are
listed with their digests and not copied: no row pins them, and `* text=auto eol=lf` would rewrite
one of them on commit (app_links' manifest has CRLF line ends, so its committed bytes would not
hash to the digest recorded here). The test writes a placeholder plist at their paths.

What this cannot prove: any later bundle. It is the record of one run. `--built` in bp's PROVE
step reads every run after it and prints the same list, which is where a change shows first.
