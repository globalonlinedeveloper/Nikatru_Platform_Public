#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-do-alarms.mjs — NO SHIPPED WORKER SCHEDULES ITSELF WITH A DURABLE
// OBJECT ALARM.
//
// [pipeline 13]T-10 states TWO prohibitions in one sentence: server-assisted
// re-engagement rides the ONE shared cron in services/platform — "never a
// per-app cron AND NEVER DURABLE OBJECT ALARMS". Until this file, only the
// first was mechanised: `[3]S-6`'s cron limb in assert-clone-contract.mjs reads
// `triggers.crons` and fails on one outside services/platform. Measured
// 2026-08-05 and again before this guard was written, `rg -i alarm
// tooling/ci/*.mjs` returned nothing but unrelated prose — the words "false
// alarms" in three guards and a DST comment in a fourth. THERE WAS NO
// DURABLE-OBJECT-ALARM CHECK ANYWHERE IN THIS REPOSITORY.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY THIS IS WORSE THAN AN ORDINARY MISSING CHECK, AND THE REASON IT IS ITS
//    OWN GUARD RATHER THAN A FOOTNOTE ON THE CRON LIMB.
//
// A Durable Object Alarm is the EXACT SUBSTITUTE an engineer reaches for the
// moment a cron is refused — it is the documented Cloudflare answer to "I need
// scheduled work and I cannot have a cron trigger". So the half that WAS
// guarded actively pushed work toward the half that was NOT: a build failure on
// `triggers.crons` is a signpost to the unguarded path, and the more reliably
// the cron limb fires, the more attractive the alarm becomes. A prohibition
// whose only enforced half redirects traffic into its unenforced half is worse
// than no prohibition, because it looks like coverage.
//
// The constraint itself is inherited from G-40 verbatim and is not re-litigated
// here: per-object alarms reintroduce exactly the per-app scheduling fan-out
// that ONE shared cron over a due-time table exists to avoid. The difference is
// that a cron announces itself in a config a human reviews, while an alarm is
// three lines of TypeScript inside a class — `this.state.storage.setAlarm(t)` —
// and NOTHING in any wrangler config has to change for it to start firing.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DOMAIN, AND THE ENUMERATION BUG THIS FIXES ON THE WAY PAST.
//
// T-10's acceptance says "ANY wrangler config". Its own status block records
// that the cron limb cannot deliver that: `listDir('services')` cannot see a
// `wrangler.jsonc` at the REPO ROOT, under `sites/`, or under `apps/`.
// assert-platform-register.mjs has the same shape (services/* plus the brick,
// by hand). Latent today — all three configs that exist are inside those sets —
// and live the first time a Worker config lands anywhere else.
//
// So this guard does NOT enumerate by naming directories it expects. It globs
// the whole tree for `wrangler.{jsonc,json,toml}` through `boundedGlob`, which
// is `**`-with-nested-checkouts-excluded, and then CROSS-CHECKS what it opened
// against `git ls-files`. A config the repo tracks and this scan never read is
// COVERAGE LOST, not a clean result. That relationship needs no tuning and
// grows with the portfolio — the floor "3" would be a number somebody lowers.
//
// ⚠️ THE BRICK TEMPLATE IS IN SCOPE and it is why the enumeration cannot use
// paths as glob PATTERNS. Its Worker sits under
// `tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/…`
// and the `/` inside the Mustache close tag IS A PATH SEPARATOR — on disk that
// is a directory named `{{#needs_backend}}services{{` containing one named
// `needs_backend}}`. Braces are glob syntax, so feeding such a path back to a
// matcher does not mean what it looks like. Every path here is used LITERALLY
// after enumeration: directories are walked with `listDir`, never re-globbed.
// (check-migrations.mjs hit the sibling of this and answered it by keeping its
// brick pattern deliberately loose.)
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ NEVER A GREP, ON EITHER LIMB.
//
// This repo has already shipped a guard whose `grep '"r2_buckets"'` matched the
// TEMPLATE COMMENT EXPLAINING WHY THERE IS NO r2_buckets, and subly-api's own
// config still ends with a paragraph headed `NO "r2_buckets"`. The same trap is
// loaded here twice over: the platform config's header says the word "cron"
// twice in prose, and any file documenting this rule will contain the very
// spellings the rule bans. So:
//   · configs are PARSED — comments stripped, then JSON.parse, then the check
//     reads `durable_objects` and `migrations[].new_classes` off the OBJECT;
//   · sources are reduced by stripSourceComments AND stripStringLiterals before
//     a single pattern is applied, so neither a comment nor a string literal
//     mentioning `setAlarm` can fail a build, and — the direction that actually
//     matters — no comment can be mistaken for the code being absent.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS CHECKED, AND THE ONE PLACE THIS IS DELIBERATELY STRICTER THAN T-10.
//
//   CONFIG   `durable_objects.bindings`, and `migrations[]` entries carrying
//            `new_classes` / `new_sqlite_classes` / `renamed_classes` /
//            `transferred_classes`.
//   SOURCE   an `alarm(…) {` handler method; `setAlarm` / `getAlarm` /
//            `deleteAlarm` calls on any receiver; and the DO surface itself —
//            `extends DurableObject`, `DurableObjectNamespace`,
//            `DurableObjectState`, `DurableObjectStub`.
//
// 🔴 THAT LAST GROUP IS STRICTER THAN THE LETTER OF T-10, ON PURPOSE, AND THE
// REASON IS MECHANICAL RATHER THAN STYLISTIC. The alarm API is reachable from
// ANY Durable Object with no separate declaration in any config — there is no
// "alarms: true" to look for. So the only boundary at which the prohibition can
// be checked before the fact is the DO boundary itself. This repo has ZERO
// Durable Objects, so the strictness costs nothing today; if a DO is ever
// genuinely needed WITHOUT an alarm, that is a deliberate decision to take in
// the open, by editing this guard and saying why — which is precisely the
// review this exists to force, and the opposite of an alarm arriving unnoticed.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS CANNOT SEE, STATED RATHER THAN IMPLIED.
//
//   · DYNAMIC DISPATCH. `st['set' + 'Alarm'](t)` or `st[k](t)` defeats every
//     pattern here, as it defeats every static scanner in tooling/ci. The DO
//     limb above is the partial answer: the object it would be called on still
//     has to exist, and that is visible.
//   · A `wrangler.toml`. TOML is not parsed structurally by anything in this
//     repo and this guard will not grep one as a consolation prize — a .toml
//     config is a HARD FAILURE telling the author to convert it, which is what
//     subly-api already did on its v3→v4 migration. Silently skipping it would
//     be the exact "scan reached nothing, printed ok" shape.
//   · ANYTHING NOT IN THE REPO. An alarm added to a Worker through the
//     Cloudflare dashboard, or a Worker deployed from another tree, is outside
//     every guard here — the same blind spot `api.nikatru.com` sat in for
//     months while it was bound only in the dashboard.
//   · SOURCE OUTSIDE A WORKER ROOT. The source limb scans the directory tree of
//     each wrangler config it found. A DO class defined in some shared package
//     and imported in would be caught only at the import site, by the
//     `DurableObject*` type names it cannot avoid mentioning.
//
// Usage:  node tooling/ci/assert-no-do-alarms.mjs [repoRoot]
// Exit 0 = no Durable Object alarm surface anywhere; 1 = one exists, or the
// scan could not prove it looked at this tree.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir, boundedGlob } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const scanningRealRepo = process.argv[2] === undefined;

/** The one Worker every real tree has, and the anchor that says this scan is
 *  looking at THIS repository rather than at an empty directory that agrees
 *  with everything. Same role as CRON_HOME in assert-clone-contract.mjs. */
const ANCHOR_CONFIG = 'services/platform/wrangler.jsonc';

const CONFIG_PATTERNS = [
  '**/wrangler.jsonc',
  '**/wrangler.json',
  '**/wrangler.toml',
  // Explicit root-level entries. `**/x` matching a top-level `x` is true of
  // node's matcher today and is not a property worth depending on silently.
  'wrangler.jsonc',
  'wrangler.json',
  'wrangler.toml',
];

/** Not part of the tree under test. Vendored code and build output can contain
 *  anything and none of it ships from this repo. (Nested checkouts and
 *  `.claude` are already excluded inside tree-walk.mjs.) */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules', '.git', '.dart_tool', '.wrangler', 'build', 'dist', 'coverage', '.next', 'out',
]);

const SOURCE_EXT = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

/** The alarm surface itself — T-10's words, made checkable.
 *
 *  Boundaries matter and differ per rule. `setAlarm` allows a `.` on its left
 *  because the realistic spelling is `state.storage.setAlarm(…)`; the handler
 *  rule forbids one, because `alarm(` preceded by a dot is a CALL to something
 *  named alarm, not the declaration of the handler Cloudflare invokes. */
const ALARM_RULES = [
  {
    // 🔴 THIS PATTERN WAS WRONG WHEN IT WAS FIRST WRITTEN, AND ONLY MUTATING THE
    // REAL TREE SHOWED IT. The first version ended `\)\s*\{` and therefore
    // missed `async alarm(): Promise<void> {` — the ordinary TypeScript
    // spelling, and the one the planted Durable Object in services/subly-api
    // actually used. Three sibling rules fired on that mutation, so the guard
    // went red and the miss was invisible in the exit code; it showed up only as
    // "3 problems" where 4 were expected. A fixture written by the same hand
    // would have encoded the same blind spot. The optional `: <type>` between
    // the parameter list and the brace is the repair.
    //
    // Two spellings, because Cloudflare invokes `obj.alarm()` and does not care
    // which one produced the method: the declaration form, and the
    // class-property form `alarm = async () => {…}`.
    re: /(?:^|[^\w$.])(?:async\s+)?alarm\s*\([^)]*\)\s*(?::[^\n{;=]*)?\{|(?:^|[^\w$.])alarm\s*(?::[^\n=;]*)?=\s*(?:async\s*)?(?:\(|function\b)/m,
    what: 'declares an `alarm()` handler',
    why: 'that is the method the Durable Object runtime invokes when an alarm fires — the scheduled entry point T-10 forbids.',
  },
  {
    re: /(?:^|[^\w$])setAlarm\s*\(/m,
    what: 'calls `setAlarm(`',
    why: 'that schedules a Durable Object alarm. Scheduled work belongs to the ONE cron in services/platform, over a due-time table.',
  },
  {
    re: /(?:^|[^\w$])(?:getAlarm|deleteAlarm)\s*\(/m,
    what: 'calls `getAlarm(` or `deleteAlarm(`',
    why: 'only code that manages an alarm schedule reads or clears one, so the alarm exists even if `setAlarm` is written elsewhere.',
  },
];

/** The Durable Object surface. See the header: the alarm API needs no
 *  declaration of its own, so the DO boundary is the only place the ban is
 *  checkable in advance. */
const DO_SURFACE_RULES = [
  {
    re: /extends\s+DurableObject\b/m,
    what: 'defines a Durable Object class',
    why: 'every Durable Object can call `setAlarm` with nothing else declared anywhere, so a DO IS the alarm on-ramp. This repo has none.',
  },
  {
    re: /(?:^|[^\w$])DurableObject(?:Namespace|State|Stub)\b/m,
    what: 'names a Durable Object runtime type',
    why: 'the namespace/state/stub types appear only where a Durable Object is bound, constructed or called. This repo has no Durable Objects.',
  },
];

const problems = [];
const coverage = [];
const notes = [];

// ── the shared reduction must actually reduce ────────────────────────────────
// text-reductions.mjs returns an UNKNOWN EXTENSION UNCHANGED, SILENTLY — its own
// header records that trap costing a scanner its whole subject once already.
// `.jsonc` is exactly such an extension unless the map carries it, and a config
// whose comments were never stripped would fail to parse in a way that reads as
// "malformed config" rather than "the reducer stopped reducing". One assertion,
// on a two-token input, and the ambiguity is gone.
for (const [ext, sample] of [['.jsonc', '{} // c'], ['.ts', 'x // c']]) {
  if (stripSourceComments(sample, ext) === sample) {
    coverage.push(
      `stripSourceComments() left a \`${ext}\` sample containing a comment completely unchanged. ` +
        'text-reductions.mjs returns an unknown extension VERBATIM and says nothing, so every scan ' +
        'below would be reading comments as code — the precise defect this guard exists to avoid.',
    );
  }
}

// ── LIMB 1 · every wrangler config in the tree, parsed ───────────────────────
const rel = (p) => String(p).replaceAll('\\', '/');
const seen = new Set();
for (const pattern of CONFIG_PATTERNS) {
  for await (const match of boundedGlob(pattern, { cwd: ROOT })) {
    const r = rel(match);
    if (r.split('/').some((seg) => EXCLUDED_SEGMENTS.has(seg))) continue;
    seen.add(r);
  }
}
const configs = [...seen].sort();

if (configs.length === 0) {
  coverage.push(
    `found ZERO wrangler configs under ${ROOT}. A Durable-Object scan over an empty set proves no ` +
      'alarm exists anywhere, which is how a guard reports a healthy portfolio while enforcing nothing.',
  );
}

// The DERIVED floor: whatever git tracks must be among what this scan opened.
// Not "at least N" — a number somebody eventually lowers — but a relationship
// between two independent observations of the same tree.
if (scanningRealRepo) {
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tracked =
    ls.status === 0
      ? ls.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /(?:^|\/)wrangler\.(?:jsonc|json|toml)$/.test(l))
          .sort()
      : [];
  if (tracked.length === 0) {
    coverage.push(
      '`git ls-files` reported no tracked wrangler config, so "did I open every config the repo ' +
        'tracks" cannot be answered. There is deliberately no hardcoded floor to fall back on.',
    );
  } else {
    const unseen = tracked.filter((t) => !configs.includes(t));
    if (unseen.length) {
      coverage.push(
        `git tracks ${tracked.length} wrangler config(s) and this scan opened ${configs.length}; it never ` +
          `saw: ${unseen.join(', ')}. Every unseen config takes its durable_objects block with it.`,
      );
    }
  }
}

if (!configs.includes(ANCHOR_CONFIG)) {
  coverage.push(
    `the scan never reached ${ANCHOR_CONFIG}, the one Worker every tree of this repository has. ` +
      'Without it this is not looking at this repo\'s Workers at all, and every "no alarm here" ' +
      'result below is about some other tree.',
  );
}

/** JSONC → object. Comments stripped by the SHARED reduction (asserted above to
 *  still reduce), then trailing commas dropped — wrangler accepts them and
 *  hard-failing on one would teach people to distrust this guard. */
function parseConfig(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  return JSON.parse(stripSourceComments(raw, '.jsonc').replace(/,(\s*[}\]])/g, '$1'));
}

const workerRoots = [];
let parsedConfigs = 0;
for (const c of configs) {
  const abs = join(ROOT, c);
  if (c.endsWith('.toml')) {
    problems.push(
      `${c} is a wrangler.toml. Nothing in this repo parses TOML structurally, and this guard will not ` +
        'grep one instead — a text scan of a config is the defect that matched a comment explaining why ' +
        'a binding was absent. Convert it to wrangler.jsonc (services/subly-api already did on its v3→v4 ' +
        'migration) so its durable_objects and migrations blocks can be read as structure.',
    );
    continue;
  }
  let cfg;
  try {
    cfg = parseConfig(abs);
  } catch (e) {
    coverage.push(
      `${c} is not parseable (${e.message}). The Durable-Object limbs never examined it, so its result ` +
        'is unknown, not clean.',
    );
    continue;
  }
  parsedConfigs++;
  workerRoots.push({ config: c, dir: dirname(c) === '.' ? '' : dirname(c), hasMain: typeof cfg?.main === 'string' });

  const bindings = cfg?.durable_objects?.bindings;
  if (Array.isArray(bindings) && bindings.length > 0) {
    problems.push(
      `${c} declares ${bindings.length} durable_objects binding(s) ` +
        `(${bindings.map((b) => JSON.stringify(b?.name ?? b?.class_name ?? b)).join(', ')}). ` +
        '[13]T-10 — a Durable Object can schedule itself with an alarm and no config anywhere records ' +
        'that it did. Scheduled work rides the ONE cron in services/platform over a due-time table.',
    );
  } else if (cfg?.durable_objects !== undefined && !Array.isArray(bindings)) {
    // A `durable_objects` key whose shape this guard does not recognise must be
    // loud. Reading an unexpected shape as "no bindings" is the silent-pass
    // direction, and it is the direction that hurts.
    coverage.push(
      `${c} declares a \`durable_objects\` key whose \`bindings\` is not an array ` +
        `(got ${JSON.stringify(cfg.durable_objects)}). This guard cannot say whether it binds a Durable ` +
        'Object, and "cannot say" is not "no".',
    );
  }

  const migrations = cfg?.migrations;
  if (Array.isArray(migrations)) {
    for (const m of migrations) {
      for (const key of ['new_classes', 'new_sqlite_classes', 'renamed_classes', 'transferred_classes']) {
        const v = m?.[key];
        if (Array.isArray(v) && v.length > 0) {
          problems.push(
            `${c} declares a top-level \`migrations\` entry with \`${key}\`: ${JSON.stringify(v)} ` +
              `(tag ${JSON.stringify(m?.tag ?? null)}). That is a DURABLE OBJECT class migration — not a ` +
              'D1 schema migration, which is `d1_databases[].migrations_dir` — so this Worker is ' +
              'declaring Durable Objects. [13]T-10 forbids the alarms they make reachable.',
          );
        }
      }
    }
  } else if (migrations !== undefined) {
    coverage.push(
      `${c} declares a top-level \`migrations\` key that is not an array (got ${typeof migrations}). ` +
        'Durable Object class migrations live there; an unrecognised shape is unread, not absent.',
    );
  }
}

// ── LIMB 2 · the source of every Worker whose config was parsed ──────────────
// Directories are walked LITERALLY with listDir, never turned back into glob
// patterns — see the header on the brick's Mustache path segments.
function walkSources(absDir) {
  const out = [];
  let entries;
  try {
    entries = listDir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(e.name)) continue;
      out.push(...walkSources(join(absDir, e.name)));
    } else if (SOURCE_EXT.some((x) => e.name.endsWith(x))) {
      out.push(join(absDir, e.name));
    }
  }
  return out;
}

let scannedSources = 0;
const perRoot = [];
for (const root of workerRoots) {
  const absDir = root.dir ? join(ROOT, root.dir) : ROOT;
  // A config at the repo ROOT would otherwise pull the entire tree into the
  // source walk. That is a real shape T-10's acceptance names, and it is
  // reported rather than either walked (minutes) or skipped (silently unread).
  if (!root.dir) {
    notes.push(
      `${root.config} sits at the repository root, so its "Worker directory" is the whole tree. Its ` +
        'CONFIG was parsed and checked in full; its sources were NOT walked, because a root-level walk ' +
        'is every file in the repo. Move the Worker into its own directory to get the source limb.',
    );
    perRoot.push({ config: root.config, files: 0, skipped: true });
    continue;
  }
  const files = walkSources(absDir);
  perRoot.push({ config: root.config, files: files.length, skipped: false });

  for (const abs of files) {
    scannedSources++;
    const r = rel(abs.slice(ROOT.length + 1));
    const ext = SOURCE_EXT.find((x) => abs.endsWith(x)) ?? '.ts';
    const raw = readFileSync(abs, 'utf8');
    // Comments first, then string literals. Both, and in that order: a comment
    // explaining why there is no alarm must not fail the build, and neither
    // must a log line or a test fixture that quotes the API name.
    const code = stripStringLiterals(stripSourceComments(raw, ext));
    for (const rule of [...ALARM_RULES, ...DO_SURFACE_RULES]) {
      if (!rule.re.test(code)) continue;
      const lineNo = code.split('\n').findIndex((l) => rule.re.test(l)) + 1;
      problems.push(
        `${r}${lineNo > 0 ? `:${lineNo}` : ''} ${rule.what}. ${rule.why} [13]T-10 — server-assisted ` +
          'scheduling is the ONE shared cron in services/platform, never a per-app cron and never a ' +
          'Durable Object Alarm.',
      );
    }
  }
}

// COVERAGE, DERIVED: every Worker that declares an entrypoint has source, so
// every such config must have yielded at least one source file. A root that
// produced none is either a real defect or this walk's extension list having
// drifted, and both must be loud.
for (const root of workerRoots) {
  const seenRoot = perRoot.find((p) => p.config === root.config);
  if (root.hasMain && seenRoot && !seenRoot.skipped && seenRoot.files === 0) {
    coverage.push(
      `${root.config} declares \`main\` — so it HAS source — but the source walk under ${root.dir}/ found ` +
        `no ${SOURCE_EXT.join('/')} file. The alarm limb did not read this Worker's code at all.`,
    );
  }
}
if (workerRoots.length > 0 && scannedSources === 0) {
  coverage.push(
    `parsed ${workerRoots.length} wrangler config(s) and scanned ZERO source files. The config limb ` +
      'alone cannot see an alarm: `setAlarm` needs nothing declared in any config.',
  );
}

// ── report ───────────────────────────────────────────────────────────────────
if (coverage.length) {
  console.error(`✗ COVERAGE LOST — the Durable-Object-alarm scan cannot prove what it looked at (${coverage.length}):`);
  for (const c of coverage) console.error(`    ${c}`);
  console.error('');
  console.error('  A scan over nothing prints "ok". See the header of tooling/ci/assert-no-do-alarms.mjs.');
  process.exit(1);
}

if (problems.length) {
  console.error(`✗ Durable Object alarms — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 13]T-10 — "never a per-app cron AND never Durable Object Alarms". The cron half');
  console.error('  is enforced by assert-clone-contract.mjs; this is the other half. A DO alarm is the exact');
  console.error('  substitute for a blocked cron, which is why both halves have to hold at once.');
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  no Durable Object alarms — ${parsedConfigs} wrangler config(s) parsed ` +
    `(${configs.join(', ')}); ${scannedSources} Worker source file(s) scanned across ` +
    `${perRoot.filter((p) => !p.skipped).length} Worker root(s) ` +
    `[${perRoot.map((p) => `${p.config}=${p.skipped ? 'config-only' : p.files}`).join(', ')}]`,
);
