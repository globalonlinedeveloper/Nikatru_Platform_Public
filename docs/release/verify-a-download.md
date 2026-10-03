# Verify a download

Every file a Nikatru GitHub Release publishes (an app's installers and bundle
archives, an extension's zips, and the checksum file beside them) carries a
**build-provenance attestation**: a signed statement, made by GitHub Actions at
build time, that names the file's sha256 and the exact workflow, commit and run
that produced it. Anyone can check one with tools they already have. No account
with us is needed.

## 1. The bytes are the ones the release lists

In the folder you downloaded the release files into:

```sh
sha256sum -c SHA256SUMS          # Linux
shasum -a 256 -c SHA256SUMS      # macOS
```

Every line must print `OK`. This proves the files match the checksum list. It
does not prove who built them, because anyone who can change a file can change
the list beside it. Step 2 proves that.

## 2. This repository's release workflow built them

With the [GitHub CLI](https://cli.github.com/) (`gh` 2.49 or later), signed in to
any GitHub account:

```sh
gh attestation verify <file> --repo globalonlinedeveloper/Nikatru_Platform_Public
```

To check the exact workflow too, pin the signer:

```sh
# an app release
gh attestation verify <file> --repo globalonlinedeveloper/Nikatru_Platform_Public \
  --signer-workflow globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/build-platforms.yml

# a browser-extension release
gh attestation verify <file> --repo globalonlinedeveloper/Nikatru_Platform_Public \
  --signer-workflow globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/extensions.yml
```

A pass prints `✓ Verification succeeded!` and the workflow run that made the
file. Any other output means the file is not one this repository built. Do not
install it, and tell us at the address in `SECURITY.md`.

## 3. The record says the same

`release.json` in the same release lists every file with its `sha256` and, under
`provenance`, the attestation the release run signed for it (`attestationId`,
`attestationUrl`). The URL opens that attestation on GitHub.

## What this covers, and what it does not

- **Covered:** every file attached to a GitHub Release. The release job attests
  them, then verifies each one with `gh attestation verify` before it writes
  `release.json` and `SHA256SUMS`
  (`tooling/ci/verify-provenance.mjs`; `tooling/ci/assert-build-provenance.mjs`
  fails CI if a release job stops doing either).
- **Not covered here:** a copy installed from an app store (Google Play, the
  App Store, the Microsoft Store, the Snap Store, the browser add-on stores). The
  store re-signs what it serves, so the store's own signature is the check. The
  bytes this repository sent each store are recorded by sha256 in the submission's
  deployment record.
- **apps.gov.in:** the `.apk` attached to a release is the file uploaded to
  apps.gov.in, so step 2 run against that `.apk` proves where it came from.
