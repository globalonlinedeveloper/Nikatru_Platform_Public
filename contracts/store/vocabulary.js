// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// contracts/store/vocabulary.js — the STORE VOCABULARY, authored once.
//
// [ADR 067] decision 1 names four things this directory holds: "tokens, legal
// text, the entitlement contract and store vocabulary". Three landed in
// September 2026; this is the fourth, and programme row P1-2 stayed `in-flight`
// for exactly that reason — see ../README.md, "What is still open".
//
// ── WHAT A "VOCABULARY" IS HERE, AND WHAT IT IS NOT ──────────────────────────
// 🔴 THIS FILE CARRIES WORDS, NOT ROWS. `tooling/channel-register.json` carries
// the ROWS — one per channel, each with its evidence, its account status, its
// lane, its deferral and ~250 KB of dated reasoning. Copying those rows here
// would be a second register and the first to drift, which is the failure this
// whole directory exists to prevent.
//
// What that register has never had is a declaration of the CLOSED SETS its rows
// spell out of. Ask it "which words may a `surface` field hold?" and the answer
// is "whichever words the twelve rows happen to use today". Ask two other
// readers the same question and you get two more answers, typed by hand:
//
//   tooling/channel-register.json      storeMetadataContract.requiredFiles — 8 names
//   extensions/scripts/check-store-metadata.mjs  REQUIRED_PER_STORE + REQUIRED_SHARED — 7 of the same names, re-typed
//   tooling/app-yaml/render.mjs        RENDERED_LISTING_FILES — 5 of the same names, re-typed
//
// Three independent spellings of ONE listing vocabulary, in one repository,
// already differing over whether `README.md` is a listing file — with nothing
// recording whether that difference was decided or drifted. That is the same
// shape as the revocation-reason set that was written into SQL and into
// TypeScript minutes apart and was out of step by one member — the failure that
// created `contracts/` in the first place.
//
// ── THE FORM ─────────────────────────────────────────────────────────────────
// Plain ES module with `// @ts-check` JSDoc types and a hand-written `.d.ts`,
// for the reason ../README.md gives at length: nothing in this directory may
// require a build step to consume. `vocabulary.json` is GENERATED from this file
// by `generate.mjs` for readers that cannot import JavaScript, and
// `generate.mjs --check` in CI is what makes it a derived copy rather than a
// second hand-maintained one.
//
// ── WHAT HOLDS IT TO REALITY ─────────────────────────────────────────────────
// `tooling/ci/assert-store-vocabulary.mjs`, in BOTH directions, like every other
// register in this repository:
//
//   · a value a consumer spells that this file does not carry   → FAIL
//   · a value this file carries that no consumer spells         → FAIL
//
// The second limb is the one that keeps this file honest. A vocabulary is only
// a contract while every word in it is load-bearing; a word nobody uses is a
// word nobody will notice going wrong.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'app' | 'extension'} Surface
 *
 * WHAT a channel delivers — a Flutter application, or a browser extension. A
 * different axis from `kind`, which says HOW distribution happens. The Chrome
 * Web Store is a store by kind and an extension channel by surface, and
 * collapsing the two would make every reader that means "app store" also mean
 * "add-on store". `tooling/ci/channel-surface.mjs` is the reader that answers
 * "does this surface ship a Flutter app?" and it answers from the register's
 * `surfaces` block, never from a literal.
 */

/** @typedef {'web' | 'store' | 'direct'} ChannelKind HOW distribution happens. */

/**
 * @typedef {'app' | 'extension' | null} AppScope
 *   `'app'` scope of a listing field on the application surface:
 *   see {@link ListingField}.
 */

/**
 * @typedef {object} ListingField
 * @property {string} name        the file name inside a listing tree
 * @property {'doc'|'text'|'url'|'json'|'image'} kind what the file holds
 * @property {'required'|'additional'|'form-rule'|null} app
 *   `'required'` — every application listing tree carries it, whatever the
 *   channel (this is `storeMetadataContract.requiredFiles`).
 *   `'additional'` — some channels carry it; WHICH channels is a per-row fact
 *   and stays in the register's `perChannel.<id>.additionalFiles`.
 *   `'form-rule'` — a channel with STORE_FORM_RULES carries it, and that
 *   channel's `answersFile` names it. Added 2026-09-22 for `form-answers.json`,
 *   which cannot be `'additional'`: a .json in `additionalFiles` is a sworn
 *   declaration to assert-sworn-store-files.mjs, whose template must stamp null
 *   answers, and these answers are chassis facts the built .apk re-proves.
 *   `null` — not an application listing field at all.
 * @property {'per-store'|'per-store-additional'|'shared'|'shared-additional'|null} extension
 *   `'per-store'` — one copy per store directory (store/chrome, store/edge,
 *   store/firefox), REQUIRED in every one, because the text genuinely differs
 *   per store.
 *   `'per-store-additional'` — lives in a store directory, but only SOME stores
 *   take it; WHICH stores is a per-row fact and stays in
 *   `extensions/scripts/store-graphics.json`, exactly as the `app` column's
 *   `'additional'` leaves its per-channel fact in the register. Added 2026-09-20
 *   for the listing graphics: Chrome takes a 440x280 promotional tile, Edge a
 *   300x300 logo, AMO neither. Without this value the only honest choices were
 *   to call them `'per-store'` — which made check-store-metadata demand Edge's
 *   logo from Chrome and both from Firefox, four failures measured — or to leave
 *   them out of the contract, which makes this guard refuse them as undeclared.
 *   Neither is the truth, and the truth is the whole point of the table.
 *   ⏱ 2026-09-24: two TEXT fields joined the graphics — Edge's
 *   `search-terms.txt` and AMO's `tags.txt`. For a text field, which store takes
 *   it is the store directory that holds the file, and a count or length limit
 *   on it is a `limits` entry in that tool's tool.json, which
 *   check-store-metadata.mjs grades; store-graphics.json governs images only.
 *   `'shared'` — one copy in store/_shared/, REQUIRED of every tool, because it
 *   does not differ between stores.
 *   `'shared-additional'` — one copy in store/_shared/, but only SOME TOOLS have
 *   it. Added 2026-09-20 in the same breath as the value above and for the
 *   mirror-image reason: `icon-128.png` declared `'shared'` became a REQUIRED
 *   shared file, and `check-store-metadata.mjs` then demanded it of every tool —
 *   including the gate self-test's synthetic `Good_Tool` fixture, which has no
 *   icon and is not supposed to. That reddened `a complete three-store layer
 *   passes`, a case about metadata, over a graphic. The listing graphics are
 *   governed by `extensions/scripts/store-graphics.json` and graded by
 *   `check-listing-assets.mjs`; they are not required metadata, on either axis.
 *   `null` — not an extension listing field.
 * @property {boolean} rendered
 *   Whether `tooling/app-yaml/render.mjs` writes this file from `app.yaml`.
 *   A rendered field is never hand-edited in a listing tree.
 */

/**
 * The twelve channel ids. The PRIMARY KEY of `tooling/channel-register.json`'s
 * `channels` array, and the directory name under `apps/{app}/store/` for every
 * application channel that has a listing tree.
 *
 * ⚠️ `apps-gov-in` declares a `storeMetadataDir` and NO tree exists on disk for
 * it. That gap is real, is the register's to close, and is recorded here only so
 * that the next reader does not "fix" it by deleting the id.
 * @type {readonly string[]}
 */
export const CHANNEL_IDS = /** @type {const} */ ([
  'web',
  'android-play',
  'ios-appstore',
  'macos-appstore',
  'windows-store',
  'windows-direct',
  'linux-snap',
  'linux-appimage',
  'apps-gov-in',
  'chrome-webstore',
  'edge-addons',
  'amo',
]);

/** @type {readonly Surface[]} */
export const SURFACES = /** @type {const} */ (['app', 'extension']);

/** @type {readonly ChannelKind[]} */
export const CHANNEL_KINDS = /** @type {const} */ (['web', 'store', 'direct']);

/**
 * The platform names a channel row's `platforms` array is validated against.
 * TWO families in one list, deliberately: the application platforms are
 * Flutter's own target names (the vocabulary `catalog/apps.json` speaks), and
 * the extension platforms are BROWSER names, which are not store ids — `amo` is
 * a storefront, `firefox` is the browser it reaches.
 * @type {readonly string[]}
 */
export const PLATFORMS = /** @type {const} */ ([
  'web',
  'android',
  'ios',
  'macos',
  'windows',
  'linux',
  'chrome',
  'edge',
  'firefox',
]);

/**
 * The storefront keys. The application surface's answer to "which storefront
 * does this channel sell through", used as a map key by the purchase rails.
 * Extension channels carry `storefrontKey: null` and use
 * {@link EXTENSION_STORE_KEYS} instead — two axes, not one, for the reason
 * {@link SURFACES} gives.
 * @type {readonly string[]}
 */
export const STOREFRONT_KEYS = /** @type {const} */ ([
  'web',
  'play',
  'appstore',
  'mac',
  'microsoft',
  'linux',
]);

/**
 * The extension store keys. These ARE directory names: every extension listing
 * tree is `extensions/Extension/{tool}/store/<key>/`.
 * @type {readonly string[]}
 */
export const EXTENSION_STORE_KEYS = /** @type {const} */ (['chrome', 'edge', 'firefox']);

/**
 * Every artifact format any channel accepts. Keys of the register's
 * `artifactBuild.formats` block, which records which build verb emits which
 * format.
 *
 * ⚠️ `.exe` IS THE ENTRY WORTH READING — `windows-direct` accepts it and
 * nothing in this repository packages one. The word stays in the vocabulary
 * because the gap is real; deleting the word would delete the record of it.
 * @type {readonly string[]}
 */
export const ARTIFACT_FORMATS = /** @type {const} */ ([
  '.zip',
  'static-bundle',
  '.aab',
  '.apk',
  '.ipa',
  '.pkg',
  '.msix',
  '.exe',
  '.snap',
  '.AppImage',
]);

/**
 * The screenshot device classes. Play's listing takes frames from more than one
 * DEVICE TYPE, and each class is a directory in the listing tree.
 *
 * 🔴 NO INCH SIZE IS CLAIMED. Google enumerates "tablets (7-inch and 10-inch)"
 * and states ONE dimension rule for "Chromebook and tablets", so the class is
 * named at the granularity of the sentence that was fetched. A `tablet-10`
 * class would be a measurement nobody made, wearing a directory name. The
 * register's `sets` block holds the dimensions and their citations; this list
 * holds only the names.
 * @type {readonly string[]}
 */
export const DEVICE_CLASSES = /** @type {const} */ (['phone', 'tablet']);

/**
 * 🔴 THE LISTING FIELD TABLE — THE ONE DECLARATION THAT FOUR ARRAYS CAME FROM.
 *
 * DECLARATION ORDER IS LOAD-BEARING. Every derived array below is this table
 * filtered, so the order here is the order each consumer already has, and a
 * consumer's array stays byte-identical to what it typed by hand. Reordering
 * this table changes four files; that is the point of it being one table.
 *
 * ⚠️ THE `app` AND `extension` COLUMNS DIFFER ON PURPOSE, and that the
 * difference was nowhere WRITTEN DOWN is the finding that motivated this file.
 * `README.md` is required in every application listing tree and is not an
 * extension listing field; `screenshots/README.md` is per-channel on the
 * application surface and SHARED on the extension surface. Two readers each
 * knew half of that, each was right, and neither recorded that it was half —
 * so nothing could tell a deliberate difference from a divergence.
 * @type {readonly ListingField[]}
 */
export const LISTING_FIELDS = /** @type {const} */ ([
  { name: 'README.md', kind: 'doc', app: 'required', extension: null, rendered: false },
  { name: 'title.txt', kind: 'text', app: 'required', extension: 'per-store', rendered: true },
  { name: 'short-description.txt', kind: 'text', app: 'required', extension: 'per-store', rendered: true },
  { name: 'long-description.txt', kind: 'text', app: 'required', extension: 'per-store', rendered: false },
  { name: 'category.txt', kind: 'text', app: 'required', extension: 'per-store', rendered: true },
  { name: 'privacy-policy-url.txt', kind: 'url', app: 'required', extension: 'shared', rendered: true },
  { name: 'support-url.txt', kind: 'url', app: 'required', extension: 'shared', rendered: true },
  // ⏱ 2026-09-24 (O-APPLE-LISTING-HAS-NO-EULA): the Terms of Use URL. It sits
  // beside the other two URLs because `urlFiles` is compared to this table IN
  // ORDER. It is `additional`, not required, because only the two Apple rows
  // name it in their `additionalFiles`, and render.mjs writes a rendered field
  // only into a channel that declares it. Its value is
  // `portfolioUrls.termsUrl`, the page the app already links to as `termsUrl`.
  { name: 'terms-of-use-url.txt', kind: 'url', app: 'additional', extension: null, rendered: true },
  { name: 'screenshots/README.md', kind: 'doc', app: 'required', extension: 'shared', rendered: false },

  // ── ADDITIONAL: a field some channels have and others do not. WHICH channels
  //    is a per-row fact and lives in the register's `perChannel` block; that
  //    this is a listing field AT ALL is vocabulary and lives here.
  { name: 'subtitle.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'keywords.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'promotional-text.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  // ⏱ 2026-09-24: `search-terms.txt` is ALSO an extension field — Edge Add-ons
  // takes search terms (store/edge/search-terms.txt), capped at seven unique
  // terms by Microsoft's developer policies §1.1.4 and graded by
  // check-store-metadata.mjs off `maxItems` in tool.json. `tags.txt` is AMO's
  // tag list and has no application channel. Both are per-store-additional:
  // one store takes each, so neither can be required of every store directory.
  { name: 'search-terms.txt', kind: 'text', app: 'additional', extension: 'per-store-additional', rendered: false },
  { name: 'tags.txt', kind: 'text', app: null, extension: 'per-store-additional', rendered: false },
  // ⏱ 2026-09-24 (EXT-3): AMO's version `approval_notes` — "Information for
  // Mozilla reviewers ... Only visible to Mozilla" (mozilla.github.io/addons-server
  // topics/api/addons.html, fetched 2026-09-24). extensions/scripts/amo-metadata.mjs
  // sends store/firefox/reviewer-notes.txt as that field on the first submit.
  { name: 'reviewer-notes.txt', kind: 'text', app: null, extension: 'per-store-additional', rendered: false },
  { name: 'snap-name.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'license.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'privacy-manifest.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'age-rating.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'data-safety.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'content-rating.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'ads-declaration.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'feature-graphic.png', kind: 'image', app: 'additional', extension: null, rendered: false },
  { name: 'store-icon-512.png', kind: 'image', app: 'additional', extension: null, rendered: false },
  // apps-gov-in, 2026-09-22: the upload form's "Developed By" field (3–50
  // characters, shown on the store), and the answers to all three steps of that
  // form, beside the listing they are filled from. See STORE_FORM_RULES.
  { name: 'developed-by.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'form-answers.json', kind: 'json', app: 'form-rule', extension: null, rendered: false },

  // ── THE EXTENSION LISTING GRAPHICS. Added 2026-09-20, when Public #844 put
  //    the first real ones on disk and this guard refused all three by name —
  //    on a rebase, before the push, which is the loop working rather than a
  //    third round of it in CI.
  //
  // ⚠️ THE SIZE IS IN THE FILENAME BECAUSE THE STORE PUBLISHES IT, and each
  // store publishes a DIFFERENT one for the same role: Chrome's promotional
  // tile is 440x280, Edge's store logo is 300x300. They are two fields, not one
  // field with a per-store size, because a file is what a listing tree holds
  // and `check-listing-assets.mjs` decodes each PNG's own IHDR to grade it.
  // Nothing here asserts those dimensions — the name records them, the guard
  // in extensions/scripts measures them, and `extensions/scripts/
  // store-graphics.json` is where they are declared once and rendered from.
  //
  // `icon-128.png` is SHARED for the reason every shared field is: all three
  // stores take the same 128px icon, so a per-store copy would be three files
  // that must never differ. AMO takes neither of the per-store graphics, which
  // is why `firefox/` holds no image at all and that is not a gap.
  { name: 'promo-tile-440x280.png', kind: 'image', app: null, extension: 'per-store-additional', rendered: false },
  { name: 'logo-300x300.png', kind: 'image', app: null, extension: 'per-store-additional', rendered: false },
  { name: 'icon-128.png', kind: 'image', app: null, extension: 'shared-additional', rendered: false },
]);

/**
 * The category strings this portfolio declares, per channel id.
 *
 * 🔴 THIS IS NOT THE STORE'S CLOSED SET, AND IT DOES NOT PRETEND TO BE. No
 * store's category list was fetched from a primary source in this increment, so
 * none is enforced — the same rule that leaves Apple's keywords field
 * unnumbered in the register. What this list DOES is replace eight scattered
 * one-line files, each its own only copy, with ONE declaration that a guard
 * compares them against in both directions. The day a category list is fetched
 * with its citation, it arrives HERE, beside the values it grades, and the
 * guard's first limb becomes a real store check with no consumer moving.
 *
 * ⚠️ `amo` CARRIES TWO, ON TWO LINES, AND THAT IS THE FIREFOX LISTING'S OWN
 * SHAPE — addons.mozilla.org takes more than one category. A reader that
 * assumed one category per file would have read the second line as the value.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const LISTING_CATEGORIES = /** @type {const} */ ({
  'android-play': ['Productivity'],
  'ios-appstore': ['Productivity'],
  'macos-appstore': ['Productivity'],
  'windows-store': ['Productivity'],
  'linux-snap': ['Productivity'],
  'chrome-webstore': ['Productivity'],
  'edge-addons': ['Productivity'],
  amo: ['Photos, Music & Videos', 'Privacy & Security'],
  // apps-gov-in: added 2026-09-20 when Public #836 created that listing tree, as
  // 'Productivity' — a value the portal does not offer. ⏱ 2026-09-22: the form's
  // own list was read (see STORE_FORM_RULES below), it has no "Productivity", and
  // this became 'Others'. THIS ROW IS NOW GRADED AGAINST A STORE-PUBLISHED SET —
  // the first one here — by assert-store-metadata.mjs's apps-gov-in limb.
  'apps-gov-in': ['Others'],
});

/**
 * The Apple category UTI each portfolio category word stands for — what
 * tooling/app-yaml/render.mjs writes into `LSApplicationCategoryType` in both
 * Apple Info.plists (O-APPLE-PLIST-KEYS-UNRENDERED). Keyed by the word an
 * app.yaml `category` carries, and it covers every category LISTING_CATEGORIES
 * lists on an Apple channel; store-vocabulary.test.mjs fails the day an Apple
 * channel lists a word this map does not resolve.
 *
 * The renderer refuses an app whose category is not a key here (exit 1: an
 * authoring error), and refuses an EMPTY map as COVERAGE LOST (exit 2), because
 * an empty map would resolve nothing while every plist stayed as it was.
 * Values are Apple's own identifiers (the `public.app-category.*` family in
 * Apple's LSApplicationCategoryType reference); add one only with its word.
 * @type {Readonly<Record<string, string>>}
 */
export const APPLE_CATEGORY_UTI = /** @type {const} */ ({
  Productivity: 'public.app-category.productivity',
});

/**
 * 🔴 A STORE'S OWN FORM RULES, READ FROM THE FORM — the first axis in this file
 * that is the STORE's closed set rather than the portfolio's. Keyed by channel
 * id; today one channel.
 *
 * apps.gov.in publishes no developer documentation for its upload form. These
 * values were read out of the form's own JavaScript (`/Developer/chunk-ZVEOEZCZ.js`,
 * 2026-09-22) and the on-screen lists, and recorded in the private runbook
 * `runbooks/store-submission-apps-gov-in.md` ("Step 1", and the section appended
 * 2026-09-22 "CORRECTIONS FROM THE FORM'S RAW SCRIPT"). Each one is a validator
 * the portal runs at upload, so a listing that breaks one is refused on the day
 * the owner sits down to upload — which is why assert-store-metadata.mjs checks
 * them on every PR and tooling/ci/assert-apps-gov-in-apk.mjs checks the one that
 * needs the BUILT .apk (the minimum platform).
 *
 * ⚠️ `listingCategory` IS A RENDERING RULE, NOT A STORE FACT: every app lists
 * under it on this portal, whatever its app.yaml `category` says, and
 * tooling/app-yaml/render.mjs writes it into this channel's category.txt. Three
 * reasons it does not depend on the app. The portal has no "Productivity".
 * "Finance" makes the form ask for an authorisation letter, and no other
 * category's extra questions have been read. And the app brick stamps
 * category.txt as a literal: a mustache template cannot test membership of the
 * 23, so a rule that depended on the category would make the stamp and the
 * renderer disagree on the first render. Listing a given app under a specific
 * category is an owner decision; `categories` is the closed set that grades it.
 *
 * ⚠️ `minPlatformLabels` STOPS AT 30 BECAUSE THE PORTAL'S LIST DOES. An .apk whose
 * minSdkVersion has no label here cannot be described truthfully on the form, and
 * the .apk guard fails it rather than letting the owner pick the nearest one.
 */
export const STORE_FORM_RULES = /** @type {const} */ ({
  'apps-gov-in': {
    source:
      "apps.gov.in developer upload form, script /Developer/chunk-ZVEOEZCZ.js and the on-screen lists, read 2026-09-22; recorded in Private runbooks/store-submission-apps-gov-in.md, 'Step 1' and the section appended 2026-09-22 'CORRECTIONS FROM THE FORM'S RAW SCRIPT'",
    asOf: '2026-09-22',
    categories: [
      'Agriculture', 'Education', 'Electoral', 'Energy', 'Entertainment', 'Finance', 'Food', 'Health',
      'Identity', 'Indian Post', 'Judiciary', 'Language', 'm-Learning', 'Municipal corporation', 'News',
      'Others', 'Shopping', 'Social', 'Social Welfare', 'Sports', 'Transport', 'Travel', 'Weather',
    ],
    listingCategory: 'Others',
    // The TEXT limits (name 2-80, developed-by 3-50, description 10-4000) are
    // NOT here: they live in tooling/channel-register.json
    // storeMetadataContract.perChannel['apps-gov-in'].maxChars, the mechanism
    // every other channel's text limits already use. One fact, one home.
    supportPhoneMaxChars: 12,
    // The listing file that holds the answer to every field of this form, one
    // per app tree; assert-store-metadata.mjs requires it by this name.
    answersFile: 'form-answers.json',
    screenshots: { dir: 'screenshots', min: 4, max: 8, width: 155, height: 290, maxBytes: 1048576, formats: ['png', 'jpg'] },
    icon: { file: 'store-icon-512.png', width: 512, height: 512, maxBytesExclusive: 204800 },
    minPlatformLabels: {
      21: 'Lollipop 5.0',
      22: 'Lollipop 5.1',
      23: 'Marshmallow',
      24: 'Nougat 7.0',
      25: 'Nougat 7.1',
      26: 'Oreo 8.0',
      27: 'Oreo 8.1',
      28: 'Pie',
      29: 'Android 10',
      30: 'Android 11',
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED VIEWS. Each one is a consumer's array, produced by filtering the one
// table above. They are functions rather than constants so that a caller cannot
// mutate a shared array and have the mutation reach every other caller.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `storeMetadataContract.requiredFiles` — the files every APPLICATION listing
 * tree carries, whatever the channel.
 * @returns {string[]}
 */
export const appRequiredListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.app === 'required').map((f) => f.name);

/**
 * The application listing fields that only some channels carry. The register's
 * `perChannel.<id>.additionalFiles` arrays are subsets of this.
 * @returns {string[]}
 */
export const appAdditionalListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.app === 'additional').map((f) => f.name);

/**
 * The application listing fields a store's own form requires. Each is some
 * STORE_FORM_RULES row's `answersFile`.
 * @returns {string[]}
 */
export const appFormRuleListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.app === 'form-rule').map((f) => f.name);

/**
 * `storeMetadataContract.urlFiles` — the listing fields whose content is a URL,
 * so a reader knows to grade them as one.
 * @returns {string[]}
 */
export const urlListingFiles = () => LISTING_FIELDS.filter((f) => f.kind === 'url').map((f) => f.name);

/**
 * `extensions/scripts/check-store-metadata.mjs` REQUIRED_PER_STORE — one copy
 * per store directory, because the text differs per store.
 * @returns {string[]}
 */
export const extensionPerStoreListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.extension === 'per-store').map((f) => f.name);

/**
 * `extensions/scripts/check-store-metadata.mjs` REQUIRED_SHARED — one copy in
 * `store/_shared/`, because the text does not differ per store.
 * @returns {string[]}
 */
export const extensionSharedListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.extension === 'shared').map((f) => f.name);

/**
 * The extension listing fields that live in a store directory but that only
 * SOME stores take — the listing graphics, whose sizes each store publishes
 * for itself, and (since 2026-09-24) Edge's search terms and AMO's tags.
 * `check-store-metadata.mjs` binds it as ADDITIONAL_PER_STORE and grades any
 * of these files a tool.json `limits` block names.
 *
 * 🔴 NOT A SUBSET OF {@link extensionPerStoreListingFiles} AND NOT ADDED TO IT.
 * `check-store-metadata.mjs` reads that array as REQUIRED_PER_STORE and demands
 * every name in it from every store directory, so folding these in made it ask
 * Chrome for Edge's logo and Firefox for both — four failures, measured
 * 2026-09-20 before this value existed. A reader that wants "may this file be
 * here?" takes the union; a reader that wants "must this file be here?" takes
 * the required array alone. Those are different questions and this file now
 * lets a consumer ask either one.
 *
 * WHICH store takes which graphic is not here, for the same reason the app
 * column's per-channel fact is not here: it is a row, and it lives in
 * `extensions/scripts/store-graphics.json`, which is also what renders them.
 * @returns {string[]}
 */
export const extensionAdditionalListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.extension === 'per-store-additional').map((f) => f.name);

/**
 * The extension listing fields that live in `store/_shared/` but that only SOME
 * TOOLS have — today the 128px icon.
 *
 * 🔴 NOT A SUBSET OF {@link extensionSharedListingFiles}, for the same reason
 * its per-store twin is not a subset of the required per-store array, and the
 * failure that proved it was the mirror image: declared `'shared'`, the icon
 * became a REQUIRED shared file and `check-store-metadata.mjs` demanded it of
 * every tool — including the gate self-test's synthetic `Good_Tool`, which has
 * no icon and should not need one. A case about store METADATA went red over a
 * GRAPHIC. The graphics are declared in `extensions/scripts/store-graphics.json`
 * and graded by `check-listing-assets.mjs`; this array exists so a reader can
 * say "may be here" without any reader being made to say "must be here".
 * @returns {string[]}
 */
export const extensionSharedAdditionalListingFiles = () =>
  LISTING_FIELDS.filter((f) => f.extension === 'shared-additional').map((f) => f.name);

/**
 * `tooling/app-yaml/render.mjs` RENDERED_LISTING_FILES — the listing files the
 * renderer owns. Everything else under a channel tree is sworn or editorial.
 * @returns {string[]}
 */
export const renderedListingFiles = () => LISTING_FIELDS.filter((f) => f.rendered).map((f) => f.name);

/**
 * Every listing file name this vocabulary knows, in declaration order.
 * @returns {string[]}
 */
export const allListingFiles = () => LISTING_FIELDS.map((f) => f.name);

/**
 * The whole vocabulary as one plain object. `generate.mjs` serialises THIS, so
 * an axis added above and left out here would be absent from `vocabulary.json`
 * and caught by `--check` rather than shipping half-present.
 */
export const STORE_VOCABULARY = {
  channelIds: CHANNEL_IDS,
  surfaces: SURFACES,
  channelKinds: CHANNEL_KINDS,
  platforms: PLATFORMS,
  storefrontKeys: STOREFRONT_KEYS,
  extensionStoreKeys: EXTENSION_STORE_KEYS,
  artifactFormats: ARTIFACT_FORMATS,
  deviceClasses: DEVICE_CLASSES,
  listingFields: LISTING_FIELDS,
  listingCategories: LISTING_CATEGORIES,
  storeFormRules: STORE_FORM_RULES,
  appleCategoryUti: APPLE_CATEGORY_UTI,
};

/** The axis names, so a reader can enumerate them without hardcoding a list. */
export const VOCABULARY_AXES = /** @type {const} */ ([
  'channelIds',
  'surfaces',
  'channelKinds',
  'platforms',
  'storefrontKeys',
  'extensionStoreKeys',
  'artifactFormats',
  'deviceClasses',
  'listingFields',
  'listingCategories',
  'storeFormRules',
  'appleCategoryUti',
]);
