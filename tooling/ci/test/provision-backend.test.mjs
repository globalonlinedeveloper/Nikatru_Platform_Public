// ─────────────────────────────────────────────────────────────────────────────
// provision-backend.test.mjs — tooling/scripts/provision-backend.mjs must be
// able to FAIL.
//
// [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/plans/03-stamper-plan.md after the pipeline harvest was frozen) This script had NEITHER of the two properties F-10 requires.
// Nothing ran it (`grep -rn provision-backend .github/` -> 0) and nothing tested
// it, because it lives under tooling/scripts/ rather than tooling/ci/ and so sat
// outside assert-guard-coverage.mjs's subject set entirely. It is not a guard —
// it is the one command the stamp's own checklist tells the owner to run — and
// the repo's precedent for exactly that is three lines up in ci.yml, where the
// four release scripts are dry-run exercised on every push.
//
// WHAT IS BEING PROTECTED. The riskiest thing in the script is its config
// surgery: a regex that rewrites a uuid inside the stamped wrangler.jsonc,
// scoped so that PLATFORM_DB — SHARED by the whole portfolio, bound in the very
// same d1_databases array — is never the one rewritten. A brick template edit
// (renaming the binding, reordering the array, growing the block past the
// 400-character window) breaks that scoping silently, and the consequence lands
// on a live database.
//
// ⚠️ `--dry` COULD NOT BE THE EXERCISE, which is why `--self-check` exists:
// --dry dies at the credential gate without CLOUDFLARE_API_TOKEN, then runs
// `npm install` and calls `wrangler d1 info` before stopping. In CI that fails
// for people without a secret rather than for defects. The two tests at the
// bottom pin that distinction so a future "simplification" cannot quietly point
// the CI step back at --dry.
//
// Every case builds a fake stamped service in a temp dir and runs the REAL
// script against it with cwd set there. The five mutations below were each first
// proven against the real worktree's stamped services/probeapi-api/wrangler.jsonc
// (restore byte-verified) before being written here — a fixture I wrote encodes
// the same misunderstanding as the code I wrote.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(CI_DIR, '..', 'scripts', 'provision-backend.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-prov-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ID = '9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351';

/** The stamped shape, comments and all — the comments matter, because a check
 *  that grepped instead of parsing would read them. APP_DB first, as the brick
 *  template writes it. */
const goodConfig = (appId) => `{
  // A stamped backend Worker.
  "name": "${appId}-api",
  "d1_databases": [
    {
      // PER-APP. The only resource this Worker owns outright.
      "binding": "APP_DB",
      "database_name": "${appId}_db",
      "database_id": "${PLACEHOLDER}",
      "migrations_dir": "migrations"
    },
    {
      // SHARED across the portfolio — never rewritten by the provisioner.
      "binding": "PLATFORM_DB",
      "database_name": "platform_db",
      "database_id": "${PLATFORM_ID}"
    }
  ]
}
`;

function tree(appId, { config = goodConfig(appId) } = {}) {
  const root = join(TMP, `r${seq++}`);
  const p = join(root, 'services', `${appId}-api`, 'wrangler.jsonc');
  mkdirSync(dirname(p), { recursive: true });
  if (config !== null) writeFileSync(p, config);
  else mkdirSync(dirname(p), { recursive: true });
  return root;
}

/** Runs the real script with the credentials DELIBERATELY stripped from the
 *  environment. If --self-check ever starts needing them, these tests go red —
 *  which is the property the CI step depends on. */
const run = (root, ...args) => {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('[S-12r] --self-check exercises the config surgery, offline', () => {
  test('the stamped shape passes, with no credentials in the environment', () => {
    const { code, out } = run(tree('probeapi'), 'probeapi', '--self-check');
    assert.equal(code, 0, out);
    assert.match(out, /the patch rewrites APP_DB\.database_id/);
    assert.match(out, /PLATFORM_DB\.database_id is untouched/);
    assert.match(out, /No token, no install, no network, no writes/);
  });

  // 🔴 P-A — the brick renames the binding. The script targets it BY NAME, so a
  // template rename leaves the live run patching nothing.
  test('FAILS when the APP_DB binding is renamed', () => {
    const root = tree('probeapi', {
      config: goodConfig('probeapi').replace('"binding": "APP_DB"', '"binding": "APPDB"'),
    });
    const { code, out } = run(root, 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no d1_databases entry is bound as "APP_DB"/);
  });

  // 🔴 P-B — THE ONE THE SCOPING EXISTS FOR. Reordering the array alone is
  // harmless (the regex anchors on the binding name); reordering it while the
  // pattern is broadened is how the SHARED binding gets rewritten. Proven
  // against the real tree by broadening APP_DB_BLOCK to `"[A-Z_]*DB"` and
  // putting PLATFORM_DB first.
  test('FAILS when the APP_DB entry loses its database_id, so the patch would hit PLATFORM_DB', () => {
    // APP_DB declares no database_id of its own, so the scoped regex runs on
    // past it and captures PLATFORM_DB's instead. It still MATCHES — it just
    // matches the wrong thing, which is the failure a bare "did the regex match"
    // check cannot see.
    const config = `{
  "name": "probeapi-api",
  "d1_databases": [
    {
      "binding": "APP_DB",
      "database_name": "probeapi_db",
      "migrations_dir": "migrations"
    },
    {
      "binding": "PLATFORM_DB",
      "database_name": "platform_db",
      "database_id": "${PLATFORM_ID}"
    }
  ]
}
`;
    const { code, out } = run(tree('probeapi', { config }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /the APP_DB entry declares no `database_id`/);
    // The decisive half: it names the SHARED binding's id as what the live run
    // would have overwritten. Reporting only "something is missing" would send a
    // reader looking for a rename that never happened.
    assert.match(out, new RegExp(`the live run would have captured "${PLATFORM_ID}"`));
  });

  // 🔴 P-C — the 400-character window is the scoping. Grow the block past it and
  // the live run dies at step 1 for every newly stamped backend app.
  test('FAILS when the APP_DB block outgrows the scoping window', () => {
    const root = tree('probeapi', {
      config: goodConfig('probeapi').replace(
        '"binding": "APP_DB",',
        `"binding": "APP_DB",\n      "//pad": "${'x'.repeat(420)}",`,
      ),
    });
    const { code, out } = run(root, 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /APP_DB_BLOCK did not match the stamped config/);
  });

  // 🔴 P-D — without PLATFORM_DB present, "the shared binding was not rewritten"
  // is true because there was nothing to rewrite. That is an assertion that
  // cannot fail, which this repo treats as worse than none.
  test('FAILS when PLATFORM_DB is absent, rather than passing by its absence', () => {
    const config = `{
  "name": "probeapi-api",
  "d1_databases": [
    {
      "binding": "APP_DB",
      "database_name": "probeapi_db",
      "database_id": "${PLACEHOLDER}",
      "migrations_dir": "migrations"
    }
  ]
}
`;
    const { code, out } = run(tree('probeapi', { config }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no d1_databases entry is bound as "PLATFORM_DB"/);
    assert.match(out, /proven by\s+its absence rather than by the scoping/);
  });

  test('FAILS when the stamped config is not parseable JSONC', () => {
    const { code, out } = run(tree('probeapi', { config: '{ not json' }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /is not parseable JSONC/);
  });

  test('FAILS when there is no stamped backend at all', () => {
    const { code, out } = run(tree('probeapi', { config: null }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no stamped backend at/);
  });

  // ── the boundary that makes this mode usable in CI at all ─────────────────
  // If --self-check ever starts reaching the credential gate, the CI step
  // becomes a secret check that fails on every fork PR. These two pin the split.
  test('--self-check never reaches the credential gate', () => {
    const { out } = run(tree('probeapi'), 'probeapi', '--self-check');
    assert.doesNotMatch(out, /CLOUDFLARE_API_TOKEN is not set/);
  });

  test('--dry, by contrast, DOES demand credentials — which is why it is not the CI exercise', () => {
    const { code, out } = run(tree('probeapi'), 'probeapi', '--dry');
    assert.equal(code, 1, out);
    assert.match(out, /CLOUDFLARE_API_TOKEN is not set/);
  });
});
