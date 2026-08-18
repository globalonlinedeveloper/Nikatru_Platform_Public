// ─────────────────────────────────────────────────────────────────────────────
// signing-seams.mjs — THE ONE DECLARATION OF HOW EACH CHANNEL IS SIGNED, and of
// which channels this repository CANNOT yet prove it signed.
//
// It is not a guard and it scans nothing. It is data, in its own file, because
// two things must import it without executing each other: slot-signing.mjs (the
// dispatcher that RUNS a seam) and assert-slot-pipeline.mjs (which holds this
// table to tooling/channel-register.json in BOTH directions). A table declared
// inside its only consumer is a table nothing else can check.
//
// 🔴 THE null ENTRIES ARE THE POINT OF THE FILE. `verify: null` means nothing
// here can read the signature out of that store's artifact — and slot-signing.mjs
// REFUSES on it rather than printing ok. This repository has already paid for the
// other behaviour: the Android signing configuration was correct for weeks while
// every bundle CI produced was debug-signed, because no workflow supplied the
// secrets and the recorded fallback fired on every run, silently, with every
// check green.
// ─────────────────────────────────────────────────────────────────────────────

/** channel id -> how this repository signs for it, and how it proves it did.
 *
 *  `prepare` runs before the build. `verify` runs after it, over the artifact.
 *  `artifactGlob` is where that artifact lands — a genuinely per-store path,
 *  because each toolchain writes somewhere different.
 *
 *  A `null` is never an omission: `why` says what is absent and what that costs.
 *  🔴 Nothing here submits. This file's entire blast radius is the runner. */
export const SIGNING_SEAMS = {
  'android-play': {
    prepare: 'tooling/ci/android-signing.mjs',
    verify: 'tooling/ci/assert-artifact-signed.mjs',
    artifactGlob: 'apps/*/build/app/outputs/bundle/release/*.aab',
    why: 'Upload key we hold. Play fixes the upload certificate at the first upload, so the verify step reads the real signer out of the bundle and compares it with the pinned SHA-256 in the register.',
  },
  'ios-appstore': {
    prepare: 'tooling/ci/apple-signing.mjs',
    verify: 'tooling/ci/assert-artifact-signed-apple.mjs',
    artifactGlob: 'apps/*/build/ios/ipa/*.ipa',
    why: 'Developer identity in a temporary keychain plus provisioning profiles. Notarisation is a network step and belongs to the seam, not to this file.',
  },
  'macos-appstore': {
    prepare: 'tooling/ci/apple-signing.mjs',
    verify: 'tooling/ci/assert-artifact-signed-apple.mjs',
    artifactGlob: 'apps/*/build/macos/Build/Products/Release/*.pkg',
    why: 'Same seam as iOS, different artifact and a different bundle identifier. The register holds both.',
  },
  'windows-store': {
    prepare: 'tooling/ci/windows-signing.mjs',
    verify: null,
    artifactGlob: 'apps/*/build/windows/msix/*.msix',
    why: '🔴 NOTHING IN THIS REPOSITORY READS THE SIGNATURE OUT OF AN .msix. The preparation seam exists; the proof does not. Until it does, a Microsoft Store slot cannot honestly claim a verified artifact, and `--verify` refuses rather than printing ok over an unread file.',
  },
  'windows-direct': {
    prepare: null,
    verify: null,
    artifactGlob: null,
    why: 'Not submittable and no lane emits its formats. The register declares `.exe` and nothing in this repository packages one. Declared so the channel cannot pass through this table unnoticed.',
  },
  'linux-snap': {
    prepare: null,
    verify: null,
    artifactGlob: 'apps/*/build/*.snap',
    why: 'NO KEY OF OURS — Canonical signs the binary, which is why the register records keyKind "none". There is nothing to prepare and nothing of ours to verify. ⚠️ The one-way step on this channel is not a signature at all: `snapcraft register <name>` claims a GLOBAL namespace, once, per app.',
  },
  'linux-appimage': {
    prepare: 'tooling/ci/appimage-signing.mjs',
    verify: null,
    artifactGlob: 'apps/*/build/*.AppImage',
    why: 'A preparation seam exists; no reader of an AppImage signature does. Not submittable today, so this is a gap rather than a live hole — recorded either way.',
  },
  web: {
    prepare: null,
    verify: null,
    artifactGlob: null,
    why: 'The web channel signs nothing. TLS is Cloudflare\'s certificate, not ours, and there is no store to submit to. This is the one channel where "nothing to do" is the complete and correct answer.',
  },
};
