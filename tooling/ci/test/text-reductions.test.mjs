// ─────────────────────────────────────────────────────────────────────────────
// text-reductions.test.mjs — the shared reductions, exercised directly.
//
// tooling/ci/text-reductions.mjs is not a guard: it is the ONE answer to "what
// does this text actually say", imported by check-site-integrity,
// assert-policy-archive, assert-policy-claims, assert-data-inventory and
// assert-licence-register. It has no tree to scan, so it carries no COVERAGE
// LOST and is exempt in assert-guard-coverage.mjs's NOT_A_SCANNER — but it still
// owes a failing case, because five guards' correctness passes through it.
//
// The two cases that are NOT stylistic:
//   · a comment must not satisfy (or refute) a source check. Found by mutation:
//     an `absent` assertion over `cf-connecting-ip` fired on the line
//     "CF-Connecting-IP is NEVER read and NEVER stored".
//   · `//` inside a URL is not a comment. Naively stripping it would delete the
//     rest of every line containing an https:// literal.
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
});

describe('stripStringLiterals — a name inside a string is not a declaration', () => {
  test('a column name quoted in a string does not read as a column', () => {
    const sql = "INSERT INTO audit (note) VALUES ('never store a card_number');\nCREATE TABLE t (amount INTEGER);";
    const out = stripStringLiterals(sql);
    assert.ok(!out.includes('card_number'));
    assert.ok(out.includes('CREATE TABLE t'));
  });
});
