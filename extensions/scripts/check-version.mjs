/* check-version.mjs — manifest == CHANGELOG top == tag.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-version.mjs fullshot
     node scripts/check-version.mjs fullshot --expect 1.10.1     (release.yml)
     node scripts/check-version.mjs fullshot --tag fullshot-v1.10.1

   One command that kills the entire class of "shipped 1.10.1 with 1.10.0 in
   the manifest" (spec §3.2). The manifest is the SINGLE source of truth for the
   version (§3.1); everything else here is checked for AGREEMENT with it, never
   consulted as an alternative answer.

   THE VERSION IS NEVER REUSED, AND THAT IS WHY THE DUPLICATE CHECK IS HERE

   Two different packages under one version number is unrecoverable in public:
   the store keeps whichever it received first, and no diff you can run
   afterwards tells you which one a user has. A CHANGELOG with the same version
   heading twice is the earliest visible symptom, so it fails here.

   WHAT IT DELEGATES, AND WHY

   A tool copied from templates/tool carries publish/bump-version.mjs, which holds
   that tool's OWN declared list of version sites — the AMO manifest, the
   derived gecko id, anything else it has learned about itself. This script runs
   it (SK_ROOT set to the tool directory) and folds the result in, rather than
   re-implementing the list. Two version gates that can disagree is the defect
   this script exists to prevent; it would be absurd to introduce it here.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Report, parseArgs } from './lib/report.mjs';
import { repoRoot, resolveTool, readText, readJson, versionProblem, changelogTop } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['expect', 'tag', 'repo-root']);
const root = repoRoot(args);
const tool = resolveTool(root, args.positional[0]);

const r = new Report('check-version · ' + tool.id + ' (' + tool.rel + ')');

/* ---------------- 1. the manifest, the single source of truth ---------------- */
const version = tool.manifest ? tool.manifest.version : null;
const vp = versionProblem(version);
if (vp) {
  r.fail(tool.manifestRel + ' version', 'version is ' + vp);
} else {
  r.pass(tool.manifestRel + ' declares v' + version, 'the single source of truth (spec §3.1)');
}

/* ---------------- 2. the CHANGELOG ---------------- */
const clAbs = path.join(tool.dirAbs, 'CHANGELOG.md');
let clText = null;
if (!fs.existsSync(clAbs)) {
  r.fail('CHANGELOG.md exists',
    tool.rel + '/CHANGELOG.md is missing.\n' +
    'A release with no entry is a release nobody can explain — not the reviewer reading the\n' +
    'diff, not the user asking what changed, and not you in six months. Keep-a-Changelog form,\n' +
    'newest first: "## [' + (version || 'x.y.z') + '] - ' + new Date().toISOString().slice(0, 10) + '".');
} else {
  clText = readText(clAbs);
  const top = changelogTop(clText);
  if (!top) {
    r.fail('CHANGELOG.md has a version heading',
      tool.rel + '/CHANGELOG.md contains no "## [x.y.z]" heading (an [Unreleased] heading alone does not count).\n' +
      'Expected the newest release first, e.g. "## [' + (version || 'x.y.z') + '] - 2026-08-14".');
  } else if (top !== version) {
    r.fail('CHANGELOG top entry matches the manifest',
      'CHANGELOG.md\'s newest entry is [' + top + '] but ' + tool.manifestRel + ' says v' + version + '.\n' +
      'One of the two was bumped and the other was not. The manifest is authoritative, so either\n' +
      'add the [' + version + '] section or correct the manifest — in the SAME commit either way.');
  } else {
    r.pass('CHANGELOG top entry is [' + top + ']', 'agrees with the manifest');
  }

  /* A version heading appearing twice means a version was reused. */
  const headings = [...clText.matchAll(/^##\s*\[([^\]]+)\]/gm)].map(m => m[1].trim())
    .filter(v => !/^unreleased$/i.test(v));
  const dupes = headings.filter((v, i) => headings.indexOf(v) !== i);
  if (dupes.length) {
    r.fail('no version appears twice in the CHANGELOG',
      'these version heading(s) appear more than once: ' + [...new Set(dupes)].join(', ') + '.\n' +
      'A version is never reused. Two different packages under one number is unrecoverable in\n' +
      'public: the store keeps whichever it received first, and nothing you can run afterwards\n' +
      'tells you which one a user has.');
  }
}

/* ---------------- 3. the tag ---------------- */
/* release.yml parses fullshot-v1.10.1 into id + version and passes --expect.
   GITHUB_REF_NAME is read as a fallback so a local `git tag` + manual run
   catches the same mistake. */
const tagArg = args.get('tag') || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null);
if (typeof tagArg === 'string' && tagArg) {
  const m = /^(.+)-v(\d+(?:\.\d+){0,3})$/.exec(tagArg);
  if (!m) {
    r.fail('tag is well formed',
      'tag "' + tagArg + '" does not match <tool-id>-v<version>, e.g. ' + tool.id + '-v' + (version || '1.0.0') + '.');
  } else {
    const [, tagId, tagVer] = m;
    if (tagId !== tool.id) {
      r.fail('tag names this tool',
        'tag "' + tagArg + '" is for tool id "' + tagId + '" but this is "' + tool.id + '".\n' +
        'The id is the stable public handle — release.yml builds the artifact names from it.');
    } else if (tagVer !== version) {
      r.fail('tag version matches the manifest',
        'tag "' + tagArg + '" says v' + tagVer + ' but ' + tool.manifestRel + ' says v' + version + '.\n' +
        'Delete the tag, bump the manifest and the CHANGELOG, commit, then re-tag. Never move a\n' +
        'tag that has been pushed: a release artifact is identified by the tag it was built from.');
    } else {
      r.pass('tag ' + tagArg + ' agrees', 'id and version both match');
    }
  }
}

const expect = args.get('expect');
if (typeof expect === 'string' && expect) {
  if (expect !== version) {
    r.fail('--expect ' + expect,
      tool.manifestRel + ' says v' + version + ', the caller expected v' + expect + '.\n' +
      'release.yml derives --expect from the pushed tag, so this means the tag and the tree disagree.');
  } else {
    r.pass('--expect ' + expect + ' agrees with the manifest');
  }
}

/* ---------------- 4. the Firefox overlay ---------------- */
/* Spec §3.4: publish/manifest.firefox.json should be an RFC 7386 MERGE PATCH —
   six lines, carrying only what differs. A full duplicate states the version
   twice, and every future bump must then be made twice. One day it will not be. */
const ffRel = tool.targets && tool.targets.firefox && tool.targets.firefox.overlay;
if (typeof ffRel === 'string' && ffRel) {
  const ffAbs = path.join(tool.dirAbs, ffRel);
  const p = readJson(ffAbs);
  if (p.error) {
    r.fail('the Firefox overlay parses', p.error);
  } else if (Object.prototype.hasOwnProperty.call(p.value, 'version')) {
    if (p.value.version !== version) {
      r.fail(ffRel + ' version agrees',
        ffRel + ' says v' + p.value.version + ' but ' + tool.manifestRel + ' says v' + version + '.\n' +
        'This is a SECOND manifest that AMO reads and that nothing else will remind you about.');
    } else {
      r.warn(ffRel + ' carries a "version" key',
        'It agrees today (v' + version + '), so this is not yet a break. But an overlay is meant to be an\n' +
        'RFC 7386 merge patch carrying ONLY what differs from the base manifest (spec §3.4). While it\n' +
        'restates the version, every bump has to be made twice — and the failure mode is a Firefox\n' +
        'package silently shipping the previous version number.');
    }
  } else {
    r.pass(ffRel + ' is an overlay', 'it does not restate the version, so it cannot drift from it');
  }
}

/* ---------------- 5. the tool's own version sites ---------------- */
const bump = path.join(tool.dirAbs, 'publish', 'bump-version.mjs');
if (fs.existsSync(bump)) {
  const res = spawnSync(process.execPath, [bump, '--check'], {
    cwd: tool.dirAbs,
    env: { ...process.env, SK_ROOT: tool.dirAbs },
    encoding: 'utf8'
  });
  const out = ((res.stdout || '') + (res.stderr || '')).trimEnd();
  if (res.error) {
    r.fail('the tool\'s own publish/bump-version.mjs --check ran',
      'could not run ' + tool.rel + '/publish/bump-version.mjs: ' + res.error.message);
  } else if (res.status !== 0) {
    r.fail(tool.rel + '/publish/bump-version.mjs --check',
      'the tool\'s own version-site check failed (exit ' + res.status + '). It knows about sites this\n' +
      'script does not — its VERSION_SITES list is per-tool. Its output:\n' +
      out.split('\n').map(l => '  | ' + l).join('\n'));
  } else {
    r.pass('the tool\'s own publish/bump-version.mjs --check agrees',
      'every version site it declares is in step');
  }
} else {
  r.note('no ' + tool.rel + '/publish/bump-version.mjs — only the sites this script knows about were checked');
}

process.exit(r.finish());
