// ─────────────────────────────────────────────────────────────────────────────
// cors-allowlist.test.mjs — assert-cors-allowlist.mjs must be able to FAIL.
//
// [4]B-2 (CORS half) + [3]S-11. The Worker allowlists are DERIVED from
// catalog/apps.json; nothing about a new app's origin may depend on
// a human remembering to edit a comma-separated string in two wrangler configs.
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST (2026-08-07, three, against the live repo —
// a fixture you wrote encodes the same misunderstanding as the guard you wrote):
//   N1 a second live app added to the REAL apps.json (drift.nikatru.com), nothing
//      else changed
//        · against the PREVIOUS guard -> BYTE-IDENTICAL output, exit 0. That is
//          the defect: the origins were a hardcoded POLICY literal inside the
//          guard, i.e. still a hand-edited list, merely relocated.
//        · against THIS guard -> exit 1, naming https://drift.nikatru.com.
//   N2 `https://evil.example.com` appended to the REAL services/subscriptiontracker-api
//      ALLOWED_ORIGINS -> exit 1, "NOTHING justifies it".
//   N3 the REAL apps.json emptied to `[]` -> COVERAGE LOST, exit 1.
//   Each mutation was reverted with `git checkout --` and proven byte-identical
//   by `git hash-object` (4c5f555b… for apps.json, b3d38665… for subscriptiontracker-api).
//   `node --check` passes on the guard, so every catch above is an assertion
//   firing and not a parse error.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [ADR 075] — WHAT THIS FILE LOST, AND WHY THE LOSS IS RECORDED HERE RATHER
// THAN QUIETLY EDITED AWAY.
//
// Every app moved from `<id>.nikatru.com` to a PATH on the apex: a catalogue row's
// `url` is now `https://nikatru.com/<slug>`, so EVERY app derives THE SAME browser
// origin. N1 above — the founding negative test of this whole file — can no longer
// be written. A second app's origin is the string the first app already
// contributes, so "missing from the shared Worker" has no input that reds it.
//
// That is not a fixture problem. It is the real consequence the design recorded in
// advance: **CORS stopped being a per-app boundary the day app #2 shipped.** An
// exact allowlist can still say "a browser, at nikatru.com"; it can no longer say
// WHICH app's tab is calling. Two cases below therefore assert something that
// CANNOT HAPPEN, and this repo's rule is that an assertion which cannot fail is
// worse than none. Both were rewritten in place — each carries a comment naming
// what it used to assert and why that became untestable — onto the two properties
// that ARE still falsifiable:
//   · N apps yield exactly ONE derived origin, and a Worker missing THAT origin
//     is still red (the floor survived; only its per-app resolution died);
//   · a per-app Worker without `vars.APP_ID` is red — the token+APP_ID pair is the
//     boundary that REPLACED the per-app origin, and the guard asserts it in the
//     same block as the assertion it replaces.
// And one case was ADDED for the limb that makes the reversal itself reviewable:
// a catalogue row back on a subdomain must go red and name the apex.
//
// ⏱ THE RETIRING SUBDOMAIN HAS NOW LEFT, 2026-09-09. It was deliberately listed in
// both live configs and justified in the guard's EXTRAS for the length of the
// cutover; the note here said "it leaves with the 301". The 301 landed -- measured:
// subly.nikatru.com/, /x, /version.json and a deep path with a query all 301 in one
// hop to a 200 on nikatru.com/subscriptiontracker/ -- so nothing is served there and no browser
// sends that Origin. Config and EXTRAS left together, which is what the case below
// ("dropped from a config but not from EXTRAS") exists to force.
//
// ⏱ 2026-09-27 — THE SCOPE MOVED INTO THE REGISTER (O-SERVICE-KIT-UNBUILT, E-b1).
// The guard's `SERVICE_POLICY` literal is gone: each Worker's scope is its row's
// `cors` field in tooling/platform-register.json, and every Worker's
// src/middleware/cors.ts binds services/_shared/src/cors.ts with that scope. So
// every fixture below also writes a register and a binding per Worker, and the
// cases at the end are the new limbs' inputs: a Worker with no row, a row with no
// scope, and — RC9 — a row whose scope the code does not bind.
//
// Run:  node --test "tooling/ci/test/cors-allowlist.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { APEX_ORIGIN } from '../../sites/apex.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-cors-allowlist.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-cors-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** IMPORTED, never retyped — same rule the guard itself follows. If the apex ever
 *  moves, both sides of every comparison in this file move with it. */
const APEX = new URL(APEX_ORIGIN).origin;

/** The RETIRED pre-rename Pages origin. It left both configs and EXTRAS on
 *  2026-09-11 (the narrow step), so it is no longer in the baseline; it is kept
 *  only as the input for the case that must still red when it is put back. A
 *  *.pages.dev name is claimable by anyone once its project is deleted, which is
 *  why a Worker must stop trusting it BEFORE the project goes. */
const PAGES = 'https://subly-9cp.pages.dev';
/** The Pages project the app deploys to AFTER the slug rename — the only preview
 *  origin in the baseline. deploy-web.yml deploys with
 *  `--project-name=<workspace directory>`, so renaming `apps/subly` moved the
 *  Direct Upload project; Cloudflare minted this subdomain at creation and it was
 *  READ BACK from the API rather than derived, because `<id>.pages.dev` is a
 *  third party's live host here, not a free one. The retired origin left in its
 *  own later change -- an exact allowlist fails CLOSED and silently, so the
 *  order was widen, cut over, then narrow. */
const PAGES_NEW = 'https://subscriptiontracker-7qg.pages.dev';
const LOCAL = 'http://localhost:3000';
/** A second app's Pages preview origin, as render.mjs writes it into the
 *  catalogue row's `origin` from app.yaml `hosts.pagesOrigin`. */
const DRIFT_PAGES = 'https://drift-x1y.pages.dev';
/** The RETIRED app subdomain. It is no longer in either config and no longer in
 *  EXTRAS -- it is kept here only as the input for the two cases that must still
 *  be able to fail: an unjustified origin, and the coupled removal below. */
const SUBDOMAIN = 'https://subly.nikatru.com';

/** Quote a derived string for use inside `new RegExp`. 🔴 EVERY assertion in
 *  this file that names a host builds its pattern through this, and that is not
 *  style: until 2026-09-09 two of them re-spelt the host as an escaped literal,
 *  the slug rename rewrote those escaped copies and left `SUBDOMAIN` alone, and
 *  both controls sat demanding a hostname that exists nowhere. A control that
 *  cannot fail is worse than no control, because it reports clean. */
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The live catalogue row's shape. `origin` is carried by the real apps.json and
 *  is NOT what the guard derives from — the browser origin comes from `url`, i.e.
 *  from the app's PUBLIC ADDRESS, which is now a path on the apex. */
const SUBLY = {
  slug: 'subscriptiontracker',
  name: 'Nikatru Subscription Tracker',
  url: `${APEX}/subscriptiontracker`,
  origin: PAGES_NEW,
  status: 'live',
};

/** The allowlists the real repo carries today (services/platform/wrangler.jsonc
 *  and services/subscriptiontracker-api/wrangler.jsonc, read 2026-09-11), so the baseline
 *  fixture is the live config rather than a convenient invention. The subdomain
 *  left both on 2026-09-09 with the 301; the pre-rename Pages origin (`PAGES`)
 *  left both on 2026-09-11, the narrow step. */
const REAL = {
  platform: `${APEX},${PAGES_NEW},${LOCAL}`,
  'subscriptiontracker-api': `${APEX},${PAGES_NEW}`,
};

/** The scope the real register gives each Worker: `platform` is the shared one. */
const scopeOf = (name) => (name === 'platform' ? 'every-app' : 'own-app');

/** A Worker's src/middleware/cors.ts as the real ones are written: comments, the
 *  two lines that bind the shared module, and one `cors({ … })` call. */
function bindingSource({ scope, appId }) {
  return (
    '// Binds the one CORS middleware. The scope below is what the guard reads.\n' +
    "// (a comment naming scope: 'every-app' must not count)\n" +
    "import { cors } from '../../../_shared/src/cors';\n" +
    "export * from '../../../_shared/src/cors';\n" +
    'export const corsMiddleware = cors({\n' +
    `  scope: '${scope}',\n` +
    (appId === undefined ? '' : `  appId: '${appId}',\n`) +
    "  methods: ['GET', 'OPTIONS'],\n" +
    '});\n'
  );
}

/**
 * Build a throwaway repo. `workers` maps a service directory either to its
 * ALLOWED_ORIGINS string (or `null` to omit the var entirely), or to a
 * `{ allowed, appId }` pair — `appId: null` omits `vars.APP_ID`, which is the
 * only way to write the input that reds the limb that replaced the per-app origin.
 *
 * 🔴 EVERY fixture config is written as REAL JSONC — line comments, a block
 * comment and a trailing comma — because "parse the config, never grep it" is
 * the property under test, not a detail of the fixture.
 */
/*
 * `rows` overrides the register: a service directory maps to the `cors` value
 * of its row (`undefined` writes a row with no `cors`), or to `null` for no row
 * at all. `bindings` overrides a Worker's src/middleware/cors.ts: `{ scope, appId }`
 * for a binding, or `null` for no file. `register: false` writes no register.
 */
function tree({ apps = [SUBLY], workers = REAL, extraComment = '', rows = {}, bindings = {}, register = true } = {}) {
  const root = join(TMP, `r${seq++}`);
  const dataDir = join(root, 'catalog');
  mkdirSync(dataDir, { recursive: true });
  if (apps !== null) writeFileSync(join(dataDir, 'apps.json'), JSON.stringify(apps, null, 2));

  // The register the guard reads each Worker's scope from — the real file's shape,
  // one row per Worker, matched to it by the `config` path.
  const rowFor = (name) => {
    const cors = Object.hasOwn(rows, name) ? rows[name] : scopeOf(name);
    if (cors === null) return null;
    const row = { name, config: `services/${name}/wrangler.jsonc` };
    if (cors !== undefined) row.cors = cors;
    return row;
  };
  const names = Object.keys(workers);
  const serving = names.includes('platform') ? rowFor('platform') : null;
  const appRows = names.filter((n) => n !== 'platform').map(rowFor).filter(Boolean);
  if (register) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'platform-register.json'),
      JSON.stringify({ ...(serving ? { servingWorker: serving } : {}), appWorkers: appRows }, null, 2),
    );
  }

  for (const [name, spec] of Object.entries(workers)) {
    const { allowed, appId } =
      spec !== null && typeof spec === 'object' ? spec : { allowed: spec, appId: name };
    const dir = join(root, 'services', name);
    mkdirSync(dir, { recursive: true });
    const varsLine = allowed === null ? '' : `    "ALLOWED_ORIGINS": ${JSON.stringify(allowed)},\n`;
    const appIdLine = appId === null ? '' : `    "APP_ID": ${JSON.stringify(appId)},\n`;
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `{\n` +
        `  /* Cloudflare Worker — ${name}. Block comment, on purpose. */\n` +
        `  "name": ${JSON.stringify(name)},\n` +
        `  "main": "src/index.ts",\n` +
        `  // This app's web origins only (comma-separated).\n` +
        `${extraComment}` +
        `  "vars": {\n` +
        appIdLine +
        varsLine +
        `  },\n` + // ← trailing comma before } — jsonc, not json
        `}\n`,
    );
    const binding = Object.hasOwn(bindings, name)
      ? bindings[name]
      : { scope: scopeOf(name), appId: name === 'platform' ? undefined : name.replace(/-api$/, '') };
    if (binding !== null) {
      mkdirSync(join(dir, 'src', 'middleware'), { recursive: true });
      writeFileSync(join(dir, 'src', 'middleware', 'cors.ts'), bindingSource(binding));
    }
  }
  return root;
}

function run(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('assert-cors-allowlist', () => {
  test('passes on the live shape: every derived origin present, nothing unjustified', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /2 Worker config\(s\) checked against 1 catalogue origin\(s\) from 1 app\(s\)/);
    // Derived and EXTRAS are counted SEPARATELY and both printed: a single
    // blended tally is how a hand-maintained list creeps back unnoticed. The
    // EXTRAS count is FIVE, not three, and the two it grew by are the retiring
    // subdomain in each config — the number rising is the cutover being visible.
    // ⏱ 2026-10-01 (rv2-newproduct-010): FOUR derived and ONE EXTRA. The Pages
    // preview origin moved from EXTRAS into the derivation (each row's `origin`),
    // once per Worker, so the derived tally grew by exactly the two EXTRAS lost.
    assert.match(out, /4 derived requirement\(s\) \+ 1 declared EXTRAS all present/);
    assert.match(out, /2 Worker\(s\) bind the `cors` scope their tooling\/platform-register\.json row names/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ⏱ REWRITTEN [ADR 075]. THIS USED TO BE "FAILS when a new catalogue app is
  // missing from the shared Worker" — N1, the defect [4]B-2 exists for and the
  // one the previous guard passed: a second app (`https://drift.nikatru.com`)
  // stamped into the catalogue, nobody edits the shared Worker, exit 1 naming
  // the new origin.
  //
  // THAT INPUT NO LONGER EXISTS. App #2's `url` is `https://nikatru.com/drift`,
  // whose origin is the string app #1 already contributes, so nothing can ever
  // be "missing" for the second app alone. The per-app CORS boundary was traded
  // for one payment-provider approval instead of N; this is the receipt.
  //
  // What survives, and CAN still fail: N apps must collapse to exactly ONE
  // derived origin (publish one on a subdomain again and the tally changes and
  // the apex limb below goes red), and the shared Worker missing THAT origin is
  // still every app's browser traffic refused at runtime. Both halves asserted.
  // ─────────────────────────────────────────────────────────────────────────
  test('two catalogue apps yield exactly ONE derived origin, and dropping it still FAILS', () => {
    const drift = { slug: 'drift', name: 'Drift', url: `${APEX}/drift`, origin: DRIFT_PAGES, status: 'live' };

    // (a) the collapse itself: 2 apps, 1 origin. If this ever reads "2
    //     catalogue origin(s)", an app has left the apex. (The shared Worker
    //     lists drift's Pages preview origin: that one IS per app, and derived.)
    const ok = run(tree({ apps: [SUBLY, drift], workers: { ...REAL, platform: `${REAL.platform},${DRIFT_PAGES}` } }));
    assert.equal(ok.code, 0, ok.out);
    assert.match(
      ok.out,
      /2 Worker config\(s\) checked against 1 catalogue origin\(s\) from 2 app\(s\)/,
    );
    // The shared Worker still carries one derived requirement PER APP — they
    // just happen to be the same string now, which is exactly the point.
    // Six: the apex and the preview origin per app on the shared Worker (4), and
    // app #1's two on its own Worker (2).
    assert.match(ok.out, /6 derived requirement\(s\) \+ 1 declared EXTRAS all present/);

    // (b) the floor that survived: drop the apex from the shared Worker and
    //     every app in the catalogue is named, not just the newest one.
    const workers = { ...REAL, platform: `${SUBDOMAIN},${PAGES_NEW},${LOCAL}` };
    const { code, out } = run(tree({ apps: [SUBLY, drift], workers }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/wrangler\.jsonc — missing "https:\/\/nikatru\.com"/);
    assert.match(out, /apps\.json declares "drift"/);
    assert.match(out, /apps\.json declares "subscriptiontracker"/);
    assert.match(out, /refused at runtime with nothing logged server side/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ⏱ REWRITTEN [ADR 075]. THIS USED TO BE "FAILS when a per-app Worker drops
  // its own app origin" — services/<slug>-api had to list THAT ONE APP'S origin,
  // and the input that redded it was subscriptiontracker-api carrying everything except
  // `https://subly.nikatru.com`.
  //
  // UNTESTABLE FOR THE SAME REASON as the case above: "its own app origin" and
  // "every other app's origin" are now one string. Dropping the apex from a
  // per-app Worker is still red — case (b) above covers that shape — but it no
  // longer asserts a PER-APP anything, so keeping it here under this name would
  // be an assertion whose title is a lie.
  //
  // What replaced the boundary is asserted instead: a per-app Worker (one not
  // marked `scope: 'every-app'`) must declare `vars.APP_ID`. With one shared
  // origin, the token+APP_ID pair is the only thing left that can tell one app's
  // caller from another's, and a per-app Worker without it authorises on a
  // string every app in the portfolio sends. THAT has an input that reds it.
  // ─────────────────────────────────────────────────────────────────────────
  test('FAILS when a per-app Worker declares no vars.APP_ID', () => {
    const workers = { ...REAL, 'subscriptiontracker-api': { allowed: REAL['subscriptiontracker-api'], appId: null } };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /services\/subscriptiontracker-api\/wrangler\.jsonc — vars\.APP_ID is missing on a PER-APP Worker/);
    assert.match(out, /authorises on a string every app in the portfolio sends/);
    // The shared Worker is exempt from this limb by design — it is every app's
    // Worker, so there is no single APP_ID it could carry. If this ever starts
    // naming services/platform, the exemption has inverted.
    assert.doesNotMatch(out, /services\/platform\/wrangler\.jsonc — vars\.APP_ID/);
  });

  // ── the reversal itself is guarded [ADR 075] ──────────────────────────────
  // NEW. The two cases above lost their teeth because every app moved to the
  // apex; this is the case that makes moving BACK a red build rather than a
  // silent restoration of a boundary nothing else asserts any more. An app on
  // its own origin needs its own payment-provider approval and its own
  // allowlist entry, and neither happens by accident.
  test('FAILS when a catalogue row is published on a subdomain again', () => {
    const relapsed = { ...SUBLY, url: SUBDOMAIN };
    const { code, out } = run(tree({ apps: [relapsed] }));
    assert.equal(code, 1);
    // ⚠️ ANCHORED TO THE SENTENCE, NOT LEFT AS A BARE HOST PATTERN. An unanchored
    // an unanchored pattern for that host over text that contains URLs is the
    // missing-regexp-anchor shape (CodeQL js/regex/missing-regexp-anchor): it
    // matches inside `https://subly.nikatru.com.evil.example` too, so it would go
    // on passing while the guard named a host nobody meant. Each assertion below
    // pins the host to what must surround it — a line end, or a comma/quote —
    // so the match cannot drift onto a longer name.
    assert.match(out, /1 catalogue origin\(s\) are not the apex "https:\/\/nikatru\.com"/);
    assert.match(out, new RegExp(`"${rx(SUBDOMAIN)}"`));
    assert.match(out, /publishes every app at a PATH on the apex/);
  });

  // The other direction: the catalogue is also a CEILING, not just a floor.
  // ── ⏱ 2026-10-01 · THE PAGES PREVIEW ORIGIN IS DERIVED (rv2-newproduct-010) ──
  // It was a hand EXTRAS entry, so a second app's preview build was refused by
  // every Worker with this guard green. RED CONTROL, measured on the real tree
  // before this case was written: the preview origin removed from
  // services/platform/wrangler.jsonc exits 1 naming it as derived from `origin`.
  test('FAILS when a catalogue row\'s Pages preview origin is dropped from EITHER Worker', () => {
    for (const service of ['platform', 'subscriptiontracker-api']) {
      const workers = { ...REAL, [service]: REAL[service].split(',').filter((o) => o !== PAGES_NEW).join(',') };
      const { code, out } = run(tree({ workers }));
      assert.equal(code, 1, `${service}: ${out}`);
      assert.match(
        out,
        new RegExp(`${rx(`services/${service}/wrangler.jsonc`)} — missing "${rx(PAGES_NEW)}" — apps\\.json declares "subscriptiontracker"'s Pages preview origin`),
      );
    }
  });

  test('a SECOND app\'s preview origin is required on the shared Worker with no edit to this guard', () => {
    const drift = { slug: 'drift', name: 'Drift', url: `${APEX}/drift`, origin: DRIFT_PAGES, status: 'live' };
    const { code, out } = run(tree({ apps: [SUBLY, drift] }));
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`services/platform/wrangler\\.jsonc — missing "${rx(DRIFT_PAGES)}" — apps\\.json declares "drift"'s Pages preview origin`));
    // Its own Worker does not exist, so only the shared one is charged.
    assert.doesNotMatch(out, /services\/subscriptiontracker-api\/wrangler\.jsonc — missing/);
  });

  test('FAILS a catalogue row with no `origin`, or one that is not a bare https origin', () => {
    const { origin: _dropped, ...noOrigin } = SUBLY;
    const missing = run(tree({ apps: [noOrigin] }));
    assert.equal(missing.code, 1, missing.out);
    assert.match(missing.out, /apps\.json row "subscriptiontracker" has no `origin`, so its Pages preview origin cannot be derived/);
    const pathy = run(tree({ apps: [{ ...SUBLY, origin: `${PAGES_NEW}/app` }] }));
    assert.equal(pathy.code, 1, pathy.out);
    assert.match(pathy.out, /has an `origin` that is not a bare https origin/);
  });

  test('FAILS on a hand-added origin the catalogue does not justify', () => {
    const workers = { ...REAL, 'subscriptiontracker-api': `${REAL['subscriptiontracker-api']},https://evil.example.com` };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /"https:\/\/evil\.example\.com" is listed but NOTHING justifies it/);
    assert.match(out, /standing CORS grant nobody reviewed/);
  });

  test('accepts the declared EXTRAS and the derived preview origin (local dev server, Pages preview)', () => {
    // These are NOT in apps.json and must still be allowed, because EXTRAS
    // gives each a reason. The subdomain is one of them now: it stopped being
    // catalogue-derived the moment the app moved to a path.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // ⚠️ SUBSTRING, NOT REGEX. These are NEGATIVE assertions — "the guard did not
    // complain about this host" — and for a negative the loosest match is the
    // strongest check, so anchoring them would weaken them. But a bare host
    // pattern compiled as a regex over text full of URLs is the
    // missing-regexp-anchor shape whatever its polarity, and arguing that a
    // scanner has miscategorised one line is how a rule stops being read at all.
    // `includes` says exactly what is meant, catches strictly more, and is not a
    // regex — so there is nothing left to anchor.
    for (const host of ['pages.dev', 'localhost:3000', 'subly.nikatru.com']) {
      assert.ok(!out.includes(host), `the guard named ${host} on a tree where every EXTRA is present:\n${out}`);
    }
  });

  // 🔴 AN EXTRA IS REQUIRED, NOT MERELY PERMITTED — and the first draft of this
  // guard got that wrong. Treating EXTRAS as a permit-list alone meant dropping
  // http://localhost:3000 from services/platform became a PASS, silently
  // regressing a case the pre-derivation guard already caught (guards.test.mjs
  // "FAILS when a required PLATFORM origin is dropped"). Removing an origin has
  // to be a reviewable diff, not a quiet edit to a comma-separated string.
  test('FAILS when a declared EXTRA is dropped from the config', () => {
    const workers = { ...REAL, platform: `${APEX},${SUBDOMAIN},${PAGES_NEW}` }; // localhost gone
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /missing "http:\/\/localhost:3000" — EXTRAS:/);
    assert.match(out, /delete the EXTRAS entry in the same change/);
  });

  // ⏱ REWRITTEN 2026-09-09, when the cutover's last step landed. It used to assert
  // the removal was COUPLED: with the subdomain still in EXTRAS, dropping it from a
  // config alone had to red, because a live browser tab would lose its API with
  // nothing logged. Both halves left in one commit, so that input can no longer be
  // written -- and the assertion is now the one that keeps the retirement PERMANENT:
  // putting the subdomain back into a config, with nothing in EXTRAS justifying it,
  // is an unreviewed standing CORS grant for a host that serves only a 301.
  // ⏱ 2026-09-11 · THE NARROW STEP IS PERMANENT TOO. The pre-rename Pages origin
  // left both configs and EXTRAS in one change. Putting it back into EITHER
  // Worker, with nothing in EXTRAS justifying it, must red — a *.pages.dev name
  // is claimable once its project is deleted, so a stale grant there is a CORS
  // grant for a stranger. Mutation-proven before this case was written: the
  // origin re-added to each real wrangler.jsonc exits 1 naming it.
  test('FAILS when the retired pre-rename Pages origin is put back into EITHER config', () => {
    for (const service of ['platform', 'subscriptiontracker-api']) {
      const workers = { ...REAL, [service]: `${REAL[service]},${PAGES}` };
      const { code, out } = run(tree({ workers }));
      assert.equal(code, 1, `${service}: ${out}`);
      assert.match(
        out,
        new RegExp(`${rx(`services/${service}/wrangler.jsonc`)} — "${rx(PAGES)}" is listed but NOTHING justifies it`),
      );
    }
  });

  test('FAILS when the retired subdomain is put back into a config', () => {
    const workers = { ...REAL, 'subscriptiontracker-api': `${APEX},${PAGES_NEW},${SUBDOMAIN}` };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, new RegExp(`"${rx(SUBDOMAIN)}" is listed but NOTHING justifies it`));
    assert.match(out, /standing CORS grant nobody reviewed/);
  });

  test('FAILS when ALLOWED_ORIGINS is absent', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: null } }));
    assert.equal(code, 1);
    assert.match(out, /vars\.ALLOWED_ORIGINS is missing/);
  });

  test('FAILS when ALLOWED_ORIGINS is an empty string', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: '' } }));
    assert.equal(code, 1);
    assert.match(out, /ALLOWED_ORIGINS is EMPTY/);
  });

  // 🔴 THE ANTI-GREP CASE. A comment that mentions an origin must not satisfy
  // the requirement, and must not trip the unjustified check either. This repo
  // shipped a `grep '"r2_buckets"'` that matched the comment explaining why
  // there is no r2_buckets; the same mistake was reproduced again on 2026-08-07.
  test('ignores origins that appear only in comments (parsed, not grepped)', () => {
    const ghost = '  // was once "ALLOWED_ORIGINS": "https://ghost.example.com" — removed\n';
    const { code, out } = run(tree({ extraComment: ghost }));
    assert.equal(code, 0, out);
    // Must-not-contain: the broader needle is the stricter check (CodeQL #61).
    assert.ok(!out.includes('ghost.example'), `the guard echoed a comment-only origin:\n${out}`);
  });

  test('FAILS a comment-only origin that the config no longer really lists', () => {
    // The mirror of the above: the origin is REQUIRED by the catalogue and
    // present only in prose. A grep would call this covered.
    //
    // ⏱ The fixture changed with [ADR 075] — it used to ghost a second app on
    // its own subdomain (`https://ghost.nikatru.com`), which the apex limb now
    // rejects before this limb is ever reached. The required origin it ghosts
    // is therefore the apex itself, which is the only derived origin left.
    const extraComment = `  // "${APEX}" used to be listed here\n`;
    const workers = { ...REAL, platform: `${SUBDOMAIN},${PAGES_NEW},${LOCAL}` };
    const { code, out } = run(tree({ workers, extraComment }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/wrangler\.jsonc — missing "https:\/\/nikatru\.com"/);
  });

  // ── unregistered scope ────────────────────────────────────────────────────
  // ⏱ 2026-09-27 (E-b1). This was "FAILS on a Worker it has never been taught
  // about", when a Worker had to be in the guard's SERVICE_POLICY literal or be
  // named <slug>-api. The scope is the register's now, so the refusal is "no row".
  test('FAILS on a Worker the register has no row for, naming it', () => {
    const workers = { ...REAL, 'mystery-worker': REAL['subscriptiontracker-api'] };
    const { code, out } = run(tree({ workers, rows: { 'mystery-worker': null } }));
    assert.equal(code, 1);
    assert.match(out, /services\/mystery-worker\/wrangler\.jsonc — no row in tooling\/platform-register\.json names services\/mystery-worker/);
    assert.match(out, /A Worker\s+with no row is a Worker whose allowlist nothing checks/);
  });

  test('FAILS on a register row with no cors scope', () => {
    const { code, out } = run(tree({ rows: { 'subscriptiontracker-api': undefined } }));
    assert.equal(code, 1);
    assert.match(out, /appWorkers\[0\] \(services\/subscriptiontracker-api\) — `cors` is null; it must be "every-app" or "own-app"/);
  });

  test('FAILS on an own-app row for a Worker no catalogue app owns', () => {
    const workers = { ...REAL, 'mystery-worker': REAL['subscriptiontracker-api'] };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /appWorkers\[1\] says `cors: "own-app"`, and no app in\s+catalog\/apps\.json owns services\/mystery-worker/);
  });

  // ── the code binds the scope the register names (RC9) ─────────────────────
  // 🔴 WHY THIS LIMB EXISTS: every catalogue origin is the apex [ADR 075], so an
  // own-app row flipped to every-app requires the same origin set and nothing in
  // the origin limbs above can see it. The code is where the scope still decides
  // something — the localhost trade.
  test('RC9: FAILS when app #1\'s row says every-app and its code binds own-app', () => {
    const { code, out } = run(tree({ rows: { 'subscriptiontracker-api': 'every-app' } }));
    assert.equal(code, 1);
    assert.match(
      out,
      /services\/subscriptiontracker-api\/src\/middleware\/cors\.ts — it binds `scope: 'own-app'` and the register says "every-app"/,
    );
    assert.match(out, /answers every localhost port on top of its list, which the register says it does not/);
  });

  test('FAILS when the SHARED Worker binds own-app under an every-app row', () => {
    const { code, out } = run(tree({ bindings: { platform: { scope: 'own-app', appId: undefined } } }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/src\/middleware\/cors\.ts — it binds `scope: 'own-app'` and the register says "every-app"/);
  });

  test('FAILS when a Worker has no binding at all', () => {
    const { code, out } = run(tree({ bindings: { 'subscriptiontracker-api': null } }));
    assert.equal(code, 1);
    assert.match(out, /services\/subscriptiontracker-api\/src\/middleware\/cors\.ts — there is no such file/);
  });

  test('FAILS when an own-app binding names another app', () => {
    const { code, out } = run(
      tree({ bindings: { 'subscriptiontracker-api': { scope: 'own-app', appId: 'someoneelse' } } }),
    );
    assert.equal(code, 1);
    assert.match(out, /it names `appId` 'someoneelse'; an own-app Worker in services\/subscriptiontracker-api belongs to app 'subscriptiontracker'/);
  });

  test('a scope named only in a comment is not a binding', () => {
    // bindingSource() writes "scope: 'every-app'" in a comment on every binding;
    // the live-shape case passing proves the reader strips it, and this proves it
    // cannot stand in for the call.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /`scope` literal\(s\)/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const { code, out } = run(tree({ register: false }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — no register at tooling\/platform-register\.json/);
  });

  // ── anti-vacuity [pipeline F-10] ──────────────────────────────────────────
  test('COVERAGE LOST on an empty catalogue', () => {
    const { code, out } = run(tree({ apps: [] }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — the catalogue yielded 0 origin\(s\)/);
    assert.match(out, /passes forever/);
  });

  test('COVERAGE LOST when the catalogue file is absent', () => {
    const { code, out } = run(tree({ apps: null }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — no catalogue at catalog\/apps\.json/);
  });

  test('COVERAGE LOST when fewer than two Worker configs are found', () => {
    const { code, out } = run(tree({ workers: { platform: REAL.platform } }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — found 1 Worker config\(s\)/);
  });

  // If the <slug>-api limb matches nothing, only the shared Worker is really
  // being checked and the tally still looks healthy. That must be loud.
  test('COVERAGE LOST when the <slug>-api derivation matches no Worker', () => {
    const other = { slug: 'other', name: 'Other', url: `${APEX}/other`, status: 'live' };
    const { code, out } = run(tree({ apps: [other] }));
    assert.equal(code, 1);
    assert.match(out, /the <slug>-api derivation matched 0 Worker\(s\)/);
  });

  test('COVERAGE LOST when a catalogue row has no url', () => {
    const { code, out } = run(tree({ apps: [{ slug: 'urlless', status: 'live' }] }));
    assert.equal(code, 1);
    assert.match(out, /row "urlless" has no `url`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-27 · THE EDGE PASS-THROUGH POLICY (LEAD RULINGS SHIELD-R1..R3, rv-c21
// SHIELD-F2, row O-BOXES-UNSHIELDED-FROM-SPIKES). An `edgeWorkers` entry of
// tooling/platform-register.json is held to "answers its own refusals `*`, never
// credentials, no allowlist of its own" — and each case below is a way that could
// stop being true while the guard stayed green.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-cors-allowlist — edge pass-through Workers (SHIELD-F2)', () => {
  const GOOD = `// A refusal a browser can read.
export function refusal(): Response {
  const headers = new Headers({ 'Retry-After': '60', 'Access-Control-Allow-Origin': '*' });
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response('{}', { status: 429, headers });
}
`;
  /** The live tree plus services/edge-x: a config, a source file and (unless `row: false`) its edgeWorkers entry. */
  function edgeTree({ src = GOOD, allowed = null, row = true } = {}) {
    const root = tree();
    const dir = join(root, 'services', 'edge-x');
    mkdirSync(join(dir, 'src'), { recursive: true });
    const vars = allowed === null ? '' : `  "vars": { "ALLOWED_ORIGINS": ${JSON.stringify(allowed)} },\n`;
    writeFileSync(join(dir, 'wrangler.jsonc'), `{\n  // an edge pass-through\n  "name": "edge-x",\n  "main": "src/index.ts",\n${vars}}\n`);
    writeFileSync(join(dir, 'src', 'index.ts'), src);
    const edgeWorkers = row ? [{ name: 'edge-x', entrypoint: 'services/edge-x/src/index.ts', config: 'services/edge-x/wrangler.jsonc' }] : [];
    // E-b1 (NP-Eb1): tree() already wrote the register every Worker's `cors` scope is read from, so the
    // edge entry is ADDED to it; replacing it would leave the two live Workers with no scope (COVERAGE LOST).
    const registerPath = join(root, 'tooling', 'platform-register.json');
    writeFileSync(registerPath, JSON.stringify({ ...JSON.parse(readFileSync(registerPath, 'utf8')), edgeWorkers }, null, 2));
    return root;
  }

  test('passes an edge Worker that answers `*`, sets no credentials and declares no allowlist — and SAYS so', () => {
    const { code, out } = run(edgeTree());
    assert.equal(code, 0, out);
    assert.match(out, /services\/edge-x\/wrangler\.jsonc — edge pass-through/);
    assert.match(out, /1 edge pass-through Worker\(s\) answer `\*` and never credentials/);
  });

  test('🔴 FAILS an edge Worker that ECHOES the request’s Origin', () => {
    const src = GOOD.replace("headers.set('Access-Control-Allow-Origin', '*');", "headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') ?? '');");
    const { code, out } = run(edgeTree({ src }));
    assert.equal(code, 1, out);
    assert.match(out, /services\/edge-x\/index\.ts — sets Access-Control-Allow-Origin to something other than the literal '\*' \(1 of 2\)/);
  });

  test('🔴 FAILS an edge Worker that sets Access-Control-Allow-Credentials', () => {
    const src = GOOD.replace("return new Response", "headers.set('Access-Control-Allow-Credentials', 'true');\n  return new Response");
    const { code, out } = run(edgeTree({ src }));
    assert.equal(code, 1, out);
    assert.match(out, /an EDGE pass-through sets Access-Control-Allow-Credentials/);
  });

  test('FAILS an edge Worker that declares an allowlist nothing in it enforces', () => {
    const { code, out } = run(edgeTree({ allowed: APEX }));
    assert.equal(code, 1, out);
    assert.match(out, /an EDGE pass-through declares vars\.ALLOWED_ORIGINS/);
  });

  test('reads the source COMMENT-STRIPPED: a comment naming both headers is not a finding', () => {
    const src = `// Never Access-Control-Allow-Credentials; never an echoed Access-Control-Allow-Origin.\n${GOOD}`;
    const { code, out } = run(edgeTree({ src }));
    assert.equal(code, 0, out);
  });

  test('the SAME Worker with no edgeWorkers row is untaught scope, and FAILS as one', () => {
    const { code, out } = run(edgeTree({ row: false }));
    assert.equal(code, 1, out);
    assert.match(out, /no row in tooling\/platform-register\.json names services\/edge-x/);
  });
});
