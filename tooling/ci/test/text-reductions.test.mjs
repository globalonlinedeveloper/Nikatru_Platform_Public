// ─────────────────────────────────────────────────────────────────────────────
// text-reductions.test.mjs — the shared reductions, exercised directly.
//
// tooling/ci/text-reductions.mjs is not a guard: it is the ONE answer to "what
// does this text actually say", imported by NINE guards — check-site-integrity,
// assert-policy-archive, assert-policy-claims, assert-data-inventory,
// assert-licence-register, assert-analytics-contract, assert-e2e-legs,
// assert-flag-exposure and assert-worker-error-sink, of which SEVEN take
// stripSourceComments (all but check-site-integrity and assert-policy-archive,
// which take only the HTML reductions). It has no tree to scan, so it carries no
// COVERAGE LOST and is exempt in assert-guard-coverage.mjs's NOT_A_SCANNER — but
// it still owes a failing case, because nine guards' correctness passes
// through it. (This header said "five" until 2026-08-02, and an undercounted
// blast radius is how a shared defect gets triaged as a small one.)
//
// The cases that are NOT stylistic:
//   · a comment must not satisfy (or refute) a source check. Found by mutation:
//     an `absent` assertion over `cf-connecting-ip` fired on the line
//     "CF-Connecting-IP is NEVER read and NEVER stored".
//   · `//` inside a URL is not a comment. Naively stripping it would delete the
//     rest of every line containing an https:// literal.
//   · and the converse, which cost more: the stripper must never delete code it
//     did not comment out. Every test in the "never deletes code" block below is
//     a shape that was live in this repository on 2026-08-02 and was being
//     deleted from what five guards could see, silently, with all of them
//     exiting 0.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripInert,
  visibleText,
  decodeEntities,
  normaliseForMatch,
  emphasisedSpans,
  stripSourceComments,
  stripStringLiterals,
} from '../text-reductions.mjs';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFile, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('text-reductions.mjs — HTML to what a reader saw', () => {
  test('a commented-out promise is not page text', () => {
    const html = '<p>We keep data.</p><!-- <p>We never keep data.</p> -->';
    assert.ok(visibleText(html).includes('We keep data.'));
    assert.ok(!visibleText(html).includes('never'));
  });

  test('script and style source is not page text', () => {
    const html = '<style>.x{content:"forever"}</style><script>const s = "forever";</script><p>Hello</p>';
    assert.equal(visibleText(html), 'Hello');
  });

  test('stripInert keeps words apart rather than joining them', () => {
    assert.equal(visibleText('<b>one</b><b>two</b>'), 'one two');
  });

  test('entities decode, and only the named set plus numerics', () => {
    assert.equal(decodeEntities('a &mdash; b &amp; c &#65;'), 'a — b & c A');
  });

  test('normaliseForMatch folds curly quotes and dashes so a typed row matches a typeset page', () => {
    assert.equal(normaliseForMatch('the app&rsquo;s &ldquo;Settings&rdquo; &mdash; on'), "the app's \"Settings\" - on");
  });
});

describe('emphasisedSpans — the domain [pipeline K-3] quantifies over', () => {
  test('finds <b> and <strong> spans as the text a reader saw', () => {
    const spans = emphasisedSpans('<p><b>one</b> and <strong>two</strong></p>').map((s) => s.text);
    assert.deepEqual(spans, ['one', 'two']);
  });

  test('a nested emphasis is ONE claim, not two halves', () => {
    // A non-greedy regex would end the span at the inner </b> and report two
    // half-sentences where the page made one statement.
    const spans = emphasisedSpans('<p><b>we do <b>not</b> sell your data</b></p>').map((s) => s.text);
    assert.deepEqual(spans, ['we do not sell your data']);
  });

  test('emphasis inside a comment is not a published claim', () => {
    assert.deepEqual(emphasisedSpans('<!-- <b>we never log anything</b> --><p><b>real</b></p>').map((s) => s.text), [
      'real',
    ]);
  });

  test('an unclosed tag is malformed HTML, not a claim', () => {
    assert.deepEqual(emphasisedSpans('<p><b>dangling').map((s) => s.text), []);
  });

  test('an emphasis-stripping rewrite yields nothing — which is what makes COVERAGE LOST fire', () => {
    assert.deepEqual(emphasisedSpans('<p>plain text with no emphasis at all</p>'), []);
  });
});

describe('stripSourceComments — prose must not satisfy a code check', () => {
  test('a comment SAYING the thing never happens does not look like it happening', () => {
    // The recorded case: assert-policy-claims.mjs asserts events.ts never reads
    // CF-Connecting-IP, and failed on the comment declaring exactly that.
    const ts = '// CF-Connecting-IP is NEVER read and NEVER stored.\nconst geo = request.cf;\n';
    assert.ok(!/cf-connecting-ip/i.test(stripSourceComments(ts, '.ts')));
    assert.ok(stripSourceComments(ts, '.ts').includes('request.cf'));
  });

  test('a URL is not a line comment', () => {
    const ts = 'const u = "https://example.test/x"; const keep = 1;';
    assert.ok(stripSourceComments(ts, '.ts').includes('const keep = 1;'));
  });

  test('SQL uses -- and block comments', () => {
    const sql = '-- CREATE TABLE ghosts (id TEXT);\nCREATE TABLE real (id TEXT); /* CREATE TABLE other */';
    const out = stripSourceComments(sql, '.sql');
    assert.ok(!out.includes('ghosts'));
    assert.ok(!out.includes('other'));
    assert.ok(out.includes('CREATE TABLE real'));
  });

  test('YAML uses #, so a commented-out dependency is not a dependency', () => {
    const yaml = 'dependencies:\n  # google_mobile_ads: ^5.0.0\n  http: ^1.0.0\n';
    const out = stripSourceComments(yaml, '.yaml');
    assert.ok(!out.includes('google_mobile_ads'));
    assert.ok(out.includes('http:'));
  });

  test('an unknown extension is returned UNCHANGED rather than guessed at', () => {
    // Applying C-style rules to a language that does not have them would delete
    // real content, and a reduction that mangles its own subject is worse than
    // one that reads it whole.
    const text = 'a // b # c -- d';
    assert.equal(stripSourceComments(text, '.txt'), text);
  });

  test('line numbering survives, so line-oriented patterns still work', () => {
    const src = 'one\n// two\nthree\n';
    assert.equal(stripSourceComments(src, '.ts').split('\n').length, src.split('\n').length);
  });

  test('byte offsets survive, because a caller reporting a line slices the reduction', () => {
    const src = 'const a = 1; // note\n/* block */ const b = 2;\n';
    assert.equal(stripSourceComments(src, '.ts').length, src.length);
  });
});

describe('stripSourceComments — NEVER DELETES CODE IT DID NOT COMMENT OUT', () => {
  // Every input below was live in this repository on 2026-08-02 and was being
  // deleted from the reduction handed to the guards. None of them failed.

  test('a `//` line mentioning a path glob is not a block-comment opener', () => {
    // services/subly-api/src/middleware/cors.ts, verbatim in shape. The old
    // block-comment regex read the `/*` in this line comment as an opener and
    // ran to the next close delimiter — the end of the doc comment on the
    // `allowlist` function, sixty lines down — deleting the imports and the
    // LOCALHOST constant on the way.
    const ts = [
      '// The guard now iterates every services/*/wrangler.jsonc, and the rule',
      '// is identical in all three implementations.',
      '',
      "import { cors } from 'hono/cors';",
      '',
      'const LOCALHOST = /^https?:\\/\\/localhost(:\\d+)?$/;',
      '',
      '/** Exact origins. */',
      'export function allowlist() { return []; }',
    ].join('\n');
    const out = stripSourceComments(ts, '.ts');
    assert.ok(out.includes("import { cors } from 'hono/cors';"), 'the import must survive');
    assert.ok(out.includes('const LOCALHOST ='), 'the constant must survive');
    assert.ok(out.includes('export function allowlist()'), 'the declaration must survive');
    assert.ok(!out.includes('wrangler.jsonc'), 'and the comment must still go');
  });

  test('`//` inside a template literal is not a line comment', () => {
    // services/{platform,subly-api}/src/lib/error-sink.ts. The `[^:]` hack only
    // spared `https://`; the character before `//` here is `}`, so the endpoint
    // the Worker posts to was blanked out of the guard's view.
    const ts = 'const endpoint = `${u.protocol}//${u.host}/api/${id}/envelope/`; // build it\n';
    const out = stripSourceComments(ts, '.ts');
    assert.ok(out.includes('/api/${id}/envelope/`'), 'the URL must survive');
    assert.ok(!out.includes('build it'), 'the trailing comment must still go');
  });

  test('a `/*` inside a string literal does not open a comment', () => {
    const ts = ["const glob = 'services/*/wrangler.jsonc';", '', 'const keep = 1;', '/* end */'].join('\n');
    const out = stripSourceComments(ts, '.ts');
    assert.ok(out.includes('const keep = 1;'), 'a string is not a comment opener');
  });

  test('a nested template inside `${…}` does not end the outer literal', () => {
    // Without walking the substitution, the outer literal ends at the INNER
    // backtick, the URL after it is read as code, and its `//` blanks the rest
    // of the line — the join, the closing quote and the semicolon.
    const ts = [
      'const msg = `see ${items.map((i) => `https://x/${i}`).join(", ")} for detail`;',
      'const keep = 1;',
    ].join('\n');
    const out = stripSourceComments(ts, '.ts');
    assert.ok(out.includes('.join(", ")} for detail`;'), 'the tail of the line must survive');
    assert.ok(out.includes('const keep = 1;'));
  });

  test('a regex literal is a literal, not two operators and a comment opener', () => {
    // Both of PR #128's traps in one input. `/['"]/` — a reducer with no notion
    // of regex literals reads the `'` as a string opener (that one is bounded
    // here, because a string cannot cross a newline). `/[/*]x/` is the unbounded
    // one: the `/*` inside the character class opens a block comment that runs
    // to the next close delimiter — the doc comment below — taking the body of
    // the function with it. And the `return` in front of it is trap two: read as
    // a division, the literal is never recognised at all.
    const js = [
      'const f = (s) => {',
      "  if (/['\"]/.test(s)) return /[/*]x/.test(s);",
      '  return false;',
      '};',
      'const keep = 1;',
      '/** doc */',
    ].join('\n');
    const out = stripSourceComments(js, '.mjs');
    assert.ok(out.includes("if (/['\"]/.test(s)) return /[/*]x/.test(s);"), 'the literal must survive whole');
    assert.ok(out.includes('return false;'));
    assert.ok(out.includes('const keep = 1;'));
    assert.ok(!out.includes('doc'), 'and the real doc comment must still go');
  });

  test('a `/` inside a character class does not close the regex early', () => {
    // `/[^/]+/` — everything up to a slash — is an ordinary shape. Ending the
    // literal at the `/` inside the class desynchronises the scan, and the
    // trailing comment on the line then survives into the reduction.
    const js = ['const seg = /[^/]+/; // the path segment', 'const keep = 1;'].join('\n');
    const out = stripSourceComments(js, '.mjs');
    assert.ok(out.includes('const seg = /[^/]+/;'));
    assert.ok(!out.includes('path segment'), 'the trailing comment must still be stripped');
    assert.ok(out.includes('const keep = 1;'));
  });

  test("a Dart '''block''' containing // keeps its content", () => {
    const dart = ["const q = '''", 'https://example.test // not a comment', "''';", 'const keep = 1;'].join('\n');
    const out = stripSourceComments(dart, '.dart');
    assert.ok(out.includes('not a comment'));
    assert.ok(out.includes('const keep = 1;'));
  });

  test('`--` inside a SQL string is data, not a comment', () => {
    const sql = "INSERT INTO t (note) VALUES ('a -- b'); CREATE TABLE real (id TEXT);";
    const out = stripSourceComments(sql, '.sql');
    assert.ok(out.includes('CREATE TABLE real'));
  });

  test('`#` inside a quoted YAML scalar is not a comment', () => {
    const yaml = 'description: "sharp # sign"\nhttp: ^1.0.0 # a real comment\n';
    const out = stripSourceComments(yaml, '.yaml');
    assert.ok(out.includes('sharp # sign'));
    assert.ok(!out.includes('a real comment'));
    assert.ok(out.includes('http: ^1.0.0'));
  });

  test('AN UNTERMINATED `/*` IS KEPT — the direction of error, stated as a test', () => {
    // The property the module promises: where it cannot be certain, it keeps the
    // text. The cost is a comment that survives (an `absent` check cries wolf,
    // loudly); the alternative is deleting the rest of the file, silently.
    const ts = 'const keep = 1;\n/* this never closes\nconst alsoKeep = 2;\n';
    const out = stripSourceComments(ts, '.ts');
    assert.ok(out.includes('const alsoKeep = 2;'), 'code after an unclosed opener must survive');
    assert.equal(out.length, ts.length);
  });
});

describe('stripStringLiterals — a name inside a string is not a declaration', () => {
  test('a column name quoted in a string does not read as a column', () => {
    const sql = "INSERT INTO audit (note) VALUES ('never store a card_number');\nCREATE TABLE t (amount INTEGER);";
    const out = stripStringLiterals(sql);
    assert.ok(!out.includes('card_number'));
    assert.ok(out.includes('CREATE TABLE t'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO REAL-TREE CONTROLS, added 2026-08-21.
//
// Everything above is a fixture somebody wrote, and a fixture encodes the same
// misunderstanding as the code it tests. These two run over the whole corpus.
//
// They arrived by an embarrassing route worth recording, because the lesson is
// the same one this module exists to serve. On 2026-08-21 a session set out to
// fix six guards that matched regexes against RAW source, decided the corpus
// needed "the ONE comment-stripper", and wrote a new module — without opening
// text-reductions.mjs, which had been exactly that since 2026-08-02, with wider
// language coverage (.sql, .jsonc, .kts, .yaml) than the new one. The duplicate
// was deleted. What survived is the pair of controls written for it, because
// they caught FOUR real bugs in that implementation in their first run —
// bugs its author had not found by reading it — and this module, which nine-plus
// guards' correctness passes through, had no equivalent.
//
// The bug they caught, as a description of what they are FOR: a template literal
// whose `${…}` interpolation contains ANOTHER template literal. Scanning to the
// next backtick ends the outer literal on the inner one's opening quote, so
// `https://…` lands back in code position, the `//` reads as a line comment, and
// the rest of the line is blanked. LIVE CODE, deleted, silently — the exact
// failure mode this module's header calls the one it must never have.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Tracked files of a kind, from git rather than a walk — enumerating the tree
 *  is tree-walk.mjs's guarded concern and not this test's. */
function tracked(...globs) {
  return execSync(`git ls-files ${globs.map((g) => `"${g}"`).join(' ')}`, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

describe('text-reductions · REAL TREE · stripping must never break the parse', () => {
  const files = tracked('*.mjs', '*.js');

  test('there is a corpus to check', () => {
    assert.ok(files.length > 300, `only ${files.length} tracked .mjs/.js — the control lost its subject`);
  });

  test('no file that parsed before parses worse after, and offsets are preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'text-reductions-'));
    let probe = 0;
    // `node --check` is the parser. There is no in-process way to syntax-check an
    // ES module without executing it, and executing a guard RUNS it — so the cost
    // is one process per check, which is why they go 16 at a time. Sequentially
    // this took 60s, and a slow control is a control somebody deletes.
    const parses = (text, ext) =>
      new Promise((done) => {
        const p = join(dir, `probe${probe++}${ext}`);
        writeFileSync(p, text);
        execFile(process.execPath, ['--check', p], (err) => done(!err));
      });

    const lengthChanges = [];
    const jobs = [];
    for (const f of files) {
      const src = readFileSync(join(REPO_ROOT, f), 'utf8');
      const out = stripSourceComments(src, extname(f));
      // "Replaced with spaces, never deleted, so byte offsets are unchanged" is
      // a promise in this module's own header. Here it is as an assertion.
      if (out.length !== src.length) lengthChanges.push(f);
      jobs.push({ f, src, out, ext: f.endsWith('.mjs') ? '.mjs' : '.js' });
    }
    assert.deepEqual(lengthChanges, [], 'stripping must preserve byte offsets');

    const regressions = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        for (let k = next++; k < jobs.length; k = next++) {
          const j = jobs[k];
          // Only a file that parsed BEFORE can regress. One that never parsed
          // (a fragment, a fixture) proves nothing either way.
          if (!(await parses(j.out, j.ext)) && (await parses(j.src, j.ext))) regressions.push(j.f);
        }
      }),
    );
    assert.deepEqual(regressions.sort(), [], 'stripping blanked live code in these files');
  });
});

describe('text-reductions · REAL TREE · Dart agrees with the independently proven stripper', () => {
  const files = tracked('*.dart');

  /** assert-stamp-properties.mjs's `stripDartComments` — string-aware, in service
   *  since 2026-08-01, mutation-proven, and written by a different hand. Lifted
   *  rather than imported because importing that guard RUNS it: it is a script
   *  with top-level side effects, not a library. */
  async function oracle() {
    const guard = readFileSync(join(REPO_ROOT, 'tooling', 'ci', 'assert-stamp-properties.mjs'), 'utf8');
    const at = guard.indexOf('function stripDartComments(src');
    assert.notEqual(at, -1, 'the oracle has been renamed or removed — re-point this test');
    const end = guard.indexOf('\n}\n', at);
    assert.notEqual(end, -1, 'could not find the end of the oracle function');
    const body = `${guard.slice(at, end + 3)}\nexport { stripDartComments };`;
    return (await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`)).stripDartComments;
  }

  test('the oracle is a real stripper and not a pass-through', () => {
    // Without this, "we agree on 311 files" would also be true of two functions
    // that both return their argument.
    assert.doesNotMatch(stripSourceComments('final a = 1; // gone\n', '.dart'), /gone/);
  });

  test('at most one tracked .dart file strips differently, and it is the known one', async () => {
    const ref = await oracle();
    const disagreements = [];
    for (const f of files) {
      const src = readFileSync(join(REPO_ROOT, f), 'utf8');
      if (ref(src) !== stripSourceComments(src, '.dart')) disagreements.push(f);
    }
    // ⚠️ NOT asserted empty, and the reason is a REAL difference rather than a
    // tolerance. Dart block comments NEST (the language spec says so) and this
    // module's C-family scanner does not nest — so `/* a /* b */` ends here at
    // the first close marker and continues in the oracle. Measured 2026-08-21:
    // exactly ONE tracked file diverges, the Mason brick's app_config.dart, and
    // it diverges in this module's DOCUMENTED direction of error — it KEEPS the
    // text, so the worst case is a comment surviving and an `absent` check
    // crying wolf, never code being deleted. Pinned to that one file so the day
    // a second appears, somebody re-derives it instead of widening a tolerance.
    assert.deepEqual(disagreements, [
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/app_config.dart',
    ]);
  });
});
