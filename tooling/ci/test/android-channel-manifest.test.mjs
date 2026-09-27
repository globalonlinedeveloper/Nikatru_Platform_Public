// ─────────────────────────────────────────────────────────────────────────────
// android-channel-manifest.test.mjs — a channel that forbids a billing rail
// strips that rail's permission from its own build, BEFORE anything is built.
//
// Build apps run 35822768347 (2026-09-23) failed on the apps.gov.in .apk:
//   "the built .apk requests com.android.vending.BILLING, and
//    tooling/channel-register.json "apps-gov-in" forbids the "play-billing" rail"
// #890 had linked RevenueCat, and with it the Play Billing Library, into every
// Android build. build-platforms.yml never runs on a pull request, so the only
// guard that could see it (assert-apps-gov-in-apk.mjs, over the BUILT .apk) ran
// after the merge.
//
// The mechanism, in three files this test holds to each other:
//   1. tooling/channel-register.json — an Android row's `purchaseRail.forbids`,
//      mapped to permissions by RAIL_PERMISSIONS in assert-apps-gov-in-apk.mjs
//      (the built-.apk guard's own map, imported from it rather than copied);
//   2. apps/<app>/android/app/src/channel/<id>/AndroidManifest.xml — the
//      overlay, `<uses-permission … tools:node="remove">` per forbidden permission;
//   3. apps/<app>/android/app/build.gradle.kts — the hook that reads
//      RELEASE_CHANNEL out of Flutter's -Pdart-defines and makes the overlay the
//      release build-type manifest, which outranks main and every library;
// and the workflow must actually pass `--dart-define=RELEASE_CHANNEL=<id>`, or
// the hook never fires.
//
// It cannot prove the merged manifest — only a build can, which is why the
// built-.apk guard stays. It proves that the removal is wired for every channel
// that needs one, and that no overlay removes the rail its own channel sells on.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAIL_PERMISSIONS } from '../assert-apps-gov-in-apk.mjs';
import { stripInert } from '../text-reductions.mjs';
import { flutterBuilds } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKFLOW_REL = '.github/workflows/build-platforms.yml';

/** Channel id → the permissions its build must NOT carry, for every Android row
 *  whose `forbids` names a rail that has a permission. */
export function requiredRemovals(register) {
  const out = new Map();
  for (const c of register.channels ?? []) {
    if (!(c.platforms ?? []).includes('android')) continue;
    const perms = (c.purchaseRail?.forbids ?? []).flatMap((r) => RAIL_PERMISSIONS[r] ?? []);
    if (perms.length) out.set(c.id, [...new Set(perms)].sort());
  }
  return out;
}

/** The permissions a manifest REMOVES. Comments out first: a comment naming
 *  BILLING is prose, not a removal. */
export function removedPermissions(xml) {
  const out = [];
  for (const m of stripInert(xml).matchAll(/<uses-permission\b[^>]*>/g)) {
    if (!/\btools:node\s*=\s*"remove(?:All)?"/.test(m[0])) continue;
    const name = m[0].match(/android:name\s*=\s*"([^"]+)"/);
    if (name) out.push(name[1]);
  }
  return out.sort();
}

/** What the gradle hook is missing, read from CODE only. The CHANNEL MANIFEST
 *  comment block names every one of these, so comments go first. */
export function hookMissing(gradle) {
  const code = gradle
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
  const needs = [
    ['reads the defines', 'findProperty("dart-defines")'],
    ['picks RELEASE_CHANNEL', '"RELEASE_CHANNEL="'],
    ['finds the overlay', '"src/channel/'],
    ['on the release source set', 'sourceSets.getByName("release")'],
    ['as its manifest', 'manifest.srcFile('],
  ];
  return needs.filter(([, s]) => !code.includes(s)).map(([what, s]) => `${what} (${s})`);
}

/** Every RELEASE_CHANNEL the workflow passes to a build. */
export function workflowChannels(text) {
  return new Set([...text.matchAll(/--dart-define=RELEASE_CHANNEL=([a-z0-9-]+)/g)].map((m) => m[1]));
}

/** The whole contract. `apps` is [{ app, gradle, overlays: { <id>: xml } }]. */
export function checkChannelManifests({ register, apps, workflow }) {
  const problems = [];
  const removals = requiredRemovals(register);
  const android = new Map((register.channels ?? []).filter((c) => (c.platforms ?? []).includes('android')).map((c) => [c.id, c]));
  const passed = workflowChannels(workflow);
  let checked = 0;
  for (const { app, gradle, overlays } of apps) {
    const where = (id) => `apps/${app}/android/app/src/channel/${id}/AndroidManifest.xml`;
    for (const [id, perms] of removals) {
      const xml = overlays[id];
      if (xml === undefined) {
        problems.push(`${where(id)} is missing: "${id}" forbids a rail that needs ${perms.join(', ')}, and nothing strips it from ${app}'s build.`);
        continue;
      }
      const removed = removedPermissions(xml);
      for (const p of perms) {
        checked++;
        if (!removed.includes(p)) problems.push(`${where(id)} does not remove ${p} (tools:node="remove"); "${id}" forbids the rail that needs it.`);
      }
    }
    for (const [id, xml] of Object.entries(overlays)) {
      const row = android.get(id);
      if (!row) {
        problems.push(`${where(id)} names "${id}", which is not an Android channel in tooling/channel-register.json — no build will ever merge it.`);
        continue;
      }
      const own = RAIL_PERMISSIONS[row.purchaseRail?.rail] ?? [];
      for (const p of removedPermissions(xml)) {
        if (own.includes(p)) problems.push(`${where(id)} removes ${p}, which "${id}"'s own rail (${row.purchaseRail.rail}) cannot sell without.`);
      }
      if (!passed.has(id)) problems.push(`${WORKFLOW_REL} never passes --dart-define=RELEASE_CHANNEL=${id}, so ${where(id)} is never merged.`);
    }
    if (Object.keys(overlays).length) {
      for (const m of hookMissing(gradle)) problems.push(`apps/${app}/android/app/build.gradle.kts has channel overlays but its CHANNEL MANIFEST hook no longer ${m}.`);
    }
  }
  return { problems, checked };
}

/** The real tree: every app with an Android build, its gradle file and overlays. */
function readTree() {
  const register = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8'));
  // ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE): build-platforms.yml calls tooling/ci/flutter-release-build.mjs
  // and types no `--dart-define=RELEASE_CHANNEL=` itself, so its builds are read through the census: each
  // command the composer composes, as the literal line it replaced would read.
  const workflow = flutterBuilds(ROOT)
    .filter((b) => b.workflow === WORKFLOW_REL)
    .map((b) => b.segment)
    .join('\n');
  const apps = [];
  for (const app of readdirSync(join(ROOT, 'apps')).sort()) {
    const gradlePath = join(ROOT, 'apps', app, 'android', 'app', 'build.gradle.kts');
    if (!existsSync(gradlePath)) continue;
    const overlays = {};
    const chDir = join(ROOT, 'apps', app, 'android', 'app', 'src', 'channel');
    if (existsSync(chDir)) {
      for (const id of readdirSync(chDir).sort()) {
        const f = join(chDir, id, 'AndroidManifest.xml');
        if (existsSync(f)) overlays[id] = readFileSync(f, 'utf8');
      }
    }
    apps.push({ app, gradle: readFileSync(gradlePath, 'utf8'), overlays });
  }
  return { register, apps, workflow };
}

describe('android channel manifests', () => {
  test('the real tree is wired, and the check is not vacuous', () => {
    const tree = readTree();
    assert.ok(tree.apps.length >= 1, 'no app with android/app/build.gradle.kts was found');
    assert.ok(requiredRemovals(tree.register).get('apps-gov-in')?.includes('com.android.vending.BILLING'), 'apps-gov-in no longer forbids a permissioned rail — re-read this test before relaxing it');
    const r = checkChannelManifests(tree);
    assert.deepEqual(r.problems, []);
    assert.ok(r.checked >= tree.apps.length, `only ${r.checked} removal(s) checked over ${tree.apps.length} Android app(s)`);
  });

  test('FAILS when the overlay is missing, or keeps the permission instead of removing it', () => {
    const tree = readTree();
    const app = tree.apps.find((a) => a.overlays['apps-gov-in']);
    assert.ok(app, 'no app carries an apps-gov-in overlay');

    const { 'apps-gov-in': _gone, ...rest } = app.overlays;
    const missing = checkChannelManifests({ ...tree, apps: [{ ...app, overlays: rest }] });
    assert.ok(missing.problems.some((p) => /apps-gov-in\/AndroidManifest\.xml is missing/.test(p)), missing.problems.join('\n'));

    const kept = app.overlays['apps-gov-in'].replace(/\s+tools:node="remove"/, '');
    assert.notEqual(kept, app.overlays['apps-gov-in'], 'the mutation must land');
    const r = checkChannelManifests({ ...tree, apps: [{ ...app, overlays: { ...app.overlays, 'apps-gov-in': kept } }] });
    assert.ok(r.problems.some((p) => /does not remove com\.android\.vending\.BILLING/.test(p)), r.problems.join('\n'));

    const commented = `${kept.replace('</manifest>', '')}<!-- <uses-permission android:name="com.android.vending.BILLING" tools:node="remove"/> -->\n</manifest>\n`;
    const c = checkChannelManifests({ ...tree, apps: [{ ...app, overlays: { ...app.overlays, 'apps-gov-in': commented } }] });
    assert.ok(c.problems.some((p) => /does not remove com\.android\.vending\.BILLING/.test(p)), 'a commented-out removal is prose, not a removal');
  });

  test('FAILS when the gradle hook is gone, even with its comment block intact', () => {
    const tree = readTree();
    const app = tree.apps.find((a) => Object.keys(a.overlays).length);
    const stripped = app.gradle.replace(/^.*manifest\.srcFile\(.*$/m, '');
    assert.notEqual(stripped, app.gradle, 'the mutation must land');
    const r = checkChannelManifests({ ...tree, apps: [{ ...app, gradle: stripped }] });
    assert.ok(r.problems.some((p) => /hook no longer as its manifest/.test(p)), r.problems.join('\n'));
  });

  test('FAILS when the workflow stops passing the channel, or an overlay is orphaned or removes its own rail', () => {
    const tree = readTree();
    const app = tree.apps.find((a) => a.overlays['apps-gov-in']);

    const wf = tree.workflow.replaceAll('--dart-define=RELEASE_CHANNEL=apps-gov-in', '--dart-define=RELEASE_CHANNEL=android-play');
    assert.notEqual(wf, tree.workflow, 'the mutation must land');
    const w = checkChannelManifests({ ...tree, workflow: wf });
    assert.ok(w.problems.some((p) => /never passes --dart-define=RELEASE_CHANNEL=apps-gov-in/.test(p)), w.problems.join('\n'));

    const billing = app.overlays['apps-gov-in'];
    const r = checkChannelManifests({ ...tree, apps: [{ ...app, overlays: { ...app.overlays, 'android-play': billing, web: billing } }] });
    assert.ok(r.problems.some((p) => /android-play\/AndroidManifest\.xml removes com\.android\.vending\.BILLING/.test(p)), r.problems.join('\n'));
    assert.ok(r.problems.some((p) => /"web", which is not an Android channel/.test(p)), r.problems.join('\n'));
  });
});
