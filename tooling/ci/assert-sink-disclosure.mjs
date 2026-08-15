#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-sink-disclosure.mjs — a published DENIAL, scoped against every live
// sink that declares what it receives.
//
// [pipeline K-5] "The commercial surface names the actual seller and payment
// path" — this is the limb that extends it from WHO IS PAID to WHAT IS HELD.
//
// 🔴 WHY THIS FILE EXISTS. On 2026-08-05 a published privacy claim was FALSE and
// NO GUARD COULD SEE IT. sites/nikatru/privacy.html said "We do not collect or
// store your IP address"; the self-hosted GlitchTip on the Oracle box was
// storing `user.ip_address`, re-observed on two independent events. It has since
// been fixed at the sink and verified by observation (Private/knowledge/session-notes.md
// §17). Every existing check was structurally blind to it:
//
//   · assert-policy-claims.mjs compares published TEXT to repo TEXT. It can
//     prove the site says what the register says, and nothing more. All 39 claim
//     rows matched while TWO of the sentences they described were false.
//   · The one row that IS typed `code` for that sentence asserts
//     `absent(cf-connecting-ip)` over ONE file, and its own `why` concedes it
//     "is not a dataflow proof".
//   · tooling/legal/data-inventory.json declares 19 stores and every one of them
//     is Cloudflare D1 or KV. The strings `glitchtip`, `oracle`, `sentry` and
//     `ip_address` appear NOWHERE in it. The only personal-data store outside
//     Cloudflare was invisible BY CONSTRUCTION — not overlooked, unrepresentable.
//
// tooling/legal/provider-register.json is the one artifact that already knew the
// crash rail is `oracle-cloud · infrastructure · live`. So the obligation is
// attached to the register that knows the sink exists: every live infrastructure
// provider DECLARES the personal-data categories it receives and retains, and
// every published "we do not collect / do not store X" is scoped against the
// union of those declarations.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE CEILING, SAID BEFORE ANYTHING ELSE, BECAUSE OVERCLAIMING HERE WOULD
// RECREATE THE EXACT DEFECT THIS GUARD ANSWERS.
//
// A repo-resident guard can see a DECLARED category on a register row. It can
// NEVER see the sink. If somebody reconfigures GlitchTip to store IP addresses
// again — or moves a category from `receives` to `transits` — without editing
// this register, THIS GUARD STAYS GREEN. Nothing in a push-gated CI job can
// observe a Django setting on an Oracle VM whose compose file lives at
// /opt/glitchtip and is in no tree CI can read.
//
// Under this repository's gate-vs-monitor rule (Private/company/PROJECT_STATE.md) that
// makes this file:
//   · a GATE for THE DECLARATION — the falsifier (a register row contradicting
//     a published page) is reachable from the repo with no credentials, it
//     blocks the merge, and its red path is recorded below;
//   · a MONITOR-SHAPED GAP for THE SINK — the falsifier lives outside the repo.
//     Only a probe against the live GlitchTip API closes it, and no such probe
//     exists today. Until one does, the honest claim is "the declaration is
//     consistent with the pages", NEVER "the sink does not store it".
// "The guard is green" and "the requirement holds" are the same sentence only
// for gates. Do not let a roll-up describe this file as proving what a sink does.
// ─────────────────────────────────────────────────────────────────────────────
//
// THE FOUR LIMBS:
//   1. every `infrastructure` row with status `live` declares `receives` (an
//      array of category ids from the register's own `dataCategories`) and a
//      stated `receivesBasis`. A live sink that declares nothing is the state
//      that made the original defect invisible.
//   2. every published denial is EXTRACTED FROM THE PAGE, not listed here. The
//      domain is the visible text of the same documents assert-policy-claims.mjs
//      reads, so "the page denies X" means one thing in this repo and not two.
//   3. a denial whose object resolves to a declared category that a LIVE sink
//      receives → FAIL, naming the claim and the provider.
//   4. a denial that resolves to NO category → FAIL unless it is classified in
//      `denialsOutOfScope`. A new denial cannot be published unscoped, and a
//      classification cannot outlive the sentence it was granted for.
//
// ⚠️ THE TRAP THIS GUARD WAS BUILT AROUND, recorded because the first draft fell
// into it: SCOPE THE DENIAL TO ITS OBJECT, NEVER TO ITS SENTENCE. The real
// sentence on privacy.html is
//     "We do not collect or store your IP address with these records; an
//      approximate location (country, region, city) is determined at our network
//      edge and the IP address itself is discarded."
// Read whole, it contains the tell for `approximate_location` — which Cloudflare
// really does receive — so a sentence-scoped guard goes RED on a page that is
// TRUE, and the fix would have been to weaken it. Clauses are split on `.;:!?`
// and only the text AFTER the denial verb is scanned. Same reason
// assert-policy-claims strips comments before matching: prose that satisfies or
// refutes a check is this repository's most-recorded defect class.
//
// Usage:  node tooling/ci/assert-sink-disclosure.mjs [repoRoot]
// Exit 0 = the declarations and the published denials do not contradict.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { visibleText, normaliseForMatch } from './text-reductions.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const PROVIDERS = join(repoRoot, 'tooling', 'legal', 'provider-register.json');
const CLAIMS = join(repoRoot, 'tooling', 'legal', 'policy-claims.json');

/** The denial verbs. DELIBERATELY NOT `sell`, `share`, `use` or `rent`: those
 *  are claims about a RELATIONSHIP, and scoping them against a list of
 *  categories a processor receives would fire on every true sentence of the form
 *  "we do not sell X" — we hold X precisely so we can operate, and holding is
 *  not selling. This limb is about POSSESSION, and the verbs are the ones that
 *  assert it.
 *
 *  ⚠️ AND DELIBERATELY NOT `never`. "The fingerprint … is never stored alongside
 *  your email" is a real sentence on privacy.html, and its object is a
 *  CO-LOCATION, not a category. Including `never` made this guard red on a true
 *  page, which is the false-positive that gets a guard switched off. */
const DENIAL_RE = /\b(?:do|does)\s+not\s+(?:knowingly\s+)?(?:collect|store|retain|keep|log|hold|record)\b/i;

const problems = [];
const prints = [];
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  process.exit(1);
};

const readJson = (path, label) => {
  if (!existsSync(path)) {
    coverageLost(
      `${rel(path)} does not exist, so the ${label} ranged over nothing.`,
      'An absent register is not an empty one: with it gone every denial below resolves to no declared',
      'category and this guard would report a perfectly consistent tree over nothing at all.',
    );
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    coverageLost(`${rel(path)} is not valid JSON (${err.message}).`);
  }
};

const providerReg = readJson(PROVIDERS, 'sink relation');
const claimsReg = readJson(CLAIMS, 'page set');

// ── the vocabulary ──────────────────────────────────────────────────────────
const categories = providerReg.dataCategories && typeof providerReg.dataCategories === 'object'
  ? providerReg.dataCategories
  : {};
const categoryIds = Object.keys(categories).filter((k) => !k.startsWith('_'));
if (categoryIds.length === 0) {
  coverageLost(
    'tooling/legal/provider-register.json declares no `dataCategories`.',
    'That map is what a declaration is written in AND what a published denial is recognised by. Empty, no',
    'denial can ever resolve, no declaration can ever intersect one, and every limb below is vacuous.',
  );
}
for (const id of categoryIds) {
  const c = categories[id];
  if (!c || typeof c.what !== 'string' || c.what.trim() === '') {
    problems.push(
      `category ${JSON.stringify(id)} carries no \`what\`. A category id with no stated meaning is a token two ` +
        'people will read two ways, and the whole point of the vocabulary living in the register is that it is ' +
        'reviewable.',
    );
  }
  if (!Array.isArray(c?.tells) || c.tells.length === 0 || c.tells.some((t) => typeof t !== 'string' || !t.trim())) {
    problems.push(
      `category ${JSON.stringify(id)} declares no usable \`tells\`. The tells are the ONLY way this category is ` +
        'recognised in a published denial; with none it can never be found intersecting a claim, so declaring it ' +
        'on a provider row would buy nothing and read as coverage.',
    );
  }
}

// ── LIMB 1 · every LIVE infrastructure row declares what it receives ────────
const providers = Array.isArray(providerReg.providers) ? providerReg.providers : [];
const liveSinks = providers.filter((p) => p.role === 'infrastructure' && p.status === 'live');
if (liveSinks.length === 0) {
  coverageLost(
    'tooling/legal/provider-register.json declares NO `infrastructure` provider with status `live`.',
    'Every limb below quantifies over that set. With it empty, "no live sink receives what a page denies" is',
    'true of nothing — and the register that already knew about oracle-cloud is exactly what made the',
    'original defect findable at all. A live sink losing its row is the shape this guard exists to refuse.',
  );
}

/** category → the live sinks that declare receiving it. */
const declaredBy = new Map();
/** category → [{ provider, why }] for transit-only declarations. */
const transitedBy = new Map();
for (const p of liveSinks) {
  const where = `provider ${JSON.stringify(p.id)} (${p.name})`;
  if (!Array.isArray(p.receives)) {
    problems.push(
      `${where} is a LIVE infrastructure provider and declares no \`receives\` array. A live sink that says ` +
        'nothing about what it holds is the exact state that made the GlitchTip IP breach unfindable: the ' +
        'register knew the provider existed and nothing anywhere said what landed there. Declare the categories ' +
        '(an empty array is a legitimate answer, and a strong claim — it says this provider retains no personal ' +
        'data at all).',
    );
    continue;
  }
  if (typeof p.receivesBasis !== 'string' || p.receivesBasis.trim() === '') {
    problems.push(
      `${where} declares \`receives\` with no \`receivesBasis\`. The declaration is the ENTIRE trust anchor of ` +
        'this guard — nothing here can observe the sink — so a list with no stated basis is an unreviewable ' +
        'assertion wearing the authority of a check. Say how it was established: an inventory it was derived ' +
        'from, or an observation, with its date.',
    );
  }
  for (const cat of p.receives) {
    if (!Object.prototype.hasOwnProperty.call(categories, cat)) {
      problems.push(
        `${where} declares receiving ${JSON.stringify(cat)}, which is not in the register's own \`dataCategories\`. ` +
          'The vocabulary lives in the register (not in this guard) so that renaming a category out from under ' +
          'the rows using it FAILS instead of quietly matching nothing.',
      );
      continue;
    }
    if (!declaredBy.has(cat)) declaredBy.set(cat, []);
    declaredBy.get(cat).push(p);
  }
  const transits = p.transits && typeof p.transits === 'object' && !Array.isArray(p.transits) ? p.transits : {};
  if (p.transits !== undefined && p.transits !== null && transits !== p.transits) {
    problems.push(
      `${where} declares \`transits\` that is not an object of "<category>": "<reason>". It is a map rather than ` +
        'a list precisely so a transit-only claim cannot be made without stating why the category is seen and ' +
        'not retained.',
    );
  }
  for (const [cat, why] of Object.entries(transits)) {
    if (!Object.prototype.hasOwnProperty.call(categories, cat)) {
      problems.push(`${where} declares transiting ${JSON.stringify(cat)}, which is not a declared category.`);
      continue;
    }
    if (typeof why !== 'string' || why.trim() === '') {
      problems.push(
        `${where} declares ${JSON.stringify(cat)} as transit-only with no reason. \`transits\` is the one way to ` +
          'silence the intersection limb below, so a bare entry in it is an exemption with no argument. State ' +
          'why the category is seen and not retained.',
      );
      continue;
    }
    if (p.receives.includes(cat)) {
      problems.push(
        `${where} declares ${JSON.stringify(cat)} in BOTH \`receives\` and \`transits\`. It is either retained or ` +
          'it is not; a row that says both cannot be read, and the intersection limb would take the stronger ' +
          'reading while a reviewer took the weaker one.',
      );
      continue;
    }
    if (!transitedBy.has(cat)) transitedBy.set(cat, []);
    transitedBy.get(cat).push({ provider: p, why });
  }
}
// ⚠️ GATED ON `problems.length === 0`, and that is not a loophole — it is the
// rule the sibling guards already carry. `coverageLost` exits immediately, so a
// coverage check firing while a SPECIFIC fault is recorded would replace "this
// row declares an unknown category" with "nothing was declared at all": the
// vague message wins and the fix goes to the wrong file. The coverage claim only
// means something when every shape was fine and the domain was STILL empty.
if (declaredBy.size === 0 && problems.length === 0) {
  coverageLost(
    'NOT ONE live infrastructure provider declared a single personal-data category.',
    `${liveSinks.length} live sink(s) exist and the union of what they receive is EMPTY, so every published`,
    '"we do not collect X" below would be scoped against nothing and pass — which is precisely the state that',
    'let a published promise be false for weeks. An empty union is a broken relation, not a clean one.',
  );
}

// ── LIMB 2 · the denials, EXTRACTED FROM THE PAGES ──────────────────────────
// The domain is the served documents, read through the same reduction
// assert-policy-claims.mjs uses. It cannot be shrunk except by editing a page a
// human publishes — a list of denials inside this guard would be a list somebody
// trims when it is inconvenient.
const siteRoot = join(repoRoot, ...String(claimsReg.siteRoot ?? 'sites/nikatru').split('/'));
const pages = Array.isArray(claimsReg.pages) ? claimsReg.pages : [];
if (pages.length === 0) {
  coverageLost(
    'tooling/legal/policy-claims.json declares no `pages`, so no published document was read.',
    'The page set is shared with assert-policy-claims.mjs deliberately: two guards reading two different',
    'idea of "the published pages" is how one of them ends up right about a document nobody serves.',
  );
}

/** [{ page, clause, object }] — `object` is the text AFTER the denial verb. */
const denials = [];
for (const page of pages) {
  const abs = join(siteRoot, page);
  if (!existsSync(abs)) {
    coverageLost(
      `${claimsReg.siteRoot}/${page} is declared in policy-claims.json and does not exist.`,
      'The pages ARE the domain. One that cannot be read contributes no denials, and its promises would be',
      'scoped against nothing while this guard printed ok.',
    );
  }
  const text = normaliseForMatch(visibleText(readFileSync(abs, 'utf8')));
  for (const clause of text.split(/[.;:!?]/)) {
    const m = DENIAL_RE.exec(clause);
    if (!m) continue;
    denials.push({ page, clause: clause.trim(), object: clause.slice(m.index).trim() });
  }
}
if (denials.length === 0) {
  coverageLost(
    'ZERO "we do not collect / do not store" denials were extracted from the published pages.',
    `Read ${pages.length} page(s) and found none. Either the pages were rewritten (a promise this guard was`,
    'built to scope has been withdrawn, which somebody must notice) or the extractor stopped matching. Both',
    'make every limb below range over an empty set while reporting a consistent register.',
  );
}

// ── LIMB 3 + 4 · scope each denial against the declared union ───────────────
const outOfScopeRows = Array.isArray(providerReg.denialsOutOfScope?.rows)
  ? providerReg.denialsOutOfScope.rows
  : [];
const matchedOutOfScope = new Set();

const tellsMatched = (object, id) =>
  categories[id].tells.some((t) => object.toLowerCase().includes(String(t).toLowerCase()));

let scoped = 0;
for (const d of denials) {
  const hit = categoryIds.filter((id) => Array.isArray(categories[id]?.tells) && tellsMatched(d.object, id));

  if (hit.length === 0) {
    const idx = outOfScopeRows.findIndex(
      (r) => r.page === d.page && normaliseForMatch(String(r.denial ?? '')) === d.object,
    );
    if (idx === -1) {
      problems.push(
        `${claimsReg.siteRoot}/${d.page} publishes the denial "${d.object}" and it resolves to NO category in the ` +
          "register's `dataCategories`. An unscoped denial is a promise nothing can ever be compared to — it is " +
          'the shape "We do not collect or store your IP address" had for the whole time it was false. Add the ' +
          'category (which forces somebody to say whether a live sink receives it), or classify the sentence in ' +
          `\`denialsOutOfScope\` with a reason, using exactly: "${d.object}"`,
      );
      continue;
    }
    const row = outOfScopeRows[idx];
    matchedOutOfScope.add(idx);
    if (typeof row.why !== 'string' || row.why.trim() === '') {
      problems.push(
        `denialsOutOfScope row for "${d.object}" (${d.page}) carries no \`why\`. A denial excluded from scoping ` +
          'with no stated reason is a permanent exemption with a polite label.',
      );
      continue;
    }
    prints.push(
      `OUT OF SCOPE · ${d.page} — "${d.object}" is not scoped against any sink. ${row.why}`,
    );
    continue;
  }

  scoped++;
  for (const cat of hit) {
    const sinks = declaredBy.get(cat) ?? [];
    if (sinks.length > 0) {
      problems.push(
        `${claimsReg.siteRoot}/${d.page} publishes "${d.object}" — which DENIES the category ${JSON.stringify(cat)} ` +
          `— and ${sinks.length} LIVE sink(s) declare receiving it: ` +
          `${sinks.map((s) => `${s.id} (${s.name})`).join(', ')}. ` +
          'The published page and the register contradict each other about personal data. Fix the SINK and ' +
          'update the declaration, or correct the page — and note which way round: the published wording is ' +
          'usually the stronger commitment, so the defect is normally that ingestion never honoured it.',
      );
      continue;
    }
    const transit = transitedBy.get(cat) ?? [];
    if (transit.length > 0) {
      // 🔴 PRINTED ON EVERY RUN, and this is the most important line this guard
      // emits. `transits` is the one declaration that silences the check above,
      // so the escape route is ENUMERATED rather than left implicit — this is
      // the exact list a human has to re-verify against the live sink, because
      // nothing in this repository can.
      prints.push(
        `TRANSIT-ONLY, NOT PROVEN · ${d.page} denies ${JSON.stringify(cat)} and ` +
          `${transit.map((t) => t.provider.id).join(', ')} declare(s) seeing it WITHOUT retaining it. That is a ` +
          'DECLARATION about a sink no repo-resident guard can observe. MONITOR-shaped: only a probe against the ' +
          'live provider closes it.',
      );
    }
  }
}
if (scoped === 0 && problems.length === 0) {
  coverageLost(
    `${denials.length} denial(s) were extracted and NOT ONE resolved to a declared category.`,
    'Every one of them was excused as out of scope, so the intersection limb — the only limb that can fail on',
    'a real contradiction — ran over nothing while the register looked fully classified.',
  );
}

// The other direction: a classification that has outlived its sentence. Same
// rule `disclosureGaps` carry through `stillTrue` — an exemption nobody has to
// re-earn is one that never expires. And an inert one (the denial DOES resolve
// to a category now) reports judgement over nothing, which is the failure mode
// this file's own exemption maps have to avoid too.
outOfScopeRows.forEach((row, idx) => {
  if (matchedOutOfScope.has(idx)) return;
  const still = denials.find((d) => d.page === row.page && d.object === normaliseForMatch(String(row.denial ?? '')));
  if (!still) {
    problems.push(
      `denialsOutOfScope carries a row for "${row.denial}" on ${row.page}, and no such denial is published there ` +
        'any more. Either the sentence was edited (the row describes a document nobody serves) or it was ' +
        'withdrawn (the row is the last trace of a promise that is gone). Retire it, or restore the page.',
    );
    return;
  }
  problems.push(
    `denialsOutOfScope excuses "${row.denial}" on ${row.page} from scoping, and that denial NOW resolves to a ` +
      'declared category. The exemption is inert: it reads as a considered judgement while covering nothing. ' +
      'Remove the row and let the denial be scoped.',
  );
});

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ sink disclosure — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-5] A published "we do not store X" is worth what the SINKS make it worth. This');
  console.error('  guard scopes it against every live infrastructure provider\'s DECLARATION — it is a gate on');
  console.error('  the declaration and cannot see the sink itself. Only a probe against the live provider can.');
  process.exit(1);
}

const unionCount = declaredBy.size;
console.log(
  `ok  sink disclosure — ${liveSinks.length} live infrastructure sink(s) declare ${unionCount} distinct ` +
    `personal-data categor(ies) of ${categoryIds.length} in the vocabulary; ${denials.length} published denial(s) ` +
    `across ${pages.length} page(s), ${scoped} scoped against that union, ${denials.length - scoped} classified ` +
    'out of scope',
);
console.log(
  `    declared union: ${[...declaredBy.entries()].map(([c, ps]) => `${c} (${ps.map((p) => p.id).join('+')})`).sort().join(', ')}`,
);
console.log(
  '    ⚠️ THIS IS A GATE ON THE DECLARATION, NOT ON THE SINK. A register row is repo-resident and checkable;',
);
console.log(
  '       what a live GlitchTip or a live D1 actually stores is not. Reconfigure the sink without editing the',
);
console.log(
  '       row and this guard stays green — that gap is MONITOR-shaped and only a live probe closes it.',
);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (each is a DECLARATION this repository cannot verify from inside) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
