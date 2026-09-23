// web-drive-stages-fonts.test.mjs — no `flutter drive -d web-server` job in this
// tree may reach its drive without having staged the fallback fonts its own
// bootstrap points at.
//
// WHY THIS SUITE EXISTS, AS A CLASS CHECK AND NOT AS A FIXTURE.
// `apps/<app>/web/flutter_bootstrap.js` sets `fontFallbackBaseUrl:
// "fallback-fonts/"`, relative. flutter_tools' web_asset_server resolves an
// unmatched request against `<cwd>/web/<path>` and serves index.html with HTTP
// 200 and text/html — never a 404 — so the engine receives HTML where Roboto
// should be, draws no Latin glyph, and NOTHING FAILS. The store capture found
// this the expensive way (#847, #854: every committed frame textless from #567
// onwards) and fixed it for its own lane by calling `stageFallbackFonts`. The
// nightly e2e kept driving `-d web-server` with no staging step at all, so the
// same silent defect simply moved lanes. `tooling/ci/test/capture-fallback-
// fonts.test.mjs` proves the STAGER; this file proves that every consumer of the
// dev server actually calls it.
//
// 🔴 THE FAILURE MODE IS SILENCE, IN BOTH DIRECTIONS. A drive with no fonts
// still exits 0 and still uploads screenshots; and a guard that matched only
// "some step mentions fonts" would go quietly green the day the staging script
// is renamed or moved. So the matcher names the SCRIPT PATH, and a separate case
// asserts that path exists in the tree — a rename that updates both stays green,
// a rename that updates one goes red. (Class trap: "moved code silences
// guards".)
//
// It reuses `tooling/ci/workflow-scan.mjs` — the tree's one workflow reader,
// whose `parseWorkflow` blanks comments while PRESERVING line numbers and whose
// `logical` view folds a `run: |` block into one line per step. Without that
// folding a drive spread over twenty backslash-continued lines is invisible to
// any single-line matcher, and a commented-out step reads as a live one.
//
// Row O-NIGHTLY-E2E-DRIVES-A-GLYPHLESS-APP.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKFLOW_DIR, parseWorkflow } from '../workflow-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** The one script that stages the fonts. Named as a PATH on purpose: see the
 *  header. Changing it here without changing the workflows (or the reverse) is
 *  exactly what the two cases below refuse. */
const STAGER_REL = 'tooling/store/capture-fallback-fonts.mjs';

// A dynamic import of an ABSOLUTE path throws ERR_UNSUPPORTED_ESM_URL_SCHEME on
// Windows ("Received protocol 'c:'") — it must be a file:// URL, the same way
// capture-fallback-fonts.test.mjs does it.
const STAGER_ABS = join(ROOT, ...STAGER_REL.split('/'));
const { bootstrapPosture } = await import(new URL(`file:///${STAGER_ABS.replace(/\\/g, '/')}`).href);

const workflowFiles = () =>
  readdirSync(join(ROOT, WORKFLOW_DIR))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

const catalogSlugs = () =>
  JSON.parse(readFileSync(join(ROOT, 'catalog', 'apps.json'), 'utf8')).map((a) => a.slug);

/** A step that drives the Flutter web DEV SERVER. Both halves are required:
 *  `flutter drive` alone also covers `-d chrome` and the desktop devices, which
 *  serve their own assets and are not affected by this defect. */
const drivesWebServer = (text) => /\bflutter\s+drive\b/.test(text) && /-d\s+web-server\b/.test(text);

/** A step that stages the fonts, named by the script's own path. */
const stagesFonts = (text) => text.includes(STAGER_REL) && /--stage\b/.test(text);

/** Every app directory a job could drive.
 *
 *  A job that interpolates `matrix.app` can resolve to ANY app in the catalog,
 *  so the whole catalog is its app set — the exemption below then only fires
 *  when no app in the tree needs staging at all. A job naming `apps/<slug>`
 *  literally resolves to just that one. */
function appsDrivenBy(job) {
  const body = job.logical.map((l) => l.text).join('\n');
  if (/matrix\.app\b/.test(body)) return catalogSlugs();
  const named = new Set();
  for (const m of body.matchAll(/apps\/([a-z0-9][a-z0-9_-]*)\b/g)) named.add(m[1]);
  return [...named];
}

/** The exemption, and the ONLY one: an app set whose bootstraps all declare no
 *  relative fontFallbackBaseUrl, so there is nothing to stage. An empty set is
 *  NOT exempt — "I could not work out which app this drives" is a reason to
 *  require the step, not to waive it. */
function everyAppNeedsNoStaging(slugs) {
  if (slugs.length === 0) return false;
  return slugs.every((slug) => {
    const appDir = join(ROOT, 'apps', slug);
    if (!existsSync(appDir)) return false;
    return bootstrapPosture(appDir).needsStaging === false;
  });
}

/** Every `-d web-server` drive in the tree, with the staging step that precedes
 *  it in the same job (or null). Line numbers are the workflow's own. */
function webServerDrives() {
  const found = [];
  for (const rel of workflowFiles()) {
    const parsed = parseWorkflow(ROOT, join(WORKFLOW_DIR, rel).replace(/\\/g, '/'));
    if (!parsed) continue;
    for (const job of parsed.jobs.values()) {
      const stages = job.logical.filter((l) => stagesFonts(l.text)).map((l) => l.n);
      for (const line of job.logical) {
        if (!drivesWebServer(line.text)) continue;
        const earlier = stages.filter((n) => n < line.n);
        found.push({
          workflow: rel,
          job: job.name,
          driveAt: line.n,
          stagedAt: earlier.length ? earlier[earlier.length - 1] : null,
          apps: appsDrivenBy(job),
        });
      }
    }
  }
  return found;
}

describe('no web-server drive without the fonts it will ask for', () => {
  // 🔴 A SUITE THAT RANGES OVER NOTHING PASSES PERFECTLY. If the scan stops
  // finding drives — a renamed device flag, a reader reading the wrong
  // directory — every case below is vacuously green, which is the shape this
  // whole file exists to refuse. So the set is asserted non-empty FIRST.
  test('the scan actually finds the web-server drives in this tree', () => {
    const drives = webServerDrives();
    assert.ok(
      drives.length >= 1,
      `COVERAGE LOST: no \`flutter drive … -d web-server\` step found in any of ${workflowFiles().length} ` +
        'workflow(s). Either the drive moved to another device flag, or this scan is no longer reading ' +
        'the workflows — and every other case in this file is then vacuously green.',
    );
    // The nightly e2e is the drive this row was opened for. Naming it keeps the
    // set honest if e2e.yml is ever split.
    assert.ok(
      drives.some((d) => d.workflow === 'e2e.yml'),
      `the e2e workflow drives no web-server step any more; found: ${drives.map((d) => `${d.workflow}#${d.job}`).join(', ') || '(none)'}`,
    );
  });

  test('every web-server drive is preceded, in its own job, by the staging step', () => {
    const offenders = webServerDrives()
      .filter((d) => d.stagedAt === null && !everyAppNeedsNoStaging(d.apps))
      .map(
        (d) =>
          `${d.workflow}:${d.driveAt} (job "${d.job}", apps: ${d.apps.join(', ') || 'unresolved'}) drives ` +
          `-d web-server with no earlier \`node ${STAGER_REL} --stage …\` step in the same job`,
      );
    assert.deepEqual(
      offenders,
      [],
      `${offenders.length} web-server drive(s) will be served index.html where the fallback fonts should ` +
        `be, and will draw no Latin glyph while exiting 0:\n    ${offenders.join('\n    ')}`,
    );
  });

  test('the staging step the workflows name is a script that exists', () => {
    // The other half of "moved code silences guards": the matcher above is a
    // path, so a workflow that keeps staging under a NEW path goes red there —
    // and this case is what goes red if the path moves in the tree while the
    // workflows still name the old one.
    assert.ok(
      existsSync(STAGER_ABS),
      `${STAGER_REL} does not exist, so every "stages fonts" match above is a match on a step that runs nothing.`,
    );
  });
});

describe('the store capture stages before it drives, in the same order', () => {
  // The capture is the OTHER web-server consumer, and it stages in JavaScript
  // rather than in a workflow step, so the workflow scan above cannot see it.
  // Order is the whole property: staging after the drive has spawned places the
  // fonts for the NEXT run and leaves this one glyphless, which is a defect no
  // existence check can catch.
  const CAPTURE_REL = 'tooling/store/capture-play-screenshots.mjs';

  test('capture-play-screenshots.mjs calls stageFallbackFonts before it spawns flutter drive', () => {
    const src = readFileSync(join(ROOT, ...CAPTURE_REL.split('/')), 'utf8');
    const stageAt = src.indexOf('await stageFallbackFonts(');
    assert.notEqual(stageAt, -1, `${CAPTURE_REL} no longer awaits stageFallbackFonts( at all`);
    const driveAt = src.search(/spawnSync\(\s*'flutter'/);
    assert.notEqual(driveAt, -1, `${CAPTURE_REL} no longer spawns flutter, so the order below ranges over nothing`);
    assert.ok(
      stageAt < driveAt,
      `${CAPTURE_REL} stages the fallback fonts at offset ${stageAt}, AFTER it spawns flutter at ${driveAt}: ` +
        'this run draws no text and the next one does, which reads as flakiness rather than as a defect.',
    );
  });

  test('the capture imports the stager rather than re-implementing it', () => {
    const src = readFileSync(join(ROOT, ...CAPTURE_REL.split('/')), 'utf8');
    assert.match(
      src,
      /import\s*\{[^}]*stageFallbackFonts[^}]*\}\s*from\s*'\.\/capture-fallback-fonts\.mjs'/,
      `${CAPTURE_REL} must take stageFallbackFonts from ${STAGER_REL}; a private copy drifts from the lock ` +
        'the workflow step stages from, and the two lanes then disagree about which fonts "staged" means.',
    );
  });
});
