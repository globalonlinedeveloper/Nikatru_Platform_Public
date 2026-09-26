# SYNTHETIC — hand-written, never captured from a real tool run. Replace with captured output (AR-B4b).

The files here stand in for tool output that no run has captured yet. They were
written on 2026-09-25 for `artifact-signed-apple.test.mjs`, which feeds them
through `assert-artifact-signed-apple.mjs`'s `main({ run })` so the archive limbs
(O-APPLE-PROVER-SKIPS-THE-PKG) have something to read on a host with no Xcode.

| File | Stands in for | Shape taken from |
|---|---|---|
| `pkgutil-check-signature.txt` | `pkgutil --check-signature <app>.pkg` | the two strings the inline PROVE shell in `build-platforms.yml` grepped for |
| `profile-ios.plist` | the `.ipa`'s `Payload/*.app/embedded.mobileprovision` | the plist `security cms -D` decodes; the CMS envelope is left out, because `parseMobileProvision` slices `<?xml`…`</plist>` out of the bytes either way |
| `profile-macos.plist` | the `.pkg`'s `*.app/Contents/embedded.provisionprofile` | as above, with macOS's `com.apple.application-identifier` spelling |
| `entitlements-ios.xml` | `codesign -d --entitlements - --xml` on the iOS app | an XML plist whose root dict holds the entitlement keys |
| `entitlements-macos.xml` | the same, on the macOS app | as above |

The profiles are named `.plist`, not `.mobileprovision`: `.gitignore` refuses
`*.mobileprovision` everywhere, and that line is a control on real profiles. The
test writes each one into its temporary bundle under the name the guard reads.

What these files cannot prove:

- the layout `pkgutil --expand-full` writes. The test builds `<component>.pkg/Payload/<App>.app`
  itself, and the guard also accepts `Payload/<App>.app` at the top;
- the exact text of `pkgutil --check-signature` for a `3rd Party Mac Developer Installer` signature;
- the entitlement keys Apple adds on signing.

The first release-signed `build-platforms.yml` run that reaches the PROVE step is
where each of them is captured. When it is, these files are REPLACED by that
output, and this README gets a citation like `../apple-run-35741818599/README.md`.

The team `A1B2C3D4E5` and `<PERSONAL-NAME>` are the placeholders the captured
fixtures already use.
