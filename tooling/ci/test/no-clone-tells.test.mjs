// ─────────────────────────────────────────────────────────────────────────────
// no-clone-tells.test.mjs — assert-no-clone-tells.mjs must be able to FAIL.
//
// [pipeline C-10] shared code carries no app-specific vocabulary. Named by C-10
// as its enforcement and marked VERIFIED while it did not exist.
//
// ⚠️ Mutated against the REAL tree first: an app name in shared code, a domain
// noun in shared code, and an empty noun list were all caught; a mention inside
// a COMMENT correctly did not fire. That last one is the design's load-bearing
// choice — shared code names "Subly" 8 times today and all 8 are comments, so a
// guard that scanned them would raise 8 false alarms on day one and be switched
// off within a week.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-no-clone-tells.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-tells-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE APP NAME IS DERIVED FROM THE DECLARATION, IN EVERY CASING THE GUARD
// LOOKS FOR — it is never typed into a fixture and never typed into an
// assertion.
//
// The guard derives the names it hunts for from the DIRECTORY NAMES under
// `apps/`. This file used to write `apps/subly` into its fixture tree and then
// spell `Subly`, `_SublyMigration` and `[Ss]ubly` into the bodies and the
// expected messages. Two literals, moved by hand, in lockstep — which means a
// global find-and-replace rewrote BOTH and every case went on passing while
// proving nothing about the rename.
//
// Then the `subly → subscriptiontracker` sweep hit the lowercase spellings and
// could not hit the CamelCase ones (`SublyThing`, `_SublyMigration`), and four
// cases went red: the fixture named one app and the tree declared another. That
// divergence is the whole reason for deriving. `APP` is read off
// `catalog/apps.json` — the published declaration — and `CAP` is the same value
// in the casing Dart spells a class in, so a rename cannot reach either by hand.
// ─────────────────────────────────────────────────────────────────────────────
const APP = (() => {
  const rows = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8'));
  const slugs = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.slug)
    .filter((s) => typeof s === 'string' && s !== '');
  assert.ok(slugs.length > 0, 'catalog/apps.json declares no slug — this test can derive nothing');
  return slugs[0];
})();
/** The app name as a Dart class is spelled. The guard generates exactly this
 *  variant (`w.charAt(0).toUpperCase() + w.slice(1)`), so the fixtures below
 *  exercise the camelCase half of the pattern rather than asserting it exists. */
const CAP = APP.charAt(0).toUpperCase() + APP.slice(1);
/** Escape a derived value for use inside `new RegExp`. */
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The message the guard prints, in whichever casing the fixture used. */
const NAMES_THE_APP = new RegExp(`shared code names the app "(${rx(APP)}|${rx(CAP)})"`);

/** apps/<APP> + 12 clean shared files (the floor is 10), plus whatever `extra`
 *  the case needs. `nouns` overrides the domain list. */
function tree({ extra = {}, nouns = ['subscription', 'renewal'], omitTells = false } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  mkdirSync(join(root, 'apps', APP), { recursive: true });
  for (let i = 0; i < 12; i++) files[join(root, `packages/core/lib/clean${i}.dart`)] = 'class A {}\n';

  const reg = { consumerRoots: [], capabilities: [] };
  if (!omitTells) reg.cloneTells = { domainNouns: nouns };
  files[join(root, 'tooling/capability-register.json')] = JSON.stringify(reg, null, 2);

  for (const [rel, body] of Object.entries(extra)) files[join(root, rel)] = body;
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the passing path', () => {
  test('app-neutral shared code passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no clone tells/);
  });
});

describe('limb 1 — the app name', () => {
  test('fails on an app name in shared CODE', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': `const k = '${APP}';\n` } }));
    assert.equal(code, 1);
    assert.match(out, NAMES_THE_APP);
  });

  test('fails on an app name in the BRICK TEMPLATE too', () => {
    const { code } = run(tree({ extra: { 'tooling/bricks/app/__brick__/x.dart': `class ${CAP}Thing {}\n` } }));
    assert.equal(code, 1);
  });

  test('a string literal counts as code — a hardcoded config key was a real defect', () => {
    const { code } = run(tree({ extra: { 'packages/core/lib/x.dart': `final m = {'${APP}': 1};\n` } }));
    assert.equal(code, 1);
  });

  // 🔴 THE PRIVATE HALF, mutation-proven on the real tree 2026-08-01: appending
  // `_subscriptiontrackerLegacyLimit` and `class _SublyMigration` to packages/core/lib/src/
  // result.dart left the guard printing "no clone tells". `_` is a WORD
  // character, so the leading `\b` in the old pattern could never fire inside
  // `_subscriptiontracker…` — and in Dart the underscore prefix is how you spell "private", so
  // the ENTIRE private surface of every shared package was out of scope while
  // the public `subscriptiontrackerLegacyLimit` was caught. Restoring the leading `\b` turns
  // both of these red.
  for (const [shape, body] of [
    ['a private lowerCamel constant', `const int _${APP}LegacyLimit = 5;\n`],
    ['a private class', `class _${CAP}Migration {}\n`],
    ['a private field', `class A { final int _${APP}Retries = 1; }\n`],
  ]) {
    test(`fails on the app name inside ${shape}`, () => {
      const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': body } }));
      assert.equal(code, 1, `underscore-prefixed identifiers are code too: ${body.trim()}`);
      assert.match(out, NAMES_THE_APP);
    });
  }

  // The false-alarm side: widening the left edge to "not a letter or digit" must
  // not start matching longer, unrelated words. Both near-misses are built from
  // the SAME derived name the cases above use, so they cannot drift into being
  // unrelated words for a reason other than the one under test.
  test('a longer unrelated word still does NOT fire', () => {
    const { code, out } = run(tree({
      extra: { 'packages/core/lib/x.dart': `const a = 1; // ok\nclass ${CAP}x {}\nconst my${APP} = 2;\n` },
    }));
    assert.equal(code, 0, out);
  });
});

describe('limb 2 — domain vocabulary', () => {
  test('fails on a banned domain noun in shared code', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': 'class X { void renewal() {} }\n' } }));
    assert.equal(code, 1);
    assert.match(out, /domain word "renewal"/i);
  });

  test('a word not on the list does not fire', () => {
    const { code } = run(tree({ extra: { 'packages/core/lib/x.dart': 'class X { void recipe() {} }\n' } }));
    assert.equal(code, 0);
  });

  // 🔴 A BANNED WORD THAT CANNOT MATCH ITSELF IS AN ASSERTION THAT CANNOT FAIL.
  // The variant list was lower/Capital/UPPER only, so the register's camelCase
  // entries — `billingCycle`, `freeTrial`, `merchantName` — expanded to
  // `billingcycle|BillingCycle|BILLINGCYCLE` and matched none of the three ways
  // the word is actually written in Dart. Three of the six domain nouns in
  // tooling/capability-register.json were dead on arrival.
  test('fails on a camelCase domain noun spelled exactly as the register spells it', () => {
    const { code, out } = run(tree({
      nouns: ['billingCycle'],
      extra: { 'packages/core/lib/x.dart': 'class X { int billingCycle = 1; }\n' },
    }));
    assert.equal(code, 1, 'the register entry could not match its own spelling');
    assert.match(out, /domain word "billingCycle"/);
  });

  test('fails on a PRIVATE camelCase domain noun', () => {
    const { code, out } = run(tree({
      nouns: ['billingCycle'],
      extra: { 'packages/core/lib/x.dart': 'class X { int _billingCycleDays = 1; }\n' },
    }));
    assert.equal(code, 1);
    assert.match(out, /domain word "billingCycle"/);
  });
});

describe('🔴 comments are exempt — the choice the guard lives or dies by', () => {
  test('a line comment naming the app does NOT fire', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': `// Mirrors ${APP}'s proven config.\nclass A {}\n` } }));
    assert.equal(code, 0, out);
  });

  test('a block comment naming the app does NOT fire', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': `/* subscription handling lived in ${APP} */\nclass A {}\n` } }));
    assert.equal(code, 0, out);
  });

  test('a trailing comment does NOT fire, but code on the same line DOES', () => {
    const clean = run(tree({ extra: { 'packages/core/lib/x.dart': `class A {} // was ${APP}-specific\n` } }));
    assert.equal(clean.code, 0, clean.out);
    const dirty = run(tree({ extra: { 'packages/core/lib/x.dart': `const k = '${APP}'; // note\n` } }));
    assert.equal(dirty.code, 1);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the domain list is empty — it would pass everything', () => {
    const { code, out } = run(tree({ nouns: [] }));
    assert.equal(code, 2, out); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /cannot fail is worse than none/);
  });

  test('COVERAGE LOST when cloneTells is absent entirely', () => {
    const { code, out } = run(tree({ omitTells: true }));
    assert.equal(code, 2, out); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(out, /no non-empty `cloneTells.domainNouns`/);
  });

  test('COVERAGE LOST when too little shared source is found', () => {
    const root = tree();
    for (let i = 0; i < 12; i++) rmSync(join(root, `packages/core/lib/clean${i}.dart`));
    const { code, out } = run(root);
    assert.equal(code, 2, out); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE STRIPPER WAS THREE REGEXES AND A `//` COMMENT COULD BLIND IT (2026-08-07)
//
// `stripComments` ran the block pattern FIRST, so a `/*` inside a LINE comment
// opened a phantom block running to the next `*​/` — swallowing every line
// between, INCLUDING real code. Measured the same day in
// assert-ops-register.mjs, where the identical pair ate lines 32-134 of
// assert-ceiling-budget.mjs and the real `const CEILINGS = 'tooling/ceilings.json';`.
//
// Today's 217-file Dart corpus lost only comment prose, which is exactly why
// this needed a mutation rather than a green run: the blindness is a property of
// the scanner, not of the comments that happen to be in the tree this week.
// ─────────────────────────────────────────────────────────────────────────────
describe('the stripper is a tokenizer — a comment cannot hide a tell', () => {
  test('🔴 an app name AFTER a line comment containing `/*` still fails', () => {
    const { code, out } = run(tree({
      extra: {
        'packages/core/lib/x.dart':
          '// generated files live under services/*/src/ — see the runbook\n' +
          `const k = '${APP}';\n` +
          "const doc = 'the span above would close here */';\n",
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, NAMES_THE_APP);
  });

  test('a tell inside a REAL comment is still exempt — the repair is not collateral damage', () => {
    const { code, out } = run(tree({
      extra: { 'packages/core/lib/x.dart': `// ${APP} used to do this\n/* and subscription too */\nclass A {}\n` },
    }));
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [ADR 070] — A DOMAIN NOUN IN A FILE GENERATED FROM A CONTRACT THAT NAMES IT
//
// The exception is derived from four independent facts about the tree, and
// every case below withholds exactly ONE of them and proves the guard still
// exits 1. The GREEN CONTROL comes first, so a red that is really "the fixture
// never worked" cannot be read as the guard biting.
//
//   (a) the file's LEADING comment block says GENERATED and names a path under
//       contracts/ that exists
//   (b) a generator under contracts/ names this file's repo-relative path
//   (c) the token found is in that contract's CODE, comments stripped
//   (d) a workflow invokes that generator with `--check`
//
// ⏱ (c) TIGHTENED AND (d) ADDED 2026-09-06. Facts (a)–(c) are all read off
// SOURCE TEXT and none of them looks at the file's CONTENT, so "generated" was
// an assertion the tree never had to make good on: measured on this branch,
// two hand-typed lines appended to the real generated Dart left this guard at
// EXIT 0 and assert-entitlement-contract.mjs at EXIT 0, and the only thing that
// caught them was `contracts/entitlement/generate-dart.mjs --check` — which NO
// workflow invoked. (d) makes the exemption conditional on that gate being
// wired; the gate's own red/green pair is in entitlement-contract.test.mjs.
//
// App names are never exempt, and the rule is scoped to packages/*/lib.
// ─────────────────────────────────────────────────────────────────────────────
const GEN_REL = 'packages/purchases/lib/src/generated/entitlement_contract.g.dart';

const GEN_HEADER =
  '// GENERATED FILE — DO NOT EDIT.\n' +
  '//\n' +
  '// Written by `node contracts/entitlement/generate-dart.mjs` from\n' +
  '// contracts/entitlement/contract.js, the one authored copy of the money\n' +
  '// vocabulary.\n';

/** The workflow step that makes fact (d) hold — the generator's own drift gate,
 *  invoked on every push. `workflow: false` withholds it; `workflow: 'no-check'`
 *  names the generator without running its `--check`, which is the near-miss:
 *  a step that touches the file is not a step that proves it. */
const WORKFLOW_WIRED =
  'name: Contracts\n' +
  'on: [pull_request]\n' +
  'jobs:\n' +
  '  contracts:\n' +
  '    steps:\n' +
  '      - run: node contracts/entitlement/generate-dart.mjs --check\n';

/** All four facts by default; pass a key to withhold or corrupt exactly one. */
function generated(opts = {}) {
  const {
    header = GEN_HEADER,
    body = "const r = 'subscription_expired';\n",
    contract = "export const REVOCATION_REASONS = ['subscription_expired'];\n",
    generator = true,
    workflow = true,
    rel = GEN_REL,
  } = opts;
  const extra = {};
  extra[rel] = header + '\n' + body;
  if (contract !== null) extra['contracts/entitlement/contract.js'] = contract;
  if (generator) extra['contracts/entitlement/generate-dart.mjs'] = "const REL = '" + rel + "';\n";
  if (workflow === true) extra['.github/workflows/contracts.yml'] = WORKFLOW_WIRED;
  else if (typeof workflow === 'string') extra['.github/workflows/contracts.yml'] = workflow;
  return extra;
}

describe('[ADR 070] generated from a contract that names the noun', () => {
  test('THE GREEN CONTROL: all four facts hold — exempt, and the count is PRINTED', () => {
    const { code, out } = run(tree({ extra: generated() }));
    assert.equal(code, 0, out);
    assert.match(out, /1 finding\(s\) exempt as generated from a contract \[ADR 070\]/, out);
    assert.match(out, /contracts\/entitlement\/contract\.js/, out);
  });

  test('a HAND-WRITTEN file with the same noun is still refused — no generated header', () => {
    const { code, out } = run(tree({ extra: generated({ header: '// the money rail table\n' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('(a) withheld — the header names a contract that does NOT exist', () => {
    const { code, out } = run(tree({ extra: generated({ contract: null }) }));
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('(b) withheld — no generator under contracts/ writes this path, so the header is prose', () => {
    const { code, out } = run(tree({ extra: generated({ generator: false }) }));
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('(c) withheld — the contract exists but does NOT contain the token', () => {
    const { code, out } = run(
      tree({ extra: generated({ contract: "export const R = ['trial_expired'];\n" }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('the exemption is PER TOKEN, not per file — a second noun the contract lacks still fails', () => {
    const { code, out } = run(
      tree({ extra: generated({ body: "const a = 'subscription_expired';\nconst b = 'renewal';\n" }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "renewal"/);
    assert.doesNotMatch(out, /the domain word "subscription"/);
  });

  test('🔴 an APP NAME in a perfectly generated file is NEVER exempt', () => {
    const { code, out } = run(
      tree({ extra: generated({ body: `const r = 'subscription_expired';\nconst app = '${APP}';\n` }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, NAMES_THE_APP);
  });

  test('the rule is scoped to packages/*/lib — the brick cannot claim it', () => {
    const rel = 'tooling/bricks/app/__brick__/entitlement.dart';
    const { code, out } = run(tree({ extra: generated({ rel }) }));
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('the header must LEAD — a GENERATED comment further down does not count', () => {
    const { code, out } = run(
      tree({
        extra: generated({
          header: 'class Head {}\n// GENERATED FILE — DO NOT EDIT, from contracts/entitlement/contract.js\n',
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('a generator .mjs is not a contract — its own source cannot supply fact (c)', () => {
    // The header names generate-dart.mjs too. If that file counted as the
    // contract, writing the noun into the GENERATOR would buy the exemption.
    const extra = generated({ contract: "export const R = ['trial_expired'];\n" });
    extra['contracts/entitlement/generate-dart.mjs'] =
      "const REL = '" + GEN_REL + "';\n// subscription_expired lives here now\n";
    const { code, out } = run(tree({ extra }));
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('(c) — the token in a COMMENT in the contract does not count', () => {
    // 🔴 THE EXEMPTION WAS BUYABLE. fact (c) read the RAW contract source, so a
    // `// renewal` typed into contracts/entitlement/contract.js would have made
    // `renewal` portfolio-wide in every file generated from it — while the
    // guard's own header sold (c) as "the EXACT token appearing in that
    // contract". The contract's CODE is what is read now.
    const { code, out } = run(
      tree({
        extra: generated({
          contract: "// subscription_expired is coming later\nexport const R = ['trial_expired'];\n",
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
  });

  test('(d) withheld — nothing invokes the generator, so nothing re-derives the premise', () => {
    // THE REFUTATION THIS CASE EXISTS FOR. Facts (a), (b) and (c) all hold and
    // the file really is generated — but with the drift gate unwired, a hand
    // edit to it reddens nothing, so "generated" is a header rather than a
    // property. The message has to NAME the generator, because the fix is in a
    // workflow file and not in the file the finding points at.
    // ⏱ 2026-09-15 — a workflow that runs something else is what "unwired" means; a
    // tree with NO workflow at all is the blind case below, not this finding.
    const { code, out } = run(
      tree({
        extra: {
          ...generated({ workflow: false }),
          '.github/workflows/some-other-lane.yml': 'jobs:\n  x:\n    steps:\n      - run: node tooling/ci/assert-something.mjs\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /shared code uses the domain word "subscription"/);
    assert.match(out, /no workflow under \.github\/workflows invokes contracts\/entitlement\/generate-dart\.mjs with --check/);
  });

  test('(d) BLIND — zero workflow lines read is COVERAGE LOST (exit 2), not "unwired" (2026-09-15)', () => {
    const { code, out } = run(tree({ extra: generated({ workflow: false }) }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .* claims to be generated by contracts\/entitlement\/generate-dart\.mjs, and ZERO workflow lines were read/);
    assert.doesNotMatch(out, /shared code uses the domain word/);
  });

  test('(d) — a workflow that names the generator WITHOUT --check is not a gate', () => {
    // The near-miss: a step that regenerates the file (or merely mentions it)
    // proves nothing about whether the committed bytes match. Only `--check`
    // fails on drift; a bare run rewrites the file and exits 0.
    const { code, out } = run(
      tree({
        extra: generated({
          workflow:
            'jobs:\n  contracts:\n    steps:\n      - run: node contracts/entitlement/generate-dart.mjs\n',
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /with --check/);
  });

  test('(d) — a generator named only in a workflow COMMENT is not invoked', () => {
    // The same hazard selftest.node.js records for its own invoked set: every
    // workflow in this tree discusses the scripts it calls at length, and prose
    // satisfying a check is the defect this whole arrangement exists to prevent.
    const { code, out } = run(
      tree({
        extra: generated({
          workflow:
            'jobs:\n  contracts:\n    steps:\n' +
            '      # node contracts/entitlement/generate-dart.mjs --check is coming\n' +
            '      - run: echo nothing\n',
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /with --check/);
  });

  test('(d) — the invocation may live in ANY workflow, not a named one', () => {
    const { code, out } = run(
      tree({
        extra: {
          ...generated({ workflow: false }),
          '.github/workflows/some-other-lane.yml':
            'jobs:\n  x:\n    steps:\n      - run: node contracts/entitlement/generate-dart.mjs --check\n',
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 finding\(s\) exempt as generated from a contract \[ADR 070\]/, out);
  });

  test('no exemption, no note — the passing line does not carry a sentence that is always there', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ADR 070/);
  });
});
