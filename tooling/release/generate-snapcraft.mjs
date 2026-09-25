#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-snapcraft.mjs — the snapcraft recipe, DERIVED at build time, for any
// stamped app.
//
// [pipeline D-10] / [ADR 015] §3. `tooling/release/submit-snap.mjs` §4 has
// printed the same gap on every run since it was written:
//
//     NO SNAPCRAFT RECIPE — none of apps/{app}/snap/snapcraft.yaml,
//     apps/{app}/snapcraft.yaml exists, so nothing in this repo can build a
//     .snap today.
//
// This closes it WITHOUT putting a file under apps/. That is not squeamishness
// about a frozen tree: a committed recipe is a SECOND COPY of five facts that
// already have one home each — the snap name, the summary, the description, the
// licence and the Linux binary identity — and a second copy is the copy that
// goes stale. [10]D-5's whole claim is "the listing lives in the repo and the
// dashboard is a copy of it"; a hand-written snapcraft.yaml would make the
// recipe a third party to that agreement, free to disagree with both.
//
// So the recipe is GENERATED into a build directory, from artifacts that are
// maintained for their own reasons, and it is regenerated on every run. Nothing
// about it is app-specific in this file — there is no app slug anywhere below,
// and `--app` selects which maintained tree is read.
//
// ── WHERE EVERY EMITTED VALUE COMES FROM ────────────────────────────────────
//   name          store/linux-snap/snap-name.txt — the GLOBAL namespace
//                 OWNER_QUEUE A-6 claims, never invented here
//   title         store/linux-snap/title.txt
//   summary       store/linux-snap/short-description.txt
//   description   store/linux-snap/long-description.txt
//   license       store/linux-snap/license.txt
//   command       BINARY_NAME     in the app's linux/CMakeLists.txt
//   desktop       APPLICATION_ID  in the app's linux/CMakeLists.txt, via the
//                 entry tooling/store/render-linux-icons.mjs already generates
//                 and CMake already installs into the bundle's share/ prefix
//   base          the LINUX BUILD JOB'S OWN RUNNER LABEL in
//                 .github/workflows/build-platforms.yml, mapped through
//                 BASE_FOR_RUNNER below
//   stage-packages  DERIVED from the apt list that workflow installs for the
//                 Linux build (extracted by the documented parser in this
//                 file) through RUNTIME_OF: each build package's runtime
//                 library, less what the gnome extension's content snap carries
//   extensions    SNAP_EXTENSIONS below
//   version       --version, the release line the lane already derives
//   source        --bundle, emitted RELATIVE to --out so no host path leaks
//   which store   tooling/channel-register.json — the `kind: "store"` row whose
//                 `platforms` include linux supplies `storeMetadataDir`
//
// The two directories this file reads are the two the register and the icon
// generator already read. It adds no new source of truth.
//
// ── WHAT IS NOT DERIVED, AND WHY EACH ONE IS A CONSTANT ─────────────────────
// `grade`, `confinement`, the plug set, the extension and the runtime map
// (RUNTIME_OF). Each carries its reasoning at its
// declaration below rather than here, and each is EXPORTED so that
// tooling/ci/assert-snapcraft-generable.mjs asserts against this declaration
// instead of a retyped copy of it.
//
// ── THIS SCRIPT NEVER RUNS snapcraft ────────────────────────────────────────
// It writes a configuration file and stops. `snapcraft` does not exist on the
// owner's Windows box, so a build here would be an unproven call in a script
// nobody could exercise. What IS provable on any machine is that the recipe can
// be produced from the tree and is structurally what the Snap Store needs, and
// that is what the guard asserts.
//
// ⚠️ THE SENTENCE ABOVE USED TO END "…and is not on the runner image either …
// Building a real .snap stays with the channel, which [ADR 015] §2 defers", and
// as of 2026-08-09 the second half is false: `.github/workflows/submit-snap.yml`
// installs snapcraft and PACKS one, on dispatch. What [ADR 015] §2 defers is
// SERVING the channel — an upload to the store — not proving that the recipe
// this file writes is one snapcraft accepts.
//
// Usage:
//   node tooling/release/generate-snapcraft.mjs \
//     --app subscriptiontracker --bundle apps/subscriptiontracker/build/linux/x64/release/bundle \
//     --out build/snap/subscriptiontracker --version 1.0.75
//   node tooling/release/generate-snapcraft.mjs --emit-build-deps
//     → the Linux lane's apt list, space-separated on stdout, for a second job
//       that must install the same toolchain (see the CLI block at the bottom).
//       It is the BUILD list; the recipe stages the runtime list derived from it.
//   [--repo-root path]  read the maintained artifacts from another tree (tests)
//   [--print]           write the recipe to stdout as well as to --out
//
// Exit 0 = a complete recipe was written. 1 = it could not be derived, and the
// reason names the artifact that is missing rather than the key that is absent.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// THE ONE WORKFLOW PARSE. Four guards already read `.github/workflows` through
// this module, and its header records why a fifth private copy would drift in
// the one way that reports clean: WHICH LINES IT CAN SEE. The apt list below is
// inside a `run: |` block, which is exactly the shape a line-anchored regex gets
// wrong.
import { parseWorkflow, shellSegments } from '../ci/workflow-scan.mjs';
// THE ONE READING OF AN APP'S LINUX IDENTITY. `readLinuxIdentity` parses
// `set(...)` calls with comments stripped, because that file's own comments name
// both variables in prose — a bare text match reads the explanation, not the
// value. Importing it is what keeps this recipe's `command` and the installed
// .desktop entry the same identity by construction rather than by agreeing today.
import {
  readLinuxIdentity,
  deriveDesktopEntry,
  LinuxBrandUnavailable,
  PACKAGING_DIR,
  HICOLOR_SIZES,
} from '../store/render-linux-icons.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const REGISTER = 'tooling/channel-register.json';
export const BUILD_WORKFLOW = '.github/workflows/build-platforms.yml';

/** Where the recipe is written under `--out`. snapcraft reads `snap/snapcraft.yaml`
 *  relative to the project directory, so `--out` IS the project directory and
 *  this is the fixed path inside it. */
export const RECIPE_PATH = 'snap/snapcraft.yaml';

/**
 * THE SNAP'S GUI DIRECTORY — the one place a snap's launcher entry and icon may
 * live, and the reason this generator emits two more files than it used to.
 *
 * ✅ SOURCED, fetched 2026-08-09: https://ubuntu.com/docs/snapcraft/stable/
 * how-to/crafting/configure-package-information/ — "create files named
 * `<snap-name>.desktop` and `<snap-name>.png` in the `snap/gui/` directory in
 * your project's source", "Assign `Icon` to the absolute path of the image file.
 * This path must be the location of the icon after the snap is installed", and
 * "Since Snapcraft copies all the contents of the `snap/gui/` folder to
 * `meta/gui` during installation, the absolute path of the icon in this
 * arrangement is `${SNAP}/meta/gui/<snap-name>.png`".
 */
export const GUI_DIR = 'snap/gui';

/**
 * `grade: stable` — the Snap Store's own vocabulary for "this is a release, not
 * a devel build". A `devel` grade CANNOT be released to the stable channel, so a
 * generator that emitted it would produce a recipe that builds and then refuses
 * at exactly the moment it matters. ✅ The closed-source posture behind it is
 * sourced: knowledge/research/33 records that the Snap Store "actively
 * encourages and supports proprietary, closed-source software … developers can
 * confidently declare grade: stable".
 */
export const GRADE = 'stable';

/**
 * `confinement: strict` — the sandbox is on, and every host resource the app
 * touches has to be a declared interface. The alternative, `classic`, is not a
 * looser default: it requires MANUAL STORE REVIEW and an argued case, and it is
 * granted for things a sandbox genuinely cannot host (compilers, debuggers). A
 * subscription tracker is not that, so `strict` is both correct and the only
 * value that submits without a human negotiation.
 */
export const CONFINEMENT = 'strict';

/**
 * THE DESKTOP INTERFACE SET A FLUTTER GTK APP DECLARES.
 *
 * ✅ FOUR OF THESE ARE [ADR 015] §3's. tooling/channel-register.json's
 * `linux-snap` row records it verbatim: the snap "must declare `plugs: [opengl,
 * wayland, x11, audio-playback]`". They are ADR_015_PLUGS below, and the guard
 * refuses a recipe missing any of them.
 *
 * ✅ THE REST ARE SOURCED AS OF 2026-09-24 (every page read that day):
 *   · `desktop`, `desktop-legacy` — the gnome extension connects both to every
 *     app that uses it, alongside opengl, wayland and x11 ("Included app plugs",
 *     https://ubuntu.com/docs/snapcraft/stable/reference/extensions/gnome-extension/).
 *     Declared here as well so the recipe states its whole interface set.
 *   · `network` — "allows client access to the network"; auto-connect: yes
 *     (https://snapcraft.io/docs/reference/interfaces/network-interface/). The
 *     app talks to its API.
 *   · `password-manager-service` — "access to the global password manager
 *     services provided by popular desktop environments, such as Secret Service
 *     and KWallet"; auto-connect: NO
 *     (https://snapcraft.io/docs/reference/interfaces/password-manager-service-interface/).
 *     flutter_secure_storage binds libsecret (the lane's libsecret-1-dev, ADR 005),
 *     a "Secret Service D-Bus client library"
 *     (https://gnome.pages.gitlab.gnome.org/libsecret/), and this interface is
 *     what grants a strict snap that service. RUNTIME_OF names it on
 *     libsecret-1-dev and the guard holds this array to that. Because it does not
 *     auto-connect, the store auto-connect request is an owner step at un-defer
 *     time.
 *
 * 🔴 `home` LEFT ON 2026-09-24. The interface grants "access to non-hidden
 * files owned by the user in the user's home ($HOME) directory"
 * (https://snapcraft.io/docs/reference/interfaces/home-interface/), and this
 * app's storage goes through path_provider into the snap's own user data. A
 * strict snap declares the capabilities it uses, and it does not use this one.
 *
 * ⚠️ `audio-playback` STAYS, AND IT STAYS BECAUSE [ADR 015] IS LOCKED. §3
 * assumed media_kit, and [ADR 013] keeps media_kit OFF Linux, so nothing in a
 * Linux build plays audio today. Dropping it reverses an owner decision, which
 * this file does not do. The owner is not being asked while native Linux is
 * deferred ([ADR 015] §2): revisit it on NEW evidence when Linux is un-deferred.
 *
 * The set is a SET rather than derived per-app because THIS REPOSITORY HOLDS
 * NOTHING THAT MAPS A PUBSPEC DEPENDENCY TO AN INTERFACE — deriving it from the
 * app's manifests would mean inventing that map, and an invented map fires on
 * correct input, silently, at install time.
 *
 * Exported so the guard asserts the emitted list against THIS array. A guard
 * carrying its own copy of the set would agree with a generator that had drifted.
 */
export const DESKTOP_PLUGS = Object.freeze([
  'desktop',
  'desktop-legacy',
  'wayland',
  'x11',
  'opengl',
  'network',
  'audio-playback',
  'password-manager-service',
]);

/**
 * [ADR 015] §3's plug set, verbatim from tooling/channel-register.json's
 * `linux-snap` row: "must declare `plugs: [opengl, wayland, x11,
 * audio-playback]`". [ADR 015] is LOCKED, so the guard refuses a recipe — or a
 * DESKTOP_PLUGS — that lacks any of these, whatever else changes around it.
 */
export const ADR_015_PLUGS = Object.freeze(['opengl', 'wayland', 'x11', 'audio-playback']);

/**
 * ⏱ 2026-09-24 · THE EXTENSION THE APP DECLARES: `gnome`.
 *
 * ✅ SOURCED, read 2026-09-24:
 * https://ubuntu.com/docs/snapcraft/stable/reference/extensions/gnome-extension/
 * — "helps build snaps that use GTK 3, GNOME 42 and higher, and GLib"; "This
 * extension is compatible with the core22 and core24 bases". On core24 it plugs
 * the content snap `gnome-46-2404` (default-provider gnome-46-2404, target
 * `$SNAP/gnome-platform`), whose recipe
 * (https://raw.githubusercontent.com/ubuntu/gnome-sdk/gnome-46-2404/snap/snapcraft.yaml)
 * stages the whole `gnome-46-2404-sdk` snap's `usr` and
 * `lib/$CRAFT_ARCH_TRIPLET_BUILD_FOR` trees, headers and .pc files excluded.
 *
 * That content snap is what lets RUNTIME_OF mark GTK, libsecret and liblzma as
 * SUPPLIED rather than staged: the extension plugs it at `$SNAP/gnome-platform`
 * and sets `SNAP_DESKTOP_RUNTIME` to that path (same reference). That the primed
 * app then RESOLVES them there is the pack-time read-back RUNTIME_OF names as
 * open.
 */
export const SNAP_EXTENSIONS = Object.freeze(['gnome']);

/** The gnome-46-2404-sdk recipe every `suppliedBy` claim below was read from.
 *  The platform recipe that stages it is cited on SNAP_EXTENSIONS. */
const GNOME_46_SDK_RECIPE = 'https://raw.githubusercontent.com/ubuntu/gnome-sdk/gnome-46-2404-sdk/snapcraft.yaml';

/**
 * ⏱ 2026-09-24 · WHAT EACH LINUX-LANE BUILD PACKAGE LEAVES THE BUNDLE NEEDING
 * AT RUNTIME.
 *
 * The lane installs BUILD packages: a compiler, build systems, and `-dev`
 * packages whose headers and link-time `.so` names the bundle compiled against.
 * None of them is what a running app loads. Until 2026-09-24 the recipe staged
 * that list verbatim, so a `plugin: dump` part — which compiles nothing —
 * shipped clang, cmake and a stack of header trees.
 *
 * `stage-packages` is therefore DERIVED from the lane list through this map:
 *   · `runtime: null` — a build tool. Nothing of it is loaded at runtime, and
 *     `why` quotes the package page that says what it is.
 *   · `runtime: 'pkg'` — the noble package the `-dev` package depends on, i.e.
 *     the library the bundle links. It is STAGED, unless
 *   · `suppliedBy: 'snap'` — the gnome extension's content snap already carries
 *     that library (`suppliedSource` says where that was read), so staging it
 *     would ship a duplicate of what the platform mounts.
 *   · `plug` — an interface the library needs under strict confinement.
 *     DESKTOP_PLUGS has to carry it, and the guard checks that.
 *
 * ✅ EVERY NAME WAS READ, NOT REMEMBERED. Noble renamed libraries in the t64
 * transition (libgtk-3-0 → libgtk-3-0t64, libcurl4 → libcurl4t64: jammy's
 * libgtk-3-dev and libcurl4-openssl-dev pages, read the same day, depend on
 * the old names), so a name recalled from jammy is wrong on core24. `source` is
 * the packages.ubuntu.com page each runtime name was read from (the `-dev`
 * package's "dep:" list), on `read`. The names are NOBLE'S because core24
 * stages from noble: a lane that moves to another runner needs this map read
 * again, since a name the new archive does not carry cannot be staged.
 *
 * 🔴 AN UNMAPPED LANE PACKAGE IS A REFUSAL, the rule BASE_FOR_RUNNER applies to
 * an unmapped label. A package the workflow gained because a build broke is a
 * library the app may now load; passing its name through stages a `-dev`
 * package, and skipping it ships without the library. Both are silent.
 *
 * ⬜ WHAT THIS DOES NOT PROVE: that the primed snap resolves every DT_NEEDED of
 * the bundle. The map covers the libraries the lane installs on purpose; the
 * transitive rest is the base's and the platform's to carry. A pack-time `ldd`
 * read-back is row O-SNAP-PRIMED-LIBS-UNREAD, gated on un-deferring Linux.
 *
 * Exported so the guard derives its expectation through `stagePackagesFor` and
 * grades each entry's sources with `runtimeOfProblems`.
 */
export const RUNTIME_OF = new Map([
  [
    'clang',
    {
      runtime: null,
      why: '"C, C++ and Objective-C compiler (LLVM based)" — the compiler the bundle was built with',
      source: 'https://packages.ubuntu.com/noble/clang',
      read: '2026-09-24',
    },
  ],
  [
    'cmake',
    {
      runtime: null,
      why: '"cross-platform, open-source make system" — the build system Flutter drives',
      source: 'https://packages.ubuntu.com/noble/cmake',
      read: '2026-09-24',
    },
  ],
  [
    'ninja-build',
    {
      runtime: null,
      why: '"small build system closest in spirit to Make" — the executor CMake generates for',
      source: 'https://packages.ubuntu.com/noble/ninja-build',
      read: '2026-09-24',
    },
  ],
  [
    'pkg-config',
    {
      runtime: null,
      why: '"manage compile and link flags for libraries" — read at configure time only',
      source: 'https://packages.ubuntu.com/noble/pkg-config',
      read: '2026-09-24',
    },
  ],
  [
    'libgtk-3-dev',
    {
      runtime: 'libgtk-3-0t64',
      suppliedBy: 'gnome-46-2404',
      source: 'https://packages.ubuntu.com/noble/libgtk-3-dev',
      suppliedSource: `${GNOME_46_SDK_RECIPE} — part \`gtk3\` builds GTK 3.24.52 from source`,
      read: '2026-09-24',
    },
  ],
  [
    'liblzma-dev',
    {
      runtime: 'liblzma5',
      suppliedBy: 'gnome-46-2404',
      source: 'https://packages.ubuntu.com/noble/liblzma-dev',
      suppliedSource: `${GNOME_46_SDK_RECIPE} — part \`debs\` lists \`liblzma5\` in its stage-packages`,
      read: '2026-09-24',
    },
  ],
  [
    'libsecret-1-dev',
    {
      runtime: 'libsecret-1-0',
      suppliedBy: 'gnome-46-2404',
      plug: 'password-manager-service',
      source: 'https://packages.ubuntu.com/noble/libsecret-1-dev',
      suppliedSource: `${GNOME_46_SDK_RECIPE} — part \`libsecret\` builds libsecret 0.21.7 from source`,
      plugSource: 'https://snapcraft.io/docs/reference/interfaces/password-manager-service-interface/',
      read: '2026-09-24',
    },
  ],
  [
    'libjsoncpp-dev',
    {
      // Neither gnome-sdk recipe names jsoncpp, so it is staged.
      runtime: 'libjsoncpp25',
      suppliedBy: null,
      source: 'https://packages.ubuntu.com/noble/libjsoncpp-dev',
      read: '2026-09-24',
    },
  ],
  [
    'libcurl4-openssl-dev',
    {
      // The SDK stages libcurl4-openssl-dev, but its runtime package is not
      // named in either recipe, so it is staged rather than assumed.
      runtime: 'libcurl4t64',
      suppliedBy: null,
      source: 'https://packages.ubuntu.com/noble/libcurl4-openssl-dev',
      read: '2026-09-24',
    },
  ],
]);

/**
 * ⏱ 2026-09-23 · THE ONE SLOT: the app's own D-Bus name, on the session bus.
 *
 * The Linux runner is a UNIQUE GApplication (apps/<id>/linux/runner/
 * my_application.cc), so a second launch — which is what the browser opening the
 * auth-callback URL is — forwards its command line to the running instance over
 * the session bus under APPLICATION_ID. Strict confinement lets a snap own a
 * well-known bus name only through a `dbus` slot naming it; without the slot
 * g_application_register() is refused and the runner falls back to NON_UNIQUE
 * (the exchange still completes, in a second window). The name is the Linux
 * identity's APPLICATION_ID, read from CMake like every other identity field.
 */
export const DBUS_SLOT = 'dbus-application-id';

/**
 * RUNNER LABEL → snapcraft `base`.
 *
 * ✅ SOURCED, fetched 2026-08-08:
 * https://ubuntu.com/docs/snapcraft/stable/reference/bases/ — "core24 · Ubuntu
 * 24.04 LTS · Supported" and "core22 · Ubuntu 22.04 LTS · Supported". The base
 * names the Ubuntu release whose libraries the snap runs against, so it has to
 * be the release the BUNDLE WAS COMPILED ON, or the app links at runtime against
 * libraries it did not build with.
 *
 * 🔴 IT IS DERIVED FROM THE LANE'S OWN `runs-on:` RATHER THAN TYPED, and that is
 * the whole reason this is a map instead of a string. The Linux bundle this
 * recipe dumps is produced by build-platforms.yml on that runner; a constant
 * `core24` here would be a SECOND DECLARATION of the build platform, free to
 * disagree with the workflow the day somebody moves the job. The bundle and the
 * base cannot disagree if only one of them is written down.
 *
 * AN UNKNOWN KEY IS A HARD FAILURE, the same rule render-linux-icons.mjs applies
 * to its category map and for the same reason: passing an unmapped label through
 * produces a file that is wrong in a way nothing downstream detects. A floating
 * label such as `ubuntu-latest` is unmappable ON PURPOSE — it names an image
 * family, not a release, so a base derived from it would change under the app
 * with no commit anywhere.
 */
export const BASE_FOR_RUNNER = new Map([
  ['ubuntu-22.04', 'core22'],
  ['ubuntu-24.04', 'core24'],
]);

/**
 * LISTING LICENCE VALUES THAT CANNOT BE EMITTED AS `license:`, with the reason.
 *
 * 🔴 FOUND BY THE FIRST REAL PACK (run 31294305898, 2026-08-09), NOT BY ANY
 * CHECK IN THIS TREE. The recipe carried `license: "proprietary"`, straight from
 * apps/{app}/store/linux-snap/license.txt, and snapcraft refused it:
 *
 *     cannot validate license "proprietary": unknown license: proprietary
 *
 * ✅ WHY THERE IS NO SPELLING THAT WORKS, read at the primary source rather than
 * guessed. The `license` key is "the project's license as an SPDX expression.
 * Currently, only SPDX 2.1 expressions are supported"
 * (https://ubuntu.com/docs/snapcraft/stable/reference/snapcraft-yaml/, fetched
 * 2026-08-09). The validator that produced that exact string is snapd's own,
 * https://github.com/snapcore/snapd/blob/master/spdx/parser.go (fetched
 * 2026-08-09), whose `newLicenseID` is a linear scan of a fixed list:
 *
 *     for _, known := range allLicenses { if needle == known { … } }
 *     return "", fmt.Errorf("unknown license: %s", s)
 *
 * There is NO `LicenseRef-` or `DocumentRef-` branch, so SPDX's own escape hatch
 * for non-listed licences is rejected too — which is why this is an OMISSION and
 * not a translation to some other string. Case does not help either: no casing of
 * this word is on the SPDX License List.
 *
 * ✅ AND OMITTING IT IS NOT A LOSS OF THE FACT. `license` is not a required key
 * (same reference), and the store fills the same answer in: "By default, when no
 * license is specified (which is always the case when pushing from `snapcraft`),
 * the `Proprietary` value is assumed" — matiasb, store-side, in
 * https://forum.snapcraft.io/t/snap-license-metadata/856 (fetched 2026-08-09).
 * So the listing keeps saying `proprietary`, which is TRUE, and the recipe
 * reaches the same store value by the only route snapd accepts.
 *
 * ⚠️ THIS MAP IS NOT AN SPDX VALIDATOR AND MUST NEVER BECOME ONE. It records the
 * values this repository has PROVEN unemittable; everything else is passed
 * through verbatim for snapd to judge. A hand-rolled allowlist would be an
 * invented limit that fires on correct input — the failure this repo has already
 * paid for twice (a made-up 120-character store limit; a guessed base).
 *
 * Exported so tooling/ci/assert-snapcraft-generable.mjs asserts against THIS
 * declaration instead of a retyped copy of it.
 */
export const NON_SPDX_LICENCES = new Map([
  [
    'proprietary',
    'snapd\'s SPDX parser accepts only identifiers on the SPDX License List and has no `LicenseRef-` branch, so no spelling of this word validates. The Snap Store assumes `Proprietary` when the key is absent, which is the same answer by the only route that packs.',
  ],
]);

/** The `license:` value to emit for a listing value, or `null` to omit the key.
 *  Lookup is case-insensitive: SPDX identifiers ARE case-sensitive, but no casing
 *  of a word in this map is an identifier, so a capitalised `Proprietary` would
 *  fail in exactly the same way and must be caught by the same rule. */
export function licenceForRecipe(listingValue) {
  const why = NON_SPDX_LICENCES.get(String(listingValue).trim().toLowerCase());
  return why === undefined ? { license: String(listingValue).trim(), omittedBecause: null } : { license: null, omittedBecause: why };
}

/** The recipe could not be derived from the tree. Same shape as
 *  `LinuxBrandUnavailable`, so a caller renders either the same way. */
export class SnapcraftUngenerable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

const refuse = (lines) => {
  throw new SnapcraftUngenerable(lines);
};

// ─────────────────────────────────────────────────────────────────────────────
// THE apt LIST, EXTRACTED — never retyped.
//
// [pipeline F-2]: the packages the Linux build needs are declared once, in the
// workflow that installs them. The snap's `stage-packages` is DERIVED from that
// list through RUNTIME_OF — each build package's runtime library, less what the
// gnome extension's content snap carries — and is NOT the list itself: staging
// the build list put a compiler and header trees into a `dump` build and none of
// the libraries under their runtime names (2026-09-24). A retyped runtime list
// would drift in the direction that reports clean — the workflow gains a package
// because a build broke, the typed list does not gain its runtime, and the snap
// builds and then fails to start. Deriving it, through a map that refuses an
// unmapped package, turns that drift into a refusal.
//
// ⚠️ THE LIST IS INLINE YAML, so it is extracted rather than imported, and the
// parser is documented here rather than being a regex somebody has to reverse-
// engineer:
//
//   1. `parseWorkflow` gives comment-BLANKED lines grouped by job, so a
//      commented-out package is not read as a live one, and reported line
//      numbers still point into the real file.
//   2. `joinBlockScalars` (inside parseWorkflow) collapses the `run: |` block
//      into ONE logical line whose shell commands are separated by ` ; `. That
//      is what makes the multi-line apt command visible at all — a line-anchored
//      match sees `sudo apt-get install -y` and nothing after it.
//   3. A SHELL LINE CONTINUATION (a trailing backslash) became that same ` ; `
//      in the join, so it is undone FIRST: the backslash means the next line is
//      the same command, and treating it as a command boundary would truncate
//      the list at the first continuation — silently, to a shorter but non-empty
//      list, which is the failure shape this whole file is arranged against.
//   4. Command boundaries are then split with the shared `shellSegments`, so
//      `apt-get update` cannot contribute packages.
//   5. Tokens after `install` that do not begin with a dash are the packages.
//
// SELF-CHECKS, because a parser that quietly matches nothing is worse than none:
//   · EXACTLY ONE install command in the file. Two means this function would
//     have to choose, and a chooser with no stated rule picks silently.
//   · Its job must also build Linux, so the list belongs to the lane whose
//     artifact is being packaged rather than to some other job's toolchain.
//   · A non-empty result. An empty apt list derives an empty `stage-packages`,
//     which is a snap that builds and ships without its dependencies.
// ─────────────────────────────────────────────────────────────────────────────

/** `{ packages, job, runner, line }` for the Linux build lane. */
export function readLinuxBuildLane(root) {
  const wf = parseWorkflow(root, BUILD_WORKFLOW);
  if (wf === null) {
    refuse([
      `COVERAGE LOST — ${BUILD_WORKFLOW} does not exist under ${root}.`,
      'It is the single declaration of what the Linux build installs and which runner it installs it on.',
      'Without it this generator would have to carry its own copy of both, which is the second declaration',
      'that drifts.',
    ]);
  }

  const found = [];
  for (const job of wf.jobs.values()) {
    const body = job.logical.map((l) => l.text).join('\n');
    const buildsLinux = /flutter\s+build\s+linux\b/.test(body);
    for (const line of job.logical) {
      // Step 3: undo the ` ; ` that joinBlockScalars put where a shell line
      // continuation was. Everything after this is a real command boundary.
      const rejoined = line.text.replace(/\\\s+;\s+/g, ' ');
      for (const seg of shellSegments(rejoined)) {
        if (!/\bapt-get\s+install\b/.test(seg)) continue;
        const toks = seg.trim().split(/\s+/);
        const at = toks.indexOf('install');
        const packages = toks.slice(at + 1).filter((t) => t !== '' && t !== '\\' && !t.startsWith('-'));
        found.push({ job: job.name, packages, n: line.n, buildsLinux });
      }
    }
  }

  if (found.length !== 1) {
    refuse([
      `COVERAGE LOST — ${BUILD_WORKFLOW} contains ${found.length} \`apt-get install\` command(s); this parser requires exactly one.`,
      found.length === 0
        ? 'Zero means the extraction stopped matching: the step was renamed, reshaped, or the install moved into an action. An empty `stage-packages` is a snap that ships without its dependencies, so this refuses rather than emitting one.'
        : `More than one means this function would have to CHOOSE which list the snap stages (${found.map((f) => `${f.job}:${f.n}`).join(', ')}), and a chooser with no stated rule picks silently.`,
      'Teach this parser the new shape in the same change that alters the workflow.',
    ]);
  }

  const lane = found[0];
  if (!lane.buildsLinux) {
    refuse([
      `COVERAGE LOST — the only \`apt-get install\` in ${BUILD_WORKFLOW} is in job "${lane.job}", which does not run \`flutter build linux\`.`,
      'The packages a snap stages must be the ones the LANE THAT PRODUCED THE BUNDLE installed. A list',
      "lifted from another job's toolchain would be a confident answer to the wrong question.",
    ]);
  }
  if (lane.packages.length === 0) {
    refuse([
      `COVERAGE LOST — the \`apt-get install\` at ${BUILD_WORKFLOW}:${lane.n} yielded NO package names.`,
      'The command was found and read as empty, which is the one outcome that would produce a recipe with',
      'an empty `stage-packages` and no error anywhere.',
    ]);
  }
  const duplicates = [...new Set(lane.packages.filter((p, i) => lane.packages.indexOf(p) !== i))];
  if (duplicates.length) {
    refuse([
      `${BUILD_WORKFLOW}:${lane.n} names ${duplicates.join(', ')} more than once.`,
      'A duplicate is not fatal to snapcraft, but it means the extraction and the workflow disagree about',
      'how many packages there are, and every equality check downstream inherits that disagreement.',
    ]);
  }

  // The runner label, from the same job. `runs-on:` is a JOB key, so it sits at
  // exactly 4 spaces — the anchor that keeps a step's keys out of this read.
  const job = wf.jobs.get(lane.job);
  const runsOn = job.lines.map((l) => l.text).find((t) => /^ {4}runs-on:\s*\S/.test(t));
  const runner = runsOn ? runsOn.replace(/^ {4}runs-on:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : null;
  if (!runner) {
    refuse([
      `COVERAGE LOST — job "${lane.job}" in ${BUILD_WORKFLOW} declares no scalar \`runs-on:\`.`,
      'The base is derived from the runner the bundle was compiled on. With no label there is nothing to',
      'derive it FROM, and a constant here would be a second declaration of the build platform.',
    ]);
  }
  return { packages: lane.packages, job: lane.job, runner, line: lane.n };
}

/**
 * The recipe's `stage-packages`, DERIVED from the lane's apt list through
 * RUNTIME_OF: the runtime package of every lane package that has one and is not
 * supplied by the extension's content snap, in lane order, once each. It may be
 * EMPTY — every library supplied — and the recipe then carries no
 * `stage-packages` key. An unmapped lane package REFUSES.
 */
export function stagePackagesFor(packages, map = RUNTIME_OF) {
  const unmapped = packages.filter((p) => !map.has(p));
  if (unmapped.length) {
    refuse([
      `${BUILD_WORKFLOW}'s Linux apt list names ${unmapped.join(', ')}, which has no entry in RUNTIME_OF.`,
      'The recipe stages the RUNTIME library each build package leaves the bundle needing, and nothing',
      'here says what that is for this package. Passing the name through would stage a build package;',
      'skipping it would ship without its library. Read its noble page on packages.ubuntu.com (the',
      '"dep:" list of a -dev package), check the gnome-sdk recipes for it, and add the entry with both',
      'sources and the read date.',
    ]);
  }
  const out = [];
  for (const p of packages) {
    const e = map.get(p);
    if (e.runtime && !e.suppliedBy && !out.includes(e.runtime)) out.push(e.runtime);
  }
  return out;
}

/**
 * Every RUNTIME_OF entry, graded for its SOURCES. Returns one line per defect.
 * Exported so the guard runs it over the real map and the test over a doctored
 * one. "Possibility is not observation": an entry with no page behind it is a
 * remembered name, and noble's t64 renames are exactly where memory is wrong.
 */
export function runtimeOfProblems(map = RUNTIME_OF) {
  const out = [];
  const url = (v) => typeof v === 'string' && /^https:\/\/\S+/.test(v);
  const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (map.size === 0) out.push('RUNTIME_OF is EMPTY, so every lane package is unmapped and nothing can be staged.');
  for (const [pkg, e] of map) {
    const at = `RUNTIME_OF "${pkg}"`;
    if (!url(e?.source)) out.push(`${at} carries no \`source\` URL, so its answer is remembered rather than read.`);
    if (!date(e?.read)) out.push(`${at} carries no \`read\` date (YYYY-MM-DD) for its source.`);
    if (e?.runtime === null) {
      if (typeof e.why !== 'string' || e.why.trim() === '') out.push(`${at} maps to no runtime package and says no \`why\`.`);
      if (e.suppliedBy) out.push(`${at} maps to no runtime package, so there is nothing for "${e.suppliedBy}" to supply.`);
    } else if (typeof e?.runtime !== 'string' || !/^[a-z0-9][a-z0-9+.-]*$/.test(e.runtime)) {
      out.push(`${at} has runtime ${JSON.stringify(e?.runtime)}, which is not a package name.`);
    } else {
      if (/-dev$/.test(e.runtime)) out.push(`${at} maps to "${e.runtime}", a development package, as its runtime.`);
      if (e.suppliedBy && !url(e.suppliedSource)) {
        out.push(`${at} says "${e.suppliedBy}" supplies ${e.runtime} and carries no \`suppliedSource\` URL where that was read.`);
      }
    }
    if (e?.plug && !url(e.plugSource)) out.push(`${at} requires plug "${e.plug}" and carries no \`plugSource\` URL.`);
  }
  return out;
}

/** snapcraft `base` for the runner the Linux bundle is compiled on. */
export function baseForRunner(runner) {
  const base = BASE_FOR_RUNNER.get(runner);
  if (!base) {
    refuse([
      `runner label "${runner}" has no snapcraft base recorded in BASE_FOR_RUNNER.`,
      'The base names the Ubuntu release whose libraries the snap runs against, and it has to be the',
      'release the bundle was COMPILED on. Passing an unmapped label through would produce a recipe that',
      'links against libraries it did not build with — wrong in a way nothing downstream detects.',
      `Known: ${[...BASE_FOR_RUNNER.keys()].join(', ')}. A floating label such as \`ubuntu-latest\` is`,
      'deliberately unmappable: it names an image family, not a release, so the base would change under',
      'the app with no commit anywhere. Pin the workflow, or add the label here with its Ubuntu release.',
      'Mapping source: https://ubuntu.com/docs/snapcraft/stable/reference/bases/ (fetched 2026-08-08).',
    ]);
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LISTING, READ FROM THE TREE THE REGISTER POINTS AT
// ─────────────────────────────────────────────────────────────────────────────

/** The `kind: "store"` channel row whose `platforms` include linux. */
export function linuxStoreRow(root) {
  const path = join(root, REGISTER);
  if (!existsSync(path)) {
    refuse([
      `COVERAGE LOST — ${REGISTER} does not exist under ${root}.`,
      'It is what says WHICH directory holds a Linux store listing. Without it this generator would have',
      'to hardcode a path, and a hardcoded path is how a generator keeps reading a tree the register has',
      'already moved.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    refuse([`COVERAGE LOST — ${REGISTER} is not valid JSON — ${e.message}`]);
  }
  const rows = (register.channels ?? []).filter(
    (c) => c?.kind === 'store' && Array.isArray(c.platforms) && c.platforms.includes('linux'),
  );
  if (rows.length === 0) {
    refuse([
      `COVERAGE LOST — ${REGISTER} declares no \`kind: "store"\` row whose platforms include linux.`,
      'There is then no Linux store channel to write a recipe for, and emitting one anyway would be a',
      'recipe for a store this factory does not claim to serve.',
    ]);
  }
  if (rows.length > 1) {
    refuse([
      `${REGISTER} declares ${rows.length} Linux store rows (${rows.map((r) => r.id).join(', ')}).`,
      'A snapcraft recipe belongs to exactly one of them, and nothing in this file says which. Pass the',
      'choice in explicitly, in the same change that adds the second row.',
    ]);
  }
  const row = rows[0];
  if (typeof row.storeMetadataDir !== 'string' || row.storeMetadataDir.trim() === '') {
    refuse([
      `COVERAGE LOST — ${REGISTER} row "${row.id}" declares no \`storeMetadataDir\`.`,
      'Every listing value below is read from that directory. With no template the reads would range over',
      'a path built from nothing.',
    ]);
  }
  return row;
}

/** One trimmed listing field, or a refusal naming the FILE rather than the key. */
function listingField(root, dirRel, file) {
  const rel = `${dirRel}/${file}`;
  const path = join(root, dirRel, file);
  if (!existsSync(path)) {
    refuse([
      `${rel} does not exist.`,
      'Every value in the emitted recipe is DERIVED from the listing rather than typed, so a missing file',
      'is a missing recipe rather than a defaulted field. [pipeline D-5]: a second hand-typed copy of the',
      'app name is the copy that goes stale.',
    ]);
  }
  const value = readFileSync(path, 'utf8').trim();
  if (value === '') {
    refuse([`${rel} is EMPTY. An empty listing field satisfies "the file exists" and publishes a blank.`]);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMISSION
// ─────────────────────────────────────────────────────────────────────────────

/** A YAML double-quoted scalar. JSON's string grammar is a subset of YAML's
 *  double-quoted grammar, so this is exact rather than approximately right — and
 *  it is used on EVERY scalar that is not a fixed keyword, the version included,
 *  because an unquoted `1.0` is a float and an unquoted `no` is false. */
const q = (s) => JSON.stringify(String(s));

/** A literal block scalar at two-space indent. Trailing whitespace is stripped
 *  per line so the emitted file is byte-stable and never carries invisible drift
 *  in from an editor. */
function blockScalar(text, indent = '  ') {
  const body = String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .map((l) => (l === '' ? '' : `${indent}${l}`))
    .join('\n');
  return `|\n${body}`;
}

/**
 * Everything the recipe needs, gathered from the tree. Separated from the text
 * so the guard can assert against the FACTS as well as against the rendering.
 */
export function deriveSnapcraftFacts({ root, app, bundle, out, version }) {
  if (typeof app !== 'string' || app.trim() === '') {
    refuse(['--app is required: it selects which maintained tree is read.']);
  }
  if (typeof version !== 'string' || version.trim() === '') {
    refuse([
      '--version is required and must be non-empty.',
      'It is the RELEASE LINE the lane already derives from pubspec — the same string every other channel',
      'carries. Defaulting it here would mint a SECOND version, which is the defect [9]R-2 exists for.',
    ]);
  }
  if (/\s/.test(version.trim())) {
    refuse([`--version ${q(version)} contains whitespace; a snap version is a single token.`]);
  }

  const row = linuxStoreRow(root);
  const dirRel = row.storeMetadataDir.replace('{app}', app);
  const appDir = join(root, 'apps', app);
  if (!existsSync(appDir)) {
    refuse([`apps/${app} does not exist under ${root} — there is no app to package.`]);
  }

  // The Linux identity, through the module that already owns that parse.
  let identity;
  try {
    identity = readLinuxIdentity(appDir);
  } catch (e) {
    if (!(e instanceof LinuxBrandUnavailable)) throw e;
    refuse(e.lines);
  }

  const lane = readLinuxBuildLane(root);
  const base = baseForRunner(lane.runner);
  const stagePackages = stagePackagesFor(lane.packages);

  const snapName = listingField(root, dirRel, 'snap-name.txt');
  if (snapName.includes('\n')) {
    refuse([
      `${dirRel}/snap-name.txt holds more than one line.`,
      'A snap has exactly one name; two candidates means nobody decided.',
    ]);
  }
  // The same SHAPE check submit-snap.mjs applies, with the same caveat: the
  // authoritative character rules are UNVERIFIED, so this can only reject a name
  // no snap has ever had. It is here AS WELL AS there because this file WRITES
  // the name into a recipe, and a recipe is the thing `snapcraft` reads.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(snapName)) {
    refuse([
      `${dirRel}/snap-name.txt is ${q(snapName)}, which is not the shape a snap name takes`,
      '(lowercase letters, digits and hyphens; not leading or trailing a hyphen). The authoritative',
      'character rules are UNVERIFIED — this is a shape check, not a sourced limit.',
    ]);
  }

  // ── the bundle ────────────────────────────────────────────────────────────
  if (typeof bundle !== 'string' || bundle.trim() === '') {
    refuse(['--bundle is required: it is what the `dump` plugin ingests.']);
  }
  const bundleAbs = resolve(bundle);
  if (!existsSync(bundleAbs) || !statSync(bundleAbs).isDirectory()) {
    refuse([
      `--bundle ${bundle} is not a directory.`,
      'It must be the built Linux bundle — what `flutter build linux --release` leaves in',
      'build/linux/x64/release/bundle. `plugin: dump` copies it verbatim; there is nothing to compile.',
    ]);
  }
  // 🔴 THE ONE CHECK THAT COSTS NOTHING AND CATCHES THE WRONG DIRECTORY. A path
  // that exists and is a directory satisfies every test above while being the
  // build root, the repo root, or last release's bundle. The binary CMake was
  // told to produce is what makes this bundle THIS app's.
  if (!existsSync(join(bundleAbs, identity.binaryName))) {
    refuse([
      `--bundle ${bundle} contains no file named "${identity.binaryName}".`,
      `That is BINARY_NAME in apps/${app}/linux/CMakeLists.txt and it is the recipe's \`command\`. A`,
      "directory without it is not this app's bundle, and a recipe pointing at it would build a snap that",
      'installs cleanly and launches nothing.',
    ]);
  }
  const desktopRel = `share/applications/${identity.applicationId}.desktop`;
  const desktopMissing = !existsSync(join(bundleAbs, desktopRel));

  // ── the icon the SNAP layer will carry ────────────────────────────────────
  // 🔴 THE SECOND THING THE FIRST REAL PACK FOUND (run 31294305898, 2026-08-09):
  //
  //     Icon 'com.nikatru.subscriptiontracker' specified in desktop file … not found in
  //     prime directory
  //
  // The bundle's entry says `Icon=com.nikatru.subscriptiontracker` — a BARE THEME NAME, which
  // is correct freedesktop and is what makes one entry serve deb, flatpak and
  // AppImage (render-linux-icons.mjs says so at the line that writes it). Snap is
  // the layer that does not do theme lookup: its `Icon` must be "the absolute
  // path of the image file … the location of the icon after the snap is
  // installed". The icons ARE primed — CMake installs the whole hicolor tree into
  // the bundle — and snapcraft still refused, because it resolves the name
  // against the prime directory rather than against an icon theme in it.
  //
  // So the snap layer gets its OWN pair, TRANSLATED from the maintained ones
  // rather than duplicating them: see `snapGuiFiles` below. The committed
  // .desktop keeps its bare `Icon=` and stays packaging-layer-agnostic, which is
  // the property apps/{app}/linux/CMakeLists.txt exists to protect.
  //
  // The LARGEST primed size wins because meta/gui carries exactly one file and a
  // launcher downscales far better than it upscales. HICOLOR_SIZES is already
  // ordered largest-first and is imported, never retyped — a private copy here
  // would keep picking 512 the day the renderer's set changes.
  const iconCandidates = HICOLOR_SIZES.map((s) => `share/icons/hicolor/${s}x${s}/apps/${identity.applicationId}.png`);
  const iconRel = iconCandidates.find((rel) => existsSync(join(bundleAbs, rel))) ?? null;

  // ── the source path, RELATIVE ─────────────────────────────────────────────
  // 🔴 A HOST PATH IN A RECIPE IS A RECIPE THAT ONLY BUILDS ON ONE MACHINE, and
  // on this repo's primary host it is worse than unportable: a Windows drive path
  // is not something snapcraft can parse at all. `relative` returns an ABSOLUTE
  // path when the two sides are on different Windows drives, so the result is
  // checked rather than assumed.
  //
  // 🔴 THE FRAME IS THE PROJECT DIRECTORY (`--out`), NOT THE RECIPE FILE, AND THE
  // DIFFERENCE IS ONE `..` THAT NOTHING IN THIS REPOSITORY COULD HAVE CAUGHT.
  // This computed the path relative to `<out>/snap` — "relative to the recipe
  // itself" — until 2026-08-09. snapcraft does not resolve it that way: a part's
  // local `source:` is resolved from the PROJECT directory, the one snapcraft is
  // run in, and `snap/snapcraft.yaml` is a fixed path INSIDE that directory. So
  // the emitted path carried exactly one extra `..` and pointed one level above
  // the bundle. Every check in the tree passed — it is relative, it holds no host
  // path, it parses — because no machine in this repository had `snapcraft` on it
  // to reject the result. The fix arrives with the first job that actually packs.
  // Source: https://forum.snapcraft.io/t/part-source-when-snapcraft-yaml-is-in-snap-dir/19361
  // (fetched 2026-08-09) — "your part source will be `.`, as it's relative to the
  // snap project (where you run `snapcraft`)".
  const outAbs = resolve(out ?? '.');
  const sourceRel = relative(outAbs, bundleAbs).split('\\').join('/');
  if (sourceRel === '' || isAbsolute(sourceRel) || /^[A-Za-z]:/.test(sourceRel)) {
    refuse([
      `--bundle and --out have no relative path between them (${q(sourceRel)}).`,
      'The recipe records the bundle as a path relative to the snapcraft PROJECT DIRECTORY so it is',
      'portable; on Windows two different drives make that impossible. Put the bundle and the output',
      'directory on one volume.',
    ]);
  }

  // ── the listing, READ BEFORE anything derived from it ─────────────────────
  // 🔴 THE ORDER IS THE DIAGNOSIS. `deriveDesktopEntry` reads four of these files
  // too, and its refusals are phrased for a desktop entry ("the desktop entry has
  // no short-description.txt to carry") where `listingField`'s name the contract
  // ("is EMPTY. An empty listing field satisfies 'the file exists' and publishes a
  // blank"). Reading them here first means an emptied listing field is reported as
  // what it is, rather than as a consequence two derivations downstream.
  const title = listingField(root, dirRel, 'title.txt');
  const summary = listingField(root, dirRel, 'short-description.txt');
  const description = listingField(root, dirRel, 'long-description.txt');

  // ── the licence, TRANSLATED rather than passed through ────────────────────
  // The listing keeps saying what is TRUE about the licence; the recipe carries
  // it only when snapd can validate it. See NON_SPDX_LICENCES for the sources.
  const listedLicence = listingField(root, dirRel, 'license.txt');
  const { license, omittedBecause: licenceOmittedBecause } = licenceForRecipe(listedLicence);

  // ── the maintained launcher text, TRANSLATED not re-derived ───────────────
  // ⚠️ IT IS READ HERE AND NOT INSIDE `snapGuiFiles`, so its refusal joins every
  // other one: deriving it at emit time let a `LinuxBrandUnavailable` (a missing
  // `category.txt`) escape as an unhandled throw with a stack trace, and a crash
  // is not a catch.
  let baseDesktopEntry;
  try {
    baseDesktopEntry = deriveDesktopEntry(appDir);
  } catch (e) {
    if (!(e instanceof LinuxBrandUnavailable)) throw e;
    refuse(e.lines);
  }

  // The snap-layer launcher entry, DERIVED from the same function that writes the
  // maintained freedesktop one, with exactly the two fields the snap layer
  // defines differently. See `snapGuiFiles`.
  const guiDesktopRel = `${GUI_DIR}/${snapName}.desktop`;
  const guiIconRel = iconRel === null ? null : `${GUI_DIR}/${snapName}.png`;

  return {
    app,
    channelId: row.id,
    storeMetadataDir: dirRel,
    name: snapName,
    title,
    summary,
    description,
    listedLicence,
    license,
    licenceOmittedBecause,
    version: version.trim(),
    base,
    grade: GRADE,
    confinement: CONFINEMENT,
    plugs: [...DESKTOP_PLUGS],
    extensions: [...SNAP_EXTENSIONS],
    dbusSlot: DBUS_SLOT,
    busName: identity.applicationId,
    stagePackages,
    command: identity.binaryName,
    applicationId: identity.applicationId,
    baseDesktopEntry,
    bundleAbs,
    desktopRel,
    desktopMissing,
    iconRel,
    guiDesktopRel,
    guiIconRel,
    sourceRel,
    lane,
  };
}

/**
 * THE SNAP LAYER'S LAUNCHER PAIR: relative path under the project directory →
 * bytes. Empty of nothing — the desktop entry is always produced; the icon is
 * only there when the bundle primed one.
 *
 * 🔴 TRANSLATED, NOT DUPLICATED, AND THE DIFFERENCE IS THE WHOLE DESIGN. The text
 * comes from `deriveDesktopEntry`, the same function that writes the maintained
 * freedesktop entry, so Name, Comment and Categories cannot drift between the two
 * layers. Exactly TWO fields are rewritten, and each is a place where snap and
 * freedesktop genuinely disagree:
 *
 *   · `Icon` — freedesktop resolves a BARE NAME through the icon theme, which is
 *     what lets one entry serve deb, flatpak and AppImage. Snap does not: the
 *     value must be "the absolute path of the image file … the location of the
 *     icon after the snap is installed", i.e. `${SNAP}/meta/gui/<snap-name>.png`.
 *     Emitting the bare name is exactly what failed the first real pack.
 *   · `Exec` — freedesktop runs the binary by name off PATH. In a snap the
 *     command is the one snapd exposes, which for an app named after its snap is
 *     the SNAP NAME. The recipe names the app `f.name` a few lines below, so this
 *     is that same string by construction rather than by agreeing today. Only the
 *     PROGRAM is rewritten: the field codes after it stay, because `%u` is where
 *     the desktop puts the com.nikatru.<id>://auth-callback URL (2026-09-23).
 *
 * ⚠️ THE `Icon` LINE IS DROPPED, NOT DEFAULTED, WHEN THE BUNDLE PRIMED NO ICON.
 * A path to a file that will not be in meta/gui is worse than no line at all: the
 * launcher shows a broken image instead of the desktop's generic fallback, and
 * nothing anywhere would say why.
 */
export function snapGuiFiles(f) {
  const lines = f.baseDesktopEntry
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => {
      if (/^Exec=/.test(l)) return l.replace(/^Exec=\S+/, `Exec=${f.name}`);
      if (/^Icon=/.test(l)) return f.iconRel === null ? null : `Icon=\${SNAP}/meta/gui/${f.name}.png`;
      return l;
    })
    .filter((l) => l !== null);
  const out = new Map();
  out.set(f.guiDesktopRel, Buffer.from(lines.join('\n'), 'utf8'));
  if (f.iconRel !== null) out.set(f.guiIconRel, readFileSync(join(f.bundleAbs, f.iconRel)));
  return out;
}

/**
 * The recipe's TEXT. Deterministic: same tree and same arguments, same bytes.
 *
 * ⚠️ NO ANGLE-BRACKET SLOTS AND NO PLACEHOLDER WORDS APPEAR IN THE OUTPUT, the
 * comments included. The guard rejects an emitted recipe carrying either,
 * because a recipe that READS as a template is one somebody will fill in by hand
 * — and a hand-filled generated file is the second copy this whole file exists
 * to prevent.
 */
export function renderSnapcraftYaml(f) {
  const L = [];
  L.push('# GENERATED by tooling/release/generate-snapcraft.mjs — do not edit, and do not commit.');
  L.push('#');
  L.push('# Every value here is derived from an artifact maintained for its own reasons:');
  L.push(`# the listing in ${f.storeMetadataDir}, the Linux identity in`);
  L.push(`# apps/${f.app}/linux/CMakeLists.txt, the apt list and runner label in`);
  L.push(`# ${BUILD_WORKFLOW}, and the channel row "${f.channelId}" in`);
  L.push(`# ${REGISTER}. Regenerate this file; never repair it. A hand edit is a`);
  L.push('# second copy of a fact that already has one home, and the second copy is the');
  L.push('# one that goes stale.');
  L.push('');
  L.push(`name: ${f.name}`);
  L.push(`title: ${q(f.title)}`);
  L.push(`version: ${q(f.version)}`);
  L.push(`summary: ${q(f.summary)}`);
  L.push(`description: ${blockScalar(f.description)}`);
  if (f.license === null) {
    // The KEY IS ABSENT and the reason is in the file, because a reader who finds
    // no `license:` in a generated recipe will otherwise assume the generator
    // forgot one. Sources are on NON_SPDX_LICENCES in the generator.
    L.push(`# NO \`license:\` KEY, DELIBERATELY. ${f.storeMetadataDir}/license.txt says`);
    L.push(`# "${f.listedLicence}", and snapd's SPDX parser rejects it: it accepts only identifiers`);
    L.push('# on the SPDX License List and has no `LicenseRef-` branch, so there is no spelling');
    L.push('# that validates. The Snap Store assumes `Proprietary` when the key is absent, which');
    L.push('# is the same answer by the only route that packs. The listing keeps the true word.');
  } else {
    L.push(`license: ${q(f.license)}`);
  }
  L.push('');
  L.push('# The base names the Ubuntu release whose libraries this snap runs against, and');
  L.push(`# it is derived from the runner the bundle is compiled on: job "${f.lane.job}"`);
  L.push(`# runs on ${f.lane.runner}. Mapping source, fetched 2026-08-08:`);
  L.push('# https://ubuntu.com/docs/snapcraft/stable/reference/bases/');
  L.push(`base: ${f.base}`);
  L.push(`grade: ${f.grade}`);
  L.push(`confinement: ${f.confinement}`);
  L.push('');
  L.push('# The runner is a unique GApplication: a second launch (the browser opening the');
  L.push('# auth-callback URL) hands its command line to the running app over the session');
  L.push('# bus, under the Linux APPLICATION_ID. This slot is what lets the snap own that name.');
  L.push('slots:');
  L.push(`  ${f.dbusSlot}:`);
  L.push('    interface: dbus');
  L.push('    bus: session');
  L.push(`    name: ${f.busName}`);
  L.push('');
  L.push('apps:');
  L.push(`  ${f.name}:`);
  L.push(`    command: ${f.command}`);
  // 🔴 NO `desktop:` KEY, AND ITS ABSENCE IS THE FIX FOR THE SECOND PACK FAILURE.
  // It pointed at the bundle's freedesktop entry, whose `Icon` is a bare theme
  // name — correct for every OTHER packaging layer and unresolvable for snapcraft,
  // which searches the prime directory rather than an icon theme in it. The snap
  // layer's launcher is `snap/gui/<name>.desktop` + `<name>.png` instead, which
  // snapcraft copies to meta/gui verbatim and where the `Icon` can be the absolute
  // installed path the snap format requires. Both are emitted by this generator.
  L.push(`    # The launcher lives in ${GUI_DIR}/, not here — see the generator's snapGuiFiles.`);
  L.push('    # The gnome extension plugs its content snap (GTK, libsecret and the rest of the');
  L.push('    # GNOME 46 stack) as the desktop runtime at $SNAP/gnome-platform. The stage list');
  L.push('    # below leaves those libraries out because of it.');
  L.push('    extensions:');
  for (const e of f.extensions) L.push(`      - ${e}`);
  L.push('    plugs:');
  for (const p of f.plugs) L.push(`      - ${p}`);
  L.push('    slots:');
  L.push(`      - ${f.dbusSlot}`);
  L.push('');
  L.push('parts:');
  L.push(`  ${f.name}:`);
  L.push('    # The prebuilt Flutter bundle, ingested verbatim. Nothing is compiled here:');
  L.push('    # the binary, its lib/ and data/ directories, and the freedesktop desktop');
  L.push('    # entry and hicolor icons CMake installs under share/ are all already in it.');
  L.push('    plugin: dump');
  L.push(`    source: ${f.sourceRel}`);
  L.push('    # No build-packages: dump compiles nothing, and the key would install a');
  L.push('    # toolchain on the packing host for a step that never runs.');
  if (f.stagePackages.length) {
    L.push('    # The RUNTIME libraries of the apt list the Linux build lane installs at');
    L.push(`    # ${BUILD_WORKFLOW}:${f.lane.line}, derived through the generator's RUNTIME_OF`);
    L.push("    # and less what the gnome extension's content snap carries. The build");
    L.push('    # packages themselves (compiler, headers) are never loaded, so never staged.');
    L.push('    stage-packages:');
    for (const p of f.stagePackages) L.push(`      - ${p}`);
  } else {
    L.push(`    # NO stage-packages: every runtime library of the apt list at`);
    L.push(`    # ${BUILD_WORKFLOW}:${f.lane.line} is carried by the gnome extension's`);
    L.push("    # content snap, per the generator's RUNTIME_OF.");
  }
  L.push('');
  return L.join('\n');
}

/** Derive and render in one call. Returns `{ facts, yaml }`. */
export function generateSnapcraft(options) {
  const facts = deriveSnapcraftFacts(options);
  return { facts, yaml: renderSnapcraftYaml(facts) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Only when invoked directly: the guard imports the functions above, and a module
// that wrote files on import would write into the tree it is checking.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const root = resolve(opt('repo-root') ?? join(HERE, '..', '..'));

  // ── --emit-build-deps: THE apt LIST, FOR A SECOND JOB THAT NEEDS IT ────────
  // 🔴 IT IS THE SAME EXTRACTION `stage-packages` IS DERIVED FROM, EXPOSED
  // RATHER THAN RETYPED — the BUILD list, which the recipe no longer stages
  // verbatim. submit-snap.yml compiles the Linux bundle it packs, so it needs the
  // same GTK/secret-storage/curl toolchain build-platforms.yml installs — and a
  // second `sudo apt-get install -y clang cmake …` line in that file would be the
  // exact [pipeline F-2] duplication `readLinuxBuildLane` exists to prevent, one
  // file further away. It would also break the extraction outright the day
  // somebody moved the snap build into build-platforms.yml: that parser requires
  // EXACTLY ONE `apt-get install` in the file it reads.
  //
  // Emitted space-separated on one line so a shell can spread it into `apt-get
  // install -y $(…)`, and nothing else is printed on stdout — a diagnostic mixed
  // into that stream becomes a package name.
  if (argv.includes('--emit-build-deps')) {
    let lane;
    try {
      lane = readLinuxBuildLane(root);
    } catch (e) {
      if (!(e instanceof SnapcraftUngenerable)) throw e;
      console.error('generate-snapcraft: REFUSING to emit a build-dep list');
      for (const l of e.lines) console.error(`  ${l}`);
      process.exit(1);
    }
    process.stdout.write(`${lane.packages.join(' ')}\n`);
    console.error(
      `generate-snapcraft: ${lane.packages.length} build dep(s) from ${BUILD_WORKFLOW}:${lane.line} (job "${lane.job}", ${lane.runner})`,
    );
    process.exit(0);
  }

  const out = opt('out');
  if (!out) {
    console.error('FAIL --out is required: it is the snapcraft project directory the recipe is written into.');
    process.exit(1);
  }

  let result;
  try {
    result = generateSnapcraft({ root, app: opt('app'), bundle: opt('bundle'), out, version: opt('version') });
  } catch (e) {
    if (!(e instanceof SnapcraftUngenerable)) throw e;
    console.error('generate-snapcraft: REFUSING');
    for (const l of e.lines) console.error(`  ${l}`);
    process.exit(1);
  }

  const target = join(resolve(out), RECIPE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  // LF, always. The repo stores LF (.gitattributes `* text=auto eol=lf`) and the
  // consumer is a Linux packaging tool either way.
  writeFileSync(target, result.yaml, { encoding: 'utf8' });
  if (argv.includes('--print')) process.stdout.write(result.yaml);

  // The launcher pair, into the SAME project directory. Written here rather than
  // inside `generateSnapcraft` for the reason the recipe is: a module that wrote
  // files on import would write into the tree the guard is checking.
  for (const [rel, bytes] of snapGuiFiles(result.facts)) {
    const p = join(resolve(out), rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }

  const f = result.facts;
  console.log(`generate-snapcraft: ok — ${join(out, RECIPE_PATH)}`);
  console.log(`   snap "${f.name}" ${f.version} · base ${f.base} · ${f.grade}/${f.confinement}`);
  console.log(
    `   command ${f.command} · ${f.plugs.length} plug(s) · extension(s) ${f.extensions.join(', ')} · ` +
      `${f.stagePackages.length} stage-package(s) derived from ${f.lane.packages.length} build package(s) at ${BUILD_WORKFLOW}:${f.lane.line}`,
  );
  console.log(
    `   launcher ${f.guiDesktopRel}` +
      (f.iconRel === null ? ' · NO ICON' : ` + ${f.guiIconRel} (from the bundle's ${f.iconRel})`),
  );
  if (f.license === null) {
    console.log(`   ⬜ no \`license:\` key — ${f.storeMetadataDir}/license.txt says "${f.listedLicence}": ${f.licenceOmittedBecause}`);
  }
  if (f.desktopMissing) {
    // Printed, not failed: the bundle a caller hands this script is whatever
    // `flutter build linux` produced, and on a machine where the icons have not
    // been generated the entry is legitimately absent. Failing here would make
    // this script unusable for the exact case it exists to unblock, while saying
    // nothing would keep a launcher-less snap invisible.
    console.log(`   ⬜ the bundle carries no ${f.desktopRel} — every OTHER packaging layer installs without a launcher entry.`);
    console.log(`      Generate it with: node tooling/store/render-linux-icons.mjs --app ${f.app}`);
    console.log(`      (CMake installs it from apps/${f.app}/${PACKAGING_DIR} at build time.)`);
  }
  if (f.iconRel === null) {
    // Same rule, and it is the one the first real pack turned from theory into a
    // failed build: the emitted entry simply carries NO `Icon=` line rather than
    // a path to a file that will not be in meta/gui.
    console.log(`   ⬜ the bundle primed no hicolor icon for "${f.applicationId}" — the snap's launcher has no icon.`);
    console.log(`      Generate them with: node tooling/store/render-linux-icons.mjs --app ${f.app}`);
  }
  console.log('   ⚠️ NOT BUILT. This wrote a configuration file; `snapcraft` was not run and is not installed here.');
}
