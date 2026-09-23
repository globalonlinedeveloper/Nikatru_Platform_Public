#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-vocabulary.mjs — the store vocabulary has ONE home, and every
// word in it is load-bearing.
//
// Subject: contracts/store/vocabulary.js (+ its generated vocabulary.json).
// Programme row: P1-2. [ADR 067] decision 1 — "a top-level `contracts/`
// directory holds tokens, legal text, the entitlement contract and store
// vocabulary". The first three landed in September 2026; the fourth is this.
//
// ── WHY THIS GUARD EXISTS ────────────────────────────────────────────────────
// Before the contract, the listing-field vocabulary was typed by hand in three
// places that did not know about each other:
//
//   tooling/channel-register.json               storeMetadataContract.requiredFiles — 8 names
//   extensions/scripts/check-store-metadata.mjs REQUIRED_PER_STORE + REQUIRED_SHARED — 7, re-typed
//   tooling/app-yaml/render.mjs:95              RENDERED_LISTING_FILES — 5, re-typed
//
// They already disagreed about whether `README.md` is a listing file and about
// whether `screenshots/README.md` is per-channel or shared. Each was right about
// its own surface and none knew it was describing half of something.
//
// ── BOTH DIRECTIONS, LIKE EVERY OTHER REGISTER HERE ──────────────────────────
//   →  a value a consumer spells that the contract does not carry   FAILS
//   ←  a value the contract carries that no consumer spells         FAILS
//
// The second limb is the one that keeps the contract honest. A vocabulary is a
// contract only while every word in it is used; a word nobody uses is a word
// nobody will notice going wrong. It is also what stops this file growing into
// a wish-list of stores the factory does not have.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
// 🔴 IT DOES NOT COPY tooling/channel-register.json's ROWS, and it must never be
// changed to. That register carries one row per channel with its evidence, its
// account status, its lane and its deferral. The contract carries the WORDS the
// rows spell out of. Two registers of rows would be a second register and the
// first to drift — the exact failure contracts/ exists to prevent.
//
// 🔴 IT DOES NOT CHECK A CATEGORY AGAINST A STORE'S OWN CATEGORY LIST. No
// store's list has been fetched from a primary source, and an invented one fires
// on CORRECT input — this repository has paid for that twice (a made-up
// 120-character store limit; a guessed snapcraft base). What section 4 does is
// hold eight scattered one-line files to ONE declaration. The day a real list
// arrives with its citation it lands in the contract beside the values it
// grades, and no consumer moves.
//
// Exit codes: 0 green · 1 a finding · 2 COVERAGE LOST (not a pass).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
// 🔴 EVERY DIRECTORY LISTING GOES THROUGH `listDir`, NEVER `readdirSync`. It is
// the one place that knows which entries are not part of the tree under test —
// a nested git worktree, a submodule, a stray clone. This guard walks `apps/`
// and `extensions/` looking for `store/` directories, which is exactly the shape
// that descends into `.worktrees/<lane>/apps/...` and grades another checkout's
// listing trees as this one's. Held by tooling/ci/assert-walks-bounded.mjs,
// which caught this file doing it the wrong way on its first preflight.
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const CONTRACT_JS_REL = 'contracts/store/vocabulary.js';
const CONTRACT_JSON_REL = 'contracts/store/vocabulary.json';
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_DIR = 'apps';
const EXTENSIONS_DIR = 'extensions';

/** The directory holding the extension listing files that are NOT per-store. */
const EXTENSION_SHARED_DIR = '_shared';

/**
 * 🔴 THE ONE EXEMPTION, BY EXACT PATH AND WITH ITS REASON. The template tree is
 * a SCAFFOLD, not a listing: its category.txt files hold the placeholder
 * `⟨STORE CATEGORY⟩`, which is the template working. An exemption by exact path
 * cannot go stale the way a pattern can — if the directory moves, section 4
 * stops finding it and says so rather than silently widening.
 */
const TEMPLATE_TREE = 'extensions/templates/tool';

/**
 * The consumers re-pointed at the contract in the change that created it, and
 * the binding each one used to restate by hand. A consumer listed here must
 * IMPORT the contract; a restated array literal under the same name is the
 * failure this limb exists for.
 */
const REPOINTED_CONSUMERS = [
  {
    file: 'tooling/app-yaml/render.mjs',
    bindings: ['RENDERED_LISTING_FILES'],
    importSpecifier: '../../contracts/store/vocabulary.js',
    // This one is also compared by VALUE in section 5, because it is a pure
    // module that can be imported. The source check is the floor, not the proof.
    importable: true,
  },
  {
    file: 'extensions/scripts/check-store-metadata.mjs',
    bindings: ['REQUIRED_PER_STORE', 'REQUIRED_SHARED'],
    importSpecifier: '../../contracts/store/vocabulary.js',
    // NOT importable: it is a script that parses argv and exits at import time.
    // So this one is held by the source check plus section 4's tree walk, which
    // reads the same trees it grades.
    importable: false,
  },
];

const problems = [];
const notes = [];
const fail = (line, ...rest) => problems.push([line, ...rest].join('\n      '));

/** COVERAGE LOST — printed and exited immediately, never collected. */
function coverageLost(line, ...rest) {
  console.error(`✗ COVERAGE LOST — ${line}`);
  for (const r of rest) console.error(`      ${r}`);
  console.error('      Exit 2 is deliberately not a pass: this guard could not make the assertion it claims.');
  process.exit(2);
}

const readJson = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) coverageLost(`${rel} is not present under ${ROOT}.`);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost(`${rel} did not parse as JSON.`, String(e && e.message));
  }
};

const isDir = (abs) => existsSync(abs) && statSync(abs).isDirectory();
const dirsIn = (abs) => (isDir(abs) ? listDir(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const filesIn = (abs) => (isDir(abs) ? listDir(abs, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name) : []);

const uniq = (xs) => [...new Set(xs)];
const sorted = (xs) => uniq(xs).slice().sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═════════════════════════════════════════════════════════════════════════════
// 0. LOAD, AND THE FLOORS THAT MAKE THE REST MEAN ANYTHING
// ═════════════════════════════════════════════════════════════════════════════
if (!existsSync(join(ROOT, CONTRACT_JS_REL))) coverageLost(`${CONTRACT_JS_REL} is not present under ${ROOT}.`, 'There is no store vocabulary to grade, so every limb below would pass over nothing.');

const contract = await import(pathToFileURL(join(ROOT, CONTRACT_JS_REL)).href).catch((e) => {
  coverageLost(`${CONTRACT_JS_REL} could not be imported.`, String(e && e.message));
});

const { STORE_VOCABULARY, VOCABULARY_AXES } = contract;
if (!STORE_VOCABULARY || !Array.isArray(VOCABULARY_AXES) || VOCABULARY_AXES.length === 0) {
  coverageLost(`${CONTRACT_JS_REL} exported no STORE_VOCABULARY / VOCABULARY_AXES.`);
}

for (const axis of VOCABULARY_AXES) {
  const v = STORE_VOCABULARY[axis];
  const size = v === undefined || v === null ? 0 : Array.isArray(v) ? v.length : Object.keys(v).length;
  if (size === 0) {
    coverageLost(
      `the contract's \`${axis}\` axis is empty.`,
      'Every "is this value declared?" check below would pass vacuously over an empty set,',
      'and an emptied axis is exactly how a contract stops being one while still reading green.',
    );
  }
}

const register = readJson(REGISTER_REL);
const onDiskJson = readJson(CONTRACT_JSON_REL);

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE GENERATED COPY IS DERIVED, NOT HAND-MAINTAINED
// ═════════════════════════════════════════════════════════════════════════════
{
  const expected = { $schema: './vocabulary.schema.json', ...JSON.parse(JSON.stringify(STORE_VOCABULARY)) };
  if (!same(expected, onDiskJson)) {
    fail(
      `${CONTRACT_JSON_REL} is not what ${CONTRACT_JS_REL} would generate.`,
      'The JSON is a DERIVED copy for readers that cannot import JavaScript. Edit the .js and run:',
      '  node contracts/store/generate.mjs',
    );
  } else {
    notes.push(`${CONTRACT_JSON_REL} agrees with its source (${VOCABULARY_AXES.length} axes)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. CONTRACT ↔ tooling/channel-register.json, BOTH DIRECTIONS, AXIS BY AXIS
// ═════════════════════════════════════════════════════════════════════════════
const channels = Array.isArray(register.channels) ? register.channels : [];
if (channels.length === 0) coverageLost(`${REGISTER_REL} declares no channels.`, 'Every set comparison below would be against an empty right-hand side, which is not agreement.');

const registerSurfaces = Object.keys(register.surfaces ?? {}).filter((k) => !k.startsWith('_'));
const surfacePlatforms = registerSurfaces.flatMap((s) => (Array.isArray(register.surfaces[s].platforms) ? register.surfaces[s].platforms : []));

const smc = register.storeMetadataContract;
if (!smc || !Array.isArray(smc.requiredFiles) || smc.requiredFiles.length === 0) {
  coverageLost(`${REGISTER_REL} carries no storeMetadataContract.requiredFiles.`, 'The listing-field limbs would compare the contract against nothing.');
}
const perChannel = Object.entries(smc.perChannel ?? {}).filter(([k]) => !k.startsWith('_'));
const registerAdditional = perChannel.flatMap(([, v]) => (Array.isArray(v.additionalFiles) ? v.additionalFiles : []));

const deviceSets = smc.perChannel?.['android-play']?.graphicAssets?.screenshots?.deviceTypeCoverage?.sets;
if (!deviceSets || Object.keys(deviceSets).length === 0) {
  coverageLost(
    `${REGISTER_REL} carries no android-play deviceTypeCoverage.sets.`,
    'That block is the only declaration of the screenshot device classes and their directories;',
    'without it the deviceClasses axis has no consumer and section 3 cannot place a screenshots dir.',
  );
}

/** Both directions over one axis. Order is ignored; membership is not. */
function axisAgrees(axis, contractValues, registerValues, where) {
  const c = sorted(contractValues);
  const r = sorted(registerValues);
  const missing = r.filter((x) => !c.includes(x));
  const unused = c.filter((x) => !r.includes(x));
  if (missing.length === 0 && unused.length === 0) {
    notes.push(`${axis}: ${c.length} value(s) agree with ${where}`);
    return;
  }
  if (missing.length) {
    fail(
      `${axis}: ${where} spells ${missing.length} value(s) the contract does not carry: ${missing.join(', ')}`,
      `Add them to ${CONTRACT_JS_REL} and re-run \`node contracts/store/generate.mjs\`.`,
      'A value that only one reader knows is the value the next reader gets wrong.',
    );
  }
  if (unused.length) {
    fail(
      `${axis}: the contract carries ${unused.length} value(s) ${where} does not spell: ${unused.join(', ')}`,
      'This is the UNUSED-VALUE limb, and it is not a formality. A vocabulary is a contract only',
      'while every word in it is load-bearing; a word nobody uses is a word nobody will notice',
      'going wrong. Either a consumer stopped using it — find out why — or it should not be here.',
    );
  }
}

axisAgrees('channelIds', STORE_VOCABULARY.channelIds, channels.map((c) => c.id), `${REGISTER_REL} channels[].id`);
axisAgrees('surfaces', STORE_VOCABULARY.surfaces, registerSurfaces, `${REGISTER_REL} surfaces`);
axisAgrees('channelKinds', STORE_VOCABULARY.channelKinds, channels.map((c) => c.kind), `${REGISTER_REL} channels[].kind`);
axisAgrees('platforms', STORE_VOCABULARY.platforms, surfacePlatforms, `${REGISTER_REL} surfaces[].platforms`);
axisAgrees('platforms(rows)', STORE_VOCABULARY.platforms, channels.flatMap((c) => c.platforms ?? []), `${REGISTER_REL} channels[].platforms`);
axisAgrees('storefrontKeys', STORE_VOCABULARY.storefrontKeys, channels.map((c) => c.storefrontKey).filter((x) => typeof x === 'string'), `${REGISTER_REL} channels[].storefrontKey`);
axisAgrees('extensionStoreKeys', STORE_VOCABULARY.extensionStoreKeys, channels.map((c) => c.extensionStoreKey).filter((x) => typeof x === 'string'), `${REGISTER_REL} channels[].extensionStoreKey`);
axisAgrees('artifactFormats', STORE_VOCABULARY.artifactFormats, Object.keys(register.artifactBuild?.formats ?? {}), `${REGISTER_REL} artifactBuild.formats`);
axisAgrees('artifactFormats(rows)', STORE_VOCABULARY.artifactFormats, channels.flatMap((c) => c.artifactFormats ?? []), `${REGISTER_REL} channels[].artifactFormats`);
axisAgrees('deviceClasses', STORE_VOCABULARY.deviceClasses, Object.keys(deviceSets), `${REGISTER_REL} deviceTypeCoverage.sets`);
axisAgrees('listingFields(additional)', contract.appAdditionalListingFiles(), registerAdditional, `${REGISTER_REL} perChannel[].additionalFiles`);
// A store form's answers file is required through STORE_FORM_RULES, never
// through `additionalFiles` (a .json there is a sworn declaration), so its
// consumer is the rules row that names it.
axisAgrees(
  'listingFields(form-rule)',
  contract.appFormRuleListingFiles(),
  Object.values(contract.STORE_FORM_RULES ?? {}).map((r) => r.answersFile).filter((x) => typeof x === 'string'),
  `${CONTRACT_JS_REL} STORE_FORM_RULES[].answersFile`,
);

// The two ORDERED comparisons. These are arrays a consumer uses verbatim, so
// membership is not enough — a reordering changes what every reader renders.
{
  const derived = contract.appRequiredListingFiles();
  if (!same(derived, smc.requiredFiles)) {
    fail(
      `listingFields(required): the contract's app-required files are not ${REGISTER_REL}'s requiredFiles, in order.`,
      `  contract: ${JSON.stringify(derived)}`,
      `  register: ${JSON.stringify(smc.requiredFiles)}`,
      'ORDER IS LOAD-BEARING here: consumers use these arrays verbatim, so a reordering is a change.',
    );
  } else {
    notes.push(`listingFields(required): ${derived.length} file(s) agree with ${REGISTER_REL}, in order`);
  }
}
{
  const derived = contract.urlListingFiles();
  const registerUrls = Array.isArray(smc.urlFiles) ? smc.urlFiles : [];
  if (registerUrls.length === 0) coverageLost(`${REGISTER_REL} carries no storeMetadataContract.urlFiles.`, 'The url-kind limb would compare against nothing.');
  if (!same(derived, registerUrls)) {
    fail(
      `listingFields(url): the contract's \`kind: url\` fields are not ${REGISTER_REL}'s urlFiles, in order.`,
      `  contract: ${JSON.stringify(derived)}`,
      `  register: ${JSON.stringify(registerUrls)}`,
    );
  } else {
    notes.push(`listingFields(url): ${derived.length} file(s) agree with ${REGISTER_REL}, in order`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE IDS THAT ARE DELIBERATELY *NOT* VOCABULARY
// ═════════════════════════════════════════════════════════════════════════════
// 🔴 The register holds two other id lists that read exactly like channel ids
// and are not: `purchaseRails.awaitingChannelRow` (researched, no row yet —
// android-sideload, macos-direct) and `disqualified` (flathub, refused on a
// policy ground). Folding either into the vocabulary would arm a channel by
// typo. This limb refuses the merge rather than trusting nobody will make it.
{
  const prospective = (register.purchaseRails?.awaitingChannelRow ?? []).map((r) => r.id).filter(Boolean);
  const disqualified = (register.disqualified ?? []).map((r) => r.id).filter(Boolean);
  if (prospective.length === 0 && disqualified.length === 0) {
    coverageLost(
      `${REGISTER_REL} lists neither an awaitingChannelRow nor a disqualified id.`,
      'This limb would then assert nothing while still printing a pass — which is how a guard',
      'keeps reporting healthy about a block that was removed.',
    );
  }
  const leaked = [...prospective, ...disqualified].filter((id) => STORE_VOCABULARY.channelIds.includes(id));
  if (leaked.length) {
    fail(
      `channelIds: ${leaked.length} id(s) that are NOT channel rows are in the vocabulary: ${leaked.join(', ')}`,
      'awaitingChannelRow ids are researched and unbuilt; disqualified ids were refused on a policy',
      'ground. A vocabulary that carries them arms a channel by typo, which is the one failure in',
      'this area that ships rather than failing the build.',
    );
  } else {
    notes.push(`channelIds: ${prospective.length} prospective and ${disqualified.length} disqualified id(s) stay outside the vocabulary`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. CONTRACT ↔ THE LISTING TREES ON DISK, BOTH DIRECTIONS
// ═════════════════════════════════════════════════════════════════════════════
const listingFieldNames = new Set(contract.allListingFiles());
// The directories a listing tree may hold are PER CHANNEL: every `dir` that
// channel's own register entry declares under `graphicAssets` (each screenshot
// set in its deviceTypeCoverage, and any asset block that names a directory of
// its own, which is how the App Store's IAP review set is declared), plus the
// screenshot directory its STORE_FORM_RULES row names. ⏱ 2026-09-23: this was
// android-play's two sets applied to EVERY channel, so the App Store tree's own
// declared `screenshots-ipad/` and `iap-review/` read as tree dirt the day they
// landed, and a Play tree could have held an iPad set with nothing said.
function declaredDirsOf(channelId) {
  const dirs = new Set();
  for (const block of Object.values(smc.perChannel?.[channelId]?.graphicAssets ?? {})) {
    if (!block || typeof block !== 'object') continue;
    if (typeof block.dir === 'string') dirs.add(block.dir);
    for (const s of Object.values(block.deviceTypeCoverage?.sets ?? {})) if (typeof s?.dir === 'string') dirs.add(s.dir);
  }
  const formDir = contract.STORE_FORM_RULES?.[channelId]?.screenshots?.dir;
  if (typeof formDir === 'string') dirs.add(formDir);
  return dirs;
}
const categoriesSpelled = new Map(); // channelId -> Set(values)

let appTreesSeen = 0;
let extensionTreesSeen = 0;

const noteCategory = (channelId, abs) => {
  const raw = readFileSync(abs, 'utf8');
  const values = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (!categoriesSpelled.has(channelId)) categoriesSpelled.set(channelId, new Set());
  for (const v of values) categoriesSpelled.get(channelId).add(v);
};

// ── 4a. THE APPLICATION TREES ────────────────────────────────────────────────
for (const app of dirsIn(join(ROOT, APPS_DIR))) {
  const storeAbs = join(ROOT, APPS_DIR, app, 'store');
  if (!isDir(storeAbs)) continue;
  for (const channelDir of dirsIn(storeAbs)) {
    appTreesSeen += 1;
    const rel = `${APPS_DIR}/${app}/store/${channelDir}`;
    if (!STORE_VOCABULARY.channelIds.includes(channelDir)) {
      fail(
        `${rel} is a listing tree for "${channelDir}", which the contract does not carry as a channel id.`,
        'A listing tree whose directory names no channel is a listing nothing submits.',
      );
      continue;
    }
    for (const name of filesIn(join(storeAbs, channelDir))) {
      if (!listingFieldNames.has(name)) {
        fail(`${rel}/${name} is not a listing field the contract carries.`, `Declare it in ${CONTRACT_JS_REL} LISTING_FIELDS, or remove the file.`);
      }
      if (name === 'category.txt') noteCategory(channelDir, join(storeAbs, channelDir, name));
    }
    const declared = declaredDirsOf(channelDir);
    for (const sub of dirsIn(join(storeAbs, channelDir))) {
      if (declared.has(sub)) continue;
      fail(
        `${rel}/${sub}/ is not a directory ${channelDir}'s register entry declares (a graphicAssets set or block \`dir\`, or its STORE_FORM_RULES screenshots).`,
        `Declared for ${channelDir}: ${[...declared].join(', ') || '(none)'}`,
      );
    }
  }
}

// ── 4b. THE EXTENSION TREES ──────────────────────────────────────────────────
// ⚠️ "MAY THIS FILE BE HERE?" IS NOT "MUST IT BE HERE?", and this limb asks the
// first one. A store directory legitimately holds its REQUIRED fields plus the
// additional ones that store happens to take — Chrome's promotional tile is not
// required of Edge, but it is not tree dirt in Chrome either. So the set this
// limb grades against is the UNION, while check-store-metadata.mjs keeps reading
// the required array alone and keeps demanding every name in it from every
// store. Folding the two together instead made it ask Chrome for Edge's logo and
// Firefox for both: four failures, measured 2026-09-20.
const extPerStore = new Set([
  ...contract.extensionPerStoreListingFiles(),
  ...contract.extensionAdditionalListingFiles(),
]);
const extShared = new Set([
  ...contract.extensionSharedListingFiles(),
  ...contract.extensionSharedAdditionalListingFiles(),
]);

/** Every `<something>/store/` directory under extensions/, found by walking. */
function extensionStoreRoots(absDir, relDir, out = []) {
  for (const name of dirsIn(absDir)) {
    const childRel = relDir ? `${relDir}/${name}` : name;
    if (name === 'store') out.push({ abs: join(absDir, name), rel: `${childRel}` });
    else if (name !== 'node_modules') extensionStoreRoots(join(absDir, name), childRel, out);
  }
  return out;
}

for (const root of extensionStoreRoots(join(ROOT, EXTENSIONS_DIR), EXTENSIONS_DIR)) {
  const isTemplate = root.rel.startsWith(`${TEMPLATE_TREE}/`);
  extensionTreesSeen += 1;
  for (const storeDir of dirsIn(root.abs)) {
    const rel = `${root.rel}/${storeDir}`;
    const shared = storeDir === EXTENSION_SHARED_DIR;
    if (!shared && !STORE_VOCABULARY.extensionStoreKeys.includes(storeDir)) {
      fail(
        `${rel} is an extension listing tree for "${storeDir}", which the contract does not carry as an extension store key.`,
        `Declared keys: ${STORE_VOCABULARY.extensionStoreKeys.join(', ')} (plus the shared directory "${EXTENSION_SHARED_DIR}")`,
      );
      continue;
    }
    const expect = shared ? extShared : extPerStore;
    for (const name of filesIn(join(root.abs, storeDir))) {
      if (name === 'README.md') continue; // every directory in this repo carries its own card
      if (!expect.has(name)) {
        fail(
          `${rel}/${name} is not an extension listing field the contract places ${shared ? 'in the shared directory' : 'per store'}.`,
          `Expected ${shared ? 'shared' : 'per-store'} fields: ${[...expect].join(', ')}`,
        );
      }
      if (name === 'category.txt' && !isTemplate) {
        // The extension tree is keyed by store key; the categories are declared
        // per CHANNEL id, so the key is translated through the register rather
        // than through a second map typed here.
        const row = channels.find((c) => c.extensionStoreKey === storeDir);
        if (!row) {
          coverageLost(
            `no channel row in ${REGISTER_REL} declares extensionStoreKey "${storeDir}".`,
            `${rel}/category.txt cannot be placed against a channel, so its value would go ungraded.`,
          );
        }
        noteCategory(row.id, join(root.abs, storeDir, name));
      }
    }
    // The shared tree's screenshots/ directory is a listing field with a slash
    // in its name; it is graded by the field list above, not as a device set.
  }
}

if (appTreesSeen === 0) coverageLost(`no ${APPS_DIR}/*/store/<channel>/ tree exists under ${ROOT}.`, 'Section 4a asserted nothing about the application surface while still reading green.');
if (extensionTreesSeen === 0) coverageLost(`no ${EXTENSIONS_DIR}/**/store/ tree exists under ${ROOT}.`, 'Section 4b asserted nothing about the extension surface while still reading green.');

// ── 4c. CATEGORIES, BOTH DIRECTIONS ──────────────────────────────────────────
{
  const declared = STORE_VOCABULARY.listingCategories;
  const declaredChannels = Object.keys(declared);
  if (categoriesSpelled.size === 0) {
    coverageLost('no category.txt was read in any listing tree.', 'The category limbs would compare the contract against nothing.');
  }
  for (const [channelId, values] of categoriesSpelled) {
    const allowed = declared[channelId];
    if (!allowed) {
      fail(
        `listingCategories: a tree spells categories for channel "${channelId}" and the contract declares none.`,
        `Spelled: ${[...values].join(' | ')}`,
      );
      continue;
    }
    for (const v of values) {
      if (!allowed.includes(v)) {
        fail(
          `listingCategories: "${v}" is spelled for ${channelId} and the contract does not carry it.`,
          `Declared for ${channelId}: ${allowed.join(' | ')}`,
          'Either the listing changed category — declare it — or a category.txt was edited in a console',
          'and pasted back, which is exactly the fork this contract exists to catch.',
        );
      }
    }
  }
  for (const channelId of declaredChannels) {
    const spelled = categoriesSpelled.get(channelId);
    if (!spelled) {
      fail(
        `listingCategories: the contract declares categories for "${channelId}" and no listing tree spells any.`,
        'This is the UNUSED-VALUE limb again: a category for a channel with no tree is a value nobody grades.',
      );
      continue;
    }
    const unused = declared[channelId].filter((v) => !spelled.has(v));
    if (unused.length) {
      fail(
        `listingCategories: ${channelId} declares ${unused.length} category value(s) no tree spells: ${unused.join(' | ')}`,
        'A declared category no listing uses is a claim about a store nobody is making.',
      );
    }
  }
  notes.push(`listingCategories: ${declaredChannels.length} channel(s) declared, ${categoriesSpelled.size} spelled on disk`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. THE RE-POINTED CONSUMERS READ THE CONTRACT — AND DO NOT RESTATE IT
// ═════════════════════════════════════════════════════════════════════════════
// The shape assert-entitlement-contract.mjs already uses on contract.ts: the
// IMPORT must be present AND a restated array literal is a failure. An import
// alone proves nothing — a file can import a contract and go on using its own
// copy, which is precisely how the revocation-reason set drifted.
for (const consumer of REPOINTED_CONSUMERS) {
  const abs = join(ROOT, consumer.file);
  if (!existsSync(abs)) {
    coverageLost(
      `${consumer.file} is not present under ${ROOT}.`,
      'It is one of the consumers this guard claims to hold to the contract. A missing consumer',
      'silently reduces what this section covers, and the reduced section still prints a pass.',
    );
  }
  const code = stripSourceComments(readFileSync(abs, 'utf8'), '.mjs');
  if (!code.includes(consumer.importSpecifier)) {
    fail(
      `${consumer.file} does not import ${consumer.importSpecifier}.`,
      'It is listed here as a consumer of the store vocabulary; if it no longer is, remove it from',
      "this guard's REPOINTED_CONSUMERS in the same change, so the coverage this guard claims stays true.",
    );
  }
  for (const binding of consumer.bindings) {
    const restated = new RegExp(`${binding}\\s*=\\s*\\[`).test(code);
    if (restated) {
      fail(
        `${consumer.file} restates ${binding} as an array literal.`,
        'A restated array is a SECOND declaration of the vocabulary, and the second declaration is',
        'the one that drifts. Derive it from contracts/store/vocabulary.js instead.',
      );
    }
  }
  if (consumer.importable) {
    const mod = await import(pathToFileURL(abs).href).catch((e) => {
      coverageLost(`${consumer.file} could not be imported for the value comparison.`, String(e && e.message));
    });
    for (const binding of consumer.bindings) {
      const actual = mod[binding];
      if (!Array.isArray(actual)) {
        fail(`${consumer.file} exports no array named ${binding}; the value comparison could not be made.`);
        continue;
      }
      const expected = contract.renderedListingFiles();
      if (!same(actual, expected)) {
        fail(
          `${consumer.file} ${binding} does not equal the contract's renderedListingFiles().`,
          `  consumer: ${JSON.stringify(actual)}`,
          `  contract: ${JSON.stringify(expected)}`,
        );
      } else {
        notes.push(`${consumer.file} ${binding} equals the contract, by value (${actual.length} file(s))`);
      }
    }
  } else {
    notes.push(`${consumer.file} imports the contract and restates none of ${consumer.bindings.join(', ')}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// VERDICT
// ═════════════════════════════════════════════════════════════════════════════
const where = relative(process.cwd(), ROOT) || '.';
if (problems.length) {
  console.error(`✗ assert-store-vocabulary — ${problems.length} finding(s) in ${where}\n`);
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(`  Subject: ${CONTRACT_JS_REL}. Both directions are checked: a value a consumer spells that`);
  console.error('  the contract lacks, AND a value the contract carries that no consumer spells.');
  process.exit(1);
}

console.log(`✓ assert-store-vocabulary — ${CONTRACT_JS_REL} is the one home for the store vocabulary`);
for (const n of notes) console.log(`    · ${n}`);
console.log(
  `    scanned ${appTreesSeen} application listing tree(s), ${extensionTreesSeen} extension store root(s), ` +
    `${REPOINTED_CONSUMERS.length} re-pointed consumer(s)`,
);
process.exit(0);
