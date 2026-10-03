#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-shared.mjs — the SHARED files a stamped app needs an entry in, written
// by the stamp instead of by hand.
//
// ⏱ 2026-10-01 · full-review train P43 (SYN-N3: rv2-newproduct-005, -009, -011).
// A stamp writes apps/<id>/ and renders the catalogue row from its app.yaml.
// Three files OUTSIDE the app's folder also had to learn about it, each by a
// hand edit nothing prompted, and each failed differently:
//
//   bundle    the bundle register — limb F of assert-bundle-availability.mjs
//             requires every catalogue product to be a member or excluded by
//             name, so the stamp's own catalogue row turned that guard (ci.yml)
//             red on app #2's first commit. The stamp now EXCLUDES the product
//             with the placeholder why of tooling/catalog/read.mjs
//             (STAMPED_EXCLUSION_MARK); limb F refuses that placeholder once the
//             product is live, which is new-product step 12, bundle join.
//   e2e       tooling/e2e-leg-register.json `apps.<id>` — the six golden-path
//             legs graded per app by assert-e2e-legs.mjs against THAT app's own
//             suite. The stamp writes the brick suite's legs (stampedE2eLegs):
//             two asserted, four blocked by predicates the guard re-evaluates.
//   auth      tooling/mail-transport.json supabaseAuth.uri_allow_list — GENERATED
//             by assert-auth-callbacks.mjs `allowListFor` from every app in
//             scope. An app missing from it has every auth link REPLACED with the
//             Site URL (app #1) by GoTrue, silently.
//
// What this does NOT do: change anything live. The allow list here is the
// record of what GoTrue must admit; applying it to the identity project is the
// owner/ops step that PATCHes the auth config (Ops watch compares the two).
//
// Usage:  node tooling/kit/stamp-shared.mjs [--check] [--root <dir>]
//   (no flag)  write every missing entry; print what was written.
//   --check    write nothing; exit 1 naming each file that is not what the stamp
//              would leave.
// Exit 0 = nothing to write (or written) · 1 = --check found a difference, or a
// splice could not be proven · 2 = COVERAGE LOST: a file could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLES_REGISTER, CATALOG_DIR, memberSlugsOf, readCatalogFile, stampedExclusionWhy } from '../catalog/read.mjs';
import { appendToArray, addMember, assertSpliced, replaceValue } from './json-splice.mjs';
import { MAIL_TRANSPORT, allowListFor, readDerivation } from '../ci/assert-auth-callbacks.mjs';
import { appSet } from '../ci/app-set.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The two catalogues whose products every bundle row must place. */
const PRODUCT_CATALOGUES = [`${CATALOG_DIR}/apps.json`, 'extensions/catalog/extensions.json'];

const readText = (root, rel) => {
  const abs = join(root, ...rel.split('/'));
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

/**
 * bundle — every catalogue product a bundle row neither lists nor excludes is
 * excluded with the stamp's placeholder why. Returns `{ rel, before, after,
 * added: [slug], lost: [why] }`; `after === before` when nothing is missing.
 */
export function planBundleExclusions(root) {
  const rel = BUNDLES_REGISTER;
  const before = readText(root, rel);
  const out = { rel, before, after: before, added: [], lost: [] };
  if (before === null) {
    out.lost.push(`${rel} does not exist, so no product could be placed in or out of a bundle.`);
    return out;
  }
  const slugs = [];
  for (const cat of PRODUCT_CATALOGUES) {
    const r = readCatalogFile(root, cat);
    if (!r.ok || !Array.isArray(r.value)) {
      out.lost.push(`${r.why ?? `${cat} is not a JSON array`}, so its products could not be placed in or out of a bundle.`);
      continue;
    }
    for (const row of r.value) if (typeof row?.slug === 'string' && row.slug && !slugs.includes(row.slug)) slugs.push(row.slug);
  }
  if (out.lost.length) return out;
  let rows;
  try {
    rows = JSON.parse(before);
  } catch (e) {
    out.lost.push(`${rel} is not valid JSON (${e.message}).`);
    return out;
  }
  if (!Array.isArray(rows)) {
    out.lost.push(`${rel} is not a JSON array of bundle rows.`);
    return out;
  }
  let text = before;
  const expected = structuredClone(rows);
  rows.forEach((row, i) => {
    if (row === null || typeof row !== 'object') return;
    const members = memberSlugsOf(row);
    const excluded = Array.isArray(row.excluded) ? row.excluded.map((x) => x?.slug) : [];
    const missing = slugs.filter((s) => !members.includes(s) && !excluded.includes(s));
    if (missing.length === 0) return;
    const entries = missing.map((slug) => ({ slug, why: stampedExclusionWhy(slug) }));
    const rendered = entries.map((e) => `{ "slug": ${JSON.stringify(e.slug)}, "why": ${JSON.stringify(e.why)} }`);
    if (Array.isArray(row.excluded)) {
      text = appendToArray(text, [i, 'excluded'], rendered);
      expected[i].excluded.push(...entries);
    } else {
      text = addMember(text, [i], 'excluded', '[]', { after: 'members' });
      text = appendToArray(text, [i, 'excluded'], rendered);
      // Key order matters to nobody who parses it; the comparison below is by value.
      expected[i].excluded = entries;
    }
    out.added.push(...missing.filter((s) => !out.added.includes(s)));
  });
  if (text !== before) assertSpliced(text, expected, rel);
  out.after = text;
  return out;
}

/**
 * auth — supabaseAuth.uri_allow_list becomes the generated list
 * (assert-auth-callbacks.mjs allowListFor), written as the one comma-joined
 * string the live auth config holds. `added` names the entries it gains.
 */
export function planAuthAllowList(root) {
  const rel = MAIL_TRANSPORT;
  const before = readText(root, rel);
  const out = { rel, before, after: before, added: [], lost: [] };
  if (before === null) {
    out.lost.push(`${rel} does not exist, so the auth allow list has nowhere to be written.`);
    return out;
  }
  let doc;
  try {
    doc = JSON.parse(before);
  } catch (e) {
    out.lost.push(`${rel} is not valid JSON (${e.message}).`);
    return out;
  }
  const current = doc?.supabaseAuth?.uri_allow_list;
  if (typeof current !== 'string') {
    out.lost.push(`${rel} supabaseAuth.uri_allow_list is not the comma-joined string the live auth config holds.`);
    return out;
  }
  const d = readDerivation(root);
  if (d.problems.length || d.markers.size === 0) {
    out.lost.push(`the auth flow markers could not be read (${d.problems.join(' ') || 'no marker'}), so the allow list cannot be generated.`);
    return out;
  }
  const generated = allowListFor(root);
  const have = current.split(',').map((x) => x.trim()).filter(Boolean);
  if (generated.join(',') === current) return out;
  const text = replaceValue(before, ['supabaseAuth', 'uri_allow_list'], JSON.stringify(generated.join(',')));
  const expected = structuredClone(doc);
  expected.supabaseAuth.uri_allow_list = generated.join(',');
  assertSpliced(text, expected, rel);
  out.after = text;
  out.added = generated.filter((g) => !have.includes(g));
  if (out.added.length === 0) out.added = ['(entries reordered or a hand-added entry dropped)'];
  return out;
}

export const E2E_LEG_REGISTER = 'tooling/e2e-leg-register.json';

/**
 * The six legs of a BRICK-stamped suite (tooling/bricks/app/__brick__/apps/
 * {{app_id}}/integration_test/app_test.dart), for app `id`. Its one test
 * launches the app to the sign-in screen and signs the throwaway account in to
 * Home, so `anonymous` and `sign-in` are asserted by anchors in that file. The
 * app sells nothing at stamp (providers.dart `PaywallConfig(enabled: false)`)
 * and the suite walks no deletion, so the other four are blocked by predicates
 * assert-e2e-legs.mjs re-evaluates over THIS app's own lib/ and suite.
 */
export function stampedE2eLegs(id, declaredOn) {
  const sellsNothing = `[5] apps/${id} sells nothing`;
  return [
    {
      id: 'anonymous',
      asks: 'a stranger with no account reaches the app and can move through first-run',
      status: 'asserted',
      anchors: ['await app.main();', 'expect(find.byKey(SignInView.emailField), findsOneWidget);'],
    },
    {
      id: 'sign-in',
      asks: 'real credentials against live Supabase move the user off the login screen and into the app',
      status: 'asserted',
      anchors: ['await tester.tap(find.byKey(SignInView.submitButton));', 'expect(find.byType(HomeScreen), findsWidgets);'],
    },
    { id: 'purchase-sandbox', asks: 'a sandbox purchase completes from inside the app', status: 'blocked', blockedBy: sellsNothing, declaredOn },
    { id: 'entitlement-flip', asks: 'the entitlement the purchase bought is read back and flips to active', status: 'blocked', blockedBy: sellsNothing, declaredOn },
    { id: 'feature-unlock', asks: 'a feature that was gated before the purchase is usable after it', status: 'blocked', blockedBy: sellsNothing, declaredOn },
    {
      id: 'account-delete-purges',
      asks: 'deleting the account from inside the app really erases the user and its rows',
      status: 'blocked',
      blockedBy: `[7] apps/${id}/integration_test/app_test.dart walks no account deletion`,
      declaredOn,
    },
  ];
}

/**
 * e2e — every app of the workspace set that carries its suite and has no
 * `apps.<id>` entry gets one: the brick suite's six legs. Never userTables /
 * rowTable: those are the app's backend tables, and tooling/e2e/backend.mjs
 * refuses to purge until somebody who knows them writes them.
 */
export function planE2eEntries(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const rel = E2E_LEG_REGISTER;
  const before = readText(root, rel);
  const out = { rel, before, after: before, added: [], lost: [] };
  if (before === null) {
    out.lost.push(`${rel} does not exist, so no app's legs have anywhere to be graded.`);
    return out;
  }
  let reg;
  try {
    reg = JSON.parse(before);
  } catch (e) {
    out.lost.push(`${rel} is not valid JSON (${e.message}).`);
    return out;
  }
  if (!reg?.apps || typeof reg.apps !== 'object' || Array.isArray(reg.apps) || Object.keys(reg.apps).length === 0) {
    out.lost.push(`${rel} has no \`apps\` entries to add a stamped app beside.`);
    return out;
  }
  // The workflow that drives every app's suite by E2E_APP_ID is the one every
  // existing entry names — read from the register, never retyped here. Entries
  // that disagree leave no single answer to copy.
  const workflows = [...new Set(Object.values(reg.apps).map((e) => e?.workflow))];
  if (workflows.length !== 1 || typeof workflows[0] !== 'string' || workflows[0] === '') {
    out.lost.push(`${rel} entries name ${workflows.length} different workflow(s) (${workflows.join(', ')}), so a stamped app's has no one answer.`);
    return out;
  }
  const set = appSet(root);
  if (set === null || set.length === 0) {
    out.lost.push('the workspace app set (root pubspec.yaml `workspace:`) is unreadable or empty, so no app could be given its legs.');
    return out;
  }
  let text = before;
  const expected = structuredClone(reg);
  for (const { id, dir } of set) {
    if (Object.hasOwn(reg.apps, id)) continue;
    const test = `${dir}/integration_test/app_test.dart`;
    if (!existsSync(join(root, ...test.split('/')))) continue; // assert-e2e-legs names the missing suite
    const entry = { app: dir, test, workflow: workflows[0], platform: 'web', declaredOn: today, legs: stampedE2eLegs(id, today) };
    text = addMember(text, ['apps'], id, JSON.stringify(entry, null, 2));
    expected.apps[id] = entry;
    out.added.push(id);
  }
  if (text !== before) assertSpliced(text, expected, rel);
  out.after = text;
  return out;
}

/** Every plan this stamp step owns, in the order they are written. */
export function planAll(root) {
  return [planBundleExclusions(root), planAuthAllowList(root), planE2eEntries(root)];
}

/** `{ code, lines }` — writes unless `check`. */
export function run(root, { check = false } = {}) {
  const lines = [];
  let plans;
  try {
    plans = planAll(root);
  } catch (e) {
    return { code: 1, lines: [`✗ stamp-shared: ${e.message}. Nothing was written.`] };
  }
  const lost = plans.flatMap((p) => p.lost);
  if (lost.length) return { code: 2, lines: lost.map((l) => `✗ COVERAGE LOST — ${l}`) };
  const stale = plans.filter((p) => p.after !== p.before);
  if (check) {
    if (stale.length === 0) return { code: 0, lines: [`ok  stamp-shared --check — ${plans.length} shared file(s) carry every stamped app`] };
    for (const p of stale) lines.push(`✗ ${p.rel} is missing what the stamp writes (${p.added.join(', ')}). Run:  node tooling/kit/stamp-shared.mjs`);
    return { code: 1, lines };
  }
  for (const p of stale) {
    writeFileSync(join(root, ...p.rel.split('/')), p.after);
    lines.push(`wrote ${p.rel} — ${p.added.join(', ')}`);
  }
  lines.push(`ok  stamp-shared — ${stale.length} of ${plans.length} shared file(s) rewritten`);
  return { code: 0, lines };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at === -1 ? REPO : resolve(args[at + 1] ?? '.');
  const r = run(root, { check: args.includes('--check') });
  for (const l of r.lines) (r.code === 0 ? console.log : console.error)(l);
  process.exit(r.code);
}
