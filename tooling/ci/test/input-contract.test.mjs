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
// 🔴 …AND M2 WAS ONLY HALF-FIXED, WHICH THE FIXTURE HID FOR MONTHS. The rewrite
// checked the READ and stopped there, while the guard's own comment said "READS
// it and can REJECT on it. Reading alone is not a rule". The fixture below
// mutated by removing the READ (`goodPreGen(VARS.filter(v => v !== 'category'))`)
// — the one thing the broken guard *did* catch — so it passed against the broken
// version: the fixture encoded the same misunderstanding as the guard.
//
// Re-proven on a copy of the REAL tree 2026-08-01, before any of the tests below
// were written: replacing the whole `category` rule in pre_gen.dart with
// `context.logger.info('category: $category')` (read kept, rejection deleted)
// left the guard printing `ok every one of the 8 declared var(s) is named by a
// rule`, exit 0 — and the aggregate `problems.add(` floor could not see it
// either, because the hook raises 11 against a floor of 8. Same for `seed_hex`.
// A rejection is now bound TO THE VAR: see the two "READ but nothing can REJECT"
// tests, and the false-alarm shapes beside them.
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

// [pipeline S-1r] The fixture now PRINTS A CHECKLIST, both branches, because the
// guard reads it. A post_gen with no checklist is COVERAGE LOST, not a pass —
// so a fixture without one would have quietly disabled the new limb for every
// case in this file.
//
// 🔴 IT ALSO CARRIES THE PROSE TRAP ON PURPOSE: the comment below quotes the
// retired instruction verbatim, exactly as the real hook's does. A limb that
// grepped the file instead of the printed literals would fire on this comment
// and could never go green.
const goodPostGen = `
import 'package:mason/mason.dart';

// Historical note: this used to say "Add DNS for <host>" before [ADR 006]
// locked the wildcard. The words survive HERE, in prose, and must not count.
void run(HookContext context) {
  final needsBackend = context.vars['needs_backend'] == true;
  if (needsBackend) {
    context.logger
      ..success('Stamped x. Owner checklist:')
      ..info('  1. Add store metadata.')
      ..info('  2. NO DNS RECORD IS NEEDED — the wildcard already resolves; ATTACH the host.');
  } else {
    context.logger
      ..success('Stamped x (CLIENT-ONLY). Owner checklist:')
      ..info('  1. Add store metadata.')
      ..info('  2. NO DNS RECORD IS NEEDED — the wildcard already resolves; ATTACH the host.');
  }
}
`;

// ── [pipeline S-12] the two stamped-backend files ───────────────────────────
//
// 🔴 THESE WERE OUTSIDE EVERY SCAN UNTIL 2026-08-06. `provision-backend.mjs`
// landed 2026-07-29 and the post-gen checklist was updated to name it, but the
// stamped `wrangler.jsonc` header and the stamped service `README.md` went on
// telling the reader to transcribe the uuid by hand — the exact step S-12's
// "no hand-editing of placeholders" exists to delete. This guard exited 0
// throughout, because `SCAN` covered three brick files and neither was one of
// them. The two documents a person actually has open while provisioning were
// the two nothing read.
const BACKEND = `${BRICK}/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api`;
const goodWrangler = `{
  // After stamping, one command — nothing here is hand-edited:
  //   node tooling/scripts/provision-backend.mjs {{app_id}}
  // It creates the D1, writes the id below, and applies the migration.
  "d1_databases": [
    { "binding": "APP_DB", "database_id": "00000000-0000-0000-0000-000000000000" }
  ]
}
`;
const goodBackendReadme = `# {{app_id}}-api

## Provision (one command)

    node tooling/scripts/provision-backend.mjs {{app_id}}

Writes \`database_id\` into wrangler.jsonc and applies the starter migration.
`;

function tree({
  yaml = goodYaml(),
  pre = goodPreGen(),
  post = goodPostGen,
  wrangler = goodWrangler,
  backendReadme = goodBackendReadme,
  omit = [],
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {
    [YAML]: yaml,
    [PRE]: pre,
    [POST]: post,
    [`${BACKEND}/wrangler.jsonc`]: wrangler,
    [`${BACKEND}/README.md`]: backendReadme,
  };
  for (const [f, body] of Object.entries(files)) {
    if (omit.includes(f)) continue;
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
  test('passes when every declared var is read, rejectable, and refusal throws', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /8 declared var\(s\)/);
    assert.match(out, /every one of the 8 declared var\(s\) is read AND can be rejected on/);
  });

  // ── "every" must not be able to shrink ───────────────────────────────────
  test('FAILS when a NEW var arrives with no rule', () => {
    const { code, out } = run(tree({ yaml: goodYaml([...VARS, 'tagline']) }));
    assert.equal(code, 1);
    assert.match(out, /NEVER READ in .*pre_gen\.dart: tagline/);
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
    assert.match(out, /NEVER READ in .*pre_gen\.dart: category/);
  });

  // ── 🔴 THE HALF OF M2 THAT WAS NEVER IMPLEMENTED: read ≠ rule ─────────────
  test('FAILS when the rule is gutted to a read-and-print, keeping the READ', () => {
    // This is the real-tree mutation verbatim: `v('category')` is still read, the
    // value is still used — but nothing can reject on it, so a free-text category
    // stamps an app that a store will bounce months later.
    const gutted = goodPreGen().replace(
      "  final category_x = v('category');\n  if (category_x == 'no') { problems.add('category is bad'); }",
      "  final category_x = v('category');\n  context.logger.info('category: $category_x');",
    );
    assert.notEqual(gutted, goodPreGen(), 'the mutation must actually land — good != bad');
    const { code, out } = run(tree({ pre: gutted }));
    assert.equal(code, 1, 'reading a var to print it is not a rule');
    assert.match(out, /READ but nothing can REJECT on them/);
    assert.match(out, /category \(read into `category_x`\)/);
  });

  test('the aggregate problems.add floor alone cannot see it — the per-var bind is what catches it', () => {
    // Two rules gutted, and FOUR spare rejections added so the aggregate count
    // stays comfortably above MIN_VARS. On the real tree the slack was three:
    // the hook raises 11 against a floor of 8.
    let pre = goodPreGen();
    for (const v of ['category', 'seed_hex']) {
      pre = pre.replace(
        `  final ${v}_x = v('${v}');\n  if (${v}_x == 'no') { problems.add('${v} is bad'); }`,
        `  final ${v}_x = v('${v}');\n  context.logger.info('${v}: $${v}_x');`,
      );
    }
    pre = pre.replace(
      '  if (problems.isNotEmpty) {',
      '  final spare = context.vars["unrelated"];\n' +
        '  if (spare == 1) { problems.add("a"); }\n' +
        '  if (spare == 2) { problems.add("b"); }\n' +
        '  if (spare == 3) { problems.add("c"); }\n' +
        '  if (spare == 4) { problems.add("d"); }\n' +
        '  if (problems.isNotEmpty) {',
    );
    const { code, out } = run(tree({ pre }));
    assert.equal(code, 1);
    assert.doesNotMatch(out, /raises only \d+ problem\(s\)/, 'the aggregate floor is satisfied — it is blind to this');
    assert.match(out, /READ but nothing can REJECT on them/);
    assert.match(out, /category/);
    assert.match(out, /seed_hex/);
  });

  test('the rejection must be a CONDITION — the error message reciting the var name does not count', () => {
    // Every message in the real hook names its own var. Matching strings would
    // make each message satisfy the rule it is describing.
    const gutted = goodPreGen().replace(
      "  final category_x = v('category');\n  if (category_x == 'no') { problems.add('category is bad'); }",
      "  final category_x = v('category');\n  if (somethingElse) { problems.add('category must be one of the known categories'); }",
    );
    const { code, out } = run(tree({ pre: gutted }));
    assert.equal(code, 1);
    assert.match(out, /READ but nothing can REJECT on them/);
  });

  // ⚠️ …and the legitimate shapes, or the tightening is the bug.
  test('PASSES when the read is inlined straight into the condition', () => {
    const inlined = goodPreGen().replace(
      "  final category_x = v('category');\n  if (category_x == 'no') { problems.add('category is bad'); }",
      "  if (v('category').isEmpty) { problems.add('category is bad'); }",
    );
    const { code, out } = run(tree({ pre: inlined }));
    assert.equal(code, 0, out);
  });

  // The walker must climb the WHOLE enclosing chain, not just the innermost
  // block: here only the OUTER condition names the var, and that is still a
  // rejection bound to it. Checking one level would falsely accuse this.
  test('PASSES when only an OUTER enclosing if names the var', () => {
    const nested = goodPreGen().replace(
      "  final category_x = v('category');\n  if (category_x == 'no') { problems.add('category is bad'); }",
      "  final category_x = v('category');\n" +
        '  if (category_x.isNotEmpty) {\n' +
        "    if (strict) { problems.add('category is bad'); }\n" +
        '  }',
    );
    const { code, out } = run(tree({ pre: nested }));
    assert.equal(code, 0, out);
  });

  test('a `for`/`while` header is not a rejection rule', () => {
    const looped = goodPreGen().replace(
      "  final category_x = v('category');\n  if (category_x == 'no') { problems.add('category is bad'); }",
      "  final category_x = v('category');\n" +
        '  for (final c in category_x.split(",")) { problems.add(c); }',
    );
    const { code, out } = run(tree({ pre: looped }));
    assert.equal(code, 1, 'a loop that always pushes is not a rule that can reject on the value');
    assert.match(out, /READ but nothing can REJECT on them/);
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

  // ── [pipeline S-1r] no printed step may be one a locked ADR retired ────────
  // The checklist said "Add DNS for <host>" for months after [ADR 006] locked a
  // proxied wildcard that made it unnecessary — and it named the WRONG LAYER: an
  // unattached host resolves fine and answers 522, so an owner debugging a dark
  // app was sent to the one thing that was already working.
  //
  // ⚠️ THE PREMISE IS A MEASUREMENT, NOT A DOCUMENT. Two corpus files
  // contradicted each other (the stage file's 522 observations vs
  // `00-TRACKER.md`, which still says the wildcard was never created), so it was
  // re-checked live 2026-08-01 over DNS-over-HTTPS — the system resolver has no
  // egress here and returns ECONNREFUSED even for a control name. Four random
  // labels under nikatru.com returned identical Cloudflare A records; the same
  // shape under two control domains returned none. The wildcard is answering.
  //
  // All five cases were mutation-proven against the real hook first, including
  // the two that must stay GREEN.
  test('the shipped checklist passes, and says how many branches it read', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /the printed checklist \(2 branch\(es\)\) names no retired instruction/);
  });

  test('FAILS when "Add DNS" comes back as a printed step', () => {
    const { code, out } = run(tree({
      post: goodPostGen.replace(
        "'  2. NO DNS RECORD IS NEEDED — the wildcard already resolves; ATTACH the host.'",
        "'  2. Add DNS for the web subdomain.'",
      ),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /prints a retired instruction — telling the owner to add a DNS record/);
    assert.match(out, /\[ADR 006\] locked a proxied wildcard/);
  });

  // 🔴 THE PROSE TRAP. The fixture's header comment quotes "Add DNS for <host>"
  // verbatim — as the real hook's does — so a grep over the file would fire here
  // and the limb could never be green. Match printed literals, not the note
  // explaining the removal.
  test('does NOT fire on a COMMENT that quotes the retired instruction', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
  });

  // The corrected wording contains the word "DNS". A lazier pattern would have
  // made the fix unshippable.
  test('does NOT fire on the corrected wording, which still says DNS', () => {
    const { code } = run(tree({
      post: goodPostGen.replace(
        "'  1. Add store metadata.'",
        "'  1. NO DNS RECORD IS NEEDED here either — the wildcard covers it.'",
      ),
    }));
    assert.equal(code, 0);
  });

  test('COVERAGE LOST when post_gen prints no checklist at all', () => {
    const { code, out } = run(tree({ post: goodPostGen.replace(/Owner checklist:/g, 'Next:') }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /prints no "Owner checklist:" at all/);
  });

  // The relationship, not a typed floor: the raw file and the extracted view are
  // two observations of the same thing, and they must agree. Here the checklist
  // moves into a raw string the literal-extractor cannot see.
  // ── [pipeline S-12] no hand-edit in the stamped backend ───────────────────
  //
  // ⚠️ MUTATED ON THE REAL TREE FIRST, all four caught there before any of these
  // were written: the original paste line restored to the real `wrangler.jsonc`,
  // the real README's "Set `database_id` after `wrangler d1 create`" line
  // restored, the provisioner un-named while `database_id` stayed, and the real
  // wrangler.jsonc moved away entirely.
  describe('the stamped backend may not ask for a hand-edit', () => {
    test('passes on the shipped files, and says how many it read', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0);
      assert.match(out, /the 2 stamped backend file\(s\) name the provisioner and ask for no hand-edit/);
    });

    test('FAILS when the paste instruction comes back to wrangler.jsonc', () => {
      const { code, out } = run(tree({
        wrangler: goodWrangler.replace(
          '  // It creates the D1',
          '  //   → paste the id into APP_DB.database_id below.\n  // It creates the D1',
        ),
      }));
      assert.equal(code, 1);
      assert.match(out, /retired hand-edit instruction — telling the reader to paste/);
    });

    test('FAILS when the README tells the reader to set database_id afterwards', () => {
      const { code, out } = run(tree({
        backendReadme: `${goodBackendReadme}\n- Set \`database_id\` after \`wrangler d1 create x_db --location apac\`.\n`,
      }));
      assert.equal(code, 1);
      assert.match(out, /telling the reader to set `database_id` after creating the database/);
    });

    // 🔴 THE STRUCTURAL LIMB, and the one that catches the NEXT phrasing rather
    // than this one. A named-pattern list only ever stops the wordings somebody
    // already thought of; showing the placeholder without naming what fills it
    // is the property itself.
    test('FAILS when database_id is shown but the provisioner is never named', () => {
      const { code, out } = run(tree({
        wrangler: goodWrangler.split('provision-backend.mjs').join('some-other-script.mjs'),
      }));
      assert.equal(code, 1);
      assert.match(out, /shows the reader `database_id` but never names `provision-backend\.mjs`/);
    });

    // A file that says nothing about database_id is not required to name the
    // provisioner — the rule must not fire on correct input, or it gets
    // switched off and then guards nothing.
    test('does NOT fire on a backend file that never mentions database_id', () => {
      const { code } = run(tree({
        backendReadme: '# api\n\nRoutes and secrets only.\n',
      }));
      assert.equal(code, 0);
    });

    // COVERAGE: this limb read ZERO files for a week while printing nothing at
    // all. A missing subject must be loud, never absent.
    test('COVERAGE LOST when a required backend file is gone', () => {
      const { code, out } = run(tree({ omit: [`${BACKEND}/wrangler.jsonc`] }));
      assert.equal(code, 1);
      assert.match(out, /is REQUIRED_COVERAGE for the S-12 hand-edit rule and could not be read/);
      assert.match(out, /read 1 of 2 required file\(s\)/);
    });
  });

  test('COVERAGE LOST when the extractor recovers fewer headers than the file has', () => {
    const { code, out } = run(tree({
      post: goodPostGen.replace(
        "..success('Stamped x (CLIENT-ONLY). Owner checklist:')",
        '..success(r"""Stamped x (CLIENT-ONLY). Owner checklist:""")',
      ),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /recovered 1 of 2 "Owner checklist:" header\(s\)/);
  });
});
