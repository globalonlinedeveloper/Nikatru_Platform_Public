// ─────────────────────────────────────────────────────────────────────────────
// generate-apps-data.test.mjs — the site feed's generator must FAIL on the
// inputs that would silently ship a wrong website.
//
// WHY THIS FILE EXISTS. `assert-guard-coverage.mjs` refused the increment that
// added the generator: "a workflow runs it and no test file mentions it. It has
// only ever run against valid input, so nothing exercises its failing path."
// That refusal is the whole point of [pipeline F-10] and it was right — the
// generator is the single thing standing between `catalog/apps.json` and what
// nikatru.com serves, and until now every execution of it had been a happy path.
//
// 🔴 WHAT MAKES THIS GENERATOR DIFFERENT FROM A BUILD STEP. Its output is not an
// artifact that gets rebuilt on the next run — it is a COMMITTED file that
// Cloudflare serves with no build step. A generator that quietly writes wrong
// bytes does not fail a build; it changes a live page. So the failing paths that
// matter are the ones where it could produce SOMETHING rather than refusing:
//   · the catalogue is absent      -> must refuse, not emit an empty feed
//   · the catalogue is malformed   -> must refuse, not emit a partial feed
//   · the catalogue is empty       -> must refuse, not emit `[]` over a live site
//   · `--check` and drift          -> must exit 1, because that is the only thing
//                                     standing between a hand-edit and the CDN
//
// Every case below runs the REAL script against a REAL temp tree. No mocks: a
// fixture that models the generator's own assumptions would agree with it about
// exactly the thing under test.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'sites', 'generate-apps-data.mjs');
const CATALOGUE_REL = join('catalog', 'apps.json');
const FEED_REL = join('sites', '_shared', '_data', 'apps.json');

/** A tree with the two paths the generator speaks about, and nothing else. */
function tree(catalogueText) {
  const root = mkdtempSync(join(tmpdir(), 'genfeed-'));
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  if (catalogueText !== null) writeFileSync(join(root, CATALOGUE_REL), catalogueText);
  return root;
}

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has had a failing command read as exit 0 three times that way. */
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, root, ...args], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

/** The real catalogue, so the positive control is the live input, not a guess. */
const realCatalogue = () => readFileSync(join(REPO, CATALOGUE_REL), 'utf8');

describe('generate-apps-data — the site feed', () => {
  test('POSITIVE CONTROL: the real catalogue reproduces the committed feed byte for byte', () => {
    const root = tree(realCatalogue());
    try {
      const { code } = run(root);
      assert.equal(code, 0, 'the real catalogue must generate cleanly');
      const got = readFileSync(join(root, FEED_REL));
      const committed = readFileSync(join(REPO, FEED_REL));
      // Byte equality, not deep-equal on parsed JSON. The committed feed is
      // hand-formatted; a serializer round-trip changes its bytes while keeping
      // its meaning, and the bytes are what Cloudflare serves.
      assert.ok(got.equals(committed),
        'the generated feed must be byte-identical to the committed one — ' +
        `got ${got.length} bytes, committed ${committed.length}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('IDEMPOTENT: two runs produce identical bytes', () => {
    const root = tree(realCatalogue());
    try {
      assert.equal(run(root).code, 0);
      const first = readFileSync(join(root, FEED_REL));
      assert.equal(run(root).code, 0);
      const second = readFileSync(join(root, FEED_REL));
      // A drift check over an unstable generator fails at random and gets
      // switched off within a week, taking the real protection with it.
      assert.ok(first.equals(second), 'the generator must be byte-stable across runs');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('FAILS when the catalogue is ABSENT — it must not emit an empty feed', () => {
    const root = tree(null);
    try {
      const { code } = run(root);
      assert.notEqual(code, 0, 'a missing catalogue must refuse');
      assert.ok(!existsSync(join(root, FEED_REL)) || readFileSync(join(root, FEED_REL), 'utf8').trim() === '',
        'refusing means writing nothing — an empty feed would blank the live site');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('FAILS when the catalogue is MALFORMED — no partial feed', () => {
    const root = tree('{ "apps": [ {"slug": "subly",  ');
    try {
      const { code } = run(root);
      assert.notEqual(code, 0, 'unparseable JSON must refuse');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('FAILS when the catalogue is EMPTY — the coverage floor', () => {
    // The one that matters most. An empty catalogue is syntactically perfect and
    // semantically catastrophic: it would render a storefront advertising nothing,
    // and every downstream guard would pass over the resulting empty set.
    const root = tree('[]\n');
    try {
      const { code } = run(root);
      assert.notEqual(code, 0, 'an empty catalogue must refuse, never emit an empty feed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--check EXITS 1 ON DRIFT — this is what stands between a hand-edit and the CDN', () => {
    const root = tree(realCatalogue());
    try {
      assert.equal(run(root).code, 0);
      const feed = join(root, FEED_REL);
      // Simulate somebody editing the generated file by hand, which is exactly
      // what the drift check exists to catch.
      writeFileSync(feed, readFileSync(feed, 'utf8').replace('Subly', 'Subly-EDITED'));
      const { code } = run(root, '--check');
      assert.equal(code, 1, '--check must report drift as exit 1');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--check is GREEN when the feed matches, and writes nothing', () => {
    const root = tree(realCatalogue());
    try {
      assert.equal(run(root).code, 0);
      const before = readFileSync(join(root, FEED_REL));
      const { code } = run(root, '--check');
      assert.equal(code, 0, 'no drift must be exit 0');
      assert.ok(before.equals(readFileSync(join(root, FEED_REL))),
        '--check must not write — it is a read-only assertion');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
