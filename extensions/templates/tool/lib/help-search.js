// ─────────────────────────────────────────────────────────────────────────────
// search.mjs — the help centre's search, ONE implementation in JavaScript
// (lane help-search). A plain ES module with no import: tooling/help/
// build-index.mjs builds the index with it, the sites serve the same bytes as
// sites/nikatru/js/help-search.mjs, and the extensions bundle the same bytes as
// lib/help-search.js (build-index writes every copy; --check holds them equal).
// packages/help/lib/src/search.dart is the Dart twin; content/help/_eval/
// conformance.json (queries with the ids and scores this file produces) is the
// shared fixture both suites reproduce. No model, no network, no paid API.
//
// THE MODEL: BM25 (k1 = 1.2, b = 0.75) over weighted fields — title ×3,
// "asked" questions ×2, summary ×1.5, body ×1. idf = ln(1 + (N − df + 0.5) /
// (df + 0.5)), N and df over the WHOLE index (scope filtering happens after
// scoring, so a scope never changes a score). Ties break on the id, ascending.
//
// THE TOKENIZER, which the Dart twin matches character for character:
//   1. lower-case;
//   2. split on every run of characters that are neither a letter nor a number
//      (Unicode classes; an apostrophe splits too);
//   3. drop tokens shorter than 2 characters and STOPWORDS;
//   4. stem, in this order: `ies` → `y` (length > 4); a trailing `s` not after
//      `s`, `u` or `i` is dropped (length > 3); a trailing `ing` (length > 5) or
//      `ed` (length > 4) is dropped; then a trailing `e` (length > 4) is dropped.
//
// THE QUERY, beyond the tokenizer:
//   · SYNONYMS. The index carries the locale's table (content/help/_synonyms/
//     <locale>.json, stemmed by build-index): a query term also searches each
//     of its synonyms at SYNONYM_WEIGHT.
//   · TYPOS. A query term of at least TYPO_MIN_LENGTH characters that is not in
//     the index searches every index term within one edit (insert, delete,
//     substitute, or swap two neighbours) that starts with the same letter, at
//     TYPO_WEIGHT.
// Each expanded term counts once, at the highest weight that reached it.
// ─────────────────────────────────────────────────────────────────────────────

export const K1 = 1.2;
export const B = 0.75;
export const FIELD_WEIGHTS = { title: 3, asked: 2, summary: 1.5, body: 1 };
export const SYNONYM_WEIGHT = 0.7;
export const TYPO_WEIGHT = 0.6;
export const TYPO_MIN_LENGTH = 5;

export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'if', 'in', 'is',
  'it', 'its', 'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'why', 'with', 'you', 'your',
]);

/** One token's stem, per rule 4. */
export function stem(token) {
  let t = token;
  if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith('s') && !/[sui]s$/.test(t)) t = t.slice(0, -1);
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  if (t.length > 4 && t.endsWith('e')) t = t.slice(0, -1);
  return t;
}

/** The tokens of `text`, per the rules above. */
export function tokenize(text) {
  const out = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** The weighted term frequencies of one article's fields. */
export function weightedTerms(fields) {
  const tf = new Map();
  let len = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const values = Array.isArray(fields[field]) ? fields[field] : [fields[field] ?? ''];
    for (const v of values) {
      for (const t of tokenize(v)) {
        tf.set(t, (tf.get(t) ?? 0) + weight);
        len += weight;
      }
    }
  }
  return { tf, len };
}

/** Is `b` within one edit of `a` (insert, delete, substitute, adjacent swap)? */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/** The query's terms with their weights: [[term, weight]], sorted by term. */
export function expandQuery(index, query) {
  const weights = new Map();
  const put = (t, w) => {
    if ((weights.get(t) ?? 0) < w) weights.set(t, w);
  };
  const vocab = Object.keys(index.postings);
  for (const t of new Set(tokenize(query))) {
    put(t, 1);
    for (const s of index.synonyms?.[t] ?? []) put(s, SYNONYM_WEIGHT);
    if (!index.postings[t] && t.length >= TYPO_MIN_LENGTH) {
      for (const v of vocab) if (v !== t && v[0] === t[0] && withinOneEdit(t, v)) put(v, TYPO_WEIGHT);
    }
  }
  return [...weights.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * The ranked matches of `query` in `index` (the JSON build-index writes):
 * [{ id, score }], best first, at most `limit`, only from `scopes` (an array) when given.
 */
export function search(index, query, { scopes = null, limit = 10 } = {}) {
  const scores = new Map();
  const n = index.docs.length;
  for (const [term, weight] of expandQuery(index, query)) {
    const posting = index.postings[term];
    if (!posting) continue;
    const idf = Math.log(1 + (n - posting.length + 0.5) / (posting.length + 0.5));
    for (const [d, tf] of posting) {
      const doc = index.docs[d];
      if (scopes !== null && !scopes.includes(doc.scope)) continue;
      const norm = tf + K1 * (1 - B + (B * doc.len) / index.avgdl);
      scores.set(d, (scores.get(d) ?? 0) + (weight * idf * tf * (K1 + 1)) / norm);
    }
  }
  return [...scores.entries()]
    .map(([d, score]) => ({ id: index.docs[d].id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
