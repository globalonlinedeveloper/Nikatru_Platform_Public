#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-yaml.mjs — the app declaration is schema-valid, and everything
// rendered from it is still what it renders to.
//
// [ADR 067] decision 2 — "an app is `app.yaml` + its own screens". This is the
// guard that makes that sentence mechanical rather than aspirational.
//
// [ADR 067] decision 7 and [ADR 059] shape A are cited HERE, in the header, and
// not only beside the limb that enforces them: the enforcement index is built
// from a file's first 60 lines, so a claim made at line 447 is a claim the
// register cannot record. Limb 6 (the optional `billing.mobileIap` opt-in)
// enforces both — an app declares a STORE billing rail, or it does not have
// one, because an app that has not opted in must not link a store SDK ([ADR 078],
// 2026-09-11, replaced [ADR 059] shape A's FREE-ONLY rule) and the sworn
// files [ADR 037] governs must agree with the pubspec either way.
//
// ── THE DEFECT IT CLOSES, IN THE OTHER GUARD'S OWN WORDS ─────────────────────
// `assert-store-metadata.mjs` opens by quoting [pipeline 10]D-5 — "store listing
// metadata is GENERATED from the spec and lives in the repo" — and its own
// header then records what was measured: "STAMP A FRESH APP AND YOU GET NO
// `store/` TREE … this guard exited 0 reporting 5 present and complete — because
// every subject it had was `apps/subscriptiontracker/store/`, which a human wrote by hand.
// Real guard, running, green, pointed one artifact away from the behaviour the
// requirement names." The listing text agreed with the catalogue because two
// people had typed the same words, and nothing anywhere could tell that apart
// from a generator. `tooling/app-yaml/render.mjs` is the generator; this is the
// check that it was RUN.
//
// ── THE SIX LIMBS ────────────────────────────────────────────────────────────
//   1 · every `apps/<id>/app.yaml` parses and satisfies
//       tooling/app-yaml/schema/app.schema.json;
//   2 · every rendering — `catalog/apps.json` and the five listing-copy files in
//       each store channel directory — is byte-identical to what the declaration
//       renders to. A hand edit to `title.txt` is what this catches, and it is
//       the ONLY thing that can: the file's whole content is the title a store
//       shows, so it cannot carry a "generated, do not edit" header any more than
//       `sites/_shared/_data/apps.json` can (same problem, same file, recorded in
//       generate-apps-data.mjs's header);
//   3 · every `apps/<id>/privacy.yaml` satisfies
//       tooling/app-yaml/schema/privacy.schema.json, names only processors that
//       exist in `tooling/legal/provider-register.json`, and declares no network
//       address — and every extension's `publish/privacy.yaml` is held to the
//       same processor and network-address cross-checks (2026-09-25).
//   4 · every `collects` row in `apps/<id>/privacy.yaml` appears in that app's
//       `store/android-play/data-safety.json` as a row `collected: true` under
//       the declared build posture AND in `store/ios-appstore/privacy-manifest.
//       json` as a row whose `fromPlayRow` names it — AND VICE VERSA, in both
//       directions, so neither side can grow or lose a category alone;
//   5 · every NOTICE surface rendered from a privacy declaration —
//       `sites/nikatru/<id>/privacy.html` and the fenced Chrome Web Store
//       privacy-practices block in each `extensions/**/publish/STORE-LISTING.md`
//       — is byte-identical to what `tooling/app-yaml/render-privacy.mjs`
//       renders. This is what catches a hand edit BETWEEN the markers, and it is
//       the only thing that can: the surrounding document is hand-written prose
//       a person maintains, so the file cannot carry one "generated" header.
//
//   6 · mobile IAP is declared and depended on TOGETHER — `billing.mobileIap`
//       requires a `nikatru_billing_revenuecat` dependency, a sworn Play
//       `Purchase history` row, that package's Play `dependencySurface` entry and
//       a `purchases_flutter <version>` row in each Apple `binaryInventory` (rows,
//       never prose); the dependency or a store row WITHOUT the declaration fails,
//       the direction in which a sworn declaration goes false by a one-line edit.
//
//   7 · AI content is declared, and its consequences hold, both ways — an
//       app.yaml `ai.generatesContent: true` requires
//       `AppConfig.generatesAiContent = true`, the ReportContentDialog wired in
//       the app's lib/, and a Data safety ANSWER for
//       table:platform_db.content_reports; `false` requires the content-rating
//       `generates-ai-content` dependency-tells claim, which fails the day a
//       direct AI package arrives. O-PLAY-AI-CONTENT-REPORTING; Google Play's
//       AI-Generated Content policy, duty-matrix `play-ai-content-declaration`.
//
//   8 · export compliance holds to the code — an app.yaml
//       `exportCompliance.usesNonExemptEncryption: false` (rendered into
//       ITSAppUsesNonExemptEncryption in both Info.plists) fails when a shipped
//       lib/ imports a cipher package outside EXEMPT_CIPHER_IMPORTS, names a
//       cipher class, or the app's pubspec depends on one directly.
//       O-APPLE-PLIST-KEYS-UNRENDERED.
//
// 🔴 AND LIMB 4 READS THE SWORN FILES — IT NEVER WRITES THEM. [ADR 037]: "a
// sworn declaration regenerated by a template is a statement nobody made." The
// two store JSON files are statements about Subly's real code, each answer
// carrying its own citation and two of them closed by reading a vendored SDK.
// Comparing a declaration to them is the safe direction; rendering them from it
// would destroy the thing being compared to. `data-safety.json` remains the
// upstream of `privacy-manifest.json` (that file's own `_why` says so), and this
// limb checks the third edge of the triangle rather than re-deriving either.
//
// 🔴 WHY LIMB 4 IS A LIMB HERE AND NOT A GUARD OF ITS OWN. Two reasons, and the
// second is the real one. First, a brand-new guard must be invoked by a workflow
// or `assert-guard-coverage.mjs` fails it, and this one would have had to add a
// step to `ci.yml`. Second and decisively: `privacy.yaml` should have exactly
// ONE reader. A second file opening the same declaration is a second opinion
// about what it means, and the whole point of the declaration is that there is
// one. So the renderer's plan is imported (limbs 2 and 5) and the sworn
// comparison sits beside the schema check that already reads the file.
//
// ⚠️ LIMB 4 EXITS 2, NOT 1, WHEN A SWORN FILE IS STILL THE BRICK'S STAMPED ONE.
// `tooling/bricks/app/__brick__/apps/{{app_id}}/store/android-play/data-safety.
// json` ships `buildPosture: null`, `dataTypes: null` and no `answers` at all,
// and the Apple template ships `collectedDataTypes: null` — deliberately, because
// a template cannot know what an app collects. A comparison against those files
// compares a real declaration to nothing and finds nothing wrong, which is
// exactly the shape C-COVERAGE-LOST-IS-NOT-PASS forbids sharing an exit code
// with a pass.
//
// 🔴 LIMB 3'S TWO CROSS-CHECKS ARE THE HALF A SCHEMA CANNOT DO. A schema can say
// `id` is a string; only the tree can say it is a party this company has
// actually named. And C-NO-NETWORK-ADDRESS-COLUMN is locked precisely because it
// has already been broken in publication once — `privacy.html` said "We do not
// collect or store your IP address" while the self-hosted GlitchTip was storing
// `user.ip_address` (recorded in provider-register.json's own `dataCategories`
// header). A declaration that CAN say "IP address" is a declaration that
// eventually will, so the schema pins `networkAddress` to `false` and this limb
// refuses the words as well as the flag.
//
// ── WHAT COVERAGE LOST MEANS HERE ────────────────────────────────────────────
// Exit 2, never 0, on any run that graded nothing: no `apps/` tree, no
// declaration in it, an unreadable channel register (the storefront key set and
// every listing directory come from it), a declaration that rendered zero
// listing files, or not one `privacy.yaml` anywhere. Each is a run that would
// otherwise print "every declaration is valid" over an empty set — this
// repository's single most repeated defect, and the reason
// C-COVERAGE-LOST-IS-NOT-PASS forbids sharing an exit code with a pass.
//
// Usage:  node tooling/ci/assert-app-yaml.mjs [repoRoot]
// Exit 0 = valid and fresh · 1 = a finding · 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../app-yaml/yaml.mjs';
import { validate, assertSchemaUnderstood } from '../app-yaml/schema-validate.mjs';
import { plan, APPS_DIR } from '../app-yaml/render.mjs';
import { planPrivacy } from '../app-yaml/render-privacy.mjs';
// The Apple inventories that exist — the generator's own list, so limb 6 asks
// for an SDK row in exactly the inventories that are rendered into bundles.
import { PLATFORMS as APPLE_PLATFORMS } from '../store/render-apple-privacy-manifest.mjs';
import { listDir } from './tree-walk.mjs';
import { transmits } from '../../contracts/legal/pro-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));
const PRIVACY_SCHEMA = join(HERE, '..', 'app-yaml', 'schema', 'privacy.schema.json');
const PROVIDERS = 'tooling/legal/provider-register.json';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

/** Fatal on the spot. Every limb below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-app-yaml: COVERAGE LOST');
  process.exit(2);
}

/** Every string leaf of a parsed declaration, with its pointer. */
function strings(value, path = '#', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const k of Object.keys(value)) strings(value[k], `${path}/${k}`, out);
  return out;
}

/** The words that would make the published no-IP promise false. Matched on the
 *  DECLARATION's own text, because the flag alone is satisfiable by an author who
 *  leaves it false and then writes the row anyway. */
const NETWORK_ADDRESS = /\b(ip[ _-]?address(es)?|network[ _-]address|client[ _-]ip|remote[ _-]addr)\b/i;

// ── limbs 1 and 2, both derived from the renderer's own plan ────────────────
// The guard and the generator MUST agree about what "rendered" means, and the
// only way two readers of one contract cannot drift is for there to be one
// reader. So the plan is imported rather than re-derived here — the same reason
// `storeMetadataContract` lives in the channel register and not inside
// assert-store-metadata.mjs.
const { declarations, files, problems: authoring, lost } = plan(ROOT);
if (lost.length) coverageLost(lost);

// 🔴 A DECLARATION THAT DOES NOT PARSE STOPS THE RUN HERE, and the reason is the
// exit code rather than tidiness. Limbs 2 and 3 both quantify over the
// declarations limb 1 accepted, so an invalid one leaves them ranging over a
// smaller set — and limb 3's "not one app carries a privacy.yaml" refusal then
// fires and reports COVERAGE LOST, which is a true statement about this run and
// a MISLEADING diagnosis of the tree: the finding is the broken declaration, and
// the repair the message must point at is that file. Measured: with `id:`
// deleted from apps/subscriptiontracker/app.yaml this guard exited 2 naming the privacy limb.
if (authoring.length) {
  console.error('');
  for (const p of authoring) console.error(`✗ ${p}`);
  console.error(
    `\nassert-app-yaml: ${authoring.length} problem(s) in the declaration(s). Nothing downstream was graded — ` +
      'every later limb ranges over the declarations this limb accepted.',
  );
  process.exit(1);
}
ok(`${declarations.length} declaration(s) parse and satisfy tooling/app-yaml/schema/app.schema.json`);

const stale = [];
for (const [rel, contents] of files) {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current !== contents) stale.push(rel);
}
if (stale.length) {
  problems.push(
    `${stale.length} rendering(s) no longer match the declaration they are rendered from:\n` +
      stale.map((s) => `      ${s}`).join('\n') +
      '\n      Change apps/<id>/app.yaml, then: node tooling/app-yaml/render.mjs' +
      '\n      (A listing file cannot carry a "generated" header — its whole content is the value a store shows —' +
      '\n       so this comparison is the only thing between a hand edit and a store console.)',
  );
} else {
  ok(`${files.size} rendering(s) are byte-identical to what apps/*/app.yaml renders to`);
}

// ── limb 3 · the privacy declarations ───────────────────────────────────────
const privacySchema = JSON.parse(readFileSync(PRIVACY_SCHEMA, 'utf8'));
assertSchemaUnderstood(privacySchema, 'privacy.schema.json');

const providerRaw = existsSync(join(ROOT, PROVIDERS)) ? readFileSync(join(ROOT, PROVIDERS), 'utf8') : null;
if (providerRaw === null) {
  coverageLost([
    `${PROVIDERS} does not exist.`,
    'It is the ONE declaration of who this company has named as a processor, and the cross-check below',
    'quantifies over it. Absent, every processor row in every privacy.yaml would be accepted unread.',
  ]);
}
let providerIds;
try {
  const reg = JSON.parse(providerRaw);
  providerIds = new Set((Array.isArray(reg.providers) ? reg.providers : []).map((p) => p && p.id).filter(Boolean));
} catch (e) {
  coverageLost([`${PROVIDERS} is not valid JSON (${e.message}); the processor cross-check has no right-hand side.`]);
}
if (providerIds.size === 0) {
  coverageLost([
    `${PROVIDERS} declares zero providers.`,
    'The processor cross-check below would then reject everything or accept nothing, and neither answer is',
    'about the declarations it claims to grade.',
  ]);
}

/** The two cross-checks a schema cannot do, for ONE parsed declaration of
 *  either surface: every processor is a party the register names, and no
 *  string names a network address. */
function crossCheck(rel, doc) {
  for (const p of Array.isArray(doc?.processors) ? doc.processors : []) {
    if (p && typeof p.id === 'string' && !providerIds.has(p.id)) {
      problems.push(
        `${rel}: processor "${p.id}" is not a row in ${PROVIDERS}. That register is the ONE declaration of who ` +
          'these parties are; a second spelling here is the one that drifts.',
      );
    }
  }
  for (const [pointer, text] of strings(doc)) {
    if (NETWORK_ADDRESS.test(text)) {
      problems.push(
        `${rel} ${pointer}: names a network address ("${text.match(NETWORK_ADDRESS)[0]}"). C-NO-NETWORK-ADDRESS-COLUMN ` +
          'is locked: IP addresses are not stored, and the promise is PUBLISHED. This exact claim has already been ' +
          'false in publication once.',
      );
    }
  }
}

let privacyGraded = 0;
const problemsBeforePrivacy = problems.length;
for (const { id } of declarations) {
  const rel = `${APPS_DIR}/${id}/privacy.yaml`;
  if (!existsSync(join(ROOT, rel))) continue;
  privacyGraded += 1;
  let doc;
  try {
    doc = parseYaml(readFileSync(join(ROOT, rel), 'utf8'));
  } catch (e) {
    problems.push(`${rel}: ${e instanceof YamlError ? e.message : String(e)}`);
    continue;
  }
  for (const bad of validate(doc, privacySchema, rel)) problems.push(bad);
  if (doc && doc.app !== id) {
    problems.push(`${rel}: declares app "${doc.app}" but lives in ${APPS_DIR}/${id}/ — two files describing two different apps.`);
  }
  crossCheck(rel, doc);
}
if (privacyGraded === 0) {
  coverageLost([
    `none of the ${declarations.length} declaring app(s) carries a privacy.yaml.`,
    'Limb 3 then grades nothing — no schema check, no processor cross-check and no network-address refusal —',
    'while this guard still prints two green lines about the other two limbs.',
  ]);
}

// ⏱ 2026-09-25 (EXT-4, O-EXTENSION-ACCOUNT-CHECK-UNBUILT part 2, S2-claims-08).
// The loop above walks APPS only, so an extension's `processors` were read by
// the renderer (schema-validated, limb 5) and checked against the register by
// nothing: a FullShot row naming "cloudflre" passed. The extension surface's
// declarations come from the renderer's own plan — the one reader of those
// files — and get the same two cross-checks; schema validity stays with the
// renderer, which already reports it through limb 5.
const privacyPlan = planPrivacy(ROOT);
const extensionDeclarations = privacyPlan.declarations.filter((d) => d.surface === 'extension');
for (const { rel, doc } of extensionDeclarations) crossCheck(rel, doc);

// ⏱ 2026-09-25 (EXT-4). The app loop above holds `app:` to the directory the
// declaration lives in; an extension's directory name (Full_Screen_Shot) is not
// its id, so the same check reads the slug from the identity.json beside the
// declaration — the file every publish/ script already takes the slug from.
for (const { rel, doc } of extensionDeclarations) {
  const idRel = `${dirname(rel)}/identity.json`;
  if (!existsSync(join(ROOT, idRel))) {
    coverageLost([
      `${rel} has no ${idRel} beside it.`,
      'Its `app:` is compared to that file\'s slug; without it a declaration could describe another extension unread.',
    ]);
  }
  let slug;
  try {
    slug = JSON.parse(readFileSync(join(ROOT, idRel), 'utf8'))?.slug;
  } catch (e) {
    coverageLost([`${idRel} is not valid JSON (${e.message}); the slug check has no right-hand side.`]);
  }
  if (doc && doc.app !== slug) {
    problems.push(`${rel}: declares app "${doc?.app}" but ${idRel} names slug "${slug}" — two files describing two different extensions.`);
  }
}

// ⏱ 2026-09-25 (EXT-4, O-EXTENSION-ACCOUNT-CHECK-UNBUILT part 3, S2-claims-01).
// An extension declaration saying `processors: []` is a sworn "nothing leaves
// the device" — FullShot's limitedUse basis says it in words, and the store
// dashboard answers are rendered from it. The one machine-readable statement of
// where the code may connect is tool.json `policy.networkAllowlist`, which
// policy-check grades against the shipped code. The two are held to each other
// in both directions: a host the tool may reach is a party the declaration must
// name, and a declaration that names a party describes a tool that reaches one.
// A declaration with no tool.json beside its publish/ directory has no
// allowlist to compare, so that is COVERAGE LOST, never a pass.
let transmitting = 0;
const transmittingDeclarations = [];
for (const { rel, doc } of extensionDeclarations) {
  const toolRel = `${dirname(dirname(rel))}/tool.json`;
  const toolAbs = join(ROOT, toolRel);
  if (!existsSync(toolAbs)) {
    coverageLost([
      `${rel} has no ${toolRel} beside it.`,
      'The processor rows are compared to that file\'s policy.networkAllowlist; without it an extension that reaches',
      'a server would be graded as one that transmits nothing.',
    ]);
  }
  let toolRaw;
  try {
    toolRaw = JSON.parse(readFileSync(toolAbs, 'utf8'));
  } catch (e) {
    coverageLost([`${toolRel} is not valid JSON (${e.message}); the transmits check has no left-hand side.`]);
  }
  const allow = toolRaw?.policy?.networkAllowlist;
  if (transmits(toolRaw)) transmittingDeclarations.push({ rel, doc });
  if (!Array.isArray(allow)) {
    problems.push(`${toolRel}: policy.networkAllowlist is not an array, so whether ${rel} may say "transmits nothing" cannot be decided.`);
    continue;
  }
  const processors = Array.isArray(doc?.processors) ? doc.processors : [];
  if (allow.length) transmitting += 1;
  if (allow.length && !processors.length) {
    problems.push(
      `${rel}: declares \`processors: []\` — nothing leaves the device — but ${toolRel} allowlists ` +
        `${allow.length} network destination(s). A tool that transmits names the party it transmits to; ` +
        'add the processor row (and answer the store disclosures for it), or empty the allowlist.',
    );
  } else if (!allow.length && processors.length) {
    problems.push(
      `${rel}: names ${processors.length} processor(s) but ${toolRel} allowlists no network destination, ` +
        'so the code cannot reach any of them. One of the two files is wrong about this tool.',
    );
  }
}
ok(`limb 3b — ${transmitting} transmitting tools among ${extensionDeclarations.length} extension declaration(s); each declaration's processors agree with its tool.json networkAllowlist`);

// ── limb 8 · a tool that transmits stops saying it does not ─────────────────
// ⏱ 2026-09-25 (EXT-4). Limb 3b holds `processors` to the allowlist; a tool
// that transmits (contracts/legal/pro-gate.mjs `transmits`, the one definition
// the listing renderer and the privacy renderer also read) owes more than that:
// (a) its declaration collects something, names who processes it, and does not
// answer the Authentication category `not-collected` — a sign-in token IS
// authentication information; and (b) no rendered store text it ships says the
// opposite in words. A transmitting tool with no rendered store text has had
// (b) graded over nothing, which is COVERAGE LOST, never a pass.
const DENIES_TRANSMISSION = /\b(?:no cloud|no sign-in|transmits nothing|no network requests?)\b/i;
for (const { rel, doc } of transmittingDeclarations) {
  if (!Array.isArray(doc?.collects) || doc.collects.length === 0) {
    problems.push(`${rel}: the tool transmits, but the declaration says \`collects: []\`. Name what reaches the server.`);
  }
  if (!Array.isArray(doc?.processors) || doc.processors.length === 0) {
    problems.push(`${rel}: the tool transmits, but the declaration says \`processors: []\`. Name who receives it.`);
  }
  const auth = (Array.isArray(doc?.storeDisclosures) ? doc.storeDisclosures : []).find(
    (d) => d && d.category === 'Authentication information',
  );
  if (!auth || auth.disposition === 'not-collected') {
    problems.push(
      `${rel}: the tool transmits, but "Authentication information" is ${auth ? '`not-collected`' : 'not answered'}. ` +
        'A signed-in tool sends a sign-in token; answer the category for it.',
    );
  }
  const storeRel = `${dirname(dirname(rel))}/store`;
  const texts = [];
  for (const store of existsSync(join(ROOT, storeRel)) ? listDir(join(ROOT, storeRel), { withFileTypes: true }) : []) {
    if (!store.isDirectory()) continue;
    for (const f of listDir(join(ROOT, storeRel, store.name))) {
      if (f.endsWith('.txt')) texts.push(`${storeRel}/${store.name}/${f}`);
    }
  }
  if (texts.length === 0) {
    coverageLost([
      `${rel}: the tool transmits, and ${storeRel}/*/ holds no rendered .txt file.`,
      'Limb 8 (b) reads the shipped store text for a sentence denying transmission; with none it has read nothing.',
    ]);
  }
  for (const t of texts) {
    const hit = readFileSync(join(ROOT, t), 'utf8').match(DENIES_TRANSMISSION);
    if (hit) {
      problems.push(`${t}: says "${hit[0]}", but the tool transmits (${rel}). Reword the listing source, then re-render.`);
    }
  }
}
ok(`limb 8 — ${transmittingDeclarations.length} transmitting tools; each declares what it collects, who processes it and its sign-in, and no rendered store text denies it`);

if (problems.length === problemsBeforePrivacy) {
  ok(
    `${privacyGraded} app and ${extensionDeclarations.length} extension privacy declaration(s) valid, with every ` +
      `processor named in ${PROVIDERS} and no network address anywhere`,
  );
}

// ── limb 4 · the declaration and the two SWORN declarations agree ───────────
// A bijection, checked in both directions per app. One direction alone is the
// failure this limb is named after: a declaration that is a SUBSET of the sworn
// answers passes a "every declared row is sworn" check while the app is
// collecting a category its own notice does not mention.
const PLAY_REL = (id) => `${APPS_DIR}/${id}/store/android-play/data-safety.json`;
const APPLE_REL = (id) => `${APPS_DIR}/${id}/store/ios-appstore/privacy-manifest.json`;

const readJson = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { missing: true };
  try {
    return { json: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { broken: e.message };
  }
};

let bijectionApps = 0;
let bijectionRows = 0;
const problemsBeforeSworn = problems.length;

for (const { id } of declarations) {
  const declRel = `${APPS_DIR}/${id}/privacy.yaml`;
  if (!existsSync(join(ROOT, declRel))) continue;
  let declared;
  try {
    declared = parseYaml(readFileSync(join(ROOT, declRel), 'utf8'));
  } catch {
    continue; // limb 3 already recorded the parse failure and named the repair
  }
  if (!declared || declared.surface !== 'app') continue;

  const playRel = PLAY_REL(id);
  const appleRel = APPLE_REL(id);
  const play = readJson(playRel);
  const apple = readJson(appleRel);

  if (play.missing || apple.missing) {
    coverageLost([
      `${id} carries a privacy.yaml but ${play.missing ? playRel : appleRel} does not exist.`,
      'Limb 4 compares the declaration to the two sworn store declarations in both directions. With one of',
      'them absent it would compare a real list of collected categories to nothing, find nothing wrong, and',
      'print a green line naming a count of zero.',
    ]);
  }
  if (play.broken || apple.broken) {
    coverageLost([
      `${play.broken ? playRel : appleRel} is not valid JSON (${play.broken ?? apple.broken}).`,
      'The sworn comparison has no right-hand side, so this run graded the declaration against nothing.',
    ]);
  }

  // 🔴 THE STAMPED-TEMPLATE REFUSAL. The brick ships both files UNANSWERED —
  // `buildPosture: null`, no `answers`, `collectedDataTypes: null` — because a
  // template cannot know what an app collects. Comparing against one is a run
  // that compared nothing.
  const posture = play.json?.buildPosture?.current ?? null;
  const answers = Array.isArray(play.json?.answers) ? play.json.answers : null;
  if (posture === null || answers === null) {
    coverageLost([
      `${playRel} is still the STAMPED template: ${posture === null ? '`buildPosture.current` is unanswered' : 'it carries no `answers` array'}.`,
      'The brick stamps this file UNANSWERED on purpose — a template cannot know what an app collects — so a',
      'comparison against it grades a real declaration against an empty set and reports it clean.',
      'Answer the sworn declaration first; this limb is what proves the two then still describe one app.',
    ]);
  }
  const appleRows = Array.isArray(apple.json?.collectedDataTypes?.rows) ? apple.json.collectedDataTypes.rows : null;
  if (appleRows === null) {
    coverageLost([
      `${appleRel} is still the STAMPED template: \`collectedDataTypes\` carries no \`rows\` array.`,
      'Same refusal, same reason: the Apple manifest is derived from the Play answers and an unanswered one',
      'has no rows to compare the declaration against.',
    ]);
  }

  const key = (c, t) => `${c} | ${t}`;
  const declaredRows = new Map((declared.collects ?? []).map((r) => [key(r.category, r.type), r]));
  const sworn = new Map(
    answers
      .filter((a) => a && a.collected && a.collected[posture] === true)
      .map((a) => [key(a.category, a.type), a]),
  );
  if (sworn.size === 0) {
    coverageLost([
      `${playRel} declares ZERO rows \`collected: true\` under posture "${posture}".`,
      'Every category in the declaration would then be reported as unsworn, or — read the other way — the',
      'comparison would range over an empty sworn set. Neither answer is about the two files it claims to grade.',
    ]);
  }

  for (const [k, r] of declaredRows) {
    if (!sworn.has(k)) {
      problems.push(
        `${declRel}: declares "${r.category} / ${r.type}" and ${playRel} has no row for it that is `
          + `\`collected: true\` under posture "${posture}". The notice and the sworn Play answer describe `
          + 'two different apps, and the sworn file is the one under oath.',
      );
    }
  }
  for (const k of sworn.keys()) {
    if (!declaredRows.has(k)) {
      const [c, t] = k.split(' | ');
      problems.push(
        `${playRel}: swears "${c} / ${t}" is collected under posture "${posture}" and ${declRel} does not `
          + 'declare it. The app is collecting a category its own privacy notice does not mention, which is '
          + 'the direction of this comparison that actually protects a reader.',
      );
    }
  }

  // Apple's side is keyed on the Play row it was translated from — that file's
  // own `_why` records the relation ("each row below names the Play row it comes
  // from"), so this checks the same edge without re-deriving the mapping.
  const appleByPlayRow = new Map(appleRows.filter((r) => r && typeof r.fromPlayRow === 'string').map((r) => [r.fromPlayRow, r]));
  for (const r of declared.collects ?? []) {
    if (!appleByPlayRow.has(r.type)) {
      problems.push(
        `${declRel}: declares "${r.type}" and ${appleRel} carries no row whose \`fromPlayRow\` is "${r.type}". `
          + 'The two store declarations are the same sworn claim asked twice by two companies; answering them '
          + 'inconsistently is invisible to a reader and obvious to a comparison.',
      );
    }
  }
  for (const [playRow, r] of appleByPlayRow) {
    if (![...declaredRows.values()].some((d) => d.type === playRow)) {
      problems.push(
        `${appleRel}: row ${r.type} names Play row "${playRow}", and ${declRel} declares no such type. `
          + 'The Apple manifest and the notice have parted company.',
      );
    }
  }

  bijectionApps += 1;
  bijectionRows += declaredRows.size;
}

if (bijectionApps === 0) {
  coverageLost([
    'not one app declaration reached the sworn comparison.',
    'Limb 4 is the whole reason the declaration can be trusted as a description of what the app actually',
    'collects; a run in which it graded no app is a run in which the notice was checked against nothing.',
  ]);
}
if (problems.length === problemsBeforeSworn) {
  ok(
    `limb 4 — ${bijectionRows} collected categor(ies) across ${bijectionApps} app(s) match both sworn `
      + 'declarations in both directions (privacy.yaml ⇄ android-play/data-safety.json ⇄ ios-appstore/privacy-manifest.json)',
  );
}

// ── limb 5 · every notice surface is what the declaration renders to ────────
// `privacyPlan` is the plan limb 3 already asked for (its extension half).
if (privacyPlan.lost.length) coverageLost(privacyPlan.lost);
if (privacyPlan.problems.length) {
  for (const p of privacyPlan.problems) problems.push(p);
} else {
  const staleNotices = [];
  for (const [rel, contents] of privacyPlan.files) {
    const abs = join(ROOT, rel);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current !== contents) staleNotices.push(rel);
  }
  if (staleNotices.length) {
    problems.push(
      `${staleNotices.length} notice surface(s) no longer match the privacy declaration they are rendered from:\n`
        + staleNotices.map((s) => `      ${s}`).join('\n')
        + '\n      Change apps/<id>/privacy.yaml (or the extension\'s publish/privacy.yaml), then:'
        + '\n        node tooling/app-yaml/render-privacy.mjs'
        + '\n      (An edit BETWEEN the privacy-practices markers in a STORE-LISTING.md is exactly this failure.'
        + '\n       Those bytes are pasted into a store dashboard, and a dashboard answer that contradicts the'
        + '\n       code is a policy strike at account level.)',
    );
  } else {
    // ⏱ 2026-09-15 — counted per DECLARED surface name, not as "extension, and the
    // rest are apps" (O-EXT-SURFACE-AXIS): a third surface's declarations used to be
    // printed as app declarations.
    const bySurface = new Map();
    for (const d of privacyPlan.declarations) bySurface.set(String(d.surface), (bySurface.get(String(d.surface)) ?? 0) + 1);
    const split = [...bySurface.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, n]) => `${n} ${s}`).join(' and ');
    ok(
      `limb 5 — ${privacyPlan.files.size} notice rendering(s) are byte-identical to what `
        + `${split} declaration(s) render to`,
    );
  }
}


// ── limb 6 · mobile IAP is declared and depended on TOGETHER, or not at all ──
//
// [ADR 067] decision 7. An app opts in to a STORE billing rail by doing two
// things, and this limb is what stops it doing one of them:
//
//   · `billing.mobileIap` in its app.yaml — the DECLARATION, read by humans and
//     by the store paperwork;
//   · a dependency on `nikatru_billing_revenuecat` — the CODE, which is what
//     actually links the native IAP payload into the binary.
//
// 🔴 BOTH DIRECTIONS, AND THE SECOND IS THE ONE THAT PROTECTS ANYBODY. Declared
// without the dependency is a broken paywall — annoying, visible, fixed in a
// day. The DEPENDENCY WITHOUT THE DECLARATION is the expensive one: the binary
// gains StoreKit and the Play Billing Library, Apple's aggregated privacy report
// and Play's Data safety form both change, and NOTHING in the tree says so. That
// is a sworn declaration going false by a one-line pubspec edit, which is the
// exact failure `assert-play-declarations`'s dependency-set equality exists for —
// asked here at the DECLARATION, one level earlier.
//
// And when the declaration IS present, the two sworn store files must already
// say what the SDK makes true: Play's `Purchase history` row collected under the
// live posture and a `dependencySurface` entry for the bridge, and the Apple
// manifest carrying the SDK's own binary rows. Those files are STATEMENTS, never
// generated ([ADR 037]) — so this limb reads them and refuses, and never writes
// them.
//
// 🔴 STRUCTURED ROWS ONLY — NEVER THE FILE'S TEXT. ⏱ 2026-09-22. The Apple half
// used to pass when /revenue\s*cat|purchases_flutter/i matched ANYWHERE in the
// JSON-stringified manifest, and apps/subscriptiontracker's manifest carries, in
// a `basis`, the prose "the RevenueCat line is gone by [ADR 026]/[ADR 039]" — so
// the check passed on a sentence saying the SDK had been REMOVED. Measured on the
// real tree. A sworn file's prose (`_why`, `basis`, `linkedBasis`, notes) is
// reasoning, and reasoning names what is absent as readily as what is present.
// So each half reads ONE structured field, the one a sibling guard already holds
// equal to the build:
//
//   · Apple — `binaryInventory.<platform>[].binary`, parsed with the row shape
//     assert-apple-privacy-manifest.mjs uses (`<pub package> <version>`), the
//     field that guard holds EQUAL to the plugins the build links. A declared app
//     needs a `purchases_flutter <version>` row in EVERY Apple inventory it ships:
//     the platforms the manifest's `channels` name (`ios-appstore` → ios,
//     `macos-appstore` → macos) plus any platform it inventories at all — and all
//     of them when neither says, so a missing `channels` can only ask for more.
//     The SDK is a framework in each bundle, and each bundle's privacy report is
//     aggregated on its own; an iOS row says nothing about the macOS binary.
//   · Play — `dependencySurface.direct["nikatru_billing_revenuecat"]`, the map
//     assert-play-declarations.mjs holds in BIJECTION with the pubspec's direct
//     dependencies, so it is the Play form's own record of what links. NOT
//     `buildPosture.expectedDefines`: that list is held equal to the lane's
//     --dart-define flags — a build-configuration fact — and a key define can be
//     passed to a binary that links no SDK at all.
//
// The reverse direction reads the SAME fields: an app with no declaration
// carries neither a `purchases_flutter` inventory row nor the Play entry.
const IAP_PACKAGE = 'nikatru_billing_revenuecat';
const IAP_PURCHASE_TYPE = 'Purchase history';
const IAP_SDK_BINARY = 'purchases_flutter';
/** assert-apple-privacy-manifest.mjs's PLUGIN_ROW: `<pub package>` or
 *  `<pub package> <version>`. `Runner (the app target)` and the engine rows do
 *  not match, and nothing outside the `binary` field is ever read. */
const INVENTORY_ROW = /^([a-z][a-z0-9_]*)(?: (\d[^\s]*))?$/;

/** The Apple platforms whose `binaryInventory` names the IAP SDK in a row's
 *  `binary` field — versioned rows only when `versioned` is set (the forward
 *  direction swears a specific binary; the reverse refuses any mention). */
const appleSdkPlatforms = (manifest, versioned) => {
  const inventory = manifest?.binaryInventory;
  return APPLE_PLATFORMS.filter((platform) => {
    const rows = inventory && Array.isArray(inventory[platform]) ? inventory[platform] : [];
    return rows.some((row) => {
      const m = row && typeof row.binary === 'string' ? row.binary.match(INVENTORY_ROW) : null;
      return m !== null && m[1] === IAP_SDK_BINARY && (!versioned || m[2] !== undefined);
    });
  });
};

/** The Apple inventories a declared app must carry the SDK row in. */
const appleShippedPlatforms = (manifest) => {
  const channels = Array.isArray(manifest?.channels) ? manifest.channels : [];
  const inventory = manifest?.binaryInventory;
  const shipped = APPLE_PLATFORMS.filter(
    (platform) =>
      channels.includes(`${platform}-appstore`) || (inventory && Array.isArray(inventory[platform])),
  );
  return shipped.length > 0 ? shipped : [...APPLE_PLATFORMS];
};

/** Whether the Play form's dependency map carries an entry for the bridge. */
const playMapsIapPackage = (form) => {
  const direct = form?.dependencySurface?.direct;
  return Boolean(direct) && typeof direct === 'object' && !Array.isArray(direct) && Object.hasOwn(direct, IAP_PACKAGE);
};

let iapDeclared = 0;
let iapChecked = 0;
const problemsBeforeIap = problems.length;

for (const { id, doc } of declarations) {
  const pubspecRel = `${APPS_DIR}/${id}/pubspec.yaml`;
  const pubspecAbs = join(ROOT, pubspecRel);
  // 🔴 COMMENTS STRIPPED BEFORE THE DEPENDENCY IS LOOKED FOR. apps/subscriptiontracker's
  // pubspec carries a RevenueCat TOMBSTONE — a comment recording why no billing
  // aggregator is present — and a raw substring search over that file reports
  // the dependency this limb exists to detect. Measured on the real tree: the
  // words are there and the dependency is not.
  const pubspec = existsSync(pubspecAbs)
    ? readFileSync(pubspecAbs, 'utf8').replace(/^\s*#.*$/gm, '')
    : null;
  const dependsOnIap =
    pubspec !== null && new RegExp(`^\\s+${IAP_PACKAGE}\\s*:`, 'm').test(pubspec);

  const mobileIap = doc?.billing?.mobileIap ?? null;
  iapChecked += 1;

  if (mobileIap === null) {
    if (dependsOnIap) {
      problems.push(
        `${pubspecRel}: depends on ${IAP_PACKAGE} and ${APPS_DIR}/${id}/app.yaml declares no ` +
          '`billing.mobileIap`. That dependency links a native in-app-purchase payload into the binary, ' +
          "which changes what Play's Data safety form and Apple's aggregated privacy report have to say — " +
          'so an undeclared one is a sworn declaration going false by a one-line pubspec edit. Declare the ' +
          'opt-in, or remove the dependency.',
      );
    }
    // The same two structured fields, read in the other direction. A sworn store
    // row for an SDK the app has not opted in to is a statement about a binary
    // nobody declared — or a statement that outlived the SDK it describes.
    const undeclaredPlay = readJson(PLAY_REL(id));
    if (undeclaredPlay.json && playMapsIapPackage(undeclaredPlay.json)) {
      problems.push(
        `${PLAY_REL(id)}: dependencySurface.direct names ${IAP_PACKAGE} and ${APPS_DIR}/${id}/app.yaml declares no ` +
          '`billing.mobileIap`. The Data safety form is answering for a store billing SDK the app has not opted in ' +
          'to. Declare the opt-in, or remove the entry together with the dependency.',
      );
    }
    const undeclaredApple = readJson(APPLE_REL(id));
    const strayRows = undeclaredApple.json ? appleSdkPlatforms(undeclaredApple.json, false) : [];
    if (strayRows.length > 0) {
      problems.push(
        `${APPLE_REL(id)}: binaryInventory.${strayRows.join(' and binaryInventory.')} carries a ${IAP_SDK_BINARY} ` +
          `row and ${APPS_DIR}/${id}/app.yaml declares no \`billing.mobileIap\`. The manifest is auditing a store ` +
          'billing framework the app has not opted in to. Declare the opt-in, or remove the row(s).',
      );
    }
    continue;
  }

  iapDeclared += 1;

  if (!dependsOnIap) {
    problems.push(
      `${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and ${pubspecRel} does not depend on ` +
        `${IAP_PACKAGE}. The declaration is the app saying it sells through the store billing rail; without ` +
        'the bridge package there is no rail, and the paywall would refuse every purchase on the one channel ' +
        'the declaration says it sells on.',
    );
  }

  const playRel = PLAY_REL(id);
  const play = readJson(playRel);
  if (play.missing || play.broken) {
    problems.push(
      `${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and ${playRel} ` +
        `${play.missing ? 'does not exist' : `is not valid JSON (${play.broken})`}. An app that sells through ` +
        'Play Billing has a Data safety form to answer, and there is nothing here to answer it with.',
    );
  } else {
    const posture = play.json?.buildPosture?.current ?? null;
    const answers = Array.isArray(play.json?.answers) ? play.json.answers : [];
    const sworn = answers.some(
      (a) => a && a.type === IAP_PURCHASE_TYPE && a.collected && a.collected[posture] === true,
    );
    if (!sworn) {
      problems.push(
        `${playRel}: ${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and this form does not swear ` +
          `"${IAP_PURCHASE_TYPE}" \`collected: true\` under posture "${posture}". A store IAP rail records a ` +
          "purchase against the account — that IS purchase history — and Google attaches app REMOVAL to an " +
          'inaccurate label. The sworn file is a statement, so answer it: this limb reads it and never writes it.',
      );
    }
    if (!playMapsIapPackage(play.json)) {
      problems.push(
        `${playRel}: ${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and this form's ` +
          `dependencySurface.direct has no "${IAP_PACKAGE}" entry. That map is the form's own record of what the ` +
          'binary links — the entry is where the store billing SDK says what it collects — and prose elsewhere ' +
          'in the file is not read as one.',
      );
    }
  }

  const appleRel = APPLE_REL(id);
  const apple = readJson(appleRel);
  if (apple.missing || apple.broken) {
    problems.push(
      `${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and ${appleRel} ` +
        `${apple.missing ? 'does not exist' : `is not valid JSON (${apple.broken})`}. The IAP SDK is a binary ` +
        "inside the bundle and Apple's privacy report aggregates every binary in it.",
    );
  } else {
    const rowed = new Set(appleSdkPlatforms(apple.json, true));
    for (const platform of appleShippedPlatforms(apple.json)) {
      if (rowed.has(platform)) continue;
      problems.push(
        `${appleRel}: ${APPS_DIR}/${id}/app.yaml declares \`billing.mobileIap\` and binaryInventory.${platform} ` +
          `has no "${IAP_SDK_BINARY} <version>" row. Apple aggregates one privacy report from the app target AND ` +
          'every framework in the bundle, each answering for its own code — so a shipped IAP SDK that appears in ' +
          'no binary inventory row is a manifest that describes a different app than the one submitted. Only the ' +
          'rows\' `binary` field is read: a sentence about the SDK in `basis` or `_why` is not a row for it.',
      );
    }
  }
}

if (iapChecked === 0) {
  coverageLost([
    'limb 6 examined no app declaration at all.',
    'Both of its directions quantify over the declarations limb 1 accepted, so a run with none has not',
    'checked that the mobile-IAP opt-in and the bridge dependency travel together — in either direction.',
  ]);
}
if (problems.length === problemsBeforeIap) {
  if (iapDeclared === 0) {
    // ⬜ PRINTED, NOT FAILED, and the distinction is real rather than lenient.
    // The direction that actually protects a reader — a dependency arriving with
    // no declaration — is ARMED over all `iapChecked` apps and would fail today.
    // What is empty is the forward direction, because no app has opted in yet
    // ([ADR 078] allows mobile IAP; opting in waits on O-REVENUECAT-ACCOUNT). Saying so on every run is
    // this repository's rule for a limb whose domain is empty: an ok line that
    // did not distinguish the two would read as "the sworn IAP rows were
    // checked" when nothing had any.
    console.log(
      `note ⬜ limb 6 — NO app declares \`billing.mobileIap\`, so the forward direction (declared ⇒ bridge ` +
        `dependency + sworn Purchase history + Play dependencySurface entry + Apple ${IAP_SDK_BINARY} inventory ` +
        `rows) graded NOTHING. The reverse direction — a ${IAP_PACKAGE} dependency, Play entry or ` +
        `${IAP_SDK_BINARY} inventory row with no declaration — IS armed and was checked against all ` +
        `${iapChecked} app(s). The forward half arms itself the day an app opts in; no edit here is needed.`,
    );
  } else {
    ok(
      `limb 6 — ${iapDeclared} of ${iapChecked} app(s) declare mobile IAP, each depending on ${IAP_PACKAGE} ` +
        `and swearing "${IAP_PURCHASE_TYPE}" on Play with a dependencySurface entry for it, and with a ` +
        `"${IAP_SDK_BINARY} <version>" row in every Apple binary inventory shipped (structured rows only); the ` +
        'other(s) carry neither the declaration, the dependency nor a store SDK row',
    );
  }
}

// ── limb 7 · AI content is declared, and its consequences hold, both ways ────
//
// O-PLAY-AI-CONTENT-REPORTING. Google Play, AI-Generated Content
// (support.google.com/googleplay/android-developer/answer/13985936, read
// 2026-09-18): an app that generates content with AI "must contain in-app user
// reporting or flagging features ... without needing to exit the app". Duty:
// tooling/legal/duty-matrix.json `play-ai-content-declaration`.
//
// `ai.generatesContent` is REQUIRED by the schema, false included, so every app
// has answered. What this limb adds is that the answer is TRUE OF THE APP:
//
//   · true  ⇒ lib/core/app_config.dart says `generatesAiContent = true` (the
//             constant the brick's Settings gate reads), something in lib/
//             opens the chassis ReportContentDialog, and the Data safety form
//             ANSWERS for table:platform_db.content_reports — a report carries
//             the user's text to our backend, so it is collected data, not an
//             exclusion.
//   · false ⇒ the content-rating questionnaire carries the
//             `generates-ai-content` claim, answered false and derived from
//             dependency-tells covering the AI floor below — so the day a model
//             SDK becomes a dependency, assert-play-declarations fails that claim
//             and this declaration cannot go stale silently. And the constant
//             may not say true while the declaration says false.
//
// ⚠️ WHAT NO TELL CAN SEE: a model called through our OWN backend is plain HTTP
// and adds no package. That path is closed at the declaration, not the pubspec:
// whoever ships generation must flip app.yaml, and the true branch then holds.
const AI_CLAIM_ID = 'generates-ai-content';
/** The direct client SDKs a Flutter app would take to call a model. The claim's
 *  tells must cover at least these; a longer list is welcome. */
const AI_TELL_FLOOR = ['google_generative_ai', 'firebase_ai', 'firebase_vertexai', 'dart_openai', 'openai_dart', 'anthropic_sdk_dart'];
const REPORT_TABLE = 'table:platform_db.content_reports';
const REPORT_OPENERS = /\b(showReportContentDialog|ReportContentDialog)\s*\(/;
const CR_REL = (id) => `${APPS_DIR}/${id}/store/android-play/content-rating.json`;
const CONFIG_REL = (id) => `${APPS_DIR}/${id}/lib/core/app_config.dart`;
const AI_CONST = /static\s+const\s+bool\s+generatesAiContent\s*=\s*(true|false)\s*;/;

/** Every .dart file under `rel`, comments stripped — a wiring that exists only
 *  in a comment is not a wiring. */
function dartSources(rel) {
  const out = [];
  const walk = (abs, r) => {
    for (const e of listDir(abs, { withFileTypes: true })) {
      const childAbs = join(abs, e.name);
      const childRel = `${r}/${e.name}`;
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (e.name.endsWith('.dart')) {
        const text = readFileSync(childAbs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        out.push({ rel: childRel, text });
      }
    }
  };
  const abs = join(ROOT, rel);
  if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, rel);
  return out;
}

let aiChecked = 0;
let aiTrue = 0;
let aiUnanswered = 0;
const problemsBeforeAi = problems.length;

for (const { id, doc } of declarations) {
  const answer = doc?.ai?.generatesContent;
  if (typeof answer !== 'boolean') continue; // limb 1 already refused the declaration
  aiChecked += 1;
  const yamlRel = `${APPS_DIR}/${id}/app.yaml`;

  const cfgAbs = join(ROOT, CONFIG_REL(id));
  const constMatch = existsSync(cfgAbs) ? readFileSync(cfgAbs, 'utf8').match(AI_CONST) : null;
  const constValue = constMatch ? constMatch[1] === 'true' : null;

  if (answer === true) {
    aiTrue += 1;
    if (constValue !== true) {
      problems.push(
        `${yamlRel} declares \`ai.generatesContent: true\` and ${CONFIG_REL(id)} ${constValue === false ? 'says \`generatesAiContent = false\`' : 'declares no \`generatesAiContent\` constant'}. ` +
          'That constant is what puts the report control in Settings; with it false the app ships generation and no in-app way to report it, which is the Play policy violation this declaration exists to prevent.',
      );
    }
    const opener = dartSources(`${APPS_DIR}/${id}/lib`).find((src) => REPORT_OPENERS.test(src.text));
    if (!opener) {
      problems.push(
        `${yamlRel} declares \`ai.generatesContent: true\` and nothing under ${APPS_DIR}/${id}/lib opens the report dialog ` +
          '(`showReportContentDialog(` or `ReportContentDialog(`). Google Play requires the report "without needing to exit the app"; a declaration with no wired control is the violation itself.',
      );
    }
    const play = readJson(PLAY_REL(id));
    if (play.missing || play.broken) {
      problems.push(`${yamlRel} declares \`ai.generatesContent: true\` and ${PLAY_REL(id)} ${play.missing ? 'does not exist' : `is not valid JSON (${play.broken})`}.`);
    } else {
      const excluded = Object.prototype.hasOwnProperty.call(play.json?.inventory?.notFromThisApp ?? {}, REPORT_TABLE);
      const answered = JSON.stringify(play.json?.answers ?? []).includes(REPORT_TABLE);
      if (excluded || !answered) {
        problems.push(
          `${PLAY_REL(id)}: ${yamlRel} declares \`ai.generatesContent: true\` and this form ${excluded ? 'still EXCLUDES' : 'names nowhere in its answers'} ${REPORT_TABLE}. ` +
            'This app now sends user text to that table through its own report control, so the form must answer for it (move it out of inventory.notFromThisApp into an answer row). The sworn file is a statement: this limb reads it and never writes it.',
        );
      }
    }
    continue;
  }

  // answer === false
  if (constValue === true) {
    problems.push(
      `${CONFIG_REL(id)} says \`generatesAiContent = true\` and ${yamlRel} declares \`ai.generatesContent: false\`. The two are one fact; flip the declaration with the feature, and this limb then holds the store paperwork to it.`,
    );
  }
  const cr = readJson(CR_REL(id));
  if (cr.missing || cr.broken) {
    problems.push(`${yamlRel} declares \`ai.generatesContent: false\` and ${CR_REL(id)} ${cr.missing ? 'does not exist' : `is not valid JSON (${cr.broken})`}, so nothing can fail when an AI package arrives.`);
    continue;
  }
  if (!Array.isArray(cr.json?.claims)) {
    // A questionnaire the brick stamped UNANSWERED has no claims at all; limb 4
    // and assert-play-declarations already refuse it for a real submission.
    aiUnanswered += 1;
    console.log(`note ⬜ limb 7 — ${CR_REL(id)} carries no \`claims\` (stamped unanswered), so the \`${AI_CLAIM_ID}\` claim is owed when it is answered.`);
    continue;
  }
  const claim = cr.json.claims.find((c) => c && c.id === AI_CLAIM_ID);
  const tells = new Set(claim?.tells?.dartPackages ?? []);
  const missingTells = AI_TELL_FLOOR.filter((p) => !tells.has(p));
  if (!claim || claim.answer !== false || claim.derivation !== 'dependency-tells' || missingTells.length) {
    problems.push(
      `${CR_REL(id)}: ${yamlRel} declares \`ai.generatesContent: false\` and the \`${AI_CLAIM_ID}\` claim is ` +
        (!claim
          ? 'absent'
          : claim.answer !== false
            ? `answered ${JSON.stringify(claim.answer)}`
            : claim.derivation !== 'dependency-tells'
              ? `derived ${JSON.stringify(claim.derivation)}, not from dependency-tells`
              : `missing the tell(s) ${missingTells.join(', ')}`) +
        '. That claim is what fails the day a model SDK becomes a dependency; without it a "no" here is a promise nothing checks.',
    );
  }
}

if (aiChecked === 0) {
  coverageLost([
    'limb 7 examined no app declaration with an `ai.generatesContent` answer.',
    'Both of its directions quantify over those answers, so a run with none has checked nothing about AI content.',
  ]);
}
if (problems.length === problemsBeforeAi) {
  if (aiTrue === 0) {
    console.log(
      `note ⬜ limb 7 — NO app declares \`ai.generatesContent: true\`, so the forward direction (declared ⇒ constant + wired ReportContentDialog + Data safety answer) graded NOTHING. ` +
        `The false direction IS armed: ${aiChecked - aiUnanswered} app(s) carry the \`${AI_CLAIM_ID}\` dependency-tells claim over the AI floor.`,
    );
  } else {
    ok(`limb 7 — ${aiTrue} of ${aiChecked} app(s) generate AI content, each with the report control wired and content_reports answered; the rest carry the ${AI_CLAIM_ID} claim`);
  }
}

// ── limb 8 · export-compliance consistency ───────────────────────────────────
//
// O-APPLE-PLIST-KEYS-UNRENDERED. `exportCompliance.usesNonExemptEncryption` is
// REQUIRED by the schema, false included, and render.mjs writes it into
// ITSAppUsesNonExemptEncryption in both Apple Info.plists, where App Store
// review reads it as a legal answer. This limb holds a `false` to the code the
// app ships (design apple-plist-keys sections 1 and 2d):
//
//   · no shipped Dart file (the app's lib/, every packages/*/lib, and the app
//     brick's lib/ when present) imports a cipher package, except where
//     EXEMPT_CIPHER_IMPORTS records that file, that package and why the use is
//     inside the exemption; a row whose file no longer imports it is stale;
//   · no shipped Dart file names a cipher class (the section 1 grep), exempt
//     files included: an exemption is for a package, not for what is done with it;
//   · the app's pubspec.yaml (and the brick's) declares no direct dependency on
//     a cipher package.
//
// ⚠️ lib/ ONLY, BECAUSE ONLY lib/ SHIPS. packages/core/test and packages/core/
// tool import `cryptography` to make and check test signatures; neither is in a
// bundle. ⚠️ pubspec.lock IS NOT READ: gotrue pulls pointycastle in transitively
// for JWT verify, which is authentication and inside the exemption. A `true`
// answer is not graded here: it is the conservative answer, and the owner gives
// it to App Store Connect with its documentation.
const CIPHER_PACKAGES = ['cryptography', 'cryptography_flutter', 'encrypt', 'pointycastle', 'sodium', 'sodium_libs', 'libsodium', 'webcrypto'];
// `[ \t]*`, never `\s*`: a blanked comment leaves bare newlines, and `\s*` would
// start the match lines above the import and report the wrong line.
const CIPHER_IMPORT = new RegExp(`^[ \\t]*(?:import|export)\\s+['"]package:(${CIPHER_PACKAGES.join('|')})/`, 'gm');
const CIPHER_CLASS = /AesGcm|AesCbc|AesCtr|Chacha20|Xchacha|Cipher|\.encrypt\(|SecretBox|BlockCipher|StreamCipher|RSAEngine|AESEngine/g;
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** Each row: one shipped file, one cipher package, and why that use is exempt. */
const EXEMPT_CIPHER_IMPORTS = [
  {
    file: 'packages/core/lib/src/content/ed25519_pack_verifier.dart',
    pkg: 'cryptography',
    why: 'Ed25519 signature VERIFY of signed content packs: a digital signature, inside the exemption (design apple-plist-keys section 1).',
  },
];

/** Every .dart file under `rel`, comments blanked with their newlines KEPT, so
 *  a hit's line number is the line in the file. */
function shippedDart(rel) {
  const out = [];
  const walk = (abs, r) => {
    for (const e of listDir(abs, { withFileTypes: true })) {
      const childAbs = join(abs, e.name);
      const childRel = `${r}/${e.name}`;
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (e.name.endsWith('.dart')) {
        const text = readFileSync(childAbs, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
          .replace(/\/\/.*$/gm, '');
        out.push({ rel: childRel, text });
      }
    }
  };
  const abs = join(ROOT, rel);
  if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, rel);
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The package names a pubspec's top-level `dependencies:` block declares. */
function directDependencies(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  // The block runs until the next top-level key; indented lines, blank lines
  // and column-0 comments stay inside it.
  const block = readFileSync(abs, 'utf8').match(/^dependencies:[ \t]*\r?\n((?:(?:[ \t#].*|[ \t]*)\r?\n)*)/m);
  if (!block) return [];
  return [...block[1].matchAll(/^ {2}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

const falseApps = declarations.filter(({ doc }) => doc?.exportCompliance?.usesNonExemptEncryption === false);
const answeredApps = declarations.filter(({ doc }) => typeof doc?.exportCompliance?.usesNonExemptEncryption === 'boolean');
if (answeredApps.length === 0) {
  coverageLost([
    'limb 8 examined no app declaration with an `exportCompliance.usesNonExemptEncryption` answer.',
    'It quantifies over those answers, so a run with none has checked nothing about export compliance.',
  ]);
}
const problemsBeforeExport = problems.length;
let exportFilesScanned = 0;
if (falseApps.length) {
  const shared = [];
  const packagesAbs = join(ROOT, 'packages');
  const packageNames = existsSync(packagesAbs)
    ? listDir(packagesAbs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  for (const pkg of packageNames) shared.push(...shippedDart(`packages/${pkg}/lib`));
  if (shared.length === 0) {
    coverageLost([
      'limb 8 found no Dart file under any packages/*/lib.',
      'Every app ships those packages, so an app declaring no non-exempt encryption was graded against none of the code it links.',
    ]);
  }
  shared.push(...shippedDart(`${BRICK_APP}/lib`));
  const exempt = (rel, pkg) => EXEMPT_CIPHER_IMPORTS.some((x) => x.file === rel && x.pkg === pkg);
  const ids = falseApps.map(({ id }) => id).join(', ');
  const hitsIn = (sources, who) => {
    for (const src of sources) {
      exportFilesScanned += 1;
      for (const m of src.text.matchAll(CIPHER_IMPORT)) {
        if (exempt(src.rel, m[1])) continue;
        problems.push(
          `${who} declares no non-exempt encryption and imports ${m[1]} at ${src.rel}:${lineOf(src.text, m.index)}; ` +
            're-measure and re-declare `exportCompliance` (legal answer), or remove it. A use inside the exemption (authentication, a digital signature, hashing) is recorded as a row in EXEMPT_CIPHER_IMPORTS in tooling/ci/assert-app-yaml.mjs, with its reason.',
        );
      }
      for (const m of src.text.matchAll(CIPHER_CLASS)) {
        problems.push(
          `${who} declares no non-exempt encryption and names the cipher \`${m[0]}\` at ${src.rel}:${lineOf(src.text, m.index)}; ` +
            're-measure and re-declare `exportCompliance` (legal answer), or remove it.',
        );
      }
    }
  };
  hitsIn(shared, `every app linking it (${ids})`);
  for (const { id } of falseApps) {
    const own = shippedDart(`${APPS_DIR}/${id}/lib`);
    if (own.length === 0) {
      coverageLost([
        `limb 8 found no Dart file under ${APPS_DIR}/${id}/lib.`,
        `${APPS_DIR}/${id}/app.yaml declares no non-exempt encryption, and the code that answer is about was not read.`,
      ]);
    }
    hitsIn(own, `${APPS_DIR}/${id}/app.yaml`);
    for (const pubspec of [`${APPS_DIR}/${id}/pubspec.yaml`]) {
      const deps = directDependencies(pubspec);
      if (deps === null) {
        problems.push(`${APPS_DIR}/${id}/app.yaml declares no non-exempt encryption and ${pubspec} does not exist, so its dependencies cannot be read.`);
        continue;
      }
      for (const d of deps.filter((x) => CIPHER_PACKAGES.includes(x))) {
        problems.push(
          `${APPS_DIR}/${id}/app.yaml declares no non-exempt encryption and ${pubspec} depends directly on ${d}; re-measure and re-declare \`exportCompliance\` (legal answer), or remove it.`,
        );
      }
    }
  }
  const brickDeps = directDependencies(`${BRICK_APP}/pubspec.yaml`);
  for (const d of (brickDeps ?? []).filter((x) => CIPHER_PACKAGES.includes(x))) {
    problems.push(
      `${BRICK_APP}/pubspec.yaml depends directly on ${d}, and the brick stamps \`usesNonExemptEncryption: false\` into every new app; remove it, or stamp a measured answer.`,
    );
  }
  for (const x of EXEMPT_CIPHER_IMPORTS) {
    const abs = join(ROOT, x.file);
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (text === null || !new RegExp(`['"]package:${x.pkg}/`).test(text)) {
      problems.push(
        `EXEMPT_CIPHER_IMPORTS in tooling/ci/assert-app-yaml.mjs records ${x.file} importing ${x.pkg}, and ${text === null ? 'that file does not exist' : 'it no longer does'}. ` +
          'A stale exemption is one the next import of that package walks through unread; delete the row.',
      );
    }
  }
}
if (problems.length === problemsBeforeExport) {
  if (falseApps.length === 0) {
    console.log(`note ⬜ limb 8 — every one of ${answeredApps.length} app(s) declares \`usesNonExemptEncryption: true\`, the conservative answer, so there is no \`false\` to hold to the code.`);
  } else {
    ok(
      `limb 8 — ${falseApps.length} app(s) declare no non-exempt encryption; ${exportFilesScanned} shipped Dart file(s) carry no cipher class and no cipher import ` +
        `outside the ${EXEMPT_CIPHER_IMPORTS.length} recorded exemption(s), and no app pubspec depends on a cipher package directly`,
    );
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`\nassert-app-yaml: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `\nassert-app-yaml: ok — ${declarations.length} app declaration(s), ${files.size} rendering(s) fresh, ` +
    `${privacyGraded} app and ${extensionDeclarations.length} extension privacy declaration(s) graded against ` +
    `${providerIds.size} named provider(s).`,
);
