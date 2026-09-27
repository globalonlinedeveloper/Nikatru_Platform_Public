// ─────────────────────────────────────────────────────────────────────────────
// render-play-graphics.test.mjs — tooling/store/render-play-graphics.mjs must be
// able to FAIL, by name, before it renders anything.
//
// ⏱ 2026-09-26 (O-SCREENSHOT-DRIVER-IS-ONE-APPS). store-screenshots.yml's Play job
// now runs `render-play-graphics.mjs --app "$APP" --check` before it captures, so
// a workflow runs this script and assert-guard-coverage.mjs asks for a test that
// runs its failing path.
//
// ⚠️ NO CASE HERE RENDERS. A render needs Chrome, and whether a runner's Chrome
// renders the committed bytes is UNVERIFIED until the lane's first dispatch
// (docs/ci/store-screenshots.md); a test that rendered would be a second, earlier
// place for that unknown to land. What is exercised is the refusal every run
// passes through first: the brand source is READ, never defaulted, so an app with
// no brand SVGs is refused by name with exit 1, in `--check` mode and without it,
// and nothing is written.
//
// Every case is written out by hand (assert-no-loop-cases.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'store', 'render-play-graphics.mjs');
/** An app id no workspace declares, so apps/<it>/ has no brand directory. */
const ABSENT = 'no-such-app-render-play-graphics-test';

// BOUNDED, so a spawn that hangs at exit fails its case by name.
const BOUND = { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' };
const out = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n[spawn] ${r.error.message}` : ''}`;

describe('render-play-graphics.mjs refuses a brand source that is not there', () => {
  test('🔴 --check on an app with no brand SVGs exits 1 and names the missing file', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--app', ABSENT, '--check'], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(
      out(r),
      /render-play-graphics: REFUSING — \.[\\/]apps[\\/]no-such-app-render-play-graphics-test[\\/]assets[\\/]icon[\\/]app_icon_foreground\.svg does not exist\./,
    );
    // The reason is the refusal: a fallback would render colours nobody chose.
    assert.match(out(r), /rendering a built-in fallback would emit a listing graphic in colours nobody chose/);
    assert.doesNotMatch(out(r), /render-play-graphics: ok/);
  });

  test('🔴 without --check the same app is refused the same way, and no listing directory is created', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--app', ABSENT], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /REFUSING — .*app_icon_foreground\.svg does not exist\./);
    assert.equal(existsSync(join(REPO, 'apps', ABSENT)), false, `apps/${ABSENT} was created by a refused run`);
  });
});
