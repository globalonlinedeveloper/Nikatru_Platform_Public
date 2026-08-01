# Notice — the legal posture of this repository

## This repository is source-visible. It is not open-source.

Both halves of that sentence are load-bearing, and `tooling/ci/assert-repo-posture.mjs`
asserts that this file still says them.

- **source-visible** — anybody may read every file here, clone it, and check what
  the apps NIKATRU publishes actually do. That is deliberate: a privacy policy you
  can verify against the code is worth more than one you have to take on trust.
- **not open-source** — reading is not a licence. No right to use, copy, modify,
  merge, publish, distribute, sublicense or sell this software is granted by its
  being visible.

© 2026 Rajasekar Selvam, sole proprietor, trading as NIKATRU. All rights reserved.

## Why there is no LICENSE file, and why one must not be added casually

There is deliberately **no `LICENSE` file at the root of this repository**, and
`assert-repo-posture.mjs` fails the build if one appears.

The absence of a licence file is what keeps the tree all-rights-reserved: this
project grants no rights it has not written down, and it has not written any down.
Making the source readable is not, and is not intended as, a grant.

**A grant, once made, is treated here as permanent.** Deleting a LICENSE file in a
later commit does not take it back from anyone who already has the code — they
keep that copy, and the file stays in the public history for them to point at.
That asymmetry is the whole reason this is a build-failing check and not a note:
every other decision in this repository can be revised, and this one is planned
for as though it cannot.

Adding a licence is an owner decision (`master-requirements.md` — "Repo stays
PUBLIC, no LICENSE"), not a housekeeping commit. If it is ever taken, the guard is
where it has to be changed, in the same commit, on purpose.

## Third-party material

Software this project depends on remains under its own licence. Those licences are
not restated here, because a hand-maintained copy of somebody else's licence text
goes stale silently:

- **Dart/Flutter dependencies** — resolved from `pubspec.yaml` / `pubspec.lock`.
  Every app built from this repository ships Flutter's own licences surface
  (`LicensePage`, reachable from Settings → About), which enumerates them from the
  build rather than from a checked-in list.
- **Node/TypeScript dependencies** — resolved from the `package.json` files and
  their lockfiles.
- **Bundled assets** — fonts, icons and content packs shipped inside an app
  binary. ⚠️ These are **not yet enumerated in a machine-checked register**; that
  register and its guard are stage 8 / K-10 and are not built at the time of
  writing. Until they are, the absence of a listing here is a known gap, not a
  claim that nothing is bundled.

## Trade marks

"NIKATRU" and the app names, logos and brand assets under `sites/` and
`apps/*/store/` are not covered by anything in this file. Source visibility is not
permission to publish an app under our name.

## Contact

`support@nikatru.com` — see `SECURITY.md` for security reports specifically.
