// ─────────────────────────────────────────────────────────────────────────────
// stamp-chain-wiring.test.mjs — the app brick's post_gen hook runs the site
// chain ONCE, over the COMPLETE app, and warns rather than throws.
//
// What is pinned here, and why each matters:
//   · `_runSiteChain` runs tooling/sites/regen.mjs and THEN tooling/ci/
//     tag-owner.mjs --write — a stamp that skips the tag filter leaves the new
//     app's release tag owned by no lane;
//   · the call comes after every step that writes the app (workspace, brand
//     assets, store graphics, msix_config) and before the checklist print:
//     render.mjs writes msix_config.display_name only into a pubspec that
//     already carries the block `_writeMsixConfig` writes;
//   · post_gen spawns no chain generator by its own path — tooling/sites/
//     regen.mjs holds the order, and a second list here is how one drifts;
//   · a failure warns with its re-run line and returns: post_gen runs after the
//     tree is written, so a throw leaves a half-stamped app.
//
// The hook is Dart and this suite runs no Dart and no mason: it reads the
// source. The CI app-brick job is the lane that runs the hook for real.
// No test is declared inside a loop (assert-no-loop-cases.mjs).
//
// Run:  node --single-threaded --test tooling/ci/test/stamp-chain-wiring.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER } from '../../sites/regen.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const POST_GEN = 'tooling/bricks/app/hooks/post_gen.dart';
const SOURCE = readFileSync(join(REPO, ...POST_GEN.split('/')), 'utf8').replace(/\r\n/g, '\n');

/** The source with whole-line `//` comments blanked, so a comment that names a
 *  function is never read as a call to it. */
const CODE = SOURCE.split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l))
  .join('\n');

/** The text of a top-level Dart function, from its signature to the first
 *  closing brace in column 0. */
function body(signature) {
  const at = CODE.indexOf(signature);
  assert.ok(at !== -1, `${POST_GEN} has no \`${signature}\``);
  const end = CODE.indexOf('\n}\n', at);
  assert.ok(end !== -1, `${POST_GEN}: \`${signature}\` has no closing brace in column 0`);
  return CODE.slice(at, end + 2);
}

describe('post_gen.dart — the site chain runs once, last, and warns', () => {
  test('_runSiteChain runs tooling/sites/regen.mjs and then tooling/ci/tag-owner.mjs --write', () => {
    const chain = body('void _runSiteChain(');
    const regen = chain.indexOf("<String>['tooling/sites/regen.mjs']");
    const tagOwner = chain.indexOf("<String>['tooling/ci/tag-owner.mjs', '--write']");
    assert.ok(regen !== -1, '_runSiteChain does not run tooling/sites/regen.mjs');
    assert.ok(tagOwner !== -1, '_runSiteChain does not run tooling/ci/tag-owner.mjs --write');
    assert.ok(regen < tagOwner, 'tag-owner --write must run after the site chain');
    assert.match(chain, /Process\.runSync\(\s*'node',\s*args,/);
  });

  test('run() calls _runSiteChain once, after every step that writes the app and before the checklist', () => {
    const run = body('void run(HookContext context)');
    const calls = run.match(/_runSiteChain\(context, id: id\)/g) ?? [];
    assert.equal(calls.length, 1, `run() calls _runSiteChain ${calls.length} time(s)`);
    const at = (needle) => {
      const i = run.indexOf(needle);
      assert.ok(i !== -1, `run() no longer contains \`${needle}\``);
      return i;
    };
    const chain = at('_runSiteChain(context, id: id)');
    assert.ok(at('_registerInWorkspace(context, id: id)') < chain, 'the chain runs before the workspace registration');
    assert.ok(at('_writeBrandAssets(context,') < chain, 'the chain runs before the brand assets are written');
    assert.ok(at('_writeStoreGraphics(') < chain, 'the chain runs before the store graphics are written');
    assert.ok(at('_writeMsixConfig(') < chain, 'the chain runs before msix_config exists, so render.mjs cannot write its display_name');
    assert.ok(chain < at('Owner checklist'), 'the chain runs after the checklist is printed');
  });

  test('post_gen spawns no chain generator by its own path: one Process call, and it runs regen.mjs', () => {
    const spawns = CODE.match(/Process\.(run|runSync|start)\(/g) ?? [];
    assert.equal(spawns.length, 1, `${POST_GEN} makes ${spawns.length} Process call(s); the one allowed is in _runSiteChain`);
    const chain = body('void _runSiteChain(');
    assert.match(chain, /Process\.runSync\(/);
    const commands = chain.slice(chain.indexOf('const commands'), chain.indexOf('];') + 2);
    const own = ORDER.map((e) => e.script).filter((script) => commands.includes(script));
    assert.deepEqual(own, [], `_runSiteChain runs chain generator(s) itself; tooling/sites/regen.mjs runs them`);
  });

  test('_runSiteChain warns with the re-run line and returns; it never throws, and runs in a shell only on Windows', () => {
    const chain = body('void _runSiteChain(');
    assert.doesNotMatch(chain, /\bthrow\b/);
    assert.match(chain, /if \(result\.exitCode != 0\) \{\s*final command = 'node \$\{args\.join\(' '\)\}';\s*context\.logger\.warn\(/);
    assert.match(chain, /Re-run from the repo root:\s+\$command/);
    assert.match(chain, /\n\s*return;\n/);
    assert.match(chain, /runInShell: Platform\.isWindows,/);
    assert.match(chain, /'site chain: rendered "\$id"/);
  });
});
