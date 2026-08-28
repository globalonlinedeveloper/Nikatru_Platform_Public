// ─────────────────────────────────────────────────────────────────────────────
// case-count-honest.test.mjs — assert-case-count-honest.mjs must be able to FAIL.
//
// Pipeline requirement: Private/requirements/ → F-10.
//
// 🔴 THE DEFECT THE GUARD REMOVES IS A NUMBER WITH NO INDEPENDENT ARBITER.
// tooling/ci/test/coverage-manifest.json recorded 431 for guards.test.mjs, a
// file that runs 398 tests. The floor is produced by `countCases` in
// assert-guard-coverage.mjs and, until the guard under test here existed, the
// only thing that ever checked the floor was `countCases` again. A HOLLOW file
// was always caught, because the ratchet fails on a drop; an INFLATED one never
// was, and inflation ratchets in permanently.
//
// So the 431-vs-398 case below is not an illustration. It is the historical bug
// rebuilt as a fixture — a manifest saying 431 against a junit report showing
// 398 executed cases for that file — and it must EXIT 1. The repaired figure,
// 383 against the same 398, must EXIT 0, because `countCases` counts
// LINE-ANCHORED declarations and a case generated inside a loop runs without
// being declared. `floor <= executed`, never `==`.
//
// ⚠️ THE OTHER HALF OF THIS FILE IS THE COVERAGE RAIL, and it is the half that
// matters more. A guard handed an xml file decays into "compared nothing, found
// nothing wrong" the moment the reporter flag is dropped from a workflow, and
// that is this repository's single most repeated failure. Every way the
// comparison can range over less than the run did — an empty report, a report
// that is not junit, a report whose files match no manifest key, a manifest key
// no report mentions, a basename contributed by two directories — has a case
// here and each one asserts a NON-ZERO exit.
//
// ⚠️ THE WINDOWS AND LINUX PATH CASES ARE NOT DECORATION. CI is Linux and the
// host this was written on is Windows; the `file=` attribute is whatever the
// running machine spelled. Both fixtures are plain strings inside the xml and
// are never touched by the filesystem, which is exactly the point: the guard
// keys on BASENAME and canonicalises nothing, so a Linux report read on Windows
// and a Windows report read on Linux both land on `guards.test.mjs`.
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
import {
  basenameOf,
  dirOf,
  unescapeXml,
  parseJunitCases,
  tallyByBasename,
  compareFloors,
  parseArgs,
} from '../assert-case-count-honest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, '..', 'assert-case-count-honest.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-cch-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** The path a LINUX runner writes into `file=`. */
const LINUX_DIR = '/home/runner/work/Nikatru_Platform_Public/Nikatru_Platform_Public/tooling/ci/test';
/** The path a WINDOWS host writes into `file=`. Backslashes, drive letter, and
 *  a `C:` that `path.resolve` on Linux would turn into gibberish. */
const WINDOWS_DIR = 'C:\\Users\\dev\\Documents\\Nikatru_Platform_Public\\tooling\\ci\\test';

const xmlEscape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A junit document of the shape node's junit reporter emits.
 * `entries` is `[[absoluteFilePath, caseCount], …]`.
 */
function junit(entries, { omitFileAttr = false } = {}) {
  const suites = entries.map(([file, n], si) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const attrs = [
        `name="${xmlEscape(`case ${si}.${i} — is 3 > 2 & "quoted"?`)}"`,
        'time="0.000100"',
        'classname="test"',
        ...(omitFileAttr ? [] : [`file="${xmlEscape(file)}"`]),
      ];
      rows.push(`\t\t<testcase ${attrs.join(' ')}/>`);
    }
    return (
      `\t<testsuite name="suite ${si}" time="0.01" disabled="0" errors="0" tests="${n}" failures="0" skipped="0">\n` +
      `${rows.join('\n')}\n\t</testsuite>`
    );
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}

/** Writes a junit body and a manifest body to disk, returns both paths. */
function fixture({ xml, manifest }) {
  const dir = join(TMP, `f${seq++}`);
  mkdirSync(dir, { recursive: true });
  const junitPath = join(dir, 'junit.xml');
  const manifestPath = join(dir, 'coverage-manifest.json');
  if (xml !== null) writeFileSync(junitPath, xml);
  if (manifest !== null) {
    writeFileSync(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
  }
  return { junitPath, manifestPath };
}

const run = (args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** The pair of numbers the whole file is about, measured on the real tree. */
const GUARDS_EXECUTED = 398;
const GUARDS_FLOOR_INFLATED = 431; // what the manifest recorded, and could not possibly be true
const GUARDS_FLOOR_REPAIRED = 383; // what countCases says once string literals stop counting

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-case-count-honest — THE HISTORICAL BUG, rebuilt', () => {
  // 🔴 THE CASE THIS GUARD EXISTS FOR. Nothing in the tree could tell these two
  // manifests apart before it, because both of them were produced by the same
  // counter that the ratchet then trusted.
  test('431 recorded against 398 executed EXITS 1 and names both numbers', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, GUARDS_EXECUTED]]),
      manifest: { 'guards.test.mjs': GUARDS_FLOOR_INFLATED },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /guards\.test\.mjs/);
    assert.match(r.out, /floor 431/);
    assert.match(r.out, /executed 398/);
    assert.match(r.out, /33 promised case\(s\) do not exist/);
  });

  test('383 recorded against the SAME 398 executed EXITS 0 — the gap is legitimate', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, GUARDS_EXECUTED]]),
      manifest: { 'guards.test.mjs': GUARDS_FLOOR_REPAIRED },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok {2}case-count honesty/m);
    assert.match(r.out, /Total slack 15 case\(s\)/);
  });

  // An equality would turn every loop-generated case into a permanent red, and a
  // check that is permanently red is a check somebody deletes.
  test('floor EXACTLY equal to executed passes — this is a floor, not an equality', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, GUARDS_EXECUTED]]),
      manifest: { 'guards.test.mjs': GUARDS_EXECUTED },
    });
    assert.equal(run(['--junit', junitPath, '--manifest', manifestPath]).code, 0);
  });

  test('ONE over is already a failure — the boundary is exact', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, GUARDS_EXECUTED]]),
      manifest: { 'guards.test.mjs': GUARDS_EXECUTED + 1 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /1 promised case\(s\) do not exist/);
  });

  test('every violating file is named, not just the first', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([
        [`${LINUX_DIR}/guards.test.mjs`, 398],
        [`${LINUX_DIR}/money-config.test.mjs`, 32],
        [`${LINUX_DIR}/app-dod.test.mjs`, 32],
      ]),
      manifest: { 'guards.test.mjs': 431, 'money-config.test.mjs': 35, 'app-dod.test.mjs': 32 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /2 recorded floor\(s\) claim MORE coverage/);
    assert.match(r.out, /guards\.test\.mjs — floor 431/);
    assert.match(r.out, /money-config\.test\.mjs — floor 35/);
    // app-dod is honest at 32 == 32 and must not be dragged into the report.
    assert.equal(/app-dod\.test\.mjs — floor/.test(r.out), false);
  });

  // A floor that is not a number cannot be compared, and `'431' > 398` is false
  // in JavaScript only by accident of coercion. Refusing beats coercing.
  test('a floor that is not a number is a violation, never a silent pass', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 398]]),
      manifest: { 'guards.test.mjs': '431' },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /which is not a number/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-case-count-honest — CI is Linux, this host is Windows', () => {
  test('a LINUX absolute path resolves to the manifest key', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 10]]),
      manifest: { 'guards.test.mjs': 10 },
    });
    assert.equal(run(['--junit', junitPath, '--manifest', manifestPath]).code, 0);
  });

  // The string below never touches the filesystem, which is the whole reason
  // this passes on a Linux runner: nothing is resolved, realpath'd or stat'd.
  test('a WINDOWS absolute path resolves to the same manifest key', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${WINDOWS_DIR}\\guards.test.mjs`, 10]]),
      manifest: { 'guards.test.mjs': 10 },
    });
    assert.equal(run(['--junit', junitPath, '--manifest', manifestPath]).code, 0);
  });

  test('and a Windows-spelled inflation is caught exactly as a Linux one is', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${WINDOWS_DIR}\\guards.test.mjs`, 398]]),
      manifest: { 'guards.test.mjs': 431 },
    });
    assert.equal(run(['--junit', junitPath, '--manifest', manifestPath]).code, 1);
  });

  test('basenameOf splits on BOTH separators, whatever platform is reading', () => {
    assert.equal(basenameOf('/home/runner/work/x/tooling/ci/test/guards.test.mjs'), 'guards.test.mjs');
    assert.equal(basenameOf('C:\\Users\\dev\\tooling\\ci\\test\\guards.test.mjs'), 'guards.test.mjs');
    assert.equal(basenameOf('C:/Users/dev/mixed\\seps/guards.test.mjs'), 'guards.test.mjs');
    assert.equal(basenameOf('guards.test.mjs'), 'guards.test.mjs');
  });

  test('basenameOf refuses non-strings rather than throwing mid-scan', () => {
    for (const bad of [null, undefined, 42, {}, []]) assert.equal(basenameOf(bad), '');
  });

  test('dirOf normalises both separators so a collision message is readable', () => {
    assert.equal(dirOf('C:\\a\\b\\guards.test.mjs'), 'C:/a/b');
    assert.equal(dirOf('/a/b/guards.test.mjs'), '/a/b');
    assert.equal(dirOf('guards.test.mjs'), '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE COVERAGE RAIL. Each case below is an input under which a comparison
// could range over nothing and print ok. Each asserts a NON-ZERO exit.
describe('assert-case-count-honest — COVERAGE LOST, never a pass', () => {
  test('no --junit at all', () => {
    const r = run([]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no --junit/);
  });

  test('a --junit path that does not exist', () => {
    const { manifestPath } = fixture({ xml: null, manifest: { 'guards.test.mjs': 1 } });
    const r = run(['--junit', join(TMP, 'nope', 'absent.xml'), '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /does not exist/);
  });

  test('an EMPTY junit file', () => {
    const { junitPath, manifestPath } = fixture({ xml: '   \n', manifest: { 'guards.test.mjs': 1 } });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /is EMPTY/);
  });

  test('an UNPARSEABLE junit file — something else entirely', () => {
    const { junitPath, manifestPath } = fixture({
      xml: '<!doctype html><html><body>502 Bad Gateway</body></html>',
      manifest: { 'guards.test.mjs': 1 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /not a junit document/);
  });

  test('a junit document with NO testcase in it', () => {
    const { junitPath, manifestPath } = fixture({
      xml: '<?xml version="1.0"?>\n<testsuites>\n</testsuites>\n',
      manifest: { 'guards.test.mjs': 1 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /NO test case at all/);
  });

  test('testcases carrying no file= are unattributable, not zero', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]], { omitFileAttr: true }),
      manifest: { 'guards.test.mjs': 1 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no file= attribute/);
  });

  test('a report whose files match NO manifest key', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/some-other-suite.test.mjs`, 20]]),
      manifest: { 'guards.test.mjs': 383, 'money-config.test.mjs': 32 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /not one of the 2 file\(s\)/);
  });

  // The subtlest one: the report matches SOME keys, so the guard happily prints
  // ok about those — and the floors it never looked at read exactly like floors
  // that hold. This is the shape a shrinking test glob produces.
  test('a manifest key the report never mentions — a floor arbitrated by nothing', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 398]]),
      manifest: { 'guards.test.mjs': 383, 'money-config.test.mjs': 32 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /arbitrated by NOTHING/);
    assert.match(r.out, /money-config\.test\.mjs — recorded 32/);
  });

  // Two directories, one basename: summing them would inflate `executed` and
  // weaken the only comparison this guard makes.
  test('one basename contributed by TWO directories is refused, not summed', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([
        [`${LINUX_DIR}/guards.test.mjs`, 200],
        [`${LINUX_DIR}/vendored/guards.test.mjs`, 200],
      ]),
      manifest: { 'guards.test.mjs': 398 },
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /MORE THAN ONE directory/);
  });

  test('a manifest that does not exist', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]]),
      manifest: null,
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('a manifest that is not JSON', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]]),
      manifest: '{ this is not json',
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /could not be parsed/);
  });

  test('a manifest that is an ARRAY, not an object of floors', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]]),
      manifest: '["guards.test.mjs"]',
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /not a JSON object/);
  });

  test('an EMPTY manifest accepts any suite at all, so it is refused', () => {
    const { junitPath, manifestPath } = fixture({
      xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]]),
      manifest: {},
    });
    const r = run(['--junit', junitPath, '--manifest', manifestPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /is EMPTY/);
  });

  // A misspelled flag in a workflow must not read as "nothing to do".
  test('an unrecognised argument is refused rather than ignored', () => {
    const { junitPath } = fixture({ xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 5]]), manifest: null });
    const r = run(['--juint', junitPath]);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /unrecognised argument/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-case-count-honest — reading the report', () => {
  // 🔴 `/<testcase[^>]*>/` would stop at the `&gt;`-free `>` a test NAME can
  // carry. The fixture's names contain `>` and `&` and `"` on purpose.
  test('a `>` inside a test name does not truncate the tag', () => {
    const xml = junit([[`${LINUX_DIR}/guards.test.mjs`, 3]]);
    assert.match(xml, /is 3 &gt; 2 &amp;/);
    const { cases, unattributed } = parseJunitCases(xml);
    assert.equal(cases.length, 3);
    assert.equal(unattributed, 0);
  });

  test('a RAW `>` inside a single-quoted attribute value still does not truncate', () => {
    const xml =
      '<testsuites><testsuite name="s">' +
      "<testcase name='a > b' classname='test' file='/x/guards.test.mjs'/>" +
      '</testsuite></testsuites>';
    const { cases } = parseJunitCases(xml);
    assert.equal(cases.length, 1);
    assert.equal(cases[0].file, '/x/guards.test.mjs');
  });

  test('`<testcases>` is not `<testcase>`', () => {
    const xml = '<testsuites><testcases file="/x/y.test.mjs"/></testsuites>';
    const { cases, unattributed } = parseJunitCases(xml);
    assert.equal(cases.length, 0);
    assert.equal(unattributed, 0);
  });

  test('a testcase with CHILDREN (a failure) is counted once, not twice', () => {
    const xml =
      '<testsuites><testsuite name="s">' +
      '<testcase name="broken" classname="test" file="/x/guards.test.mjs">' +
      '<failure type="testCodeFailure" message="boom">stack</failure>' +
      '</testcase></testsuite></testsuites>';
    const { cases } = parseJunitCases(xml);
    assert.equal(cases.length, 1);
  });

  test('escaped entities in a path are decoded before it is keyed', () => {
    assert.equal(unescapeXml('a&amp;b'), 'a&b');
    assert.equal(unescapeXml('&lt;x&gt;'), '<x>');
    assert.equal(unescapeXml('&quot;q&quot;'), '"q"');
    assert.equal(unescapeXml('&apos;s&apos;'), "'s'");
    assert.equal(unescapeXml('&#65;&#x42;'), 'AB');
    assert.equal(unescapeXml('plain'), 'plain');
  });

  test('a path carrying an escaped ampersand still lands on its basename', () => {
    const xml =
      '<testsuites><testsuite name="s">' +
      '<testcase name="x" file="/home/runner/R&amp;D/tooling/ci/test/guards.test.mjs"/>' +
      '</testsuite></testsuites>';
    const { cases } = parseJunitCases(xml);
    assert.equal(cases[0].file, '/home/runner/R&D/tooling/ci/test/guards.test.mjs');
    assert.equal(basenameOf(cases[0].file), 'guards.test.mjs');
  });

  test('tallyByBasename counts per file and records the directories, as ARRAYS', () => {
    const { counts, dirs } = tallyByBasename([
      { file: '/a/b/guards.test.mjs' },
      { file: '/a/b/guards.test.mjs' },
      { file: 'C:\\a\\b\\money-config.test.mjs' },
    ]);
    assert.equal(counts.get('guards.test.mjs'), 2);
    assert.equal(counts.get('money-config.test.mjs'), 1);
    // 🔴 ARRAYS, not Sets — `JSON.stringify(new Set([...]))` prints `{}` and
    // this shape is printed inside an error message.
    assert.deepEqual(dirs.get('guards.test.mjs'), ['/a/b']);
    assert.equal(JSON.stringify(dirs.get('guards.test.mjs')), '["/a/b"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-case-count-honest — the verdict, as a pure function', () => {
  test('compareFloors separates violations from unarbitrated floors', () => {
    const counts = new Map([['guards.test.mjs', 398]]);
    const v = compareFloors({ 'guards.test.mjs': 431, 'gone.test.mjs': 5 }, counts);
    assert.deepEqual(v.violations, [{ file: 'guards.test.mjs', floor: 431, executed: 398, unreadable: false }]);
    assert.deepEqual(v.unarbitrated, ['gone.test.mjs']);
    assert.deepEqual(v.arbitrated, ['guards.test.mjs']);
    assert.deepEqual(v.collisions, []);
  });

  test('compareFloors is silent when every floor holds', () => {
    const counts = new Map([['guards.test.mjs', 398], ['money-config.test.mjs', 32]]);
    const v = compareFloors({ 'guards.test.mjs': 383, 'money-config.test.mjs': 32 }, counts);
    assert.deepEqual(v.violations, []);
    assert.deepEqual(v.unarbitrated, []);
    assert.equal(v.arbitrated.length, 2);
  });

  test('compareFloors reports a collision without dropping the comparison', () => {
    const counts = new Map([['guards.test.mjs', 400]]);
    const dirs = new Map([['guards.test.mjs', ['/a', '/b']]]);
    const v = compareFloors({ 'guards.test.mjs': 383 }, counts, dirs);
    assert.deepEqual(v.collisions, [{ file: 'guards.test.mjs', dirs: ['/a', '/b'] }]);
  });

  test('a floor of 0 against a file that ran cases is not a violation', () => {
    const v = compareFloors({ 'x.test.mjs': 0 }, new Map([['x.test.mjs', 3]]));
    assert.deepEqual(v.violations, []);
  });

  test('parseArgs takes both `--k v` and `--k=v`, and collects the rest', () => {
    assert.deepEqual(parseArgs(['--junit', 'a.xml']), { junit: 'a.xml', manifest: null, unknown: [] });
    assert.deepEqual(parseArgs(['--junit=a.xml', '--manifest=m.json']), {
      junit: 'a.xml',
      manifest: 'm.json',
      unknown: [],
    });
    assert.deepEqual(parseArgs(['--nope']).unknown, ['--nope']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guard against THE REAL REPOSITORY. Without this every case above is
// consistent with a guard that works perfectly on fixtures and has been wired
// to a path that does not exist — the assert-seams-wired shape, where all six
// fixtures passed against a broken guard.
describe('assert-case-count-honest — the real tree', () => {
  test('the guard file is where the workflow names it', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
    assert.match(GUARD, /assert-case-count-honest\.mjs$/);
  });

  // The default manifest — no --manifest flag — must be the committed ratchet,
  // not a path relative to whatever cwd the runner happened to have.
  test('with no --manifest it reads the committed ratchet, whatever the cwd', () => {
    const { junitPath } = fixture({ xml: junit([[`${LINUX_DIR}/guards.test.mjs`, 398]]), manifest: null });
    const r = spawnSync(process.execPath, [GUARD, '--junit', junitPath], {
      encoding: 'utf8',
      cwd: tmpdir(),
    });
    const out = `${r.stdout}${r.stderr}`;
    // It reaches the real 148-key manifest and reports the floors it could not
    // arbitrate — which proves it found the manifest, from an unrelated cwd.
    assert.equal(r.status, 1);
    assert.match(out, /arbitrated by NOTHING/);
    assert.match(out, /a11y-coverage\.test\.mjs — recorded/);
  });
});
