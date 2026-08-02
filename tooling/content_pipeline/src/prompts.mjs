// ─────────────────────────────────────────────────────────────────────────────
// prompts.mjs — [ADR 019]'s NO-IP-PROMPTING RULE, as a refusal rather than prose.
//
// [pipeline 7]P-2. The rule has existed since 2026-07-24 in the ADR and in the
// root CLAUDE.md, and it bound nothing: no prompt log, no ban-list scanner, no
// pre-submission check anywhere in the tree.
//
// 🔴 THE HALF THAT MATTERS IS THE PRE-SUBMISSION ONE. A post-hoc scan over
// PROVENANCE.json that fires means the money and the exposure were ALREADY spent
// — the generation ran, the asset exists, and on the consumer Gemini route there
// is no IP indemnity behind it ([ADR 019]). So `assertPromptIsClean` is called by
// `generate` BEFORE anything is submitted, and the same function is what
// assert-prompt-provenance.mjs applies to the logged prompts afterwards. One
// list, two moments; they cannot disagree.
//
// ⚠️ THIS MODULE NECESSARILY CONTAINS THE STRINGS IT BANS. A raw-text scanner
// pointed at the repository would therefore flag this file, its tests, and every
// legitimate refusal note in a log — the `r2_buckets`-in-a-comment bug in its
// worst form. The guard that consumes this PARSES PROVENANCE.json and applies
// these patterns to the parsed `prompt` VALUES only. Never grep for them.
//
// ⚠️ AND IT IS A FLOOR, NOT A PROOF. A ban list catches the prompt that names a
// studio; it cannot catch a prompt that describes one closely without naming it.
// [ADR 019]'s actual mitigation stack is this rule PLUS the human review sample
// (P-4) PLUS reverse-image-search on a sample of illustrations. This is the
// cheapest layer, not the only one.
// ─────────────────────────────────────────────────────────────────────────────

/** Each rule is a SHAPE from [ADR 019]'s four bullets, so a reviewer can check
 *  the list against the ADR line by line instead of against taste. */
export const IP_STEERING_RULES = Object.freeze([
  Object.freeze({
    id: 'style-of',
    adr: '[ADR 019] ❌ No "in the style of <studio/artist/brand>"',
    re: /\b(?:in|with)\s+the\s+(?:art\s+)?style\s+of\b|\bstyle\s*[:=]\s*\S/i,
  }),
  Object.freeze({
    id: 'named-studio-or-franchise',
    adr: '[ADR 019] ❌ No named characters, mascots, logos, trademarks or brand names',
    // The four the ADR itself names, plus the handful a generation prompt reaches
    // for by reflex. Word-bounded so "disneyland-trip-phrase" style ids do not
    // false-positive on a substring.
    re: /\b(?:pixar|ghibli|disney|marvel|dc\s+comics|nintendo|pokemon|pok[eé]mon|lego|barbie|minecraft|star\s+wars|harry\s+potter)\b/i,
  }),
  Object.freeze({
    id: 'sounds-like',
    adr: '[ADR 019] ❌ No song titles, artists, or "sounds like <band>" for any audio',
    re: /\bsounds?\s+like\b|\bin\s+the\s+voice\s+of\b|\bcover\s+of\s+["“]/i,
  }),
  Object.freeze({
    id: 'recreate-a-work',
    adr: '[ADR 019] ❌ No "recreate/imitate <specific work>", and no reference image of a protected work',
    re: /\b(?:recreate|re-create|imitate|mimic|replicate|copy)\s+(?:the\s+)?(?:look|style|artwork|character|scene|poster|cover|logo)\b|\breference\s+image\s+of\b/i,
  }),
  Object.freeze({
    id: 'trademark-marker',
    adr: '[ADR 019] ❌ No trademarks — a ™/® in a prompt is a brand being steered toward',
    re: /[™®©]/,
  }),
]);

/** Every violation in `prompt`, or `[]`. */
export function ipSteeringViolations(prompt) {
  if (typeof prompt !== 'string') return [{ id: 'not-a-string', adr: 'a prompt must be a string', match: String(prompt) }];
  const out = [];
  for (const rule of IP_STEERING_RULES) {
    const m = prompt.match(rule.re);
    if (m) out.push({ id: rule.id, adr: rule.adr, match: m[0] });
  }
  return out;
}

/** THE PRE-SUBMISSION REFUSAL. Throws before a generation request is built.
 *  `where` names the recipe item so the operator can find the template. */
export function assertPromptIsClean(prompt, where) {
  const v = ipSteeringViolations(prompt);
  if (v.length === 0) return;
  const lines = v.map((x) => `    ${x.id}: matched "${x.match}" — ${x.adr}`);
  throw new Error(
    `REFUSED before submission — the prompt for ${where} steers toward existing IP:\n${lines.join('\n')}\n` +
      '  Describe function, subject, mood, palette and composition in neutral terms instead.\n' +
      '  Nothing was submitted and nothing was spent. [ADR 019]',
  );
}
