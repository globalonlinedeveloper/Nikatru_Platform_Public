// ─────────────────────────────────────────────────────────────────────────────
// store-audience.test.mjs — assert-store-audience.mjs must be able to FAIL.
//
// O-STORE-AUDIENCE-GUARDED-BY-CONSISTENCY-ONLY (C-21) and
// O-WINDOWS-AGE-RATING-ANSWERS-UNRECORDED (C-23). [ADR 068]: the audience floor is 18.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL DECLARATIONS, never a hand-built one:
// the register, the catalogue and every file the guard pins are copied from this
// repository, and each store tree the real app ships is recreated, so a mutation
// here is the edit a person would actually make. RA1 is the finding itself: both
// Play answers about children flipped to true together was exit 0 on every guard
// in the tree, because the only check was that they agreed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-store-audience.mjs');
const STORE = 'apps/subscriptiontracker/store';
const CR = `${STORE}/android-play/content-rating.json`;
const DS = `${STORE}/android-play/data-safety.json`;
const AR = `${STORE}/ios-appstore/age-rating.json`;
const WAR = `${STORE}/windows-store/age-rating.json`;
const GOV = `${STORE}/apps-gov-in/form-answers.json`;
const REGISTER = 'tooling/channel-register.json';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-audience-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
function realTree() {
  const root = join(TMP, `t${(seq += 1)}`);
  const put = (rel) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  };
  for (const rel of [REGISTER, 'catalog/apps.json', CR, DS, AR, WAR, GOV]) put(rel);
  // Every store tree the real app ships, so "the app does not ship here" is never
  // what a case is measuring.
  for (const d of readdirSync(join(REPO, STORE))) {
    if (statSync(join(REPO, STORE, d)).isDirectory()) mkdirSync(join(root, STORE, d), { recursive: true });
  }
  return root;
}
const readDoc = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const writeDoc = (root, rel, j) => writeFileSync(join(root, rel), `${JSON.stringify(j, null, 2)}\n`);
const edit = (root, rel, fn) => {
  const j = readDoc(root, rel);
  fn(j);
  writeDoc(root, rel, j);
};
const claim = (doc, id) => doc.claims.find((c) => c.id === id);
function run(mutate = () => {}) {
  const root = realTree();
  mutate(root);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-store-audience — limb A, the adult posture pinned per channel', () => {
  test('the copied real tree passes, and the OK line says how much it graded', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(
      r.out,
      /ok {2}adult posture — 13 pinned answer\(s\) hold across 5 channel\(s\) \(android-play, ios-appstore, macos-appstore, windows-store, apps-gov-in\) for 1 app\(s\); 4 store channel\(s\) stated as unrecorded/,
    );
    assert.match(r.out, /⬜ UNRECORDED — "linux-snap"/);
  });

  test('🔴 RA1 — both Play answers about children flipped to true TOGETHER fails (consistency alone passed it)', () => {
    const r = run((root) => {
      edit(root, CR, (j) => { claim(j, 'target-audience-children').answer = true; });
      edit(root, DS, (j) => { j.dataSecurity.playFamiliesPolicy.answer = true; });
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /content-rating\.json `claims\[id=target-audience-children\]\.answer` is true; the adult posture requires false/);
    assert.match(r.out, /data-safety\.json `dataSecurity\.playFamiliesPolicy\.answer` is true; the adult posture requires false/);
  });

  test('🔴 RA2 — Play\'s Target audience gains a minors\' age group', () => {
    const r = run((root) => edit(root, CR, (j) => { j.targetAudience.ageGroups = ['16-17', '18 and over']; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`targetAudience\.ageGroups` is \["16-17","18 and over"\]; the adult posture requires \["18 and over"\]/);
  });

  test('🔴 RA3 — the Play Target audience record deleted is a finding, not a pass', () => {
    const r = run((root) => edit(root, CR, (j) => { delete j.targetAudience; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`targetAudience\.ageGroups` is absent: Target audience and content — the age groups targeted is unrecorded/);
  });

  test('🔴 RA4 — an App Store Kids Age Band is declared: fails for iOS AND macOS, which share the record', () => {
    const r = run((root) => edit(root, AR, (j) => { claim(j, 'kids-age-band').answer = 'NINE_TO_ELEVEN'; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"ios-appstore": .*age-rating\.json `claims\[id=kids-age-band\]\.answer` is "NINE_TO_ELEVEN"; the adult posture requires null/);
    assert.match(r.out, /"macos-appstore": .*age-rating\.json `claims\[id=kids-age-band\]\.answer` is "NINE_TO_ELEVEN"/);
  });

  test('🔴 RA5 — the Apple age-rating file stops naming macos-appstore: nothing then answers for that channel', () => {
    const r = run((root) => edit(root, AR, (j) => { j.channels = ['ios-appstore']; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"macos-appstore": .*`channels` is \["ios-appstore"\] and must include "macos-appstore"/);
  });

  test('🔴 RA6 — apps-gov-in question 5 DELETED (assert-store-metadata only checked it when present)', () => {
    const r = run((root) => edit(root, GOV, (j) => { j.step3 = j.step3.filter((q) => q.id !== 'suitable-for-children'); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /form-answers\.json `step3\[id=suitable-for-children\]\.answer` is absent/);
  });

  test('🔴 RA7 — the Windows answers file deleted: one finding, not one per pin', () => {
    const r = run((root) => rmSync(join(root, WAR)));
    assert.equal(r.code, 1, r.out);
    assert.equal((r.out.match(/windows-store\/age-rating\.json does not exist/g) ?? []).length, 1, r.out);
  });

  test('🔴 RA8 — a store channel the guard was never taught is COVERAGE LOST, by name', () => {
    const r = run((root) => edit(root, REGISTER, (j) => { j.channels.push({ id: 'galaxy-store', kind: 'store', surface: 'app', storeMetadataDir: 'apps/{app}/store/galaxy-store' }); }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — store channel\(s\) "galaxy-store" carry no audience pin and no stated reason for having none/);
  });

  test('🔴 RA9 — a pin for a channel the register no longer has is stale, and fails', () => {
    const r = run((root) => edit(root, REGISTER, (j) => { j.channels = j.channels.filter((c) => c.id !== 'amo'); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"amo" is pinned or excused in tooling\/ci\/assert-store-audience\.mjs but is not a `kind: "store"` row/);
  });

  test('a PREVIEW file ("sworn": false) is printed as not graded; the rest is still graded', () => {
    const r = run((root) => edit(root, WAR, (j) => { j.sworn = false; }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⬜ PREVIEW — app "subscriptiontracker" × "windows-store": .*says "sworn": false/);
    assert.match(r.out, /ok {2}adult posture — 10 pinned answer\(s\) hold across 4 channel\(s\)/);
  });

  test('COVERAGE LOST when catalog/apps.json names no app', () => {
    const r = run((root) => writeFileSync(join(root, 'catalog/apps.json'), '[]\n'));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — catalog\/apps\.json names no app/);
  });

  test('COVERAGE LOST when no app ships a pinned store tree — zero answers graded is not a pass', () => {
    const r = run((root) => rmSync(join(root, STORE), { recursive: true, force: true }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /graded ZERO answers/);
  });
});

describe('assert-store-audience — limb B, the Windows IARC answers are the Play IARC answers', () => {
  test('the real Windows file carries one row per Play claim, each derived', () => {
    const play = JSON.parse(readFileSync(join(REPO, CR), 'utf8'));
    const win = JSON.parse(readFileSync(join(REPO, WAR), 'utf8'));
    assert.deepEqual(win.claims.map((c) => c.fromPlayClaim).sort(), play.claims.map((c) => c.id).sort());
    assert.ok(existsSync(join(REPO, 'tooling/bricks/app/__brick__/apps/{{app_id}}/store/windows-store/age-rating.json')));
  });

  test('🔴 RB1 — a Windows answer that differs from the Play answer it derives from', () => {
    const r = run((root) => edit(root, WAR, (j) => { claim(j, 'contains-ads').answer = true; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\("contains-ads"\) answers true and .*content-rating\.json answers false/);
  });

  test('🔴 RB2 — a Play claim with no Windows row: a question Partner Center asks that nobody answered', () => {
    const r = run((root) => edit(root, WAR, (j) => { j.claims = j.claims.filter((c) => c.id !== 'gambling'); }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries no claim derived from .*content-rating\.json "gambling"/);
  });

  test('🔴 RB3 — a Windows row that names no Play claim is underived', () => {
    const r = run((root) => edit(root, WAR, (j) => { j.claims[0].fromPlayClaim = 'not-a-claim'; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names fromPlayClaim "not-a-claim", which is no claim of/);
  });

  test('🔴 RB4 — a Play answer changed WITHOUT the Windows one: the drift is caught from either side', () => {
    const r = run((root) => edit(root, CR, (j) => { claim(j, 'contains-ads').answer = true; }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\("contains-ads"\) answers false and .*content-rating\.json answers true/);
  });
});
