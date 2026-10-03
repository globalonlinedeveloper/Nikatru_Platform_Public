# Verify a download

Every file a Nikatru GitHub Release publishes carries a **build-provenance
attestation**: a signed statement, made by GitHub Actions at build time, that
names the file's sha256 and the exact workflow, commit and run that produced it.
That covers an app's installers and bundle archives, an extension's zips,
`release.json` and the checksum files (`SHA256SUMS`, and `SHA256SUMS.txt` for an
extension). Anyone can check one with tools they already have. No account with us
is needed.

## 1. The bytes are the ones the release lists

In the folder you downloaded the release files into:

```sh
sha256sum -c SHA256SUMS          # Linux
shasum -a 256 -c SHA256SUMS      # macOS
```

Every line must print `OK`. This proves the files match the checksum list. It
does not prove who built them, because anyone who can change a file can change
the list beside it. Step 2 proves that.

## 2. This repository's release workflow built them, from the release tag

With the [GitHub CLI](https://cli.github.com/) (`gh` 2.49 or later), signed in to
any GitHub account, pin the workflow and the tag the release was cut from
(`<tag>` is the release's name, for example `subscriptiontracker-v1.0.0`):

```sh
# an app release
gh attestation verify <file> --repo globalonlinedeveloper/Nikatru_Platform_Public \
  --signer-workflow globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/build-platforms.yml \
  --source-ref refs/tags/<tag>

# a browser-extension release
gh attestation verify <file> --repo globalonlinedeveloper/Nikatru_Platform_Public \
  --signer-workflow globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/extensions.yml \
  --source-ref refs/tags/<tag>
```

A pass prints `✓ Verification succeeded!` and the workflow run that made the
file. `--source-ref` matters: the same workflow also attests its scheduled and
dispatched rehearsal builds, so without it a build that was never released would
verify too. Any other output means the file is not this release's. Do not install
it, and tell us at the address in `SECURITY.md`.

## What this covers, and what it does not

- **Covered:** every file attached to a GitHub Release, the record and checksum
  files included. The release job hands its finished directory to an attest-only
  job, the only job that can sign. That job attests every file in it, then checks
  each one with `gh attestation verify` and keeps a per-file record for 90 days
  (`tooling/ci/verify-provenance.mjs`). `tooling/ci/assert-build-provenance.mjs`
  fails CI if a release lane stops handing the whole directory over, if the
  attestation or the check goes missing, or if any other job is given signing
  rights.
- **When:** the attestation is made just after the tag's Release is published,
  in the same workflow run. A run whose files did not verify is red; until that
  run finishes, `gh attestation verify` may not find an attestation yet.
- **Not covered here:** a copy installed from an app store (Google Play, the
  App Store, the Microsoft Store, the Snap Store, the browser add-on stores). The
  store re-signs what it serves, so the store's own signature is the check. The
  bytes this repository sent each store are recorded by sha256 in the submission's
  deployment record.
- **apps.gov.in:** the `.apk` attached to a release is the file uploaded to
  apps.gov.in, so step 2 run against that `.apk` proves where it came from.
