// -----------------------------------------------------------------------------
// assert-versions.test.mjs - every pin in tooling/versions.json carries its
// reason, and every retire condition is re-read at the current `flutter` pin.
//
// tooling/ci/assert-versions.mjs is finding B-8 of the round-2 review
// (2026-09-29): `java` and `melos` had no reason, and native_stack_traces'
// retire condition named Flutter 3.47.4 while the pin was 3.47.5.
//
//   G0 GREEN CONTROL - the committed file passes and SAYS its counts
//   R1 a pin with no reason -> exit 1, named (the real tree: $java_comment removed)
//   R2 a $reasonsIn listing under prose that never names the pin -> exit 1
//   R3 a stale $reasonsIn listing (no such pin, a pin with its own comment, or
//      listed twice) -> exit 1; and the map never takes the `"<pin>": "..."`
//      shape Renovate's matchers would read as a second copy of the pin
//   T1 a retire record read at a Flutter version that is not the pin -> exit 1
//      (the real tree: the `flutter` pin bumped with nothing re-read)
//   T2 a retire condition NAMING another Flutter version in `when` -> exit 1
//   T3 a comment that states a retire condition with no record beside it -> exit 1
//   C1 could not look -> exit 2, never green: unreadable, not JSON, no pins,
//      no `flutter` pin
//
// Run:  node --test tooling/ci/test/assert-versions.test.mjs
// -----------------------------------------------------------------------------
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeVersions, namesKey, RETIRE_CONDITION } from '../assert-versions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling', 'ci', 'assert-versions.mjs');
const REAL = () => JSON.parse(readFileSync(join(ROOT, 'tooling', 'versions.json'), 'utf8'));

/** A root holding one tooling/versions.json, for the CLI. `text` is written verbatim. */
function rootWith(text) {
  const root = mkdtempSync(join(tmpdir(), 'assert-versions-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  if (text !== null) writeFileSync(join(root, 'tooling', 'versions.json'), text);
  return root;
}
const cli = (root) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });

/** The smallest file that passes: one reasoned pin and the flutter pin. */
const minimal = () => ({
  $flutter_comment: ['The Flutter SDK every lane builds with; bumped by a person because pubspec.lock must be regenerated.'],
  flutter: '3.47.5',
  $tool_comment: ['A tool pinned exactly, because a floating tool changes what two runs of one commit do.'],
  tool: '1.2.3',
});

describe('G0 green control', () => {
  test('the committed tooling/versions.json passes, and the line says how each pin is reasoned', () => {
    const v = judgeVersions(REAL());
    assert.equal(v.code, 0, v.lines.join('\n'));
    assert.match(v.lines[0], /^ok {2}assert-versions: \d+ pin\(s\), \d+ reasoned \(/);
    assert.match(v.lines[0], /1 retire record\(s\) read at the flutter pin 3\.\d+\.\d+/);
  });
  test('the CLI over the real repository exits 0', () => {
    const r = cli(ROOT);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });
  test('the minimal fixture passes (so every red below is the one mutation)', () => {
    assert.equal(judgeVersions(minimal()).code, 0);
  });
});

describe('R - every pin carries its reason', () => {
  test('R1 RED CONTROL - a pin with no reason is exit 1, and named', () => {
    const doc = { ...minimal(), bare: '9.9.9' };
    const v = judgeVersions(doc);
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /✗ bare = "9\.9\.9" HAS NO REASON/);
  });
  test('R1 on the REAL tree: removing $java_comment reds it by name (the state before B-8)', () => {
    const doc = REAL();
    delete doc.$java_comment;
    const v = judgeVersions(doc);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /✗ java = "17" HAS NO REASON/);
  });
  test('R1 on the REAL tree through the CLI: removing $melos_comment exits 1', () => {
    const doc = REAL();
    delete doc.$melos_comment;
    const r = cli(rootWith(JSON.stringify(doc, null, 2)));
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /✗ melos = "8\.9\.0" HAS NO REASON/);
  });
  test('R1 an exemption why shorter than 40 characters is a label, not a reason', () => {
    const doc = { ...minimal(), dig: 'abc', $updateExemptions: [{ key: 'dig', why: 'a digest' }] };
    assert.equal(judgeVersions(doc).code, 1);
  });
  test('R1 control: an exemption with a real why reasons its pin', () => {
    const doc = { ...minimal(), dig: 'abc', $updateExemptions: [{ key: 'dig', why: 'A DIGEST, NOT A VERSION: no datasource resolves a file checksum.' }] };
    assert.equal(judgeVersions(doc).code, 0);
  });
  test('R2 a $reasonsIn listing under a comment that never names the pin is exit 1', () => {
    const doc = { ...minimal(), other: '2.0.0', $group_comment: ['Scanners, pinned exactly with their digests.'], $reasonsIn: { $group_comment: ['other'] } };
    const v = judgeVersions(doc);
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /which never names `other`/);
  });
  test('R2 control: the same pointer at a comment that names the pin (with `_` read as `-`) passes', () => {
    const doc = { ...minimal(), osv_scanner: '2.6.0', $group_comment: ['osv-scanner ships a bare binary.'], $reasonsIn: { $group_comment: ['osv_scanner'] } };
    assert.equal(judgeVersions(doc).code, 0);
  });
  test('R2 a $reasonsIn listing under a key that is not a comment is exit 1', () => {
    const doc = { ...minimal(), other: '2.0.0', $reasonsIn: { $nowhere_comment: ['other'] } };
    assert.match(judgeVersions(doc).lines.join('\n'), /which is not a comment in this file/);
  });
  test('R3 a $reasonsIn listing for a key that is not a pin is exit 1: the waiver outlived its subject', () => {
    const doc = { ...minimal(), $reasonsIn: { $tool_comment: ['gone'] } };
    const v = judgeVersions(doc);
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /lists gone, which is not a pin/);
  });
  test('R3 a $reasonsIn listing for a pin with its own comment is exit 1: two reasons drift', () => {
    const doc = { ...minimal(), $reasonsIn: { $flutter_comment: ['tool'] } };
    assert.match(judgeVersions(doc).lines.join('\n'), /which has its own \$tool_comment/);
  });
  test('R3 a pin listed under two comments is exit 1', () => {
    const doc = { ...minimal(), other: '2.0.0', $a_comment: ['other is pinned'], $b_comment: ['other again'], $reasonsIn: { $a_comment: ['other'], $b_comment: ['other'] } };
    assert.match(judgeVersions(doc).lines.join('\n'), /lists other under both \$a_comment and \$b_comment/);
  });
  test('R3 the committed $reasonsIn never holds a `"<pin>": "<text>"` pair a Renovate matcher could read as the pin', () => {
    const text = readFileSync(join(ROOT, 'tooling', 'versions.json'), 'utf8');
    const block = text.slice(text.indexOf('"$reasonsIn"'), text.indexOf('"$updateExemptions_comment"'));
    assert.ok(block.length > 0, 'the $reasonsIn block was not found - this control lost its subject');
    for (const pin of Object.keys(REAL()).filter((k) => !k.startsWith('$'))) {
      assert.doesNotMatch(block, new RegExp(`"${pin}":\\s*"`), `${pin} appears as "${pin}": "..." inside $reasonsIn`);
    }
  });
  test('namesKey reads whole tokens only', () => {
    assert.equal(namesKey('the node pin', 'node'), true);
    assert.equal(namesKey('nodejs', 'node'), false);
    assert.equal(namesKey('mason_cli was pinned', 'mason_cli'), true);
    assert.equal(namesKey('osv-scanner', 'osv_scanner'), true);
  });
});

describe('T - a retire condition is re-read at the current flutter pin', () => {
  const retire = (atFlutter, when = 'the flutter pin\'s own tool pins the decoder at the version this key installs.') => ({
    ...minimal(),
    $tool_comment: ['A decoder the bundled tool cannot replace yet. When the Flutter pin moves to a tool that pins it, this key can retire.'],
    $tool_retire: { when, atFlutter, checked: '2026-09-29', verify: 'curl -sS https://raw.githubusercontent.com/flutter/flutter/<pin>/packages/flutter_tools/pubspec.yaml' },
  });
  test('T0 control: a record read at the pin passes', () => {
    assert.equal(judgeVersions(retire('3.47.5')).code, 0);
  });
  test('T1 RED CONTROL - a record last read at Flutter 3.47.4 while the pin is 3.47.5 is exit 1', () => {
    const v = judgeVersions(retire('3.47.4'));
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /last read at Flutter "3\.47\.4" and the `flutter` pin is 3\.47\.5/);
  });
  test('T1 on the REAL tree: bumping the flutter pin with nothing re-read reds $native_stack_traces_retire', () => {
    const doc = REAL();
    doc.flutter = '3.47.99';
    const v = judgeVersions(doc);
    assert.equal(v.code, 1, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /✗ \$native_stack_traces_retire — its retire condition was last read at Flutter/);
  });
  test('T2 a retire condition whose `when` NAMES another Flutter version is exit 1', () => {
    const v = judgeVersions(retire('3.47.5', 'Flutter 3.47.4 ships a tool that pins the old decoder; when it pins the new one this key retires.'));
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /names Flutter 3\.47\.4, and the `flutter` pin is 3\.47\.5/);
  });
  test('T3 a comment that states a retire condition with no record beside it is exit 1 (the orphaned 3.47.4 shape)', () => {
    const doc = retire('3.47.5');
    delete doc.$tool_retire;
    const v = judgeVersions(doc);
    assert.equal(v.code, 1);
    assert.match(v.lines.join('\n'), /\$tool_comment states a retire condition and there is no \$tool_retire record/);
  });
  test('T3 on the REAL tree: removing $native_stack_traces_retire reds it (the state before B-8)', () => {
    const doc = REAL();
    delete doc.$native_stack_traces_retire;
    assert.match(judgeVersions(doc).lines.join('\n'), /\$native_stack_traces_comment states a retire condition/);
  });
  test('T4 a retire record for a key that is gone is exit 1', () => {
    const doc = { ...retire('3.47.5') };
    delete doc.tool;
    delete doc.$tool_comment;
    assert.match(judgeVersions(doc).lines.join('\n'), /\$tool_retire — tool is not a pin/);
  });
  test('T5 a record missing its date or its verify is exit 1', () => {
    const doc = retire('3.47.5');
    doc.$tool_retire = { ...doc.$tool_retire, checked: 'last week', verify: '' };
    const text = judgeVersions(doc).lines.join('\n');
    assert.match(text, /\$tool_retire\.checked — not a YYYY-MM-DD date/);
    assert.match(text, /\$tool_retire\.verify — missing/);
  });
  test('RETIRE_CONDITION reads the sentence the orphaned record had, and not a retired runner image', () => {
    assert.equal(RETIRE_CONDITION.test('When the Flutter pin moves to a tool that pins >= 0.7.0, this key can retire.'), true);
    assert.equal(RETIRE_CONDITION.test('a pinned label at least fails loudly when the image is finally retired.'), false);
  });
});

describe('C - could not look is exit 2, never green', () => {
  test('C1 no versions.json under the root', () => {
    const r = cli(rootWith(null));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COVERAGE LOST — tooling\/versions\.json could not be read/);
  });
  test('C1 versions.json that is not JSON', () => {
    const r = cli(rootWith('{ "flutter": '));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /is not JSON/);
  });
  test('C1 a file with no pins', () => {
    assert.equal(judgeVersions({ $comment: ['nothing pinned'] }).code, 2);
  });
  test('C1 a file with no flutter pin cannot judge any retire condition', () => {
    const doc = minimal();
    delete doc.flutter;
    delete doc.$flutter_comment;
    assert.equal(judgeVersions(doc).code, 2);
  });
  test('C1 an array is not the file', () => {
    assert.equal(judgeVersions([]).code, 2);
  });
});
