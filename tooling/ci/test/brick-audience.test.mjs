// ─────────────────────────────────────────────────────────────────────────────
// brick-audience.test.mjs — the app brick offers no children's audience, and
// nothing in a register can make it start offering one.
//
// ⏱ 2026-10-01 — rv2-newproduct-007. Built 2026-08-07 ([pipeline K-16]), the
// brick accepted `audience: children` the day the duty-matrix row
// `children-surface-before-a-kids-app` turned `implemented` naming an artefact on
// disk — a design that let a register edit unblock a kids app. ADR no.068
// (LOCKED 2026-09-05) rules that day out: no NIKATRU app, extension or site
// targets children, the audience floor is 18, and age gates are never built. So
// the refusal is unconditional, it cites the decision, and the prompt stops
// offering the value.
//
// The subject is the REAL brick, read through dart-source.mjs's comment stripper
// (strings kept): the hook's own comments quote the retired design, and a scan
// that read prose would match the note explaining the removal. A stamp with
// `audience: children` needs Dart and mason, which this job does not have; the
// stamp itself is the probe lane's.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripDartComments } from '../dart-source.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PRE_GEN = 'tooling/bricks/app/hooks/pre_gen.dart';
const BRICK_YAML = 'tooling/bricks/app/brick.yaml';
const MATRIX = 'tooling/legal/duty-matrix.json';
const ROW = 'children-surface-before-a-kids-app';

/** pre_gen.dart with its comments blanked and its string literals kept. */
const preGenCode = () => stripDartComments(read(PRE_GEN));

/** What Dart prints from each run of adjacent single-quoted literals. */
const sentences = (code) =>
  [...code.matchAll(/'(?:[^'\\\n]|\\.)*'(?:\s*'(?:[^'\\\n]|\\.)*')*/g)].map((m) =>
    [...m[0].matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((l) => l[1]).join(''),
  );

/** The `audience:` var block of brick.yaml: its lines up to the next var. */
function audienceVar() {
  const lines = read(BRICK_YAML).split('\n');
  const at = lines.findIndex((l) => /^ {2}audience:\s*$/.test(l));
  assert.notEqual(at, -1, `${BRICK_YAML} declares no \`audience\` var, so this file checked nothing`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}\S/.test(l));
  return lines.slice(at + 1, end === -1 ? undefined : end);
}

describe('ADR no.068 — the brick offers no children\'s audience', () => {
  test('pre_gen accepts exactly one audience, `general`', () => {
    const m = preGenCode().match(/const\s+List<String>\s+audiences\s*=\s*<String>\[([^\]]*)\]/);
    assert.ok(m, `${PRE_GEN} no longer declares \`const List<String> audiences\`, so the accepted set was not read`);
    assert.deepEqual([...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]), ['general']);
  });

  test('the children refusal is unconditional: no duty-matrix row in code can unblock it', () => {
    const code = preGenCode();
    assert.ok(!code.includes(ROW), `${PRE_GEN} still names \`${ROW}\` in code: a register edit could unblock a kids app`);
    assert.ok(!/\b_surfaceExists\b/.test(code), `${PRE_GEN} still carries the surface check that unblocked children`);
  });

  test('the refusal for `children` cites ADR no.068 in what it prints', () => {
    const code = preGenCode();
    assert.match(code, /audience\s*==\s*'children'/, `${PRE_GEN} has no branch for \`children\` of its own`);
    const cited = sentences(code).filter((s) => /\bchildren\b/.test(s) && /\bADR no\.068\b/.test(s));
    assert.ok(cited.length > 0, `${PRE_GEN} refuses \`children\` without printing "ADR no.068"`);
  });

  test('brick.yaml prompts for `general` alone', () => {
    const prompt = audienceVar().find((l) => /^\s+prompt:/.test(l));
    assert.ok(prompt, `${BRICK_YAML}'s \`audience\` var has no prompt`);
    assert.doesNotMatch(prompt, /children/);
    assert.match(prompt, /\bgeneral\b/);
  });

  test(`the duty-matrix row \`${ROW}\` is withdrawn by ADR no.068`, () => {
    const row = JSON.parse(read(MATRIX)).duties.find((d) => d.id === ROW);
    assert.ok(row, `${MATRIX} has no \`${ROW}\` row`);
    assert.equal(row.status, 'withdrawn');
    assert.match(row.decisionRecord ?? '', /^Private\/decisions\/068-/);
  });
});
