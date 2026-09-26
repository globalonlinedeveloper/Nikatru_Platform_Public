// ─────────────────────────────────────────────────────────────────────────────
// channel-arming.test.mjs — tooling/ci/channel-arming.mjs must be able to say NO.
//
// This module decides whether a missing signing secret FAILS a release or is
// PRINTED as an owner-gated gap. Get it wrong in one direction and the first tag
// this repository ever pushes publishes nothing (which is what was happening);
// get it wrong in the other and a served channel ships an artifact nothing
// vouches for. So both directions are exercised here, and the file the tests
// ultimately answer to is `tooling/channel-register.json` itself — the last
// describe reads the REAL rows rather than a fixture, because a derivation over
// invented rows only proves it agrees with the person who invented them.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REGISTER,
  armedFatalLines,
  armingOf,
  laneShaped,
  releaseGapVerdict,
  unarmedGapLines,
} from '../channel-arming.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const LANE = { workflow: '.github/workflows/build-platforms.yml', job: 'windows' };
/** The four rows as the register really carries them today, so the fixtures are
 *  a transcription rather than an invention. */
const REAL_SHAPES = {
  'windows-direct': { id: 'windows-direct', submittable: false, served: false, lane: null },
  'ios-appstore': { id: 'ios-appstore', submittable: true, served: false, lane: null },
  'macos-appstore': { id: 'macos-appstore', submittable: true, served: false, lane: null },
  'linux-appimage': { id: 'linux-appimage', submittable: false, served: false, lane: null },
  'android-play': { id: 'android-play', submittable: true, served: false, lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
  web: { id: 'web', submittable: false, served: true, lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
};

describe('channel-arming · the lane shape', () => {
  test('a {workflow, job} pair is a lane', () => {
    assert.equal(laneShaped(LANE), true);
  });

  test('null, undefined and a bare string are not', () => {
    for (const bad of [null, undefined, '.github/workflows/build-platforms.yml', 42, []]) {
      assert.equal(laneShaped(bad), false, `${JSON.stringify(bad)} was read as a lane`);
    }
  });

  test('🔴 a HALF lane is not a lane — it resolves to nothing and would otherwise look exactly like coverage', () => {
    assert.equal(laneShaped({ workflow: '.github/workflows/x.yml' }), false);
    assert.equal(laneShaped({ job: 'windows' }), false);
    assert.equal(laneShaped({ workflow: '', job: 'windows' }), false);
    assert.equal(laneShaped({ workflow: '.github/workflows/x.yml', job: '   ' }), false);
  });
});

describe('channel-arming · what arms a channel', () => {
  test('`served: true` arms it — something is being handed to users right now', () => {
    const a = armingOf({ id: 'web', served: true, submittable: false, lane: null });
    assert.equal(a.armed, true);
    assert.match(a.reasons.join(' '), /`served: true`/);
    assert.deepEqual(a.blockers, []);
  });

  test('`submittable: true` PLUS a real lane arms it — CI emits the artifact a submission would carry', () => {
    const a = armingOf({ id: 'android-play', submittable: true, served: false, lane: LANE });
    assert.equal(a.armed, true);
    assert.match(a.reasons.join(' '), /build-platforms\.yml · job "windows"/);
  });

  test('🔴 `submittable: true` with NO lane does NOT arm it, and that single fact is the whole Apple case', () => {
    const a = armingOf(REAL_SHAPES['ios-appstore']);
    assert.equal(a.armed, false);
    assert.ok(a.blockers.some((b) => b.includes('`submittable: true` but `lane: null`')), a.blockers.join(' | '));
  });

  test('🔴 a MALFORMED lane does not arm a submittable row — a row must not be able to arm itself with `lane: {}`', () => {
    assert.equal(armingOf({ id: 'x', submittable: true, lane: {} }).armed, false);
    assert.equal(armingOf({ id: 'x', submittable: true, lane: { workflow: 'a.yml' } }).armed, false);
  });

  test('neither served nor submittable is unarmed, and says both', () => {
    const a = armingOf(REAL_SHAPES['windows-direct']);
    assert.equal(a.armed, false);
    assert.ok(a.blockers.some((b) => b.includes('`served: false`')));
    assert.ok(a.blockers.some((b) => b.includes('`submittable: false`')));
  });

  test('an armed row carries reasons and no blockers; an unarmed row the reverse — never both, never neither', () => {
    for (const row of Object.values(REAL_SHAPES)) {
      const a = armingOf(row);
      if (a.armed) {
        assert.ok(a.reasons.length > 0, `${a.id} is armed and says why not`);
        assert.deepEqual(a.blockers, [], `${a.id} is armed and still lists blockers`);
      } else {
        assert.deepEqual(a.reasons, [], `${a.id} is unarmed and still lists reasons`);
        assert.ok(a.blockers.length > 0, `${a.id} is unarmed and cannot say why`);
      }
    }
  });

  test('🔴 the derivation never reads the channel ID — rename the row and the answer is identical', () => {
    // The rule the brief set: the register is the single source and no channel
    // name is hardcoded. A derivation keyed on an id would pass every other test
    // in this file and fail this one.
    for (const row of Object.values(REAL_SHAPES)) {
      assert.equal(
        armingOf({ ...row, id: 'a-name-nobody-has-ever-written' }).armed,
        armingOf(row).armed,
        `${row.id} changed its answer when renamed`,
      );
    }
  });

  test('garbage in is UNARMED, never armed — the fail-safe direction is "do not claim it ships"', () => {
    for (const bad of [null, undefined, {}, { id: 'x' }, { served: 'true' }, { submittable: 1, lane: LANE }]) {
      assert.equal(armingOf(bad).armed, false, `${JSON.stringify(bad)} was read as armed`);
    }
  });
});

describe('channel-arming · the verdict over a set of rows', () => {
  test('every row unarmed → not fatal, and the unarmed split holds them all', () => {
    const v = releaseGapVerdict([REAL_SHAPES['ios-appstore'], REAL_SHAPES['macos-appstore']]);
    assert.equal(v.fatal, false);
    assert.equal(v.unarmed.length, 2);
    assert.equal(v.armed.length, 0);
  });

  test('🔴 ONE armed row out of several is FATAL — one credential serves the set, so a partial answer is not on offer', () => {
    const v = releaseGapVerdict([
      REAL_SHAPES['ios-appstore'],
      { ...REAL_SHAPES['macos-appstore'], lane: LANE },
    ]);
    assert.equal(v.fatal, true);
    assert.deepEqual(v.armed.map((a) => a.id), ['macos-appstore']);
    assert.deepEqual(v.unarmed.map((a) => a.id), ['ios-appstore']);
  });

  test('a single row may be passed unwrapped', () => {
    assert.equal(releaseGapVerdict(REAL_SHAPES.web).fatal, true);
    assert.equal(releaseGapVerdict(REAL_SHAPES['windows-direct']).fatal, false);
  });

  test('an EMPTY row set is not fatal — and the callers cannot reach it, because each refuses to run without its row', () => {
    // Stated rather than left implicit: "no rows" must not be read as "an armed
    // channel". The three seams all exit COVERAGE LOST before this point when
    // their register row is missing, which is where that case actually belongs.
    const v = releaseGapVerdict([]);
    assert.equal(v.fatal, false);
    assert.deepEqual(v.armings, []);
  });
});

describe('channel-arming · the printed gap', () => {
  const lines = () =>
    unarmedGapLines({
      armings: [armingOf(REAL_SHAPES['windows-direct'])],
      secretNames: ['WINDOWS_CODESIGN_PFX_BASE64', 'WINDOWS_CODESIGN_PFX_PASSWORD'],
      laneReasons: ['the run is a TAG push (refs/tags/subscriptiontracker-v1.0.0)'],
      ownerItem: 'a certificate that must be PURCHASED',
    }).join('\n');

  test('it says it is a release lane, why, and which row cannot reach a user', () => {
    const t = lines();
    assert.match(t, /RELEASE LANE, NO SIGNING SECRETS/);
    assert.match(t, /this run IS a release lane — the run is a TAG push/);
    assert.match(t, /channel "windows-direct" is NOT ARMED/);
    assert.match(t, new RegExp(REGISTER.replace('.', '\\.')));
  });

  test('it names the absent secrets and the owner-gated blocker', () => {
    const t = lines();
    assert.match(t, /WINDOWS_CODESIGN_PFX_BASE64/);
    assert.match(t, /THE BLOCKER IS OWNER-GATED: a certificate that must be PURCHASED/);
    assert.match(t, /\[pipeline C-6\] says PRINT, not fail/);
  });

  test('🔴 it carries the TRIPWIRE — without it this block reads as a waiver', () => {
    const t = lines();
    assert.match(t, /TRIPWIRE, NOT A WAIVER/);
    assert.match(t, /FAILS the\s*\n?\s*moment/);
    assert.match(t, /Arming a channel and creating its secrets belong in ONE change/);
  });

  test('with no owner item the block still prints and simply omits that stanza', () => {
    const t = unarmedGapLines({ armings: [armingOf(REAL_SHAPES['linux-appimage'])] }).join('\n');
    assert.match(t, /RELEASE LANE, NO SIGNING SECRETS/);
    assert.doesNotMatch(t, /OWNER-GATED/);
  });
});

describe('channel-arming · the armed failure lines', () => {
  test('🔴 an EMPTY armed set contributes NOTHING — the rescope must leave every existing message byte-identical', () => {
    assert.deepEqual(armedFatalLines([]), []);
    assert.deepEqual(armedFatalLines(undefined), []);
    assert.deepEqual(armedFatalLines(null), []);
  });

  test('an armed row is named together with the FIELD that armed it', () => {
    const t = armedFatalLines([armingOf({ id: 'windows-direct', served: true })]).join('\n');
    assert.match(t, /channel "windows-direct" IS ARMED/);
    assert.match(t, /`served: true`/);
    assert.match(t, /hand a user an artifact nothing vouches for/);
  });

  test('several armed rows are each named, not summarised', () => {
    const t = armedFatalLines([
      armingOf({ id: 'ios-appstore', submittable: true, lane: LANE }),
      armingOf({ id: 'macos-appstore', served: true }),
    ]).join('\n');
    assert.match(t, /"ios-appstore" IS ARMED/);
    assert.match(t, /"macos-appstore" IS ARMED/);
  });
});

// ═════ the real register — the anti-drift check ══════════════════════════════
//
// A fixture agrees with whatever belief wrote it. These read the file the three
// signing seams actually read, so the day somebody arms a row the change shows
// up HERE — in a test whose message says what it now means — and not on the
// morning of a release.
describe('channel-arming · against the REAL tooling/channel-register.json', () => {
  const rows = () => {
    const p = join(REPO_ROOT, 'tooling', 'channel-register.json');
    assert.ok(existsSync(p), `${p} does not exist — every derivation here would range over nothing`);
    const channels = JSON.parse(readFileSync(p, 'utf8')).channels;
    assert.ok(Array.isArray(channels) && channels.length > 0, 'the register carries no channels');
    return channels;
  };

  test('every declared channel gets an answer, and the derivation reaches all of them', () => {
    const all = rows();
    const armings = all.map(armingOf);
    assert.equal(armings.length, all.length);
    for (const a of armings) assert.equal(typeof a.armed, 'boolean', `${a.id} produced no answer`);
    // The self-check that matters: NOT ONE armed would mean the derivation had
    // silently stopped recognising the arming fields, which reads exactly like a
    // repository that publishes nothing — and this one publishes the web app.
    assert.ok(armings.some((a) => a.armed), 'no channel at all is armed; the derivation has stopped reading the register');
  });

  // ⏱ WAS FOUR ROWS, IS NOW TWO — 2026-09-09. `ios-appstore` and `macos-appstore`
  // left this list on the day their certificates were issued and their secrets
  // created, which is precisely what the message below was written to announce.
  // The two that remain are the ones whose credential still does not exist.
  test('🔴 the remaining owner-gated signing rows are UNARMED — this is what makes the first tag survivable', () => {
    const byId = new Map(rows().map((c) => [c.id, c]));
    for (const id of ['windows-direct', 'linux-appimage']) {
      const row = byId.get(id);
      assert.ok(row, `${REGISTER} declares no ${id} row`);
      const a = armingOf(row);
      assert.equal(
        a.armed,
        false,
        `${id} is now armed (${a.reasons.join('; ')}). Its signing seam's release lane is fatal again without the credential — correct, and this is where that announces itself.`,
      );
    }
  });

  // The other half of the same statement, and the reason the list above shrank
  // rather than the assertion loosening: these two ARE armed now, deliberately,
  // and a silent revert to `lane: null` would make this red.
  test('the two Apple rows ARMED on 2026-09-09 — the signing infrastructure exists and a lane emits the artifact', () => {
    const byId = new Map(rows().map((c) => [c.id, c]));
    for (const id of ['ios-appstore', 'macos-appstore']) {
      const row = byId.get(id);
      assert.ok(row, `${REGISTER} declares no ${id} row`);
      const a = armingOf(row);
      assert.equal(a.armed, true, `${id} is expected to be armed: ${a.blockers.join(' | ')}`);
      assert.equal(a.lane.job, 'apple');
      assert.equal(row.served, false, `${id} is BUILT, not published — submitting remains the owner's call`);
    }
  });

  test('the web row IS armed, which is the positive control this whole file needs', () => {
    // Without one row that comes out ARMED against the real file, every negative
    // result above is consistent with a derivation that returns false always.
    const web = rows().find((c) => c.id === 'web');
    assert.ok(web, `${REGISTER} declares no web row`);
    const a = armingOf(web);
    assert.equal(a.armed, true, 'the served web channel must arm, or this derivation cannot say yes to anything');
    assert.match(a.reasons.join(' '), /`served: true`/);
  });

  test('android-play is armed by its LANE rather than by being served — the second arming limb, exercised on real data', () => {
    const row = rows().find((c) => c.id === 'android-play');
    assert.ok(row, `${REGISTER} declares no android-play row`);
    const a = armingOf(row);
    assert.equal(a.served, false, 'android-play is expected to be unserved');
    assert.equal(a.armed, true, 'a submittable row whose lane emits the .aab must arm');
    assert.match(a.reasons.join(' '), /build-platforms\.yml/);
  });
});

// ── The CLI (A1-A3): the runbook's arming lines, written from a register ─────
// Each case runs the real CLI over a small tree in the OS temp directory. The
// fixture register carries four rows' arming fields, one per shape.
describe('channel-arming · the CLI that writes the runbook\'s arming lines', () => {
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'channel-arming.mjs');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });
  const pair = (block) => [`<!-- BEGIN GENERATED: channel-arming ${block} -->`, `<!-- END GENERATED: channel-arming ${block} -->`].join('\n');
  const RUNBOOK_MD = `# Runbook\n\n## 2. What a tag triggers\n\n${pair('arming')}\n\n## 3. What the Release carries\n\n${pair('apple-rows')}\n`;
  const CHANNELS = [
    { id: 'web', served: true, submittable: false, storefrontKey: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
    { id: 'ios-appstore', served: false, submittable: true, storefrontKey: 'appstore', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'apple' } },
    { id: 'macos-appstore', served: false, submittable: true, storefrontKey: 'mac', lane: null },
    { id: 'windows-direct', served: false, submittable: false, storefrontKey: null, lane: null },
  ];
  let TMP;
  let seq = 0;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-arming-')); });
  after(() => { rmSync(TMP, { recursive: true, force: true }); });
  const seed = ({ channels = CHANNELS, runbook = RUNBOOK_MD, register = null } = {}) => {
    const root = join(TMP, `t${seq++}`);
    const files = {
      'tooling/channel-register.json': register ?? JSON.stringify({ channels }, null, 2),
      'tooling/release/RELEASE-RUNBOOK.md': runbook,
      'catalog/apps.json': JSON.stringify([{ slug: 'demo', listings: { web: 'https://example.test/demo', appstore: null, mac: null } }]),
    };
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  };
  const runbookOf = (root) => readFileSync(join(root, 'tooling/release/RELEASE-RUNBOOK.md'), 'utf8');

  test('A1 · --write fills both blocks from the register, --check is green, and a register flip reds --check until --write', () => {
    const root = seed();
    const empty = cli('--check', root);
    assert.equal(empty.status, 1, empty.stderr);
    assert.match(empty.stderr, /tooling\/release\/RELEASE-RUNBOOK\.md:5 — the `arming` block is not what tooling\/channel-register\.json says/);
    assert.equal(cli('--write', root).status, 0);
    assert.equal(cli('--check', root).status, 0, 'the control: freshly written blocks match');
    const text = runbookOf(root);
    assert.match(text, /<!-- why: GENERATED by node tooling\/ci\/channel-arming\.mjs --write\. Never hand-edit\. -->/);
    assert.match(text, /\*\*2\*\* of its 4 channels are ARMED/);
    assert.match(text, /\| `windows-direct` \| unarmed \| `served: false`; `submittable: false` \|/);
    assert.match(text, /- `ios-appstore` is \*\*ARMED\*\* in §2: `submittable: true` \+ lane \.github\/workflows\/build-platforms\.yml · job `apple`\./);
    assert.match(text, /- `macos-appstore` is \*\*unarmed\*\* in §2: `served: false`; `submittable: true` but `lane: null`\./);
    const flipped = CHANNELS.map((c) => (c.id === 'windows-direct' ? { ...c, served: true } : c));
    writeFileSync(join(root, 'tooling/channel-register.json'), JSON.stringify({ channels: flipped }, null, 2));
    const red = cli('--check', root);
    assert.equal(red.status, 1, red.stderr);
    assert.match(red.stderr, /the `arming` block is not what/);
    assert.doesNotMatch(red.stderr, /apple-rows/, 'only the block the flip changed is named');
    assert.equal(cli('--write', root).status, 0);
    assert.equal(cli('--check', root).status, 0);
  });

  test('A2 · a missing marker, an unreadable or empty register, or a missing Apple row is COVERAGE LOST (exit 2), never a pass', () => {
    const noMarker = cli('--check', seed({ runbook: `# Runbook\n\n${pair('arming')}\n` }));
    assert.equal(noMarker.status, 2, noMarker.stderr);
    assert.match(noMarker.stderr, /^COVERAGE LOST — channel-arming: tooling\/release\/RELEASE-RUNBOOK\.md has no complete `apple-rows` block/m);
    const unreadable = cli('--check', seed({ register: '{ not json' }));
    assert.equal(unreadable.status, 2, unreadable.stderr);
    assert.match(unreadable.stderr, /tooling\/channel-register\.json could not be read/);
    const emptyList = cli('--list', seed({ channels: [] }));
    assert.equal(emptyList.status, 2, '--list over no channel is not a clean empty answer');
    const noApple = cli('--write', seed({ channels: CHANNELS.filter((c) => c.id !== 'macos-appstore') }));
    assert.equal(noApple.status, 2, noApple.stderr);
    assert.match(noApple.stderr, /apple-signing\.mjs serves macos-appstore, and tooling\/channel-register\.json holds no such row/);
  });

  test('A3 · --list (and no flag) prints one line per channel: id, ARMED or unarmed, the field, the availability state; importing the module prints nothing', () => {
    const root = seed();
    const listed = cli('--list', root);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trimEnd().split('\n'), [
      'web\tARMED\t`served: true`\tavailability demo=live',
      'ios-appstore\tARMED\t`submittable: true` + lane .github/workflows/build-platforms.yml · job `apple`\tavailability demo=soon',
      'macos-appstore\tunarmed\t`served: false`; `submittable: true` but `lane: null`\tavailability demo=soon',
      'windows-direct\tunarmed\t`served: false`; `submittable: false`\tavailability demo=absent',
    ]);
    assert.equal(cli(root).stdout, listed.stdout, 'no flag runs --list');
    const url = pathToFileURL(CLI).href;
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); if (typeof m.armingOf !== 'function') process.exitCode = 3;`, root], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout + imported.stderr, '', 'importing channel-arming.mjs must read and print nothing');
  });
});
