#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/coverage.node.js — the guard on the guards.

   WHY THIS FILE EXISTS AT ALL. .github/workflows/ci.yml's core job tests
   `[ ${#sims[@]} -eq 0 ]`. That is the right check for "no sims at all" and the
   wrong check for everything after: ONE file in core/test/ turns the job green
   for good, however many modules land afterwards with no sim. A shared runtime
   that gains an untested module is the repo's recurring failure written out in
   full — not a broken check, a check that quietly stopped checking — so the
   coverage rule is enforced HERE, in a file the same glob runs, rather than in
   a workflow line nobody re-reads.

   WHAT IT ENFORCES, all derived from core/core.json rather than hardcoded, so
   the rule cannot drift away from the data it is about:

     1. every built module on the VENDORED surface (core/v1) has a sim, named
        for it;
     2. no sim is left behind pointing at a module that no longer exists;
     3. each sim actually loads the real source of the module it claims;
     4. each sim carries the recorded failing case docs/CORE-POLICY.md §2 rule 3
        requires — mechanically, by using harness.mutate();
     5. core.json's own counts still describe the tree it describes;
     6. every "promoted, byte for byte" claim in core.json is still TRUE, by
        recomputing the sha256 it records. core.json's gaps list says nothing
        recomputes these. Something does now.

   core/dev/ is out of scope for rule 1 — but that exclusion is READ FROM THE
   DATA (`"shipped": false`), not written into this file, so a dev helper that
   is ever promoted onto the shipped surface starts demanding a sim the moment
   its entry changes.

   Run: node core/test/coverage.node.js      (cwd-independent) */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./harness.js');
const { check, section, note } = H;

const CORE = H.CORE_ROOT;
const REPO = path.join(CORE, '..');
const TEST_DIR = __dirname;
const SELF = 'coverage.node.js';

/* Every .js under core/<sub>, as posix-ish relative paths. */
function jsUnder(sub) {
  const base = path.join(CORE, sub);
  const out = [];
  (function walk(dir, prefix) {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const d of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? prefix + '/' + d.name : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), rel);
      else if (/\.js$/i.test(d.name)) out.push(sub + '/' + rel);
    }
  })(base, '');
  return out;
}

/* v1/detect/pii.js -> detect-pii.node.js. Flat, because the CI glob is flat. */
function simNameFor(moduleKey) {
  return moduleKey.replace(/^v1\//, '').replace(/\.js$/, '').split('/').join('-') + '.node.js';
}

function main() {
  const cjPath = path.join(CORE, 'core.json');
  let cj = null;
  try { cj = JSON.parse(fs.readFileSync(cjPath, 'utf8')); } catch (e) {
    check('core/core.json parses', false, e.message);
    return;
  }
  check('core/core.json parses', true);

  const modules = cj.modules || {};
  const onDiskV1 = jsUnder('v1');
  const onDiskDev = jsUnder('dev');

  /* ---------------------------------------------------------------- */
  section('core.json describes the tree that is actually here');
  /* ---------------------------------------------------------------- */
  {
    const missingEntry = onDiskV1.filter(rel => !modules[rel]);
    check('every core/v1 file on disk has a core.json entry',
      missingEntry.length === 0,
      missingEntry.join(', ') + ' — a shared module with no entry is invisible to sync-core.mjs, ' +
      'which looks each copied file up by this key');

    const builtV1 = Object.keys(modules).filter(k => /^v1\//.test(k) && modules[k].status === 'built');
    const ghosts = builtV1.filter(k => onDiskV1.indexOf(k) < 0);
    check('every core.json entry marked "built" exists on disk',
      ghosts.length === 0, ghosts.join(', '));

    /* And the converse, which is the one that bites: a file sitting in core/v1
       while its entry still says "planned". sync-core.mjs copies what it WALKS,
       so that file is already on the vendored surface whatever this file calls
       it — and any rule keyed on `status` would exempt it from needing a sim. */
    const understated = onDiskV1.filter(rel => modules[rel] && modules[rel].status !== 'built');
    check('no core/v1 file on disk is still described as unbuilt',
      understated.length === 0,
      understated.join(', ') + ' — sync-core.mjs vendors every file it walks under core/v1, so a file ' +
      'that exists is shipped whatever its status says');

    const missingDev = onDiskDev.filter(rel => !modules[rel]);
    check('every core/dev file on disk has a core.json entry', missingDev.length === 0, missingDev.join(', '));
  }

  /* ---------------------------------------------------------------- */
  section('REQUIRED COVERAGE — one sim per shipped module');
  /* ---------------------------------------------------------------- */

  /* THE RULE IS KEYED ON THE FILESYSTEM, NOT ON core.json's `status`.
     scripts/sync-core.mjs vendors every file it WALKS under core/<channel>, so
     the shipped surface is "what is in core/v1", full stop. Keying this on
     `status: built` looked tidier and had a hole big enough to drive the whole
     defect through: dropping a new module into core/v1 while its entry still
     said "planned" exempted it from needing a sim, and the guard went green
     over an untested file that sync-core would happily copy into a tool.
     Measured, not reasoned about — a placeholder core/v1/msg.js passed the
     earlier version of this check.

     core/dev/ is the one exclusion, and it is READ FROM THE DATA below rather
     than written in here: sync-core never walks it and core.json marks each
     entry "shipped": false. */
  const needSim = onDiskV1.slice();

  check('the set of modules requiring a sim is non-empty. An empty requirement would make\n' +
    '        every check below vacuously true, which is the exact defect this file is for',
    needSim.length > 0, needSim.length);
  note('modules requiring a sim (every .js under core/v1): ' + needSim.join(', '));

  /* The exclusion has to be justified by the data, or it is just a hardcoded
     escape hatch. A dev helper promoted onto the shipped surface starts
     demanding a sim the moment its entry stops saying so. */
  const devEntries = Object.keys(modules).filter(k => /^dev\//.test(k));
  check('every core/dev entry declares itself unshipped, which is what excludes it',
    devEntries.length > 0 && devEntries.every(k => modules[k].shipped === false),
    devEntries.filter(k => modules[k].shipped !== false).join(', ') +
    ' — a dev helper that is not marked "shipped": false is claiming to be on the vendored surface');
  note('excluded by their own "shipped": false marker: ' + (devEntries.join(', ') || '(none)'));

  const simFiles = fs.readdirSync(TEST_DIR)
    .filter(n => /\.node\.js$/.test(n) && n !== SELF)
    .sort();

  const expected = new Map();      // simName -> moduleKey
  for (const k of needSim) expected.set(simNameFor(k), k);

  {
    const missing = [];
    for (const [simName, moduleKey] of expected) {
      if (simFiles.indexOf(simName) < 0) missing.push(moduleKey + ' -> core/test/' + simName);
    }
    check('every module that requires a sim has one',
      missing.length === 0,
      'MISSING:\n          ' + missing.join('\n          ') +
      '\n        core/ is vendored into every tool that adopts it, so a regression in an untested' +
      '\n        module is N outages at once. That is the whole admission rule.');

    const orphans = simFiles.filter(n => !expected.has(n));
    check('no sim is left pointing at a module that no longer exists',
      orphans.length === 0,
      orphans.join(', ') + ' — delete the sim in the same change that deletes the module, or ' +
      'the next reader trusts coverage that is not there');
  }

  /* ---------------------------------------------------------------- */
  section('each sim is a real sim');
  /* ---------------------------------------------------------------- */
  for (const [simName, moduleKey] of expected) {
    const abs = path.join(TEST_DIR, simName);
    if (!fs.existsSync(abs)) continue;      // already failed above
    const src = fs.readFileSync(abs, 'utf8');

    check(simName + ' loads the real ' + moduleKey,
      src.indexOf("'" + moduleKey + "'") >= 0 || src.indexOf('"' + moduleKey + '"') >= 0,
      'the sim never names its module, so it cannot be loading the shipped source');

    check(simName + ' carries a recorded failing case (docs/CORE-POLICY.md §2 rule 3)',
      /H\.mutate\(/.test(src),
      'no H.mutate() call — an assertion that cannot fail inflates coverage without adding any');

    check(simName + ' exits on the harness scoreboard, so a zero-assertion run fails',
      /process\.exit\(H\.finish\(\)\)/.test(src));
  }

  /* The harness must NOT be picked up by ci.yml's `core/test/*.node.js` glob:
     CI would run it as a sim, it would grade nothing, and an empty run that
     exits 0 is indistinguishable from a passing one. */
  {
    const stray = fs.readdirSync(TEST_DIR)
      .filter(n => /\.node\.js$/.test(n) && n !== SELF && !expected.has(n));
    check('no helper file is named so the CI glob runs it as a sim',
      stray.length === 0, stray.join(', '));
    check('the harness is not itself globbed', !/\.node\.js$/.test('harness.js'));
  }

  /* ---------------------------------------------------------------- */
  section('core.json counts still describe this tree');
  /* ---------------------------------------------------------------- */
  {
    const counts = cj.counts || {};
    const specified = Object.keys(modules).filter(k => modules[k].specified === true);
    const distinctModules = new Set(specified.map(k => modules[k].module).filter(Boolean));

    check('specifiedV1ModuleFiles is the number of specified KEYS',
      counts.specifiedV1ModuleFiles === specified.length,
      counts.specifiedV1ModuleFiles + ' declared vs ' + specified.length + ' counted');
    check('specifiedV1Modules is the number of distinct "module" values among them —\n' +
      '        core.json\'s own counting rule, derived rather than asserted beside the list',
      counts.specifiedV1Modules === distinctModules.size,
      counts.specifiedV1Modules + ' declared vs ' + distinctModules.size + ' counted');
    check('every specified entry carries the "module" field that count is derived from',
      specified.every(k => typeof modules[k].module === 'string'),
      specified.filter(k => typeof modules[k].module !== 'string').join(', '));

    /* MIND THE UNIT. core.json carries two counting units on purpose — FILES
       (13) and MODULES (11), where v1/ui/ is one module holding three files —
       and the ...Modules... fields are in the MODULE unit. Counting built/
       not-built in files gives 1 and 12, which looks like a bug in core.json
       and is a bug in the counter. Both are derived per module name here. */
    const builtNames = new Set(specified.filter(k => modules[k].status === 'built').map(k => modules[k].module));
    const notBuiltNames = new Set(
      Array.from(distinctModules).filter(name => !builtNames.has(name)));

    check('specifiedV1ModulesBuilt matches (module unit, not file unit)',
      counts.specifiedV1ModulesBuilt === builtNames.size,
      counts.specifiedV1ModulesBuilt + ' vs ' + builtNames.size);
    check('specifiedV1ModulesNotBuilt matches (module unit)',
      counts.specifiedV1ModulesNotBuilt === notBuiltNames.size,
      counts.specifiedV1ModulesNotBuilt + ' vs ' + notBuiltNames.size);
    check('the two module counts partition the specified set, so neither can drift alone',
      builtNames.size + notBuiltNames.size === distinctModules.size,
      builtNames.size + ' + ' + notBuiltNames.size + ' vs ' + distinctModules.size);

    const unspecifiedBuilt = Object.keys(modules)
      .filter(k => /^v1\//.test(k) && modules[k].specified !== true && modules[k].status === 'built').length;
    check('unspecifiedV1FilesBuilt matches', counts.unspecifiedV1FilesBuilt === unspecifiedBuilt,
      counts.unspecifiedV1FilesBuilt + ' vs ' + unspecifiedBuilt);

    const devBuilt = Object.keys(modules).filter(k => /^dev\//.test(k) && modules[k].status === 'built').length;
    check('devHelpersBuilt matches', counts.devHelpersBuilt === devBuilt, counts.devHelpersBuilt + ' vs ' + devBuilt);

    check('coreTestSims matches the number of sims on disk',
      counts.coreTestSims === simFiles.length,
      counts.coreTestSims + ' declared vs ' + simFiles.length + ' found. This number is quoted in ' +
      'core/README.md and core/CHANGELOG.md; a stale one is how a reader concludes a module is covered.');
  }

  /* ---------------------------------------------------------------- */
  section('"promoted, byte for byte" is still true');
  /* ---------------------------------------------------------------- */
  note('core.json gaps: "Nothing recomputes it." This section is what recomputes it.');
  {
    const promoted = Object.keys(modules).filter(k => modules[k].promotedFrom && modules[k].sourceSha256);
    check('at least one promotion claim exists to verify', promoted.length > 0, promoted.length);
    for (const k of promoted) {
      const m = modules[k];
      const abs = path.join(REPO, m.promotedFrom.split('/').join(path.sep));
      if (!fs.existsSync(abs)) {
        check(k + ': its recorded source still exists', false,
          m.promotedFrom + ' is gone. Either the promotion record names the wrong path or the ' +
          'source moved without the record following it.');
        continue;
      }
      const got = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      check(k + ': sha256 of ' + m.promotedFrom + ' still matches the recorded one',
        got === m.sourceSha256,
        'recorded ' + m.sourceSha256.slice(0, 16) + '…, actual ' + got.slice(0, 16) + '…\n' +
        '        The source moved after the promotion, so the header\'s "byte for byte" is now a\n' +
        '        false claim. Re-promote (copy the source under the header again) and update\n' +
        '        sourceSha256 here — never just edit the number.');

      /* The header claims everything below it is that file verbatim. Check the
         claim rather than trusting it: the promoted file must CONTAIN the
         source file's bytes. */
      const coreSrc = fs.readFileSync(path.join(CORE, k.split('/').join(path.sep)), 'utf8');
      const srcText = fs.readFileSync(abs, 'utf8');
      check(k + ': the promoted copy still contains its source verbatim',
        coreSrc.indexOf(srcText) >= 0,
        'the header says "everything below this header is that file byte for byte" and it is not');
    }
  }
}

try {
  main();
} catch (e) {
  console.error('\nCOVERAGE GUARD CRASHED — this is a failure, not a skip:\n', e);
  process.exit(1);
}
process.exit(H.finish());
