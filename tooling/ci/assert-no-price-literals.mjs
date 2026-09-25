#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-price-literals.mjs — [pipeline 5]M-11.
// "A displayed price comes from the rail, never from app code."
//
// 🔴 THE DEFECT THIS IS NAMED AFTER WAS LIVE FOR MONTHS AND NOTHING COULD SEE IT.
// `apps/subscriptiontracker/lib/services/purchases/purchases_service.dart` returned the
// literals `$2.99` and `$24.99`. The owner decided $4.99/mo and $19.99/yr on
// 2026-07-27. Nothing went red — a hardcoded price is consistent with itself
// forever, and the obvious guard (`assert-no-hardcoded-strings.mjs`) excludes
// `apps/subscriptiontracker` wholesale, i.e. excludes the evidence file.
//
// ⚠️ `apps/subscriptiontracker` IS NOT EXCLUDABLE HERE, and the distinction was the point: the
// `assert-no-hardcoded-strings.mjs` freeze covered the l10n retrofit — an
// enormous, scheduled, cosmetic body of work. It never covered a price literal
// that contradicts a decided one, which is a money defect wearing the same
// clothes.
//
// 🔄 THAT FREEZE ENDED 2026-08-11: `assert-no-hardcoded-strings.mjs` now ENFORCES
// on `apps/subscriptiontracker/lib`. This guard is not thereby redundant — a price is not a
// `Text(…)` or a labelling parameter, it is a value inside a service, and the
// two guards look at different positions in different files. Two limbs of the
// same rule would be; these are two rules.
//
// TWO LIMBS:
//   A · NEGATIVE — no price-shaped string literal in shipping source.
//   B · POSITIVE — the paywall renders through the offerings model. Without B,
//       deleting the paywall's price display entirely would pass A.
//
// ⏱ 2026-09-24 — A THIRD LIMB, BECAUSE THE BUYER READS THE LISTING FIRST
// (O-PRICE-GUARD-IS-DART-ONLY):
//   C · LISTING — no price figure and no lifetime plan in any listing TEXT
//       field on any store channel.
// Until today this guard read `.dart` and nothing else, so `Lifetime ₹2,499`
// appended to the Play long description exited 0 here, and the one listing
// check that hunted a price (assert-store-metadata.mjs) read three files of the
// apps-gov-in tree only. [ADR 093] §2 keeps the lifetime plan on the web
// checkout, "and — per §11.2 — no app and no store listing mentions it"; a
// listing states no price at all, because the rail's figure moves and a listing
// nobody re-reads keeps the old one.
// The file set is the vocabulary's, not a suffix: every
// contracts/store/vocabulary.js LISTING_FIELDS entry of `kind: 'text'`, crossed
// with what each tooling/channel-register.json row carries — its surface's
// column, plus the row's own `perChannel.additionalFiles` — in every tree the
// row's `storeMetadataDir` names: each app in catalog/apps.json, each tool under
// extensions/Extension, and the factory that stamps the next one (the app brick,
// the extension template). A README.md or a `url` field is not listing text and
// is not read. The OK line counts per channel, and a channel whose trees yield
// no listing text is COVERAGE LOST by name.
//
// Usage:  node tooling/ci/assert-no-price-literals.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { delegationOfAbs as delegationOf } from './chassis-delegation.mjs';
import { PRICE, LIFETIME } from './price-figure.mjs';
import { LISTING_FIELDS } from '../../contracts/store/vocabulary.js';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const problems = [];
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

// ── the matcher ─────────────────────────────────────────────────────────────
// A price is a currency marker next to a number: symbol-first (`$4.99`, `₹399`),
// `Rs`-first (`Rs 1,499`), code-first (`USD 4.99`) and code-last (`4.99 USD`).
// ⏱ 2026-09-24 (O-PRICE-GUARD-IS-DART-ONLY): the regex that lived here is now
// ./price-figure.mjs, the union of this file's three shapes and the listing
// matcher assert-store-metadata.mjs carried (which added `Rs` and read case-
// insensitively). Both guards import it. The proof below still runs against
// it on every run, before anything is scanned.

/**
 * 🔴 THE MATCHER IS PROVEN AGAINST KNOWN-DIRTY INPUT BEFORE IT IS TRUSTED.
 *
 * `assert-no-hardcoded-strings.mjs` uses `apps/subscriptiontracker` as its canary — a tree
 * known to be full of the thing it looks for. This guard cannot: the whole point
 * of the increment that introduced it is that the last price literals in the
 * repo were DELETED. A canary that has been cleaned is a canary that proves the
 * matcher still matches nothing.
 *
 * So the canary is assembled here, from the exact literals that were live at
 * HEAD `d6ef000` plus the shapes a future one would take. If the regex is
 * broken, this goes red before the tree is scanned — instead of the tree
 * reporting clean because nothing matches any more.
 */
const CANARY = [
  String.raw`r'$2.99'`,
  String.raw`r'$24.99'`,
  "'₹399'",
  "'USD 4.99'",
  "'19.99 EUR'",
  "'£1,299.00'",
  // The listing notations the union added (2026-09-24): if either half of the
  // union is lost, one of these goes unmatched and the run is COVERAGE LOST.
  "'Rs 2,499'",
  "'₹2,499'",
  "'€4.99'",
  "'inr 499'",
];
const NOT_PRICES = [
  "'v1.0.0'",
  "'2026-08-01'",
  "'99'",
  "'4.99'", // a bare number is not a price: no currency marker
  "'width: 24.99'",
  "'#4CAF50'",
];
{
  const missed = CANARY.filter((c) => !PRICE.test(c));
  const falsePositives = NOT_PRICES.filter((c) => PRICE.test(c));
  if (missed.length) {
    coverageLost(
      `the price matcher no longer matches ${missed.join(', ')}. Every clean result below would be a result from a matcher that matches nothing.`,
    );
  } else if (falsePositives.length) {
    problems.push(
      `the price matcher fires on ${falsePositives.join(', ')}, which are not prices. A guard that cries wolf is switched off inside a week.`,
    );
  } else {
    ok(`matcher verified: ${CANARY.length} known price literal(s) matched, ${NOT_PRICES.length} non-price(s) ignored`);
  }
}

// ── the allowlist ───────────────────────────────────────────────────────────
// EVERY ENTRY CARRIES A DATE AND A REASON, AND EXPIRES. An allowlist that cannot
// expire is a permanent opt-out with extra steps.
const ALLOW = [
  // { file: 'path/to/file.dart', until: 'YYYY-MM-DD', why: '…' },
];

const SCAN_ROOTS = ['apps', 'packages', 'tooling/bricks'];
// TESTS ARE EXCLUDED, AND THE REASON IS NARROW: `offering_test.dart` asserts
// that `Offering.formattedPrice` produces `$4.99` from 499 + USD. That literal
// is the ASSERTION about the formatter — removing it would delete the only
// proof that the formatter formats. A price literal in SHIPPING code is the
// defect; in a test of the formatter it is the evidence. Limb B below is what
// stops this exclusion being a hole: the shipping paywall must still route
// through the model.
const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', 'test', 'integration_test']);
const SKIP_PATH = [join('apps', 'probe')];

function walk(dir, out = []) {
  let entries;
  try {
    entries = listDir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) walk(p, out);
    } else if (e.endsWith('.dart')) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r))).filter(
  (f) => !SKIP_PATH.some((skip) => f.startsWith(join(ROOT, skip) + sep)),
);
const rel = (f) => f.replace(ROOT + sep, '').replaceAll('\\', '/');

const MIN_FILES = 40;
if (files.length < MIN_FILES) {
  coverageLost(
    `scanned only ${files.length} dart file(s) under ${SCAN_ROOTS.join(', ')}, expected >= ${MIN_FILES}. The scan is broken, not the tree.`,
  );
} else {
  ok(`scan reaches ${files.length} non-test dart file(s)`);
}

// ── COVERAGE, PER ROOT ──────────────────────────────────────────────────────
// 🔴 THE FLOOR ABOVE IS ONE NUMBER OVER A UNION, AND A UNION FLOOR IS NOT A
// COVERAGE CHECK. It answers "did I see enough files somewhere"; the question is
// "did I see every root I am supposed to see". `packages/` alone clears 40
// several times over, so the whole of `apps/` — every file the $2.99 defect
// lived in — can leave the scan while this guard prints "no price literals".
//
// The roots are DERIVED, because a list written here is the next thing to rot.
// Two sources, each already maintained for its own reasons:
//   · the `workspace:` block in the root `pubspec.yaml` — what `melos run gate`
//     ranges over, kept in step with disk by assert-workspace-coverage.mjs;
//   · the directories that exist under the scan roots.
// The declaration is what covers a root that is GONE: a deleted or renamed
// directory contributes zero BY NAME instead of dropping out of the list.
//
// ⚠️ Residual: a scan root that is absent AND declares nothing under it is not
// floored here.
const SKIP_REL = SKIP_PATH.map((p) => p.split(sep).join('/'));

// A root that legitimately holds no dart file is DECLARED, never inferred from
// its own count — zero is the signal this section exists to read.
const NO_DART = new Map([
  [
    'packages/tokens',
    'a Node package (style-dictionary) that emits design tokens. It contains no Dart at all, which is also why assert-workspace-coverage.mjs cannot see it.',
  ],
]);

function derivedRoots() {
  const roots = new Set();
  const pubspecPath = join(ROOT, 'pubspec.yaml');
  if (existsSync(pubspecPath)) {
    const text = readFileSync(pubspecPath, 'utf8');
    const ws = text.match(/^workspace:\s*$/m);
    if (ws) {
      for (const raw of text.slice(ws.index + ws[0].length).split('\n')) {
        const line = raw.replace(/#.*$/, '');
        if (/^\s*-\s+\S/.test(line)) {
          roots.add(line.replace(/^\s*-\s+/, '').trim().replace(/\/+$/, ''));
        } else if (line.trim() !== '') {
          break; // the first non-item, non-blank line ends the block
        }
      }
    }
  }
  for (const parent of SCAN_ROOTS) {
    let entries;
    try {
      entries = listDir(join(ROOT, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue;
      roots.add(`${parent}/${e.name}`);
    }
  }
  return [...roots]
    .filter((r) => SCAN_ROOTS.some((p) => r.startsWith(`${p}/`)))
    .filter((r) => !SKIP_REL.some((s) => r === s || r.startsWith(`${s}/`)))
    .sort();
}

{
  const relFiles = files.map(rel);
  const roots = derivedRoots();
  const contributed = new Map(roots.map((r) => [r, 0]));
  for (const f of relFiles) {
    for (const r of roots) {
      if (f.startsWith(`${r}/`)) contributed.set(r, contributed.get(r) + 1);
    }
  }
  const quiet = roots.filter((r) => contributed.get(r) === 0 && !NO_DART.has(r));
  if (quiet.length) {
    coverageLost(
      `${quiet.join(', ')} contributed ZERO non-test dart file(s) to the scan. The ${MIN_FILES}-file floor above is a UNION and stayed green because a sibling root covered for it; nothing under the named root(s) was scanned, and "no price literals" below is a claim about a tree that no longer includes them.`,
    );
  } else if (roots.length === 0) {
    coverageLost(
      `no scan root could be derived from \`pubspec.yaml\`'s \`workspace:\` block or from the directories under ${SCAN_ROOTS.join(', ')}, so the per-root check ranged over nothing.`,
    );
  } else {
    const scanned = roots.filter((r) => !NO_DART.has(r));
    const declaredFree = roots.filter((r) => NO_DART.has(r));
    ok(
      `per-root coverage: ${scanned.map((r) => `${r} (${contributed.get(r)})`).join(', ')}` +
        (declaredFree.length ? ` · declared dart-free: ${declaredFree.join(', ')}` : ''),
    );
  }
  // A dart-free declaration that has started producing dart is a stale
  // exemption, and a stale exemption inflates apparent coverage.
  for (const [r, why] of NO_DART) {
    if ((contributed.get(r) ?? 0) > 0) {
      problems.push(
        `\`${r}\` is declared dart-free (${why}) but contributed ${contributed.get(r)} dart file(s). Delete the entry — it is now excusing a root that this guard should be flooring.`,
      );
    }
  }
}

// ── A · no price-shaped literal in shipping source ──────────────────────────
// STRING LITERALS ONLY, comments stripped first. A price in a comment is prose
// (this file's own header contains three), and a guard that matched its own
// explanatory comment is a mistake this repo has already shipped once.
const STRINGS = /r?'(?:[^'\\\n]|\\.)*'|r?"(?:[^"\\\n]|\\.)*"/g;
const today = new Date().toISOString().slice(0, 10);
const hits = [];
const allowUsed = new Set();

for (const f of files) {
  const r = rel(f);
  const src = readFileSync(f, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const found = (src.match(STRINGS) ?? []).filter((s) => PRICE.test(s));
  if (found.length === 0) continue;

  const allow = ALLOW.find((a) => a.file === r);
  if (allow) {
    allowUsed.add(r);
    // 🔴 THE EXPIRY IS ENFORCED AGAINST THE FILE'S CURRENT CONTENT, not merely
    // recorded. An expired entry whose file is still dirty is a failure.
    if (allow.until < today) {
      problems.push(
        `\`${r}\` is allowlisted until ${allow.until}, which has passed, and it STILL contains ${found.length} price literal(s) (${found[0]}). An allowlist that cannot expire is a permanent opt-out with extra steps.`,
      );
    } else {
      notes.push(`⬜ ALLOWED until ${allow.until} · ${r} — ${allow.why}`);
    }
    continue;
  }
  hits.push({ file: r, found });
}

for (const h of hits) {
  problems.push(
    `\`${h.file}\` contains price literal(s): ${h.found.slice(0, 3).join(', ')}. A displayed price must come from the rail config (amount + ISO currency, formatted by \`Offering.formattedPrice\`) — a price compiled into a binary cannot disagree with the price the buyer is charged, which is exactly how $2.99 outlived the $4.99 decision by five days and six store builds.`,
  );
}
if (hits.length === 0) ok('no price literals in shipping source');

// Stale allowlist entries inflate apparent coverage: an exemption for a file
// that is already clean reads as a real one.
for (const a of ALLOW) {
  if (!allowUsed.has(a.file)) {
    problems.push(
      `\`${a.file}\` is allowlisted but contains NO price literal (or does not exist). Delete the entry — a list that has drifted from the tree stops meaning anything.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — THE RAIL-DERIVED PRICE FOLLOWS THE SCREEN INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2; the same resolver assert-a11y-coverage.mjs carries)
//
// [ADR 066] step 4 empties a brick screen into `package:nikatru_chassis_screens`
// and leaves an ADAPTER at the same path: same file, same route, same class
// name, and none of the body. `.formattedPrice` is read where the price is PAINTED, so it moves into the package with the paywall body — and read at the adapter alone the positive limb below reports that the paywall shows no rail-derived price at all, which is the one conclusion it exists to make loud and the one thing that would not be true.
//
// So the scan below reads the adapter AND the chassis file it delegates to.
// This only ever ADDS text: a call site that was found is still found, and one
// that is genuinely absent is still absent. Nothing is removed from any domain
// and no floor is lowered.
//
// ONE LEVEL, ONE IMPORT, EVERY REFUSAL LOUD. Two different chassis imports in
// one adapter is ambiguous and refused; a target that is not on disk is
// COVERAGE LOST. A delegation this resolver cannot follow must never read as
// "no delegation" — that is the silent-pass shape.
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE RULE IS NOT WRITTEN OUT AGAIN HERE. It lives in
// ./chassis-delegation.mjs — one import, one level, the target must be on
// disk, AND THE ADAPTER MUST ACTUALLY USE SOMETHING THE TARGET DECLARES.
// It shipped as eleven near-copies on 2026-09-05 and a review measured seven
// distinct implementations of the same paragraph with nothing in the tree
// comparing them; the module is that finding repaired, and the use check is
// the half whose absence let ONE UNUSED IMPORT silence a DPDP withdrawal
// control and a caps gate. `null` (no delegation) and `{ lost }` (one this
// scan could not follow) stay DIFFERENT ANSWERS: everything below reports
// `lost` as COVERAGE LOST and nothing reads it as "nothing to do".
//
// The ABSOLUTE-path face of it is `delegationOfAbs`, imported above and exported
// by the module: it shipped here as one of THREE byte-identical copies, which is
// the very defect the module exists to end.

// ── B · the POSITIVE limb ───────────────────────────────────────────────────
// Without this, deleting the price from the paywall entirely passes limb A.
{
  const PAYWALL =
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/monetization/paywall_screen.dart';
  const p = join(ROOT, PAYWALL);
  if (!existsSync(p)) {
    coverageLost(`${PAYWALL} does not exist, so limb A's clean result proves only that a tree with no paywall has no prices in it.`);
  } else {
    const strip = (t) => t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    let src = strip(readFileSync(p, 'utf8'));
    // The paywall may now be an ADAPTER over a chassis widget — see the
    // resolver above. Read what it delegates to as well; this only ever adds
    // text, so a paywall that really shows no price still fails.
    const dg = delegationOf(p, ROOT);
    if (dg && dg.lost) {
      coverageLost(
        `${PAYWALL} ${dg.lost}. The positive limb reads the paywall PLUS what it ` +
          'delegates to, and a delegation it cannot follow is a price it cannot see.',
      );
    }
    for (const f of (dg && dg.files) || []) {
      src += `\n${strip(readFileSync(join(ROOT, f), 'utf8'))}`;
    }
    if (dg && dg.files) {
      console.log(
        `⬜ the paywall price limb also read ${dg.files.length} chassis file(s) it delegates to: ` +
          `${dg.files.join(', ')}`,
      );
    }
    if (!/\.formattedPrice\b/.test(src)) {
      problems.push(
        `${PAYWALL} never reads \`.formattedPrice\`. The paywall shows no rail-derived price at all — which passes the negative limb perfectly and is exactly the wrong way to satisfy M-11.`,
      );
    } else {
      ok('the paywall renders its price through Offering.formattedPrice');
    }
    // And the model really derives it, rather than carrying a string the config
    // typed. A `display_price` passed straight through would move the literal
    // from Dart into JSON and change nothing.
    const OFFERING = 'packages/purchases/lib/src/offering.dart';
    const o = existsSync(join(ROOT, OFFERING)) ? readFileSync(join(ROOT, OFFERING), 'utf8') : '';
    // 🔴 SCOPED TO `formattedPrice`'S OWN BODY. A file-level match for
    // `toStringAsFixed` survived gutting the getter, because the helpers around
    // it still mentioned every token. Mutation-proven on the real tree.
    const body =
      new RegExp(String.raw`String\s+get\s+formattedPrice\s*\{[\s\S]*?\n  \}`).exec(o)?.[0] ?? '';
    if (!/toStringAsFixed/.test(body) || !/amountMinor/.test(body) || !/_symbols/.test(body)) {
      problems.push(
        `${OFFERING} does not DERIVE its display string from an amount and a currency code. If the display string arrives ready-made from config, the literal has moved from Dart to JSON and nothing about M-11 has been satisfied.`,
      );
    } else {
      ok('Offering formats from amount + ISO currency, not from a supplied string');
    }
  }
}

// ── C · the LISTING text names no price and no lifetime plan ────────────────
// On every store channel, not the apps-gov-in tree alone; see the header. A
// finding names `file:line`, because a listing is edited by hand and the line
// is where the edit goes. There is no allowlist: a listing has no legitimate
// price in it.
{
  const REGISTER = 'tooling/channel-register.json';
  const APPS = 'catalog/apps.json';
  const EXT_ROOT = 'extensions/Extension';
  /** The factory tree that stamps the next product's listing, per placeholder. */
  const factoryOf = (tpl) =>
    tpl.includes('{app}')
      ? `tooling/bricks/app/__brick__/${tpl.replace('{app}', '{{app_id}}')}`
      : tpl.startsWith(`${EXT_ROOT}/{tool}/`)
        ? tpl.replace(`${EXT_ROOT}/{tool}`, 'extensions/templates/tool')
        : null;
  // WHERE A TEXT FIELD LIVES, by its LISTING_FIELDS column value. A value not
  // named here is a placement this limb was never taught, and it refuses
  // (COVERAGE LOST) rather than skip the field.
  const IN_EVERY_TREE = new Set(['required', 'per-store']);
  const IF_THE_ROW_DECLARES = new Set(['additional']); // perChannel.<id>.additionalFiles
  const WHERE_ON_DISK = new Set(['per-store-additional']); // one store takes it; read where present
  // A surface's column is a LISTING_FIELDS key named after it (`app`,
  // `extension`); these keys describe the field and are no surface's column.
  const NOT_A_COLUMN = new Set(['name', 'kind', 'rendered']);

  const isDirRel = (rel) => existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).isDirectory();
  const readJson = (rel) => {
    if (!existsSync(join(ROOT, rel))) return { lost: `${rel} does not exist` };
    try {
      return { value: JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) };
    } catch (e) {
      return { lost: `${rel} is not valid JSON (${e.message})` };
    }
  };
  const readAppSlugs = () => {
    const a = readJson(APPS);
    const slugs = Array.isArray(a.value)
      ? a.value.map((x) => x?.slug).filter((s) => typeof s === 'string' && s !== '')
      : [];
    if (slugs.length === 0) {
      coverageLost(
        `${a.lost ?? `${APPS} names no app`}, so limb C could name no app's listing tree. Only the brick's was read, and "no price in any listing" would be a claim about apps it never opened.`,
      );
    }
    return slugs;
  };
  const listTools = () => {
    let found = [];
    try {
      found = listDir(join(ROOT, EXT_ROOT))
        .filter((d) => existsSync(join(ROOT, EXT_ROOT, d, 'tool.json')))
        .sort();
    } catch {
      found = [];
    }
    if (found.length === 0) {
      coverageLost(
        `${EXT_ROOT}/ holds no tool (no directory with a tool.json), so limb C could name no tool's listing tree. Only the extension template's was read, and "no price in any listing" would be a claim about tools it never opened.`,
      );
    }
    return found;
  };

  // The lifetime matcher is proven like the price matcher above, before use.
  if (!LIFETIME.test('Lifetime ₹2,499') || !LIFETIME.test('a LIFETIME plan')) {
    coverageLost('the lifetime matcher no longer matches "Lifetime ₹2,499" or "a LIFETIME plan". Every clean listing below would be a result from a matcher that matches nothing.');
  }
  const PRICE_ALL = new RegExp(PRICE.source, `${PRICE.flags}g`);
  const LIFETIME_ALL = new RegExp(LIFETIME.source, `${LIFETIME.flags}g`);
  const lineOf = (text, index) => text.slice(0, index).split('\n').length;
  const listingHits = [];
  const scanListing = (rel, text) => {
    for (const m of text.matchAll(PRICE_ALL)) {
      listingHits.push(
        `\`${rel}:${lineOf(text, m.index)}\` names a price (${JSON.stringify(m[0].trim())}). A store listing states no price: the buyer is charged by the rail, the rail's figure moves ([ADR 093] set today's), and a listing nobody re-reads is the copy that keeps the old one.`,
      );
    }
    for (const m of text.matchAll(LIFETIME_ALL)) {
      listingHits.push(
        `\`${rel}:${lineOf(text, m.index)}\` names the lifetime plan (${JSON.stringify(m[0])}). [ADR 093] §2: lifetime "stays on the web checkout only, and — per §11.2 — no app and no store listing mentions it".`,
      );
    }
  };

  const reg = readJson(REGISTER);
  const channels = Array.isArray(reg.value?.channels) ? reg.value.channels : [];
  const rows = channels.filter((c) => c && (c.kind === 'store' || typeof c.storeMetadataDir === 'string'));
  if (reg.lost) {
    coverageLost(`${reg.lost}, so limb C cannot say which channels carry a listing, and no listing text was read.`);
  } else if (rows.length === 0) {
    coverageLost(`${REGISTER} declares no store channel and no \`storeMetadataDir\`, so limb C ranged over nothing.`);
  }
  const perChannel = reg.value?.storeMetadataContract?.perChannel ?? {};
  let appSlugs = null;
  let tools = null;
  const counted = [];

  for (const row of rows) {
    const id = String(row.id);
    const col = row.surface;
    if (typeof col !== 'string' || NOT_A_COLUMN.has(col) || !LISTING_FIELDS.some((f) => Object.hasOwn(f, col))) {
      coverageLost(
        `channel "${id}" is on surface ${JSON.stringify(col ?? null)}, which has no column in contracts/store/vocabulary.js LISTING_FIELDS, so which of its files are listing text is undecidable. Its listing was not read.`,
      );
      continue;
    }
    const declared = new Set((perChannel[id]?.additionalFiles ?? []).filter((f) => typeof f === 'string'));
    const names = [];
    for (const f of LISTING_FIELDS) {
      const place = f[col];
      if (f.kind !== 'text' || place === null || place === undefined) continue;
      if (IN_EVERY_TREE.has(place) || WHERE_ON_DISK.has(place)) names.push(f.name);
      else if (IF_THE_ROW_DECLARES.has(place)) {
        if (declared.has(f.name)) names.push(f.name);
      } else {
        coverageLost(
          `LISTING_FIELDS "${f.name}" is a text field placed ${JSON.stringify(place)} on the ${col} surface, a placement limb C was never taught: it cannot say which directory holds the file, so channel "${id}"'s copy was not read.`,
        );
      }
    }

    const tpl = typeof row.storeMetadataDir === 'string' ? row.storeMetadataDir : '';
    const trees = [];
    if (tpl.includes('{app}')) {
      appSlugs ??= readAppSlugs();
      for (const s of appSlugs) trees.push(tpl.replace('{app}', s));
    } else if (tpl.includes('{tool}')) {
      tools ??= listTools();
      for (const t of tools) trees.push(tpl.replace('{tool}', t));
    } else if (tpl !== '') {
      trees.push(tpl);
    }
    const factory = tpl === '' ? null : factoryOf(tpl);
    if (factory) trees.push(factory);

    let files = 0;
    let treesRead = 0;
    for (const dir of trees) {
      if (!isDirRel(dir)) continue; // an absent tree is assert-store-metadata's finding, not a read
      treesRead += 1;
      let inTree = 0;
      for (const name of names) {
        const p = join(ROOT, dir, name);
        if (!existsSync(p) || !statSync(p).isFile()) continue;
        inTree += 1;
        scanListing(`${dir}/${name}`, readFileSync(p, 'utf8'));
      }
      if (inTree === 0) {
        coverageLost(
          `${dir} exists and holds none of the ${names.length} listing text field(s) channel "${id}" carries (${names.join(', ') || 'none'}). The tree was opened and nothing in it was read.`,
        );
      }
      files += inTree;
    }
    if (files === 0) {
      coverageLost(
        `channel "${id}" yielded ZERO listing text files from ${trees.length} candidate tree(s) (storeMetadataDir ${JSON.stringify(row.storeMetadataDir ?? null)}). Its listing was not read, and "no price in any listing" would be a claim about a channel this limb never opened.`,
      );
    }
    counted.push({ id, files, trees: treesRead });
  }

  for (const h of listingHits) problems.push(h);
  if (counted.length) {
    ok(
      `listing text reaches ${counted.reduce((n, c) => n + c.files, 0)} file(s) on ${counted.length} channel(s): ` +
        counted.map((c) => `${c.id} ${c.files} in ${c.trees} tree(s)`).join(', '),
    );
  }
  if (counted.some((c) => c.files > 0) && listingHits.length === 0) {
    ok('no price figure and no lifetime plan in listing text');
  }
}

if (notes.length) console.log(`\n${notes.join('\n')}`);
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-no-price-literals: FAILED');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
} else {
  console.log('\nassert-no-price-literals: ok');
}
