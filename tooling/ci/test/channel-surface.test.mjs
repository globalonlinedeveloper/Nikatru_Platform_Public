// ─────────────────────────────────────────────────────────────────────────────
// channel-surface.test.mjs — channel-surface.mjs must answer from the register's
// DECLARED `flutterApp`, refuse to guess for a surface nobody described, and the
// six guards that scope by it must redden when a THIRD surface arrives undeclared.
//
// O-EXT-SURFACE-AXIS (2026-09-15). Until then each of those guards compared a
// row's `surface` with the literal 'extension', so a third surface was filed as a
// Flutter app by all of them at once and nothing said so.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FLUTTER_APP_FIELD,
  declaredSurfaces,
  flutterAppChannel,
  partitionByFlutterApp,
  undeclaredSurfaceLine,
} from '../channel-surface.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const REGISTER_REL = 'tooling/channel-register.json';

const REG = {
  surfaces: {
    _why: ['prose'],
    app: { what: 'a Flutter app', flutterApp: true },
    extension: { what: 'a browser extension', flutterApp: false },
    script: { what: 'no flag declared' },
    odd: { flutterApp: 'yes' },
  },
};

describe('channel-surface — the answer comes from the declaration', () => {
  test('the field is named once', () => {
    assert.equal(FLUTTER_APP_FIELD, 'flutterApp');
  });

  test('declared surfaces skip `_` prose keys and non-objects', () => {
    assert.deepEqual([...declaredSurfaces(REG).keys()], ['app', 'extension', 'script', 'odd']);
    assert.equal(declaredSurfaces({ surfaces: [] }).size, 0);
    assert.equal(declaredSurfaces(null).size, 0);
  });

  test('true and false are read off the declaration, never off the surface NAME', () => {
    assert.equal(flutterAppChannel(REG, { surface: 'app' }), true);
    assert.equal(flutterAppChannel(REG, { surface: 'extension' }), false);
    // The name 'extension' decides nothing on its own: flip the declaration and the answer flips.
    const flipped = { surfaces: { extension: { flutterApp: true } } };
    assert.equal(flutterAppChannel(flipped, { surface: 'extension' }), true);
  });

  test('NULL — undecidable — for an undeclared surface, a missing or non-boolean flag, or no surface at all', () => {
    assert.equal(flutterAppChannel(REG, { surface: 'desktop-widget' }), null);
    assert.equal(flutterAppChannel(REG, { surface: 'script' }), null);
    assert.equal(flutterAppChannel(REG, { surface: 'odd' }), null);
    assert.equal(flutterAppChannel(REG, {}), null);
    assert.equal(flutterAppChannel(REG, { surface: '' }), null);
    assert.equal(flutterAppChannel({}, { surface: 'app' }), null);
  });

  test('partition keeps every row, and an undeclared one is never silently an app', () => {
    const rows = [{ id: 'a', surface: 'app' }, { id: 'e', surface: 'extension' }, { id: 's', surface: 'script' }];
    const p = partitionByFlutterApp(REG, rows);
    assert.deepEqual(p.flutter.map((r) => r.id), ['a']);
    assert.deepEqual(p.other.map((r) => r.id), ['e']);
    assert.deepEqual(p.undeclared.map((r) => r.id), ['s']);
  });

  test('the refusal names the channel, the surface and the question', () => {
    const line = undeclaredSurfaceLine({ id: 'cli-store', surface: 'script' }, 'whether X');
    assert.match(line, /channel "cli-store" is on surface "script"/);
    assert.match(line, /boolean `flutterApp`/);
    assert.match(line, /whether X cannot be decided/);
  });
});

// ── THE MUTATION CASE THE ROW ASKS FOR: a third surface, on the REAL register ──
// A copy of the real register gains a channel on surface "script". Undeclared,
// every register-reading guard that scopes by the Flutter question must refuse;
// declared `flutterApp: false`, assert-channel-register accepts the declaration
// and the Flutter-only guards leave the row out.
describe('a THIRD surface arriving in the real register', () => {
  let TMP;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-surface-')); });
  after(() => { rmSync(TMP, { recursive: true, force: true }); });

  const realRegister = () => JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
  const withThirdSurface = (register, { declare }) => {
    const r = structuredClone(register);
    if (declare) {
      r.surfaces.script = {
        what: 'a hypothetical third surface, for this test only',
        flutterApp: false,
        platforms: ['node'],
        platformsSource: 'this test',
        storeMetadataGradedBy: REGISTER_REL,
      };
    }
    const ext = r.channels.find((c) => c.surface === 'extension' && Array.isArray(c.artifactFormats));
    r.channels.push({ ...structuredClone(ext), id: 'script-store', surface: 'script' });
    return r;
  };

  test('the library refuses the undeclared row and places the declared one', () => {
    const undeclared = withThirdSurface(realRegister(), { declare: false });
    const row = undeclared.channels.find((c) => c.id === 'script-store');
    assert.equal(flutterAppChannel(undeclared, row), null);
    const declared = withThirdSurface(realRegister(), { declare: true });
    assert.equal(flutterAppChannel(declared, declared.channels.find((c) => c.id === 'script-store')), false);
    // and the real register's own two surfaces are declared both ways
    const real = realRegister();
    assert.equal(real.surfaces.app.flutterApp, true);
    assert.equal(real.surfaces.extension.flutterApp, false);
  });

  // The refusal of a surface with no boolean is asserted in channel-register.test.mjs,
  // against that guard's own fixture tree.
});
