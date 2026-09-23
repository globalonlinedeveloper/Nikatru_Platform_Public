# Screenshot slots — Apple App Store, iPad (`ios-appstore`, `ipad` set)

The **iPad** listing images go in this directory. The iPhone ones go in
`../screenshots/`, and the two are separate because App Store Connect grades
them as separate required sets on the same version record.

⚠️ **These are not the iPhone frames scaled up.** That is the classic rejection:
an iPad listing assembled from up-scaled iPhone captures shows phone-shaped
layout in a tablet-shaped frame, and a reviewer sees it in one glance. It is
also not what the app looks like on an iPad — the layout the app actually
renders at tablet width is the thing being advertised.

`tooling/ci/assert-play-device-coverage.mjs` requires this directory to exist:
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.screenshots.deviceTypeCoverage.sets["ipad"]`
names it, and a device type declared in the register with no directory behind it
is a claim this tree cannot keep. Git cannot commit an empty directory, so this
README is what holds the slot open.

There are no images here yet. The channel is `served: false` and the shortfall
is PRINTED on every guard run rather than failing CI — it is FATAL on the
submission lane, which runs the same guard with `--for-submission=ios-appstore`.
`OWNER_QUEUE A-4` carries the row.

## The rules — in `tooling/channel-register.json`, not here

The size, the count and the format live beside a dated `source` in the register,
under the `ipad` set. Read them there; a number copied into this README is a
second copy that drifts, and `tooling/ci/assert-listing-assets.mjs` grades the
pixels against the register.

One thing worth knowing before you capture: Apple's **required size classes move
with the hardware line-up**. This is the one row in the contract with a known
expiry. Re-fetch Apple's current specification before a submission and record the
URL and the date in the same change.

## How these are captured

`.github/workflows/store-screenshots.yml` dispatched with `channel:
ios-appstore` drives a simulator of the device the register names, writes
`CAPTURE.json` beside the frames recording which build was photographed, and
opens a pull request with the pixels in it. **Both sets come from one run and
arrive in one pull request** — a listing whose iPhone and iPad frames were
captured from different builds is two listings wearing one version number.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Upload order is part
of the listing, so the number is the listing's, not the filesystem's.
