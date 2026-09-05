#!/usr/bin/env node
/* SKELETON — the locale generator.
   =====================================================================

   BUILD-TIME SCRIPT. NEVER SHIPPED. Read this paragraph before you read the
   code, because the house rule it sits next to is absolute and this file looks
   like it breaks it.

     The rule is "ZERO NETWORK CALLS IN SHIPPED CODE". Shipped code is what the
     browser loads: manifest.json, background.js, lib/, pages/, popup/, icons/
     and _locales/<locale>/messages.json. This file is none of those. It is a
     .mjs under _locales/, it is excluded by the packaging allowlist AND by the
     packaging never-list, and no html, no manifest entry and no importScripts
     can reach it. It is run by a person or an agent, on a workstation, before
     a build.
     THIS SCRIPT ITSELF MAKES NO NETWORK CALLS EITHER — it has no dependencies
     and nothing here opens a socket. If you wire a machine translator into
     translate() below and that translator needs a network, that call happens
     HERE, at build time, in this file, and its output is committed as static
     JSON. It never becomes something the browser does.

   WHAT IT DOES

     _locales/en/messages.json is the ONE source of truth. This script reads it
     and (re)generates _locales/<locale>/messages.json for all 55 Chrome Web
     Store locales, so that changing one English string regenerates every locale
     in sync instead of leaving 54 files quietly stale.

     It is IDEMPOTENT: running it twice with nothing changed rewrites nothing
     and produces byte-identical files. Run it as often as you like.

   WHERE THE WORDS COME FROM — TWO DATA FILES, NOT TWO CODE PATHS

     _locales/tm/<locale>.json      the translation memory: { key: "text" }.
                                    Add a language by adding a file.
     _locales/backtranslations.json the round trips for the privacy claim set:
                                    { locale: { key: "back into English" } }.

     Both are build-time data, neither is packaged, and putting the words in
     data rather than in a table inside this script is what makes 55 languages
     reviewable in a diff and re-runnable by someone who does not read JS.

   THE GUARD YOU MUST NOT REMOVE

     A run that would replace a translated message with the English source
     REFUSES and writes nothing at all. See THE DESTRUCTIVE-WRITE GUARD below.
     It is the difference between a missing TM costing you a re-run and a
     missing TM costing you 38 languages.

   COMMANDS

     node _locales/make-locales.mjs             regenerate + run every gate
     node _locales/make-locales.mjs --check     run every gate, WRITE NOTHING;
                                                exit 1 on drift or on a failed
                                                gate. This is the CI shape.
     node _locales/make-locales.mjs --todo      list untranslated keys per locale
     node _locales/make-locales.mjs --self-test prove the back-translation
                                                negation check actually bites

   Exit 0 only when every gate passed.
*/
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_LOCALE = 'en';

/* ==================================================================== */
/* THE 55 CHROME WEB STORE LOCALES                                      */
/* ==================================================================== */

/* Locked by the owner: all 55, no subset. Chrome's folder names use an
   underscore (pt_BR); BCP-47 / Intl want a hyphen (pt-BR). intlTag() converts.
   RTL is not a list we maintain — it is derived from Intl below. */
const LOCALES = [
  'ar', 'am', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en',
  'en_AU', 'en_GB', 'en_US', 'es', 'es_419', 'et', 'fa', 'fi', 'fil', 'fr',
  'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko',
  'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl', 'pt_BR', 'pt_PT',
  'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th',
  'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'
];

/* The six CLDR plural categories. Every plural family carries ALL SIX in EVERY
   locale — including the ones a language never uses — so that the "identical
   key set in all 55 files" invariant stays absolute and mechanically checkable.
   pages/common.js's skPlural() asks Intl.PluralRules which one to read and
   falls back to _other, so the unused forms cost four lines of JSON and buy a
   gate that cannot be argued with. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function intlTag(locale) { return String(locale).replace(/_/g, '-'); }
function baseLanguage(locale) { return String(locale).split('_')[0]; }

function pluralCategoriesFor(locale) {
  try { return new Intl.PluralRules(intlTag(locale)).resolvedOptions().pluralCategories; }
  catch (_) { return ['other']; }
}

function isRtl(locale) {
  try {
    const info = new Intl.Locale(intlTag(locale));
    const dir = (typeof info.getTextInfo === 'function' ? info.getTextInfo() : info.textInfo);
    if (dir && dir.direction) return dir.direction === 'rtl';
  } catch (_) { /* fall through */ }
  return ['ar', 'fa', 'he'].indexOf(baseLanguage(locale)) >= 0;
}

/* ==================================================================== */
/* THE TRANSLATION MEMORY                                               */
/* ==================================================================== */

/* Translations are DATA, not code: _locales/tm/<locale>.json, a flat
   { key: "translated string" } object. Build-time only, never packaged (the
   collector in publish/pack.mjs takes _locales/<dir>/messages.json and nothing
   else, and verify-package.node.js fails the build on any other path under
   _locales/).

   WHY A SEPARATE DIRECTORY RATHER THAN EDITING THE 55 CATALOGUES DIRECTLY.
   A catalogue carries the provenance stamp this script writes; a TM entry
   carries only what a translator produced. Keeping them apart is what makes
   "the English changed, so this translation is stale" mechanically decidable
   instead of a guess, and it is what lets the generator be re-run at any time
   without a human having to remember which of 6,820 entries were hand-made.

   A MISSING TM FILE IS NOT AN INSTRUCTION TO WRITE ENGLISH. It is the exact
   condition that nearly cost the reference implementation 38 translated
   locales. See THE DESTRUCTIVE-WRITE GUARD below: a run that would replace a
   translated message with the English source refuses, in full, and writes
   nothing at all. */

const TM_DIR = path.join(HERE, 'tm');
const _tmCache = new Map();

function loadTm(locale) {
  if (_tmCache.has(locale)) return _tmCache.get(locale);
  let obj = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(TM_DIR, locale + '.json'), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
  } catch (_) { obj = null; }
  _tmCache.set(locale, obj);
  return obj;
}

/* Regional variants inherit their base and override only what differs. A
   translator writing pt_PT files the ~15 words Portugal says differently, not
   124 sentences Brazil already said correctly. The chain is followed to
   exhaustion, so es_419 -> es -> (nothing) works without special cases. */
const BASE_OF = {
  en_AU: 'en', en_GB: 'en', en_US: 'en',
  es_419: 'es',
  pt_PT: 'pt_BR'
};

/* Keys whose English value is the same in every language, DERIVED rather than
   listed, so it survives the renaming that every one of the tools copied from
   this skeleton will do:
     * the product's own short name — a brand is not translated; and
     * any message with no letter in it at all (the em dash used for "no value").
   They are counted as translated, not as a to-do, and the anti-abandonment
   check in test/skeleton-sim.node.js exempts exactly the same set — which is
   the reason that check is "MOST of the values differ" and not "all of them". */
function passesThroughUntranslated(enMessage, en) {
  const brand = en.appShortName && en.appShortName.message;
  if (brand && enMessage === brand) return true;
  return !/\p{L}/u.test(enMessage);
}

/* Look a key up in one locale's TM, with three fallbacks that are all
   value-preserving and none of which can invent English:
     1. the key itself;
     2. any OTHER key whose ENGLISH IS BYTE-IDENTICAL and which the TM does
        carry — "Export everything" is the title and the button, and asking a
        translator for it twice is how the two drift apart;
     3. for a plural form, the family's _other. A locale whose grammar has two
        categories files two; Chrome and skPlural() still want all six present,
        and filling four of them from _other is arithmetic, not translation. */
function tmLookup(locale, key, en) {
  const tm = loadTm(locale);
  if (!tm) return null;
  if (typeof tm[key] === 'string' && tm[key]) return tm[key];

  const enMessage = en[key] && en[key].message;
  if (enMessage) {
    for (const other of Object.keys(en)) {
      if (other === key) continue;
      if (en[other].message !== enMessage) continue;
      if (typeof tm[other] === 'string' && tm[other]) return tm[other];
    }
  }

  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  if (m && typeof tm[m[1] + '_other'] === 'string' && tm[m[1] + '_other']) return tm[m[1] + '_other'];

  return null;
}

/* ==================================================================== */
/* ######################  FILL THIS IN  #############################  */
/* ==================================================================== */

/* translate() — THE TRANSLATION STEP.
   -------------------------------------------------------------------
   Called once per (locale, key) whenever a translation is missing or the
   English source it was made from has changed.

     key        the message id, e.g. 'reasonBusy'
     enMessage  the English source string, e.g. 'This tab is already busy.'
     locale     a Chrome locale folder name, e.g. 'pt_BR'
     ctx        { intlTag, baseLanguage, isRtl, isEnglishVariant,
                  description, placeholders, isPrivacy, isPermission }
                `description` is the translator note from _locales/en —
                PASS IT TO THE MODEL. It is the difference between "Tab" the
                browser tab and "Tab" the keyboard key.

   Return a STRING to translate, or NULL to leave the key in English for now
   (that is a valid, shippable state — Chrome falls back to default_locale, and
   this script still writes the key so the key set stays identical).

   RULES THE RETURNED STRING MUST OBEY — all of them are gated below, so a
   violation is a red, not a surprise in production:
     * every $PLACEHOLDER$ in enMessage appears exactly once in the result.
       Their ORDER may change freely; that is the whole point of placeholders.
     * appShortName ≤ 12 characters, appName ≤ 75, appDescription ≤ 132.
     * no leading '[privacy]' / '[permission]' tag — those live in the English
       `description` field only and must never reach a user.

   THE ONE THING THAT IS NEVER TRANSLATED: the tool's FUNCTIONAL OUTPUT.
   Exported Markdown, CSV headers, captured page text and generated filenames
   are the user's own content in the page's own language. Translating them
   corrupts data. Only the UI chrome — the strings in _locales/en — goes
   through here. If a string you are about to add ends up inside a file the
   user exports, it does not belong in the catalogue at all.

   TO WIRE A REAL TRANSLATOR: replace the `return null` at the end. Everything
   above it is the two worked examples and should be left alone.
*/
function translate(key, enMessage, locale, ctx) {
  /* 1. this locale's own translation memory, then its base's, then its base's
        base. The chain stops at the first hit; nothing further down can
        overwrite it. */
  for (let l = locale; l; l = BASE_OF[l]) {
    const hit = tmLookup(l, key, ctx.en);
    if (hit != null) return hit;
  }

  /* 2. a brand or a letterless glyph is the same string in every language. */
  if (passesThroughUntranslated(enMessage, ctx.en)) return enMessage;

  /* 3. an English variant with no TM entry inherits the source VERBATIM, and
        that is a complete translation, not a gap: en_GB is English. Every
        other locale returns null, which means "leave what is on disk alone and
        report this key as still to do" — see buildLocale(), and see THE
        DESTRUCTIVE-WRITE GUARD for what null must never be allowed to mean. */
  if (ctx.isEnglishVariant) return enMessage;

  /* >>> AGENT: a machine translator can be wired here as a LAST resort, after
         the TM. Write its output back to _locales/tm/<locale>.json so the next
         run is deterministic and reviewable — a translation that exists only
         inside a model is a translation you cannot diff. <<< */
  return null;
}

/* backTranslate() — THE VERIFICATION STEP for the negation check below.
   -------------------------------------------------------------------
   Given a translated string, return it rendered BACK into English, or null if
   no back-translator is wired. It must be a DIFFERENT pass from translate() —
   asking the same model to check its own output in one breath verifies nothing.

   Only the strings tagged [privacy] or [permission] in _locales/en are ever
   passed through here. See WHY THIS CHECK IS SO NARROW, below. */
/* THE CLAIM SET — the [privacy] strings that are back-translated.

   Not all 29 [privacy] keys: the six sentences on which the product's promise
   actually rests, declared here by hand, one line of justification each.
   A round trip over all 29 in 54 languages is 1,566 sentences, which is a
   volume nobody re-does when a string changes, and a check nobody re-runs is a
   check that is green because it is stale.

     aboutBlurb            "no account, no tracking, no network calls" — the
                           sentence a store reviewer reads and the one a
                           regulator would quote back.
     optExportDesc         "Nothing is uploaded." The export is the moment a
                           user's data is closest to leaving the device.
     confirmReportBody     the longest promise in the product, and the only one
                           shown at the instant a file is about to be written.
     popupPrivateNotSaved  private-window behaviour: "was NOT saved" inverted is
                           a false statement about what is on disk.
     dataNothingStored     the empty state. Inverted, it tells a user their data
                           is stored when it is not, or the reverse.
     optDeleteAllDesc      THE POSITIVE CONTROL: its English carries no negation
                           at all, so it is the one that catches an INVENTED
                           negation — "Settings are kept" coming back as
                           "Settings are not kept". A claim set made only of
                           negative sentences can only test one direction.

   Adding a seventh is one line here plus one line per locale in
   _locales/backtranslations.json. Removing one should take an argument. */
const BACKTRANSLATED_CLAIMS = [
  'aboutBlurb',
  'optExportDesc',
  'confirmReportBody',
  'popupPrivateNotSaved',
  'dataNothingStored',
  'optDeleteAllDesc'
];

/* The round trips live in ONE file — _locales/backtranslations.json, shaped
   { "<locale>": { "<key>": "the translation, rendered back into English" } }.
   One file rather than 54 because it is read as a whole, by one check, and
   because a reviewer comparing "what does the Hindi actually say" against "what
   does the Tamil actually say" wants them adjacent.

   IT IS A SEPARATE PASS, NOT THE TRANSLATOR CHECKING ITS OWN WORK. Whoever
   fills it must read only the TRANSLATED string and render it back cold —
   never with the English in front of them, because a round trip made while
   looking at the answer reproduces the answer. */
let _backCache;
function loadBackTranslations() {
  if (_backCache !== undefined) return _backCache;
  try { _backCache = JSON.parse(fs.readFileSync(path.join(HERE, 'backtranslations.json'), 'utf8')); }
  catch (_) { _backCache = null; }
  return _backCache;
}

function backTranslate(text, locale, key) {
  const all = loadBackTranslations();
  const forLocale = all && all[locale];
  const back = forLocale && forLocale[key];
  return typeof back === 'string' && back.trim() ? back : null;
}

/* ==================================================================== */
/* THE WORKED EXAMPLES                                                  */
/* ==================================================================== */

/* Two locales are filled in as worked examples, and they live in
   _locales/tm/ with every other translation because an example that lives
   somewhere special is an example nobody copies:

     tm/ar.json     Arabic — right to left, and the one locale that exercises
                    all six CLDR plural categories with six genuinely different
                    sentences. Note lastRunFailed: Arabic puts the reason before
                    the action, and the gate accepts it, because the rule is on
                    the placeholder SET and never on its position. A pipeline
                    that could only reorder fragments could not produce that
                    line at all.
     tm/en_GB.json  an English variant — the handful of words that genuinely
                    differ, and nothing else. The generated en_GB/messages.json
                    still carries all 124 keys: a variant is not a partial file.

   test/skeleton-sim.node.js runs the real pages/common.js against the real
   ar catalogue and asserts the Arabic reached the DOM, so tm/ar.json is
   load-bearing for the test tier and not decoration. /* ==================================================================== */
/* ###################  END OF THE FILL-IN AREA  #####################  */
/* ==================================================================== */

/* ---------------- reading and writing ---------------- */

function localeDir(locale) { return path.join(HERE, locale); }
function localeFile(locale) { return path.join(localeDir(locale), 'messages.json'); }

function readCatalogue(locale) {
  try { return JSON.parse(fs.readFileSync(localeFile(locale), 'utf8')); }
  catch (_) { return null; }
}

/* 2-space indent, key order = the English file's order, one trailing newline.
   Stable output is what makes "run it twice, nothing changes" checkable with a
   byte comparison instead of a parse-and-deep-equal. */
function serialise(obj) { return JSON.stringify(obj, null, 2) + '\n'; }

const SOURCE_PREFIX = 'en: ';

/* The English source a translation was made from, recorded in the generated
   file's `description`. Chrome ignores `description` at runtime, so this costs
   nothing shipped and buys mechanical staleness detection: if the recorded
   source no longer matches _locales/en, the translation is out of date and the
   run says so. A key with no description was never translated — it is the
   English string falling through, which is a valid shippable state. */
function recordedSource(entry) {
  const d = entry && typeof entry.description === 'string' ? entry.description : '';
  return d.startsWith(SOURCE_PREFIX) ? d.slice(SOURCE_PREFIX.length) : null;
}

/* ---------------- placeholders ---------------- */

function placeholderNames(message) {
  const out = new Set();
  const re = /\$([A-Za-z0-9_]+)\$/g;
  let m;
  while ((m = re.exec(String(message)))) out.add(m[1].toLowerCase());
  return out;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/* ---------------- tags ---------------- */

/* [privacy] and [permission] live at the FRONT of the English `description`.
   They are the only thing in this pipeline that selects which strings get the
   expensive back-translation pass. */
function tagsOf(entry) {
  const d = String((entry && entry.description) || '');
  return {
    isPrivacy: d.startsWith('[privacy]'),
    isPermission: d.startsWith('[permission]')
  };
}

/* ==================================================================== */
/* THE BACK-TRANSLATION NEGATION CHECK                                  */
/* ==================================================================== */

/* WHY THIS CHECK IS SO NARROW.

   Back-translating every string and eyeballing the result is a style review,
   and a style review over 55 locales × 70 strings is a review that never
   happens. The owner's decision is deliberately "AI-translated, NO manual
   review gate", so the automated check has to earn its place by catching a
   specific, mechanical, high-consequence failure — not by having an opinion.

   The failure it catches is a DROPPED OR INVERTED NEGATION, and it is scoped to
   the [privacy] and [permission] strings because those are the only ones where
   losing a "not" turns a true statement into a false one with legal weight:

     "no accounts, no tracking, no network calls"  ->  "accounts, tracking,
     network calls"                                   a false privacy claim in
                                                      a store listing

     "stored on this device only ... Nothing leaves it."  ->  "stored on this
     device and sent onwards"                         the opposite of the
                                                      promise the product's
                                                      Delete-everything button
                                                      is built around

     "Browser pages are off limits to EVERY extension"  ->  "this extension
     cannot read browser pages"                       reads as a defect report
                                                      rather than a browser rule

   A mistranslated button label is a bug. A mistranslated privacy claim is a
   misrepresentation, and it ships to a store in a language nobody on the team
   reads. That asymmetry is the whole justification for the narrow scope.

   IT FLAGS, IT NEVER FIXES. A dropped negation is not repairable by counting
   words — the fix is a re-translation by something that can read the language.
   Silently "correcting" it would mean this script inventing prose for a legal
   claim, which is worse than the bug. */

/* An allowlist of fixed English negation words. Not a regex over the text: the
   same reason background.js's REASONS table is an allowlist. Contractions are
   handled separately because "n't" is a suffix, not a word.

   DELIBERATELY ABSENT, and each absence was a red in --self-test before it was
   a comment here:
     'off'      — "Off by default" is a TOGGLE STATE, and "Disabled by default"
                  is a faithful translation of it. Counting 'off' as a negation
                  made a correct round trip look like a dropped promise, which
                  is the failure mode that gets a check deleted.
     'except',
     'excluding' — carve-out words. They appear on both sides of a rewrite in
                  different numbers and produce noise, not signal.
   The list holds grammatical negations only. It is not a semantics checker and
   must not grow into one. */
const NEGATION_WORDS = new Set([
  'no', 'not', 'never', 'none', 'nothing', 'nobody', 'nowhere', 'neither',
  'nor', 'without', 'cannot', 'zero', 'unable'
]);

function countNegations(text) {
  const s = String(text || '').toLowerCase();
  let n = 0;
  for (const tok of s.split(/[^a-z']+/)) {
    if (!tok) continue;
    if (NEGATION_WORDS.has(tok)) { n++; continue; }
    if (tok.endsWith("n't")) n++;          // can't, don't, doesn't, won't, isn't
  }
  return n;
}

/* Returns a list of findings. severity 'hard' fails the run; 'soft' is printed
   for a human to look at and does not. */
function checkNegationPolarity(key, locale, enMessage, backText) {
  const findings = [];
  if (backText == null) return findings;
  const want = countNegations(enMessage);
  const got = countNegations(backText);
  if (want > 0 && got === 0) {
    findings.push({ severity: 'hard', key, locale, want, got,
      why: 'every negation was lost in translation — the claim now says the opposite' });
  } else if (want === 0 && got > 0) {
    findings.push({ severity: 'hard', key, locale, want, got,
      why: 'a negation appeared that is not in the English source' });
  } else if (want !== got) {
    findings.push({ severity: 'soft', key, locale, want, got,
      why: 'the number of negations changed — usually a rephrasing, occasionally a lost clause' });
  }
  return findings;
}

/* ==================================================================== */
/* GENERATION                                                           */
/* ==================================================================== */

async function buildLocale(locale, en, keys) {
  const isEnglishVariant = baseLanguage(locale) === 'en';
  const existing = readCatalogue(locale) || {};
  const out = {};
  const todo = [];
  const stale = [];

  for (const key of keys) {
    const src = en[key];
    const enMessage = src.message;
    const prev = existing[key];
    const prevSource = recordedSource(prev);
    const tags = tagsOf(src);

    let translated = null;
    if (locale === SOURCE_LOCALE) {
      translated = enMessage;                       // the source locale is itself
    } else {
      translated = await translate(key, enMessage, locale, {
        en,
        intlTag: intlTag(locale),
        baseLanguage: baseLanguage(locale),
        isRtl: isRtl(locale),
        isEnglishVariant,
        description: src.description || '',
        placeholders: src.placeholders || null,
        isPrivacy: tags.isPrivacy,
        isPermission: tags.isPermission
      });
    }

    let entry;
    if (translated != null && (prev === undefined || translated !== prev.message)) {
      /* The translation source is newer than what is on disk — adopt it and
         stamp the English it was made from. */
      entry = { message: translated, description: SOURCE_PREFIX + enMessage };
    } else if (prev !== undefined && prevSource !== null) {
      /* Keep what is on disk. A hand-filled locale with no entry in
         WORKED_EXAMPLES lives here, and this is why hand edits survive. */
      entry = { message: prev.message, description: SOURCE_PREFIX + prevSource };
      if (prevSource !== enMessage) stale.push(key);
    } else if (translated != null) {
      entry = { message: translated, description: SOURCE_PREFIX + enMessage };
    } else {
      /* No translation yet: the English falls through. Chrome would fall back
         to default_locale anyway, but writing the key keeps every catalogue's
         key set identical, which is what the gates below can then assert. */
      entry = { message: enMessage };
      todo.push(key);
    }

    if (src.placeholders) entry.placeholders = JSON.parse(JSON.stringify(src.placeholders));
    out[key] = entry;
  }

  return { locale, catalogue: out, todo, stale };
}

/* ==================================================================== */
/* THE DESTRUCTIVE-WRITE GUARD                                          */
/* ==================================================================== */

/* THE FAILURE THIS EXISTS FOR, WHICH IS NOT HYPOTHETICAL.
   The reference implementation nearly lost 38 translated locales in one
   command. Its generator sourced from a translation memory, the TM was not
   where the generator expected it, translate() therefore returned null for
   every key, and the null path wrote the ENGLISH SOURCE into every catalogue.
   Every other gate stayed green while it happened: the key sets still matched,
   the placeholders still matched, the JSON still parsed, all 55 codes were
   still declared. The files were perfect and the translations were gone.

   The lesson the family took from it is not "be careful with the TM". It is:

       MAKE THE DESTRUCTIVE ACT IMPOSSIBLE, NOT MERELY AVOIDED.

   So this is not a warning and it is not a --force-able confirmation. If any
   locale would have a message REPLACED BY THE ENGLISH SOURCE, the whole run
   refuses and writes NOTHING — not even the locales that were fine. Partial
   success is how you end up with 17 destroyed files and a clean exit code.

   WHY IT IS ATOMIC. The write loop is ordered; a guard that fired on locale 40
   would already have flattened 39. The build is computed in full, the guard
   runs against the finished result, and only then does anything touch a file.

   THE TWO LEGITIMATE WAYS TO REMOVE A TRANSLATION, both of which are visible in
   a diff and neither of which is a flag on this script:
     1. delete _locales/<locale>/messages.json. Nothing on disk, nothing to
        destroy, and the next run writes a fresh English fallback catalogue.
     2. put the English string in _locales/tm/<locale>.json deliberately. That
        is a translator saying "this word is the same in my language", it is
        reviewable as an added line, and it is not this script guessing.

   WHAT IT DOES NOT BLOCK: replacing one translation with a DIFFERENT
   translation. That is what a TM update is, the diff shows it word for word,
   and blocking it would make the generator unusable. */

function guardDestructiveWrites(en, keys, built) {
  const casualties = [];

  for (const b of built) {
    if (b.locale === SOURCE_LOCALE) continue;
    const before = readCatalogue(b.locale);
    if (!before) continue;                      // nothing on disk yet: nothing to destroy

    const lost = [];
    for (const key of keys) {
      const was = before[key] && before[key].message;
      const now = b.catalogue[key] && b.catalogue[key].message;
      if (typeof was !== 'string' || typeof now !== 'string') continue;
      const source = en[key].message;
      /* "was translated" is decided by comparing with the ENGLISH SOURCE, not
         by looking for a provenance stamp. A hand-added translation that never
         went through this script carries no stamp, and that is precisely the
         file this guard has to protect — grading on the stamp would exempt it
         from its own protection. */
      if (was !== source && now === source) lost.push(key);
    }
    if (lost.length) casualties.push({ locale: b.locale, lost, total: keys.length });
  }

  return casualties;
}

function reportDestructiveWrites(casualties) {
  const totalKeys = casualties.reduce((n, c) => n + c.lost.length, 0);
  console.log('');
  console.log('REFUSED — this run would have replaced ' + totalKeys + ' translated message(s) with the');
  console.log('          English source across ' + casualties.length + ' locale(s). NOTHING WAS WRITTEN.');
  for (const c of casualties) {
    console.log('  ' + c.locale.padEnd(8) + c.lost.length + '/' + c.total + ' message(s) would be flattened to English — ' +
      c.lost.slice(0, 6).join(', ') + (c.lost.length > 6 ? ', …' : ''));
  }
  console.log('');
  console.log('  The usual cause is a translation memory that is missing, renamed or empty:');
  console.log('  _locales/tm/<locale>.json. Restore it and run again. To remove a translation');
  console.log('  ON PURPOSE, delete _locales/<locale>/messages.json, or put the English string');
  console.log('  in that locale\'s TM — both are visible in a diff. There is no flag for this.');
}

/* ==================================================================== */
/* GATES                                                                */
/* ==================================================================== */

const LIMITS = { appShortName: 12, appName: 75, appDescription: 132 };

function runGates(en, keys, built) {
  const fails = [];
  const warns = [];

  /* G0 — the source itself. Every plural family declares all six categories,
     no message carries a [privacy]/[permission] tag (those are description-only
     and would otherwise be rendered to a user), and the manifest strings fit. */
  const pluralBases = new Set();
  for (const k of keys) {
    const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
    if (m) pluralBases.add(m[1]);
  }
  for (const base of pluralBases) {
    const missing = PLURAL_CATEGORIES.filter(c => keys.indexOf(base + '_' + c) < 0);
    if (missing.length) fails.push(`en: plural family "${base}" is missing ${missing.map(c => '_' + c).join(', ')}`);
  }

  /* G1..G5, per locale. */
  for (const b of built) {
    const cat = b.catalogue;
    const gotKeys = Object.keys(cat);

    if (gotKeys.length !== keys.length || gotKeys.some((k, i) => k !== keys[i])) {
      const missing = keys.filter(k => gotKeys.indexOf(k) < 0);
      const extra = gotKeys.filter(k => keys.indexOf(k) < 0);
      fails.push(`${b.locale}: key set differs from en` +
        (missing.length ? ` — missing ${missing.join(',')}` : '') +
        (extra.length ? ` — extra ${extra.join(',')}` : '') +
        (!missing.length && !extra.length ? ' — order differs' : ''));
    }

    for (const key of keys) {
      const entry = cat[key];
      if (!entry || typeof entry.message !== 'string') { fails.push(`${b.locale}/${key}: no message`); continue; }

      const want = placeholderNames(en[key].message);
      const got = placeholderNames(entry.message);
      if (!sameSet(want, got)) {
        fails.push(`${b.locale}/${key}: placeholder inventory differs — en has {${[...want].join(',')}}, this has {${[...got].join(',')}}`);
      }
      if (en[key].placeholders && !entry.placeholders) {
        fails.push(`${b.locale}/${key}: the placeholders block was dropped`);
      }
      if (/^\[(privacy|permission)\]/.test(entry.message)) {
        fails.push(`${b.locale}/${key}: a [privacy]/[permission] tag leaked into the MESSAGE — tags belong in the English description only`);
      }
      if (LIMITS[key] !== undefined && entry.message.length > LIMITS[key]) {
        fails.push(`${b.locale}/${key}: ${entry.message.length} characters, the browser cuts at ${LIMITS[key]}`);
      }
    }

    if (b.stale.length) {
      fails.push(`${b.locale}: ${b.stale.length} translation(s) were made from English that has since changed — ${b.stale.slice(0, 6).join(', ')}${b.stale.length > 6 ? ', …' : ''}`);
    }
    if (b.todo.length) {
      warns.push(`${b.locale}: ${b.todo.length}/${keys.length} keys still fall through to English`);
    }
  }

  return { fails, warns };
}

function runBackTranslationCheck(en, keys, built) {
  const privacy = keys.filter(k => tagsOf(en[k]).isPrivacy);
  const claims = BACKTRANSLATED_CLAIMS.filter(k => keys.indexOf(k) >= 0);
  const orphans = BACKTRANSLATED_CLAIMS.filter(k => keys.indexOf(k) < 0);
  const mistagged = claims.filter(k => !tagsOf(en[k]).isPrivacy);
  const findings = [];
  const missing = [];
  let examined = 0;
  let unverified = 0;

  for (const b of built) {
    if (b.locale === SOURCE_LOCALE) continue;
    if (baseLanguage(b.locale) === SOURCE_LOCALE) continue;   // an en variant IS English
    for (const key of claims) {
      const entry = b.catalogue[key];
      if (!entry) continue;
      if (entry.message === en[key].message) continue;      // untranslated: nothing to verify
      const back = backTranslate(entry.message, b.locale, key);
      if (back == null) { unverified++; missing.push(b.locale + '/' + key); continue; }
      examined++;
      findings.push(...checkNegationPolarity(key, b.locale, en[key].message, back));
    }
  }
  return { privacy, claims, orphans, mistagged, findings, examined, unverified, missing };
}

/* ==================================================================== */
/* SELF-TEST — the check has to be seen to bite                         */
/* ==================================================================== */

/* A gate nobody has watched fail is not a gate. This runs the negation checker
   against fixtures with a KNOWN answer, so `--self-test` proves the thing works
   without needing a network, a model or a locale file. test/i18n-sim.node.js
   shells out to it. */
function selfTest() {
  const EN = 'Off by default. When on, results are stored on this device only, listed below, and deletable at any time.';
  const cases = [
    { name: 'a faithful back-translation raises nothing',
      en: EN,
      back: 'Disabled by default. When enabled, results are kept on this device only, shown below, and can be deleted at any time.',
      expect: 'none' },
    { name: 'a DROPPED negation is a hard flag',
      en: 'Works entirely on your device: no accounts, no tracking, no network calls.',
      back: 'Works on your device and uses accounts, tracking and network calls.',
      expect: 'hard' },
    { name: 'an INVENTED negation is a hard flag',
      en: 'Removes every stored row from this device. Settings are kept.',
      back: 'Removes every stored row from this device. Settings are not kept.',
      expect: 'hard' },
    { name: 'a partial loss of negations is a soft flag',
      en: 'Works entirely on your device: no accounts, no tracking, no network calls.',
      back: 'Works entirely on your device: no accounts, and it tracks nothing, and uses the network.',
      expect: 'soft' },
    { name: 'a contraction counts as a negation',
      en: 'Nothing leaves it.',
      back: "It doesn't leave the device.",
      expect: 'none' }
  ];

  let bad = 0;
  for (const c of cases) {
    const found = checkNegationPolarity('fixture', 'xx', c.en, c.back);
    const got = found.length === 0 ? 'none' : found[0].severity;
    const ok = got === c.expect;
    if (!ok) bad++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + c.name + '  — expected ' + c.expect + ', got ' + got);
  }

  /* And the null path: no back-translator wired must never look like a pass. */
  const nullFindings = checkNegationPolarity('fixture', 'xx', 'no accounts', null);
  const nullOk = nullFindings.length === 0;
  console.log((nullOk ? 'PASS' : 'FAIL') + '  a missing back-translator produces no findings (and is reported as UNVERIFIED, never as verified)');
  if (!nullOk) bad++;

  console.log('\n' + (cases.length + 1) + ' checks');
  console.log(bad ? 'FAILURES: ' + bad : 'ALL PASS');
  return bad ? 1 : 0;
}

/* ==================================================================== */
/* MAIN                                                                 */
/* ==================================================================== */

async function main() {
  const argv = process.argv.slice(2);
  const CHECK = argv.indexOf('--check') >= 0;
  const TODO = argv.indexOf('--todo') >= 0;
  if (argv.indexOf('--self-test') >= 0) process.exit(selfTest());

  let en;
  try { en = JSON.parse(fs.readFileSync(localeFile(SOURCE_LOCALE), 'utf8')); }
  catch (e) {
    console.error('cannot read the source catalogue ' + localeFile(SOURCE_LOCALE) + ': ' + e.message);
    process.exit(1);
  }
  const keys = Object.keys(en);

  const missingDescriptions = keys.filter(k => !en[k] || typeof en[k].description !== 'string' || !en[k].description.trim());
  if (missingDescriptions.length) {
    console.error('every message in _locales/en needs a `description` written FOR THE TRANSLATOR. Missing: ' + missingDescriptions.join(', '));
    process.exit(1);
  }

  /* THE SOURCE LOCALE IS NEVER GENERATED. It is hand-authored, and its
     `description` fields are translator notes, not the "en: …" provenance
     stamp the generated files carry. An earlier version of this script wrote
     _locales/en back through the same path as every other locale and silently
     replaced all 70 translator notes with the provenance stamp — the source of
     truth overwritten by its own output. It is excluded here, by construction,
     and the gate below asserts the exclusion held. */
  const TARGETS = LOCALES.filter(l => l !== SOURCE_LOCALE);
  const built = [{ locale: SOURCE_LOCALE, catalogue: en, todo: [], stale: [] }];
  for (const locale of TARGETS) built.push(await buildLocale(locale, en, keys));

  const enBefore = fs.readFileSync(localeFile(SOURCE_LOCALE), 'utf8');

  /* THE GUARD RUNS BEFORE THE FIRST BYTE IS WRITTEN, and it runs in --check too
     — a CI job that cannot see the destruction coming is a CI job that reports
     it after the fact. */
  const casualties = guardDestructiveWrites(en, keys, built);
  if (casualties.length) {
    reportDestructiveWrites(casualties);
    console.log('FAILURES: ' + casualties.length);
    process.exit(1);
  }

  /* Write (or, in --check, compare). */
  let written = 0, drifted = [];
  for (const b of built) {
    if (b.locale === SOURCE_LOCALE) continue;
    const text = serialise(b.catalogue);
    const file = localeFile(b.locale);
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch (_) {}
    if (current === text) continue;
    if (CHECK) { drifted.push(b.locale); continue; }
    fs.mkdirSync(localeDir(b.locale), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    written++;
  }

  const { fails, warns } = runGates(en, keys, built);
  const bt = runBackTranslationCheck(en, keys, built);

  /* The exclusion above, asserted rather than trusted. */
  if (fs.readFileSync(localeFile(SOURCE_LOCALE), 'utf8') !== enBefore) {
    fails.push('_locales/' + SOURCE_LOCALE + '/messages.json was rewritten — the hand-authored source must never be generated');
  }

  console.log('=== locales ===');
  console.log('source          _locales/' + SOURCE_LOCALE + '/messages.json — ' + keys.length + ' messages');
  console.log('locales         ' + LOCALES.length + ' (' + LOCALES.filter(isRtl).join(', ') + ' are RTL)');
  console.log(CHECK
    ? 'mode            --check (nothing written)'
    : 'written         ' + written + ' file(s) changed, ' + (TARGETS.length - written) + ' already up to date  (the source locale is never written)');

  const fullyTranslated = built.filter(b => b.todo.length === 0).length;
  console.log('translated      ' + fullyTranslated + '/' + LOCALES.length + ' locales complete');

  console.log('\n=== back-translation (privacy claims only) ===');
  console.log('privacy keys    ' + bt.privacy.length + ' of ' + keys.length + ' carry the [privacy] tag');
  console.log('claim set       ' + bt.claims.length + ' of those are back-translated — ' + bt.claims.join(', '));
  console.log('examined        ' + bt.examined + ' round trip(s)');
  console.log('WHAT A GREEN RUN HERE MEANS: the negations in ' + bt.claims.length + ' privacy sentences survived the');
  console.log('round trip in the locales listed. It is NOT a fluency review, it is NOT a review of');
  console.log('the other ' + (bt.privacy.length - bt.claims.length) + ' privacy strings, and it is not an independent witness — the same family');
  console.log('of model wrote both directions and can misread a sentence the same way twice. What');
  console.log('survives that objection is mechanical: polarity is counted from a closed lexicon of');
  console.log('negation words, so a negation that is GONE is caught no matter who wrote the text.');
  if (bt.orphans.length) fails.push('the claim set names ' + bt.orphans.length + ' key(s) that are not in _locales/en: ' + bt.orphans.join(', '));
  if (bt.mistagged.length) fails.push('the claim set names ' + bt.mistagged.length + ' key(s) that are not tagged [privacy]: ' + bt.mistagged.join(', '));
  if (bt.unverified) {
    console.log('UNVERIFIED      ' + bt.unverified + ' translated claim(s) have no entry in _locales/backtranslations.json — ' +
      bt.missing.slice(0, 4).join(', ') + (bt.missing.length > 4 ? ', …' : ''));
    console.log('                That is REPORTED, not passed. Fill them before a store submission.');
  }
  for (const f of bt.findings) {
    console.log((f.severity === 'hard' ? 'FLAG  ' : 'REVIEW') + '  ' + f.locale + '/' + f.key +
      '  — ' + f.why + ' (en had ' + f.want + ' negation(s), the round trip had ' + f.got + ')');
  }
  if (!bt.findings.length && bt.examined) console.log('no negation was dropped or inverted');
  console.log('nothing is auto-corrected: a dropped negation is re-translated by hand, never patched by word count');

  if (TODO) {
    console.log('\n=== untranslated ===');
    for (const b of built) {
      if (!b.todo.length) continue;
      console.log(b.locale.padEnd(8) + b.todo.length + '  ' + b.todo.join(' '));
    }
  }

  console.log('');
  for (const w of warns) console.log('note   ' + w);
  for (const d of drifted) console.log('DRIFT  ' + d + '/messages.json is not what the generator would write — run without --check');
  for (const f of fails) console.log('FAIL   ' + f);
  const hard = bt.findings.filter(f => f.severity === 'hard');
  for (const f of hard) console.log('FAIL   ' + f.locale + '/' + f.key + ' — negation polarity changed');

  const bad = fails.length + drifted.length + hard.length;
  console.log('\n' + (bad ? 'FAILURES: ' + bad : 'ALL PASS'));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e && e.stack || e); console.log('\nFAILURES: 1'); process.exit(1); });
