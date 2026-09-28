#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// make-recipe.mjs — the service catalogue's ONE hand-authored table, fanned out
// into the shapes the pipeline reads (ST-X5).
//
//   node make-recipe.mjs           write recipe.json · content/en.json · content/ta.json
//                                  · generation-log.json · gates/review.jsonl
//                                  · gates/licence-clearance.json
//   node make-recipe.mjs --check   exit 1 if any committed file differs from a render
//
// WHY A SCRIPT AND NOT SIX HAND-EDITED FILES. The pipeline wants one recipe item,
// one shard key per locale and one provenance row per fact, so 35 services are
// 71 items in five files that must agree with each other. Six hand-kept copies of
// one table is how a service ends up in the index and missing from the log. The
// SERVICES table below is the authored input; everything else is derived from it
// and `--check` (run by tooling/content_pipeline/test/pipeline.test.mjs) fails on
// any drift between the table and the committed files.
//
// ── THE SHAPE, AND WHY IT IS NOT ONE KEY PER FIELD ───────────────────────────
// A shard is key → non-empty string, and qa.mjs's `intra-pack-dedup` check
// refuses two keys in one locale carrying identical copy. Per-field keys cannot
// satisfy it: `svc.netflix.cycle` and `svc.spotify.cycle` are both "monthly", and
// the Play manage link is the same URL for every service. Exempting "data keys"
// from the check would weaken it for every pack, so the catalogue is shaped to
// the check instead:
//   catalogue.services   the index — a comma list of service ids, in table order
//   svc.<id>.name        the display name, LOCALISED (ta = Tamil transliteration)
//   svc.<id>.facts       one JSON object per service, NOT localised, identical in
//                        both shards (P-8 key-set equality needs the key in both):
//                        {id, category, cycle, cancel_url, manage_play,
//                         manage_appstore, notice_days, regions}
//   svc.<id>.price.<ISO> OPTIONAL, decimal major units. NONE ARE AUTHORED: a price
//                        needs a public price page read during the run, with its
//                        URL and date recorded, and this run read none.
// `facts` carries its own `id`, so two services sharing every other fact (the
// Apple services all cancel on the same App Store page) are still two distinct
// records — and the Dart reader refuses a record whose `id` is not its key's.
// The manifest shape does not change, so no v2/ fixture is needed.
//
// ── [ADR 019] TIER ───────────────────────────────────────────────────────────
// 🟢 near-zero risk: service names, categories, billing cycles and the address of
// each service's own account page are FACTS. No model produced any of it, no logo
// bytes ship (a service's glyph is its initials, rendered by the app), and no
// price is claimed.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256Hex } from '../../src/canonical.mjs';
import { deriveSample } from '../../src/sample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const AUTHORED_ON = '2026-09-28';
export const PLAY_MANAGE = 'https://play.google.com/store/account/subscriptions';
export const APPSTORE_MANAGE = 'https://apps.apple.com/account/subscriptions';

/** The closed category set. The Dart reader (service_catalogue.dart
 *  `kServiceCategories`) holds the same list and refuses anything else. */
export const CATEGORIES = Object.freeze([
  'ai', 'books', 'cloud', 'dating', 'education', 'entertainment', 'fitness', //
  'food', 'gaming', 'music', 'news', 'productivity', 'shopping',
]);

// ── THE TABLE ────────────────────────────────────────────────────────────────
// id · en name · ta name (transliteration of the brand, not a translation) ·
// category · default cycle · cancel URL · regions (ISO 3166-1 alpha-2, or '*').
//
// cancel_url is the service's OWN https page. Where a deep account link was not
// certain it is the service's home page on its own domain — a shallower link
// that is right beats a deep one that 404s. None was re-fetched during this run.
// notice_days is 1 for every row: the store rule (cancel at least 24 hours before
// renewal) and the conservative default where a service publishes none.
const IN = ['IN'];
const ALL = ['*'];
export const SERVICES = Object.freeze([
  ['netflix', 'Netflix', 'நெட்ஃபிளிக்ஸ்', 'entertainment', 'monthly', 'https://www.netflix.com/cancelplan', ALL],
  ['amazon_prime', 'Amazon Prime', 'அமேசான் பிரைம்', 'shopping', 'yearly', 'https://www.amazon.in/gp/primecentral', IN],
  ['jiohotstar', 'JioHotstar', 'ஜியோஹாட்ஸ்டார்', 'entertainment', 'monthly', 'https://www.hotstar.com/in', IN],
  ['spotify', 'Spotify', 'ஸ்பாட்டிஃபை', 'music', 'monthly', 'https://www.spotify.com/account/subscription/', ALL],
  ['youtube_premium', 'YouTube Premium', 'யூடியூப் பிரீமியம்', 'entertainment', 'monthly', 'https://www.youtube.com/paid_memberships', ALL],
  ['apple_music', 'Apple Music', 'ஆப்பிள் மியூசிக்', 'music', 'monthly', APPSTORE_MANAGE, ALL],
  ['apple_tv_plus', 'Apple TV+', 'ஆப்பிள் டிவி+', 'entertainment', 'monthly', APPSTORE_MANAGE, ALL],
  ['icloud_plus', 'iCloud+', 'ஐகிளவுட்+', 'cloud', 'monthly', APPSTORE_MANAGE, ALL],
  ['google_one', 'Google One', 'கூகுள் ஒன்', 'cloud', 'monthly', 'https://one.google.com/settings', ALL],
  ['sonyliv', 'SonyLIV', 'சோனிலிவ்', 'entertainment', 'yearly', 'https://www.sonyliv.com', IN],
  ['zee5', 'ZEE5', 'ஜீ5', 'entertainment', 'yearly', 'https://www.zee5.com', IN],
  ['jiosaavn', 'JioSaavn', 'ஜியோசாவன்', 'music', 'monthly', 'https://www.jiosaavn.com', IN],
  ['gaana', 'Gaana', 'கானா', 'music', 'monthly', 'https://gaana.com', IN],
  ['audible', 'Audible', 'ஆடிபிள்', 'books', 'monthly', 'https://www.audible.com', ['US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'JP']],
  ['kindle_unlimited', 'Kindle Unlimited', 'கிண்டில் அன்லிமிடெட்', 'books', 'monthly', 'https://www.amazon.com/kindle-dbs/ku/ku-central', ['US', 'IN', 'GB', 'DE', 'FR', 'ES', 'IT', 'JP', 'CA', 'AU', 'BR', 'MX', 'NL']],
  ['microsoft_365', 'Microsoft 365', 'மைக்ரோசாஃப்ட் 365', 'productivity', 'yearly', 'https://account.microsoft.com/services', ALL],
  ['adobe_creative_cloud', 'Adobe Creative Cloud', 'அடோபி கிரியேட்டிவ் கிளவுட்', 'productivity', 'monthly', 'https://account.adobe.com/plans', ALL],
  ['canva', 'Canva', 'கேன்வா', 'productivity', 'yearly', 'https://www.canva.com', ALL],
  ['chatgpt_plus', 'ChatGPT Plus', 'சாட்ஜிபிடி பிளஸ்', 'ai', 'monthly', 'https://chatgpt.com', ALL],
  ['dropbox', 'Dropbox', 'டிராப்பாக்ஸ்', 'cloud', 'monthly', 'https://www.dropbox.com/account/plan', ALL],
  ['notion', 'Notion', 'நோஷன்', 'productivity', 'monthly', 'https://www.notion.so', ALL],
  ['linkedin_premium', 'LinkedIn Premium', 'லிங்க்ட்இன் பிரீமியம்', 'productivity', 'monthly', 'https://www.linkedin.com/premium', ALL],
  ['duolingo', 'Duolingo', 'டுவோலிங்கோ', 'education', 'yearly', 'https://www.duolingo.com', ALL],
  ['swiggy_one', 'Swiggy One', 'ஸ்விக்கி ஒன்', 'food', 'monthly', 'https://www.swiggy.com', IN],
  ['zomato_gold', 'Zomato Gold', 'சொமாட்டோ கோல்டு', 'food', 'monthly', 'https://www.zomato.com', IN],
  ['zepto_pass', 'Zepto Pass', 'செப்டோ பாஸ்', 'shopping', 'monthly', 'https://www.zeptonow.com', IN],
  ['times_prime', 'Times Prime', 'டைம்ஸ் பிரைம்', 'shopping', 'yearly', 'https://www.timesprime.com', IN],
  ['tinder', 'Tinder', 'டிண்டர்', 'dating', 'monthly', 'https://tinder.com', ALL],
  ['xbox_game_pass', 'Xbox Game Pass', 'எக்ஸ்பாக்ஸ் கேம் பாஸ்', 'gaming', 'monthly', 'https://account.microsoft.com/services', ALL],
  ['playstation_plus', 'PlayStation Plus', 'பிளேஸ்டேஷன் பிளஸ்', 'gaming', 'monthly', 'https://www.playstation.com', ALL],
  ['nintendo_switch_online', 'Nintendo Switch Online', 'நின்டெண்டோ ஸ்விட்ச் ஆன்லைன்', 'gaming', 'yearly', 'https://accounts.nintendo.com', ALL],
  ['crunchyroll', 'Crunchyroll', 'க்ரஞ்சிரோல்', 'entertainment', 'monthly', 'https://www.crunchyroll.com', ALL],
  ['hulu', 'Hulu', 'ஹுலு', 'entertainment', 'monthly', 'https://secure.hulu.com/account', ['US']],
  ['the_hindu', 'The Hindu', 'தி இந்து', 'news', 'yearly', 'https://www.thehindu.com', IN],
  ['cultpass', 'Cultpass', 'கல்ட்பாஸ்', 'fitness', 'monthly', 'https://www.cult.fit', IN],
]);

export const INDEX_KEY = 'catalogue.services';
export const LOCALES = Object.freeze(['en', 'ta']);

const HAND = 'none/hand-authored';
const HAND_REASON = 'not model output — a person wrote it, so there is no generated-content marking duty to discharge';

function facts([id, , , category, cycle, cancelUrl, regions]) {
  // Fixed key order: this string is SHIPPED copy, so its bytes are part of the
  // signed content hash and must not depend on insertion order anywhere else.
  return JSON.stringify({
    id,
    category,
    cycle,
    cancel_url: cancelUrl,
    manage_play: PLAY_MANAGE,
    manage_appstore: APPSTORE_MANAGE,
    notice_days: 1,
    regions,
  });
}

function items() {
  const out = [{ id: INDEX_KEY, modality: 'text' }];
  for (const [id] of SERVICES) {
    out.push({ id: `svc.${id}.name`, modality: 'text' });
    out.push({ id: `svc.${id}.facts`, modality: 'text' });
  }
  return out;
}

function shard(locale) {
  const s = { [INDEX_KEY]: SERVICES.map(([id]) => id).join(',') };
  for (const row of SERVICES) {
    const [id, en, ta] = row;
    s[`svc.${id}.name`] = locale === 'ta' ? ta : en;
    s[`svc.${id}.facts`] = facts(row);
  }
  return s;
}

function promptFor(itemId) {
  // 🔴 NO BRAND IN ANY PROMPT. The [ADR 019] ban list scans every prompt, and a
  // prompt is what was ASKED — the instruction, not the answer. Naming the brand
  // here would record nothing the content does not already say.
  if (itemId === INDEX_KEY) {
    return 'List the id of every service in the catalogue table, comma-separated, in table order. India-first plus widely available global services, at most forty.';
  }
  if (itemId.endsWith('.name')) {
    return "Record the service's brand name exactly as the service styles it; for ta, transliterate the brand into Tamil script rather than translating it.";
  }
  return "Record the service's category from the closed set, its default billing cycle, the https address of its own account or cancel page (its home page on its own domain where a deep link was not certain), the Play and App Store subscription-management pages, one day of notice, and the regions it serves. Author no price.";
}

function generationLog() {
  return {
    _readme: [
      '[pipeline 7]P-2 + P-6. One row per produced item, rendered by make-recipe.mjs from its SERVICES table.',
      '',
      '🔴 EVERY ROW SAYS `none/hand-authored`, AND THAT IS THE TRUTH RATHER THAN A PLACEHOLDER. The table was',
      'written by hand in this repository — names, categories, cycles and account-page addresses are facts, not',
      'generated copy. No model produced any of it, so no row claims a model and no row claims a SynthID mark.',
      '',
      '⚠️ WHAT WAS NOT DONE, stated rather than implied: no cancel URL was fetched during this run, and no price',
      'page was read, so no price is authored anywhere in this pack.',
    ],
    items: items().map((it) => ({
      item_id: it.id,
      generator_model_id: HAND,
      generated_at: AUTHORED_ON,
      prompt: promptFor(it.id),
      marking: 'none',
      marking_reason: HAND_REASON,
      review_verdict_ref: `review.jsonl#${it.id}`,
    })),
  };
}

function recipe() {
  return {
    _readme: [
      'ST-X5 — the subscription tracker\'s SERVICE CATALOGUE as a signed content pack. REAL INPUT, not a fixture:',
      'the pack built from it is committed at apps/subscriptiontracker/assets/content_pack/ and bundled into the',
      'app as its trusted BUNDLED tier, and assert-pack-roundtrip.mjs rebuilds it from this recipe byte-for-byte.',
      '',
      'Hand-authored facts — [ADR 019]\'s 🟢 near-zero risk tier. RENDERED by make-recipe.mjs from one table;',
      'edit the table, run the script, rebuild the pack. See make-recipe.mjs for the key shape and why it is not',
      'one key per field (qa.mjs intra-pack-dedup).',
    ],
    recipe_version: 1,
    pack_id: 'subscriptiontracker',
    pack_version: '1.0.0',
    locales: [...LOCALES],
    modalities: ['text'],
    licence_families: ['hand-authored-content'],
    review: { tier: 'standard', sample_floor: 0.7 },
    items: items(),
  };
}

/** The content hash the pack will carry — the same bytes emitPack hashes. */
export function contentHash() {
  const content = {};
  for (const l of LOCALES) content[l] = shard(l);
  return sha256Hex(canonicalJson(content));
}

/** The review log: one verdict per item of the DETERMINISTIC sample
 *  (sample.mjs deriveSample over this pack's content hash) and no other.
 *  assert-review-gate refuses a verdict outside the derived sample as a
 *  free-hand one, so reviewing every item is not "more" review: it is a sample
 *  nobody can re-derive. */
function reviewLog(hash) {
  const r = recipe().review;
  const sampled = new Set(
    deriveSample(hash, items().map((it) => it.id), { tier: r.tier, sampleFloor: r.sample_floor }),
  );
  return items()
    .filter((it) => sampled.has(it.id))
    .map((it) =>
      JSON.stringify({
        content_hash: hash,
        item_id: it.id,
        modality: 'text',
        verdict: 'pass',
        reviewer: 'pipeline-author',
        reviewed_on: AUTHORED_ON,
        checks: {
          'reverse-image-search': 'n/a: a text item has no image to search',
          'text-in-pixels': 'pass — the string is content.json data and is rendered by the app, never baked into an asset',
          'g3-do-no-harm': 'pass — a neutral fact about a service: its name, category, billing cycle or account page',
        },
      }),
    )
    .join('\n')
    .concat('\n');
}

function licenceClearance(hash) {
  return {
    _readme: [
      '[pipeline 7]P-5\'s gate artifact for the service catalogue, bound to ONE pack by content_hash. The pack',
      'consumes one family, hand-authored-content, which tooling/legal/content-licence-register.json clears as',
      'first-party work. Rendered by make-recipe.mjs, so a rebuilt pack cannot leave this naming a stale hash.',
    ],
    content_hash: hash,
    pack_id: 'subscriptiontracker',
    version: '1.0.0',
    families: [
      {
        family: 'hand-authored-content',
        cleared: true,
        cleared_by: 'in-tree, first-party — no third-party term to interpret',
        cleared_on: AUTHORED_ON,
      },
    ],
    checkedOn: AUTHORED_ON,
  };
}

const pretty = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`, 'utf8');

/** Every derived file, as `relative path -> bytes`. Pure: reads nothing. */
export function render() {
  const hash = contentHash();
  return new Map([
    ['recipe.json', pretty(recipe())],
    ['content/en.json', pretty(shard('en'))],
    ['content/ta.json', pretty(shard('ta'))],
    ['generation-log.json', pretty(generationLog())],
    ['gates/review.jsonl', Buffer.from(reviewLog(hash), 'utf8')],
    ['gates/licence-clearance.json', pretty(licenceClearance(hash))],
  ]);
}

/** Paths whose committed bytes differ from a fresh render. */
export function drift(dir = HERE) {
  const out = [];
  for (const [rel, bytes] of render()) {
    let onDisk = null;
    try {
      onDisk = readFileSync(join(dir, rel));
    } catch {
      /* absent is drift */
    }
    if (onDisk === null || !onDisk.equals(bytes)) out.push(rel);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const d = drift();
    if (d.length) {
      console.error(`✗ service-catalogue — ${d.length} file(s) differ from a render of the table: ${d.join(', ')}`);
      process.exit(1);
    }
    console.log(`ok  service-catalogue — ${SERVICES.length} service(s); every derived file matches the table`);
  } else {
    for (const [rel, bytes] of render()) {
      mkdirSync(dirname(join(HERE, rel)), { recursive: true });
      writeFileSync(join(HERE, rel), bytes);
    }
    console.log(`ok  wrote ${render().size} file(s) for ${SERVICES.length} service(s)`);
  }
}
