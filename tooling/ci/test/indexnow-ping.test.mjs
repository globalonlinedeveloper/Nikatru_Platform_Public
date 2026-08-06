// ─────────────────────────────────────────────────────────────────────────────
// indexnow-ping.test.mjs — tooling/sites/indexnow-ping.mjs must fail on every
// input W-3's own research note said the first version of this step would sail
// past.
//
// [pipeline 12]W-3 "a deploy that changes them announces itself (IndexNow ping
// from CI)" · [12]W-3e (the key file, owner-gated).
//
// 🔴 NOT ONE CASE HERE SENDS A REQUEST. The script only touches the network
// under an explicit `--ping`, and no test passes it. That is not test hygiene,
// it is the design: a mis-wired workflow that forgets the flag must print what
// it would have sent and exit 0 rather than quietly start talking to a third
// party. The dry-run payload is therefore the subject under test, and it is the
// same object the real call would carry.
//
// The four defects these pin, from W-3's recorded "CANNOT-FAIL #1":
//   · a ping with NO KEY is answered 202 — "key unverified", indistinguishable
//     from success — so a keyless host would be congratulated forever;
//   · a key FILE whose body is not the key fails verification at the far end,
//     where nothing in this repo can see it, and gets another 202;
//   · "fires on change" is a property of a CONDITION the criterion never named,
//     so change is a computed diff of the artifact, not a workflow path filter;
//   · anything other than 200/202 is a failure.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { changedUrls, sitemapMap, KEY_FILE_RE } from '../../sites/indexnow-ping.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'sites', 'indexnow-ping.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-indexnow-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const KEY = 'a1b2c3d4e5f60718';
const sitemap = (entries) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n' +
  entries.map(([loc, lm]) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lm}</lastmod>\n  </url>\n`).join('') +
  '</urlset>\n';

const BASE = sitemap([
  ['https://nikatru.com/', '2026-08-04'],
  ['https://nikatru.com/privacy.html', '2026-08-04'],
]);

const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

/** A real git repository, because the whole "did it change?" question is a diff
 *  against a ref. A fixture that faked git would be testing the fake. */
function repo(initial = BASE) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'sites', 'nikatru'), { recursive: true });
  writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), initial);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  return root;
}

const run = (root, ...extra) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', root, '--root', 'sites/nikatru', ...extra], {
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('what counts as a change', () => {
  test('sitemapMap pairs each <loc> with its OWN <lastmod>, never by order', () => {
    const m = sitemapMap(sitemap([['https://a.test/', '2026-01-01']]).replace('<lastmod>2026-01-01</lastmod>', ''));
    assert.equal(m.get('https://a.test/'), null);
  });

  test('an unchanged sitemap yields no URLs — a push touching an unrelated file must not ping', () => {
    assert.deepEqual(changedUrls(BASE, BASE), []);
  });

  test('a moved lastmod and a brand-new loc both count', () => {
    const after = sitemap([
      ['https://nikatru.com/', '2026-08-06'],
      ['https://nikatru.com/privacy.html', '2026-08-04'],
      ['https://nikatru.com/apps/', '2026-08-06'],
    ]);
    assert.deepEqual(changedUrls(BASE, after), ['https://nikatru.com/', 'https://nikatru.com/apps/']);
  });

  test('🔴 a REMOVED url is not submitted — that is a 404 we would be volunteering for', () => {
    const after = sitemap([['https://nikatru.com/', '2026-08-04']]);
    assert.deepEqual(changedUrls(BASE, after), []);
  });

  test('the key-file shape is matched by SHAPE, never by a name committed here', () => {
    assert.match(`${KEY}.txt`, KEY_FILE_RE);
    assert.doesNotMatch('indexnow.txt', KEY_FILE_RE);
    assert.doesNotMatch(`${KEY}.html`, KEY_FILE_RE);
  });
});

describe('the ping refuses everything it cannot verify', () => {
  test('🔴 unchanged against the base ref exits 0 WITHOUT looking for a key', () => {
    // Ordering matters: if the key check came first, every push to an unrelated
    // file would fail the lane on owner-gated work while having nothing to say.
    const root = repo();
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 0, out);
    assert.match(out, /nothing to announce, so nothing was sent/);
  });

  test('🔴 changed + NO KEY exits 1, naming the owner item and the waiting URLs', () => {
    const root = repo();
    writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), sitemap([['https://nikatru.com/', '2026-08-06']]));
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 1);
    assert.match(out, /INDEXNOW KEY ABSENT/);
    assert.match(out, /OWNER_QUEUE A-11/);
    assert.match(out, /https:\/\/nikatru\.com\//);
  });

  test('🔴 a key file that does not contain its own key exits 1 — it fails at the far end otherwise', () => {
    const root = repo();
    writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), sitemap([['https://nikatru.com/', '2026-08-06']]));
    writeFileSync(join(root, 'sites', 'nikatru', `${KEY}.txt`), 'not-the-key\n');
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 1);
    assert.match(out, /does not contain its own key/);
  });

  test('two key files exit 1 — a ping carries exactly one key', () => {
    const root = repo();
    writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), sitemap([['https://nikatru.com/', '2026-08-06']]));
    writeFileSync(join(root, 'sites', 'nikatru', `${KEY}.txt`), KEY);
    writeFileSync(join(root, 'sites', 'nikatru', 'deadbeefcafe0011.txt'), 'deadbeefcafe0011');
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 1);
    assert.match(out, /ships 2 IndexNow key files/);
  });

  test('a correct key + a real change produces the payload, and STILL sends nothing without --ping', () => {
    const root = repo();
    writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), sitemap([['https://nikatru.com/', '2026-08-06']]));
    writeFileSync(join(root, 'sites', 'nikatru', `${KEY}.txt`), `${KEY}\n`);
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN \(pass --ping to send\)/);
    const payload = JSON.parse(out.slice(out.indexOf('{')));
    assert.equal(payload.host, 'nikatru.com');
    assert.equal(payload.key, KEY);
    assert.equal(payload.keyLocation, `https://nikatru.com/${KEY}.txt`);
    assert.deepEqual(payload.urlList, ['https://nikatru.com/']);
  });

  test('a deploy root with no sitemap exits 1 rather than announcing an empty set', () => {
    const root = repo();
    unlinkSync(join(root, 'sites', 'nikatru', 'sitemap.xml'));
    const { code, out } = run(root, '--base', 'HEAD');
    assert.equal(code, 1);
    assert.match(out, /does not exist, so there is nothing to announce/);
  });
});
