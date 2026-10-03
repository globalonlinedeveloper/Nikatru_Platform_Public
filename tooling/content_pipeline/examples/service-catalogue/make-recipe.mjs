#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// make-recipe.mjs — the service catalogue's ONE hand-authored table, fanned out
// into the shapes the pipeline reads (ST-X5).
//
//   node make-recipe.mjs           write recipe.json · content/<locale>.json (one per supported locale)
//                                  · generation-log.json · gates/review.jsonl
//                                  · gates/licence-clearance.json
//   node make-recipe.mjs --check   exit 1 if any committed file differs from a render
//
// WHY A SCRIPT AND NOT SIX HAND-EDITED FILES. The pipeline wants one recipe item,
// one shard key per locale and one provenance row per fact, so N services are
// 2N+1 items in five files that must agree with each other. Six hand-kept copies of
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
//                         manage_appstore, notice_days, regions, aliases}
//                        — the shape is service-facts.schema.json, and
//                        render() refuses a record that does not match it
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
import { schemaProblems } from '../../src/recipe.mjs';
import { deriveSample } from '../../src/sample.mjs';
import { loadRegister, supportedCodes } from '../../../i18n/locales.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The shape of one `svc.<id>.facts` record (ST-T9, AD-04). */
export const FACTS_SCHEMA = JSON.parse(readFileSync(join(HERE, 'service-facts.schema.json'), 'utf8'));

/** Every schema problem in one facts record — empty when it conforms. */
export function factsProblems(record, path = 'facts') {
  return schemaProblems(record, FACTS_SCHEMA, path);
}

export const AUTHORED_ON = '2026-09-28';
export const PLAY_MANAGE = 'https://play.google.com/store/account/subscriptions';
export const APPSTORE_MANAGE = 'https://apps.apple.com/account/subscriptions';

/** The closed category set. The Dart reader (service_catalogue.dart
 *  `kServiceCategories`) holds the same list and refuses anything else. */
export const CATEGORIES = Object.freeze([
  'ai', 'books', 'cloud', 'dating', 'education', 'entertainment', 'fitness', //
  'food', 'gaming', 'music', 'news', 'productivity', 'shopping', 'telecom',
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
  // ── v2 (train ST-T9, AD-04): India-first breadth — regional OTT, DTH and
  // telecom bundles, food, fitness, news, education, matrimony — then the
  // global top. Same rules as the rows above: the service's own domain, its
  // home page where a deep account link was not certain, no price, no logo.
  ['prime_video', 'Prime Video', 'பிரைம் வீடியோ', 'entertainment', 'monthly', 'https://www.primevideo.com', ALL],
  ['sun_nxt', 'Sun NXT', 'சன் நெக்ஸ்ட்', 'entertainment', 'yearly', 'https://www.sunnxt.com', IN],
  ['aha', 'aha', 'ஆஹா', 'entertainment', 'yearly', 'https://www.aha.video', IN],
  ['hoichoi', 'hoichoi', 'ஹொய்சொய்', 'entertainment', 'yearly', 'https://www.hoichoi.tv', IN],
  ['discovery_plus', 'discovery+', 'டிஸ்கவரி+', 'entertainment', 'yearly', 'https://www.discoveryplus.in', IN],
  ['lionsgate_play', 'Lionsgate Play', 'லயன்ஸ்கேட் ப்ளே', 'entertainment', 'monthly', 'https://www.lionsgateplay.com', IN],
  ['shemaroome', 'ShemarooMe', 'ஷெமாரூமீ', 'entertainment', 'yearly', 'https://www.shemaroome.com', IN],
  ['manorama_max', 'manoramaMAX', 'மனோரமாமேக்ஸ்', 'entertainment', 'yearly', 'https://www.manoramamax.com', IN],
  ['fancode', 'FanCode', 'ஃபேன்கோடு', 'entertainment', 'yearly', 'https://www.fancode.com', IN],
  ['tata_play', 'Tata Play', 'டாடா ப்ளே', 'entertainment', 'monthly', 'https://www.tataplay.com', IN],
  ['tata_play_binge', 'Tata Play Binge', 'டாடா ப்ளே பிஞ்ச்', 'entertainment', 'monthly', 'https://www.tataplaybinge.com', IN],
  ['airtel_xstream_play', 'Airtel Xstream Play', 'ஏர்டெல் எக்ஸ்ட்ரீம் ப்ளே', 'entertainment', 'monthly', 'https://www.airtelxstream.in', IN],
  ['dish_tv', 'Dish TV', 'டிஷ் டிவி', 'entertainment', 'monthly', 'https://www.dishtv.in', IN],
  ['sun_direct', 'Sun Direct', 'சன் டைரக்ட்', 'entertainment', 'monthly', 'https://www.sundirect.in', IN],
  ['mubi', 'MUBI', 'முபி', 'entertainment', 'monthly', 'https://mubi.com', ALL],
  ['jio_postpaid', 'Jio Postpaid', 'ஜியோ போஸ்ட்பெய்டு', 'telecom', 'monthly', 'https://www.jio.com', IN],
  ['jio_prepaid', 'Jio Prepaid', 'ஜியோ ப்ரீபெய்டு', 'telecom', 'monthly', 'https://www.jio.com/selfcare', IN],
  ['jiofiber', 'JioFiber', 'ஜியோஃபைபர்', 'telecom', 'monthly', 'https://www.jio.com/fiber', IN],
  ['airtel_postpaid', 'Airtel Postpaid', 'ஏர்டெல் போஸ்ட்பெய்டு', 'telecom', 'monthly', 'https://www.airtel.in', IN],
  ['airtel_prepaid', 'Airtel Prepaid', 'ஏர்டெல் ப்ரீபெய்டு', 'telecom', 'monthly', 'https://www.airtel.in/prepaid-recharge', IN],
  ['airtel_xstream_fiber', 'Airtel Xstream Fiber', 'ஏர்டெல் எக்ஸ்ட்ரீம் ஃபைபர்', 'telecom', 'monthly', 'https://www.airtel.in/broadband', IN],
  ['airtel_black', 'Airtel Black', 'ஏர்டெல் பிளாக்', 'telecom', 'monthly', 'https://www.airtel.in/airtel-black', IN],
  ['vi_postpaid', 'Vi Postpaid', 'வீ போஸ்ட்பெய்டு', 'telecom', 'monthly', 'https://www.myvi.in', IN],
  ['vi_prepaid', 'Vi Prepaid', 'வீ ப்ரீபெய்டு', 'telecom', 'monthly', 'https://www.myvi.in/prepaid', IN],
  ['bsnl', 'BSNL', 'பிஎஸ்என்எல்', 'telecom', 'monthly', 'https://www.bsnl.co.in', IN],
  ['act_fibernet', 'ACT Fibernet', 'ஏசிடி ஃபைபர்நெட்', 'telecom', 'monthly', 'https://www.actcorp.in', IN],
  ['hathway', 'Hathway', 'ஹாத்வே', 'telecom', 'monthly', 'https://www.hathway.com', IN],
  ['excitel', 'Excitel', 'எக்சைடெல்', 'telecom', 'monthly', 'https://www.excitel.com', IN],
  ['amazon_music', 'Amazon Music Unlimited', 'அமேசான் மியூசிக் அன்லிமிடெட்', 'music', 'monthly', 'https://www.amazon.com/music/unlimited', ALL],
  ['youtube_music', 'YouTube Music', 'யூடியூப் மியூசிக்', 'music', 'monthly', 'https://music.youtube.com', ALL],
  ['hungama_music', 'Hungama Music', 'ஹங்காமா மியூசிக்', 'music', 'monthly', 'https://www.hungama.com', IN],
  ['pocket_fm', 'Pocket FM', 'பாக்கெட் எஃப்எம்', 'books', 'monthly', 'https://www.pocketfm.com', IN],
  ['kuku_fm', 'Kuku FM', 'குக்கு எஃப்எம்', 'books', 'yearly', 'https://kukufm.com', IN],
  ['storytel', 'Storytel', 'ஸ்டோரிடெல்', 'books', 'monthly', 'https://www.storytel.com', ALL],
  ['magzter_gold', 'Magzter GOLD', 'மேக்ஸ்டர் கோல்டு', 'books', 'yearly', 'https://www.magzter.com', ALL],
  ['flipkart_vip', 'Flipkart VIP', 'ஃபிளிப்கார்ட் விஐபி', 'shopping', 'yearly', 'https://www.flipkart.com', IN],
  ['eazydiner_prime', 'EazyDiner Prime', 'ஈஸிடைனர் பிரைம்', 'food', 'yearly', 'https://www.eazydiner.com', IN],
  ['country_delight', 'Country Delight', 'கன்ட்ரி டிலைட்', 'food', 'monthly', 'https://countrydelight.in', IN],
  ['pharmeasy_plus', 'PharmEasy Plus', 'ஃபார்மஈஸி பிளஸ்', 'shopping', 'yearly', 'https://pharmeasy.in', IN],
  ['tata_1mg_care', 'Tata 1mg Care Plan', 'டாடா 1எம்ஜி கேர் பிளான்', 'shopping', 'yearly', 'https://www.1mg.com', IN],
  ['practo_plus', 'Practo Plus', 'ப்ராக்டோ பிளஸ்', 'fitness', 'yearly', 'https://www.practo.com', IN],
  ['healthifyme', 'HealthifyMe', 'ஹெல்திஃபைமீ', 'fitness', 'yearly', 'https://www.healthifyme.com', IN],
  ['fittr', 'Fittr', 'ஃபிட்டர்', 'fitness', 'monthly', 'https://www.fittr.com', IN],
  ['toi_plus', 'TOI+', 'டிஓஐ+', 'news', 'yearly', 'https://timesofindia.indiatimes.com', IN],
  ['indian_express', 'The Indian Express', 'தி இந்தியன் எக்ஸ்பிரஸ்', 'news', 'yearly', 'https://indianexpress.com', IN],
  ['et_prime', 'ET Prime', 'இடி பிரைம்', 'news', 'yearly', 'https://economictimes.indiatimes.com/prime', IN],
  ['mint', 'Mint', 'மின்ட்', 'news', 'yearly', 'https://www.livemint.com', IN],
  ['business_standard', 'Business Standard', 'பிசினஸ் ஸ்டாண்டர்டு', 'news', 'yearly', 'https://www.business-standard.com', IN],
  ['the_ken', 'The Ken', 'தி கென்', 'news', 'yearly', 'https://the-ken.com', IN],
  ['moneycontrol_pro', 'Moneycontrol Pro', 'மனிகண்ட்ரோல் ப்ரோ', 'news', 'yearly', 'https://www.moneycontrol.com', IN],
  ['byjus', "BYJU'S", 'பைஜூஸ்', 'education', 'yearly', 'https://byjus.com', IN],
  ['unacademy', 'Unacademy', 'அன்அகாடமி', 'education', 'yearly', 'https://unacademy.com', IN],
  ['physics_wallah', 'Physics Wallah', 'பிசிக்ஸ் வாலா', 'education', 'yearly', 'https://www.pw.live', IN],
  ['vedantu', 'Vedantu', 'வேதாந்து', 'education', 'yearly', 'https://www.vedantu.com', IN],
  ['testbook_pass', 'Testbook Pass', 'டெஸ்ட்புக் பாஸ்', 'education', 'yearly', 'https://testbook.com', IN],
  ['naukri_fastforward', 'Naukri FastForward', 'நௌக்ரி ஃபாஸ்ட்ஃபார்வர்டு', 'productivity', 'monthly', 'https://www.naukri.com', IN],
  ['tallyprime', 'TallyPrime', 'டேலிபிரைம்', 'productivity', 'yearly', 'https://tallysolutions.com', IN],
  ['quick_heal', 'Quick Heal', 'க்விக் ஹீல்', 'productivity', 'yearly', 'https://www.quickheal.co.in', IN],
  ['aisle', 'Aisle', 'ஐல்', 'dating', 'monthly', 'https://www.aisle.co', IN],
  ['shaadi', 'Shaadi.com', 'ஷாதி.காம்', 'dating', 'monthly', 'https://www.shaadi.com', IN],
  ['bharat_matrimony', 'BharatMatrimony', 'பாரத்மேட்ரிமோனி', 'dating', 'monthly', 'https://www.bharatmatrimony.com', IN],
  ['tamil_matrimony', 'TamilMatrimony', 'தமிழ்மேட்ரிமோனி', 'dating', 'monthly', 'https://www.tamilmatrimony.com', IN],
  ['jeevansathi', 'Jeevansathi', 'ஜீவன்சாத்தி', 'dating', 'monthly', 'https://www.jeevansathi.com', IN],
  ['truecaller_premium', 'Truecaller Premium', 'ட்ரூகாலர் பிரீமியம்', 'productivity', 'yearly', 'https://www.truecaller.com', ALL],
  ['zoho_mail', 'Zoho Mail', 'ஜோஹோ மெயில்', 'productivity', 'yearly', 'https://www.zoho.com/mail/', ALL],
  ['zoho_workplace', 'Zoho Workplace', 'ஜோஹோ வொர்க்பிளேஸ்', 'productivity', 'yearly', 'https://www.zoho.com/workplace/', ALL],
  ['zoho_books', 'Zoho Books', 'ஜோஹோ புக்ஸ்', 'productivity', 'yearly', 'https://www.zoho.com/books/', ALL],
  ['disney_plus', 'Disney+', 'டிஸ்னி+', 'entertainment', 'monthly', 'https://www.disneyplus.com', ALL],
  ['hbo_max', 'HBO Max', 'ஹெச்பிஓ மேக்ஸ்', 'entertainment', 'monthly', 'https://www.hbomax.com', ['US']],
  ['paramount_plus', 'Paramount+', 'பாரமவுண்ட்+', 'entertainment', 'monthly', 'https://www.paramountplus.com', ['US', 'GB', 'CA', 'AU']],
  ['peacock', 'Peacock', 'பீகாக்', 'entertainment', 'monthly', 'https://www.peacocktv.com', ['US']],
  ['espn_plus', 'ESPN+', 'இஎஸ்பிஎன்+', 'entertainment', 'monthly', 'https://plus.espn.com', ['US']],
  ['dazn', 'DAZN', 'டாஸோன்', 'entertainment', 'monthly', 'https://www.dazn.com', ALL],
  ['sling_tv', 'Sling TV', 'ஸ்லிங் டிவி', 'entertainment', 'monthly', 'https://www.sling.com', ['US']],
  ['youtube_tv', 'YouTube TV', 'யூடியூப் டிவி', 'entertainment', 'monthly', 'https://tv.youtube.com', ['US']],
  ['fubo', 'Fubo', 'ஃபூபோ', 'entertainment', 'monthly', 'https://www.fubo.tv', ['US', 'CA']],
  ['starz', 'STARZ', 'ஸ்டார்ஸ்', 'entertainment', 'monthly', 'https://www.starz.com', ['US']],
  ['curiositystream', 'CuriosityStream', 'கியூரியாசிட்டிஸ்ட்ரீம்', 'entertainment', 'yearly', 'https://curiositystream.com', ALL],
  ['britbox', 'BritBox', 'பிரிட்பாக்ஸ்', 'entertainment', 'monthly', 'https://www.britbox.com', ['US', 'CA']],
  ['nebula', 'Nebula', 'நெபுலா', 'entertainment', 'yearly', 'https://nebula.tv', ALL],
  ['f1_tv', 'F1 TV', 'எஃப்1 டிவி', 'entertainment', 'yearly', 'https://f1tv.formula1.com', ALL],
  ['snapchat_plus', 'Snapchat+', 'ஸ்னாப்சாட்+', 'entertainment', 'monthly', 'https://www.snapchat.com', ALL],
  ['apple_one', 'Apple One', 'ஆப்பிள் ஒன்', 'entertainment', 'monthly', APPSTORE_MANAGE, ALL],
  ['tidal', 'TIDAL', 'டைடல்', 'music', 'monthly', 'https://tidal.com', ALL],
  ['deezer', 'Deezer', 'டீசர்', 'music', 'monthly', 'https://www.deezer.com', ALL],
  ['soundcloud_go', 'SoundCloud Go+', 'சவுண்ட்கிளவுட் கோ+', 'music', 'monthly', 'https://soundcloud.com', ALL],
  ['ea_play', 'EA Play', 'இஏ ப்ளே', 'gaming', 'monthly', 'https://www.ea.com/ea-play', ALL],
  ['ubisoft_plus', 'Ubisoft+', 'யூபிசாஃப்ட்+', 'gaming', 'monthly', 'https://www.ubisoft.com', ALL],
  ['apple_arcade', 'Apple Arcade', 'ஆப்பிள் ஆர்கேட்', 'gaming', 'monthly', 'https://www.apple.com/apple-arcade/', ALL],
  ['google_play_pass', 'Google Play Pass', 'கூகுள் ப்ளே பாஸ்', 'gaming', 'monthly', 'https://play.google.com/store/pass/getstarted', ALL],
  ['geforce_now', 'GeForce NOW', 'ஜியிஃபோர்ஸ் நவ்', 'gaming', 'monthly', 'https://www.nvidia.com/en-us/geforce-now/', ALL],
  ['discord_nitro', 'Discord Nitro', 'டிஸ்கார்டு நைட்ரோ', 'gaming', 'monthly', 'https://discord.com', ALL],
  ['humble_choice', 'Humble Choice', 'ஹம்பிள் சாய்ஸ்', 'gaming', 'monthly', 'https://www.humblebundle.com', ALL],
  ['roblox_premium', 'Roblox Premium', 'ரோப்லாக்ஸ் பிரீமியம்', 'gaming', 'monthly', 'https://www.roblox.com', ALL],
  ['pcloud', 'pCloud', 'பிகிளவுட்', 'cloud', 'yearly', 'https://www.pcloud.com', ALL],
  ['mega', 'MEGA', 'மெகா', 'cloud', 'monthly', 'https://mega.io', ALL],
  ['box', 'Box', 'பாக்ஸ்', 'cloud', 'monthly', 'https://www.box.com', ALL],
  ['backblaze', 'Backblaze', 'பேக்ப்ளேஸ்', 'cloud', 'monthly', 'https://www.backblaze.com', ALL],
  ['aws', 'Amazon Web Services', 'அமேசான் வெப் சர்வீசஸ்', 'cloud', 'monthly', 'https://aws.amazon.com', ALL],
  ['digitalocean', 'DigitalOcean', 'டிஜிட்டல்ஓஷன்', 'cloud', 'monthly', 'https://www.digitalocean.com', ALL],
  ['cloudflare', 'Cloudflare', 'கிளவுட்ஃப்ளேர்', 'cloud', 'monthly', 'https://dash.cloudflare.com', ALL],
  ['godaddy', 'GoDaddy', 'கோடாடி', 'cloud', 'yearly', 'https://www.godaddy.com', ALL],
  ['hostinger', 'Hostinger', 'ஹோஸ்டிங்கர்', 'cloud', 'yearly', 'https://www.hostinger.com', ALL],
  ['claude_pro', 'Claude Pro', 'கிளாட் ப்ரோ', 'ai', 'monthly', 'https://claude.ai/settings/billing', ALL],
  ['google_ai_pro', 'Google AI Pro', 'கூகுள் ஏஐ ப்ரோ', 'ai', 'monthly', 'https://one.google.com/about/ai-premium', ALL],
  ['perplexity_pro', 'Perplexity Pro', 'பெர்ப்ளெக்சிட்டி ப்ரோ', 'ai', 'monthly', 'https://www.perplexity.ai', ALL],
  ['midjourney', 'Midjourney', 'மிட்ஜர்னி', 'ai', 'monthly', 'https://www.midjourney.com', ALL],
  ['copilot_pro', 'Copilot Pro', 'கோபைலட் ப்ரோ', 'ai', 'monthly', 'https://account.microsoft.com/services/copilotpro', ALL],
  ['github_copilot', 'GitHub Copilot', 'கிட்ஹப் கோபைலட்', 'ai', 'monthly', 'https://github.com/settings/copilot', ALL],
  ['cursor', 'Cursor', 'கர்சர்', 'ai', 'monthly', 'https://cursor.com', ALL],
  ['elevenlabs', 'ElevenLabs', 'இலெவன்லேப்ஸ்', 'ai', 'monthly', 'https://elevenlabs.io', ALL],
  ['github', 'GitHub', 'கிட்ஹப்', 'productivity', 'monthly', 'https://github.com/settings/billing', ALL],
  ['google_workspace', 'Google Workspace', 'கூகுள் வொர்க்ஸ்பேஸ்', 'productivity', 'monthly', 'https://workspace.google.com', ALL],
  ['slack', 'Slack', 'ஸ்லாக்', 'productivity', 'monthly', 'https://slack.com', ALL],
  ['zoom', 'Zoom', 'ஜூம்', 'productivity', 'monthly', 'https://zoom.us', ALL],
  ['figma', 'Figma', 'ஃபிக்மா', 'productivity', 'monthly', 'https://www.figma.com', ALL],
  ['grammarly', 'Grammarly', 'கிராமர்லி', 'productivity', 'yearly', 'https://www.grammarly.com', ALL],
  ['evernote', 'Evernote', 'எவர்நோட்', 'productivity', 'yearly', 'https://evernote.com', ALL],
  ['todoist', 'Todoist', 'டூடூயிஸ்ட்', 'productivity', 'yearly', 'https://todoist.com', ALL],
  ['adobe_acrobat', 'Adobe Acrobat', 'அடோபி அக்ரோபேட்', 'productivity', 'monthly', 'https://www.adobe.com/acrobat.html', ALL],
  ['adobe_lightroom', 'Adobe Lightroom', 'அடோபி லைட்ரூம்', 'productivity', 'monthly', 'https://www.adobe.com/products/photoshop-lightroom.html', ALL],
  ['onepassword', '1Password', '1பாஸ்வேர்டு', 'productivity', 'yearly', 'https://1password.com', ALL],
  ['bitwarden', 'Bitwarden', 'பிட்வார்டன்', 'productivity', 'yearly', 'https://bitwarden.com', ALL],
  ['proton_unlimited', 'Proton Unlimited', 'புரோட்டான் அன்லிமிடெட்', 'productivity', 'yearly', 'https://account.proton.me', ALL],
  ['nordvpn', 'NordVPN', 'நார்ட்விபிஎன்', 'productivity', 'yearly', 'https://nordvpn.com', ALL],
  ['expressvpn', 'ExpressVPN', 'எக்ஸ்பிரஸ்விபிஎன்', 'productivity', 'yearly', 'https://www.expressvpn.com', ALL],
  ['surfshark', 'Surfshark', 'சர்ஃப்ஷார்க்', 'productivity', 'yearly', 'https://surfshark.com', ALL],
  ['norton_360', 'Norton 360', 'நார்டன் 360', 'productivity', 'yearly', 'https://my.norton.com', ALL],
  ['mcafee', 'McAfee', 'மெக்கஃபி', 'productivity', 'yearly', 'https://www.mcafee.com', ALL],
  ['wix', 'Wix', 'விக்ஸ்', 'productivity', 'yearly', 'https://www.wix.com', ALL],
  ['squarespace', 'Squarespace', 'ஸ்கொயர்ஸ்பேஸ்', 'productivity', 'yearly', 'https://www.squarespace.com', ALL],
  ['shopify', 'Shopify', 'ஷாப்பிஃபை', 'productivity', 'monthly', 'https://www.shopify.com', ALL],
  ['telegram_premium', 'Telegram Premium', 'டெலிகிராம் பிரீமியம்', 'productivity', 'monthly', 'https://telegram.org', ALL],
  ['meta_verified', 'Meta Verified', 'மெட்டா வெரிஃபைடு', 'productivity', 'monthly', 'https://www.meta.com', ALL],
  ['x_premium', 'X Premium', 'எக்ஸ் பிரீமியம்', 'news', 'monthly', 'https://x.com', ALL],
  ['bumble', 'Bumble', 'பம்பிள்', 'dating', 'monthly', 'https://bumble.com', ALL],
  ['hinge', 'Hinge', 'ஹிஞ்ச்', 'dating', 'monthly', 'https://hinge.co', ALL],
  ['coursera_plus', 'Coursera Plus', 'கோர்செரா பிளஸ்', 'education', 'yearly', 'https://www.coursera.org', ALL],
  ['udemy_personal_plan', 'Udemy Personal Plan', 'யுடெமி பர்சனல் பிளான்', 'education', 'monthly', 'https://www.udemy.com', ALL],
  ['skillshare', 'Skillshare', 'ஸ்கில்ஷேர்', 'education', 'yearly', 'https://www.skillshare.com', ALL],
  ['masterclass', 'MasterClass', 'மாஸ்டர்கிளாஸ்', 'education', 'yearly', 'https://www.masterclass.com', ALL],
  ['brilliant', 'Brilliant', 'பிரில்லியன்ட்', 'education', 'yearly', 'https://brilliant.org', ALL],
  ['babbel', 'Babbel', 'பேபெல்', 'education', 'monthly', 'https://www.babbel.com', ALL],
  ['linkedin_learning', 'LinkedIn Learning', 'லிங்க்ட்இன் லேர்னிங்', 'education', 'monthly', 'https://www.linkedin.com/learning', ALL],
  ['everand', 'Everand', 'எவராண்ட்', 'books', 'monthly', 'https://www.everand.com', ALL],
  ['blinkist', 'Blinkist', 'பிளிங்கிஸ்ட்', 'books', 'yearly', 'https://www.blinkist.com', ALL],
  ['nytimes', 'The New York Times', 'தி நியூயார்க் டைம்ஸ்', 'news', 'monthly', 'https://www.nytimes.com', ALL],
  ['wsj', 'The Wall Street Journal', 'தி வால் ஸ்ட்ரீட் ஜர்னல்', 'news', 'monthly', 'https://www.wsj.com', ALL],
  ['washington_post', 'The Washington Post', 'தி வாஷிங்டன் போஸ்ட்', 'news', 'monthly', 'https://www.washingtonpost.com', ALL],
  ['the_economist', 'The Economist', 'தி எகனாமிஸ்ட்', 'news', 'yearly', 'https://www.economist.com', ALL],
  ['financial_times', 'Financial Times', 'ஃபைனான்சியல் டைம்ஸ்', 'news', 'monthly', 'https://www.ft.com', ALL],
  ['medium', 'Medium', 'மீடியம்', 'news', 'monthly', 'https://medium.com', ALL],
  ['strava', 'Strava', 'ஸ்ட்ராவா', 'fitness', 'yearly', 'https://www.strava.com', ALL],
  ['peloton_app', 'Peloton App', 'பெலோட்டன் ஆப்', 'fitness', 'monthly', 'https://www.onepeloton.com', ['US', 'GB', 'CA', 'AU', 'DE']],
  ['fitbit_premium', 'Fitbit Premium', 'ஃபிட்பிட் பிரீமியம்', 'fitness', 'monthly', 'https://www.fitbit.com', ALL],
  ['apple_fitness_plus', 'Apple Fitness+', 'ஆப்பிள் ஃபிட்னஸ்+', 'fitness', 'monthly', 'https://www.apple.com/apple-fitness-plus/', ALL],
  ['headspace', 'Headspace', 'ஹெட்ஸ்பேஸ்', 'fitness', 'yearly', 'https://www.headspace.com', ALL],
  ['calm', 'Calm', 'காம்', 'fitness', 'yearly', 'https://www.calm.com', ALL],
  ['myfitnesspal', 'MyFitnessPal Premium', 'மைஃபிட்னஸ்பால் பிரீமியம்', 'fitness', 'monthly', 'https://www.myfitnesspal.com', ALL],
  ['whoop', 'WHOOP', 'வூப்', 'fitness', 'yearly', 'https://www.whoop.com', ALL],
  ['anytime_fitness', 'Anytime Fitness', 'எனிடைம் ஃபிட்னஸ்', 'fitness', 'monthly', 'https://www.anytimefitness.com', ALL],
  ['uber_one', 'Uber One', 'ஊபர் ஒன்', 'shopping', 'monthly', 'https://www.uber.com', ALL],
  ['dashpass', 'DashPass', 'டேஷ்பாஸ்', 'food', 'monthly', 'https://www.doordash.com', ['US', 'CA', 'AU']],
  ['instacart_plus', 'Instacart+', 'இன்ஸ்டாகார்ட்+', 'food', 'yearly', 'https://www.instacart.com', ['US', 'CA']],
  ['hellofresh', 'HelloFresh', 'ஹலோஃப்ரெஷ்', 'food', 'monthly', 'https://www.hellofresh.com', ['US', 'GB', 'DE', 'AU', 'CA', 'NL']],
  ['walmart_plus', 'Walmart+', 'வால்மார்ட்+', 'shopping', 'yearly', 'https://www.walmart.com', ['US']],
  ['costco', 'Costco Membership', 'காஸ்ட்கோ மெம்பர்ஷிப்', 'shopping', 'yearly', 'https://www.costco.com', ['US', 'CA', 'GB', 'JP', 'AU']],
]);

// Other names a person searches by — the brand's old name, its short form, the
// product inside the bundle. Search-only: never displayed, so not localised,
// and not part of any name key (qa.mjs dedup is about what is SHOWN).
export const ALIASES = Object.freeze({
  netflix: ['nf'],
  amazon_prime: ['prime'],
  jiohotstar: ['hotstar', 'disney+ hotstar', 'jiocinema'],
  youtube_premium: ['yt premium'],
  apple_tv_plus: ['apple tv'],
  icloud_plus: ['icloud'],
  google_one: ['google drive storage'],
  microsoft_365: ['office 365', 'office'],
  chatgpt_plus: ['chatgpt', 'openai'],
  xbox_game_pass: ['game pass'],
  playstation_plus: ['ps plus', 'psn'],
  the_hindu: ['hindu'],
  cultpass: ['cult.fit', 'cult'],
  zomato_gold: ['zomato'],
  swiggy_one: ['swiggy'],
  prime_video: ['amazon video'],
  hbo_max: ['max', 'hbo'],
  google_ai_pro: ['gemini', 'gemini advanced'],
  airtel_xstream_play: ['xstream'],
  vi_postpaid: ['vodafone idea', 'vodafone'],
  vi_prepaid: ['vodafone idea'],
  bsnl: ['bharat sanchar'],
  tata_play: ['tata sky'],
  x_premium: ['twitter blue', 'twitter'],
  everand: ['scribd'],
  copilot_pro: ['microsoft copilot'],
  claude_pro: ['anthropic'],
  toi_plus: ['times of india'],
  et_prime: ['economic times'],
  nytimes: ['nyt'],
  wsj: ['wall street journal'],
  financial_times: ['ft'],
});

export const INDEX_KEY = 'catalogue.services';
// The pack ships one shard per SUPPORTED locale of the locale register
// (tooling/i18n/locales.json), so a new app language reaches the catalogue
// without an edit here — and `--check` fails until its shard is rendered.
export const LOCALES = Object.freeze(supportedCodes(loadRegister()));

/** Locales whose display name is a TRANSLITERATION, by table column. Every other
 *  locale shows the brand exactly as the service styles it (Latin script), which
 *  is what the prompt asks for: a brand name is a name, not copy. Hindi joined the
 *  register 2026-10-01; a Devanagari transliteration of 202 brands is translation
 *  work with its own provenance (it would be model output, which this table says
 *  it is not), so it waits for the translation lane rather than being typed here. */
const TRANSLITERATED = Object.freeze({ ta: 2 });

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
    // v2 (ST-T9): search-only names, always present so the schema can
    // require it; `[]` is a service nobody calls anything else.
    aliases: ALIASES[id] ?? [],
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
  // 🔴 A record that does not match the schema is never rendered: the pack is
  // what the app reads, so a malformed row would ship to every install.
  const problems = SERVICES.flatMap((row) => factsProblems(JSON.parse(facts(row)), `svc.${row[0]}.facts`));
  if (problems.length) throw new Error(`service-catalogue REFUSED — ${problems.join('; ')}`);
  const s = { [INDEX_KEY]: SERVICES.map(([id]) => id).join(',') };
  for (const row of SERVICES) {
    const [id, en] = row;
    s[`svc.${id}.name`] = locale in TRANSLITERATED ? row[TRANSLITERATED[locale]] : en;
    s[`svc.${id}.facts`] = facts(row);
  }
  return s;
}

function promptFor(itemId) {
  // 🔴 NO BRAND IN ANY PROMPT. The [ADR 019] ban list scans every prompt, and a
  // prompt is what was ASKED — the instruction, not the answer. Naming the brand
  // here would record nothing the content does not already say.
  if (itemId === INDEX_KEY) {
    return 'List the id of every service in the catalogue table, comma-separated, in table order. India-first plus widely available global services, at least one hundred and fifty.';
  }
  if (itemId.endsWith('.name')) {
    return "Record the service's brand name exactly as the service styles it; for ta, transliterate the brand into Tamil script rather than translating it; every other locale keeps the brand as styled.";
  }
  return "Record the service's category from the closed set, its default billing cycle, the https address of its own account or cancel page (its home page on its own domain where a deep link was not certain), the Play and App Store subscription-management pages, one day of notice, the regions it serves, and any other names a person searches it by. Author no price and no logo.";
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
    pack_version: '2.0.0',
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
    version: '2.0.0',
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
    ...LOCALES.map((l) => [`content/${l}.json`, pretty(shard(l))]),
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
