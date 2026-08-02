#!/usr/bin/env node
// [pipeline C-8] EVERY VENDOR SATISFIES THE PORTABILITY CHECKLIST — not "behind
// a seam" alone.
//
// Top-down from the charter kept "behind a seam" and silently dropped the rest,
// which is how a seam ends up LOOKING like portability while a vendor swap still
// requires a store release. The seam is one part of six.
//
// SIX PARTS, NOT FOUR. C-8's own title says "four-part"; portability-standard.md
// §Checklist lists six. The lock resolved the contradiction to SIX — the
// checklist is the primary record and C-8 is the copy. Four parts are
// machine-checkable and BLOCK the build; two are judgement and PRINT, because a
// guard that pretends to check judgement is a guard that always passes.
//
// ── SURFACES ARE DERIVED FROM FOUR SOURCES, AND ANY ONE ALONE IS BLIND ───────
// All four verified against the real tree 2026-07-28:
//
//   a. `*.fromEnvironment('KEY')` in Dart — scanned MULTILINE. A line-based grep
//      finds 2 of the 11 that exist, because `dart format` wraps the literal
//      onto the following line. UPDATE_URL is one of the nine it misses. This is
//      the scanner-that-stopped-scanning failure in its purest form: the grep
//      returns a confident, wrong, small number.
//   b. `interface Env` in services/*/src/types.ts — REVENUECAT_WEBHOOK_SECRET
//      exists ONLY here. Without this source RevenueCat — the amendment's own
//      headline example — is invisible to the whole check.
//   c. wrangler `binding` keys AND `ratelimits[].name`. The ratelimits block
//      uses `name`, not `binding`, so a binding-only scan cannot see
//      EVENTS_LIMITER. Confirmed by scanning for bindings and watching it not
//      appear.
//   d. `triggers.crons` — a schedule is an external surface too, and a dead cron
//      looks exactly like a live one.
//
// Every derived surface must be claimed by exactly one vendor, or declared a
// non-vendor surface. An unclaimed token is indistinguishable from a vendor
// nobody reviewed, which is the adoption-without-review this requirement stops.
//
// SCOPE: services, not libraries — the checklist opens "before adopting any new
// SERVICE". Dart package deps are C-5 limb (c)'s job; duplicating them here
// would be two lists to keep in step.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';

const ROOT = process.cwd();
const REGISTER = 'tooling/capability-register.json';
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

let reg;
try {
  reg = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (e) {
  console.error(`FAIL ${REGISTER} could not be read or parsed (${e.message}).`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exit(1);
}
const vendors = reg.vendors;
const nonVendor = reg.nonVendorSurfaces;
if (!vendors || !nonVendor) {
  console.error(`FAIL ${REGISTER} is missing \`vendors\` and/or \`nonVendorSurfaces\`. With neither, every external surface in the tree is unreviewed and this guard has nothing to range over.`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exit(1);
}

// ── DERIVATION ───────────────────────────────────────────────────────────────
const derived = new Map(); // token -> source label

// (a) Dart compile-time defines. MULTILINE — see the header.
let dartFiles = [];
try {
  dartFiles = execSync('git ls-files "*.dart"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  problems.push('COVERAGE LOST — could not list tracked .dart files, so source (a) contributed nothing. Every compile-time define in the app would go unreviewed.');
}
let dartHits = 0;
for (const f of dartFiles) {
  let src = '';
  try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/(?:String|bool|int)\.fromEnvironment\(\s*'([A-Z][A-Z0-9_]*)'/g)) {
    derived.set(m[1], derived.get(m[1]) ?? 'dart-define');
    dartHits++;
  }
}

// (b) Worker Env interfaces.
let envHits = 0;
const svcRoot = join(ROOT, 'services');
// DIRECTORIES ONLY. `services` is the set every per-service relationship below
// ranges over, so a stray file in services/ must not become a phantom member.
const services = existsSync(svcRoot)
  ? listDir(svcRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];
for (const s of services) {
  const p = join(svcRoot, s, 'src/types.ts');
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  const block = src.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
  if (!block) continue;
  for (const m of block[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*[?:]/gm)) {
    derived.set(m[1], derived.get(m[1]) ?? `worker-env:${s}`);
    envHits++;
  }
}

// (c) + (d) wrangler bindings, ratelimit names, and cron schedules.
//
// THE ONE FILENAME THIS SCAN UNDERSTANDS. Named once, so the coverage check
// below can say it out loud instead of leaving the reader to infer it.
const WRANGLER = 'wrangler.jsonc';
let bindingHits = 0;
/** service → how many wrangler surfaces it contributed. The per-service split is
 *  the whole point: a total cannot tell "one Worker's config went unreadable"
 *  from "this Worker has fewer bindings than the other". */
const wranglerPerService = new Map(services.map((s) => [s, 0]));
for (const s of services) {
  const p = join(svcRoot, s, WRANGLER);
  if (!existsSync(p)) continue;
  const before = bindingHits;
  // Strip // comments so a commented-out binding is not counted as one.
  const src = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(/"binding"\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
    derived.set(m[1], derived.get(m[1]) ?? `wrangler-binding:${s}`);
    bindingHits++;
  }
  // ratelimits entries key on `name`, NOT `binding` — see the header.
  const rl = src.match(/"ratelimits"\s*:\s*\[([\s\S]*?)\n\s*\]/);
  if (rl) {
    for (const m of rl[1].matchAll(/"name"\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
      derived.set(m[1], derived.get(m[1]) ?? `wrangler-ratelimit:${s}`);
      bindingHits++;
    }
  }
  if (/"crons"\s*:\s*\[\s*"/.test(src)) {
    derived.set('triggers.crons', derived.get('triggers.crons') ?? `wrangler-cron:${s}`);
    bindingHits++;
  }
  wranglerPerService.set(s, bindingHits - before);
}

// Per-source coverage self-checks. A single total would let one source die
// silently while the others carried the number — and each source exists
// precisely because the others cannot see what it sees.
const FLOORS = { 'dart-define': 10, 'worker-env': 15 };
if (dartHits < FLOORS['dart-define']) {
  problems.push(`COVERAGE LOST — source (a) found only ${dartHits} compile-time define(s), expected >= ${FLOORS['dart-define']}. A LINE-BASED scan finds 2 here; if this number collapsed toward 2, the multiline match has broken and nine defines including UPDATE_URL are invisible again.`);
}
if (envHits < FLOORS['worker-env']) {
  problems.push(`COVERAGE LOST — source (b) found only ${envHits} Worker Env key(s), expected >= ${FLOORS['worker-env']}. REVENUECAT_WEBHOOK_SECRET exists only here, so losing this source hides a whole vendor.`);
}

// ── source (c)/(d) IS A RELATIONSHIP, NOT A NUMBER ───────────────────────────
// 🔴 IT USED TO BE `bindingHits >= 5`, against a tree measuring 11. Corpus
// triage 2026-08-01 (#39) mutated the real repository — `mv
// services/subly-api/wrangler.jsonc wrangler.json` — and watched the total fall
// 11 → 7 and the guard EXIT 0. Nothing else caught it either: the four lost
// surfaces are D1/KV bindings that ALSO appear in that Worker's `interface Env`,
// so source (b) kept them in `derived` and no vendor's claim went stale. One
// Worker's entire wrangler surface — a cron, a ratelimit name, anything living
// only in the config — could vanish behind a total the other Worker carried on
// its own.
//
// A floor can only ever say "not zero-ish". What is actually true, and stays
// true as services are added or removed, is a RELATIONSHIP: every directory
// under services/ is a deployed Worker, and a deployed Worker is deployed BY a
// wrangler config, so every one of them must contribute at least one surface.
// That expectation is derived from the tree on each run — it cannot sit below
// reality, because reality is what computes it.
if (services.length === 0) {
  problems.push(`COVERAGE LOST — no service directories under \`services/\`, so source (c)/(d) ranged over nothing. Every wrangler binding, ratelimit name and cron schedule in the repo would be invisible and this guard would still print ok.`);
} else {
  const blind = [...wranglerPerService.entries()].filter(([, n]) => n === 0).map(([s]) => s);
  if (blind.length) {
    problems.push(
      `COVERAGE LOST — source (c)/(d) read ZERO wrangler surfaces from ${blind.length} of ${services.length} service(s): ${blind.map((s) => `services/${s}`).join(', ')}. ` +
        `Each directory under \`services/\` is a deployed Worker and must contribute at least one binding, \`ratelimits[].name\` or cron. ` +
        `This scan reads exactly one filename — \`${WRANGLER}\` — so a config renamed, moved or deleted takes that Worker's whole external surface with it while the remaining service carries the total. ` +
        `If the layout genuinely changed, teach this scan the new one in the SAME change; do not let the count speak for it.`,
    );
  }
}
if (problems.length === 0) {
  const split = [...wranglerPerService.entries()].map(([s, n]) => `${s}:${n}`).join(', ');
  ok(`derived ${derived.size} external surface(s) — ${dartHits} dart-define hit(s), ${envHits} Worker Env key(s), ${bindingHits} wrangler surface(s) across ${services.length} service(s) (${split})`);
}

// ── Every surface is claimed exactly once ────────────────────────────────────
const claimedBy = new Map();
for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  for (const s of v.surfaces ?? []) {
    if (claimedBy.has(s)) problems.push(`surface \`${s}\` is claimed by BOTH \`${claimedBy.get(s)}\` and \`${id}\`. Two owners means neither is accountable for its checklist.`);
    claimedBy.set(s, id);
  }
}
for (const [token, source] of derived) {
  if (claimedBy.has(token)) continue;
  if (nonVendor[token]) continue;
  problems.push(
    `external surface \`${token}\` (found in ${source}) is claimed by NO vendor and is not declared a non-vendor surface. Add it to a vendor's \`surfaces\` with the six-part record, or to \`nonVendorSurfaces\` saying what it is. An unclaimed surface is indistinguishable from a vendor nobody reviewed.`,
  );
}
// Stale in the other direction.
for (const [s, id] of claimedBy) {
  if (!derived.has(s)) problems.push(`vendor \`${id}\` claims surface \`${s}\`, which no longer exists anywhere in the tree. Remove it — a checklist covering a surface that is gone overstates what is reviewed.`);
}
for (const t of Object.keys(nonVendor)) {
  if (t.startsWith('_')) continue;
  if (!derived.has(t)) problems.push(`\`nonVendorSurfaces\` declares \`${t}\`, which no longer exists in the tree. Remove the stale entry.`);
}

// ── The six parts ────────────────────────────────────────────────────────────
const CHECKED = ['seam', 'configKeyed', 'exportPath', 'exitPlan'];
const PRINTED = ['openProtocol', 'ownTheRecord'];
let vendorCount = 0;
const unverifiableExports = [];
let checkableExports = 0;
for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  vendorCount++;
  for (const part of [...CHECKED, ...PRINTED]) {
    if (!v[part]) problems.push(`vendor \`${id}\` records nothing for checklist part \`${part}\`. The checklist is six parts; a missing one is the part that bites during the swap.`);
  }
  // part 2 — the seam symbol must really be where it says.
  if (v.seam?.file) {
    const p = join(ROOT, v.seam.file);
    if (!existsSync(p)) {
      problems.push(`vendor \`${id}\` names seam file \`${v.seam.file}\`, which does not exist. A seam you cannot open is not a seam.`);
      // 🔴 `interface X` IS A SEAM DECLARATION TOO. This pattern was Dart-only
      // (`class` / `abstract class` / `interface class`), which silently made
      // part 2 unrecordable for any vendor whose seam is a TypeScript interface
      // on a Worker — and the merchant-of-record seam ([ADR 004]'s
      // `MoRWebhookVerifier`) is exactly that. The alternative was to cite some
      // nearby Dart class instead, i.e. to record a seam that is not the seam.
      // Widening the pattern keeps the assertion identical in kind: the named
      // symbol must really be DECLARED in the named file.
    } else if (
      v.seam.symbol &&
      !new RegExp(`\\b(?:abstract\\s+)?(?:interface\\s+)?class\\s+${v.seam.symbol}\\b`).test(readFileSync(p, 'utf8')) &&
      !new RegExp(`\\binterface\\s+${v.seam.symbol}\\b`).test(readFileSync(p, 'utf8'))
    ) {
      problems.push(`vendor \`${id}\` names seam symbol \`${v.seam.symbol}\` in \`${v.seam.file}\`, which does not declare it.`);
    }
  }
  // part 3 — runtime, or compile-time WITH a reason.
  const ck = v.configKeyed;
  if (ck && ck.kind !== 'runtime' && !ck.reason) {
    problems.push(`vendor \`${id}\` is \`${ck.kind}\` config-keyed with no \`reason\`. "No release to repoint" is the property this part exists for, so an exception has to argue for itself.`);
  }
  // part 5 — the export path must exist on disk.
  //
  // 🔴 CAUGHT BY CI, NOT LOCALLY, AND THE DIVERGENCE IS THE POINT. This guard
  // runs in the PUBLIC repo, where `company/` is gitignored and structurally
  // absent — so citing a private runbook as machine-checkable evidence passes on
  // a dev box (company/ is on disk) and fails in CI. The first version of this
  // check did exactly that.
  //
  // The fix follows this repo's own grading rule — NO SILENT SKIPS: a path the
  // guard cannot see is graded `could-not-establish` WITH ITS REASON and
  // printed, never quietly passed. And the exemption is STRUCTURAL, not a flag:
  // only `company/` qualifies, because that prefix is the private-SSoT boundary
  // itself. A boolean anybody could set would make part 5 optional.
  if (v.exportPath?.path) {
    const p = v.exportPath.path;
    if (p.startsWith('company/')) {
      unverifiableExports.push(`${id} → ${p}`);
    } else if (!existsSync(join(ROOT, p))) {
      problems.push(`vendor \`${id}\` cites export path \`${p}\`, which does not exist. An untested exit is not an exit.`);
    } else {
      checkableExports++;
    }
  }
  // part 6 — a named alternative and a swap cost.
  if (v.exitPlan && (!v.exitPlan.alternative || !v.exitPlan.swapCost)) {
    problems.push(`vendor \`${id}\`'s \`exitPlan\` must name an alternative AND its swap cost. "We could move" without a named destination is not a plan.`);
  }
}
if (vendorCount === 0) {
  problems.push('COVERAGE LOST — the register declares no vendors at all, so every checklist assertion below ranges over nothing and this guard passes by vacancy.');
} else {
  ok(`${vendorCount} vendor(s) carry all six checklist parts; ${CHECKED.length} checked against the tree, ${PRINTED.length} printed`);
}

// If EVERY export path were private, part 5 would be recorded everywhere and
// verified nowhere — present, and decorative. At least one has to be real.
if (vendorCount > 0 && checkableExports === 0) {
  problems.push(
    'COVERAGE LOST — not one export path points at something this guard can open. Part 5 would then be recorded for every vendor and checked for none, which is the "assertion that cannot fail" shape. At least one vendor must cite public, checkable evidence.',
  );
}
if (unverifiableExports.length) {
  notes.push(`could-not-establish (${unverifiableExports.length}) — export path is in the PRIVATE company SSoT, which is gitignored and absent from this repo by design, so CI cannot open it:`);
  for (const u of unverifiableExports) notes.push(`    ${u}`);
}

// ── Surfaces MOVED to runtime config must still be moved. ────────────────────
// Found by asking what mutation would beat this guard: the register records that
// UPDATE_URL was fixed, but a register entry is a claim about code, and nothing
// re-checked the code. Reverting the fix would leave this guard printing `ok`
// while the kill-switch went circular again — the same "hollow record" shape
// C-16's source anchors exist for. So each migration names the line that proves
// it, in BOTH halves: parsed in core, and actually read by the app.
const RUNTIME_MIGRATIONS = [
  {
    surface: 'UPDATE_URL',
    anchors: [
      { file: 'packages/core/lib/src/config/app_config.dart', re: /updateUrl:\s*\n?\s*json\['update_url'\]/, what: "core's AppConfig must PARSE `update_url` from the config body" },
      { file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart', re: /valueOrNull\?\.updateUrl\s*\?\?/, what: 'the brick must READ the runtime value, with the compiled-in define as the offline fallback' },
    ],
    why: 'the force-update wall is the emergency exit; an exit you can only move by shipping a new build is not one',
  },
];
for (const m of RUNTIME_MIGRATIONS) {
  for (const a of m.anchors) {
    let src = '';
    try { src = readFileSync(join(ROOT, a.file), 'utf8'); } catch {
      problems.push(`\`${m.surface}\` claims a runtime-config migration, but \`${a.file}\` could not be read to confirm it.`);
      continue;
    }
    if (!a.re.test(src)) {
      problems.push(`\`${m.surface}\` is recorded as moved to runtime config, but the implementation is gone — ${a.what}. ${m.why}.`);
    }
  }
}
ok(`${RUNTIME_MIGRATIONS.length} runtime-config migration(s) still implemented, both halves`);

// ── Declared violations. These BLOCK — part 3 is machine-checkable, and the
//    UPDATE_URL fix is a decided item, not a judgement call. ─────────────────
for (const [token, entry] of Object.entries(nonVendor)) {
  if (token.startsWith('_') || typeof entry !== 'object' || !entry.violation) continue;
  problems.push(
    `\`${token}\` FAILS the portability checklist: ${entry.violation}` +
      (entry.decision ? ` — ${entry.decision}` : ''),
  );
}

for (const [id, v] of Object.entries(vendors)) {
  if (id.startsWith('_')) continue;
  notes.push(`· ${id} — protocol: ${String(v.openProtocol ?? '?').split(' —')[0]}`);
  notes.push(`    own the record: ${String(v.ownTheRecord ?? '?').split(' —')[0]}`);
}
if (notes.length) {
  console.log('\n⬜ The two judgement parts, printed rather than pretended-checked:');
  for (const n of notes) console.log(`  ${n}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-vendor-portability: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-vendor-portability: ok — ${derived.size} surface(s) all claimed, ${vendorCount} vendor(s) complete on all six parts`);
}
