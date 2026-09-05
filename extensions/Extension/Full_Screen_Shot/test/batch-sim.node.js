#!/usr/bin/env node
/* FullShot BATCH pure-core sim (no browser). Loads the REAL pure functions
   from pages/batch.js and grades URL parsing, output-filename derivation, and
   the sequential job-queue state machine. Fail-first vs the stub -> green. */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'pages', 'batch.js'));
let FAILS = 0;
function check(label, ok, extra) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : '')); if (!ok) FAILS++; }

/* ---- URL parsing ---- */
console.log('\n=== parse ===');
{
  const r = B.fsParseUrlList('example.com');
  check('bare domain -> https://', r.urls.length === 1 && r.urls[0] === 'https://example.com', JSON.stringify(r.urls));
}
{
  const r = B.fsParseUrlList('https://a.com\nhttp://b.com\n   \nc.org/x');
  check('newline split -> 3 urls', r.urls.length === 3, JSON.stringify(r.urls));
  check('http scheme preserved', r.urls[1] === 'http://b.com', r.urls[1]);
}
{
  const r = B.fsParseUrlList('chrome://settings\nfile:///etc\njavascript:alert(1)\nabout:blank\ndata:text/x');
  check('unsupported schemes all skipped', r.urls.length === 0 && r.skipped.length === 5, JSON.stringify(r.skipped.map(s => s.reason)));
}
{
  const r = B.fsParseUrlList('https://a.com, https://a.com, https://A.com/');
  check('dedupe case-insensitive + trailing-slash normalized -> 1 url', r.urls.length === 1, JSON.stringify(r.urls));
  check('the 2 dupes recorded as skipped', r.skipped.filter(s => s.reason === 'duplicate').length === 2, JSON.stringify(r.skipped));
}
{
  const r = B.fsParseUrlList('notaurl\nhttps://ok.com');
  check('token with no host skipped, valid kept', r.urls.length === 1 && r.urls[0] === 'https://ok.com', JSON.stringify(r));
}
{
  const r = B.fsParseUrlList('<https://x.com>\n"https://y.com",');
  check('markdown/quote/comma wrappers stripped', r.urls.length === 2 && r.urls[0] === 'https://x.com' && r.urls[1] === 'https://y.com', JSON.stringify(r.urls));
}
{
  const many = Array.from({ length: 60 }, (_, i) => 'https://site' + i + '.com').join('\n');
  const r = B.fsParseUrlList(many, { max: 50 });
  check('hard cap at max=50', r.urls.length === 50 && r.capped === true, r.urls.length + ' urls');
  check('over-cap entries recorded skipped (10)', r.skipped.filter(s => /cap/.test(s.reason)).length === 10, r.skipped.length + ' skipped');
}

/* ---- URL canonicalisation: no HTML-significant char may survive into a url ----
   A batch list is pasted from outside (a QA sheet, a colleague, a crawl export),
   so a token is untrusted input. The regex normalizer passed everything after the
   host through raw, so `https://ok.com/a<img src=https://evil.tld/p` stayed intact
   and the plan renderer wrote it into innerHTML -> a real <img> -> a network
   request from an extension page that promises zero network calls. Canonicalize
   at the source; the renderers build DOM nodes as the second gate. */
console.log('\n=== canonical ===');
const UNSAFE = /[\x00-\x20"'<>`\\^{}|]/;
{
  const r = B.fsNormalizeUrl('https://ok.com/a<img src=https://evil.tld/p');
  check('angle bracket encoded away in path', !!r && r.url.indexOf('<') < 0, r && r.url);
  check('space encoded away in path', !!r && r.url.indexOf(' ') < 0, r && r.url);
  check('host survives the encode', !!r && r.host === 'ok.com', r && r.host);
}
{
  const r = B.fsNormalizeUrl('https://ok.com/x"onmouseover="y');
  check('double quote encoded away', !!r && r.url.indexOf('"') < 0, r && r.url);
}
{
  const r = B.fsParseUrlList('https://a.com/a<img src=x>\nhttps://b.com/`t`\nhttps://c.com/{y}|z');
  check('no unsafe char survives a parse into any url', r.urls.length === 3 && r.urls.every(u => !UNSAFE.test(u)), JSON.stringify(r.urls));
}
{
  const plain = 'https://example.com/path/to?q=1&r=2#frag';
  const r = B.fsNormalizeUrl(plain);
  check('ordinary url byte-identical (no over-encoding of ? & # =)', !!r && r.url === plain, r && r.url);
}
{
  const r = B.fsNormalizeUrl('https://ok.com/%20already');
  check('an existing percent-escape is not double-encoded', !!r && r.url === 'https://ok.com/%20already', r && r.url);
}

/* ---- the sink: neither renderer may concatenate data into markup ---- */
console.log('\n=== sink ===');
{
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'pages', 'batch.js'), 'utf8');
  const ctrl = src.slice(src.indexOf('browser controller'));
  const concat = /innerHTML\s*=[^;]*\+/.test(ctrl);
  check('controller never builds markup by concatenation', !concat, concat ? 'found innerHTML = ... + ...' : 'none');
  check('controller renders text through textContent', /textContent/.test(ctrl), 'textContent present');
}

/* ---- filename derivation ---- */
console.log('\n=== filename ===');
{
  const taken = new Set();
  const f = B.fsBatchFilename('https://www.example.com/path/to', 0, taken);
  check('www stripped, index-prefixed, sanitized', f === '01-example-com-path-to.png', f);
}
{
  const taken = new Set();
  const a = B.fsBatchFilename('https://a.com', 0, taken);
  const b = B.fsBatchFilename('https://a.com', 1, taken);
  check('unique index prefixes prevent collision', a === '01-a-com.png' && b === '02-a-com.png', a + ' / ' + b);
  const c = B.fsBatchFilename('https://a.com', 0, taken);   // same index+url as a
  check('same name collision -> -2 suffix', c === '01-a-com-2.png', c);
}
{
  const long = 'https://' + 'x'.repeat(120) + '.com/' + 'y'.repeat(120);
  const f = B.fsBatchFilename(long, 4, new Set());
  check('base truncated to <=60 chars (+prefix +.png)', f.length <= 3 + 60 + 4, f.length + ' chars');
  check('starts with zero-padded index 05', /^05-/.test(f), f);
}

/* ---- job queue state machine ---- */
console.log('\n=== queue ===');
{
  const batch = B.fsCreateBatch(['https://a.com', 'https://b.com', 'https://c.com']);
  check('createBatch -> 3 pending jobs', batch.jobs.length === 3 && batch.jobs.every(j => j.status === 'pending'), JSON.stringify(batch.jobs.map(j => j.status)));
  let i = B.fsNextJob(batch);
  check('nextJob picks 0 first', i === 0, 'i=' + i);
  B.fsStartJob(batch, i);
  check('startJob -> capturing', batch.jobs[0].status === 'capturing', batch.jobs[0].status);
  check('nextJob skips the capturing one -> 1', B.fsNextJob(batch) === 1, 'i=' + B.fsNextJob(batch));
  B.fsSettleJob(batch, 0, true, { shotId: 'S0' });
  check('settle done records shotId', batch.jobs[0].status === 'done' && batch.jobs[0].shotId === 'S0', JSON.stringify(batch.jobs[0]));
  // job 1 errors -> queue must SKIP to job 2 (skip-on-error)
  const j1 = B.fsNextJob(batch); B.fsStartJob(batch, j1); B.fsSettleJob(batch, j1, false, { error: 'boom' });
  check('settle error records error + status', batch.jobs[1].status === 'error' && batch.jobs[1].error === 'boom', JSON.stringify(batch.jobs[1]));
  const j2 = B.fsNextJob(batch);
  check('skip-on-error: queue continues to job 2', j2 === 2, 'i=' + j2);
  B.fsStartJob(batch, j2); B.fsSettleJob(batch, j2, true, { shotId: 'S2' });
  const st = B.fsBatchStats(batch);
  check('stats: total3 done2 errors1', st.total === 3 && st.done === 2 && st.errors === 1, JSON.stringify(st));
  check('finished when nothing pending/active', st.finished === true && B.fsNextJob(batch) === -1, JSON.stringify(st));
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
process.exit(FAILS ? 1 : 0);
