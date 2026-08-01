#!/usr/bin/env node
// [pipeline C-12] ONE inherited convention set reaches every app.
//
// This is the only place in the factory where a single edit reaches 50 apps, so
// it is also the only place where a silent break costs 50 apps. Before this
// landed the score was 0 OF 10: every `analysis_options.yaml` in the tree
// included `flutter_lints` or `lints` directly, and `nikatru_lints` — a package
// whose entire purpose is to be inherited — was inherited by nobody. Its only
// mention of its own include sat INSIDE A COMMENT, in its own file.
//
// The brick was the sharp end: it shipped one line, `include: flutter_lints`,
// while apps/subly carried strict-casts, prefer_final_locals and avoid_print. So
// every app the factory stamped was born with LESS checking than the single app
// that already existed — the opposite of what a chassis is for.
//
// ── SEVERITY, NOT PRESENCE (the C-12 lock amendment) ─────────────────────────
// The obvious criterion is "every file includes the shared set". That is
// necessary and NOT sufficient, and the difference was settled by a live spike
// on a real stamped app rather than by reading docs (2026-07-28):
//
//   include declared, no dev_dependency → include_file_not_found WARNING,
//                                         `flutter analyze` EXIT 1 (fails loud)
//   include resolving, default severity → rules fire as INFO, EXIT 0
//                                         ← THE BUILD PASSES. Inheritance
//                                           "working" and enforcing nothing.
//   severity raised in the shared file  → same rules fire as ERROR, EXIT 1
//                                         in the stamped app
//
// The middle row is the trap. The app_brick lane runs `flutter analyze
// --no-fatal-infos`, so a convention inherited at default severity is a
// convention that prints and ships. This guard therefore checks BOTH: that the
// set is inherited, and that it still escalates at least one banned pattern to
// `error`. Without the second check the first is decorative.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SHARED = 'packages/analysis/lib/analysis_options.yaml';
const INCLUDE = 'package:nikatru_lints/analysis_options.yaml';
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

// The shared set itself, and the package's own self-apply, are the two files
// that legitimately do NOT carry the package include: one IS the set, the other
// reaches it by relative path (which resolves with no pub get — deliberate, so
// the lint package can analyze itself before the workspace resolves).
const EXEMPT = new Set([SHARED, 'packages/analysis/analysis_options.yaml']);

let files = [];
try {
  files = execSync('git ls-files "**/analysis_options.yaml" "analysis_options.yaml"', {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'));
} catch {
  problems.push('COVERAGE LOST — could not list analysis_options.yaml files via git, so this guard checked nothing at all.');
}

// A floor, not a `> 0`: the tree has held 10 since the packages settled, and a
// scan that quietly finds three would read exactly like a clean pass.
const MIN_FILES = 10;
if (files.length < MIN_FILES) {
  problems.push(`COVERAGE LOST — found only ${files.length} analysis_options.yaml file(s), expected >= ${MIN_FILES}. Either convention files were deleted, or this scan has stopped seeing them and the packages it can no longer see are inheriting nothing.`);
} else {
  ok(`${files.length} analysis_options.yaml file(s) found`);
}

if (!existsSync(join(ROOT, SHARED))) {
  problems.push(`${SHARED} is MISSING — the shared convention set every other file inherits does not exist.`);
}

/**
 * Every value of a file's top-level `include:` directive, read as YAML
 * STRUCTURE. Three shapes are accepted because the analyzer accepts three: a
 * scalar, a flow sequence (`[a, b]`) and a block sequence.
 *
 * 🔴 STRUCTURE, NOT SUBSTRING (2026-08-01 full-corpus triage). This check used
 * to be `code.includes(INCLUDE)` over the whole file with only FULL-LINE
 * comments stripped. So a file whose real directive read
 *
 *     include: flutter_lints/flutter.yaml  # was package:nikatru_lints/analysis_options.yaml
 *
 * scored as compliant and the guard printed `ok 9 file(s) inherit the shared
 * set` — mutation-proven against the BRICK, the one file whose config reaches
 * every app the factory will ever stamp. A trailing comment is prose. The
 * include is a key with a value, and only the value can be inherited from.
 *
 * This is the same lesson the file's own header records — the previous version
 * was itself written to defeat a comment that mentioned the include — applied
 * this time to WHERE the match is allowed to happen, not only to what is
 * stripped first.
 */
function includeValues(src) {
  const lines = src.split('\n');
  const clean = (s) => s.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^include:\s*(.*)$/);
    if (!m) continue; // a `#` comment can never match a column-0 key
    const head = clean(m[1]);
    if (head.startsWith('[')) {
      return head.replace(/^\[/, '').replace(/\]$/, '').split(',').map(clean).filter(Boolean);
    }
    if (head) return [head];
    const items = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '' || /^\s*#/.test(lines[j])) continue;
      const item = lines[j].match(/^\s+-\s+(.*)$/);
      if (!item) break;
      items.push(clean(item[1]));
    }
    return items;
  }
  return [];
}

// ── 1 · every file inherits the shared set ───────────────────────────────────
let inheriting = 0;
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  let src = '';
  try { src = readFileSync(join(ROOT, f), 'utf8'); } catch {
    problems.push(`${f} could not be read.`);
    continue;
  }
  // The directive is PARSED, not grepped. `packages/analysis`'s own file
  // mentioned this exact include inside a comment while using none of it, and a
  // trailing `# was package:nikatru_lints/…` note fooled the substring version
  // in exactly the same way — neither can survive reading the value itself.
  const included = includeValues(src);
  if (!included.includes(INCLUDE)) {
    const found = included.length
      ? `its \`include:\` names ${included.map((x) => `\`${x}\``).join(', ')} instead`
      : 'it declares no `include:` directive at all';
    problems.push(
      `${f} does not include \`${INCLUDE}\` — ${found}. A rule change in the shared set will not reach it, which is the whole point of C-12 — and the brick shipping its own weaker config is how every stamped app was born with less checking than apps/subly.`,
    );
    continue;
  }
  inheriting++;

  // ── 2 · the include must actually RESOLVE ─────────────────────────────────
  // It needs nikatru_lints as a dependency. This does not fail silently — the
  // analyzer warns and exits 1 — but catching it here names the cause instead
  // of leaving somebody to decode `include_file_not_found`.
  const pubspec = join(ROOT, f.replace(/analysis_options\.yaml$/, 'pubspec.yaml'));
  if (existsSync(pubspec)) {
    const p = readFileSync(pubspec, 'utf8').replace(/^\s*#.*$/gm, '');
    if (!/^\s+nikatru_lints\s*:/m.test(p)) {
      problems.push(`${f} includes the shared set, but its pubspec does not declare \`nikatru_lints\` — the include cannot resolve, so every rule in it silently does not apply to this package.`);
    }
  }
}
if (inheriting > 0) ok(`${inheriting} file(s) inherit the shared set, each with the dependency to resolve it`);

// ── 3 · SEVERITY. Inheritance without escalation enforces nothing. ───────────
if (existsSync(join(ROOT, SHARED))) {
  const shared = readFileSync(join(ROOT, SHARED), 'utf8');
  const code = shared.replace(/^\s*#.*$/gm, '');
  const errorsBlock = code.match(/^\s{2}errors:\s*$([\s\S]*?)(?=^\s{0,2}\S|\Z)/m);
  const escalated = errorsBlock
    ? [...errorsBlock[1].matchAll(/^\s+([a-z_]+)\s*:\s*error\s*$/gm)].map((m) => m[1])
    : [];
  if (escalated.length === 0) {
    problems.push(
      `${SHARED} declares no rule at \`error\` severity. Lints default to INFO and the brick lane runs \`flutter analyze --no-fatal-infos\`, so every inherited rule would print and the build would still pass — measured on a real stamp 2026-07-28. Inheriting a ruleset that cannot fail the build is presence without enforcement, which is the state C-12 was amended to rule out.`,
    );
  } else {
    ok(`${escalated.length} rule(s) escalated to error, so a banned pattern fails the build: ${escalated.join(', ')}`);
  }

  // The set must still BE a ruleset. An `errors:` block over an empty linter is
  // an escalation of nothing.
  if (!/^\s{4}[a-z_]+\s*:\s*true\s*$/m.test(code)) {
    problems.push(`${SHARED} declares no enabled linter rules — the shared set has been emptied, and every package now inherits an empty convention.`);
  }
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-lint-inheritance: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-lint-inheritance: ok — one convention set, inherited by ${inheriting} file(s), and it can fail a build`);
}
