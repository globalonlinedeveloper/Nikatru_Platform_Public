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
// Exit 0 = the canary fired, the floor held and no advisory stands · 1 = an advisory
// against a tracked lockfile (each printed) · 2 = COVERAGE LOST (no lockfiles, a
// canary not flagged, a lockfile not read, an OSV exit outside 0/1, output that does
// not parse). 2 beats 1.
//
// Usage: node tooling/ci/scan-dependencies.mjs --osv <path> [--config <file>] [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
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

/** IMPURE. One OSV run: `{ status, stdout, stderr, error }`. Bounded. */
export function runOsv(osv, args, cwd) {
  const r = spawnSync(osv, args, { cwd, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.code ?? r.error.message) : null };
}

/** The whole scan. Returns `{ code, lines }`; `run` is injectable for tests. */
export function scanDependencies({ root, osv, config, run = runOsv, lockfiles = null, tmp = tmpdir() }) {
  const lines = [];
  const lost = (why) => ({ code: 2, lines: [...lines, `✗ COVERAGE LOST — ${why}`] });
  const rootAbs = resolve(root);
  const cfg = resolve(rootAbs, config ?? 'osv-scanner.toml');
  if (!existsSync(cfg)) return lost(`${cfg} does not exist. The scan passes --config explicitly (without it v2 resolves a config per lockfile DIRECTORY and ignores nothing for packages/tokens — run 33960900452), so a missing file is not a default.`);

  // 1 · the lockfile set
  let tracked;
  try {
    tracked = lockfiles ?? trackedLockfiles(rootAbs);
  } catch (e) {
    return lost(e.message);
  }
  if (tracked.length === 0) return lost(`git ls-files at ${rootAbs} names no lockfile, so a scan would read nothing and print "No issues found".`);
  const formats = [...new Set(tracked.map(basename))].sort();
  lines.push(`· ${tracked.length} tracked lockfile(s) in ${formats.length} format(s): ${formats.join(', ')}`);
  const uncovered = formats.filter((f) => !CANARIES.has(f));
  if (uncovered.length) return lost(`the tree tracks ${uncovered.join(', ')} and CANARIES has no canary for it — a format OSV has never been shown to flag here. Add one to tooling/ci/scan-dependencies.mjs.`);

  // 2 · the canary
  const dir = mkdtempSync(join(tmp, 'nikatru-osv-canary-'));
  try {
    for (const f of formats) {
      mkdirSync(join(dir, f.replace(/[^A-Za-z0-9]/g, '_')), { recursive: true });
      writeFileSync(join(dir, f.replace(/[^A-Za-z0-9]/g, '_'), f), CANARIES.get(f).body);
    }
    const canaryRoot = realpathSync(dir);
    const c = run(osv, ['scan', 'source', '-r', '--config', cfg, '--format', 'json', '.'], canaryRoot);
    if (c.error) return lost(`the canary run could not start OSV (${c.error}) — ${osv}`);
    if (c.status !== 1) return lost(`the canary run exited ${c.status}, not 1. OSV was handed ${formats.length} lockfile(s) pinning versions with published advisories and did not report a finding. stderr: ${c.stderr.trim().split('\n').slice(-3).join(' | ') || '<none>'}`);
    let found;
    try {
      found = parseFindings(c.stdout);
    } catch (e) {
      return lost(`canary: ${e.message}`);
    }
    for (const f of formats) {
      const { pkg } = CANARIES.get(f);
      const hit = found.find((x) => basename(String(x.path).replace(/\\/g, '/')) === f && x.name === pkg.name && x.version === pkg.version);
      if (!hit) return lost(`the ${f} canary (${pkg.name}@${pkg.version}) was NOT flagged. OSV stopped reading that format, stopped reaching its database, or osv-scanner.toml ignores that advisory or ecosystem — any of which blinds the tree scan the same way.`);
      lines.push(`✓ canary ${f}: ${pkg.name}@${pkg.version} flagged (${hit.ids.length} advisory id(s), e.g. ${hit.ids[0]})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 3 · the tree, with the floor
  const t = run(osv, ['scan', 'source', '-r', '--config', cfg, '--format', 'json', '.'], rootAbs);
  if (t.error) return lost(`the tree run could not start OSV (${t.error})`);
  if (t.status !== 0 && t.status !== 1) return lost(`the tree run exited ${t.status} (0 = clean, 1 = findings; anything else is OSV failing). stderr: ${t.stderr.trim().split('\n').slice(-3).join(' | ') || '<none>'}`);
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
    return lost(
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
    return lost(`tree: ${e.message}`);
  }
  if (t.status === 1 && findings.length === 0) return lost('OSV exited 1 (findings) and its JSON names no vulnerable package, so the two answers disagree.');
  if (t.status === 0 && findings.length > 0) return lost(`OSV exited 0 (clean) and its JSON names ${findings.length} vulnerable package(s), so the two answers disagree.`);
  if (findings.length === 0) {
    lines.push('✓ no advisory against any tracked lockfile');
    return { code: 0, lines };
  }
  for (const f of findings) {
    const rel = relativeTo(rootAbs, f.path) ?? f.path;
    lines.push(`✗ ${rel}: ${f.name}@${f.version} (${f.ecosystem}) — ${f.ids.join(', ')}`);
  }
  lines.push(
    `✗ ${findings.length} vulnerable package(s). Move each to a fixed version in the lockfile named; ` +
      'an advisory that cannot be fixed yet is acknowledged in osv-scanner.toml with a dated ignoreUntil, never without one.',
  );
  return { code: 1, lines };
}

function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const osv = at('--osv');
  const config = at('--config');
  const skip = new Set();
  for (const f of ['--osv', '--config']) {
    const i = argv.indexOf(f);
    if (i >= 0) skip.add(i).add(i + 1);
  }
  const positional = argv.filter((_, i) => !skip.has(i));
  if (!osv || positional.length > 1 || positional.some((p) => p.startsWith('--'))) {
    console.error('usage: node tooling/ci/scan-dependencies.mjs --osv <path> [--config <file>] [repoRoot]');
    return 2;
  }
  const root = positional[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { code, lines } = scanDependencies({ root, osv, config });
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  console.log(code === 0 ? 'ok dependency scan — canary fired, floor held, clean' : code === 1 ? 'FAIL 🔴 dependency advisories stand (exit 1)' : 'FAIL 🔴 COVERAGE LOST (exit 2) — nothing above is a clean result');
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
