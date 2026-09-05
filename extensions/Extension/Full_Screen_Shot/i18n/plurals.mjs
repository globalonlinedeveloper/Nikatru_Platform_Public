/* FullShot i18n — PLURAL DECLARATION.  BUILD-TIME ONLY, never shipped.
   ---------------------------------------------------------------------
   Chrome's messages.json has NO plural support: no ICU MessageFormat, no
   selector, nothing.  The only shape that works is one KEY PER CLDR CATEGORY,
   chosen at runtime with Intl.PluralRules(uiLocale).select(n).

   PLURAL_BASES IS DECLARED, NOT INFERRED.
   The English file carries `historyCountOne` / `historyCountOther`, and it is
   tempting to detect plurals by that name suffix.  Phase 1 already tripped over
   that: `historyConfirmDeleteOne` ("Delete this screenshot?") carried no count
   at all and was only saved by being renamed `historyConfirmDeleteSingle`.  A
   suffix is a spelling, not a semantic.  So the eight bases below are listed by
   hand and anything else that happens to end in "One" is left alone.

   CATEGORIES COME FROM ICU AT BUILD TIME, NOT FROM A TABLE HERE.
   A hand-written "es/fr/it/pt take one|other" table is ALREADY WRONG: current
   CLDR gives the Romance languages a third category, `many`, for values like
   1000000.  Latvian has `zero`.  Hebrew has `two` and no `many`.  Croatian and
   Serbian have `few` but no `many`, while Russian and Polish have both.  Reading
   Intl.PluralRules at build time means the table can never drift from the
   platform the extension actually runs on. */

export const PLURAL_BASES = [
  'historyCount',            // "$COUNT$ screenshots · $SIZE$"
  'historyCountFiltered',    // "$SHOWN$ of $COUNT$ screenshots · $SIZE$"
  'historyConfirmDeleteMany',// "Delete $COUNT$ screenshots permanently?"
  'historyToastDownloading', // "Downloading $COUNT$ screenshots"
  'resultProgressDecoding',  // "Decoding $COUNT$ frames…"
  'resultToastPdfDone',      // "PDF downloaded ($COUNT$ pages)"
  'scrollclipDims',          // "$W$ × $H$ · $COUNT$ frames · $S$s"
  'batchPlanCount',          // "$COUNT$ pages to capture"
  /* "$COUNT$ match is not covered in this image." THE ONE REDACTION SENTENCE
     THAT SELECTS ON A COUNT, and it is the bolded line a reader acts on — "1
     matches are not covered" on the one sentence in the design that means
     something is where a reader stops believing the rest of it. Its stats half
     is a separate, plural-free key: a sentence with three counts can only agree
     with one of them, because fsPluralMessage resolves against the first
     substitution. */
  'redactActsUncovered'
  /* NO REDACTION BASE ANY MORE. `resultRedactCovered` selected on a count
     inside the product's strongest claim, and that claim is gone
     (REDACTION-CLAIM-SPEC.md §2.2). What replaces it is a STATS LINE carrying
     three counts — "$MATCHED$ matched, $PAINTED$ painted, $VERIFIED$ confirmed
     opaque" — and a sentence with three counts can only agree with one of
     them, because fsPluralMessage resolves against the first substitution. So
     it is a plain message BY DESIGN: the alternative is a form that is right
     about `matched` and wrong about the other two. Sentences that do select on
     a count carry exactly one. */
];

/* THE COUNT PLACEHOLDER MAY BE DROPPED IN A PLURAL FORM.
   Every one of the eight bases selects on a placeholder named `count`, and in
   several languages the idiomatic form for a small number does NOT repeat the
   numeral, because the noun already carries it:
     ar  one  "لقطة واحدة"   two "لقطتان"      (the dual is in the noun)
     he  two  "שתי צילומי מסך"
     sl  two  "dva posnetka"
   Writing "2 لقطتان" back-translates as "2 two-screenshots" and reads as a
   typo to a native speaker.  CLDR and ICU both allow a plural variant that does
   not display the number — the number is what SELECTED the variant, not
   something the variant must echo.  So the placeholder-completeness check
   treats `count` as optional inside a plural form and mandatory everywhere
   else.  Every OTHER placeholder in a plural message ($SIZE$, $SHOWN$,
   $SECONDS$) stays mandatory: dropping those really is a lost value. */
export const PLURAL_COUNT_TOKEN = 'count';

/* CLDR category -> the suffix used in a message key. Fixed order: this is the
   order categories are emitted in, so output byte-order is stable. */
export const CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
export const SUFFIX = { zero: 'Zero', one: 'One', two: 'Two', few: 'Few', many: 'Many', other: 'Other' };

/* The categories a locale actually uses, from the platform's CLDR data. */
export function categoriesFor(bcp47) {
  const cats = new Intl.PluralRules(bcp47).resolvedOptions().pluralCategories;
  return CATEGORY_ORDER.filter(c => cats.includes(c));
}

/* Every message key a locale must carry for one plural base. */
export function pluralKeysFor(base, bcp47) {
  return categoriesFor(bcp47).map(c => base + SUFFIX[c]);
}

/* Is `key` one of the English plural forms (base + One/Other)? */
export function isEnglishPluralKey(key) {
  return PLURAL_BASES.some(b => key === b + 'One' || key === b + 'Other');
}

/* Split a final key into { base, category } if it belongs to a declared base. */
export function splitPluralKey(key) {
  for (const b of PLURAL_BASES) {
    if (!key.startsWith(b)) continue;
    const suf = key.slice(b.length);
    for (const [cat, s] of Object.entries(SUFFIX)) if (s === suf) return { base: b, category: cat };
  }
  return null;
}

/* Which ENGLISH key a locale form is translated FROM, for staleness tracking.
   `one` tracks <base>One; every other category tracks <base>Other, because the
   plural form a locale needs for "few" has no English counterpart to hash. */
export function sourceKeyFor(key) {
  const sp = splitPluralKey(key);
  if (!sp) return key;
  return sp.base + (sp.category === 'one' ? 'One' : 'Other');
}
