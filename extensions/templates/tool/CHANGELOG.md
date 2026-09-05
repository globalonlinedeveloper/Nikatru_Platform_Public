# Changelog

Every released version, what changed in it, and nothing else. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
are [semantic](https://semver.org/) as far as an extension can be.

**Do not edit the version headings by hand.** `node publish/bump-version.mjs
<major|minor|patch|x.y.z>` writes the heading, rewrites every version site in
the tree in one step, and refuses if the old number survives anywhere it should
not. `node publish/bump-version.mjs --check` asserts that `manifest.json`,
`publish/manifest.firefox.json` and the top entry here all say the same thing —
the node sim runs that check on every pass, so a release cannot go out
undocumented.

Write the entries for the person reading them in a year, who is you. "Fixed a
bug" is not an entry; "a settings write that failed silently now says so" is.

## [Unreleased]

## [0.0.1] — 2026-08-12

### Added

- First version of the tool, built from `_skeleton`.
