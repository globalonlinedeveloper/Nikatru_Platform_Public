#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-policy-claims.mjs — a published legal promise, paired to the tree.
//
// [pipeline K-3] "Every published legal claim is asserted true of the code."
// [pipeline K-5] "The commercial surface names the actual seller and payment path."
//
// Grouped in one guard because K-5 is K-3's relation with one more pair on it,
// and both read the same three documents. Splitting them would mean parsing
// sites/nikatru/{privacy,terms,refund}.html twice and getting two answers.
//
// 🔴 WHAT THIS GUARD DOES **NOT** DO, SAID FIRST BECAUSE IT MATTERS MOST.
// It does not prove the published pages are true. It proves two much narrower
// things:
//   (1) every emphasised claim on those pages is ACCOUNTED FOR — there is a row
//       for it, and there is no row for a sentence the site no longer makes;
//   (2) the subset of claims that CAN be checked against code still hold.
// A row typed `descriptive` carries no assertion at all: it records that a human
// read the sentence and wrote down why nothing in the tree can refute it. Do not
// let a roll-up describe this file as "every published claim asserted true of
// the code" — only `code` rows are, and they are a minority by design, because
// pretending otherwise is how a guard stops meaning anything.
//
// WHY THE DOMAIN IS THE PAGE AND NOT THE REGISTER. The set this quantifies over
// is the <b>/<strong> spans in the VISIBLE TEXT of the published pages, read
// through tooling/ci/text-reductions.mjs — the same reduction check-site-integrity.mjs
// measures its stub floor with, so "the page says X" means one thing in this
// repository and not two. That set cannot be shrunk except by editing a document
// a human publishes. A register whose domain was its own rows would be a list
// people trim; this one is a relationship between two artefacts, in both
// directions:
//     a span with no row  → FAIL (a new promise was published unrecorded)
//     a row with no span  → FAIL (a row outlived the sentence it described)
//
// THE PRINT/FAIL SPLIT. Four things are wrong on these pages today and every one
// of them is fixed by editing published legal copy, which only the owner does
// (OWNER_QUEUE O-3). Those are `known-gap` rows and `disclosureGaps`, and they
// PRINT on every run rather than failing the build — failing CI on owner-only
// work blocks every other lane and teaches people to switch the guard off. What
// stops that becoming a permanent exemption: each gap declares `stillTrue`, a
// probe against the page it complains about, and this guard FAILS when the probe
// stops matching. A gap cannot outlive its reason.
//
// Usage:  node tooling/ci/assert-policy-claims.mjs [repoRoot]
// Exit 0 = clean, 1 = a pairing broke, an assertion failed, or the scan lost its
// coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import {
  emphasisedSpans,
  visibleText,
  normaliseForMatch,
  stripSourceComments,
  stripStringLiterals,
} from './text-reductions.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const CLAIMS = join(repoRoot, 'tooling', 'legal', 'policy-claims.json');
const PROVIDERS = join(repoRoot, 'tooling', 'legal', 'provider-register.json');

/** Where Worker route declarations live. The K-5 route limb walks this. */
const SERVICES = join(repoRoot, 'services');

/** A walk that finds fewer files than this has broken, not shrunk. Measured on
 *  the tree the day this guard landed: 7 route/entry files under services/. */
const MIN_ROUTE_FILES = 5;

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
      'An absent register is not an empty one. A guard whose right-hand side is missing rejects',
      'nothing and prints ok — see tooling/legal/README.md for why these files are IN-TREE and not',
      'under company/, which is gitignored and invisible to CI.',
    );
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    coverageLost(`${rel(path)} is not valid JSON (${err.message}).`, 'A register that cannot be parsed cannot be compared to anything.');
  }
};

const claimsReg = readJson(CLAIMS, 'claims relation');
const providerReg = readJson(PROVIDERS, 'provider relation');

// ── §1 · THE CLAIMS RELATION ────────────────────────────────────────────────
const siteRoot = join(repoRoot, ...String(claimsReg.siteRoot ?? 'sites/nikatru').split('/'));
const pages = Array.isArray(claimsReg.pages) ? claimsReg.pages : [];
if (pages.length === 0) {
  coverageLost('policy-claims.json declares no `pages`, so no document was read.');
}

/** page → Map(normalised claim → raw text as published) */
const spansByPage = new Map();
let totalSpans = 0;
for (const page of pages) {
  const abs = join(siteRoot, page);
  if (!existsSync(abs)) {
    coverageLost(
      `${claimsReg.siteRoot}/${page} is declared in policy-claims.json and does not exist.`,
      'The pages ARE the domain. One that cannot be read makes every claim on it vacuously paired.',
    );
  }
  const found = new Map();
  for (const span of emphasisedSpans(readFileSync(abs, 'utf8'))) {
    if (!found.has(span.text)) found.set(span.text, span.raw);
  }
  if (found.size === 0) {
    coverageLost(
      `${claimsReg.siteRoot}/${page} yielded ZERO emphasised spans.`,
      'Either the page lost its <b>/<strong> markup in a rewrite, or the extractor stopped matching.',
      'Both make this guard report a perfectly paired register over an empty set.',
    );
  }
  spansByPage.set(page, found);
  totalSpans += found.size;
}

const rows = Array.isArray(claimsReg.claims) ? claimsReg.claims : [];
if (rows.length === 0) {
  coverageLost('policy-claims.json declares no `claims` rows, so the pairing had nothing on its left side.');
}

const TYPES = new Set(['code', 'provider', 'descriptive', 'known-gap']);
/** page → Set(claim) covered by a row */
const rowsByPage = new Map(pages.map((p) => [p, new Map()]));
for (const row of rows) {
  if (!rowsByPage.has(row.page)) {
    problems.push(
      `a claims row names page ${JSON.stringify(row.page)}, which is not in the declared page set ` +
        `(${pages.join(', ')}). Either the page was added to the site and not to \`pages\`, or the row is a typo ` +
        'filed against a document nobody reads.',
    );
    continue;
  }
  if (!TYPES.has(row.type)) {
    problems.push(
      `${row.page} row ${JSON.stringify(row.claim)} has type ${JSON.stringify(row.type ?? null)}, which is not one of ` +
        `${[...TYPES].join(' / ')}. The type decides whether this row carries an assertion; an unknown one would be ` +
        'silently treated as the weakest kind.',
    );
    continue;
  }
  const normalised = normaliseForMatch(String(row.claim ?? ''));
  if (rowsByPage.get(row.page).has(normalised)) {
    problems.push(
      `${row.page} has TWO rows for the claim ${JSON.stringify(row.claim)}. One span, one row — a duplicate ` +
        'makes the both-directions comparison ambiguous and lets a stale row hide behind a live one.',
    );
    continue;
  }
  rowsByPage.get(row.page).set(normalised, row);
}

// Direction A: every published span has a row.
for (const [page, spans] of spansByPage) {
  for (const [claim, raw] of spans) {
    if (!rowsByPage.get(page).has(claim)) {
      problems.push(
        `${claimsReg.siteRoot}/${page} emphasises ${JSON.stringify(raw)} and tooling/legal/policy-claims.json has no ` +
          'row for it. A newly emphasised sentence on a legal page is a new published promise; it gets a row saying ' +
          'what in this tree makes it true, or a row saying honestly that nothing does.',
      );
    }
  }
}
// Direction B: every row describes a span that is still published.
for (const [page, byClaim] of rowsByPage) {
  const spans = spansByPage.get(page);
  for (const [claim, row] of byClaim) {
    if (!spans.has(claim)) {
      problems.push(
        `tooling/legal/policy-claims.json carries a row for ${JSON.stringify(row.claim)} on ${page}, and that page no ` +
          'longer emphasises it. Either the sentence was edited (the row describes a document nobody serves) or it ' +
          'was deleted (the row is the last trace of a promise that was withdrawn). Retire it, or restore the page.',
      );
    }
  }
}

// ── §2 · THE CODE ASSERTIONS ────────────────────────────────────────────────
// Only `code` rows get here. Each names files (or a walk) and a pattern, and the
// pattern either must match or must not. A row whose files do not exist FAILS
// rather than being skipped: a pairing to a deleted file is a pairing to nothing.
const walk = (dir, out = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

let assertionsRun = 0;
for (const row of rows) {
  if (row.type !== 'code') continue;
  const a = row.assert;
  const where = `${row.page} · ${JSON.stringify(row.claim)}`;
  if (!a || typeof a.pattern !== 'string' || (a.kind !== 'present' && a.kind !== 'absent')) {
    problems.push(
      `${where} is typed \`code\` and carries no usable \`assert\` block (kind must be "present" or "absent" and ` +
        '`pattern` must be a string). A code row with no assertion is a descriptive row claiming to be proof, which ' +
        'inflates the apparent strength of this whole register.',
    );
    continue;
  }
  if (typeof a.why !== 'string' || a.why.trim() === '') {
    problems.push(`${where} carries an assertion with no \`why\`. A regex with no stated reading is unreviewable.`);
    continue;
  }

  let files = [];
  if (Array.isArray(a.files)) {
    files = a.files.map((f) => join(repoRoot, ...f.split('/')));
    const missing = a.files.filter((f) => !existsSync(join(repoRoot, ...f.split('/'))));
    if (missing.length) {
      problems.push(
        `${where} asserts over ${missing.join(', ')}, which do(es) not exist. The claim is paired to a file that is ` +
          'gone, so the pairing proves nothing — re-point it at whatever replaced the file, or retype the row.',
      );
      continue;
    }
  } else if (a.walk && typeof a.walk.root === 'string' && typeof a.walk.filenameRe === 'string') {
    const nameRe = new RegExp(a.walk.filenameRe);
    files = walk(join(repoRoot, ...a.walk.root.split('/').filter((s) => s !== '.'))).filter((f) =>
      nameRe.test(f.split(sep).pop()),
    );
    const floor = Number(a.walk.minFiles ?? 0);
    if (files.length < floor) {
      coverageLost(
        `${where} walked ${a.walk.root} for /${a.walk.filenameRe}/ and found ${files.length} file(s), floor ${floor}.`,
        'The walk under-reached, so an `absent` assertion would pass by finding nothing to look at.',
        'That is a broken scan reporting a clean tree — the failure this whole file exists to prevent.',
      );
    }
  } else {
    problems.push(`${where} names neither \`files\` nor a \`walk\`, so its assertion has no subject.`);
    continue;
  }

  // (?i) is written inline in the register for readability; Node's RegExp does
  // not accept it, so it is lifted to a flag here rather than silently treated
  // as literal text — which would make a case-insensitive assertion match nothing.
  let src = a.pattern;
  let flags = '';
  const inline = src.match(/^\(\?([ims]+)\)/);
  if (inline) {
    flags = inline[1];
    src = src.slice(inline[0].length);
  }
  let re;
  try {
    re = new RegExp(src, flags);
  } catch (err) {
    problems.push(`${where} has an unparseable pattern (${err.message}).`);
    continue;
  }

  assertionsRun++;
  // 🔴 COMMENTS OUT BEFORE MATCHING, ALWAYS. The first run of this guard failed
  // its own `cf-connecting-ip` assertion on the line "CF-Connecting-IP is NEVER
  // read and NEVER stored" — a comment saying the thing does not happen matching
  // a pattern looking for it happening. Prose satisfying (or refuting) a check is
  // this repository's most-recorded defect class, and a guard that greps prose
  // reports the opposite of the truth exactly when the code is right.
  // `strip: "literals"` additionally blanks string bodies, for the SQL column
  // scan where a name inside a quoted string is not a column declaration.
  const reduce = (f) => {
    const ext = `.${f.split('.').pop()}`;
    const noComments = stripSourceComments(readFileSync(f, 'utf8'), ext);
    return a.strip === 'literals' ? stripStringLiterals(noComments) : noComments;
  };
  const hits = files.filter((f) => re.test(reduce(f)));
  if (a.kind === 'present' && hits.length === 0) {
    problems.push(
      `${where} — the page publishes this claim and NOTHING in ${
        a.files ? a.files.join(', ') : `${a.walk.root} (${files.length} file(s))`
      } matches /${a.pattern}/. ${a.why} The page still says it; the code no longer does it.`,
    );
  }
  if (a.kind === 'absent' && hits.length > 0) {
    problems.push(
      `${where} — the page publishes this claim and ${hits.map((h) => rel(h)).join(', ')} matches /${a.pattern}/, ` +
        `which the claim says does not happen. ${a.why}`,
    );
  }
}

// ── §3 · THE PROVIDER RELATION (K-5) ────────────────────────────────────────
const providers = Array.isArray(providerReg.providers) ? providerReg.providers : [];
if (providers.length === 0) {
  coverageLost(
    'tooling/legal/provider-register.json declares no providers.',
    'Every limb below quantifies over that array. An empty register names no wrong provider, ever.',
  );
}
const byId = new Map(providers.map((p) => [p.id, p]));
const roles = providerReg.roles && typeof providerReg.roles === 'object' ? providerReg.roles : {};
for (const p of providers) {
  if (!Object.prototype.hasOwnProperty.call(roles, p.role)) {
    problems.push(
      `provider ${JSON.stringify(p.id)} has role ${JSON.stringify(p.role)}, which is not defined in the register's own ` +
        '`roles` dictionary. The vocabulary lives in the register (not in this guard) so that renaming a role out ' +
        'from under the rows still using it fails instead of quietly meaning nothing.',
    );
  }
  if (!Array.isArray(p.tells) || p.tells.length === 0) {
    problems.push(
      `provider ${JSON.stringify(p.id)} declares no \`tells\`. The tells are how a provider is recognised in page ` +
        'text and in a route path; a row with none can never be matched and so can never be found missing.',
    );
  }
}

// (a) every `provider`/`known-gap` claims row resolves to a real register row.
let providerLinks = 0;
for (const row of rows) {
  if (!Array.isArray(row.providers)) continue;
  for (const id of row.providers) {
    providerLinks++;
    if (!byId.has(id)) {
      problems.push(
        `${row.page} · ${JSON.stringify(row.claim)} names provider ${JSON.stringify(id)}, which has no row in ` +
          'tooling/legal/provider-register.json. A page naming a company the register does not know is exactly the ' +
          'state K-5 exists to make impossible.',
      );
    }
  }
}

// (b) every row that claims a page names it, is actually named there.
let namedInChecks = 0;
for (const p of providers) {
  for (const page of Array.isArray(p.namedIn) ? p.namedIn : []) {
    namedInChecks++;
    const abs = join(siteRoot, page);
    if (!existsSync(abs)) {
      problems.push(`provider ${p.id} claims to be named in ${page}, which does not exist under ${claimsReg.siteRoot}/.`);
      continue;
    }
    const text = normaliseForMatch(visibleText(readFileSync(abs, 'utf8'))).toLowerCase();
    if (!p.tells.some((t) => text.includes(String(t).toLowerCase()))) {
      problems.push(
        `provider ${p.id} (${p.name}) is recorded as named in ${page}, and none of its tells ` +
          `(${p.tells.join(', ')}) appear in that page's visible text. Either the page was rewritten and dropped the ` +
          'provider, or the register claims a disclosure that was never made.',
      );
    }
  }
}

// (c) the merchant-of-record rule: a LIVE merchant of record is the legal seller
//     for a website purchase, so the two documents a buyer reads about that
//     purchase — the terms and the refund policy — must both name it.
let morRows = 0;
for (const p of providers) {
  if (p.role !== 'merchant_of_record') continue;
  morRows++;
  const required = ['terms.html', 'refund.html'];
  const named = new Set(Array.isArray(p.namedIn) ? p.namedIn : []);
  const missing = required.filter((r) => !named.has(r));
  if (p.status === 'live' && missing.length) {
    problems.push(
      `provider ${p.id} (${p.name}) is a LIVE merchant of record and is not named in ${missing.join(' or ')}. ` +
        'The merchant of record IS the seller of a website purchase; a buyer whose terms and refund policy name ' +
        'somebody else has been told the wrong counterparty.',
    );
  } else if (p.status !== 'deferred' && missing.length) {
    // `deferred` is deliberately silent here. tooling/channel-register.json
    // already established that a register carries rows for things we are NOT
    // doing, so the researched facts are recorded once instead of rediscovered
    // under time pressure — and printing "the backup merchant of record is not
    // named in our terms" every run would be printing the absence of a decision
    // nobody has taken. A row that is being pursued (any other non-live status)
    // does print, because that one WILL owe both pages and the gap is real.
    prints.push(
      `MERCHANT OF RECORD NOT YET NAMED: ${p.name} (status ${p.status}) is missing from ${missing.join(' and ')}. ` +
        `Owner item ${p.ownerItem ?? 'unrecorded'}. This is PRINTED, not failed: naming a seller in published terms ` +
        'is copy only the owner publishes, and the seller account does not exist yet. It becomes a build failure ' +
        'the moment this row goes `live`.',
    );
  }
}
if (morRows === 0) {
  problems.push(
    'tooling/legal/provider-register.json declares NO merchant_of_record row. [ADR 004] locked one on 2026-07-23, ' +
      'and a register with no seller row cannot fail the both-pages rule above — the check would range over nothing.',
  );
}

// (d) 🔴 THE ROUTE LIMB — the half that catches a provider arriving in CODE
//     before anybody writes it down. Every literal path segment registered in a
//     Worker must be either a provider's tell or a segment the register claims
//     as ours. Adding `app.post('/paddle', …)` is red until somebody says which.
const routeFiles = walk(SERVICES).filter((f) => /\.ts$/.test(f) && !/[/\\]test[/\\]/.test(f) && /[/\\]src[/\\]/.test(f));
if (routeFiles.length < MIN_ROUTE_FILES) {
  coverageLost(
    `found ${routeFiles.length} Worker source file(s) under services/, expected at least ${MIN_ROUTE_FILES}.`,
    'The route walk under-reached, so "no undeclared provider is reachable" would be true of an empty set.',
  );
}
const allowed = new Set(
  (providerReg.nonProviderRouteSegments?.segments ?? []).map((s) => String(s).toLowerCase()),
);
if (allowed.size === 0) {
  coverageLost(
    'provider-register.json declares no `nonProviderRouteSegments.segments`.',
    'That list is the other half of the route limb: with it empty EVERY segment looks undeclared, and with it',
    'absent the limb cannot distinguish a resource of ours from a payment webhook. Neither is a pass.',
  );
}
const tellSegments = new Map();
for (const p of providers) {
  for (const t of p.tells ?? []) tellSegments.set(String(t).toLowerCase().replace(/[^a-z0-9]/g, ''), p);
}
let routeSegments = 0;
const seenSegments = new Set();
for (const f of routeFiles) {
  // Comments out here too: a route registration quoted in a doc comment is not a
  // route, and a `/paddle` written in a TODO must not satisfy this limb either.
  const src = stripSourceComments(readFileSync(f, 'utf8'), '.ts');
  // ⚠️ THE LEADING SLASH IS LOAD-BEARING. Without it this matched
  // `c.get('requestId')`, `headers.get('content-length')` and
  // `CONFIG_KV.get('config:…')` — three map lookups reported as undeclared
  // payment webhooks. A route path in this codebase always starts with `/`, and
  // a limb that cries wolf on `c.get('userId')` is one somebody deletes.
  for (const m of src.matchAll(/\b[A-Za-z_$][\w$]*\.(?:get|post|put|patch|delete|all|route|on)\(\s*['"](\/[^'"]*)['"]/g)) {
    for (const seg of m[1].split('/')) {
      if (seg === '' || seg.startsWith(':') || seg.startsWith('*')) continue;
      routeSegments++;
      const key = seg.toLowerCase();
      if (seenSegments.has(key)) continue;
      seenSegments.add(key);
      const provider = tellSegments.get(key.replace(/[^a-z0-9]/g, ''));
      if (provider) {
        if (provider.reachableAt === null || provider.reachableAt === undefined) {
          problems.push(
            `${rel(f)} registers a route segment /${seg}, which is provider ${provider.id} (${provider.name}), and ` +
              'that register row says `reachableAt: null` — i.e. no code reaches it. The register is behind the code. ' +
              'Set `reachableAt` to the path, and decide whether the provider now owes a disclosure.',
          );
        }
        continue;
      }
      if (!allowed.has(key)) {
        problems.push(
          `${rel(f)} registers a route segment /${seg} that is neither a provider's tell in ` +
            'tooling/legal/provider-register.json nor listed in its `nonProviderRouteSegments`. A new payment or ' +
            'identity webhook must not be able to land without somebody writing down which it is: add the provider ' +
            'row, or claim the segment as a resource of ours.',
        );
      }
    }
  }
}
if (routeSegments === 0) {
  coverageLost(
    'ZERO route segments were extracted from services/**/src/**/*.ts.',
    'The route-registration pattern stopped matching (a framework change, a rename), so the limb that catches an',
    'undeclared provider arriving in code ran over nothing while printing ok.',
  );
}
// A register row claiming a route that no longer exists is a stale row, and the
// direction matters: it is how a retired integration keeps looking current.
for (const p of providers) {
  if (!p.reachableAt) continue;
  const seg = String(p.reachableAt).split('/').filter(Boolean).pop()?.toLowerCase();
  if (seg && !seenSegments.has(seg)) {
    problems.push(
      `provider ${p.id} declares reachableAt ${JSON.stringify(p.reachableAt)} and no Worker registers that path. ` +
        'Either the integration was removed (retire the row, and check whether a disclosure can be retired with it) ' +
        'or the route moved and the register did not follow.',
    );
  }
}

// ── §4 · THE OWNER-GATED GAPS, PRINTED AND SELF-RETIRING ────────────────────
// Every gap declares `stillTrue`: a fragment that must still be present in the
// page it complains about. When the owner publishes the correction the fragment
// disappears and this guard FAILS, demanding the row be retired. That is what
// stops "printed, not failed" from becoming "ignored, forever".
const gaps = [
  ...(Array.isArray(providerReg.disclosureGaps) ? providerReg.disclosureGaps : []),
  ...rows.filter((r) => r.type === 'known-gap'),
];
let gapsChecked = 0;
for (const g of gaps) {
  const id = g.id ?? `${g.page} · ${JSON.stringify(g.claim)}`;
  if (typeof g.ownerItem !== 'string' || g.ownerItem.trim() === '') {
    problems.push(
      `gap ${id} carries no \`ownerItem\`. A gap that names nobody to resolve it is a permanent exemption with a ` +
        'polite label.',
    );
    continue;
  }
  if (typeof g.stillTrue !== 'string' || g.stillTrue.trim() === '') {
    problems.push(
      `gap ${id} carries no \`stillTrue\` probe. Without one this guard can never tell that the gap has been closed, ` +
        'so the exemption would outlive its reason — which is how every waiver list in this repo went stale.',
    );
    continue;
  }
  const page = g.page;
  const abs = join(siteRoot, String(page ?? ''));
  if (!existsSync(abs)) {
    problems.push(`gap ${id} names page ${JSON.stringify(page)}, which does not exist.`);
    continue;
  }
  gapsChecked++;
  const text = normaliseForMatch(visibleText(readFileSync(abs, 'utf8')));
  if (!text.includes(normaliseForMatch(g.stillTrue))) {
    problems.push(
      `gap ${id} is EXEMPT for a reason that is no longer true: ${page} no longer contains ` +
        `${JSON.stringify(g.stillTrue)}. Either the wording was corrected — retire this gap row, in the same commit ` +
        'as the version bump — or the page was rewritten around it and the gap needs restating. An exemption that ' +
        'nobody has to re-earn is one that never expires.',
    );
    continue;
  }
  prints.push(
    `OWNER-GATED (${g.ownerItem}) · ${id}${page ? ` [${page}]` : ''} — ${g.what ?? g.why}` +
      (g.resolution ? ` RESOLUTION: ${g.resolution}` : ''),
  );
}
// ⚠️ ONLY WHEN NOTHING ELSE IS WRONG. Every skipped gap above already recorded
// a specific problem ("carries no `ownerItem`"), and coverageLost exits
// immediately — so raising it here would REPLACE the precise fault with a vague
// one and send the fix to the wrong file. A guard that reports the wrong fault
// is the failure mode this repository keeps recording; the coverage claim is
// only meaningful when the shapes were all fine and the domain was still empty.
if (gaps.length > 0 && gapsChecked === 0 && problems.length === 0) {
  coverageLost(
    `${gaps.length} owner-gated gap(s) are declared and NONE was checked against a page.`,
    'Nothing verified that any exemption is still earned, so every one of them is permanent.',
  );
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ policy claims — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-3/K-5] A published legal promise with no lane goes wrong silently, and the');
  console.error('  first signal is a store removal. Pair it, or say honestly that nothing asserts it.');
  process.exit(1);
}

const byType = new Map();
for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
console.log(
  `ok  policy claims — ${totalSpans} emphasised claim(s) across ${pages.length} published page(s), each paired ` +
    `(${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')}); ${assertionsRun} code assertion(s) hold`,
);
console.log(
  `    providers — ${providers.length} row(s), ${providerLinks} claim link(s), ${namedInChecks} disclosure(s) ` +
    `verified against page text, ${seenSegments.size} route segment(s) accounted for`,
);
console.log(
  '    ⚠️ only `code` rows carry a mechanical assertion. A `descriptive` row proves the sentence was read, not',
);
console.log('       that it is true. This guard does not prove the pages true and does not claim to.');
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (published legal copy is OWNER work; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
