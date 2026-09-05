# Nikatru_Platform_Public

<!-- Repointed 2026-08-19: this heading read `Project_Cross_Platform_Apps`, which is the name the
     GitHub repo and this directory both carried until the owner renamed all five that day. The
     heading is the first thing a reader matches against the URL they arrived from, so a stale one
     reads as "wrong repo". Verify a name with `gh repo list`, never with
     `gh api repos/<owner>/<name>` — GitHub follows rename redirects and the old name still 200s. -->

<!-- Repointed again 2026-08-26: the 2026-08-19 note above stays as written — it is still true of THAT
     rename. What changed since is the name it landed on. The heading read `Nikatru_Android_Apps_Public`
     from that day until today; the live name is `globalonlinedeveloper/Nikatru_Platform_Public`, so that
     is what the heading says. The second rename FREED `Nikatru_Android_Apps_Public` exactly the way the
     first freed `Project_Cross_Platform_Apps`, and the same trap applies: the old name still resolves only
     through a redirect that dies the moment anyone else claims it, and anyone could. Verification rule is
     unchanged — `gh repo list`, never `gh api repos/<owner>/<name>` — and `git remote -v` is not a third
     option: it prints a string out of local `.git/config`, which a GitHub rename never touches, so it is a
     local config string agreeing with itself rather than evidence about the remote.

     Re-measured on this host 2026-08-26 with an authenticated `gh`:
       · `gh repo list globalonlinedeveloper` enumerates what the org OWNS, so a freed name is ABSENT from
         the output rather than redirected into it. POSITIVE = a line reading
         `globalonlinedeveloper/Nikatru_Platform_Public`. NEGATIVE = no line anywhere contains
         `Nikatru_Android_Apps_Public`. Both held today. A negative here raises no error and no 404,
         because it is an enumeration and not a status code.
       · `gh api repos/globalonlinedeveloper/Nikatru_Android_Apps_Public` and
         `gh repo view globalonlinedeveloper/Nikatru_Android_Apps_Public` BOTH exit 0 on the freed name and
         BOTH report `full_name` = `globalonlinedeveloper/Nikatru_Platform_Public`. They followed the
         redirect instead of answering the question. "It resolved" is the trap, not the proof.

     Residue, so the next reader does not "fix" it: `grep -rIl "Nikatru_Android_Apps_Public" .` from this
     root matches 19 files — this one, the release runbook under `tooling/release/`, and 17 others. All 17
     are dated historical records: the rename/deletion rows in `catalog/store-matrix.json`, prose in
     `.github/workflows/submit-play.yml`, guard comments under `tooling/ci/`, and `.claude/` backup logs.
     They are DELIBERATELY LEFT STANDING, because a dated record naming the name it recorded is correct and
     rewriting one falsifies it. 19 is the whole population, not a sample. -->

The NIKATRU app factory: one Flutter chassis, one Cloudflare Workers backend pattern, and the CI
that stamps, gates and ships apps from them to six platforms.

**This repository is source-visible, not open-source.** Read [`NOTICE.md`](NOTICE.md) before you
copy anything — there is deliberately no `LICENSE` file, and that absence is a build-failing check
([`tooling/ci/assert-repo-posture.mjs`](tooling/ci/assert-repo-posture.mjs)), not an oversight.
Security reports go to the address in [`SECURITY.md`](SECURITY.md).

© 2026 Rajasekar Selvam, sole proprietor, trading as NIKATRU. All rights reserved.

## What is in here

| Path | What it holds |
|---|---|
| `apps/` | Flutter applications. Today: **`apps/subly`**, a subscription tracker. |
| `packages/` | The shared Dart chassis every app is built from — `core`, `api_client`, `auth_supabase`, `design_system`, `notifications`, `platform_storage`, `purchases`, `telemetry`, `tokens`, `analysis`. |
| `services/` | Cloudflare Workers — `platform` (shared) and `subly-api` (per-app), each with its own D1 migrations. |
| `sites/` | Static sites: `nikatru`, `rajasekarselvam`, and the `_shared` component set they both build from. |
| `tooling/` | The factory itself: `bricks/` (Mason templates that stamp a new app), `ci/` (the guards), `ops/`, `release/`, `store/`, `content_pipeline/`, and the JSON registers that are the single declaration of platforms, channels, screens and versions. |
| `.github/workflows/` | Thirteen workflows. `ci.yml` is the gate; `build-platforms.yml` builds all six targets; the four `submit-*.yml` are the store lanes. `.github/actions/` holds the two composite setup actions. How they are shaped, and the rules they obey, is `docs/ci/README.md`. |
| `docs/` | The few operational documents that belong in public — `ci/` (how CI is shaped), the Supabase auth email templates, the breach-response runbook, and a direct-marketing privacy draft. |

Product design, business records and the requirement corpus are **not** in this repository and are
not published.

## Building it

The toolchain is declared once, in [`tooling/versions.json`](tooling/versions.json), and
`tooling/ci/assert-version-consistency.mjs` fails the build if any workflow disagrees with it.
As of this writing: **Flutter 3.47.1 · Node 24 · Java 17 · Melos 8.2.2 · Mason 0.1.3 · Wrangler 4.120.0.**

There are two workspaces, deliberately separate — Dart resolves through pub workspaces + Melos,
JavaScript through pnpm.

```bash
dart pub global activate melos 8.2.2
flutter pub get
melos run gate
```

`melos run gate` is the whole Dart gate: `dart analyze` across every workspace member, then
`dart test` for the pure-Dart packages and `flutter test` for the Flutter ones. It is what CI runs
and what "green" means here.

```bash
pnpm install
```

installs the JavaScript side (`sites/_shared`, `tooling/content_pipeline`). The two Workers under
`services/` keep their own committed lockfiles and use `npm ci` — that is intentional, and
[`.gitignore`](.gitignore) explains why in the comment above `**/.wrangler/`.

Four of the six platforms build on a Windows host with WSL2 (web · windows · linux · android).
**macOS and iOS build only on Apple hardware**, so they are GitHub Actions-only by construction —
that is a property of Apple's toolchain, not a gap being closed.

## The guards

`tooling/ci/` holds 130 files — 111 of them run as checks, the rest are shared modules other guards
import — and it is about 43% of this repository by line count. That ratio is
deliberate: this is a factory, and the checks are the part that has to keep working when the same
chassis is stamped into the next app. Two conventions are worth knowing before you add one:

- **A guard that passes over an empty or absent subject has checked nothing.** Guards here carry
  explicit coverage floors and say what they scanned, because this repository has repeatedly found
  scanners that quietly stopped scanning and still printed `ok`.
- **An assertion that cannot fail is worse than none**, because it inflates apparent coverage. Every
  guard is expected to carry a recorded, executed failing case in its header.

**Stated gap: there is no JavaScript or TypeScript linter here.** The Dart tree is analysed by
`melos run gate` and the JSON registers are checked by their own guards, but nothing lints the
roughly 36,000 lines of Worker TypeScript, guard `.mjs` and site JavaScript. A `biome.json` sat at
the root from the first week and was wired to nothing; it was removed on 2026-08-17 rather than
left, because a config file for a tool that never runs advertises coverage the repo does not have.
Measured before removing it: `biome ci .` reports **824 errors and 251 warnings across 477 files**,
almost all of them its formatter wanting to reflow comment blocks that are deliberately written the
way they are. Adopting a linter here is a real decision with a real diff, not a housekeeping commit.

```bash
node tooling/scripts/guard-sweep.mjs
```

runs every file in `tooling/ci/` with the arguments a workflow really passes it, read from the YAML
so they cannot drift. It asserts **completeness, not greenness**: exit 0 means every file was either
run or explained (`LIBRARY`, `MUTATES`, `NEEDS-CI`); a `RED` line is a guard reporting a finding and
you are meant to read it. Do not hand-roll a shell glob over `tooling/ci/assert-*.mjs` — that pattern
silently excluded five runnable files, which is why the script exists.

## Contributing

This is a one-person sole proprietorship and the repository does not take outside contributions.
It is public so that the apps' behaviour can be checked against the code that builds them. If you
have found a security problem, [`SECURITY.md`](SECURITY.md) is the route.
