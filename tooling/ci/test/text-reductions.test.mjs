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
