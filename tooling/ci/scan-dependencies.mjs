#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-dependencies.mjs — OSV-Scanner over every tracked lockfile, PROVING ITSELF
// FIRST. One script, two callers: ci.yml's `security-scan` job (every pull request
// and push) and ops-watch.yml's `dependency-advisories` job (main, daily).
//
// [rv2-security-018] BEFORE THIS, OSV CARRIED NO CANARY AND NO FLOOR. gitleaks and
// zizmor plant a known-bad input and refuse to scan when it is not caught
// (scan-secrets.mjs, scan-workflows.mjs). OSV did neither, so a renamed lockfile,
// a parser that stopped reading one, a config that ignored a whole ecosystem, or an
// unreachable advisory database would all have printed "No issues found" — the
// scanner that found GHSA-253c-mchw-3w2r on 2026-09-30 was the one scanner here
// that could not show it was still able to.
//
// [rv2-security-004] AND IT RAN ONLY WHEN A PULL REQUEST DID. A new advisory against
// an unchanged main surfaced by reddening the next unrelated PR (js-yaml, #557,
// 2026-09-08; markdown-it, PR #1063, 2026-09-30). The daily ops-watch job runs THIS
// file over main, so the advisory pages the durable ops-watch issue first.
//
// [rv2-security-004, part 1] AND A PULL REQUEST WAS GRADED ON MAIN'S ADVISORIES. Every
// advisory in every lockfile reddened the gate, so an advisory published against an
// unchanged main reddened whichever unrelated PR ran next (#1063 vs markdown-it,
// 2026-09-30). With `--pr-range <base>..<head>` (ci.yml passes it on pull_request
// only) an advisory FAILS only when its lockfile is one the PR changed
// (merge-base(base, head)..head). The rest are PRINTED, never dropped, and owned by
// ops-watch's daily scan of main, which pages first. A PR that changes
// osv-scanner.toml or this file is graded on EVERY lockfile: it changes what every
// lockfile's grade means. The canary and the floor run in full either way, and a
// push (main) is graded in full. An advisory that cannot be fixed yet is
// acknowledged in osv-scanner.toml with a dated ignoreUntil.
//
// THREE STEPS, IN THIS ORDER, and nothing after a failed step is believed:
//
//   1. THE LOCKFILE SET. `git ls-files`, filtered to the lockfile names OSV reads.
//      Zero is COVERAGE LOST: a scan with nothing to read is not a clean one.
//   2. THE CANARY. For every lockfile FORMAT the tree tracks, a lockfile pinning a
//      version with published advisories is written to a temp directory, and OSV —
//      the same binary, the same `--config` — must exit 1 and name that package in
//      that file. A format the tree tracks with no canary here is COVERAGE LOST, so
//      adding a Cargo.lock cannot slip in unproven. 🔴 The canaries live in THIS FILE
//      as strings and only ever touch disk under the OS temp dir, so OSV's own
//      `-r .`, Trivy and Dependabot never read them as real lockfiles. ⚠️ An
//      osv-scanner.toml entry that ignores a canary's advisory (or a whole
//      ecosystem) fails the canary on purpose: that config would blind the tree too.
//   3. THE TREE, with a FLOOR. OSV's stderr names every lockfile it read ("Scanned
//      <path> file and found N packages"); every tracked lockfile must be there with
//      N > 0, else COVERAGE LOST naming the missing ones. Findings are read from
//      `--format json` — structure, never the table.
//
// ⏱ 2026-10-02 · THE IGNORES WARN BEFORE THEY EXPIRE (PR #1154 ruling item 4). 90
// GHSA ids were acknowledged until ONE day (2026-10-31), so the first sign of their
// expiry would have been main's daily scan going red on all of them at once. Every
// run now reads osv-scanner.toml's `[[IgnoredVulns]]` and prints a ⚠ line (and, on
// Actions, a ::warning) for each expiry date within EXPIRY_WARN_DAYS, grouped by
// date, naming the ids — on every PR's security-scan and on ops-watch's daily scan
// of main. An entry with no `ignoreUntil` this reader can parse warns too. A
// WARNING, never a change of exit code: an acknowledged advisory is not a finding
// until its date passes, and then OSV itself reddens the lane.
//
// Exit 0 = the canary fired, the floor held and no advisory stands (with --pr-range:
// none in a lockfile the PR changed) · 1 = an advisory against a tracked lockfile
// (with --pr-range: one the PR changed; each printed) · 2 = COVERAGE LOST (no
// lockfiles, a canary not flagged, a lockfile not read, an OSV exit outside 0/1,
// output that does not parse, a --pr-range git cannot resolve). 2 beats 1.
//
// Usage: node tooling/ci/scan-dependencies.mjs --osv <path> [--config <file>]
//          [--pr-range <40-hex base>..<40-hex head>] [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The lockfile basenames this floor counts. OSV reads more manifest kinds than
 *  these; the floor is about LOCKFILES (the resolved versions an advisory applies
 *  to). A name here that the tree tracks must also have a CANARY below. */
export const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'pubspec.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'composer.lock',
  'gradle.lockfile',
  'packages.lock.json',
  'mix.lock',
  'go.sum',
]);

/** One canary per lockfile format the tree tracks today. Each pins a version whose
 *  advisories are old, public and will not be withdrawn: lodash 4.17.4 (ten GHSAs,
 *  among them GHSA-jf85-cpcp-j695) and Dart's http 0.13.0 (GHSA-4rgh-jx4f-qfcq).
 *  Measured with the real osv-scanner 2.6.0 on 2026-09-30: all three flagged,
 *  exit 1. */
export const CANARIES = new Map([
  [
    'package-lock.json',
    {
      pkg: { name: 'lodash', version: '4.17.4' },
      body: `${JSON.stringify(
        {
          name: 'osv-canary',
          version: '0.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'osv-canary', version: '0.0.0', dependencies: { lodash: '4.17.4' } },
            'node_modules/lodash': { version: '4.17.4', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz' },
          },
        },
        null,
        2,
      )}\n`,
    },
  ],
  [
    'pnpm-lock.yaml',
    {
      pkg: { name: 'lodash', version: '4.17.4' },
      body: [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        '      lodash:',
        '        specifier: 4.17.4',
        '        version: 4.17.4',
        '',
        'packages:',
        '',
        '  lodash@4.17.4:',
        '    resolution: {integrity: sha512-6X37Sq9KCpLSXEh8uM12AKYlviHPNNk4RxiGBn4cmKGJinbXBneWIV7iE/nXkM928O7ytHcHb6+X6Svl0f4hXg==}',
        '',
        'snapshots:',
        '',
        '  lodash@4.17.4: {}',
        '',
      ].join('\n'),
    },
  ],
  [
    'pubspec.lock',
    {
      pkg: { name: 'http', version: '0.13.0' },
      body: [
        '# Generated by pub',
        'packages:',
        '  http:',
        '    dependency: "direct main"',
        '    description:',
        '      name: http',
        '      url: "https://pub.dev"',
        '    source: hosted',
        '    version: "0.13.0"',
        'sdks:',
        '  dart: ">=2.12.0 <3.0.0"',
        '',
      ].join('\n'),
    },
  ],
]);

const basename = (p) => String(p).split('/').pop();

/** PURE. The tracked lockfiles out of `git ls-files -z` output, sorted. */
export function lockfilesFrom(lsFilesZ) {
  return String(lsFilesZ)
    .split('\0')
    .filter(Boolean)
    .filter((p) => LOCKFILE_NAMES.has(basename(p)))
    .sort();
}

/** IMPURE. `git ls-files` at `root`; throws when git cannot answer. */
export function trackedLockfiles(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ls-files failed at ${root}: ${r.error?.message ?? (r.stderr || `exit ${r.status}`).trim()}`);
  return lockfilesFrom(r.stdout);
}

/** PURE. A path OSV printed, as a repo-relative POSIX path, or null when it is not
 *  under `root`. OSV prints absolute paths in the host's separator; on Windows that
 *  also turns the brick's literal `{{/needs_backend}}` into `{{\needs_backend}}`,
 *  which the separator swap restores. */
export function relativeTo(root, printed, { caseless = process.platform === 'win32' } = {}) {
  const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
  const base = norm(root);
  const p = norm(printed);
  const [a, b] = caseless ? [p.toLowerCase(), base.toLowerCase()] : [p, base];
  if (a === b) return '';
  if (!a.startsWith(`${b}/`)) return null;
  return p.slice(base.length + 1);
}

/** PURE. Every "Scanned <path> file and found N package(s)" line: `[{ path, packages }]`. */
export function parseScanned(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^Scanned (.+) file and found (\d+) packages?\s*$/);
    if (m) out.push({ path: m[1], packages: Number(m[2]) });
  }
  return out;
}

/** PURE. `--format json` output as `[{ path, name, version, ecosystem, ids }]`, one
 *  per vulnerable package. Throws on anything that is not OSV's result shape. */
export function parseFindings(jsonText) {
  let doc;
  try {
    doc = JSON.parse(String(jsonText));
  } catch (e) {
    throw new Error(`OSV's --format json output did not parse (${e.message})`);
  }
  if (!doc || !Array.isArray(doc.results)) throw new Error('OSV\'s JSON output carries no `results` array');
  const out = [];
  for (const r of doc.results) {
    const path = r?.source?.path;
    if (typeof path !== 'string' || !Array.isArray(r?.packages)) throw new Error('an OSV result has no source.path or no packages array');
    for (const p of r.packages) {
      const ids = (p?.vulnerabilities ?? []).map((v) => v?.id).filter(Boolean);
      if (ids.length === 0) continue;
      out.push({ path, name: p?.package?.name, version: p?.package?.version, ecosystem: p?.package?.ecosystem, ids });
    }
  }
  return out;
}

/** A PR that changes one of these is graded on every lockfile: they change what
 *  every lockfile's grade means (an ignore added or removed, the grading itself). */
export const GRADE_ALL_WHEN_CHANGED = ['osv-scanner.toml', 'tooling/ci/scan-dependencies.mjs'];

/** PURE. The PR's scope from `git diff --name-only -z` output: `{ all, reason,
 *  lockfiles }`, where `lockfiles` is the changed paths that are lockfiles. */
export function prScopeFrom(diffZ, { config = 'osv-scanner.toml' } = {}) {
  const changed = String(diffZ).split('\0').filter(Boolean);
  const wide = changed.filter((p) => p === config || GRADE_ALL_WHEN_CHANGED.includes(p));
  return { all: wide.length > 0, reason: wide.join(', '), lockfiles: new Set(lockfilesFrom(diffZ)), changed: changed.length };
}

/** IMPURE. The files a pull request changed, as git sees them in this clone:
 *  merge-base(base, head)..head, renames as a delete plus an add. Throws a plain
 *  Error naming what failed; the caller turns it into COVERAGE LOST. */
export function prChangedFiles(root, spec) {
  const m = /^([0-9a-f]{40})\.\.([0-9a-f]{40})$/i.exec(String(spec ?? ''));
  // An empty event field gives `..<head>`, which git reads as HEAD..<head> — a
  // different range that can be empty and would grade nothing.
  if (!m) throw new Error(`--pr-range ${JSON.stringify(spec)} is not <40-hex base>..<40-hex head>`);
  const [, base, head] = m;
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  for (const [what, sha] of [['head', head], ['base', base]]) {
    if (git('cat-file', '-e', `${sha}^{commit}`).status !== 0) throw new Error(`--pr-range ${what} ${sha} is not in this clone — a shallow checkout? ci.yml's security-scan needs fetch-depth: 0`);
  }
  // A PR's base.sha is the base BRANCH TIP, which moves on after the PR forks; the
  // PR's own change is merge-base..head (scan-secrets.mjs reads the same range).
  const mb = git('merge-base', base, head);
  const from = mb.stdout?.trim();
  if (mb.status !== 0 || !/^[0-9a-f]{40}$/i.test(from ?? '')) throw new Error(`--pr-range: ${base} and ${head} share no merge-base`);
  const d = git('diff', '--name-only', '--no-renames', '-z', from, head);
  if (d.status !== 0) throw new Error(`git diff ${from}..${head} failed: ${(d.stderr || `exit ${d.status}`).trim()}`);
  return { from, head, diffZ: d.stdout };
}

/** IMPURE. One OSV run: `{ status, stdout, stderr, error }`. Bounded. */
export function runOsv(osv, args, cwd) {
  const r = spawnSync(osv, args, { cwd, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.code ?? r.error.message) : null };
}

/** A stop that graded nothing. Carries every line printed before it, so the caller
 *  prints the canary and floor lines that DID pass above the one that refused. */
export class CoverageLost extends Error {
  constructor(lines) {
    super(lines.at(-1));
    this.lines = lines;
  }
}

/** The whole scan. Returns `{ code: 0 | 1, lines, deferred }` and THROWS CoverageLost
 *  for exit 2; `run` and `prDiff` (the PR's changed files) are injectable for tests.
 *  `prRange` null grades every lockfile (a push, the daily scan of main). */
/** How many days ahead of an `ignoreUntil` the scan starts warning. */
export const EXPIRY_WARN_DAYS = 14;

const DAY_MS = 86_400_000;

/** osv-scanner.toml's `[[IgnoredVulns]]` entries as `{ id, until }`, `until` a Date or
 *  null when the entry carries no `ignoreUntil` this reader can parse. Line-based: the
 *  file is ours and holds only `key = value` lines, comments and table headers. */
export function ignoredVulnsFrom(tomlText) {
  const entries = [];
  let cur = null;
  for (const raw of String(tomlText).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.startsWith('[')) {
      cur = line === '[[IgnoredVulns]]' ? { id: null, until: null } : null;
      if (cur) entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    if (kv[1] === 'id') cur.id = kv[2].replace(/^"|"$/g, '');
    if (kv[1] === 'ignoreUntil') {
      const d = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(kv[2]) ? new Date(kv[2]) : null;
      cur.until = d && !Number.isNaN(d.getTime()) ? d : null;
    }
  }
  return entries;
}

/** The entries due within `days` of `now` (or already past, or undated), grouped by
 *  expiry day: `[{ day: 'YYYY-MM-DD' | null, daysLeft, ids }]`, soonest first. */
export function expiringIgnores(entries, now, days = EXPIRY_WARN_DAYS) {
  const byDay = new Map();
  for (const e of entries) {
    const daysLeft = e.until ? Math.ceil((e.until.getTime() - now.getTime()) / DAY_MS) : null;
    if (daysLeft !== null && daysLeft > days) continue;
    const day = e.until ? e.until.toISOString().slice(0, 10) : null;
    if (!byDay.has(day)) byDay.set(day, { day, daysLeft, ids: [] });
    byDay.get(day).ids.push(e.id ?? '(no id)');
  }
  return [...byDay.values()].sort((a, b) => (a.daysLeft ?? -Infinity) - (b.daysLeft ?? -Infinity));
}

/** One printable line per group from [expiringIgnores]. */
export function expiryLine(g) {
  const when =
    g.day === null
      ? 'carry no ignoreUntil this scan can read'
      : g.daysLeft <= 0
        ? `expired on ${g.day}`
        : `expire on ${g.day} (in ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'})`;
  return `⚠ ${g.ids.length} osv-scanner.toml ignore(s) ${when}: ${g.ids.join(', ')}. Fix them or re-date each with a reason before the date; on it, main's daily scan reddens on every one still listed.`;
}

export function scanDependencies({ root, osv, config, run = runOsv, lockfiles = null, tmp = tmpdir(), prRange = null, prDiff = prChangedFiles, now = new Date() }) {
  const lines = [];
  const lost = (why) => {
    throw new CoverageLost([...lines, `✗ COVERAGE LOST — ${why}`]);
  };
  const rootAbs = resolve(root);
  const cfg = resolve(rootAbs, config ?? 'osv-scanner.toml');
  let cfgText;
  try {
    cfgText = readFileSync(cfg, 'utf8');
  } catch {
    lost(`${cfg} does not exist. The scan passes --config explicitly (without it v2 resolves a config per lockfile DIRECTORY and ignores nothing for packages/tokens — run 33960900452), so a missing file is not a default.`);
  }
  const expiring = expiringIgnores(ignoredVulnsFrom(cfgText), now);
  for (const g of expiring) lines.push(expiryLine(g));

  // 0 · the PR's scope, resolved FIRST: a range git cannot name is COVERAGE LOST
  // before OSV is asked anything, never a silent fall-back to "grade nothing".
  let scope = null;
  if (prRange !== null) {
    let pr;
    try {
      pr = prDiff(rootAbs, prRange);
    } catch (e) {
      lost(e.message);
    }
    scope = prScopeFrom(pr.diffZ, { config: relativeTo(rootAbs, cfg) ?? 'osv-scanner.toml' });
    lines.push(
      scope.all
        ? `· pull request ${pr.from.slice(0, 12)}..${pr.head.slice(0, 12)} changes ${scope.reason}, so EVERY lockfile is graded`
        : `· pull request ${pr.from.slice(0, 12)}..${pr.head.slice(0, 12)}: ${scope.changed} file(s) changed, ${scope.lockfiles.size} of them lockfile(s)${scope.lockfiles.size ? ` (${[...scope.lockfiles].join(', ')})` : ''} — only those are graded; the canary and the floor run in full`,
    );
  }

  // 1 · the lockfile set
  let tracked;
  try {
    tracked = lockfiles ?? trackedLockfiles(rootAbs);
  } catch (e) {
    lost(e.message);
  }
  if (tracked.length === 0) lost(`git ls-files at ${rootAbs} names no lockfile, so a scan would read nothing and print "No issues found".`);
  const formats = [...new Set(tracked.map(basename))].sort();
  lines.push(`· ${tracked.length} tracked lockfile(s) in ${formats.length} format(s): ${formats.join(', ')}`);
  const uncovered = formats.filter((f) => !CANARIES.has(f));
  if (uncovered.length) lost(`the tree tracks ${uncovered.join(', ')} and CANARIES has no canary for it — a format OSV has never been shown to flag here. Add one to tooling/ci/scan-dependencies.mjs.`);

  // 2 · the canary
  const dir = mkdtempSync(join(tmp, 'nikatru-osv-canary-'));
  try {
    for (const f of formats) {
      mkdirSync(join(dir, f.replace(/[^A-Za-z0-9]/g, '_')), { recursive: true });
      writeFileSync(join(dir, f.replace(/[^A-Za-z0-9]/g, '_'), f), CANARIES.get(f).body);
    }
    const canaryRoot = realpathSync(dir);
    const c = run(osv, ['scan', 'source', '-r', '--config', cfg, '--format', 'json', '.'], canaryRoot);
    if (c.error) lost(`the canary run could not start OSV (${c.error}) — ${osv}`);
    if (c.status !== 1) lost(`the canary run exited ${c.status}, not 1. OSV was handed ${formats.length} lockfile(s) pinning versions with published advisories and did not report a finding. stderr: ${c.stderr.trim().split('\n').slice(-3).join(' | ') || '<none>'}`);
    let found;
    try {
      found = parseFindings(c.stdout);
    } catch (e) {
      lost(`canary: ${e.message}`);
    }
    for (const f of formats) {
      const { pkg } = CANARIES.get(f);
      const hit = found.find((x) => basename(String(x.path).replace(/\\/g, '/')) === f && x.name === pkg.name && x.version === pkg.version);
      if (!hit) lost(`the ${f} canary (${pkg.name}@${pkg.version}) was NOT flagged. OSV stopped reading that format, stopped reaching its database, or osv-scanner.toml ignores that advisory or ecosystem — any of which blinds the tree scan the same way.`);
      lines.push(`✓ canary ${f}: ${pkg.name}@${pkg.version} flagged (${hit.ids.length} advisory id(s), e.g. ${hit.ids[0]})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3 · the tree, with the floor
  const t = run(osv, ['scan', 'source', '-r', '--config', cfg, '--format', 'json', '.'], rootAbs);
  if (t.error) lost(`the tree run could not start OSV (${t.error})`);
  if (t.status !== 0 && t.status !== 1) lost(`the tree run exited ${t.status} (0 = clean, 1 = findings; anything else is OSV failing). stderr: ${t.stderr.trim().split('\n').slice(-3).join(' | ') || '<none>'}`);
  const scanned = new Map();
  const outside = [];
  for (const s of parseScanned(t.stderr)) {
    const rel = relativeTo(rootAbs, s.path);
    if (rel === null) outside.push(s.path);
    else scanned.set(rel, s.packages);
  }
  const missing = tracked.filter((p) => !scanned.has(p));
  const empty = tracked.filter((p) => scanned.get(p) === 0);
  if (missing.length || empty.length) {
    lost(
      `the FLOOR is ${tracked.length} (git ls-files) and OSV read ${tracked.length - missing.length - empty.length} with packages. ` +
        [missing.length ? `Not read: ${missing.join(', ')}.` : '', empty.length ? `Read with 0 packages: ${empty.join(', ')}.` : ''].filter(Boolean).join(' '),
    );
  }
  lines.push(`✓ floor ${tracked.length}/${tracked.length}: every tracked lockfile was read — ${tracked.map((p) => `${p} (${scanned.get(p)})`).join(', ')}`);
  const extra = [...scanned.keys()].filter((p) => !tracked.includes(p));
  if (extra.length || outside.length) lines.push(`· also read (untracked, not counted): ${[...extra, ...outside].join(', ')}`);

  let findings;
  try {
    findings = parseFindings(t.stdout);
  } catch (e) {
    lost(`tree: ${e.message}`);
  }
  if (t.status === 1 && findings.length === 0) lost('OSV exited 1 (findings) and its JSON names no vulnerable package, so the two answers disagree.');
  if (t.status === 0 && findings.length > 0) lost(`OSV exited 0 (clean) and its JSON names ${findings.length} vulnerable package(s), so the two answers disagree.`);
  if (findings.length === 0) {
    lines.push('✓ no advisory against any tracked lockfile');
    return { code: 0, lines, deferred: 0, expiring };
  }
  const graded = [];
  const deferred = [];
  for (const f of findings) {
    const rel = relativeTo(rootAbs, f.path) ?? f.path;
    const at = `${rel}: ${f.name}@${f.version} (${f.ecosystem}) — ${f.ids.join(', ')}`;
    (scope === null || scope.all || scope.lockfiles.has(rel) ? graded : deferred).push(at);
  }
  for (const at of deferred) lines.push(`· not this pull request's: ${at}`);
  if (deferred.length) {
    lines.push(
      `· ${deferred.length} vulnerable package(s) in lockfile(s) this pull request did not change — printed, not graded here. ` +
        "ops-watch.yml's dependency-advisories job grades main daily and owns them: fix each in its own PR, or acknowledge it in osv-scanner.toml with a dated ignoreUntil.",
    );
  }
  if (graded.length === 0) {
    lines.push('✓ no advisory against a lockfile this pull request changed');
    return { code: 0, lines, deferred: deferred.length, expiring };
  }
  for (const at of graded) lines.push(`✗ ${at}`);
  lines.push(
    `✗ ${graded.length} vulnerable package(s)${scope && !scope.all ? ' in lockfile(s) this pull request changed' : ''}. Move each to a fixed version in the lockfile named; ` +
      'an advisory that cannot be fixed yet is acknowledged in osv-scanner.toml with a dated ignoreUntil, never without one.',
  );
  return { code: 1, lines, deferred: deferred.length, expiring };
}

/** The CLI's arguments: `{ osv, config, prRange, root }`, or null when they do not parse. */
export function parseArgs(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const osv = at('--osv');
  const config = at('--config');
  const prRange = at('--pr-range');
  const skip = new Set();
  for (const f of ['--osv', '--config', '--pr-range']) {
    const i = argv.indexOf(f);
    if (i >= 0) skip.add(i).add(i + 1);
  }
  const positional = argv.filter((_, i) => !skip.has(i));
  if (!osv || positional.length > 1 || positional.some((p) => p.startsWith('--'))) return null;
  // `--pr-range` given with no value (an empty event field) is refused, never read as "no range".
  if (argv.includes('--pr-range') && !prRange) return null;
  return { osv, config, prRange: prRange ?? null, root: positional[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: node tooling/ci/scan-dependencies.mjs --osv <path> [--config <file>] [--pr-range <base>..<head>] [repoRoot]');
    process.exitCode = 2;
  } else {
    try {
      const { code, lines, deferred, expiring } = scanDependencies(args);
      for (const l of lines) (code === 0 ? console.log : console.error)(l);
      if (process.env.GITHUB_ACTIONS === 'true') {
        for (const g of expiring) console.log(`::warning title=osv-scanner.toml ignores near expiry (${g.day ?? 'undated'})::${expiryLine(g)}`);
      }
      if (deferred && process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::warning title=${deferred} advisory(ies) on main, not this PR's::Printed in the step log and not graded here; ops-watch's daily dependency-advisories scan of main owns them.`);
      }
      console.log(code === 0 ? 'ok dependency scan — canary fired, floor held, clean' : 'FAIL 🔴 dependency advisories stand (exit 1)');
      process.exitCode = code === 0 ? 0 : 1;
    } catch (e) {
      if (e instanceof CoverageLost) {
        for (const l of e.lines) console.error(l);
        console.log('FAIL 🔴 COVERAGE LOST (exit 2) — nothing above is a clean result');
        process.exitCode = 2;
      } else {
        throw e;
      }
    }
  }
}
