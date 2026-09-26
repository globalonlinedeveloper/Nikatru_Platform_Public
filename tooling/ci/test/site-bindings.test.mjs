// ─────────────────────────────────────────────────────────────────────────────
// site-bindings.test.mjs — assert-site-bindings.mjs: the apex site's Pages bindings
// agree across README.md's table, wrangler.jsonc, the Functions' `env.*` reads and
// deploy-web.yml (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE, D3a).
//
// The fixtures are COPIES OF THE SHIPPING FILES (the README, tooling/sites/nikatru-apex/
// wrangler.jsonc, the Functions and services/platform/wrangler.jsonc), each case mutating one of them,
// so a case fails for the reason it names and not because a hand-written fixture
// disagrees with the tree. The workflow is the one thing written here: the job's
// fill into its staged copy, its `pages secret put` and its `pages deploy .` from that copy,
// so these cases do not move when deploy-web.yml's other jobs do. The first case runs the guard on the real tree.
//
// Red control RC4: tooling/sites/nikatru-apex/wrangler.jsonc without its `d1_databases` entry → exit 1.
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/site-bindings.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { envReads, parseBindingsTable, parseConfig, KV_ID_PLACEHOLDER, CoverageLost } from '../assert-site-bindings.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-site-bindings.mjs');
const CONFIG = 'tooling/sites/nikatru-apex/wrangler.jsonc';
const WORKFLOW =
  'jobs:\n  site:\n    steps:\n' +
  '      - run: node tooling/ci/assert-site-bindings.mjs --fill-kv-id --out build/nikatru-apex\n' +
  "      - run: printf '%s' \"$S\" | wrangler pages secret put SUBSCRIBE_RATE_LIMIT_SALT --project-name nikatru-apex\n" +
  '      - with:\n          workingDirectory: build/nikatru-apex\n          command: pages deploy . --project-name=nikatru-apex --branch=main\n';
const KV = '0123456789abcdef0123456789abcdef';
/** The shipping file's whole `d1_databases` member, comments included. */
const D1_BLOCK = /  "d1_databases": \[[\s\S]*?\n  \],\n/;

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-site-bindings-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A fixture root holding copies of the shipping files, then `mutate(root)` applied. */
function fixture(mutate = () => {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'sites', 'nikatru'), { recursive: true });
  mkdirSync(join(root, 'services', 'platform'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  cpSync(join(ROOT, 'sites', 'nikatru', 'README.md'), join(root, 'sites', 'nikatru', 'README.md'));
  mkdirSync(join(root, 'tooling', 'sites', 'nikatru-apex'), { recursive: true });
  cpSync(join(ROOT, ...CONFIG.split('/')), join(root, ...CONFIG.split('/')));
  cpSync(join(ROOT, 'sites', 'nikatru', 'functions'), join(root, 'sites', 'nikatru', 'functions'), { recursive: true });
  cpSync(join(ROOT, 'services', 'platform', 'wrangler.jsonc'), join(root, 'services', 'platform', 'wrangler.jsonc'));
  writeFileSync(join(root, '.github', 'workflows', 'deploy-web.yml'), WORKFLOW);
  mutate(root);
  return root;
}
const edit = (root, rel, fn) => {
  const p = join(root, ...rel.split('/'));
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `the mutation of ${rel} changed nothing: its seam is not in the shipping file`);
  writeFileSync(p, after);
};
function run(args, env = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', env: { ...process.env, NIKATRU_SIGNUPS_KV_ID: '', ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-site-bindings — the shipping tree', () => {
  test('the real tree grades clean (exit 0)', () => {
    const r = run([]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /3 binding row\(s\)/);
  });
});

describe('assert-site-bindings — copies of the shipping files', () => {
  test('green control: the copies with the two workflow lines → exit 0', () => {
    const r = run(['--root', fixture()]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /declares D1 PLATFORM_DB, KV SIGNUPS/);
  });

  test('RC4: wrangler.jsonc without the D1 binding → exit 1, naming PLATFORM_DB', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace(D1_BLOCK, '')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names D1 `PLATFORM_DB` → `platform_db` and tooling\/sites\/nikatru-apex\/wrangler\.jsonc declares no d1_databases binding `PLATFORM_DB`/);
  });

  test('a D1 id that is not the id services/ declares for platform_db → exit 1', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace(/"database_id": "[^"]+"/, '"database_id": "00000000-0000-4000-8000-000000000000"')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`PLATFORM_DB` has database_id "00000000-0000-4000-8000-000000000000"/);
  });

  test('a literal KV id committed in place of the placeholder → exit 1', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace(`"${KV_ID_PLACEHOLDER}"`, `"${KV}"`)));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`SIGNUPS` has id "0123456789abcdef0123456789abcdef"; the committed value is the placeholder/);
  });

  test('the salt written into wrangler.jsonc as a var → exit 1, twice over', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace('  "name": "nikatru-apex",\n', '  "name": "nikatru-apex",\n  "vars": { "SUBSCRIBE_RATE_LIMIT_SALT": "x" },\n')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names the secret `SUBSCRIBE_RATE_LIMIT_SALT` outside a comment/);
    assert.match(r.out, /top-level `vars` is not one of/);
  });

  test('the salt named only in a wrangler.jsonc COMMENT is not a finding → exit 0', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace('  "name": "nikatru-apex",\n', '  // SUBSCRIBE_RATE_LIMIT_SALT is put by the job\n  "name": "nikatru-apex",\n')));
    const r = run(['--root', root]);
    assert.equal(r.code, 0, r.out);
  });

  test('a Function that reads a binding the table does not name → exit 1, naming it', () => {
    const root = fixture((d) => edit(d, 'sites/nikatru/functions/api/subscribe.js', (t) => `${t}\nexport const probe = (env) => env.LAUNCH_FLAGS;\n`));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reads `env\.LAUNCH_FLAGS` and the table in sites\/nikatru\/README\.md has no row for it/);
  });

  test('a binding named only in a Function COMMENT is not a read → exit 0', () => {
    const root = fixture((d) => edit(d, 'sites/nikatru/functions/api/subscribe.js', (t) => `${t}\n// env.LAUNCH_FLAGS arrives in D3b\n`));
    const r = run(['--root', root]);
    assert.equal(r.code, 0, r.out);
  });

  test('a table row no Function reads, and wrangler.jsonc lacks → exit 1', () => {
    const root = fixture((d) => edit(d, 'sites/nikatru/README.md', (t) => t.replace('| KV | `SIGNUPS` | `nikatru-signups` |\n', '| KV | `SIGNUPS` | `nikatru-signups` |\n| KV | `CACHE` | `nikatru-cache` |\n')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`CACHE` has a row and no Function reads `env\.CACHE`/);
    assert.match(r.out, /names KV `CACHE` → `nikatru-cache` and tooling\/sites\/nikatru-apex\/wrangler\.jsonc declares no kv_namespaces binding `CACHE`/);
  });

  test('a binding in wrangler.jsonc the table has no row for → exit 1', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace('  "kv_namespaces": [\n', `  "kv_namespaces": [\n    { "binding": "CACHE", "id": "${KV}" },\n`)));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /KV binding `CACHE` has no KV row/);
  });

  test('a workflow that never puts the salt on the project → exit 1', () => {
    const root = fixture((d) => edit(d, '.github/workflows/deploy-web.yml', (t) => t.replace('pages secret put SUBSCRIBE_RATE_LIMIT_SALT', 'pages secret list')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /runs no `wrangler pages secret put SUBSCRIBE_RATE_LIMIT_SALT`/);
  });

  test('a secret put that survives only in a workflow COMMENT → exit 1', () => {
    const root = fixture((d) => edit(d, '.github/workflows/deploy-web.yml', (t) => t.replace("      - run: printf '%s' \"$S\" | wrangler pages secret put", '      # - run: pages secret put')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /runs no `wrangler pages secret put SUBSCRIBE_RATE_LIMIT_SALT`/);
  });

  test('a job that deploys another project than wrangler.jsonc names → exit 1', () => {
    const root = fixture((d) => edit(d, '.github/workflows/deploy-web.yml', (t) => t.replace('pages deploy . --project-name=nikatru-apex', 'pages deploy . --project-name=nikatru')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names project "nikatru-apex" and \.github\/workflows\/deploy-web\.yml deploys to "nikatru"/);
  });

  test('pages_build_output_dir other than "." → exit 1', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace('"pages_build_output_dir": "."', '"pages_build_output_dir": "public"')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /pages_build_output_dir is "public", not "\."/);
  });
});

describe('assert-site-bindings — COVERAGE LOST (exit 2)', () => {
  test('the README has no bindings table → exit 2', () => {
    const root = fixture((d) => edit(d, 'sites/nikatru/README.md', (t) => t.replace('| kind | binding | target |', '| what | name | where |')));
    const r = run(['--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /^✗ COVERAGE LOST — sites\/nikatru\/README\.md has no `\| kind \| binding \| target \|` table/m);
  });

  test('a wrangler.jsonc that does not parse → exit 2', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace('  "name": "nikatru-apex",\n', '  "name": nikatru-apex,\n')));
    const r = run(['--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/sites\/nikatru-apex\/wrangler\.jsonc does not parse as JSONC/);
  });

  test('Functions that read no binding at all → exit 2', () => {
    const root = fixture((d) => {
      rmSync(join(d, 'sites', 'nikatru', 'functions'), { recursive: true });
      mkdirSync(join(d, 'sites', 'nikatru', 'functions'));
      writeFileSync(join(d, 'sites', 'nikatru', 'functions', 'x.js'), 'export const onRequest = ({ next }) => next();\n');
    });
    const r = run(['--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /read no `env\.\*` binding/);
  });

  test('no wrangler.jsonc on disk → exit 2', () => {
    const root = fixture((d) => rmSync(join(d, ...CONFIG.split('/'))));
    const r = run(['--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /tooling\/sites\/nikatru-apex\/wrangler\.jsonc is not on disk/);
  });
});

describe('assert-site-bindings — the config never sits in the Git-connected root, and reaches the deploy', () => {
  test('🔴 a wrangler.jsonc in sites/nikatru → exit 1: it would reconfigure the live project', () => {
    const root = fixture((d) => cpSync(join(d, ...CONFIG.split('/')), join(d, 'sites', 'nikatru', 'wrangler.jsonc')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sites\/nikatru\/wrangler\.jsonc exists\. sites\/nikatru is the ROOT of the Git-connected Pages project `nikatru`/);
  });

  test('a wrangler.toml in sites/nikatru → exit 1 as well', () => {
    const root = fixture((d) => writeFileSync(join(d, 'sites', 'nikatru', 'wrangler.toml'), 'name = "nikatru"\n'));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sites\/nikatru\/wrangler\.toml exists/);
  });

  test('a job that never fills the config into a staged copy → exit 1', () => {
    const root = fixture((d) => edit(d, '.github/workflows/deploy-web.yml', (t) => t.replace('      - run: node tooling/ci/assert-site-bindings.mjs --fill-kv-id --out build/nikatru-apex\n', '')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /runs no `assert-site-bindings\.mjs --fill-kv-id --out <dir>`/);
  });

  test('a deploy that runs from another directory than the filled copy → exit 1', () => {
    const root = fixture((d) => edit(d, '.github/workflows/deploy-web.yml', (t) => t.replace('workingDirectory: build/nikatru-apex', 'workingDirectory: sites/nikatru')));
    const r = run(['--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /fills the config into build\/nikatru-apex and no deploy step has `workingDirectory: build\/nikatru-apex`/);
  });
});

/** A staged copy of the site under the fixture root, as the job's staging step makes it. */
const stage = (root) => {
  const out = join(root, 'build', 'nikatru-apex');
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'sites', 'nikatru'), out, { recursive: true });
  return out;
};

describe('assert-site-bindings --fill-kv-id --out — the deploy job fills the owner\'s id into its staged copy', () => {
  test('a 32-hex NIKATRU_SIGNUPS_KV_ID lands in <out>/wrangler.jsonc → exit 0; the committed file is untouched, and the value is not printed', () => {
    const root = fixture();
    const out = stage(root);
    const committed = readFileSync(join(root, ...CONFIG.split('/')), 'utf8');
    const r = run(['--fill-kv-id', '--out', 'build/nikatru-apex', '--root', root], { NIKATRU_SIGNUPS_KV_ID: KV });
    assert.equal(r.code, 0, r.out);
    const filled = readFileSync(join(out, 'wrangler.jsonc'), 'utf8');
    assert.equal(parseConfig(filled).kv_namespaces[0].id, KV);
    assert.ok(!filled.includes(KV_ID_PLACEHOLDER));
    assert.equal(readFileSync(join(root, ...CONFIG.split('/')), 'utf8'), committed);
    assert.ok(!r.out.includes(KV), 'the id was printed');
    assert.match(r.out, /filled from NIKATRU_SIGNUPS_KV_ID \(32 hex characters\)/);
  });

  test('--fill-kv-id with no --out → exit 2, and nothing is written anywhere', () => {
    const root = fixture();
    const committed = readFileSync(join(root, ...CONFIG.split('/')), 'utf8');
    const r = run(['--fill-kv-id', '--root', root], { NIKATRU_SIGNUPS_KV_ID: KV });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /--fill-kv-id was given with no --out/);
    assert.equal(readFileSync(join(root, ...CONFIG.split('/')), 'utf8'), committed);
  });

  test('NIKATRU_SIGNUPS_KV_ID unset → exit 1, and no config is written into the staged copy', () => {
    const root = fixture();
    const out = stage(root);
    const r = run(['--fill-kv-id', '--out', 'build/nikatru-apex', '--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NIKATRU_SIGNUPS_KV_ID is empty or unset/);
    assert.ok(!existsSync(join(out, 'wrangler.jsonc')));
  });

  test('a value that is not a namespace id → exit 1, naming its length and not its bytes', () => {
    const root = fixture();
    stage(root);
    const r = run(['--fill-kv-id', '--out', 'build/nikatru-apex', '--root', root], { NIKATRU_SIGNUPS_KV_ID: 'nikatru-signups' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /not a 32-hex KV namespace id \(15 characters\)/);
  });

  test('an --out that is not a staged copy of the site (no functions/) → exit 1', () => {
    const root = fixture();
    mkdirSync(join(root, 'build', 'empty'), { recursive: true });
    const r = run(['--fill-kv-id', '--out', 'build/empty', '--root', root], { NIKATRU_SIGNUPS_KV_ID: KV });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /holds no functions\/ directory/);
    assert.ok(!existsSync(join(root, 'build', 'empty', 'wrangler.jsonc')));
  });

  test('a committed file that already fails grades before any fill → exit 1, nothing written', () => {
    const root = fixture((d) => edit(d, CONFIG, (t) => t.replace(D1_BLOCK, '')));
    const out = stage(root);
    const r = run(['--fill-kv-id', '--out', 'build/nikatru-apex', '--root', root], { NIKATRU_SIGNUPS_KV_ID: KV });
    assert.equal(r.code, 1, r.out);
    assert.ok(!existsSync(join(out, 'wrangler.jsonc')));
  });
});

describe('assert-site-bindings — the pure parts', () => {
  test('envReads: dot and bracket reads count, a comment does not', () => {
    assert.deepEqual([...envReads('// env.NOPE\nconst a = env.PLATFORM_DB; const b = env["SIGNUPS"];\n')].sort(), ['PLATFORM_DB', 'SIGNUPS']);
  });

  test('parseBindingsTable: backticked binding and target, a target with no backticks is null', () => {
    const rows = parseBindingsTable('x\n| kind | binding | target |\n|---|---|---|\n| D1 | `A` | `a_db` |\n| secret | `S` | a key |\n\nafter\n');
    assert.deepEqual(rows, [
      { kind: 'D1', binding: 'A', target: 'a_db' },
      { kind: 'secret', binding: 'S', target: null },
    ]);
  });

  test('parseConfig: a `//` inside a string value is not a comment; broken JSONC throws CoverageLost', () => {
    assert.deepEqual(parseConfig('{\n  // c\n  "u": "https://x.invalid", // t\n}\n'), { u: 'https://x.invalid' });
    assert.throws(() => parseConfig('{ "a": }'), CoverageLost);
  });
});
