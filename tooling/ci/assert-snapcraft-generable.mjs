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
// base, grade, plugs and command — each compared to the artifact it is derived
// from rather than to a copy kept here.
//
// ── AND THE TWO THE FIRST REAL PACK ADDED (run 31294305898, 2026-08-09) ──────
// Both were invisible to everything above, and both stopped `snapcraft` dead.
// 🔴 THEY ARE THE ANSWER TO "WHAT ELSE IS ONLY TRUE UNTIL SOMETHING RUNS IT" —
// this guard graded nine values correctly against a recipe snapcraft would not
// accept, because every one of those checks compares the recipe to THIS TREE and
// none of them knew a single rule of the snap FORMAT.
//
//   8. THE LICENCE IS SPDX-VALID OR THE KEY IS ABSENT. `license: "proprietary"`
//      failed with `cannot validate license "proprietary": unknown license:
//      proprietary`. The rule is imported from the generator's `NON_SPDX_LICENCES`
//      — a listing value in that map must produce NO `license:` key at all, and a
//      value outside it must be emitted verbatim. Asserting it here against a
//      RETYPED list would agree with a generator that had drifted.
//   9. THE LAUNCHER RESOLVES INSIDE THE SNAP. `Icon 'com.nikatru.subly' … not
//      found in prime directory` — the bundle's entry names a freedesktop THEME
//      NAME, and snapcraft searches the prime directory rather than an icon theme
//      in it. So the recipe must carry no `apps.<name>.desktop`, and the project
//      must carry `snap/gui/<name>.desktop` whose `Icon` is exactly the installed
//      path `${SNAP}/meta/gui/<name>.png`, with that PNG beside it.
//
// ⚠️ EVERY EXPECTATION IS IMPORTED, NEVER RETYPED. `DESKTOP_PLUGS`, `GRADE`,
// `CONFINEMENT` and `BASE_FOR_RUNNER` come from the generator; the listing values
// come from the store tree; the apt list comes from the workflow through the
// generator's own exported parser. A guard holding its own copy of a constant
// agrees with a generator that has drifted, which is a check that cannot fail.
//
// ── AND TWO THINGS ONLY THE PACKING JOB CAN ASK ─────────────────────────────
// Both are `--emitted`-mode checks, because both are about a recipe that is one
// step away from being handed to a real `snapcraft`.
//
//   6. `--pack-runner <label>` — THE BASE MUST MATCH THE HOST THAT PACKS IT.
//      The recipe's `base` is derived from the runner the BUNDLE was compiled on
//      (build-platforms.yml's Linux job). The .snap is packed in a DIFFERENT
//      workflow, on a runner of its own, in `--destructive-mode` — which builds
//      on the host with no container between them. ✅ Sourced, fetched
//      2026-08-09, https://ubuntu.com/docs/snapcraft/stable/reference/
//      build-environment-options/ : "The build environment should match the snap
//      base. For example, a core26 snap should be built inside of an Ubuntu 26.04
//      LTS environment." Two workflows now name a runner label for one snap, so
//      moving either one alone links the app against libraries it did not build
//      with — and nothing else in the tree compares them.
//   7. THE `source:` MUST RESOLVE, FROM THE PROJECT DIRECTORY, TO THIS APP'S
//      BUNDLE. snapcraft resolves a part's local `source:` from the project
//      directory (the one it is run in), not from `snap/snapcraft.yaml`. The
//      generator computed it from the recipe file until 2026-08-09 — one `..` too
//      many — and every check here passed, because "is it relative" and "is it a
//      host path" are both satisfied by a relative path that points nowhere.
//
// Usage:
//   node tooling/ci/assert-snapcraft-generable.mjs [repoRoot]
//   node tooling/ci/assert-snapcraft-generable.mjs [repoRoot] --emitted <file> --app <id>
//     [--pack-runner ubuntu-24.04]
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
  GUI_DIR,
  NON_SPDX_LICENCES,
  RECIPE_PATH,
  REGISTER,
  SnapcraftUngenerable,
  baseForRunner,
  licenceForRecipe,
  linuxStoreRow,
  readLinuxBuildLane,
} from '../release/generate-snapcraft.mjs';
import { readLinuxIdentity, LinuxBrandUnavailable, HICOLOR_SIZES } from '../store/render-linux-icons.mjs';

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
const PACK_RUNNER = opt('pack-runner');
if (EMITTED && !ONLY_APP) {
  console.error('✗ --emitted requires --app: the listing an existing recipe is checked against has to be named,');
  console.error('  because nothing about the expectations may come from the file being checked.');
  process.exit(1);
}
if (PACK_RUNNER && !EMITTED) {
  console.error('✗ --pack-runner is only meaningful with --emitted: it asks whether the recipe about to be packed');
  console.error('  matches the host that will pack it, and a generated fixture recipe is packed by nobody.');
  process.exit(1);
}
// An unmapped label is refused rather than passed through, for the reason
// `baseForRunner` refuses one: a label with no recorded Ubuntu release cannot be
// compared to a base, and treating "cannot compare" as "matches" is how this
// check would report clean on the one input it exists for.
let packBase = null;
if (PACK_RUNNER) {
  try {
    packBase = baseForRunner(PACK_RUNNER);
  } catch (e) {
    if (!(e instanceof SnapcraftUngenerable)) throw e;
    console.error(`✗ --pack-runner ${PACK_RUNNER} has no snapcraft base recorded:`);
    for (const l of e.lines) console.error(`  ${l}`);
    process.exit(1);
  }
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
/**
 * Where a part's local `source:` actually lands, and whether that is this app's
 * bundle. Exported so the test can drive it with a tree it built itself.
 *
 * 🔴 THE FRAME IS THE PROJECT DIRECTORY, NOT THE RECIPE FILE, and getting it
 * wrong is invisible to every other limb here. `projectDir` is the directory
 * snapcraft is run in — `snap/snapcraft.yaml` is a fixed path inside it — and a
 * relative `source:` is resolved from there.
 * Source: https://forum.snapcraft.io/t/part-source-when-snapcraft-yaml-is-in-snap-dir/19361
 * (fetched 2026-08-09).
 */
export function sourceResolution({ projectDir, source, binaryName }) {
  const at = resolve(projectDir, source);
  if (!existsSync(at) || !statSync(at).isDirectory()) {
    return { ok: false, at, why: 'is not a directory' };
  }
  if (!existsSync(join(at, binaryName))) {
    return { ok: false, at, why: `is a directory but holds no file named "${binaryName}"` };
  }
  return { ok: true, at };
}

export function validateEmitted({ yaml, expected, label, packBase = null, projectDir = null }) {
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

  // ── limb 8 — the licence is SPDX-valid, or the key is absent ──────────────
  // 🔴 `undefined` AND `null` ARE DIFFERENT ANSWERS HERE. The minimal reader
  // returns `undefined` for a key that is not in the document and `null` for one
  // written as `license: null`, and only the first is what snapd sees as absent —
  // an explicit null is a value, and it is not an SPDX expression either.
  if (expected.license === null) {
    if (doc.license !== undefined) {
      bad(
        `\`license\` is present as ${JSON.stringify(doc.license)}, and ${expected.storeMetadataDir}/license.txt says ` +
          `${JSON.stringify(expected.listedLicence)} — a value snapd's SPDX parser REJECTS: ${expected.licenceOmittedBecause} ` +
          'The key has to be absent, not translated: `cannot validate license "proprietary": unknown license: proprietary` ' +
          'is where this ends otherwise, at pack time, after the whole Linux build.',
      );
    }
  } else if (doc.license === undefined) {
    bad(
      `\`license\` is ABSENT and ${expected.storeMetadataDir}/license.txt says ${JSON.stringify(expected.listedLicence)}, ` +
        'which is not one of the values this repository has proven unemittable (NON_SPDX_LICENCES in the generator). ' +
        'A licence the store could have been told is one it now assumes — silently, and as `Proprietary`.',
    );
  } else {
    eq('license', doc.license, expected.license);
  }

  eq('base', doc.base, expected.base);
  eq('grade', doc.grade, expected.grade);
  eq('confinement', doc.confinement, expected.confinement);

  // ── limb 6 — the base and the host that packs it ──────────────────────────
  // Compared against the base the RECIPE carries, not against `expected.base`:
  // the two agreeing is limb "base" above, and asking the same question twice of
  // the same value would be an assertion that cannot fail independently.
  if (packBase !== null && doc.base !== packBase) {
    bad(
      `\`base\` is ${JSON.stringify(doc.base)} and this recipe is about to be packed on a host whose base is ` +
        `${JSON.stringify(packBase)}. In \`--destructive-mode\` there is no container between the two: ` +
        'snapcraft\'s own guidance is that "the build environment should match the snap base". The base is ' +
        'derived from the runner the BUNDLE was compiled on and the packing job names a runner of its own, ' +
        'so moving either one alone links the app against libraries it did not build with — and this is the ' +
        'only place the two labels meet.',
    );
  }

  if (typeof doc.version !== 'string' || doc.version.trim() === '') {
    bad('`version` is absent or empty. The Snap Store orders revisions by it; an empty one is not a release.');
  } else if (expected.version != null) {
    eq('version', doc.version, expected.version);
  }

  // ── stage-packages: non-empty, and EQUAL to the workflow's list ────────────
  /** The bundle `source:` really resolves to, once limb 7 has agreed it does.
   *  Limb 9b reads the icon question out of it. */
  let bundleAt = null;
  const part = doc.parts?.[expected.name];
  if (!part) {
    bad(`\`parts\` declares no part named "${expected.name}". Nothing then stages the bundle.`);
  } else {
    if (part.plugin !== 'dump') {
      bad(`the part's plugin is ${JSON.stringify(part.plugin)}; [ADR 015] §3 ingests the prebuilt CI artifact with \`dump\`.`);
    }
    if (typeof part.source !== 'string' || part.source.trim() === '') {
      bad('the part declares no `source`, so `dump` would ingest nothing and the snap would be empty.');
    } else if (projectDir !== null && expected.command) {
      // ── limb 7 — the source RESOLVES, from the project directory ───────────
      const r = sourceResolution({ projectDir, source: part.source, binaryName: expected.command });
      if (!r.ok) {
        bad(
          `\`source: ${part.source}\` resolves from the snapcraft project directory to ${r.at}, which ${r.why}. ` +
            'snapcraft resolves a local `source:` from the project directory it is run in, NOT from ' +
            'snap/snapcraft.yaml — a path computed against the recipe file is off by exactly one `..` and ' +
            'satisfies "is it relative" and "is it a host path" while pointing at nothing.',
        );
      } else {
        // 🔴 WHETHER AN ICON IS EXPECTED IS READ FROM THE BUNDLE THE RECIPE POINTS
        // AT, not taken from the generator. That is what makes limb 9b an
        // independent reading: the generator decided to emit an `Icon=` line
        // because it found a primed icon, and this arrives at the same question
        // from the other end — the bundle snapcraft will actually dump.
        bundleAt = r.at;
      }
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
    // 🔴 limb 9a — `desktop:` MUST BE ABSENT, and it is the key that broke the pack.
    // It pointed snapcraft at the bundle's freedesktop entry; snapcraft then tried
    // to resolve that entry's BARE THEME NAME against the prime directory and
    // refused. The launcher moved to snap/gui, which snapcraft copies to meta/gui
    // verbatim, so re-adding this key does not "also" work — it reintroduces the
    // exact failure, after a full Linux build.
    if (appEntry.desktop !== undefined) {
      bad(
        `\`apps.${expected.name}.desktop\` is present as ${JSON.stringify(appEntry.desktop)}. ` +
          'A desktop file named here is VALIDATED against the prime directory, and the entry this repo primes ' +
          'carries a freedesktop theme name (`Icon=<application-id>`) that snapcraft cannot resolve there — ' +
          '`Icon \'…\' specified in desktop file … not found in prime directory`, which is where the first real ' +
          `pack stopped. The snap layer's launcher is ${GUI_DIR}/${expected.name}.desktop instead.`,
      );
    }
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

  // ── limb 9b — the launcher, on disk, beside the recipe ────────────────────
  // Skipped when the bundle could not be resolved: limb 7 has already said why,
  // and "is an icon expected" cannot be answered without the directory that holds
  // the answer. A skipped limb with a stated reason beats one that guesses.
  if (projectDir !== null && bundleAt !== null && expected.applicationId) {
    const expectIcon = HICOLOR_SIZES.some((s) =>
      existsSync(join(bundleAt, 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps', `${expected.applicationId}.png`)),
    );
    for (const line of guiPairProblems({ projectDir, snapName: expected.name, expectIcon })) bad(line);
  }

  return found;
}

/**
 * The snap's launcher pair under `<project>/snap/gui/`, graded. Exported so the
 * test can drive it against a directory it built itself.
 *
 * ✅ THE RULE, fetched 2026-08-09 from https://ubuntu.com/docs/snapcraft/stable/
 * how-to/crafting/configure-package-information/ : the files are named
 * `<snap-name>.desktop` and `<snap-name>.png`, snapcraft "copies all the contents
 * of the `snap/gui/` folder to `meta/gui`", and `Icon` must be "the absolute path
 * of the image file … the location of the icon after the snap is installed",
 * which in this arrangement is `${SNAP}/meta/gui/<snap-name>.png`.
 *
 * 🔴 THE ICON LINE AND THE ICON FILE ARE CHECKED AS ONE FACT, in both directions.
 * A path with no file is a launcher showing a broken image; a file with no path
 * is a payload nothing points at. The generator drops the line when the bundle
 * primed no icon, so `expectIcon` says which of the two shapes is correct here
 * rather than this function assuming one.
 */
export function guiPairProblems({ projectDir, snapName, expectIcon }) {
  const out = [];
  const desktopPath = join(projectDir, GUI_DIR, `${snapName}.desktop`);
  const iconPath = join(projectDir, GUI_DIR, `${snapName}.png`);
  const wantIcon = `\${SNAP}/meta/gui/${snapName}.png`;

  if (!existsSync(desktopPath)) {
    out.push(
      `${GUI_DIR}/${snapName}.desktop does not exist beside the recipe. snapcraft copies snap/gui/ to meta/gui, ` +
        'and it is the ONLY launcher this snap has since the recipe stopped naming one — without it the app ' +
        'installs and appears in no menu.',
    );
    return out;
  }
  const text = readFileSync(desktopPath, 'utf8');
  const exec = /^Exec=(.*)$/m.exec(text);
  if (!exec) {
    out.push(`${GUI_DIR}/${snapName}.desktop carries no \`Exec=\` line, so the launcher runs nothing.`);
  } else if (exec[1].trim() !== snapName) {
    out.push(
      `${GUI_DIR}/${snapName}.desktop says \`Exec=${exec[1].trim()}\`; inside a snap the command is the one snapd ` +
        `exposes, which for an app named after its snap is "${snapName}". A binary name off PATH is the freedesktop ` +
        'answer and is not reachable from a strict-confined launcher.',
    );
  }

  const icon = /^Icon=(.*)$/m.exec(text);
  if (expectIcon) {
    if (!icon) {
      out.push(
        `${GUI_DIR}/${snapName}.png exists and ${GUI_DIR}/${snapName}.desktop carries no \`Icon=\` line — an icon ` +
          'shipped into meta/gui that nothing points at is a payload with no effect.',
      );
    } else if (icon[1].trim() !== wantIcon) {
      out.push(
        `${GUI_DIR}/${snapName}.desktop says \`Icon=${icon[1].trim()}\`; it has to be exactly \`${wantIcon}\` — ` +
          'the absolute path the icon has AFTER install. A bare theme name is the freedesktop form and is what ' +
          'snapcraft refused with `not found in prime directory`; anything else is a path that resolves on no machine.',
      );
    }
    if (!existsSync(iconPath)) {
      out.push(
        `${GUI_DIR}/${snapName}.desktop points at \`${wantIcon}\` and ${GUI_DIR}/${snapName}.png does not exist. ` +
          'Nothing would be copied to meta/gui, so the launcher shows a broken image rather than the generic fallback.',
      );
    } else if (statSync(iconPath).size === 0) {
      out.push(`${GUI_DIR}/${snapName}.png is ZERO bytes. An empty PNG satisfies "the file exists" and renders nothing.`);
    }
  } else {
    if (icon) {
      out.push(
        `${GUI_DIR}/${snapName}.desktop carries \`Icon=${icon[1].trim()}\` while the bundle primed no icon for this ` +
          'app, so nothing will be at that path in meta/gui. The line is dropped rather than defaulted precisely ' +
          'so a launcher falls back to the desktop generic rather than to a broken image.',
      );
    }
    if (existsSync(iconPath)) {
      out.push(`${GUI_DIR}/${snapName}.png exists although the bundle primed no icon — the two readings disagree about what was found.`);
    }
  }
  return out;
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

function expectationsFor({ root, row, app, lane, version, expectIcon }) {
  const dirRel = row.storeMetadataDir.replace('{app}', app);
  const fields = {
    name: 'snap-name.txt',
    title: 'title.txt',
    summary: 'short-description.txt',
    description: 'long-description.txt',
    listedLicence: 'license.txt',
  };
  const out = {
    stagePackages: lane.packages,
    plugs: [...DESKTOP_PLUGS],
    grade: GRADE,
    confinement: CONFINEMENT,
    version,
    storeMetadataDir: dirRel,
    expectIcon,
  };
  const missing = [];
  for (const [key, file] of Object.entries(fields)) {
    const v = readListing(root, dirRel, file);
    if (v === null) missing.push(`${dirRel}/${file}`);
    out[key] = v;
  }
  // ⚠️ THROUGH THE GENERATOR'S OWN FUNCTION, never a second reading of the same
  // rule. `licenceForRecipe` decides emit-or-omit from `NON_SPDX_LICENCES`, and a
  // guard that re-implemented that decision would agree with a generator that had
  // drifted — the failure this whole file's "every expectation is imported" note
  // is about.
  const licence = out.listedLicence === null ? { license: null, omittedBecause: null } : licenceForRecipe(out.listedLicence);
  out.license = licence.license;
  out.licenceOmittedBecause = licence.omittedBecause;

  out.base = baseForRunner(lane.runner);
  let identity = null;
  try {
    identity = readLinuxIdentity(join(root, 'apps', app));
  } catch (e) {
    if (!(e instanceof LinuxBrandUnavailable)) throw e;
    missing.push(`apps/${app}/linux/CMakeLists.txt (${e.lines[0]})`);
  }
  out.command = identity?.binaryName ?? null;
  out.applicationId = identity?.applicationId ?? null;
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
    /** The project directory this guard generated into, when it generated one. */
    let generatedOut = null;
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
      // 🔴 IT NOW STAGES AN ICON, and it has to. Until 2026-08-09 this fixture
      // carried only the binary and the desktop entry, so every CI run graded the
      // NO-ICON branch while the lane ran the icon one — the passing path was the
      // one nobody was checking, which is how `Icon 'com.nikatru.subly' … not
      // found in prime directory` reached a real pack. The largest hicolor size
      // is used because that is the one the generator picks.
      const bundle = join(tmpRoot, app, 'bundle');
      const out = join(tmpRoot, app, 'out');
      generatedOut = out;
      const biggest = Math.max(...HICOLOR_SIZES);
      const iconDir = join(bundle, 'share', 'icons', 'hicolor', `${biggest}x${biggest}`, 'apps');
      mkdirSync(join(bundle, 'share', 'applications'), { recursive: true });
      mkdirSync(iconDir, { recursive: true });
      // The facts the generator's contract with a bundle rests on.
      writeFileSync(join(bundle, expected.command), 'fixture stand-in for the built binary\n');
      writeFileSync(
        join(bundle, 'share', 'applications', `${expected.applicationId}.desktop`),
        '[Desktop Entry]\nType=Application\n',
      );
      writeFileSync(join(iconDir, `${expected.applicationId}.png`), 'fixture stand-in for the primed icon\n');

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

    // The snapcraft PROJECT DIRECTORY. In the default scan this guard chose it
    // (`--out`); for `--emitted` it is derivable from the recipe's own path and
    // NOTHING ELSE, because RECIPE_PATH is the fixed location inside it. So limbs
    // 7 and 9b are asked only of a file that actually sits there — a recipe
    // somewhere else has no project directory to resolve against, and inventing
    // one would make them fire on input they cannot judge.
    const atRecipePath = EMITTED !== null && EMITTED.split('\\').join('/').endsWith(`/${RECIPE_PATH}`);
    const projectDir = EMITTED === null ? generatedOut : atRecipePath ? resolve(EMITTED, '..', '..') : null;
    if (EMITTED && !atRecipePath) {
      notes.push(
        `${label} — --emitted ${EMITTED} is not at .../${RECIPE_PATH}, so its snapcraft project directory is ` +
          'not derivable and neither `source` nor the launcher pair was resolved. A stated gap, not a pass.',
      );
    }
    problems.push(...validateEmitted({ yaml, expected, label, packBase, projectDir }));
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
    `equal to ${BUILD_WORKFLOW}:${lane.line}'s apt list (base ${BASE_FOR_RUNNER.get(lane.runner)} from ${lane.runner})` +
    (PACK_RUNNER ? `, packed on ${PACK_RUNNER} whose base is ${packBase}` : '') +
    (EMITTED ? ', and its `source` resolves from the project directory to a bundle holding the binary.' : '.') +
    (PACK_RUNNER
      ? ''
      : ' ⚠️ CONFIGURATION ONLY — `snapcraft` was not run here. The pack itself is proven by' +
        ' .github/workflows/submit-snap.yml, on dispatch.'),
);
