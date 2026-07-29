// ─────────────────────────────────────────────────────────────────────────────
// input-contract.test.mjs — assert-input-contract.mjs must be able to FAIL.
//
// [pipeline S-1 · S-8 · S-13] The app spec is one validated input contract.
//
// ⚠️ THE REAL-TREE MUTATIONS CAME FIRST (2026-07-29, five of them, each
// grep-verified to have landed) and these fixtures were written afterwards to
// match what they showed. One of the five SURVIVED, and that is the reason this
// guard looks the way it does:
//
//   M1 a 9th var added with no rule          -> caught
//   M2 the category rule deleted             -> NOT CAUGHT at first
//   M3 refusal logs instead of throwing      -> caught
//   M4 the existence check removed           -> caught
//   M5 a NEW phantom filename (not app.yaml) -> caught
//
// 🔴 M2 IS THE ONE TO REMEMBER. The per-var check was `\bcategory\b` against the
// whole hook — and deleting the rule left it GREEN, because the word survives in
// the `categories` list, in a comment, and in the error message it prints. The
// declaration-vs-usage trap, for the fifth time in this repo, inside the guard
// written to prevent it. A var now counts as ruled only if the hook READS IT OUT
// OF THE SPEC (`v('name')` / `vars['name']`), which prose cannot satisfy.
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

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-input-contract.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-spec-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK = 'tooling/bricks/app';
const YAML = `${BRICK}/brick.yaml`;
const PRE = `${BRICK}/hooks/pre_gen.dart`;
const POST = `${BRICK}/hooks/post_gen.dart`;

/** Eight vars, matching the real brick — a thinner one fails for the wrong reason. */
const VARS = ['app_id', 'needs_backend', 'display_name', 'subdomain',
              'api_domain', 'seed_hex', 'category', 'description'];

const goodYaml = (vars = VARS) =>
  `name: app\ndescription: stamps an app\n\nvars:\n` +
  vars.map((v) => `  ${v}:\n    type: string\n    prompt: ${v}\n`).join('');

/** A hook that READS every var and can reject on each. */
const goodPreGen = (vars = VARS) => `
import 'dart:io';
import 'package:mason/mason.dart';

void run(HookContext context) {
  final problems = <String>[];
  String v(String key) => (context.vars[key] ?? '').toString().trim();
${vars.map((x) => `  final ${x}_x = v('${x}');\n  if (${x}_x == 'no') { problems.add('${x} is bad'); }`).join('\n')}

  final appId = v('app_id');
  final target = Directory('apps/$appId');
  if (target.existsSync()) { problems.add('exists'); }

  if (problems.isNotEmpty) {
    throw Exception('invalid app spec: \${problems.length}');
  }
}
`;

const goodPostGen = `
import 'package:mason/mason.dart';
void run(HookContext context) {
  context.logger.info('stamped');
}
`;

function tree({ yaml = goodYaml(), pre = goodPreGen(), post = goodPostGen } = {}) {
  const root = join(TMP, `r${seq++}`);
  for (const [f, body] of Object.entries({ [YAML]: yaml, [PRE]: pre, [POST]: post })) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-input-contract', () => {
  test('passes when every declared var is read and refusal throws', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /8 declared var\(s\)/);
    assert.match(out, /every one of the 8 declared var\(s\) is named by a rule/);
  });

  // ── "every" must not be able to shrink ───────────────────────────────────
  test('FAILS when a NEW var arrives with no rule', () => {
    const { code, out } = run(tree({ yaml: goodYaml([...VARS, 'tagline']) }));
    assert.equal(code, 1);
    assert.match(out, /NO rule in .*pre_gen\.dart: tagline/);
  });

  // 🔴 M2, the mutation that survived the first version of this guard.
  test('FAILS when a rule is deleted but the word survives in prose', () => {
    // `category` still appears in a comment, in a list name and in a message —
    // exactly the shape that fooled `\bcategory\b`.
    const gutted = goodPreGen(VARS.filter((v) => v !== 'category'))
      .replace("void run(HookContext context) {",
        "// category must be one of the known categories\n" +
        "const categories = ['travel'];\n" +
        "void run(HookContext context) {");
    const { code, out } = run(tree({ pre: gutted }));
    assert.equal(code, 1, 'the word category survives in prose; only the READ was removed');
    assert.match(out, /NO rule in .*pre_gen\.dart: category/);
  });

  test('FAILS when the parser stops seeing the vars block', () => {
    const { code, out } = run(tree({ yaml: goodYaml(VARS.slice(0, 3)) }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — parsed only 3 var\(s\)/);
  });

  // ── refusal must be atomic ───────────────────────────────────────────────
  test('FAILS when the hook logs instead of throwing', () => {
    const { code, out } = run(tree({
      pre: goodPreGen().replace(/throw Exception\([^)]*\);/, 'context.logger.err("bad");'),
    }));
    assert.equal(code, 1);
    assert.match(out, /never throws/);
  });

  // ── [pipeline S-13] ──────────────────────────────────────────────────────
  test('FAILS when the re-stamp existence check is gone', () => {
    const { code, out } = run(tree({
      pre: goodPreGen().replace("final target = Directory('apps/$appId');", ''),
    }));
    assert.equal(code, 1);
    assert.match(out, /does not check whether apps\/<app_id> already exists/);
  });

  // ── phantom filenames: the CLASS, not the instance ───────────────────────
  test('FAILS on a phantom filename that is NOT app.yaml', () => {
    // A blacklist would stop `app.yaml` and wave this through.
    const { code, out } = run(tree({
      post: `${goodPostGen}\n// edit apps/config/store-listing.yaml before shipping\n`,
    }));
    assert.equal(code, 1);
    assert.match(out, /names `store-listing\.yaml`, which does not exist/);
  });

  test('does NOT fire on a filename that really exists', () => {
    const { code } = run(tree({
      post: `${goodPostGen}\n// see brick.yaml for the vars\n`,
    }));
    assert.equal(code, 0, 'brick.yaml exists in the fixture and is allowlisted');
  });
});
