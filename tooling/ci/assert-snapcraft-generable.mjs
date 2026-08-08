#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-snapcraft-generable.mjs — every Linux store channel this factory
// declares can produce a COMPLETE snapcraft recipe, from the tree, today.
//
// [pipeline D-10] / [10]D-5. `tooling/release/generate-snapcraft.mjs` derives
// the recipe instead of committing one, which removes the stale-copy problem and
// introduces a new one: A GENERATOR THAT HAS STOPPED READING THE TREE STILL
// WRITES A FILE. It writes a shorter one, or one carrying its own idea of the
// values, and nothing downstream can tell — there is no committed recipe to diff
// against, and `snapcraft` is not installed on any machine this repository runs
// on, so nothing ever builds the result and finds out.
//
// So this guard RUNS the generator, for real, once per (Linux store row × app),
// against a fixture bundle, and then reads the emitted YAML back and asks
// whether every value in it still comes from where it claims to come from.
//
// ── WHY A FIXTURE BUNDLE AND NOT A REAL ONE ─────────────────────────────────
// A real bundle is 60-odd MB of compiled output from `flutter build linux`, and
// it does not exist on the owner's Windows box, on a PR runner, or anywhere
// `ci-gate` can reach. The generator's contract with the bundle is exactly three
// facts — it is a directory, it holds a file named BINARY_NAME, and it may hold
// the installed .desktop entry — so a fixture that satisfies those exercises
// every path the real one does. What a fixture CANNOT prove is that the snap
// builds, and this guard does not claim it: `snapcraft` is not run here and is
// not installed here. It is a check on the CONFIGURATION, and it says so.
//
// ── THE FIVE THINGS IT ASSERTS ──────────────────────────────────────────────
//   1. IT PARSES. A recipe that is not YAML is a recipe snapcraft rejects, and
//      an emitter is exactly the kind of thing that produces a file which looks
//      right and is not.
//   2. THE NAME MATCHES THE STORE TREE. `snap-name.txt` holds the GLOBAL Snap
//      Store namespace OWNER_QUEUE A-6 claims; a recipe naming anything else
//      would publish under a name nobody reviewed.
//   3. NO ABSOLUTE HOST PATHS. A recipe carrying `/home/runner/...` or a Windows
//      drive letter builds on one machine and nowhere else — and a Windows path
//      is not something snapcraft can parse at all.
//   4. `stage-packages` IS NON-EMPTY AND EQUALS THE WORKFLOW'S apt LIST. This is
//      the limb the generator's whole parser exists for. A retyped list, a list
//      truncated at the first shell line continuation, and a workflow that grew
//      a package the recipe did not are all one failure: the snap builds and the
//      app does not start.
//   5. `confinement: strict`. `classic` needs manual store review and an argued
//      case; a generator that quietly emitted it would turn a submission into a
//      negotiation.
// Plus the values that make the recipe THIS app's — title, summary, description,
// licence, base, grade, plugs, command and the desktop entry — each compared to
// the artifact it is derived from rather than to a copy kept here.
//
// ⚠️ EVERY EXPECTATION IS IMPORTED, NEVER RETYPED. `DESKTOP_PLUGS`, `GRADE`,
// `CONFINEMENT` and `BASE_FOR_RUNNER` come from the generator; the listing values
// come from the store tree; the apt list comes from the workflow through the
// generator's own exported parser. A guard holding its own copy of a constant
// agrees with a generator that has drifted, which is a check that cannot fail.
//
// Usage:
//   node tooling/ci/assert-snapcraft-generable.mjs [repoRoot]
//   node tooling/ci/assert-snapcraft-generable.mjs [repoRoot] --emitted <file> --app <id>
//
// `--emitted` validates a recipe that ALREADY EXISTS instead of generating one.
// It is how a release lane checks the file it is about to hand to snapcraft, and
// it is how this guard's own equality limb is negative-tested: generate a recipe,
// change the workflow's apt list, re-validate, and the equality must redden.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import {
  BASE_FOR_RUNNER,
  BUILD_WORKFLOW,
  CONFINEMENT,
  DESKTOP_PLUGS,
  GRADE,
  RECIPE_PATH,
  REGISTER,
  SnapcraftUngenerable,
  baseForRunner,
  linuxStoreRow,
  readLinuxBuildLane,
} from '../release/generate-snapcraft.mjs';
import { readLinuxIdentity, LinuxBrandUnavailable } from '../store/render-linux-icons.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Resolved from THIS FILE, never from the repo root under test. A fixture root
 *  points the READS somewhere else; the generator always lives beside the
 *  release scripts. Resolving it from the root would mean every fixture had to
 *  contain a copy of tooling/ to be testable — the trap submit-snap.mjs already
 *  recorded and solved the same way. */
const GENERATOR = join(HERE, '..', 'release', 'generate-snapcraft.mjs');

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
/** The repo root, as `[repoRoot]` positionally the way every other guard here
 *  takes it. A value that FOLLOWS a `--flag` is that flag's argument and is not
 *  a candidate, which is what keeps `--app subly` from being read as a root. */
let positional = null;
for (let k = 0; k < argv.length; k++) {
  if (argv[k].startsWith('--')) {
    k++; // skip its value
    continue;
  }
  positional = argv[k];
  break;
}
const ROOT = resolve(opt('repo-root') ?? positional ?? join(HERE, '..', '..'));
const EMITTED = opt('emitted');
const ONLY_APP = opt('app');
if (EMITTED && !ONLY_APP) {
  console.error('✗ --emitted requires --app: the listing an existing recipe is checked against has to be named,');
  console.error('  because nothing about the expectations may come from the file being checked.');
  process.exit(1);
}

/** The version this guard hands the generator. It is a FIXTURE, and it is shaped
 *  like a real release line so the emitted `version` is checked against a value
 *  that could plausibly ship rather than against a sentinel that would mask a
 *  quoting bug. */
const FIXTURE_VERSION = '0.0.0.1';

const problems = [];
const notes = [];

/** The scan itself is broken, so nothing below it means anything. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ─────────────────────────────────────────────────────────────────────────────
// A MINIMAL YAML READER — for the subset this generator emits, and FAIL-CLOSED.
//
// 🔴 IT IS DELIBERATELY NOT A GENERAL YAML PARSER, and it is not one for the
// reason this repository keeps relearning: a lenient reader is a reader that
// accepts a file the real consumer will reject, and then reports it as valid.
// Nothing it cannot classify is skipped — every unrecognised line THROWS. There
// is no YAML dependency in this repository (every workflow is read by
// workflow-scan.mjs's own line parse), and adding one to check a file we emit
// ourselves would be a dependency for a problem we create.
//
// What it handles: block mappings, block sequences, literal block scalars (`|`),
// double-quoted scalars (JSON's string grammar is a subset of YAML's, so those
// are exact), and a restricted plain scalar. The plain-scalar rule is itself a
// check — it rejects a leading `/` and anything containing a backslash or a
// colon, so an absolute host path cannot parse as a value at all.
// ─────────────────────────────────────────────────────────────────────────────
export class YamlUnreadable extends Error {}

const PLAIN_SCALAR = /^[A-Za-z0-9.][A-Za-z0-9._/+-]*$/;

function readScalar(raw, lineNo) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch (e) {
      throw new YamlUnreadable(`line ${lineNo}: unreadable double-quoted scalar ${s} — ${e.message}`);
    }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (!PLAIN_SCALAR.test(s)) {
    throw new YamlUnreadable(
      `line ${lineNo}: ${JSON.stringify(s)} is not a plain scalar this reader accepts. ` +
        'A value carrying a colon, a backslash or a leading slash is either an absolute host path or ' +
        'something this generator does not emit; either way it is refused rather than guessed at.',
    );
  }
  return s;
}

export function parseEmittedYaml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const indentOf = (l) => l.match(/^ */)[0].length;
  const skip = () => {
    while (i < lines.length && (lines[i].trim() === '' || /^\s*#/.test(lines[i]))) i++;
  };

  // A literal block keeps blank lines and `#` lines — they are CONTENT here, not
  // structure, so `skip()` must not be used inside it.
  const literal = (parentIndent) => {
    const buf = [];
    let contentIndent = null;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') {
        buf.push('');
        i++;
        continue;
      }
      const ind = indentOf(l);
      if (ind <= parentIndent) break;
      if (contentIndent === null) contentIndent = ind;
      if (ind < contentIndent) break;
      buf.push(l.slice(contentIndent));
      i++;
    }
    while (buf.length && buf[buf.length - 1] === '') buf.pop();
    return buf.join('\n');
  };

  const block = (minIndent) => {
    skip();
    if (i >= lines.length) return null;
    const ind = indentOf(lines[i]);
    if (ind < minIndent) return null;

    if (/^\s*-\s+\S/.test(lines[i])) {
      const out = [];
      for (;;) {
        skip();
        if (i >= lines.length || indentOf(lines[i]) !== ind) break;
        const m = lines[i].match(/^\s*-\s+(.*)$/);
        if (!m) break;
        out.push(readScalar(m[1], i + 1));
        i++;
      }
      return out;
    }

    const out = {};
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind) break;
      const m = lines[i].match(/^\s*([A-Za-z0-9_.-]+):(?:[ \t]+(.*?))?[ \t]*$/);
      if (!m) {
        throw new YamlUnreadable(`line ${i + 1}: not a mapping key — ${JSON.stringify(lines[i])}`);
      }
      const key = m[1];
      const rest = (m[2] ?? '').trim();
      i++;
      if (/^\|[+-]?$/.test(rest)) out[key] = literal(ind);
      else if (rest === '') out[key] = block(ind + 1);
      else out[key] = readScalar(rest, i);
    }
    return out;
  };

  const doc = block(0);
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new YamlUnreadable('the document is not a top-level mapping.');
  }
  if (i < lines.length) {
    skip();
    if (i < lines.length) throw new YamlUnreadable(`line ${i + 1}: trailing content this reader cannot place.`);
  }
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER TEXT.
//
// A generated file that reads like a TEMPLATE is one somebody fills in by hand,
// and a hand-filled generated file is the second copy the generator exists to
// prevent. The angle-bracket pattern is the one that matters most: it is what an
// emitter produces when an interpolation silently resolved to nothing.
// ─────────────────────────────────────────────────────────────────────────────
export const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bTBD\b/,
  /\bXXX\b/,
  /\bCHANGEME\b/i,
  /\bREPLACE[_ -]?ME\b/i,
  /PLACEHOLDER/i,
  /<[A-Za-z][A-Za-z0-9 _-]*>/,
  /\$\{\{/,
  /\bundefined\b/,
];

/** Absolute host paths, with URLs excluded — a `https://` in a description is a
 *  link, not a path, and rejecting it would fire on correct input. */
export function absoluteHostPaths(text) {
  const hits = new Set();
  for (const token of text.split(/[\s"'`]+/)) {
    if (token === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue;
    if (/^[A-Za-z]:[\\/]/.test(token) || /\\\\/.test(token)) hits.add(token);
    else if (/^\/(?!\/)\S/.test(token)) hits.add(token);
  }
  return [...hits];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE VALIDATION. Exported so a caller can drive it with expectations it built
// itself — which is what makes the equality limb negative-testable without a
// backdoor that supplies the answer.
// ─────────────────────────────────────────────────────────────────────────────
export function validateEmitted({ yaml, expected, label }) {
  const found = [];
  const bad = (m) => found.push(`${label} — ${m}`);

  let doc;
  try {
    doc = parseEmittedYaml(yaml);
  } catch (e) {
    if (!(e instanceof YamlUnreadable)) throw e;
    bad(`the emitted recipe does not parse: ${e.message}`);
    return found;
  }

  for (const re of PLACEHOLDER_PATTERNS) {
    const m = yaml.match(re);
    if (m) {
      bad(
        `the emitted recipe carries placeholder text ${JSON.stringify(m[0])}. A generated file that reads ` +
          'like a template is one somebody fills in by hand, and an angle-bracket slot is what an emitter ' +
          'produces when an interpolation resolved to nothing.',
      );
    }
  }

  const abs = absoluteHostPaths(yaml);
  if (abs.length) {
    bad(
      `the emitted recipe carries ${abs.length} absolute host path(s): ${abs.slice(0, 4).join(', ')}. ` +
        'A recipe with a machine-specific path builds on one machine and nowhere else, and a Windows ' +
        'drive path is not something snapcraft can parse at all.',
    );
  }

  const eq = (key, actual, want) => {
    if (actual !== want) {
      bad(`\`${key}\` is ${JSON.stringify(actual)}; the tree says ${JSON.stringify(want)}.`);
    }
  };

  eq('name', doc.name, expected.name);
  eq('title', doc.title, expected.title);
  eq('summary', doc.summary, expected.summary);
  eq('description', doc.description, expected.description);
  eq('license', doc.license, expected.license);
  eq('base', doc.base, expected.base);
  eq('grade', doc.grade, expected.grade);
  eq('confinement', doc.confinement, expected.confinement);

  if (typeof doc.version !== 'string' || doc.version.trim() === '') {
    bad('`version` is absent or empty. The Snap Store orders revisions by it; an empty one is not a release.');
  } else if (expected.version != null) {
    eq('version', doc.version, expected.version);
  }

  // ── stage-packages: non-empty, and EQUAL to the workflow's list ────────────
  const part = doc.parts?.[expected.name];
  if (!part) {
    bad(`\`parts\` declares no part named "${expected.name}". Nothing then stages the bundle.`);
  } else {
    if (part.plugin !== 'dump') {
      bad(`the part's plugin is ${JSON.stringify(part.plugin)}; [ADR 015] §3 ingests the prebuilt CI artifact with \`dump\`.`);
    }
    if (typeof part.source !== 'string' || part.source.trim() === '') {
      bad('the part declares no `source`, so `dump` would ingest nothing and the snap would be empty.');
    }
    const staged = Array.isArray(part['stage-packages']) ? part['stage-packages'] : null;
    if (staged === null) {
      bad('the part declares no `stage-packages` list at all.');
    } else if (staged.length === 0) {
      bad('`stage-packages` is EMPTY. A snap with no staged dependencies builds and then fails to start.');
    } else {
      const want = new Set(expected.stagePackages);
      const got = new Set(staged);
      const missing = [...want].filter((p) => !got.has(p));
      const extra = [...got].filter((p) => !want.has(p));
      if (staged.length !== got.size) {
        bad(`\`stage-packages\` repeats a package (${staged.length} entries, ${got.size} distinct).`);
      }
      if (missing.length || extra.length) {
        bad(
          `\`stage-packages\` and ${BUILD_WORKFLOW}'s apt list disagree — ` +
            `${missing.length} in the workflow and not the recipe (${missing.join(', ') || 'none'}), ` +
            `${extra.length} in the recipe and not the workflow (${extra.join(', ') || 'none'}). ` +
            'They are one list by construction; a difference means the recipe stopped deriving it, or ' +
            'the workflow grew a package because a build broke and the snap did not follow.',
        );
      }
    }
  }

  // ── the app entry ─────────────────────────────────────────────────────────
  const appEntry = doc.apps?.[expected.name];
  if (!appEntry) {
    bad(`\`apps\` declares no entry named "${expected.name}", so the snap installs with nothing to run.`);
  } else {
    eq(`apps.${expected.name}.command`, appEntry.command, expected.command);
    eq(`apps.${expected.name}.desktop`, appEntry.desktop, expected.desktopRel);
    const plugs = Array.isArray(appEntry.plugs) ? appEntry.plugs : [];
    const missing = expected.plugs.filter((p) => !plugs.includes(p));
    const extra = plugs.filter((p) => !expected.plugs.includes(p));
    if (missing.length || extra.length) {
      bad(
        `\`plugs\` is [${plugs.join(', ')}]; DESKTOP_PLUGS declares [${expected.plugs.join(', ')}]. ` +
          'Under strict confinement an interface the app does not declare is a capability it does not have.',
      );
    }
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE TREE SAYS THE ANSWER SHOULD BE
// ─────────────────────────────────────────────────────────────────────────────
function readListing(root, dirRel, file) {
  const path = join(root, dirRel, file);
  if (!existsSync(path)) return null;
  const v = readFileSync(path, 'utf8').trim();
  return v === '' ? null : v;
}

function expectationsFor({ root, row, app, lane, version }) {
  const dirRel = row.storeMetadataDir.replace('{app}', app);
  const fields = {
    name: 'snap-name.txt',
    title: 'title.txt',
    summary: 'short-description.txt',
    description: 'long-description.txt',
    license: 'license.txt',
  };
  const out = { stagePackages: lane.packages, plugs: [...DESKTOP_PLUGS], grade: GRADE, confinement: CONFINEMENT, version };
  const missing = [];
  for (const [key, file] of Object.entries(fields)) {
    const v = readListing(root, dirRel, file);
    if (v === null) missing.push(`${dirRel}/${file}`);
    out[key] = v;
  }
  out.base = baseForRunner(lane.runner);
  let identity = null;
  try {
    identity = readLinuxIdentity(join(root, 'apps', app));
  } catch (e) {
    if (!(e instanceof LinuxBrandUnavailable)) throw e;
    missing.push(`apps/${app}/linux/CMakeLists.txt (${e.lines[0]})`);
  }
  out.command = identity?.binaryName ?? null;
  out.desktopRel = identity ? `share/applications/${identity.applicationId}.desktop` : null;
  return { expected: out, missing, dirRel };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCAN
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  coverageLost([`the repo root ${ROOT} is not a directory — there is nothing to scan.`]);
}

let row;
let lane;
try {
  row = linuxStoreRow(ROOT);
  lane = readLinuxBuildLane(ROOT);
} catch (e) {
  if (!(e instanceof SnapcraftUngenerable)) throw e;
  // The generator's own refusals already carry this guard's marker phrase when
  // they are structural, so they are re-raised as COVERAGE LOST rather than as a
  // problem: with no register row or no apt list there is no expectation left to
  // compare anything against, and every check below would range over nothing.
  coverageLost([
    `the Linux store row or the ${BUILD_WORKFLOW} apt list could not be read, so every check below would compare against nothing.`,
    ...e.lines,
  ]);
}

// ── the app set: every app carrying this row's metadata tree ────────────────
const appsDir = join(ROOT, 'apps');
if (!existsSync(appsDir)) {
  coverageLost([
    `${ROOT}/apps does not exist, so this guard has no app to generate a recipe for.`,
    'A pass produced by iterating an empty set is the failure shape every guard in this directory exists',
    'against.',
  ]);
}
const candidates = listDir(appsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const withTree = candidates.filter((a) => existsSync(join(ROOT, row.storeMetadataDir.replace('{app}', a))));
// `--emitted` is about ONE recipe, so it narrows the set; the default scan never
// does, which is what makes "every app that carries the tree" the subject.
const apps = ONLY_APP ? withTree.filter((a) => a === ONLY_APP) : withTree;
if (withTree.length === 0) {
  coverageLost([
    `not one of ${candidates.length} app(s) under apps/ carries a "${row.id}" store tree (${row.storeMetadataDir}).`,
    `${REGISTER} declares the channel, so at least one app must carry its listing — assert-store-metadata.mjs`,
    'holds exactly that relationship. With none, this guard would validate zero recipes and print ok.',
  ]);
}
if (apps.length === 0) {
  coverageLost([
    `--app ${ONLY_APP} names no app carrying a "${row.id}" store tree (have: ${withTree.join(', ')}).`,
    'The narrowing selected nothing, so the run would validate zero recipes while looking like a scan.',
  ]);
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'nikatru-snapgen-'));
/** ATTEMPTED vs VALIDATED, and the distinction is not pedantry — it was a real
 *  defect in this file's first version. The REQUIRED_COVERAGE assertion below
 *  ran on `validated`, so an app whose recipe FAILED every check reported
 *  "ZERO recipes were validated" and exited before the problem list printed:
 *  a specific, correct complaint about a renamed `snap-name.txt` was rendered
 *  as a coverage loss, which is the wrong diagnosis AND the wrong fix. The
 *  coverage question is "did this guard reach every app", which is `attempted`;
 *  whether each one then passed is what `problems` is for. */
let attempted = 0;
let validated = 0;
try {
  for (const app of apps) {
    attempted++;
    const label = `${row.id} · ${app}`;
    const { expected, missing, dirRel } = expectationsFor({ root: ROOT, row, app, lane, version: EMITTED ? null : FIXTURE_VERSION });

    if (missing.length) {
      problems.push(
        `${label} — the tree cannot say what the recipe should contain: ${missing.join(', ')} is missing or empty. ` +
          'Every emitted value is derived from one of those files, so a gap here is a recipe that cannot be ' +
          'checked rather than one that is wrong.',
      );
      continue;
    }

    let yaml;
    if (EMITTED) {
      // Validate a recipe that already exists. `--app` says which listing it is
      // supposed to have come from; nothing about the expectations comes from
      // the file being checked.
      if (!existsSync(EMITTED)) {
        problems.push(`${label} — --emitted ${EMITTED} does not exist.`);
        continue;
      }
      yaml = readFileSync(EMITTED, 'utf8');
    } else {
      // ── the fixture bundle ────────────────────────────────────────────────
      const bundle = join(tmpRoot, app, 'bundle');
      const out = join(tmpRoot, app, 'out');
      mkdirSync(join(bundle, 'share', 'applications'), { recursive: true });
      // The three facts the generator's contract with a bundle rests on.
      writeFileSync(join(bundle, expected.command), 'fixture stand-in for the built binary\n');
      writeFileSync(join(bundle, expected.desktopRel), '[Desktop Entry]\nType=Application\n');

      const r = spawnSync(
        process.execPath,
        [GENERATOR, '--repo-root', ROOT, '--app', app, '--bundle', bundle, '--out', out, '--version', FIXTURE_VERSION],
        { encoding: 'utf8' },
      );
      const said = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
      if (r.status !== 0) {
        problems.push(
          `${label} — the generator REFUSED to produce a recipe from this tree (exit ${r.status}):\n` +
            said.split('\n').map((l) => `        ${l}`).join('\n'),
        );
        continue;
      }
      const recipe = join(out, RECIPE_PATH);
      if (!existsSync(recipe)) {
        problems.push(`${label} — the generator exited 0 and wrote no ${RECIPE_PATH}. Success with no artifact is the loudest kind of silence.`);
        continue;
      }
      yaml = readFileSync(recipe, 'utf8');
      if (yaml.includes('\r')) {
        problems.push(`${label} — the emitted recipe contains CR bytes. The repo stores LF and the consumer is a Linux packaging tool.`);
      }
    }

    problems.push(...validateEmitted({ yaml, expected, label }));
    validated++;
    if (!EMITTED) {
      notes.push(`${label} — recipe generated from ${dirRel}, base ${expected.base}, ${expected.stagePackages.length} stage-package(s)`);
    }
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// REQUIRED_COVERAGE. A run that reached no app has answered no question, and
// "no problems" over an empty set is the exact shape this directory exists to
// refuse. It is asked of ATTEMPTED, before the problem list, because a loop that
// never ran is a broken scan while a loop that ran and complained is this guard
// working — see the note on `attempted` above.
if (attempted === 0) {
  coverageLost([
    `${apps.length} app(s) carry a "${row.id}" store tree and the loop over them never ran.`,
    'Every check above ranged over an empty set, which is indistinguishable from a clean run except that',
    'it proves nothing.',
  ]);
}

if (problems.length) {
  console.error(`✗ snapcraft generable — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  The recipe is DERIVED rather than committed, so there is no file to diff against and');
  console.error('  `snapcraft` is installed nowhere this repository runs. This guard is the only thing that');
  console.error('  notices a generator which has stopped reading the tree and is still writing a file.');
  process.exit(1);
}

// The other half of the same accounting: no problems AND nothing validated can
// only mean a limb stopped running, because every path out of the loop either
// records a problem or validates.
if (validated === 0) {
  coverageLost([
    `${attempted} app(s) were reached, none produced a validated recipe, and no problem was recorded.`,
    'Every path out of the loop either records a problem or validates one recipe, so this state means a',
    'limb stopped running rather than that the tree is clean.',
  ]);
}

for (const n of notes) console.log(`    ${n}`);
console.log(
  `ok  snapcraft generable — ${validated} recipe(s) for ${apps.length} app(s) on ${row.id}: parse, ` +
    `name from the store tree, no host paths, strict confinement, and ${lane.packages.length} stage-package(s) ` +
    `equal to ${BUILD_WORKFLOW}:${lane.line}'s apt list (base ${BASE_FOR_RUNNER.get(lane.runner)} from ${lane.runner}). ` +
    '⚠️ CONFIGURATION ONLY — `snapcraft` was not run and no .snap was built.',
);
