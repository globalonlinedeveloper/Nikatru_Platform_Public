#!/usr/bin/env node
/* FullShot i18n tier (no browser). Grades the GENERATED _locales tree against
   _locales/en/messages.json, the locale registry and the CLDR plural data the
   platform actually ships. This is the tier that stops a locale rotting:
   a key that vanishes, a placeholder that gets corrupted, a file that stops
   being JSON, or a privacy claim whose negation flipped in translation.

   It grades the SHIPPED ARTIFACT (_locales/<code>/messages.json), not the
   translation memory, because the artifact is what Chrome loads. Coverage of
   the translation memory is reported separately and does not fail the tier —
   an untranslated locale correctly falls back to English and is not a defect.
   What DOES fail: a locale with a translation-memory file that is only half
   done, because that is a translation pass someone abandoned. */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);

(async function main() {
  const { LOCALES, BY_CODE, chain } = await imp('i18n/locales.mjs');
  const P = await imp('i18n/plurals.mjs');
  const BT = await imp('i18n/backtranslation.mjs');
  const G = await imp('_locales/make-locales.mjs');

  const en = G.loadEnglish();
  const enKeys = Object.keys(en);
  const targets = LOCALES.filter(l => !l.source);

  /* ---- registry sanity ---- */
  console.log('\n=== registry ===');
  check('55 Chrome Web Store locales declared', LOCALES.length === 55, LOCALES.length);
  check('exactly one source locale, and it is en',
    LOCALES.filter(l => l.source).length === 1 && BY_CODE.get('en').source === true);
  check('the three RTL locales are ar, fa, he',
    LOCALES.filter(l => l.dir === 'rtl').map(l => l.code).sort().join(',') === 'ar,fa,he',
    LOCALES.filter(l => l.dir === 'rtl').map(l => l.code).join(','));
  check('every locale code is a legal Chrome directory name',
    LOCALES.every(l => /^[a-z]{2,3}(_[A-Za-z0-9]{2,4})?$/.test(l.code)),
    LOCALES.filter(l => !/^[a-z]{2,3}(_[A-Za-z0-9]{2,4})?$/.test(l.code)).map(l => l.code).join(','));
  check('no duplicate locale codes', new Set(LOCALES.map(l => l.code)).size === 55);
  {
    let ok = true, bad = '';
    for (const l of LOCALES) { try { chain(l.code); } catch (e) { ok = false; bad = e.message; } }
    check('every inherits chain terminates (no cycles)', ok, bad);
  }
  check('every bcp47 tag resolves in Intl',
    LOCALES.every(l => { try { new Intl.PluralRules(l.bcp47); return true; } catch { return false; } }));

  /* ---- the English source itself ---- */
  console.log('\n=== english source ===');
  check('every key is a legal Chrome message name',
    enKeys.every(k => /^[A-Za-z0-9_@]+$/.test(k) && !k.startsWith('@@')),
    enKeys.filter(k => !/^[A-Za-z0-9_@]+$/.test(k) || k.startsWith('@@')).join(','));
  check('every English message is non-empty', enKeys.every(k => String(en[k].message).trim().length > 0));
  check('every declared plural base exists as <base>One and <base>Other in English',
    P.PLURAL_BASES.every(b => en[b + 'One'] && en[b + 'Other']),
    P.PLURAL_BASES.filter(b => !(en[b + 'One'] && en[b + 'Other'])).join(','));
  {
    /* The suffix trap phase 1 hit: a key ending in "One" that is not a count. */
    const suffixed = enKeys.filter(k => /One$/.test(k));
    const declared = P.PLURAL_BASES.map(b => b + 'One');
    const undeclared = suffixed.filter(k => !declared.includes(k));
    check('no key merely LOOKS like a plural form (plurals are declared, not inferred)',
      undeclared.length === 0, undeclared.join(',') || 'none');
  }

  /* ---- the privacy claim spec must not drift from the English it grades ---- */
  console.log('\n=== privacy claim spec ===');
  function resolveEn(k) {
    let t = en[k].message;
    for (const [n, d] of Object.entries(en[k].placeholders || {})) {
      t = t.split('$' + n.toUpperCase() + '$').join(String(d.content).startsWith('$') ? (d.example || n) : d.content);
    }
    return t;
  }
  check('every claim-spec key exists in the English file',
    BT.PRIVACY_KEYS.every(k => en[k]), BT.PRIVACY_KEYS.filter(k => !en[k]).join(','));
  {
    const drifted = BT.PRIVACY_KEYS.filter(k => BT.CLAIMS[k].english !== resolveEn(k));
    check('claim spec english matches the live English message (no drift)',
      drifted.length === 0, drifted.join(',') || 'none');
  }
  {
    /* Every string the inventory marked PRIVACY must be graded. A ninth privacy
       string added to messages.json with no claim entry would otherwise ship
       ungraded into 54 languages. */
    const marked = enKeys.filter(k => /PRIVACY/.test(en[k].description || ''));
    const ungraded = marked.filter(k => !BT.CLAIMS[k]);
    check('every key whose description says PRIVACY has a claim spec',
      ungraded.length === 0, ungraded.join(',') || (marked.length + ' marked, all graded'));
  }
  check('the English privacy strings grade CLEAN against themselves',
    BT.PRIVACY_KEYS.every(k => BT.checkBackTranslation(k, BT.CLAIMS[k].english, resolveEn(k)).flags.length === 0),
    BT.PRIVACY_KEYS.filter(k => BT.checkBackTranslation(k, BT.CLAIMS[k].english, resolveEn(k)).flags.length).join(','));

  /* ---- the generated tree ---- */
  console.log('\n=== generated locale files ===');
  const ctx = { en, sourceMap: JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'tm', '_source.json'), 'utf8')), tm: {} };
  for (const l of targets) {
    const f = path.join(ROOT, 'i18n', 'tm', l.code + '.json');
    if (fs.existsSync(f)) ctx.tm[l.code] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  let missingFiles = [], malformed = [], emptyMsg = [], keyGaps = [], keyExtras = [];
  let phBad = [], badNames = [], rawSubst = [], msgTag = [], drift = [], pluralBad = [], deadTm = [];
  const disk = {};

  for (const l of targets) {
    const file = path.join(ROOT, '_locales', l.code, 'messages.json');
    if (!fs.existsSync(file)) { missingFiles.push(l.code); continue; }
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) { malformed.push(l.code + ' (empty file)'); continue; }
    let m;
    try { m = JSON.parse(raw); } catch (e) { malformed.push(l.code + ': ' + e.message); continue; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length === 0) {
      malformed.push(l.code + ' (not a non-empty object)'); continue;
    }
    disk[l.code] = m;

    /* key parity, plural-aware */
    const want = G.expectedKeys(l.code, en);
    const got = Object.keys(m);
    const gaps = want.filter(k => !(k in m));
    const extras = got.filter(k => !want.includes(k));
    if (gaps.length) keyGaps.push(l.code + ': ' + gaps.slice(0, 6).join(',') + (gaps.length > 6 ? ' +' + (gaps.length - 6) : ''));
    if (extras.length) keyExtras.push(l.code + ': ' + extras.slice(0, 6).join(','));

    /* plural categories match this locale's own CLDR data */
    for (const base of P.PLURAL_BASES) {
      const expect = P.pluralKeysFor(base, l.bcp47).sort().join(',');
      const actual = got.filter(k => { const sp = P.splitPluralKey(k); return sp && sp.base === base; }).sort().join(',');
      if (expect !== actual) pluralBad.push(l.code + '/' + base + ' want[' + expect + '] got[' + actual + ']');
    }

    for (const [k, v] of Object.entries(m)) {
      if (!/^[A-Za-z0-9_@]+$/.test(k) || k.startsWith('@@')) badNames.push(l.code + ':' + k);
      if (!v || typeof v.message !== 'string' || !v.message.trim()) { emptyMsg.push(l.code + ':' + k); continue; }
      if (/\$\d/.test(v.message)) rawSubst.push(l.code + ':' + k);
      if (/__MSG_/.test(v.message)) msgTag.push(l.code + ':' + k);

      const srcKey = P.sourceKeyFor(k);
      const enPh = (en[srcKey] || {}).placeholders;
      const want2 = new Set(Object.keys(enPh || {}).map(s => s.toLowerCase()));
      const got2 = new Set(G.tokensUsed(v.message));
      const countOptional = P.splitPluralKey(k) != null;
      const miss = [...want2].filter(t => !got2.has(t) && !(countOptional && t === P.PLURAL_COUNT_TOKEN));
      const extra = [...got2].filter(t => !want2.has(t));
      if (miss.length || extra.length) phBad.push(l.code + ':' + k + ' missing[' + miss + '] extra[' + extra + ']');

      /* the placeholders block must be byte-identical to English: it is copied,
         never translated, so any divergence means someone hand-edited output */
      const mine = JSON.stringify(v.placeholders || null);
      const theirs = JSON.stringify(enPh || null);
      if (mine !== theirs) phBad.push(l.code + ':' + k + ' placeholders block differs from English');
    }

    /* the file on disk must equal a fresh build (generator is the only author) */
    const fresh = G.serialize(G.buildLocale(l.code, ctx).messages);
    if (fresh !== raw) drift.push(l.code);

    /* dead translation-memory entries: a key nobody will ever ask for is a typo */
    const tm = ctx.tm[l.code];
    if (tm) {
      const dead = Object.keys(tm).filter(k => !k.startsWith('_') && !want.includes(k));
      if (dead.length) deadTm.push(l.code + ': ' + dead.join(','));
    }
  }

  check('every non-source locale has a messages.json on disk', missingFiles.length === 0, missingFiles.join(',') || '54/54');
  check('no locale file is empty or malformed JSON', malformed.length === 0, malformed.join(' | ') || '54 parsed');
  check('every locale has EVERY key the English file has', keyGaps.length === 0, keyGaps.join(' | ') || 'no gaps');
  check('no locale has a key English does not account for', keyExtras.length === 0, keyExtras.join(' | ') || 'no extras');
  check('no message is empty', emptyMsg.length === 0, emptyMsg.slice(0, 8).join(',') || 'none');
  check('every message name is a legal Chrome key', badNames.length === 0, badNames.slice(0, 8).join(',') || 'all legal');
  check('no locale has an extra or missing placeholder', phBad.length === 0, phBad.slice(0, 8).join(' | ') || 'all match English');
  check('no raw $1..$n substitution leaked into a message body', rawSubst.length === 0, rawSubst.slice(0, 8).join(',') || 'none');
  check('no __MSG_ tag leaked into a message body', msgTag.length === 0, msgTag.slice(0, 8).join(',') || 'none');
  check('plural keys match each locale\'s OWN CLDR categories', pluralBad.length === 0, pluralBad.slice(0, 5).join(' | ') || 'ja=1 de=2 fr=3 ru=4 ar=6, all as ICU says');
  check('on-disk files equal a fresh build (generator is idempotent)', drift.length === 0, drift.join(',') || '54 byte-identical');
  check('no dead entries in any translation memory', deadTm.length === 0, deadTm.slice(0, 4).join(' | ') || 'none');

  /* ---- the generator cannot destroy a translation ----
     THE HAZARD THIS SECTION EXISTS FOR, in the exact shape it was found in.
     buildLocale() sources every non-English string from i18n/tm/<code>.json and
     from nowhere else. A locale whose messages.json holds real translated text
     but whose translation memory is absent or incomplete therefore rebuilds as
     ENGLISH — silently, in the same pass that was meant to update one string.
     Thirty-eight locales were in exactly that state: correct on disk, and one
     `node _locales/make-locales.mjs` away from being erased.

     Backfilling the memories fixes today. The guard fixes forever, which is why
     it lands first and why it is graded here rather than trusted: a memory can
     be deleted again by a bad merge, a partial checkout, or a `git clean`.

     The guard's rule is REPLACEMENT, not absence: it refuses only where the file
     on disk holds non-English text and the generator has nothing but English to
     put in its place. Two things it deliberately does NOT block, each graded
     below as a control, because a guard that blocks legitimate work gets deleted
     by the first person it inconveniences:
       * an untranslated locale rebuilding (English -> English is not a loss);
       * a STALE entry falling back to English (the sentence it translated no
         longer exists — that fallback is the designed, correct behaviour, and
         forbidding it would mean no English string could ever be edited again).
     The destructive run is ATTEMPTED for real against a throwaway copy of the
     tree, not reasoned about, because the thing being graded is what the write
     path does — not what a helper function returns. */
  console.log('\n=== the generator cannot destroy a translation ===');
  {
    const os = require('os');
    const crypto = require('crypto');
    const { spawnSync } = require('child_process');
    const md5 = s => crypto.createHash('md5').update(s).digest('hex');

    /* Everything the generator reads, for ONE locale, copied somewhere nobody
       cares about. --locale=<code> limits the run to that locale, so the other
       53 directories never need to exist. */
    function sandbox(code, mutate) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-i18n-'));
      const put = rel => {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
      };
      put(path.join('_locales', 'make-locales.mjs'));
      put(path.join('_locales', 'en', 'messages.json'));
      put(path.join('_locales', code, 'messages.json'));
      for (const f of ['locales.mjs', 'plurals.mjs', 'backtranslation.mjs']) put(path.join('i18n', f));
      put(path.join('i18n', 'tm', '_source.json'));
      if (fs.existsSync(path.join(ROOT, 'i18n', 'tm', code + '.json'))) put(path.join('i18n', 'tm', code + '.json'));
      if (mutate) mutate(dir);
      return dir;
    }
    const runGen = (dir, code, extra) => {
      const args = [path.join(dir, '_locales', 'make-locales.mjs'), '--locale=' + code].concat(extra || []);
      const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const stamp = (dir, code) => md5(fs.readFileSync(path.join(dir, '_locales', code, 'messages.json'), 'utf8'));
    const drop = dir => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };
    const enPath = dir => path.join(dir, '_locales', 'en', 'messages.json');
    const editEnglish = (dir, key, text) => {
      const e = JSON.parse(fs.readFileSync(enPath(dir), 'utf8'));
      e[key].message = text;
      fs.writeFileSync(enPath(dir), JSON.stringify(e, null, 2) + '\n');
    };
    /* Appends a key the sandbox's English file has never carried. Named zz… so
       it sorts last and can never collide with a real key. */
    const editEnglish2 = dir => {
      const e = JSON.parse(fs.readFileSync(enPath(dir), 'utf8'));
      e.zzTestOnlyNewKey = { message: 'PNG', description: 'sandbox only; never reaches the real English file' };
      fs.writeFileSync(enPath(dir), JSON.stringify(e, null, 2) + '\n');
    };

    check('the guard is exported, so this tier can grade it without a subprocess',
      typeof G.lostTranslations === 'function', typeof G.lostTranslations);

    /* THE HAZARD ITSELF: translated on disk, no translation memory at all. */
    {
      const dir = sandbox('de', d => fs.rmSync(path.join(d, 'i18n', 'tm', 'de.json')));
      const before = stamp(dir, 'de');
      const r = runGen(dir, 'de');
      const after = stamp(dir, 'de');
      check('a build that would replace a translated locale with English is REFUSED',
        r.status !== 0, 'exit ' + r.status);
      check('...and the refusal writes NOTHING — the file on disk is byte-identical',
        before === after, before === after ? 'md5 ' + before.slice(0, 12) + ' unchanged' : 'THE FILE WAS REWRITTEN');
      /* Matched against the REFUSED line specifically. An earlier draft of this
         check looked for "de" anywhere in the output and passed against a
         generator with no guard at all — the summary table happens to print the
         locale code. A check that can be satisfied by unrelated output is not a
         check. */
      check('...and it names the locale it protected, so the operator can act',
        /^REFUSED\b.*\bde\b/m.test(r.out), (r.out.match(/^REFUSED.*$/m) || ['no REFUSED line'])[0].trim().slice(0, 110));
      check('...and it names the remedy, so the operator is not left guessing',
        /--adopt/.test(r.out), /--adopt/.test(r.out) ? 'points at --adopt' : 'no remedy offered');
      drop(dir);
    }

    /* One entry lost from a memory is the same failure at a smaller scale, and
       is the shape a bad merge actually produces. */
    {
      const dir = sandbox('de', d => {
        const f = path.join(d, 'i18n', 'tm', 'de.json');
        const t = JSON.parse(fs.readFileSync(f, 'utf8'));
        delete t.optionsRedactPIIDesc;
        fs.writeFileSync(f, JSON.stringify(t, null, 2) + '\n');
      });
      const before = stamp(dir, 'de');
      const r = runGen(dir, 'de');
      const after = stamp(dir, 'de');
      check('ONE missing memory entry is enough to refuse the whole build',
        r.status !== 0 && before === after, 'exit ' + r.status + (before === after ? ', file untouched' : ', FILE REWRITTEN'));
      check('...and the refusal names the key that would have been lost',
        /optionsRedactPIIDesc/.test(r.out), /optionsRedactPIIDesc/.test(r.out) ? 'named' : 'key not named');
      drop(dir);
    }

    /* CONTROL 1 — the guard must not block a locale that has nothing to lose. */
    {
      const dir = sandbox('de', d => {
        fs.rmSync(path.join(d, 'i18n', 'tm', 'de.json'));
        /* de as it looked before anyone translated it: pure English fallback. */
        fs.writeFileSync(path.join(d, '_locales', 'de', 'messages.json'),
          G.serialize(G.buildLocale('de', { en, sourceMap: ctx.sourceMap, tm: {} }).messages));
        editEnglish(d, 'optionsLead', 'Changes are saved automatically and synced to your browser profile, promptly.');
      });
      const before = stamp(dir, 'de');
      const r = runGen(dir, 'de');
      const after = stamp(dir, 'de');
      check('CONTROL: an UNtranslated locale still rebuilds (the guard blocks loss, not progress)',
        r.status === 0 && before !== after, 'exit ' + r.status + (before !== after ? ', file updated' : ', file NOT updated'));
      drop(dir);
    }

    /* CONTROL 2 — a stale entry falling back to English is the designed
       behaviour, not data loss. If the guard blocked this, editing any English
       string would be impossible for as long as one locale lagged behind. */
    {
      const dir = sandbox('de', d => editEnglish(d, 'optionsLead',
        'Changes are saved automatically and synced to your browser profile, promptly.'));
      const before = stamp(dir, 'de');
      const r = runGen(dir, 'de');
      const after = stamp(dir, 'de');
      const rebuilt = JSON.parse(fs.readFileSync(path.join(dir, '_locales', 'de', 'messages.json'), 'utf8'));
      check('CONTROL: a STALE entry may still fall back to English (English stays editable)',
        r.status === 0 && before !== after && /promptly/.test(rebuilt.optionsLead.message),
        'exit ' + r.status + (before !== after ? ', file updated' : ', file NOT updated'));
      drop(dir);
    }

    /* CONTROL 3 — adding a NEW English key must still work. This is the most
       likely next edit anyone makes to the English file, and a guard that
       blocked it would be deleted within the week. A key absent from the locale
       file entirely is not a translation being replaced, so it is not a
       casualty: the locale gains it as English fallback and every entry it
       already had survives untouched. */
    {
      const dir = sandbox('de', d => editEnglish2(d));
      const before = JSON.parse(fs.readFileSync(path.join(dir, '_locales', 'de', 'messages.json'), 'utf8'));
      const r = runGen(dir, 'de');
      const after = JSON.parse(fs.readFileSync(path.join(dir, '_locales', 'de', 'messages.json'), 'utf8'));
      const altered = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      check('CONTROL: a NEW English key still reaches every locale, harming none',
        r.status === 0 && after.zzTestOnlyNewKey && after.zzTestOnlyNewKey.message === 'PNG' && altered.length === 0,
        'exit ' + r.status + ', ' + altered.length + ' existing entr' + (altered.length === 1 ? 'y' : 'ies') + ' altered');
      drop(dir);
    }

    /* The standing invariant. The two sandboxes above prove the guard bites;
       this proves it currently has nothing to bite — that the tree as committed
       survives a generator run. It is the check that stays red until every
       locale's translation memory can actually reproduce its file. */
    {
      const wouldLose = [];
      for (const l of targets) {
        if (!disk[l.code]) continue;
        const lost = G.lostTranslations(G.buildLocale(l.code, ctx), disk[l.code], en);
        if (lost.length) wouldLose.push(l.code + '(' + lost.length + ')');
      }
      check('running the generator right now would destroy no translation',
        wouldLose.length === 0, wouldLose.join(' ') || targets.length + ' locales reproducible from their memories');
    }
  }

  /* ---- do-not-translate tokens ---- */
  console.log('\n=== do-not-translate tokens ===');
  {
    /* A placeholder whose content is a literal (a keyboard letter, a URL, "PNG")
       is a DNT token: the placeholder is the only thing stopping a translator
       localising it. Verify the literal never appears inline INSTEAD of the
       token — that would mean the translation bypassed the lock. */
    let leaked = [];
    for (const [code, m] of Object.entries(disk)) {
      for (const [k, v] of Object.entries(m)) {
        const enPh = (en[P.sourceKeyFor(k)] || {}).placeholders || {};
        for (const [name, d] of Object.entries(enPh)) {
          const lit = String(d.content);
          if (lit.startsWith('$')) continue;                  // a real substitution, not a literal
          if (!v.message.includes('$' + name.toUpperCase() + '$')) leaked.push(code + ':' + k + '/' + name);
        }
      }
    }
    check('every literal-content DNT token is still spent as $TOKEN$', leaked.length === 0, leaked.slice(0, 8).join(',') || 'none bypassed');
  }
  {
    const keyTools = Object.keys(en).filter(k => /^editorTool/.test(k));
    const letters = keyTools.map(k => (en[k].placeholders || {}).key && en[k].placeholders.key.content).filter(Boolean);
    check('all 12 editor tool mnemonics are single literal letters',
      letters.length === 12 && letters.every(c => /^[A-Z]$/.test(c)), letters.join(''));
    let wrong = [];
    for (const [code, m] of Object.entries(disk)) {
      for (const k of keyTools) if (m[k] && m[k].placeholders.key.content !== en[k].placeholders.key.content) wrong.push(code + ':' + k);
    }
    check('no locale altered a tool mnemonic letter', wrong.length === 0, wrong.join(',') || 'all 12 identical in every locale');
  }

  /* ---- manifest localisation ---- */
  console.log('\n=== manifest ===');
  {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    check('manifest declares default_locale', mf.default_locale === 'en', String(mf.default_locale));
    const refs = new Set();
    (function walk(v) {
      if (typeof v === 'string') { const m = v.match(/__MSG_([A-Za-z0-9_@]+)__/g) || []; for (const t of m) refs.add(t.slice(6, -2)); }
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(mf);
    check('manifest spends at least the 8 known __MSG__ keys', refs.size >= 8, [...refs].sort().join(','));
    const unresolved = [];
    for (const key of refs) {
      if (!en[key]) unresolved.push('en:' + key);
      for (const [code, m] of Object.entries(disk)) if (!m[key]) unresolved.push(code + ':' + key);
    }
    check('every manifest __MSG__ key resolves in EVERY locale', unresolved.length === 0, unresolved.slice(0, 6).join(',') || (refs.size + ' keys x 55 locales'));
    const withPh = [...refs].filter(k => en[k] && en[k].placeholders);
    check('no manifest-resolved message carries a placeholder', withPh.length === 0, withPh.join(',') || 'none');
  }

  /* ---- packaging reachability (R12) ---- */
  console.log('\n=== packaging ===');
  {
    /* R12 was: the allowlist could not SEE _locales at all. It was fixed for one
       locale, then for the rule, and the harm moved each time rather than dying.
       It deliberately does NOT grade the built zips — a zip is only ever as
       fresh as the last build, and a stale artifact is a release-process
       question, not a source defect. publish/package.node.js grades those.

       This block used to EVAL the packager's ALLOW/NEVER/MAX_DEPTH out of its
       source text and re-walk the tree with a copy of the algorithm. That is a
       second implementation of the claim, and a second implementation can pass
       while the real one fails — the exact shape of the bug it was written to
       prevent. package.node.js now exports its real functions when required
       rather than run, and this grades THOSE. */
    const PKG = require(path.join(ROOT, 'publish', 'package.node.js'));
    const collected = new Set(PKG.collect());
    const onDisk = LOCALES.map(l => '_locales/' + l.code + '/messages.json')
      .filter(f => fs.existsSync(path.join(ROOT, f)));
    const unreachable = onDisk.filter(f => !collected.has(f));
    check('the packaging allowlist reaches EVERY locale on disk', unreachable.length === 0,
      unreachable.slice(0, 5).join(',') || onDisk.length + '/55 locale files collectable');
    check('_locales depth is within the packager\'s MAX_DEPTH', PKG.MAX_DEPTH >= 2,
      'MAX_DEPTH=' + PKG.MAX_DEPTH);
    check('the generator itself is NOT packaged', !collected.has('_locales/make-locales.mjs'),
      'make-locales.mjs lives in _locales but is excluded by only:[messages.json]');
    check('no build-time i18n input is packaged',
      ![...collected].some(f => f.startsWith('i18n/')),
      'translation memory, back-translations and the registry all stay out of the zip');

    /* ALLOWLIST-ALWAYS. The rule above proves _locales is reachable TODAY. This
       proves it is reachable under the pattern language's worst legal value:
       R12 itself, an exclusion that matches every underscore-prefixed path.
       localeMessageFiles() must not consult NEVER at all, so re-injecting R12
       into the regex the packager actually uses may not change its answer. */
    const localeFiles = PKG.localeMessageFiles();
    const R12 = /(^|\/)(node_modules|test|publish|_[^/]*|\.[^/]*)(\/|$)|DELETE-ME|\.md$|\.zip$/i;
    check('every locale path IS matched by the R12 exclusion (so the test is real)',
      localeFiles.length === 55 && localeFiles.every(f => R12.test(f)),
      localeFiles.length + ' locale paths, all matched by /_[^/]*/ — ' +
      'an exclusion-driven collector would return 0 of them');
    check('localeMessageFiles() consults no exclusion pattern',
      !/NEVER/.test(String(PKG.localeMessageFiles)),
      'the always-collector reads the tree directly; NEVER cannot reach it');
    check('_locales is not governed by the ALLOW pattern language alone',
      PKG.collect().filter(f => f.startsWith('_locales/')).length === 55,
      'collect() unions localeMessageFiles() in unconditionally');

    /* THE GATE ITSELF, graded rather than trusted. localeProblems() is pure, so
       the tier can hand it the file lists a broken build would produce. */
    const manifests = PKG.readManifests();
    const good = PKG.collect();
    check('the localisation gate passes a correct build', PKG.localeProblems(good, manifests).length === 0,
      PKG.localeProblems(good, manifests).join(' | ') || 'no problems');
    {
      const noLocales = good.filter(f => !f.startsWith('_locales/'));
      const p = PKG.localeProblems(noLocales, manifests);
      check('the localisation gate REFUSES a build with no _locales at all',
        p.length >= 2 && p.some(x => /default_locale "en"/.test(x) && /did NOT collect/.test(x)),
        p.length + ' problem(s): ' + (p[0] || 'NONE — R12 would ship'));
    }
    {
      const noDefault = good.filter(f => f !== '_locales/en/messages.json');
      const p = PKG.localeProblems(noDefault, manifests);
      check('the localisation gate REFUSES a build missing only the DEFAULT locale',
        p.some(x => /default_locale "en"/.test(x) && /did NOT collect/.test(x)),
        p[0] || 'NONE — the store would reject the upload and nothing warned');
    }
    {
      const oneShort = good.filter(f => f !== '_locales/ar/messages.json');
      const p = PKG.localeProblems(oneShort, manifests);
      check('the localisation gate REFUSES a build missing ONE non-default locale',
        p.some(x => /_locales\/ar\/messages\.json/.test(x)),
        p[0] || 'NONE — that market would silently receive English');
    }
    {
      const p = PKG.localeProblems(good, [{ label: 'synthetic', mf: { name: 'x' } }]);
      check('the localisation gate REFUSES a manifest with _locales but no default_locale',
        p.some(x => /sets no default_locale/.test(x)),
        p[0] || 'NONE — Chrome rejects "Localization used, but default_locale wasn\'t specified"');
    }

    /* Both manifests, in step. default_locale and the __MSG__ keys apply to
       Firefox identically — Firefox reads _locales the same way, and the AMO
       verifier compares the two manifests but has no notion of localisation. */
    const [chrome, firefox] = manifests;
    check('both manifests parse', !!chrome.mf && !!firefox.mf);
    check('both manifests declare the same default_locale',
      chrome.mf.default_locale === firefox.mf.default_locale,
      chrome.mf.default_locale + ' vs ' + firefox.mf.default_locale);
    check('both manifests carry the same version',
      chrome.mf.version === firefox.mf.version, chrome.mf.version + ' vs ' + firefox.mf.version);
    const keysOf = m => [...new Set((JSON.stringify(m).match(/__MSG_([A-Za-z0-9_@]+)__/g) || [])
      .map(s => s.slice(6, -2)))].sort().join(',');
    check('both manifests spend exactly the same __MSG__ keys',
      keysOf(chrome.mf) === keysOf(firefox.mf), keysOf(firefox.mf));

    /* THE CHROME importScripts LIMB, PINNED. verifyPackage() asks this of a
       built zip, and nothing in the tree could redden it: it lives in a branch
       that only runs against a Chrome package, and a package is only ever as
       fresh as the last build. On 2026-08-20 background.js grew the Firefox
       guard, the call moved two columns right, and the column-0 anchor the
       check carried went red on a package that was perfectly correct. That was
       found by a human reading the log, not by this tier.

       THE FIXTURES ARE WRITTEN OUT, NOT DERIVED. A fixture built only from the
       real background.js expresses the PASSING class alone and could not fail
       over any of these; each harmful form below is a literal string. */
    {
      const KEEP = PKG.chromeKeepsImportScripts;
      const realBg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
      check('the Chrome importScripts predicate accepts the real background.js', KEEP(realBg) === true,
        'guarded since 2026-08-20 — the call is indented two spaces under the typeof if');
      check('...and the same call at column 0 (the pre-guard shape)',
        KEEP("importScripts('pages/db.js');\nimportScripts('pages/batch.js');\n") === true);
      check('...and a tab-indented call',
        KEEP("if (typeof importScripts === 'function') {\n\timportScripts('pages/db.js');\n}\n") === true);

      /* MUTANTS. Each is the source edit whose harm this limb exists to catch. */
      check('MUTANT deleted: a Chrome zip with the db.js import REMOVED is REJECTED',
        KEEP("if (typeof importScripts === 'function') {\n  importScripts('pages/batch.js');\n}\n") === false,
        'the worker would start with no FSDB and every capture would throw');
      check('MUTANT replaced: `self.db = 1;` in place of the import is REJECTED',
        KEEP("if (typeof importScripts === 'function') {\n  self.db = 1;\n}\n") === false);
      check('MUTANT commented out: `// importScripts(...)` is REJECTED',
        KEEP("if (typeof importScripts === 'function') {\n  // importScripts('pages/db.js');\n}\n") === false,
        'a dropped $ or a .includes() matcher would accept this');
      check('MUTANT firefox shape: background.scripts and NO call is REJECTED',
        KEEP('/* Firefox loads pages/db.js via background.scripts */\nself.FSDB = FSDB;\n') === false,
        'the Firefox form must never satisfy the CHROME limb');
      check('MUTANT empty: an unreadable/absent background.js is REJECTED',
        KEEP('') === false && KEEP(null) === false);
    }
  }

  /* ================= direction: RTL layout, LTR data =====================
     Three RTL locales (ar, fa, he) are already declared above, and that list
     lives in i18n/locales.mjs and NOWHERE ELSE — which is why these checks are
     in the i18n tier rather than a stylesheet tier of their own: a second copy
     of "ar, fa, he" is the failure this whole phase is about.

     Everything below is static. What a static check CAN see is: which
     properties a stylesheet names, whether the direction plumbing is wired,
     and whether the coordinate spaces are pinned. What it cannot see is
     whether the result LOOKS right — that was measured in a real browser
     (Chromium, LTR vs RTL mirror identity across 14 page/viewport pairs,
     plus 10 real locales and two synthetic expansions at 100% and 200% zoom)
     and the findings are what these checks were written from. */
  console.log('\n=== direction: physical properties ===');

  const SHIPPED_HTML = ['pages/batch.html', 'pages/beautify.html', 'pages/editor.html',
    'pages/history.html', 'pages/options.html', 'pages/result.html', 'pages/scrollclip.html',
    'popup/popup.html'];
  const SHIPPED_CSS = ['pages/common.css', 'popup/popup.css'];
  const SHIPPED_JS = ['pages/batch.js', 'pages/beautify.js', 'pages/common.js', 'pages/db.js',
    'pages/editor.js', 'pages/history.js', 'pages/options.js', 'pages/pdf.js', 'pages/result.js',
    'pages/scrollclip.js', 'popup/popup.js',
    /* content scripts count: region.js paints FullShot's own chrome INTO the
       user's page, and that page may itself be RTL. */
    'background.js', 'content/capture.js', 'content/frame-expand.js', 'content/region.js'];
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* Comments out, ALWAYS, before any of these greps. Learned the hard way one
     run ago: three of the checks below went red on their own explanatory
     comments — a note reading "a transform: scaleX(-1) here would invert every
     annotation" is caught by a check looking for scaleX(-1), and a note saying
     "@@bidi_dir, not getUILanguage()" is caught by a check looking for
     getUILanguage(). A static text check cannot tell a prohibition from its own
     description of the prohibition, and the better a file documents the rule
     the more likely it is to trip it. */
  const stripComments = s => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // CSS and JS block comments
    .replace(/<!--[\s\S]*?-->/g, ' ')       // HTML comments
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1'); // JS line comments (not a URL's //)
  /* Every rule whose selector list mentions `sel`, as declaration text. Not
     "the first rule that matches": #canvas is styled twice in editor.html and
     the first block is the one WITHOUT the pin. */
  function rulesFor(css, sel) {
    const src = stripComments(css);
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const selectors = m[1].split(',').map(s => s.trim().replace(/^[\s\S]*[{}]\s*/, ''));
      if (selectors.some(s => s === sel || s.endsWith(' ' + sel) || s.startsWith(sel + ':') || s.startsWith(sel + '.'))) out.push(m[2]);
    }
    return out;
  }

  /* Every CSS declaration FullShot ships, with the file it came from. Sources:
     the two linked stylesheets, every <style> block in a shipped page, and
     every inline style="" attribute. All three are shipped CSS; a rule that
     only looked at .css files would miss the seven <style> blocks, which is
     where most of this product's layout actually lives. */
  function declarations() {
    const out = [];
    const scan = (file, css, where) => {
      const src = stripComments(css);
      const re = /(^|[;{])\s*([-a-zA-Z]+)\s*:\s*([^;{}]*)/g;
      let m;
      while ((m = re.exec(src))) out.push({ file, where, prop: m[2].toLowerCase(), value: m[3].trim(), text: m[2].trim() + ': ' + m[3].trim() });
    };
    for (const f of SHIPPED_CSS) scan(f, read(f), 'stylesheet');
    for (const f of SHIPPED_HTML) {
      const html = read(f);
      for (const b of html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []) scan(f, b.replace(/<\/?style[^>]*>/gi, ''), '<style>');
      for (const a of html.match(/\sstyle="[^"]*"/g) || []) scan(f, '{' + a.slice(8, -1) + '}', 'inline style=');
    }
    return out;
  }
  const DECLS = declarations();

  /* An allowlist of EXACT declarations, never a cleverer pattern. A regex that
     tries to tell a legitimate physical property from an illegitimate one has
     to understand intent, and it will be wrong the first time somebody writes
     `background-position: left`. Anything not named here and not logical is a
     failure, and the fix is either to make it logical or to add a row with a
     reason a person can read. */
  const PHYSICAL_OK = [
    // file                    exact declaration text                    why
  ];
  const PHYSICAL_PROP = /^(margin|padding|border|inset|scroll-margin|scroll-padding)-(left|right)$|^border-(top|bottom)-(left|right)-radius$|^(left|right)$|^border-(left|right)-(width|style|color)$/;
  {
    const bad = [];
    for (const d of DECLS) {
      let hit = null;
      if (PHYSICAL_PROP.test(d.prop)) hit = 'physical box edge';
      else if (d.prop === 'text-align' && /^(left|right)$/.test(d.value)) hit = 'text-align must be start/end';
      else if (d.prop === 'float' && /^(left|right)$/.test(d.value)) hit = 'float has no logical form; use flex order';
      else if (d.prop === 'clear' && /^(left|right)$/.test(d.value)) hit = 'clear must be inline-start/inline-end';
      else if (/^(transform|translate)$/.test(d.prop) && /translateX\(|translate\(\s*-?[0-9.]/.test(d.value)) hit = 'an X translation does not flip with the writing direction';
      if (!hit) continue;
      const allowed = PHYSICAL_OK.some(r => r.file === d.file && r.decl === d.text);
      if (!allowed) bad.push(d.file + ' [' + d.where + '] ' + d.text + '  <- ' + hit);
    }
    check('no shipped stylesheet names a physical direction',
      bad.length === 0, bad.slice(0, 8).join('\n        ') || DECLS.length + ' declarations scanned, ' + PHYSICAL_OK.length + ' allowlisted exception(s)');
  }
  {
    /* The scanner has to actually be looking at the CSS. A regex that silently
       matched nothing would make the check above pass on an empty set. */
    check('the declaration scanner sees every shipped stylesheet',
      new Set(DECLS.map(d => d.file)).size === SHIPPED_CSS.length + SHIPPED_HTML.length - 1 && DECLS.length > 300,
      DECLS.length + ' declarations across ' + new Set(DECLS.map(d => d.file)).size + ' files (popup.html carries no CSS of its own)');
  }

  console.log('\n=== direction: where dir comes from ===');
  {
    /* Chrome substitutes __MSG_ in manifest.json and in .css FILES. It does NOT
       substitute inside an inline <style>, which is why batch.html is wired
       through JS instead and why this check is spelled against the two linked
       stylesheets only. */
    const missing = SHIPPED_CSS.filter(f => !/html\s*\{[^}]*direction:\s*__MSG_@@bidi_dir__/.test(stripComments(read(f))));
    check('both linked stylesheets take direction from __MSG_@@bidi_dir__ (no RTL flash)',
      missing.length === 0, missing.join(',') || SHIPPED_CSS.join(' + '));
    const inHtml = SHIPPED_HTML.filter(f => /__MSG_@@bidi_dir__/.test(stripComments(read(f))));
    check('no page expects __MSG__ substitution inside HTML (Chrome does not do it there)',
      inHtml.length === 0, inHtml.join(',') || 'none');
  }
  {
    /* The dir ATTRIBUTE, which CSS `direction` does not set and [dir=] reads. */
    const wired = { 'pages/common.js': 'fsApplyDir', 'popup/popup.js': 'applyDir', 'pages/batch.js': null };
    const bad = [];
    for (const [f, fn] of Object.entries(wired)) {
      const src = stripComments(read(f));
      if (!/getMessage\(['"]@@bidi_dir['"]\)/.test(src)) bad.push(f + ': never asks for @@bidi_dir');
      if (!/documentElement\.dir\s*=/.test(src)) bad.push(f + ': never sets documentElement.dir');
      if (fn && !new RegExp('function ' + fn + '\\s*\\(').test(src)) bad.push(f + ': no ' + fn + '()');
    }
    check('every entry point sets the dir attribute from @@bidi_dir',
      bad.length === 0, bad.join(' | ') || 'pages/common.js · popup/popup.js · pages/batch.js');
    /* getUILanguage() reports what the USER set; @@bidi_dir reports the
       direction of the message file that actually LOADED. They disagree
       whenever Chrome falls back, and it is the strings on screen that have to
       be readable. */
    const wrong = Object.keys(wired).filter(f => /getUILanguage\s*\(/.test(stripComments(read(f))));
    check('direction is never derived from getUILanguage()', wrong.length === 0, wrong.join(',') || 'none');
  }
  {
    /* THE point of this phase: the RTL locale set exists once, in
       i18n/locales.mjs. A shipped file that names ar/fa/he together has made a
       second copy of it, and the second copy is the one that goes stale. */
    const rtl = LOCALES.filter(l => l.dir === 'rtl').map(l => l.code);
    const guilty = [];
    for (const f of [...SHIPPED_JS, ...SHIPPED_CSS, ...SHIPPED_HTML]) {
      const src = read(f);
      if (rtl.every(c => new RegExp("['\"]" + c + "['\"]").test(src))) guilty.push(f);
    }
    check('no shipped file keeps its own list of RTL locales',
      guilty.length === 0, guilty.join(',') || 'the only list is i18n/locales.mjs (' + rtl.join(' ') + ')');
  }
  {
    const linked = SHIPPED_HTML.filter(f => /href="common\.css"/.test(read(f)));
    const noJs = linked.filter(f => !/src="common\.js"/.test(read(f)));
    check('every page that links common.css also loads common.js (or dir never lands)',
      noJs.length === 0, noJs.join(',') || linked.length + ' pages');
    check('batch.html is the one page outside that pair, and batch.js wires it itself',
      !/href="common\.css"/.test(read('pages/batch.html')) && /documentElement\.dir\s*=/.test(read('pages/batch.js')),
      'pages/batch.html + pages/batch.js');
  }

  console.log('\n=== direction: layout vs content ===');
  {
    /* A drawing surface is a COORDINATE SYSTEM. Mirroring it would invert every
       annotation, every crop rectangle and every exported pixel, and — because
       CanvasRenderingContext2D.direction defaults to "inherit" — it would also
       move fillText's origin, so the same saved shot would render differently
       in an Arabic browser than in an English one. Pinned in CSS, asserted
       here, and the pointer mapping is asserted alongside it. */
    const pinned = [['pages/editor.html', '#canvas'], ['pages/scrollclip.html', '#scCanvas'],
                    ['pages/beautify.html', '#bfCanvas']];
    const bad = [];
    for (const [f, sel] of pinned) {
      const blocks = rulesFor(read(f), sel);
      if (!blocks.length || !blocks.some(b => /direction:\s*ltr/.test(b))) bad.push(f + ' ' + sel + ' (' + blocks.length + ' rule(s))');
    }
    check('every drawing surface is pinned direction: ltr (a canvas is not text)',
      bad.length === 0, bad.join(',') || '#canvas · #scCanvas · #bfCanvas');
    const mirrored = [...SHIPPED_CSS, ...SHIPPED_HTML, ...SHIPPED_JS]
      .filter(f => /scaleX\(\s*-|scale\(\s*-1/.test(stripComments(read(f))));
    check('nothing in the product mirrors a surface with a negative scale',
      mirrored.length === 0, mirrored.join(',') || 'no scaleX(-1) anywhere');
    const ed = stripComments(read('pages/editor.js'));
    check('the editor still maps a pointer through the physical rect edge',
      /\(e\.clientX - r\.left\)/.test(ed) && !/bidi|rtl/i.test(ed),
      'getBoundingClientRect().left is viewport geometry — direction-agnostic, and must stay so');
  }
  {
    /* Text lifted from the captured page carries its OWN direction; a number
       pair carries none and reverses. Both are the layout half of "functional
       output is never translated". Each row is a selector that holds
       page-derived text and the declaration that has to be on it. */
    const NEEDS = [
      ['pages/common.css', '.topbar .meta', /unicode-bidi:\s*plaintext/, 'the captured page title'],
      ['pages/history.html', '.card .title', /unicode-bidi:\s*plaintext/, 'the captured page title'],
      ['pages/history.html', '.card .sub', /unicode-bidi:\s*plaintext/, 'date + dimensions'],
      ['pages/history.html', '.card a.sub', /direction:\s*ltr/, 'the captured page URL'],
      ['pages/batch.html', '.bq-url', /direction:\s*ltr/, 'a pasted URL'],
      ['pages/batch.html', '.bq-fn', /direction:\s*ltr/, 'a derived filename'],
      ['pages/common.css', 'code, kbd, samp', /direction:\s*ltr/, 'technical literals']
    ];
    const bad = [];
    for (const [f, sel, want, why] of NEEDS) {
      const src = stripComments(read(f));
      const i = src.indexOf(sel + ' {');
      const j = i < 0 ? -1 : src.indexOf('}', i);
      if (i < 0 || !want.test(src.slice(i, j))) bad.push(f + ' "' + sel + '" (' + why + ')');
    }
    check('every surface that shows page-derived text gives it its own direction',
      bad.length === 0, bad.join(' | ') || NEEDS.length + ' selectors');
    /* And the numbers: one shared formatter, no bare pair anywhere. */
    const bare = [];
    for (const f of SHIPPED_JS) {
      const src = stripComments(read(f));
      for (const m of src.match(/[A-Za-z0-9_$.]+\s*\+\s*'\s*×\s*'\s*\+/g) || []) bare.push(f + ': ' + m.trim());
    }
    check('no page builds a bare W x H pair (it reverses in an RTL paragraph)',
      bare.length === 0, bare.join(' | ') || 'every site goes through fsDims()');
    const cj = read('pages/common.js');
    /* The region overlay is the one piece of FullShot chrome that renders
       inside a foreign document, so it is the one place where the host page's
       direction can leak in. Its sentence takes FullShot's direction; its
       readout is pinned LTR because it is a measurement. */
    const rg = stripComments(read('content/region.js'));
    check('the region overlay takes FullShot\'s direction, not the host page\'s',
      /getMessage\(['"]@@bidi_dir['"]\)/.test(rg) && /direction:\s*fsUiDir\(\)/.test(rg),
      'overlay direction from @@bidi_dir');
    check('the region overlay\'s size readout is pinned LTR',
      /direction:\s*'ltr',\s*unicodeBidi:\s*'isolate'/.test(rg),
      '"1280 x 4096" must not become "4096 x 1280" on an Arabic page');
    check('the region overlay still positions itself in physical viewport pixels',
      /sel\.style\.left = r\.x \+ 'px'/.test(rg) && /label\.style\.left = r\.x \+ 'px'/.test(rg),
      'a selection rectangle is a coordinate system — style.left here is correct and must stay');
    check('fsDims wraps the pair in U+2066 / U+2069 and is spelled from char codes',
      /String\.fromCharCode\(0x2066\)/.test(cj) && /String\.fromCharCode\(0x2069\)/.test(cj) &&
      /function fsDims\(/.test(cj) && /FS_LRI \+ String\(w\)/.test(cj),
      'LRI ... PDI');
  }

  console.log('\n=== direction: layouts that have to flex ===');
  {
    /* Regression guards for the specific measured breakages. Each row is a
       declaration that a real browser proved was load-bearing; the comment is
       the measurement it came from. */
    const ELASTIC = [
      ['pages/common.css', '.topbar {', /flex-wrap:\s*wrap/, 'history.html scrolled 253px sideways at 400 CSS px in ENGLISH'],
      ['pages/common.css', 'body {', /overflow-wrap:\s*break-word/, 'one 60-char compound noun dragged 105px of scroll onto the page'],
      ['popup/popup.css', 'body {', /overflow-wrap:\s*break-word/, 'the popup is 300px and cannot grow'],
      ['pages/options.html', '.opt {', /flex-wrap:\s*wrap/, 'nine switches left the card entirely under compound labels'],
      ['pages/options.html', '.opt .text {', /min-width:\s*0/, 'flex min-width:auto refuses to shrink below the longest WORD'],
      ['pages/options.html', '.opt input[type="text"] {', /min-width:\s*0/, 'a 260px input in a 280px column at 200% zoom'],
      ['pages/scrollclip.html', '.actions {', /flex-wrap:\s*wrap/, '"Einzelbild kopieren" wrapped to two lines at flex:1'],
      ['pages/beautify.html', '.actions {', /flex-wrap:\s*wrap/, 'same rail, same two buttons'],
      ['pages/history.html', '#searchBox {', /flex:\s*1 1 220px/, 'a fixed 220px search box is what overflowed the bar']
    ];
    /* indexOf on the literal selector, not a built regex: escaping
       `.opt input[type="text"] {` into a pattern is three chances to get it
       wrong and no chance to notice, because a pattern that matches nothing
       just reports the rule missing. */
    const bad = [];
    for (const [f, sel, want, why] of ELASTIC) {
      const src = stripComments(read(f));
      const i = src.indexOf(sel);
      const j = i < 0 ? -1 : src.indexOf('}', i);
      if (i < 0 || !want.test(src.slice(i, j))) bad.push(f + ' "' + sel.replace(' {', '') + '" — ' + why);
    }
    check('the layouts a real browser broke are still elastic',
      bad.length === 0, bad.join('\n        ') || ELASTIC.length + ' measured fixes still in place');
  }

  /* ================= THE PRODUCT ACTUALLY READS THE LOCALE FILES =========
     Everything above this line grades the message FILES. All of it can be green
     — 55 locales, 19,076 entries, placeholders intact, plurals per locale's own
     CLDR categories, privacy negations verified — while the product renders
     English to every user on earth, and for one release of FullShot it was.
     Measured in Chromium, same session, same process: under --lang=ar,
     chrome.i18n.getMessage('popupModeFullTitle') returned the Arabic and the
     popup rendered "Full page". Nine tiers stayed green because every one of
     them graded the English source, and the English source was still correct.

     So this section grades the OTHER end of the wire: that a shipped page has
     no user-visible English of its own left, that the substitution pass exists
     and cannot write markup, and — executed, not read — that running the real
     pages/common.js against a real locale file puts Hindi on the page.

     A grep can prove a call site exists. Only execution can prove it works,
     which is the exact gap that let "wired the strings" be reported for work
     that had wired the direction attributes and nothing else. */
  console.log('\n=== the substitution pass exists, and cannot write markup ===');

  /* The real module, not a regex over it: pages/common.js exports its tables
     precisely so a sim can grade the values the browser will use. */
  const COMMON = require(path.join(ROOT, 'pages', 'common.js'));
  {
    const cj = stripComments(read('pages/common.js'));
    const want = ['fsApplyI18n', 'fsMessage', 'fsPluralMessage', 'fsPluralCategory', 'fsI18nSubst'];
    const missing = want.filter(fn => !new RegExp('function ' + fn + '\\s*\\(').test(cj));
    check('pages/common.js defines the pass every page shares', missing.length === 0,
      missing.join(',') || want.join(' · '));
    check('...and runs it once the document exists, not on a passed-in Event',
      /fsOnDomReady\(\(\)\s*=>\s*fsApplyI18n\(\)\)/.test(cj),
      'fsOnDomReady(() => fsApplyI18n())');
    check('...and exports it, so this tier can execute it',
      typeof COMMON.fsApplyI18n === 'function' && typeof COMMON.fsMessage === 'function' &&
      typeof COMMON.fsPluralMessage === 'function');
  }
  {
    /* A message file is text, and text becoming markup is the defect class this
       product has already shipped once (v1.9.12, the batch URL list). The pass
       is also about to be copied into 67 sibling tools, so the sink rule has to
       hold in the copy as well as in the original. */
    const SINK = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|Function\s*\(/;
    const guilty = ['pages/common.js', 'popup/popup.js'].filter(f => SINK.test(read(f)));
    check('neither copy of the pass reaches for a markup sink', guilty.length === 0,
      guilty.join(',') || 'textContent + setAttribute only');
    const cj = stripComments(read('pages/common.js'));
    check('...it writes text through textContent and attributes through setAttribute',
      /\.textContent = text/.test(cj) && /setAttribute\(name, text\)/.test(cj));
  }
  {
    /* The attribute allowlist is the whole defence for the attribute half: an
       href or a formaction written from a message file is a navigation sink,
       and `value` on an <option> is an ENUM the settings are stored as —
       translating one corrupts the user's own data rather than merely looking
       wrong. Graded against the exported array, so the check cannot pass on a
       comment that mentions the rule. */
    const NEVER = ['href', 'src', 'srcdoc', 'style', 'action', 'formaction', 'data', 'value',
      'xlink:href', 'onclick', 'onerror', 'id', 'class', 'name', 'type'];
    const attrs = COMMON.FS_I18N_ATTRS || [];
    const admitted = NEVER.filter(a => attrs.indexOf(a) >= 0);
    check('the attribute allowlist admits no sink and no identifier', admitted.length === 0,
      admitted.join(',') || attrs.length + ' attributes, all of them text a person reads');
    check('...and it is an allowlist, not a pattern', Array.isArray(attrs) && attrs.length > 0,
      attrs.join(' '));
  }
  {
    /* One plural table, in a build-time ESM module that is never shipped, and a
       copy in the shipped file that has to agree with it. */
    check('the shipped plural suffix table matches i18n/plurals.mjs exactly',
      JSON.stringify(COMMON.FS_PLURAL_SUFFIX) === JSON.stringify(P.SUFFIX),
      JSON.stringify(COMMON.FS_PLURAL_SUFFIX));
    const cj = stripComments(read('pages/common.js'));
    check('the category comes from Intl.PluralRules, never from a table of languages',
      /new Intl\.PluralRules\(fsUiLocale\(\)\)\.select\(/.test(cj), 'Intl.PluralRules(...).select(count)');
    check('...for the locale that LOADED, not the one the user set',
      /getMessage\('@@ui_locale'\)/.test(cj) && !/getUILanguage/.test(cj), '@@ui_locale');
  }

  /* ---- executed: the real pass, against a real locale file ---- */
  console.log('\n=== executed: the real pass renders a real locale ===');
  {
    const vm = require('vm');
    const COMMON_SRC = fs.readFileSync(path.join(ROOT, 'pages', 'common.js'), 'utf8');

    /* Chrome's own resolution rules, as thin as they can be and still be true:
       a placeholder whose content is $1..$9 takes the caller's substitution, a
       placeholder whose content is a literal (a keyboard letter, a URL) takes
       that literal, an unknown key returns '' — which is what makes "leave the
       English standing" a testable behaviour rather than a hope. */
    function fakeChrome(code) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', code, 'messages.json'), 'utf8'));
      const loc = BY_CODE.get(code);
      return {
        i18n: {
          getMessage(key, subs) {
            if (key === '@@ui_locale') return code;
            if (key === '@@bidi_dir') return loc.dir;
            const e = m[key];
            if (!e) return '';
            let t = e.message;
            for (const [n, d] of Object.entries(e.placeholders || {})) {
              const c = String(d.content);
              const pos = /^\$([1-9])$/.exec(c);
              const v = pos ? (subs ? subs[Number(pos[1]) - 1] : undefined) : c;
              t = t.split('$' + n.toUpperCase() + '$').join(v == null ? '' : String(v));
            }
            return t;
          }
        },
        storage: { sync: { get: async () => ({}) } }
      };
    }

    /* The smallest document the pass can walk. Element children are deliberately
       absent: an element carrying data-i18n must hold text and nothing else, and
       that rule is asserted statically further down. */
    function fakeEl(spec) {
      return {
        tagName: (spec.tag || 'span').toUpperCase(),
        _a: Object.assign({}, spec.attrs),
        textContent: spec.text == null ? '' : spec.text,
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._a, n) ? this._a[n] : null; },
        setAttribute(n, v) { this._a[n] = v; },
        hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._a, n); }
      };
    }
    function fakeDoc(specs) {
      const els = specs.map(fakeEl);
      return {
        readyState: 'complete',
        documentElement: { dataset: {}, style: {} },
        addEventListener() {},
        querySelectorAll(sel) {
          if (sel !== '[data-i18n], [data-i18n-attr]') return [];
          return els.filter(e => e.hasAttribute('data-i18n') || e.hasAttribute('data-i18n-attr'));
        },
        _els: els
      };
    }
    function load(code, doc) {
      const warned = [];
      const sandbox = {
        console: { warn: m => warned.push(String(m)), error() {}, log() {} },
        chrome: fakeChrome(code), document: doc, Intl, setTimeout, clearTimeout,
        matchMedia: () => ({ matches: false }), URL, Math, Date, JSON
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(COMMON_SRC, sandbox, { filename: 'pages/common.js' });
      return { sandbox, warned };
    }

    /* THE CHECK THIS WHOLE PHASE EXISTS FOR. The shipped file, the shipped
       Hindi message file, the shipped markup shape — and Hindi comes out. */
    {
      const doc = fakeDoc([
        { tag: 'b', attrs: { 'data-i18n': 'popupModeFullTitle' }, text: 'Full page' },
        { tag: 'button', attrs: { 'data-i18n-attr': 'title:popupToggleTheme' }, text: '◐' }
      ]);
      const { sandbox } = load('hi', doc);
      const hiTitle = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'hi', 'messages.json'), 'utf8'));
      check('the pass puts Hindi on the page, from the shipped file',
        doc._els[0].textContent === hiTitle.popupModeFullTitle.message &&
        doc._els[0].textContent !== 'Full page',
        JSON.stringify(doc._els[0].textContent));
      check('...and Hindi in the tooltip attribute',
        doc._els[1].getAttribute('title') === hiTitle.popupToggleTheme.message,
        JSON.stringify(doc._els[1].getAttribute('title')));
      check('...leaving the element that carried the key otherwise alone',
        doc._els[1].textContent === '◐', JSON.stringify(doc._els[1].textContent));
      check('...and it ran on load, without the page asking',
        typeof sandbox.fsApplyI18n === 'function');
    }
    /* Arabic, because direction and substitution are two different wires and
       this tier owns both. */
    {
      const doc = fakeDoc([{ tag: 'a', attrs: { 'data-i18n': 'popupLinkOptions' }, text: 'Options' }]);
      load('ar', doc);
      const ar = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'ar', 'messages.json'), 'utf8'));
      check('the same pass renders Arabic and sets the direction attribute',
        doc._els[0].textContent === ar.popupLinkOptions.message && doc.documentElement.dir === 'rtl',
        JSON.stringify(doc._els[0].textContent) + ' dir=' + doc.documentElement.dir);
    }
    /* Degradation. A missing key must leave the English the page was authored
       with — a blank button is worse than an untranslated one — and it must say
       so, once, in the console, or the next missing key is invisible. */
    {
      const doc = fakeDoc([
        { tag: 'b', attrs: { 'data-i18n': 'thisKeyDoesNotExist' }, text: 'Full page' },
        { tag: 'b', attrs: { 'data-i18n': 'popupModeFullTitle' }, text: 'Full page' }
      ]);
      const { warned } = load('de', doc);
      check('a missing key degrades to the English in the markup, never to blank',
        doc._els[0].textContent === 'Full page', JSON.stringify(doc._els[0].textContent));
      check('...and names the key it could not find', warned.some(w => /thisKeyDoesNotExist/.test(w)),
        JSON.stringify(warned));
      check('...without stopping the element after it', doc._els[1].textContent !== 'Full page',
        JSON.stringify(doc._els[1].textContent));
    }
    /* The attribute allowlist, exercised rather than read. */
    {
      const doc = fakeDoc([{ tag: 'a', attrs: { 'data-i18n-attr': 'href:popupLinkHistory', href: '#' }, text: 'History' }]);
      const { warned } = load('de', doc);
      check('the pass refuses to write an attribute outside the allowlist',
        doc._els[0].getAttribute('href') === '#' && warned.some(w => /refusing to write attribute/.test(w)),
        JSON.stringify(doc._els[0].getAttribute('href')));
    }
    /* Literal substitutions carried by the markup itself (the delay dropdown). */
    {
      const doc = fakeDoc([{ tag: 'option', attrs: { 'data-i18n': 'popupDelaySeconds', 'data-i18n-args': '3' }, text: '3s' }]);
      load('ja', doc);
      const ja = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'ja', 'messages.json'), 'utf8'));
      check('data-i18n-args spends a literal substitution from the markup',
        doc._els[0].textContent === ja.popupDelaySeconds.message.split('$COUNT$').join('3'),
        JSON.stringify(doc._els[0].textContent));
    }
    /* PLURALS, per locale, against each locale's OWN category set. ja carries
       one form, de two, ru four, ar six — and the selector has to land on the
       key that locale actually ships or the line comes out blank. */
    {
      const CASES = [
        ['ja', 1, 'other'], ['ja', 7, 'other'],
        ['de', 1, 'one'], ['de', 3, 'other'],
        ['ru', 1, 'one'], ['ru', 2, 'few'], ['ru', 7, 'many'],
        ['ar', 0, 'zero'], ['ar', 1, 'one'], ['ar', 2, 'two'], ['ar', 3, 'few'], ['ar', 11, 'many']
      ];
      const bad = [];
      for (const [code, n, cat] of CASES) {
        const { sandbox } = load(code, fakeDoc([]));
        const file = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', code, 'messages.json'), 'utf8'));
        const key = 'historyCount' + P.SUFFIX[cat];
        const got = sandbox.fsPluralMessage('historyCount', n, [String(n), '1.2 MB']);
        const want = file[key] && file[key].message.split('$COUNT$').join(String(n)).split('$SIZE$').join('1.2 MB');
        if (sandbox.fsPluralCategory(n) !== cat) bad.push(code + ' n=' + n + ' selected ' + sandbox.fsPluralCategory(n) + ', CLDR says ' + cat);
        else if (!want) bad.push(code + ' has no ' + key);
        else if (got !== want) bad.push(code + ' n=' + n + ' -> ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
      }
      check('the plural helper selects each locale\'s own CLDR category and finds its key',
        bad.length === 0, bad.slice(0, 4).join(' | ') || CASES.length + ' cases across ja de ru ar');
    }
    {
      /* And when the selected category has no key — a locale Chrome fell back
         FROM, a base a translator has not finished — it must land on <base>Other
         rather than blank the line. Driven with a base that exists only as
         Other by asking for a category ja does not carry. */
      const { sandbox } = load('ja', fakeDoc([]));
      const ja = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'ja', 'messages.json'), 'utf8'));
      check('a category with no key of its own falls back to <base>Other',
        sandbox.fsPluralMessage('batchPlanCount', 1, ['1']) ===
          ja.batchPlanCountOther.message.split('$COUNT$').join('1'),
        JSON.stringify(sandbox.fsPluralMessage('batchPlanCount', 1, ['1'])));
    }
  }

  /* ---- no shipped page may hold user-visible English of its own ---- */
  console.log('\n=== no hardcoded user-visible string in shipped HTML ===');

  /* A tag walker, not a regex sweep: whether a string is user-visible depends on
     what encloses it, and "the element that carries the key" has to be the text
     node's IMMEDIATE parent — the pass writes textContent, which would delete
     any siblings, so a key on a grandparent is a different (and broken) claim.
     Deliberately small and deliberately strict; it has no HTML parser and does
     not need one, because this product's markup is hand-written. */
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const NON_TEXT = new Set(['script', 'style']);
  /* Technical literals, and the only exemption by TAG. `code, kbd, samp` are
     already pinned `direction: ltr` in pages/common.css for the same reason
     they are exempt here: they are not prose. A keyboard shortcut translated
     into Arabic is a shortcut that no longer works. */
  const LITERAL_TAGS = new Set(['kbd', 'code', 'samp', 'var']);
  /* Digits, punctuation and symbols only: the icon glyphs (⬇ ▣ ⬚ ◉ ⏱ ◐ ✕), the
     · separators, an em dash. They read the same in every language. */
  const NOISE = /^[\s\d\p{P}\p{S}]*$/u;
  /* User-visible ATTRIBUTES. Four, because these four are the ones this product
     actually spends and an allowlist is only honest if every row is real. */
  const VISIBLE_ATTRS = ['alt', 'placeholder', 'title', 'aria-label'];
  /* EXACT exemptions, never a cleverer pattern — same rule as PHYSICAL_OK
     above. A row is a file, the literal text, and a reason a person can read.
     Matching is `file === file && text === text`: a row exempts ONE string on
     ONE page and can never widen to a second one, which is why this is a table
     and not a regex. Six rows, and every one of them was argued for by the
     agent who converted that page and could not add it, because the row lives
     here and the page does not.

     WHAT DOES NOT BELONG HERE: prose. Every sentence, label, tooltip and
     heading in this product has a key and spends it. These six are the
     residue of a scanner that reasons about Unicode categories — two icons
     that happen to be a letter and a numeral, three file-format names the
     English file itself locks as do-not-translate, and one block of RFC 2606
     example data. Adding a row for anything a translator would want to change
     is a lie told to the gate. */
  const BARE_OK = [
    // file                     exact text     why
    /* Two toolbar ICONS. The exemption above is NOISE — "digits, punctuation
       and symbols only" — and it catches the other 20 glyphs on that toolbar.
       These two escape it by accident of Unicode category: T is Lu (a Latin
       letter used as a letterform sample, the way every drawing program draws
       its text tool) and ① is No (a circled numeral, the numbered-step
       pictogram). Both carry data-i18n-attr="title:…", so the tooltip that
       says what the button DOES is translated in all 55; only the pictogram
       on its face is not. Widening NOISE to admit \p{L} would exempt every
       one-letter word in the product, so the rule stays narrow and the two
       exceptions are named. */
    { file: 'pages/editor.html', text: 'T', why: 'the Text tool icon — a letterform sample, not prose (tooltip is keyed: editorToolText)' },
    { file: 'pages/editor.html', text: '①', why: 'the Numbered-step tool icon — a pictogram, not a count (tooltip is keyed: editorToolNum)' },
    /* Three FILE FORMAT names. _locales/en/messages.json already declares these
       exact three words as fixed-content placeholders inside optionsFormatDesc
       and optionsQuality, i.e. the English file itself instructs every
       translator not to touch them. Leaving them English is the CORRECT
       rendering in all 55 locales, not a gap — verified in the browser check,
       where hi/ja/ar/de/ru/ta all render the dropdown text as PNG/JPEG/WebP.
       The <option value> beside each is a stored enum and is exempt by a
       different rule: `value` is deliberately absent from FS_I18N_ATTRS. */
    { file: 'pages/options.html', text: 'PNG', why: 'file format name — locked as a do-not-translate placeholder inside optionsFormatDesc' },
    { file: 'pages/options.html', text: 'JPEG', why: 'file format name — locked as a do-not-translate placeholder inside optionsQuality' },
    { file: 'pages/options.html', text: 'WebP', why: 'file format name — locked as a do-not-translate placeholder inside optionsQuality' },
    /* One block of EXAMPLE DATA. All three hosts are RFC 2606 reserved names
       that resolve nowhere; the placeholder shows the SHAPE of the input (one
       address per line, scheme optional), which is why batch.js accepts
       "example.org/pricing" without a scheme. There is no prose in it to
       translate — a Hindi user pastes the same URLs — and the 350-key
       inventory excluded it deliberately rather than by oversight. */
    { file: 'pages/batch.html', text: 'https://example.com&#10;example.org/pricing&#10;https://news.example/article', why: 'RFC 2606 example addresses — input shape, not prose' },
  ];

  function tagAttrs(s) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let m;
    while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
    return out;
  }
  const ENTITY = { '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  const unescape = s => s.replace(/&[a-z#0-9]+;/gi, e => (e in ENTITY ? ENTITY[e] : e));

  function scanHtml(file) {
    const html = read(file).replace(/<!--[\s\S]*?-->/g, ' ');
    const bare = [], attrBare = [], keys = [], withChildren = [], attrSpecs = [];
    const stack = [];
    const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    let last = 0, m;
    const text = raw => {
      const t = unescape(raw).trim();
      const top = stack[stack.length - 1];
      if (!t || !top) return;
      if (NON_TEXT.has(top.tag)) return;
      if (top.marked) return;                       // this element carries a key
      if (stack.some(f => LITERAL_TAGS.has(f.tag))) return;
      if (NOISE.test(t)) return;
      if (BARE_OK.some(r => r.file === file && r.text === t)) return;
      bare.push({ tag: top.tag, text: t });
    };
    while ((m = re.exec(html))) {
      text(html.slice(last, m.index));
      last = re.lastIndex;
      const tag = m[1].toLowerCase();
      const body = m[2] || '';
      if (m[0][1] === '/') {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
        continue;
      }
      const a = tagAttrs(body);
      const marked = a['data-i18n'] != null;
      if (marked) keys.push({ key: a['data-i18n'], where: tag });
      const here = [];
      if (a['data-i18n-attr'] != null) {
        for (const pair of a['data-i18n-attr'].split(';')) {
          if (!pair.trim()) continue;
          const cut = pair.indexOf(':');
          const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
          const key = cut < 0 ? '' : pair.slice(cut + 1).trim();
          here.push(name);
          attrSpecs.push({ name, key, tag });
          if (key) keys.push({ key, where: tag + '[' + name + ']' });
        }
      }
      for (const name of VISIBLE_ATTRS) {
        const v = (a[name] || '').trim();
        if (!v || NOISE.test(v)) continue;
        if (here.indexOf(name) >= 0) continue;      // this element carries a key for it
        if (BARE_OK.some(r => r.file === file && r.text === unescape(v))) continue;
        attrBare.push({ tag, name, text: unescape(v) });
      }
      const selfClosing = /\/\s*$/.test(body) || VOID_TAGS.has(tag);
      if (selfClosing) continue;
      /* An element whose content is a message may not also contain elements:
         the pass writes textContent and would delete them. */
      if (marked) {
        const close = html.indexOf('</' + tag, re.lastIndex);
        const inner = close < 0 ? '' : html.slice(re.lastIndex, close);
        if (/<[a-zA-Z]/.test(inner)) withChildren.push({ tag, key: a['data-i18n'] });
      }
      stack.push({ tag, marked });
    }
    text(html.slice(last));
    return { bare, attrBare, keys, withChildren, attrSpecs };
  }

  {
    const scans = SHIPPED_HTML.map(f => [f, scanHtml(f)]);
    let totalText = 0, totalAttr = 0;
    const textWorst = [], attrWorst = [];
    for (const [f, s] of scans) {
      totalText += s.bare.length; totalAttr += s.attrBare.length;
      console.log('      ' + f.padEnd(24) + String(s.bare.length).padStart(3) + ' text  ' +
        String(s.attrBare.length).padStart(3) + ' attr  ' + String(s.keys.length).padStart(3) + ' keys');
      if (s.bare.length) textWorst.push(f + ' (' + s.bare.length + '): ' +
        s.bare.slice(0, 3).map(b => '<' + b.tag + '> ' + JSON.stringify(b.text.slice(0, 40))).join('  '));
      if (s.attrBare.length) attrWorst.push(f + ' (' + s.attrBare.length + '): ' +
        s.attrBare.slice(0, 3).map(b => b.name + '=' + JSON.stringify(b.text.slice(0, 40))).join('  '));
    }
    check('no shipped page renders a text node the locale files do not own',
      totalText === 0, totalText + ' bare string(s)' +
      (textWorst.length ? '\n        ' + textWorst.join('\n        ') : ''));
    check('no shipped page renders a title, alt, placeholder or aria-label of its own',
      totalAttr === 0, totalAttr + ' bare attribute(s)' +
      (attrWorst.length ? '\n        ' + attrWorst.join('\n        ') : ''));
    const kids = scans.filter(([, s]) => s.withChildren.length);
    check('no element carrying data-i18n also contains elements (textContent would delete them)',
      kids.length === 0,
      kids.map(([f, s]) => f + ': ' + s.withChildren.map(k => k.key).join(',')).join(' | ') || 'none');
    const attrs = COMMON.FS_I18N_ATTRS || [];
    const badAttr = [];
    for (const [f, s] of scans) for (const sp of s.attrSpecs || []) if (attrs.indexOf(sp.name) < 0) badAttr.push(f + ' ' + sp.name);
    check('every data-i18n-attr names an attribute the pass is allowed to write',
      badAttr.length === 0, badAttr.join(',') || 'all within the allowlist');
    /* A key that does not exist is a silent English element in 55 languages —
       exactly the failure this section was written to catch, one layer down. */
    const unknown = [];
    for (const [f, s] of scans) for (const k of s.keys) if (!en[k.key]) unknown.push(f + ' ' + k.where + ' "' + k.key + '"');
    check('every key named in shipped markup exists in the English file',
      unknown.length === 0, unknown.slice(0, 8).join(' | ') ||
      scans.reduce((a, [, s]) => a + s.keys.length, 0) + ' key references, all resolve');
  }

  /* ---- and every page has to be wired to the pass ---- */
  console.log('\n=== every shipped page is wired ===');
  {
    /* The page's OWN script, not the shared one: common.js calling getMessage
       says nothing about whether options.html was ever converted. A page counts
       as wired when its script calls the pass or resolves a content key itself
       — @@bidi_dir and @@ui_locale do not count, because those are the two the
       previous attempt wired before reporting the job done. */
    const PAGE_SCRIPT = {
      'pages/batch.html': 'pages/batch.js', 'pages/beautify.html': 'pages/beautify.js',
      'pages/editor.html': 'pages/editor.js', 'pages/history.html': 'pages/history.js',
      'pages/options.html': 'pages/options.js', 'pages/result.html': 'pages/result.js',
      'pages/scrollclip.html': 'pages/scrollclip.js', 'popup/popup.html': 'popup/popup.js'
    };
    const unwired = [];
    for (const [html, js] of Object.entries(PAGE_SCRIPT)) {
      const src = stripComments(read(js));
      const callsPass = /fsApplyI18n\s*\(|fsMessage\s*\(|fsPluralMessage\s*\(/.test(src);
      const contentKey = /getMessage\(\s*(?!['"]@@)/.test(src);
      if (!callsPass && !contentKey) unwired.push(js);
    }
    check('every shipped page script reaches the message files',
      unwired.length === 0, unwired.join(' ') || Object.keys(PAGE_SCRIPT).length + ' pages');
    /* The same failure one level down, and the one this phase is named after:
       markup that carries keys nothing ever reads. pages/batch.html is the page
       to watch — it is the one page that does not load common.js and wires its
       own direction, so marking it up without also giving it the pass would
       leave it English with data-i18n attributes all over it. */
    const orphaned = [];
    for (const [html, js] of Object.entries(PAGE_SCRIPT)) {
      if (!/data-i18n/.test(read(html))) continue;
      const loadsCommon = /<script src="(?:\.\.\/pages\/)?common\.js">/.test(read(html));
      const carriesOwn = /function applyI18n\s*\(/.test(read(js));
      if (!loadsCommon && !carriesOwn) orphaned.push(html + ' (marked up, but neither common.js nor a pass of its own)');
    }
    check('every page with keys in its markup loads something that can substitute them',
      orphaned.length === 0, orphaned.join(' | ') || 'no orphaned markup');
    /* Every key a shipped script names as a literal has to exist, for the same
       reason a key in markup does. */
    const unknown = [];
    for (const f of SHIPPED_JS) {
      const src = stripComments(read(f));
      const re = /(?:getMessage|fsMessage|fsPluralMessage)\(\s*'([A-Za-z0-9_]+)'/g;
      let m;
      while ((m = re.exec(src))) {
        const k = m[1];
        if (k.startsWith('@@')) continue;
        const isPlural = P.PLURAL_BASES.indexOf(k) >= 0;
        if (isPlural ? !en[k + 'Other'] : !en[k]) unknown.push(f + ' "' + k + '"');
      }
    }
    check('every message key named in shipped JS exists in the English file',
      unknown.length === 0, unknown.slice(0, 8).join(' | ') || 'all resolve');
  }
  {
    /* THE WORKED EXAMPLE. popup.js is what the remaining pages are converted
       from, so its two failure sentences are graded by name: a sentence built
       with + fixes English word order into the product, and several of the 55
       put the mode name after the verb. */
    const pj = stripComments(read('popup/popup.js'));
    check('the popup\'s failure sentence is one placeholdered message, not a concatenation',
      /popupLastErrorFailedAt/.test(pj) && /popupLastErrorFailed'/.test(pj) &&
      !/'Last '\s*\+/.test(pj) && !/\+\s*' failed/.test(pj),
      'popupLastErrorFailed / popupLastErrorFailedAt');
    check('...and the popup still carries an English fallback for a chrome with no i18n',
      /'Last \$MODE\$ failed — \$REASON\$'/.test(pj) && /\|\| 'capture'/.test(pj),
      'test/background-sim.node.js boots popup.js against exactly that chrome');
    const marked = scanHtml('popup/popup.html');
    check('popup.html is fully converted, and is the shape the other pages copy',
      marked.bare.length === 0 && marked.attrBare.length === 0 && marked.keys.length >= 20,
      marked.keys.length + ' keys · ' + marked.bare.length + ' bare text · ' + marked.attrBare.length + ' bare attr');
  }

  /* ---- back-translation negation check ----
     WHAT A GREEN HERE IS WORTH, STATED PLAINLY SO NOBODY OVER-READS IT.
     Every locale is now paired with a back-translation, and every back-translation
     grades clean. Read that as narrowly as it is meant.

     IT PROVES ONE THING. The eight privacy strings still carry the polarity the
     English carries. "Nothing is ever sent anywhere" has not come back as
     "everything is sent", and the clause has not silently vanished. That single
     failure — a dropped or inverted NEGATION — is the one that turns a true
     privacy claim into a false one shipped in 54 languages nobody here reads,
     and it is the reason this check exists at all.

     IT PROVES NOTHING ABOUT STYLE OR FLUENCY. A back-translation is not a review.
     It cannot tell you whether the Tamil reads naturally, whether the register
     suits a browser extension, or whether a native speaker would wince. Those
     questions need a native speaker, and this tier is not one.

     AND IT IS NOT AN INDEPENDENT WITNESS. The translations and the
     back-translations come from the same family of model. A model that
     misunderstands a source sentence in one direction can misunderstand it the
     same way in the other, and the round trip will look clean precisely because
     the error is shared. What survives that objection is the mechanical part:
     polarity is graded by the closed lexicon in i18n/backtranslation.mjs, not by
     a model's judgement, so a negation that is ABSENT from the back-translated
     text is caught regardless of who wrote it. What does NOT survive it is any
     claim that these strings have been independently verified. They have not.
     Treat this as a tripwire on the highest-consequence failure mode, not as
     sign-off on 54 languages. */
  console.log('\n=== back-translation negation check (privacy strings only) ===');
  {
    const btDir = path.join(ROOT, 'i18n', 'backtranslations');
    let graded = 0, flagged = [], absent = [], incomplete = [];
    for (const l of targets) {
      const f = path.join(btDir, l.code + '.json');
      if (!fs.existsSync(f)) { absent.push(l.code); continue; }
      let bt;
      try { bt = JSON.parse(fs.readFileSync(f, 'utf8')); }
      catch (e) { flagged.push(l.code + ' back-translation file is malformed: ' + e.message); continue; }
      const gaps = BT.PRIVACY_KEYS.filter(k => !bt[k]);
      if (gaps.length) { incomplete.push(l.code + ': ' + gaps.join(',')); continue; }
      for (const k of BT.PRIVACY_KEYS) {
        graded++;
        const r = BT.checkBackTranslation(k, bt[k], resolveEn(k));
        for (const fl of r.flags) flagged.push(l.code + ' ' + k + ' [' + fl.kind + '] ' + (fl.claim || '') + ' :: ' + fl.detail);
      }
    }
    check('every locale WITH a translation memory also has a back-translation file',
      Object.keys(ctx.tm).every(c => !absent.includes(c)),
      Object.keys(ctx.tm).filter(c => absent.includes(c)).join(',') || Object.keys(ctx.tm).length + ' translated locales all covered');
    check('no back-translation file is partial', incomplete.length === 0, incomplete.join(' | ') || 'none');
    check('privacy strings pass the negation check in every graded locale',
      flagged.length === 0, flagged.slice(0, 6).join('\n        ') || graded + ' back-translations graded clean');
    console.log('      ' + graded + ' graded · ' + absent.length + ' locale(s) not yet translated');
  }

  /* ---- the redaction strings (REDACTION-CLAIM-SPEC.md §6) ----
     THERE IS NO MAPPING TABLE ANY MORE. This block used to enforce that each of
     eight states owned a sentence key, because the state was what the human
     acted on. Both are gone: the product no longer has a state, and the reader
     is no longer handed a judgement to act on. What is left is a stats line and
     a review dialog, and what has to be enforced about them is narrower and
     harder to erode — the words they may not contain.

     Graded on the ENGLISH, which is what 54 locales render today and what every
     translator will work from. A translated string cannot be machine-checked,
     which is why the constraint also has to travel in the `description` field,
     asserted below. */
  console.log('\n=== the redaction strings ===');
  {
    /* WHICH STRINGS ARE GRADED IS DECIDED BY SHAPE, NOT BY A PREFIX.
       This selector used to be /^redactActs|^review/, and that is exactly how a
       page-completeness claim survived the rewrite: `optionsRedactPIIDesc` —
       "Scans the page for … and paints a solid block over each" — was the
       feature's own description, in 55 languages, and no prefix reached it. A
       list of prefixes grades the strings someone remembered; the feature is
       whatever TALKS about redaction. So: any key that names redaction, plus
       any message that says the word. A new string cannot opt out by being
       filed somewhere this block was not looking. */
    const redKeys = Object.keys(en).filter(k =>
      /^redactActs|^review/.test(k) || /redact/i.test(k) || /\bredact/i.test(en[k].message || ''));
    check('the acts line, the review step and the setting own their strings',
      redKeys.length >= 12 &&
      ['redactActsLine', 'redactActsNone', 'redactActsShortfall', 'redactActsNoLedger',
       'reviewTitle', 'reviewLimit', 'reviewConfirm', 'reviewCancel',
       'optionsRedactPII', 'optionsRedactPIIDesc']
        .every(k => !!en[k]),
      redKeys.length + ' keys: ' + redKeys.join(','));
    const all = redKeys.map(k => en[k].message).join(' ');
    /* THE FORBIDDEN LIST, §6. Every one of these words turns a report of an act
       into a promise about a picture the product cannot see. */
    check('no redaction string promises the image is safe',
      !/\b(safe|clean|secure|sanitis|sanitiz|protected|guaranteed|nothing to hide)\b/i.test(all),
      (all.match(/\b(safe|clean|secure|protected|guaranteed)\b/gi) || []).join(',') || 'none');
    /* THE PAGE IS NOT THE OBJECT OF ANYTHING FULLSHOT DID (§0, §1).
       "Scans the page" says the page was examined. FullShot examined the text
       the DOM handed it, which is a different and smaller thing, and §1 lists
       thirteen shapes where the two diverge. The graded shape is a FullShot verb
       taking "the page" as its direct object — which is the claim — and not the
       word "page" as such: "the text a page exposes" and "did not finish walking
       this page" are both statements about the instrument and both stay legal. */
    const pageObject = all.match(
      /\b(scans?|scanned|scanning|searche?s?|searched|reads?|checks?|checked|examines?|examined|covers?|covered|redacts?|redacted|inspects?|inspected)\s+(the|this|your|an?)\s+(whole\s+|entire\s+|full\s+)?page\b/gi) || [];
    check('...and none of them makes the page the object of what FullShot did',
      pageObject.length === 0, pageObject.join(' | ') || 'none');
    /* NO UNIVERSAL QUANTIFIER, ANYWHERE IN THE SET (§0.1, Rule 1).
       "over each", "every match", "all of them" are the verdict rebuilt out of
       grammar instead of out of a field: each one asserts a total over a set
       FullShot never enumerated. There is no legitimate use of one in this set —
       a sentence that needs "all" is a sentence counting something the product
       cannot count, and the three integers in redactActsLine are how a total is
       said honestly. Cheaper to ban the word than to argue about each instance. */
    const quantifier = all.match(/\b(each|every|all)\b/gi) || [];
    check('...and none of them quantifies over a set FullShot never enumerated',
      quantifier.length === 0, quantifier.join(',') || 'none');
    /* "…walking this page" is a statement about FullShot. "This page draws its
       text as a picture" was an inference ABOUT THE PAGE, and 54 translations of
       that inference once existed. The difference is where the sentence starts,
       so that is what is graded. */
    check('...and none of them makes a claim about the page instead of the act',
      !/(^|[.!?]\s+)this page\b/i.test(all) && !/found nothing to hide/i.test(all),
      (all.match(/(^|[.!?]\s+)this page[^.!?]*/gi) || []).join(' | ') || 'none');
    /* A count that no CLDR category can select on must not pretend to. The acts
       line carries THREE, and fsPluralMessage resolves against the first — a
       form that agrees with `matched` is wrong about the other two. */
    check('the three-count stats line is not declared as a plural base',
      P.PLURAL_BASES.indexOf('redactActsLine') < 0 &&
      !en.redactActsLineOne && !en.redactActsLineOther,
      P.PLURAL_BASES.join(','));
    /* The constraint has to reach the translator, because nothing downstream
       can check what they write. */
    const bare = redKeys.filter(k => !/FORBIDDEN|AWAITING-TRANSLATION/.test(en[k].description || ''));
    check('every redaction string carries its constraint in the description',
      bare.length === 0, bare.join(',') || redKeys.length + ' described');
    /* The retired keys must be GONE from the English file, not merely unused: a
       loaded sentence left in place is a loaded sentence one edit from being
       reused. All 21 were AWAITING-TRANSLATION, so nothing translated was lost. */
    const retired = ['resultRedactNoTextLayer', 'resultRedactCoveredOne', 'resultRedactCoveredOther',
      'resultRedactReadNoMatch', 'resultRedactReadNoMatchBlind', 'resultRedactNoCoverableText',
      'resultRedactIncomplete', 'resultRedactPassNotRun', 'resultRedactDerived',
      'resultRedactUnknown', 'resultRedactWhyUncovered', 'resultRedactWhyLate',
      'resultRedactWhyNotVerified', 'resultRedactWhyNotPainted', 'resultRedactWhyFrames',
      'resultRedactWhyCeiling', 'resultRedactWhyTimedOut', 'resultRedactWhyDeclined',
      'resultRedactWhyLateText', 'resultRedactWhyWalk', 'resultRedactWhyUnnamed'];
    const left = retired.filter(k => !!en[k]);
    check('the verdict sentences are gone, not orphaned', left.length === 0, left.join(','));
    /* ...and gone from every generated locale too, or Chrome still serves them
       and the next reader finds 54 translations of a sentence nobody can show. */
    const stillThere = [];
    for (const [code, m] of Object.entries(disk)) {
      for (const k of retired) if (m && m[k] !== undefined) stillThere.push(code + ':' + k);
    }
    check('...and gone from all 54 generated locales as well',
      stillThere.length === 0, stillThere.slice(0, 6).join(' | ') ||
      Object.keys(disk).length + ' locales clean');
  }

  /* ---- coverage (reported, not graded: English fallback is correct behaviour) ---- */
  console.log('\n=== translation coverage ===');
  {
    /* AWAITING-TRANSLATION — DECLARED, NOT INFERRED, and the declaration lives
       ON THE STRING.

       A new English key makes every one of the 54 memories "partial" the
       instant it lands, and the check below exists so a translator's pass
       cannot stop halfway and leave a locale looking finished. Those are two
       different situations and they were previously indistinguishable, which
       left exactly two ways out: fabricate 54 translations of a sentence
       nobody has translated, or delete the check. Both are worse than the
       problem.

       So a key may declare itself pending by carrying AWAITING-TRANSLATION in
       its English `description` — where the translator will read it, and where
       the person who commissions the translation removes it in the same edit
       that lands the first one. Two rules keep it from becoming a loophole:

         1. a pending key must be absent from EVERY memory. The moment one
            locale translates it, the marker is a lie and this tier says so —
            which is the only state in which the marker could hide real
            half-finished work.
         2. the exemption is per-KEY, not per-locale. A memory that is missing
            anything else is still half-finished and still red.

       `--request` already prints the work order for these; nothing here makes
       them less visible, and the English fallback is correct behaviour in the
       meantime. */
    const pending = enKeys.filter(k => /AWAITING-TRANSLATION/.test(en[k].description || ''));
    const pendingSet = new Set(pending);
    const leaked = [];
    for (const [code, mem] of Object.entries(ctx.tm || {})) {
      for (const k of pending) if (mem && mem[k] !== undefined) leaked.push(code + ' ' + k);
    }
    check('a key declared AWAITING-TRANSLATION is genuinely untranslated everywhere',
      leaked.length === 0, leaked.slice(0, 6).join(' | ') ||
      pending.length + ' pending key(s), none translated anywhere');

    let full = [], partial = [], none = [], stalled = [];
    for (const l of targets) {
      const built = G.buildLocale(l.code, ctx);
      const keys = Object.keys(built.messages);
      const total = keys.length;
      const done = built.notes.translated;
      /* How many of this locale's untranslated entries are the declared-pending
         ones. Everything above that number is a genuinely half-finished pass. */
      /* A pending plural base excuses every category form it expands into —
         `sk` needs resultRedactCoveredFew and English has no such key to
         declare, so the declaration is made on the English forms and read
         through the base. */
      const excused = keys.filter(k => {
        if (pendingSet.has(k)) return true;
        const sp = P.splitPluralKey(k);
        return !!sp && (pendingSet.has(sp.base + 'One') || pendingSet.has(sp.base + 'Other'));
      }).length;
      if (done === total) full.push(l.code);
      else if (done > 0) {
        partial.push(l.code + ' ' + done + '/' + total);
        if (done + excused < total) stalled.push(l.code + ' ' + done + '/' + (total - excused));
      } else none.push(l.code);
    }
    console.log('      complete (' + full.length + '/54): ' + full.join(' '));
    if (partial.length) console.log('      partial: ' + partial.join(' · '));
    console.log('      english fallback only (' + none.length + '): ' + none.join(' '));
    if (pending.length) console.log('      awaiting translation (' + pending.length + ' keys): ' + pending.join(' '));
    check('no translation memory is left half-finished (pending keys excepted)',
      stalled.length === 0, stalled.join(' · ') || 'every TM present is complete but for declared-pending keys');
  }

  /* ---- translated, not merely present ----
     The checks above grade SHAPE: 55 codes declared, keys in parity, placeholders
     intact, JSON valid. A locale file copied verbatim from English passes every
     one of them. That is not hypothetical — the first generation run produced 23
     byte-identical English copies and this tier stayed green, because absence of
     work looks exactly like presence of a file. A locale of English is WORSE than
     a missing one: Chrome serves it as Hindi, the listing advertises Hindi, and
     the user gets English — a false claim of support. Content is the only thing
     that can tell finished from abandoned. */
  console.log('\n=== translated, not merely present ===');
  {
    const fsx = require('fs'), pathx = require('path');
    const read = c => fsx.readFileSync(pathx.join(__dirname, '..', '_locales', c, 'messages.json'), 'utf8');
    const enRaw = read('en');
    // en_AU / en_GB / en_US are legitimately near-identical to en; nothing else is.
    const nonEnglish = targets.filter(l => !/^en(_|$)/.test(l.code));

    const copies = nonEnglish.filter(l => { try { return read(l.code) === enRaw; } catch (_) { return true; } });
    check('no locale is a byte-identical copy of English', copies.length === 0,
      copies.length ? copies.length + ' copies: ' + copies.map(l => l.code).join(',') : 'none');

    const seen = new Map(), dupes = [];
    for (const l of nonEnglish) {
      let raw; try { raw = read(l.code); } catch (_) { continue; }
      if (seen.has(raw)) dupes.push(seen.get(raw) + '=' + l.code); else seen.set(raw, l.code);
    }
    check('no two locales are byte-identical to each other', dupes.length === 0,
      dupes.length ? dupes.slice(0, 6).join(' ') : 'none');

    /* A few values may legitimately match English — a product name, a symbol, a
       format token — so require a high proportion to differ rather than all. */
    const flat = [];
    for (const l of nonEnglish) {
      let m; try { m = JSON.parse(read(l.code)); } catch (_) { flat.push(l.code + ':unreadable'); continue; }
      const keys = enKeys.filter(k => m[k] && en[k] && typeof m[k].message === 'string');
      if (!keys.length) { flat.push(l.code + ':empty'); continue; }
      const same = keys.filter(k => m[k].message === en[k].message).length;
      if (same / keys.length > 0.5) flat.push(l.code + ':' + Math.round(100 * same / keys.length) + '%');
    }
    check('every locale differs from English in most of its messages', flat.length === 0,
      flat.length ? flat.slice(0, 8).join(' ') : 'all differ');

    /* A locale written in its own script cannot be English. This is the cheapest
       unambiguous signal for the non-Latin half of the list. */
    const SCRIPT = {
      hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, gu: /[઀-૿]/,
      ta: /[஀-௿]/, te: /[ఀ-౿]/, kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/,
      ja: /[぀-ヿ]/, ko: /[가-힯]/, zh_CN: /[一-鿿]/, zh_TW: /[一-鿿]/,
      ar: /[؀-ۿ]/, fa: /[؀-ۿ]/, he: /[֐-׿]/, am: /[ሀ-፿]/,
      th: /[฀-๿]/, el: /[Ͱ-Ͽ]/, ru: /[Ѐ-ӿ]/, uk: /[Ѐ-ӿ]/,
      bg: /[Ѐ-ӿ]/, sr: /[Ѐ-ӿ]/,
    };
    const wrongScript = Object.keys(SCRIPT).filter(c => {
      try { return !SCRIPT[c].test(read(c)); } catch (_) { return true; }
    });
    check('every non-Latin locale contains its own script', wrongScript.length === 0,
      wrongScript.length ? wrongScript.join(',') : Object.keys(SCRIPT).length + ' scripts present');
  }

  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
  process.exit(FAILS ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
