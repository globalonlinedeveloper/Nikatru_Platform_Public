// Every release tag has exactly one owner, and the registers say which.
//
// O-RELEASE-TAG-LANES-CROSS-FIRE: build-platforms.yml fired on `*-v*` and
// extensions.yml on `*-v*` minus `core-v*`, so one tag started BOTH releases —
// an app tag ran the extension release and an extension tag ran the app build.
// tooling/ci/tag-owner.mjs now derives each lane's `push: tags:` list from the
// product registers + tooling/channel-register.json and gates every run on the
// same answer, because a workflow_dispatch on a tag ref never meets the filter.
//
// This file feeds BOTH lanes' trigger and job gate every product's tag shape
// and proves exactly one lane owns each. Nothing here pushes a tag: pushing a
// tag is the owner's act. Red control, by hand: widen one lane's filter back to
// '*-v*' and "each product's tag has exactly one owner" goes red.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { refFilterToRegExp, refFilterMatches } from '../workflow-scan.mjs';
import { derive, tagTriggeredWorkflows, actualOwners, TAG_SHAPES, releaseTagOf } from '../tag-owner.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const TAG_OWNER = join(CI_DIR, 'tag-owner.mjs');
const APP_LANE = '.github/workflows/build-platforms.yml';
const EXT_LANE = '.github/workflows/extensions.yml';

function run(args) {
  const r = spawnSync(process.execPath, [TAG_OWNER, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// A copy of exactly what the derivation reads, so a fixture can break one thing.
const COPIED = ['catalog/apps.json', 'extensions/catalog/extensions.json', 'tooling/channel-register.json'];
let scratch;
let seq = 0;
function fixture(edits = []) {
  const root = join(scratch, `t${seq++}`);
  for (const rel of COPIED) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
  for (const { file, from, to, json } of edits) {
    const p = join(root, file);
    const src = readFileSync(p, 'utf8');
    if (json) {
      writeFileSync(p, JSON.stringify(json(JSON.parse(src)), null, 2));
      continue;
    }
    // A mutation that matches nothing would read as green; refuse it.
    assert.equal(src.split(from).length - 1, 1, `fixture edit must hit exactly one "${from}" in ${file}`);
    writeFileSync(p, src.replace(from, to));
  }
  return root;
}

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tag-lanes-'));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

describe('the GitHub ref-filter reader', () => {
  test('`*` stops at a slash, `**` does not', () => {
    assert.equal(refFilterMatches(['*-v*'], 'fullshot-v1.0.0'), true);
    assert.equal(refFilterMatches(['*-v*'], 'a/b-v1'), false);
    assert.equal(refFilterMatches(['**-v*'], 'a/b-v1'), true);
  });
  test('`+` and `?` repeat the atom before them; `.` is literal', () => {
    const three = '[0-9]+.[0-9]+.[0-9]+';
    assert.equal(refFilterMatches([`fullshot-v${three}`], 'fullshot-v1.10.1'), true);
    assert.equal(refFilterMatches([`fullshot-v${three}`], 'fullshot-v1.10.1.2'), false);
    assert.equal(refFilterMatches([`fullshot-v${three}`], 'fullshot-v1x10x1'), false);
    assert.equal(refFilterMatches([`fullshot-v${three}`], 'fullshot-v1.0.0-rc.1'), false);
    assert.equal(refFilterMatches(['v1?.0'], 'v.0'), true);
    assert.equal(refFilterMatches(['v1?.0'], 'v11.0'), false);
  });
  test('a later `!` pattern excludes, and order matters', () => {
    assert.equal(refFilterMatches(['*-v*', '!core-v*'], 'core-v1.0.0'), false);
    assert.equal(refFilterMatches(['!core-v*', '*-v*'], 'core-v1.0.0'), true);
    assert.equal(refFilterMatches(['!core-v*'], 'fullshot-v1.0.0'), false);
  });
  test('a pattern it cannot read is refused, not guessed', () => {
    for (const bad of ['', '+x', 'a[0-9', 'a[%]', 'a\\']) {
      assert.throws(() => refFilterToRegExp(bad), undefined, `"${bad}" must throw`);
    }
  });
});

describe('the real tree', () => {
  test('--check is green', () => {
    const r = run(['--root', REPO]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /each tag owned once/);
  });

  test("each product's tag has exactly one owner, through the trigger AND the job gate", () => {
    const d = derive(REPO);
    assert.deepEqual(d.lost, []);
    const lanes = [...d.lanes.keys()].sort();
    assert.deepEqual(lanes, [APP_LANE, EXT_LANE], 'the registers derive one lane per released kind');
    const actual = tagTriggeredWorkflows(REPO);
    let fed = 0;
    for (const p of d.products) {
      for (const v of TAG_SHAPES[p.kind].samples) {
        const tag = `${p.slug}-v${v}`;
        const want = d.kindLane.get(p.kind);
        assert.deepEqual(actualOwners(actual, tag), [want], `trigger owners of ${tag}`);
        const passed = lanes.filter((lane) => run(['--root', REPO, '--lane', lane, '--tag', tag]).code === 0);
        assert.deepEqual(passed, [want], `job gates that pass ${tag}`);
        fed += 1;
      }
    }
    assert.ok(fed >= 4, `only ${fed} tag(s) were fed; the product registers went quiet`);
  });

  test('a tag no register names (core-v*) is owned by no trigger and refused by both gates', () => {
    assert.deepEqual(actualOwners(tagTriggeredWorkflows(REPO), 'core-v1.0.0'), []);
    for (const lane of [APP_LANE, EXT_LANE]) {
      const r = run(['--root', REPO, '--lane', lane, '--tag', 'core-v1.0.0']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /is no product's tag/);
    }
  });

  test("one lane's tag is refused by the other lane's gate, by name", () => {
    const r = run(['--root', REPO, '--lane', EXT_LANE, '--tag', 'subscriptiontracker-v1.0.0']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /belongs to \.github\/workflows\/build-platforms\.yml, not to \.github\/workflows\/extensions\.yml/);
  });

  test('the untagged ref a non-tag run synthesises passes: it names no product', () => {
    const r = run(['--root', REPO, '--lane', APP_LANE, '--tag', 'subscriptiontracker-untagged-0123abc']);
    assert.equal(r.code, 0, r.out);
  });

  test('--write reproduces the committed filters byte for byte', () => {
    const root = fixture();
    const before = [APP_LANE, EXT_LANE].map((rel) => readFileSync(join(root, rel), 'utf8'));
    const r = run(['--root', root, '--write']);
    assert.equal(r.code, 0, r.out);
    const after = [APP_LANE, EXT_LANE].map((rel) => readFileSync(join(root, rel), 'utf8'));
    assert.deepEqual(after, before, 'the committed tags: lists are not what the registers generate');
  });
});

describe('red controls, each on a fixture copy', () => {
  test("widening the extension lane back to '*-v*' makes an app tag start two releases", () => {
    const root = fixture([{ file: EXT_LANE, from: "- 'fullshot-v[0-9]+.[0-9]+.[0-9]+'\n", to: "- '*-v*'\n" }]);
    assert.deepEqual(actualOwners(tagTriggeredWorkflows(root), 'subscriptiontracker-v1.0.0').sort(), [APP_LANE, EXT_LANE]);
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /two lanes own subscriptiontracker-v1\.0\.0/);
  });

  test('a product added to a register without regenerating reaches no lane', () => {
    const root = fixture([{ file: 'catalog/apps.json', json: (rows) => [...rows, { slug: 'newapp', status: 'preview' }] }]);
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /newapp-v1\.0\.0 reaches no lane \(the registers give it to \.github\/workflows\/build-platforms\.yml\)/);
    assert.match(r.out, /Run `node tooling\/ci\/tag-owner\.mjs --write`/);
  });

  test('an app channel stamped into the extension lane is caught (RELEASE_CHANNEL=apps-gov-in)', () => {
    const root = fixture([
      { file: EXT_LANE, from: '      - name: This lane owns the tag\n', to: '      - name: Stray\n        run: echo "RELEASE_CHANNEL=apps-gov-in" >> "$GITHUB_ENV"\n      - name: This lane owns the tag\n' },
    ]);
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /stamps channel "apps-gov-in" \(surface "app"\) in the release lane of extension/);
  });

  test('a lane without its job gate is caught', () => {
    const root = fixture([{ file: APP_LANE, from: 'tag-owner.mjs --lane .github/workflows/build-platforms.yml', to: 'tag-owner.mjs --lane-was-removed' }]);
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /build-platforms\.yml carries no job gate/);
  });

  test('a tree with no registers is COVERAGE LOST, never green', () => {
    const empty = join(scratch, 'empty');
    mkdirSync(empty, { recursive: true });
    const r = run(['--root', empty]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tag-owner:/);
  });
});

// release-manifest.mjs `--stage` asks this which kind of ref it was handed: it
// refuses a native installer that cannot sign in on a release ref and only warns
// on an untagged one (O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN). One case per kind.
describe('releaseTagOf — the kind of ref a release run was handed', () => {
  test('the untagged ref a non-tag run synthesises is `untagged`, with its app slug', () => {
    assert.deepEqual(releaseTagOf('subscriptiontracker-untagged-0123abc'), {
      kind: 'untagged',
      slug: 'subscriptiontracker',
      version: null,
    });
  });

  test('`<slug>-v<version>` is `release`, split at the last `-v`', () => {
    assert.deepEqual(releaseTagOf('subscriptiontracker-v1.0.0'), { kind: 'release', slug: 'subscriptiontracker', version: '1.0.0' });
  });

  test('a ref with neither shape is `invalid`, which a release gate treats as a release', () => {
    assert.deepEqual(releaseTagOf('subscriptiontracker'), { kind: 'invalid', slug: null, version: null });
  });
});
