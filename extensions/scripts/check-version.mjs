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
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, readText, readJson, versionProblem, changelogTop, packagedFiles } from './lib/toolinfo.mjs';
import { mergePatch } from './lib/merge-patch.mjs';

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

/* The members of an RFC 7386 patch that change nothing when it is applied to
   `base`, as dotted paths (§4b below). */
function restatedMembers(base, patch, at) {
  const out = [];
  const b = isPlainObject(base) ? base : {};
  for (const key of Object.keys(patch)) {
    const where = at ? at + '.' + key : key;
    const had = Object.prototype.hasOwnProperty.call(b, key);
    if (patch[key] === null) { if (!had) out.push(where); continue; }
    const merged = mergePatch(b[key], patch[key]);
    if (had && sameJson(merged, b[key])) out.push(where);
    else if (isPlainObject(patch[key]) && isPlainObject(b[key])) out.push(...restatedMembers(b[key], patch[key], where));
  }
  return out;
}

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

  /* 4b. ONLY WHAT DIFFERS (2026-09-25, F-b). A member the overlay states with
     the value manifest.json already gives it changes nothing in the merge — and
     it is a second copy of that value, which a later edit to manifest.json
     leaves behind in the Firefox package. So a member whose merged value equals
     the base's is a finding, named by its path; an object member that does
     change something is searched inside for restated members of its own. A null
     that deletes a key the base does not have is the same no-op. "version" is
     left to the check above, which already grades it (warn when it agrees,
     fail when it does not).
     It lives HERE, not in the template's test/skeleton-sim.node.js: the sim
     sees both of the template's files, but it runs only as a stamped tool's own
     sim and never reads Full_Screen_Shot, while this script runs for every
     discovered tool in the extensions CI `gates` job. */
  if (!p.error && p.value !== null && typeof p.value === 'object' && !Array.isArray(p.value) &&
      tool.manifest && typeof tool.manifest === 'object') {
    const restated = restatedMembers(tool.manifest, p.value).filter(k => k !== 'version');
    if (restated.length) {
      r.fail(ffRel + ' holds only what differs from ' + tool.manifestRel,
        restated.length + ' member(s) merge to the value ' + tool.manifestRel + ' already has: ' + restated.join(', ') + '.\n' +
        'An RFC 7386 overlay carries only what Firefox needs beyond the base manifest. A restated member is\n' +
        'a second copy of a base value: the merge hides it today, and a later edit to ' + tool.manifestRel + '\n' +
        'leaves the Firefox package on the old one. Delete ' + (restated.length === 1 ? 'it' : 'them') + ' from ' + ffRel + '.');
    } else {
      r.pass(ffRel + ' holds only what differs from ' + tool.manifestRel,
        Object.keys(p.value).length + ' member(s), each of which changes the merged manifest');
    }
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

/* ---------------- 6. the version is not behind its tree ---------------- */
/* ⏱ 2026-09-29 (EXL-15; no platform-state row opened yet). Every limb above
   compares the manifest with the CHANGELOG, so both could stand still while
   the shipped files moved: FullShot's CSP, the LICENSE in its package and
   redaction fixes all landed after 1.10.2 was stamped, and this script passed
   because nothing it read had changed. Two builds of different bytes under one
   version is the thing section 2 calls unrecoverable in public.
   So: the commit that last touched the CHANGELOG's top version heading (git
   blame, which follows the extensions/ subtree import where a pickaxe search
   does not) is the bump, and any later commit that touches a file the package
   ships (packagedFiles(), the packer's own selection) needs either a new
   version or an `## [Unreleased]` section above the top heading saying what
   changed. A heading not yet committed is a bump in progress and passes; a
   tree outside git (the self-test's fixtures) says so and is not graded; a
   SHALLOW history cannot name the bump and is COVERAGE LOST (exit 2), because
   a pass there would be a pass over history nobody read — CI checks out with
   fetch-depth: 0 for this. */
if (clText !== null && version && !vp) {
  const git = (argv) => spawnSync('git', argv, { cwd: tool.dirAbs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) {
    r.note('NOT GRADED: ' + tool.rel + ' is not inside a git work tree, so which commits touched the shipped files after v' +
      version + ' cannot be read.');
  } else if (git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true') {
    die('the checkout is shallow, so the commit that stamped v' + version + ' — and every shipped-file commit after it —\n' +
      'is outside the history this run can read. Check out with fetch-depth: 0.');
  } else {
    /* Both sides through realpath: git prints the top in its long form, while a
       tool path can arrive as a Windows 8.3 short name (C:\Users\LONGNA~1\…).
       path.relative across the two climbs out of the repo, ls-files then finds
       nothing, and the limb passed as "not committed yet" over a committed file. */
    const topDir = fs.realpathSync.native(top.stdout.trim());
    const toolReal = fs.realpathSync.native(tool.dirAbs);
    const gitTop = (argv) => git(['-C', topDir, ...argv]);   // pathspecs below are relative to the top
    const clRel = path.relative(topDir, path.join(toolReal, 'CHANGELOG.md')).split(path.sep).join('/');
    if (clRel.startsWith('../') || path.isAbsolute(clRel)) {
      die('the CHANGELOG resolves outside the git work tree that holds it (' + clRel + '),\n' +
        'so which commits touched it cannot be read.');
    }
    const lines = clText.split('\n');
    const headIdx = lines.findIndex((l) => /^##\s*\[/.test(l) && !/^##\s*\[\s*unreleased\s*\]/i.test(l));
    const unreleased = lines.slice(0, Math.max(headIdx, 0)).some((l) => /^##\s*\[\s*unreleased\s*\]/i.test(l));
    const tracked = gitTop(['ls-files', '--error-unmatch', '--', clRel]).status === 0;
    const blame = tracked ? gitTop(['blame', '--root', '--porcelain', '-L', (headIdx + 1) + ',' + (headIdx + 1), '--', clRel]) : null;
    const sha = blame && blame.status === 0 ? (blame.stdout.split('\n')[0] || '').split(' ')[0] : '';
    if (!tracked) {
      r.pass('v' + version + ' is not behind its tree', clRel + ' is not committed yet — a first version in progress');
    } else if (headIdx < 0 || blame.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
      die('could not name the commit that last touched the top version heading of ' + clRel + ':\n' +
        (blame.stderr || '').trim());
    } else if (/^0+$/.test(sha)) {
      r.pass('v' + version + ' is not behind its tree', 'the top CHANGELOG heading is not committed yet — a bump in progress');
    } else if (/^boundary$/m.test(blame.stdout)) {   // --root: only a history cut short is a boundary
      die('git blame attributes the top version heading of ' + clRel + ' to a boundary commit, so the history\n' +
        'before it is not in this checkout. Check out with fetch-depth: 0.');
    } else {
      const { files } = packagedFiles(root, tool);
      const shipped = files.map((f) => path.relative(topDir, path.join(toolReal, f)).split(path.sep).join('/'));
      const log = gitTop(['log', '--format=%h %s', sha + '..HEAD', '--', ...shipped]);
      if (log.status !== 0) die('git log over the shipped files failed: ' + (log.stderr || '').trim());
      const after = log.stdout.split('\n').filter(Boolean);
      if (!after.length) {
        r.pass('v' + version + ' is not behind its tree', 'no commit has touched the ' + shipped.length +
          ' shipped file(s) since ' + sha.slice(0, 8) + ' stamped it');
      } else if (unreleased) {
        r.pass('v' + version + ' is not behind its tree', after.length + ' shipped-file commit(s) since ' + sha.slice(0, 8) +
          ', recorded under ## [Unreleased]');
      } else {
        r.fail('v' + version + ' is not behind its tree',
          after.length + ' commit(s) touched files the package ships after ' + sha.slice(0, 8) + ' last touched the\n' +
          'CHANGELOG\'s [' + version + '] heading:\n' + after.slice(0, 10).map((l) => '  ' + l).join('\n') +
          (after.length > 10 ? '\n  … and ' + (after.length - 10) + ' more' : '') + '\n' +
          'A build of these bytes would ship as v' + version + ', which is a different package from the one that\n' +
          'number was stamped on. Bump the manifest and add the [x.y.z] section, or open an ## [Unreleased]\n' +
          'section above [' + version + '] that says what changed.');
      }
    }
  }
}

process.exit(r.finish());
