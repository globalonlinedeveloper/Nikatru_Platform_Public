#!/usr/bin/env node
/* ============================================================================
   FullShot — LOCALE GENERATOR

   *** BUILD-TIME ONLY.  THIS FILE IS NEVER SHIPPED AND MAKES NO NETWORK CALL. ***

   FullShot ships with ZERO network calls.  That is a product promise, and this
   script does not weaken it: it is a developer tool, it runs on a workstation,
   it reads and writes local files, and it is excluded from the package by the
   allowlist in publish/package.node.js (the `_locales` rule accepts only files
   literally named `messages.json`).  If you are auditing the extension for
   network access, you can stop reading here — there is no fetch, no http, no
   XMLHttpRequest and no child process in this file or anything it imports.

   WHAT IT DOES
     Reads   _locales/en/messages.json   (the hand-authored source of truth)
             i18n/locales.mjs            (the 55 Chrome Web Store locales)
             i18n/plurals.mjs            (which keys are counts, declared by hand)
             i18n/tm/<code>.json         (the translation memory — see below)
             i18n/tm/_source.json        (the English each translation was made from)
     Writes  _locales/<code>/messages.json  for all 54 non-source locales.

   RE-RUNNABLE AND IDEMPOTENT
     Running it twice produces byte-identical files.  Change one English string
     and re-run, and every locale is rebuilt in the same pass — no locale is
     left holding a stale copy, because no locale file is ever hand-edited.
     The one thing a rebuild CANNOT do by itself is invent the new translation,
     so the English text each entry was translated from is fingerprinted in
     i18n/tm/_source.json.  When the fingerprint stops matching, that entry is
     reported STALE, the English is emitted in its place so the product still
     renders, and `--report` tells you exactly which (locale, key) pairs a
     translator has to revisit.  Silence is never mistaken for coverage.

   WHERE TRANSLATIONS COME FROM, AND HOW TO REDO ONE
     One function: translate().  See the banner above it.  It is a pure lookup
     into the translation memory — deliberately, so that the generator is
     deterministic and reviewable, and the act of translating is a separate,
     auditable step that produces a diffable JSON file.  `--request` prints the
     exact work order for the next translation pass.

   IT WILL REFUSE TO DESTROY A TRANSLATION
     Because every non-English string comes from the translation memory and from
     nowhere else, a locale whose messages.json is translated but whose memory is
     absent or incomplete would rebuild as ENGLISH.  That is silent data loss,
     and it is not hypothetical: thirty-eight locales were shipped correctly
     translated with no memory behind them, one routine run away from erasure.
     The guard below refuses any build that would replace translated text with
     English fallback, names the locales and keys, and writes nothing at all.
     See THE GUARD, further down, for the exact rule and its two deliberate
     exemptions.  `--adopt` is the way out: it records what is already on disk
     into the memory, so the generator can reproduce it.

   USAGE
     node _locales/make-locales.mjs              build every locale
     node _locales/make-locales.mjs --check      build in memory, diff against
                                                 disk, exit 1 on any drift
     node _locales/make-locales.mjs --report     coverage + staleness table
     node _locales/make-locales.mjs --request    work order: every (locale,key)
                                                 with no usable translation
     node _locales/make-locales.mjs --privacy    run the back-translation
                                                 negation check and print flags
     node _locales/make-locales.mjs --adopt      transcribe the text already on
                                                 disk into the translation
                                                 memory, so a build reproduces
                                                 it instead of erasing it
     node _locales/make-locales.mjs --locale=de  restrict to one locale
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LOCALES, BY_CODE, chain } from '../i18n/locales.mjs';
import { PLURAL_BASES, SUFFIX, PLURAL_COUNT_TOKEN, categoriesFor, isEnglishPluralKey, splitPluralKey, sourceKeyFor } from '../i18n/plurals.mjs';
import { CLAIMS, PRIVACY_KEYS, checkBackTranslation } from '../i18n/backtranslation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');
const TM_DIR = path.join(ROOT, 'i18n', 'tm');
const BT_DIR = path.join(ROOT, 'i18n', 'backtranslations');
const SOURCE_MAP = path.join(TM_DIR, '_source.json');

/* ---------------------------------------------------------------- helpers */

export function fingerprint(text) {
  return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex').slice(0, 8);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) { throw new Error('malformed JSON in ' + path.relative(ROOT, file) + ': ' + e.message); }
}

/* The $TOKEN$ names a message actually uses, lower-cased, in order. */
export function tokensUsed(message) {
  const out = [];
  const re = /\$([A-Za-z0-9_]+)\$/g;
  let m;
  while ((m = re.exec(String(message)))) out.push(m[1].toLowerCase());
  return out;
}

/* ------------------------------------------------------------ load inputs */

export function loadEnglish() {
  const en = readJson(path.join(LOCALES_DIR, 'en', 'messages.json'), null);
  if (!en) throw new Error('_locales/en/messages.json is missing — it is the source of truth');
  return en;
}

function loadTm(code) {
  return readJson(path.join(TM_DIR, code + '.json'), null);
}

/* ============================================================================
   THE TRANSLATION STEP
   ============================================================================
   This is the ONLY place a non-English string enters the build.  Everything
   else in this file is mechanical: plural expansion, placeholder copying, byte
   layout.  Keep it that way.

   Translations are AI-produced and stored, per the owner's decision, without a
   manual review gate.  They live in i18n/tm/<locale>.json as a flat
   { key: "translated text" } map so that a diff of a translation pass is
   readable by someone who does not read the language: the keys are English and
   the shape of the file is stable.

   TO REDO ONE TRANSLATION
     1. `node _locales/make-locales.mjs --request` — prints every (locale, key)
        that is missing or stale, with the current English and the placeholder
        tokens that must survive.
     2. Produce the new text.  Copy every $TOKEN$ through verbatim; the token
        names are English and are NOT translated.  Where a token's declared
        content is a literal (a keyboard letter, a URL, "PNG"), it is a
        do-not-translate token and the placeholder is what keeps a translator
        from touching it.
     3. Write it into i18n/tm/<locale>.json.
     4. Update the fingerprint for that key in i18n/tm/_source.json (or run
        `--accept-source` after changing English, which rewrites the whole map).
     5. Re-run the generator.  Re-run test/i18n-sim.node.js.

   TO RETRANSLATE EVERYTHING AFTER AN ENGLISH CHANGE
     Change the English, re-run, and every locale rebuilds in one pass.  The
     entries whose English moved are reported STALE and fall back to English
     until they are redone — they are never silently left showing the OLD
     translation of a sentence that no longer exists.

   The chain lookup lets a regional locale carry only its deltas: en_GB holds
   the ~20 keys where British spelling differs and inherits the rest from en;
   en_AU inherits from en_GB; es_419 from es; pt_PT from pt_BR.  A COMPLETE file
   is still materialised for each, so nothing depends on the browser's own
   locale fallback.
   ========================================================================== */
export const SAME_AS_ENGLISH = '=';

export function translate(code, key, ctx) {
  for (const link of chain(code)) {
    /* Reaching `en` means an English-family locale (en_US, en_GB, en_AU) ran out
       of deltas. English IS its translation, and that is a complete answer, not
       a gap — so it resolves rather than falling through to "missing". No other
       locale's chain contains `en`. */
    if (link === 'en') {
      const src = ctx.en[sourceKeyFor(key)];
      return src ? { text: src.message, from: 'en' } : null;
    }
    const tm = ctx.tm[link];
    if (!tm) continue;
    const t = tm[key];
    if (typeof t !== 'string' || !t.length) continue;
    /* "=" means DELIBERATELY identical to English: a product name, "PDF", "A4",
       a size letter. Distinguishing it from "not translated yet" is the whole
       point — otherwise a locale that legitimately keeps 30 English tokens is
       indistinguishable from one that is 30 entries behind. */
    if (t === SAME_AS_ENGLISH) {
      const src = ctx.en[sourceKeyFor(key)];
      return src ? { text: src.message, from: link + ' (=en)' } : null;
    }
    return { text: t, from: link };
  }
  return null;
}

/* ------------------------------------------------------- build one locale */

/* Every message key a locale must carry.  Non-count keys match English exactly.
   Count keys are replaced by that locale's OWN CLDR categories, so `ja` carries
   one form where `ar` carries six. */
export function expectedKeys(code, en) {
  const loc = BY_CODE.get(code);
  const out = [];
  for (const k of Object.keys(en)) {
    if (isEnglishPluralKey(k)) {
      const sp = splitPluralKey(k);
      if (sp.category !== 'one') continue;          // expand once, at the "One" slot
      for (const cat of categoriesFor(loc.bcp47)) out.push(sp.base + SUFFIX[cat]);
      continue;
    }
    out.push(k);
  }
  return out;
}

export function buildLocale(code, ctx) {
  const en = ctx.en;
  const loc = BY_CODE.get(code);
  const out = {};
  const notes = { missing: [], stale: [], placeholderMismatch: [], translated: 0, fallback: 0 };

  for (const key of expectedKeys(code, en)) {
    const srcKey = sourceKeyFor(key);
    const enEntry = en[srcKey];
    if (!enEntry) throw new Error(code + ': no English source for ' + key + ' (looked up ' + srcKey + ')');

    const recordedFp = ctx.sourceMap[srcKey];
    const currentFp = fingerprint(enEntry.message);
    const hit = translate(code, key, ctx);

    let text;
    if (!hit) {
      notes.missing.push(key);
      text = enEntry.message;                        // English fallback: never ship an empty string
      notes.fallback++;
    } else if (recordedFp && recordedFp !== currentFp) {
      notes.stale.push({ key, was: recordedFp, now: currentFp });
      text = enEntry.message;                        // the translation is of a sentence that no longer exists
      notes.fallback++;
    } else {
      text = hit.text;
      notes.translated++;
    }

    /* Placeholders are NEVER taken from the translation memory. They are copied
       from English verbatim, so a translator cannot corrupt the $1 wiring or
       drop a do-not-translate literal even in principle. What IS verified is
       that the translated text still SPENDS every token English spends. */
    const entry = { message: text };
    if (enEntry.placeholders) {
      entry.placeholders = JSON.parse(JSON.stringify(enEntry.placeholders));
      const want = new Set(Object.keys(enEntry.placeholders).map(s => s.toLowerCase()));
      const got = new Set(tokensUsed(text));
      /* Inside a plural form the count placeholder is optional — see the note
         on PLURAL_COUNT_TOKEN in i18n/plurals.mjs. Arabic's dual is the case
         that forced this: "لقطتان" already MEANS "two screenshots". */
      const countOptional = splitPluralKey(key) != null;
      const missing = [...want].filter(t => !got.has(t) && !(countOptional && t === PLURAL_COUNT_TOKEN));
      const extra = [...got].filter(t => !want.has(t));
      if (missing.length || extra.length) {
        notes.placeholderMismatch.push({ key, missing, extra });
      }
    } else {
      const extra = tokensUsed(text);
      if (extra.length) notes.placeholderMismatch.push({ key, missing: [], extra });
    }
    out[key] = entry;
  }

  /* Descriptions are deliberately NOT emitted. Chrome ignores `description` at
     runtime; it exists for translators. The English file's descriptions are
     40 KB — carrying them into 54 locales would add ~2.2 MB of dead weight to
     every store upload for zero user-visible effect. */
  return { code, loc, messages: out, notes };
}

export function serialize(messages) {
  return JSON.stringify(messages, null, 2) + '\n';
}

/* ============================================================================
   THE GUARD — the generator may not replace a translation with English
   ============================================================================
   buildLocale() emits English fallback whenever it has nothing else to emit.
   That is the right behaviour for a locale nobody has translated yet, and the
   WRONG behaviour for a locale that is already translated on disk and whose
   memory has gone missing — there the fallback overwrites correct text with
   English, in the same silent pass that was meant to update one string.

   THE RULE IS REPLACEMENT, NOT ABSENCE.
   A key is a casualty when all three hold:
     1. the locale on disk holds real translated content (below),
     2. the generator has NO translation for that key (notes.missing), and
     3. the text on disk is not already the English.
   Any casualty aborts the whole build before a single byte is written.

   TWO EXEMPTIONS, BOTH DELIBERATE.
     * An untranslated locale rebuilding.  English replacing English is not a
       loss, and blocking it would freeze every locale that has not been started.
     * A STALE entry falling back.  When the English moves, the old translation
       is of a sentence that no longer exists; emitting the new English is the
       designed behaviour documented above.  Treating that as data loss would
       mean no English string could ever be edited again while any locale lagged.
       Staleness is therefore excluded here and reported by --report instead.

   WHY A THRESHOLD FOR "HOLDS A TRANSLATION", AND WHY IT IS SAFE.
   A file that is pure English fallback is indistinguishable from a translation
   into a language that happens to agree with English, so this asks how much of
   the file diverges from English rather than trying to identify a language —
   the same majority rule test/i18n-sim.node.js uses, and for the same reason:
   a locale legitimately keeps a handful of English tokens ("PDF", "A4", "Format")
   but never most of them.  The threshold only decides whether a locale is
   PROTECTED; it never decides what to write.  Erring either way is safe by
   construction — a protected locale that turns out to be English merely forces
   an explicit `--adopt`, and an unprotected locale is one where, by definition,
   there is almost nothing to lose. */

export function localeHoldsTranslation(onDisk, en) {
  if (!onDisk || typeof onDisk !== 'object') return false;
  let graded = 0, diverges = 0;
  for (const [key, entry] of Object.entries(onDisk)) {
    const src = en[sourceKeyFor(key)];
    if (!src || !entry || typeof entry.message !== 'string') continue;
    graded++;
    if (entry.message !== src.message) diverges++;
  }
  return graded > 0 && diverges * 2 > graded;
}

/* Keys the generator cannot reproduce and would therefore overwrite with
   English.  Empty means the build is safe to write. */
export function lostTranslations(built, onDisk, en) {
  return unreproducible(built, onDisk, en).filter(key => onDisk[key].message !== en[sourceKeyFor(key)].message);
}

/* Everything a protected locale carries that the memory cannot reproduce —
   the casualties above PLUS the entries that coincidentally equal English.
   --adopt transcribes this whole set, because a memory that reproduces all but
   nine keys still leaves the file drifting from a fresh build. */
export function unreproducible(built, onDisk, en) {
  if (!localeHoldsTranslation(onDisk, en)) return [];
  const noTranslation = new Set(built.notes.missing);
  const out = [];
  for (const key of Object.keys(built.messages)) {
    if (!noTranslation.has(key)) continue;
    const entry = onDisk[key];
    if (!entry || typeof entry.message !== 'string' || !entry.message.length) continue;
    out.push(key);
  }
  return out;
}

/* ------------------------------------------------------------------ main */

function loadContext() {
  const en = loadEnglish();
  const sourceMap = readJson(SOURCE_MAP, {});
  const tm = {};
  for (const l of LOCALES) {
    if (l.source) continue;
    const t = loadTm(l.code);
    if (t) tm[l.code] = t;
  }
  return { en, sourceMap, tm };
}

function targets(argv) {
  const only = (argv.find(a => a.startsWith('--locale=')) || '').split('=')[1];
  const list = LOCALES.filter(l => !l.source);
  return only ? list.filter(l => l.code === only) : list;
}

function main() {
  const argv = process.argv.slice(2);
  const mode =
    argv.includes('--check') ? 'check' :
    argv.includes('--report') ? 'report' :
    argv.includes('--request') ? 'request' :
    argv.includes('--privacy') ? 'privacy' :
    argv.includes('--adopt') ? 'adopt' :
    argv.includes('--accept-source') ? 'accept' : 'build';

  const ctx = loadContext();

  if (mode === 'accept') {
    const map = {};
    for (const k of Object.keys(ctx.en)) map[k] = fingerprint(ctx.en[k].message);
    fs.mkdirSync(TM_DIR, { recursive: true });
    fs.writeFileSync(SOURCE_MAP, JSON.stringify(map, null, 2) + '\n');
    console.log('wrote ' + Object.keys(map).length + ' English fingerprints to i18n/tm/_source.json');
    return 0;
  }

  if (mode === 'privacy') return runPrivacy(ctx);

  const list = targets(argv);
  let drift = 0, problems = 0;
  const rows = [];

  /* EVERY locale is built in memory before ANY locale is written. The guard has
     to see the whole run before it can let the run proceed; writing as we go
     would leave the tree half-overwritten by the locale that trips it. */
  const pending = [];
  for (const l of list) {
    const built = buildLocale(l.code, ctx);
    const file = path.join(LOCALES_DIR, l.code, 'messages.json');
    const onDiskText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    let onDisk = null;
    if (onDiskText != null) { try { onDisk = JSON.parse(onDiskText); } catch (_) { onDisk = null; } }
    pending.push({ l, built, text: serialize(built.messages), file, onDiskText, onDisk });
  }

  if (mode === 'adopt') return runAdopt(pending, ctx);

  const casualties = [];
  for (const p of pending) {
    const lost = lostTranslations(p.built, p.onDisk, ctx.en);
    if (lost.length) casualties.push({ code: p.l.code, lost });
  }
  if (casualties.length && (mode === 'build' || mode === 'check')) {
    for (const c of casualties) {
      console.log('REFUSED  ' + c.code + '  — ' + c.lost.length + ' translated entr' + (c.lost.length === 1 ? 'y' : 'ies') +
        ' would be replaced by English: ' + c.lost.slice(0, 5).join(', ') + (c.lost.length > 5 ? ' +' + (c.lost.length - 5) + ' more' : ''));
    }
    console.log('\n' + casualties.length + ' locale(s) hold translated text this generator cannot reproduce.');
    console.log('NOTHING WAS WRITTEN. Their translation memory is missing or incomplete, so a build');
    console.log('would overwrite correct translations with English fallback.');
    console.log('  · to keep what is on disk:   node _locales/make-locales.mjs --adopt');
    console.log('  · to see the work order:     node _locales/make-locales.mjs --request');
    console.log('If a locale really is meant to revert to English, delete its messages.json and rebuild.');
    return 1;
  }

  for (const p of pending) {
    const { l, text, file, onDiskText } = p;
    if (mode === 'build') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (onDiskText !== text) fs.writeFileSync(file, text);
    } else if (mode === 'check') {
      if (onDiskText !== text) { drift++; console.log('DRIFT  ' + l.code + '  — on-disk file does not match a fresh build'); }
    }

    const built = p.built;
    const n = built.notes;
    if (n.placeholderMismatch.length) problems += n.placeholderMismatch.length;
    rows.push({
      code: l.code, dir: l.dir, total: Object.keys(built.messages).length,
      cats: categoriesFor(l.bcp47).length,
      translated: n.translated, missing: n.missing.length, stale: n.stale.length,
      ph: n.placeholderMismatch, missingKeys: n.missing, staleKeys: n.stale
    });
  }

  if (mode === 'request') {
    const en = ctx.en;
    let count = 0;
    for (const r of rows) {
      const need = [...r.missingKeys, ...r.staleKeys.map(s => s.key)];
      if (!need.length) continue;
      console.log('\n### ' + r.code + '  (' + need.length + ' entries, ' + r.cats + ' plural categories)');
      for (const k of need) {
        const src = sourceKeyFor(k);
        const toks = tokensUsed(en[src].message);
        console.log('  ' + k.padEnd(32) + JSON.stringify(en[src].message) + (toks.length ? '   tokens: ' + toks.map(t => '$' + t.toUpperCase() + '$').join(' ') : ''));
        count++;
      }
    }
    console.log('\nwork order: ' + count + ' entries across ' + rows.filter(r => r.missingKeys.length || r.staleKeys.length).length + ' locales');
    return 0;
  }

  /* summary */
  const complete = rows.filter(r => r.missing === 0 && r.stale === 0);
  console.log('\nlocale  dir  keys  cats  translated  missing  stale  placeholder');
  for (const r of rows) {
    console.log(
      r.code.padEnd(7) + r.dir.padEnd(5) + String(r.total).padEnd(6) + String(r.cats).padEnd(6) +
      String(r.translated).padEnd(12) + String(r.missing).padEnd(9) + String(r.stale).padEnd(7) +
      (r.ph.length ? 'MISMATCH x' + r.ph.length : 'ok')
    );
    for (const p of r.ph) console.log('        ! ' + p.key + '  missing[' + p.missing.join(',') + '] extra[' + p.extra.join(',') + ']');
  }
  console.log('\n' + complete.length + '/' + rows.length + ' locales fully translated · ' +
    rows.reduce((a, r) => a + r.missing, 0) + ' missing entries · ' +
    rows.reduce((a, r) => a + r.stale, 0) + ' stale entries · ' + problems + ' placeholder problems');

  if (mode === 'check') {
    if (drift) console.log('\n' + drift + ' locale(s) DRIFTED — run the generator');
    return (drift || problems) ? 1 : 0;
  }
  return problems ? 1 : 0;
}

/* ============================================================================
   --adopt — record what is already shipping, so the generator can reproduce it
   ============================================================================
   The remedy the guard points at.  It TRANSCRIBES: for every entry a protected
   locale carries that the memory cannot reproduce, it copies the text out of
   _locales/<code>/messages.json and into i18n/tm/<code>.json, verbatim.

   IT IS NOT A TRANSLATOR AND MAKES NO JUDGEMENT.
     * It never overwrites an existing memory entry.  It only fills holes, so
       running it can lose nothing.
     * It never writes SAME_AS_ENGLISH ("=").  Where the shipped text happens to
       equal the English, the English literal is transcribed instead, because
       "=" asserts that a human DECIDED to keep the English — an intent this
       tool cannot read off a file.  Both spellings build byte-identically; only
       one of them makes a claim, so this tool makes neither.
     * It refuses a locale that does not already hold real translated content,
       so it can never be used to launder a file of English fallback into a
       memory that then reports as a complete translation.
   The result is a faithful transcript of the artifact.  It adds no new claim
   about any language: whatever the shipped file said before, it still says. */
function runAdopt(pending, ctx) {
  let touched = 0, entries = 0;
  const declined = [];
  for (const p of pending) {
    const take = unreproducible(p.built, p.onDisk, ctx.en);
    if (!take.length) {
      if (p.built.notes.missing.length && p.onDisk) declined.push(p.l.code);
      continue;
    }
    const file = path.join(TM_DIR, p.l.code + '.json');
    const tm = readJson(file, {});
    for (const key of take) tm[key] = p.onDisk[key].message;   // holes only: `take` is what the memory could not answer

    /* Emit in the order the generator asks for the keys, so a memory diffs
       against its siblings and against the English file line for line. */
    const ordered = {};
    for (const key of expectedKeys(p.l.code, ctx.en)) if (key in tm) ordered[key] = tm[key];
    for (const key of Object.keys(tm)) if (!(key in ordered)) ordered[key] = tm[key];  // keep anything unexpected; deleting is this tool's job never

    fs.mkdirSync(TM_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n');
    console.log('adopted  ' + p.l.code.padEnd(7) + take.length + ' entr' + (take.length === 1 ? 'y' : 'ies') +
      ' transcribed from _locales/' + p.l.code + '/messages.json');
    touched++; entries += take.length;
  }
  console.log('\n' + entries + ' entries adopted into ' + touched + ' translation memor' + (touched === 1 ? 'y' : 'ies'));
  if (declined.length) {
    console.log('declined (locale is not translated on disk — nothing to adopt): ' + declined.join(' '));
  }
  console.log('Adoption records existing text. It does not translate, and every entry it wrote');
  console.log('still needs a back-translation before the privacy check can grade it.');
  return 0;
}

function runPrivacy(ctx) {
  let flagged = 0, checked = 0, absent = 0;
  const enResolved = {};
  for (const k of PRIVACY_KEYS) {
    const e = ctx.en[k];
    let t = e.message;
    for (const [n, d] of Object.entries(e.placeholders || {})) {
      t = t.split('$' + n.toUpperCase() + '$').join(String(d.content).startsWith('$') ? (d.example || n) : d.content);
    }
    enResolved[k] = t;
  }
  console.log('BACK-TRANSLATION NEGATION CHECK — privacy/permission strings only (' + PRIVACY_KEYS.length + ' keys)\n');
  for (const l of LOCALES) {
    if (l.source) continue;
    const bt = readJson(path.join(BT_DIR, l.code + '.json'), null);
    if (!bt) { absent++; continue; }
    for (const k of PRIVACY_KEYS) {
      if (!(k in bt)) { console.log('MISSING BACK-TRANSLATION  ' + l.code + '  ' + k); flagged++; continue; }
      checked++;
      const r = checkBackTranslation(k, bt[k], enResolved[k]);
      if (!r.flags.length) continue;
      flagged++;
      console.log('FLAG  ' + l.code + '  ' + k);
      console.log('      back: ' + JSON.stringify(bt[k]));
      for (const f of r.flags) console.log('      ' + f.kind + '  ' + (f.claim || '') + '\n            ' + f.detail);
    }
  }
  console.log('\n' + checked + ' back-translations graded · ' + flagged + ' FLAGGED · ' + absent + ' locale(s) with no back-translation file');
  console.log('Flags are reported, never auto-corrected. A human decides.');
  return flagged ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
