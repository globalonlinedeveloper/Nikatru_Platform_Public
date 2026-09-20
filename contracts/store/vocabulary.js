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
 * @property {'required'|'additional'|null} app
 *   `'required'` — every application listing tree carries it, whatever the
 *   channel (this is `storeMetadataContract.requiredFiles`).
 *   `'additional'` — some channels carry it; WHICH channels is a per-row fact
 *   and stays in the register's `perChannel.<id>.additionalFiles`.
 *   `null` — not an application listing field at all.
 * @property {'per-store'|'per-store-additional'|'shared'|null} extension
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
 *   `'shared'` — one copy in store/_shared/, because it does not differ.
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
  { name: 'screenshots/README.md', kind: 'doc', app: 'required', extension: 'shared', rendered: false },

  // ── ADDITIONAL: a field some channels have and others do not. WHICH channels
  //    is a per-row fact and lives in the register's `perChannel` block; that
  //    this is a listing field AT ALL is vocabulary and lives here.
  { name: 'subtitle.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'keywords.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'promotional-text.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'search-terms.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'snap-name.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'license.txt', kind: 'text', app: 'additional', extension: null, rendered: false },
  { name: 'privacy-manifest.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'age-rating.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'data-safety.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'content-rating.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'ads-declaration.json', kind: 'json', app: 'additional', extension: null, rendered: false },
  { name: 'feature-graphic.png', kind: 'image', app: 'additional', extension: null, rendered: false },
  { name: 'store-icon-512.png', kind: 'image', app: 'additional', extension: null, rendered: false },

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
  { name: 'icon-128.png', kind: 'image', app: null, extension: 'shared', rendered: false },
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
  // apps-gov-in: added 2026-09-20 when Public #836 created that listing tree. The
  // store publishes no category list of its own (its 18-page guidelines name none),
  // so this is what the tree spells, UNVERIFIED against a store-published set like
  // every other row here.
  'apps-gov-in': ['Productivity'],
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
 * SOME stores take — today the listing graphics, whose sizes each store
 * publishes for itself.
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
]);
