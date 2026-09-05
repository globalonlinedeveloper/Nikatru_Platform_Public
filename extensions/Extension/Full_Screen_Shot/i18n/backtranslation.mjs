/* FullShot i18n — BACK-TRANSLATION NEGATION CHECK.  BUILD-TIME ONLY.
   ------------------------------------------------------------------
   WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
   Eight strings in FullShot make a claim about privacy or about a permission.
   The failure that matters is not clumsy phrasing — it is a DROPPED or INVERTED
   NEGATION: "nothing is ever sent anywhere" coming back as "everything is sent",
   or the whole clause simply vanishing.  That is a false claim shipped in 54
   languages nobody on the team reads.

   So: translate the eight strings, translate them BACK to English, and grade the
   back-translation for the polarity of a small number of named claims.  This is
   NOT a style judgement, and it NEVER rewrites anything.  It FLAGS.  A human
   decides.

   THE BACK-TRANSLATION IS NOT AN INDEPENDENT WITNESS, AND THIS FILE WILL NOT
   PRETEND OTHERWISE.  The translations and the back-translations come from the
   same family of model.  A model that misreads a source sentence one way can
   misread it the same way coming back, and the round trip then looks clean
   because the error is shared, not because it is absent.  What survives that
   objection is the mechanical half below: polarity is decided by the closed
   lexicon and the hand-declared claims, never by a model's opinion, so a
   negation MISSING from the back-translated text is caught no matter who wrote
   the text.  What does not survive it is any claim of verification.  A green
   run means the negations are still there.  It does not mean 54 languages have
   been reviewed.

   HOW THE POLARITY TEST WORKS, AND WHY IT IS NOT A CLEVER REGEX.
   The doctrine here is an allowlist of fixed strings plus one generic fallback,
   because this family has twice lost to a regex that tried to be smart about
   untrusted text.  Accordingly:
     * NEG_MARKERS is a CLOSED list of English negation words.  Negative-polarity
       items that merely accompany a negation ("ever", "anywhere", "any") are
       deliberately absent, or "nothing is ever sent anywhere" would count three.
     * Each of the eight strings declares its claims BY HAND below, as anchor
       words plus an expected polarity.  Nothing is inferred from the sentence.
     * Scope is the segment between STRONG boundaries — . ; : ! ? — – ( ) — and
       commas deliberately do NOT split, because a translator is free to move a
       comma and we must not read that as a change of meaning.

   The asymmetry between the two polarities is on purpose:
     negative claim  -> passes if ANY negation marker precedes the anchor in its
                        segment.  Catches a dropped or moved negation.
     positive claim  -> passes if NO negation marker sits within PROXIMITY tokens
                        before the anchor.  Catches a negation that was ADDED.
                        Scoped tightly so an unrelated negation elsewhere in a
                        long segment does not raise a false alarm.
     present         -> the anchor must simply appear.  Used where the natural
                        English rendering may or may not carry a negation
                        ("was declined" vs "was not granted") and only the
                        presence of the claim is gradeable. */

/* Closed negation lexicon.  Contractions are normalised to "<stem> not" first. */
export const NEG_MARKERS = new Set([
  'not', 'no', 'never', 'none', 'nothing', 'nobody', 'nowhere', 'neither', 'nor',
  'without', 'cannot', 'lacks', 'lack', 'lacking', 'unable', 'absent', 'excluded'
]);

const PROXIMITY = 4;           // tokens before a positive anchor that are examined
const STRONG_BOUNDARY = /[.;:!?()—–·]/g;   // . ; : ! ? ( ) em-dash en-dash middot
const SENTINEL = '\u0001';               // never occurs in real text

/* PRIVACY CLAIM SPEC — the entire set the checker grades.  Adding a ninth
   privacy string means adding an entry here; the generator refuses to run if a
   key marked "PRIVACY STRING" in _locales/en/messages.json has no entry. */
export const CLAIMS = {
  popupExpandToggleTip: {
    english: 'Grow inner scrollable panels and iframes to their full content instead of capturing them as seen. Cross-site frames ask for an extra permission once.',
    anchors: [
      { any: ['permission', 'authoris', 'authoriz', 'consent'], polarity: 'positive', claim: 'a permission IS asked for (not "no permission needed")' },
      { any: ['once', 'one time', 'one-time', 'one-off', 'first time', 'single time', 'just once', 'single occasion', 'first occasion'], polarity: 'present', claim: 'the permission is asked ONCE, not every time' }
    ]
  },
  optionsLead: {
    english: 'Changes are saved automatically and synced to your browser profile.',
    anchors: [
      { any: ['automatic', 'automatically'], polarity: 'positive', claim: 'saving IS automatic' },
      { any: ['sync', 'synced', 'syncs', 'synchronis', 'synchroniz'], polarity: 'positive', claim: 'settings ARE synced to the browser profile' }
    ]
  },
  optionsExpandPermGranted: {
    english: 'Permission granted — frames from other sites are expanded too.',
    anchors: [
      { any: ['granted', 'allowed', 'given', 'approved', 'issued', 'obtained'], polarity: 'positive', claim: 'the permission WAS granted' },
      { any: ['expand', 'expanded', 'grown', 'enlarged', 'unfold', 'unfolded', 'unrolled', 'widened', 'stretched'], polarity: 'positive', claim: 'cross-site frames ARE expanded' }
    ]
  },
  optionsExpandPermMissing: {
    english: 'Without the "read all websites" permission, cross-site frames are captured as seen. Panels and same-site iframes always work.',
    anchors: [
      { any: ['permission', 'authoris', 'authoriz'], polarity: 'negative', claim: 'this is the WITHOUT-the-permission case' },
      { any: ['work', 'works', 'working', 'function', 'functions', 'usable', 'available', 'still'], polarity: 'positive', claim: 'panels and same-site iframes DO still work' }
    ]
  },
  optionsRedactPIIDesc: {
    english: 'Scans the text a page exposes for emails, phone numbers, credit-card numbers, SSNs and API keys, and paints a solid block over what it matches in the saved image. It cannot read text drawn as pixels — a canvas, an image, a PDF, a video frame. Detection runs on your device; nothing is ever sent anywhere. Full-page (document-scroll) captures; the block is permanent, so review the result yourself.',
    anchors: [
      { any: ['sent', 'send', 'sends', 'transmit', 'transmitted', 'uploaded', 'upload', 'shared', 'leaves', 'leave'], polarity: 'negative', claim: 'NOTHING IS EVER SENT ANYWHERE — the highest-value claim in the product' },
      { any: ['local', 'locally', 'device', 'machine', 'computer', 'browser', 'on your'], polarity: 'positive', claim: 'detection happens locally' },
      { any: ['permanent', 'permanently', 'irreversible', 'irreversibl', 'definitive', 'undone', 'reversed', 'reverted', 'reversible', 'cannot be removed'], polarity: 'present', claim: 'the redaction block is permanent' }
    ],
    forbidUnnegated: ['sent to', 'uploaded to', 'sends your', 'shared with']
  },
  scrollclipFormatHint: {
    english: 'GIF plays everywhere. WebM is smaller & smoother (recorded live in your browser).',
    anchors: [
      { any: ['browser', 'device', 'locally', 'machine', 'computer'], polarity: 'positive', claim: 'the recording happens in the user\'s own browser' }
    ]
  },
  batchPermissionHint: {
    english: 'Opening these pages needs one-time permission the first time.',
    anchors: [
      { any: ['permission', 'authoris', 'authoriz'], polarity: 'positive', claim: 'a permission IS required' },
      { any: ['once', 'one-time', 'one time', 'one-off', 'first time', 'single', 'only the first', 'first occasion'], polarity: 'present', claim: 'it is asked ONCE' }
    ]
  },
  batchPermissionDeclined: {
    english: 'Permission to open those pages was declined.',
    anchors: [
      { any: ['declined', 'denied', 'refused', 'rejected', 'withheld', 'not granted', 'not given', 'was not', 'turned down'], polarity: 'present', claim: 'the permission was DECLINED (not granted)' }
    ],
    forbidUnnegated: ['was granted', 'has been granted', 'was allowed', 'is granted']
  }
};

export const PRIVACY_KEYS = Object.keys(CLAIMS);

/* ---- engine ---- */

function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
}

/* Segments between strong boundaries.  Commas do NOT split. */
export function segments(text) {
  return normalise(text)
    .replace(STRONG_BOUNDARY, SENTINEL)
    .split(SENTINEL)
    .map(s => s.trim())
    .filter(Boolean);
}

function tokens(seg) {
  return seg.split(/[^a-z0-9'-]+/).filter(Boolean);
}

export function countNegations(text) {
  let n = 0;
  for (const seg of segments(text)) for (const t of tokens(seg)) if (NEG_MARKERS.has(t)) n++;
  return n;
}

/* Locate an anchor.  Multi-word anchors match as a substring of the segment;
   single words match as whole tokens (so "no" never matches inside "nothing"
   and "local" does match "locally" only via the explicit prefix entries). */
function findAnchor(segs, any) {
  for (let si = 0; si < segs.length; si++) {
    const toks = tokens(segs[si]);
    for (const a of any) {
      if (a.includes(' ')) {
        const at = segs[si].indexOf(a);
        if (at >= 0) {
          const before = segs[si].slice(0, at);
          return { si, ti: tokens(before).length, hit: a };
        }
      } else {
        const ti = toks.findIndex(t => t === a || t.startsWith(a));
        if (ti >= 0) return { si, ti, hit: toks[ti] };
      }
    }
  }
  return null;
}

/* Grade ONE back-translated privacy string.
   Returns { key, flags: [...], negEn, negBack }.  flags is empty when clean. */
export function checkBackTranslation(key, backEnglish, englishSource) {
  const spec = CLAIMS[key];
  if (!spec) throw new Error('no privacy claim spec for key: ' + key);
  const flags = [];
  const segs = segments(backEnglish || '');
  const negEn = countNegations(englishSource == null ? spec.english : englishSource);
  const negBack = countNegations(backEnglish || '');

  if (!backEnglish || !String(backEnglish).trim()) {
    return { key, flags: [{ kind: 'EMPTY', detail: 'no back-translation supplied' }], negEn, negBack: 0 };
  }

  for (const a of spec.anchors) {
    const found = findAnchor(segs, a.any);
    if (!found) {
      flags.push({ kind: 'DROPPED', claim: a.claim, detail: 'none of [' + a.any.join(', ') + '] appears in the back-translation' });
      continue;
    }
    if (a.polarity === 'present') continue;

    const toks = tokens(segs[found.si]);
    if (a.polarity === 'negative') {
      /* ANYWHERE in the segment, not only before the anchor.  English is free to
         put the negation after: "if the permission is NOT granted, ..." is the
         same claim as "WITHOUT the permission, ...".  Requiring the marker to
         precede the anchor false-flagged that phrasing during calibration. */
      const marker = toks.find(t => NEG_MARKERS.has(t));
      if (!marker) {
        flags.push({
          kind: 'INVERTED', claim: a.claim,
          detail: '"' + found.hit + '" carries NO negation in its segment — segment was: "' + segs[found.si] + '"'
        });
      }
    } else if (a.polarity === 'positive') {
      const window = toks.slice(Math.max(0, found.ti - PROXIMITY), found.ti);
      const marker = window.find(t => NEG_MARKERS.has(t));
      if (marker) {
        flags.push({
          kind: 'INVERTED', claim: a.claim,
          detail: 'negation "' + marker + '" sits immediately before "' + found.hit + '" — segment was: "' + segs[found.si] + '"'
        });
      }
    }
  }

  for (const phrase of (spec.forbidUnnegated || [])) {
    for (const seg of segs) {
      const at = seg.indexOf(phrase);
      if (at < 0) continue;
      const before = tokens(seg.slice(0, at));
      if (!before.some(t => NEG_MARKERS.has(t))) {
        flags.push({ kind: 'INVERTED', claim: 'forbidden un-negated phrase', detail: '"' + phrase + '" appears with no negation before it — segment was: "' + seg + '"' });
      }
    }
  }

  /* Generic fallback: a total collapse of negation that the named claims missed. */
  if (negEn > 0 && negBack === 0) {
    flags.push({ kind: 'DROPPED', claim: 'generic negation-count fallback', detail: 'English carries ' + negEn + ' negation marker(s); the back-translation carries none' });
  }

  return { key, flags, negEn, negBack };
}
