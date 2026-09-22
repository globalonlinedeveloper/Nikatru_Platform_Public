// ─────────────────────────────────────────────────────────────────────────────
// retired-names-visible.test.mjs — assert-retired-names-visible.mjs must be able
// to FAIL on every surface it reads, must stay green on what it deliberately does
// not read, and must refuse to pass over a surface it could not read.
//
// [ADR 074]. One red row per surface, one green row per documented skip, one
// COVERAGE LOST row per floor, and the real repository.
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
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-retired-names-visible.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-retired-visible-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const SNAPSHOTS = ['2026-07-26', '2026-08-01', '2026-08-10', '2026-09-05'].map(
  (d) => `sites/nikatru/legal/${d}/en/privacy.html`,
);

/** A small tree that is CLEAN on every surface the guard reads. */
function baseFiles() {
  const files = {
    'tooling/channel-register.json': { retiredIdentityTokens: { tokens: ['subly'] } },
    'sites/nikatru/index.html': '<!doctype html>\n<title>Nikatru</title>\n<p>Nikatru Subscription Tracker</p>\n',
    'sites/nikatru/pricing.html': '<!doctype html>\n<title>Pricing</title>\n<p>Subscriptions, one price.</p>\n',
    'apps/x/web/index.html': '<!doctype html>\n<title>X</title>\n<base href="/x/">\n',
    'apps/x/lib/l10n/app_en.arb': JSON.stringify(
      { '@@locale': 'en', appTitle: 'Subscriptions', '@appTitle': { description: 'The launcher name.' } },
      null,
      2,
    ),
    'apps/x/store/android-play/title.txt': 'Nikatru Subscription Tracker\n',
    '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nbody:\n  - type: input\n    attributes:\n      placeholder: "Pixel 8 · Subscriptions 1.4.0"\n',
  };
  for (const p of SNAPSHOTS) files[p] = '<!doctype html>\n<title>Privacy (dated)</title>\n';
  return files;
}

function tree(mutate = (f) => f) {
  const root = join(TMP, `t${seq++}`);
  mkdirSync(root, { recursive: true });
  const files = mutate(baseFiles());
  for (const [rel, body] of Object.entries(files)) {
    if (body === undefined) continue;
    const at = join(root, rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const withFile = (rel, body) => (f) => {
  f[rel] = body;
  return f;
};
const without = (...rels) => (f) => {
  for (const rel of rels) delete f[rel];
  return f;
};
const withText = (rel, from, to) => (f) => {
  assert.ok(f[rel].includes(from), `fixture drift: ${rel} lacks ${from}`);
  f[rel] = f[rel].replace(from, to);
  return f;
};

// Each row below is its own `test(`, never a table in a loop: a case a loop generates
// is ONE declaration to coverage-manifest.json however many rows it iterates, so
// deleting a row would delete a case the ratchet cannot see (assert-no-loop-cases.mjs).
const red = (mutate, names) => {
  const { code, out } = run(tree(mutate));
  assert.equal(code, 1, out);
  assert.match(out, names);
};
const green = (mutate) => {
  const { code, out } = run(tree(mutate));
  assert.equal(code, 0, out);
};
const lost = (mutate, says) => {
  const { code, out } = run(tree(mutate));
  assert.equal(code, 2, out);
  assert.match(out, /COVERAGE LOST/);
  assert.match(out, says);
};

describe('assert-retired-names-visible — the control', () => {
  test('a clean tree passes, prints what it read, and prints every exemption with its reason', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /no customer-visible surface names a retired product \(subly\)/);
    assert.match(out, /site \d+ · web \d+ · arb \d+ · store \d+ · issue-forms \d+/);
    assert.match(out, /exempt 4 dated legal snapshot\(s\) by path/);
    for (const p of SNAPSHOTS) assert.ok(out.includes(`${p} — dated privacy policy`), `${p} not printed:\n${out}`);
  });
});

describe('assert-retired-names-visible — every surface can go red', () => {
  test('THE RED CONTROL: "Subly" on a served page exits 1 and names it', () => {
    red(withText('sites/nikatru/pricing.html', 'Subscriptions, one price.', 'Subly, one price.'), /sites\/nikatru\/pricing\.html:3 → "Subly"/);
  });

  test('a served file whose NAME is the retired product exits 1 and names it', () => {
    red(withFile('sites/nikatru/apps/shots/subly-1-v1.webp', 'RIFF'), /sites\/nikatru\/apps\/shots\/subly-1-v1\.webp → the file NAME/);
  });

  test('the retired host in an app web shell exits 1 and names it', () => {
    red(withText('apps/x/web/index.html', '<base href="/x/">', '<link rel="canonical" href="https://subly.nikatru.com/">'), /apps\/x\/web\/index\.html:3 → "subly\.nikatru\.com"/);
  });

  test('an .arb VALUE exits 1 and names it', () => {
    red(withFile('apps/x/lib/l10n/app_en.arb', JSON.stringify({ appTitle: 'Open Subly' }, null, 2)), /app_en\.arb:2 \(appTitle\) → "Subly"/);
  });

  test('a store title exits 1 and names it', () => {
    red(withFile('apps/x/store/android-play/title.txt', 'Subly Pro\n'), /title\.txt:1 → "Subly"/);
  });

  test('an issue form exits 1 and names it', () => {
    red(withText('.github/ISSUE_TEMPLATE/bug.yml', 'Subscriptions 1.4.0', 'Subly 1.4.0'), /bug\.yml:5 → "Subly"/);
  });

  test('an upper-case spelling exits 1 and names it', () => {
    red(withText('sites/nikatru/pricing.html', 'one price.', 'one SUBLY price.'), /"SUBLY"/);
  });

  test('a separator-split spelling exits 1 and names it', () => {
    red(withText('sites/nikatru/pricing.html', 'one price.', 'one sub-ly price.'), /"sub-ly"/);
  });

  test('a dated snapshot at a path NOT listed exits 1 and names it', () => {
    red(withFile('sites/nikatru/legal/2026-10-01/en/privacy.html', '<p>Subly</p>\n'), /legal\/2026-10-01\/en\/privacy\.html:1 → "Subly"/);
  });

  test('a listed snapshot that no longer exists (a stale exemption) exits 1 and names it', () => {
    red(without(SNAPSHOTS[0]), /2026-07-26\/en\/privacy\.html is listed in LEGAL_SNAPSHOTS_EXEMPT and is not a served file/);
  });

  // text is decided by CONTENT: no extension list stands between a served file and the scan
  test('a served text file with no extension exits 1 and names it', () => {
    red(withFile('sites/nikatru/humans', 'Built as Subly\n'), /sites\/nikatru\/humans:1 → "Subly"/);
  });

  test('a served text type no list names exits 1 and names it', () => {
    red(withFile('sites/nikatru/renewals.ics', 'BEGIN:VCALENDAR\nSUMMARY:Subly renewal\n'), /renewals\.ics:2 → "Subly"/);
  });

  test('a served text file in an app web shell with no extension exits 1 and names it', () => {
    red(withFile('apps/x/web/NOTICE', 'Subly\n'), /apps\/x\/web\/NOTICE:1 → "Subly"/);
  });
});

describe('assert-retired-names-visible — not read, stays green', () => {
  test('an @description naming the old product is not a subject — exits 0', () => {
    green(withFile('apps/x/lib/l10n/app_en.arb', JSON.stringify({ appTitle: 'Subscriptions', '@appTitle': { description: 'Was "Subly".' } }, null, 2)));
  });

  test('the apex _headers is not a subject — exits 0', () => {
    green(withFile('sites/nikatru/_headers', '# the Subly subdomain\n/*\n  X-Frame-Options: DENY\n'));
  });

  test('the apex _redirects is not a subject — exits 0', () => {
    green(withFile('sites/nikatru/_redirects', '# /subly moved\n/old /new 301\n'));
  });

  test('the apex router source is not a subject — exits 0', () => {
    green(withFile('sites/nikatru/functions/_middleware.js', '// subly-9cp.pages.dev\nexport const onRequest = (c) => c.next();\n'));
  });

  test('a Markdown file on the apex (the router answers 404 for it) is not a subject — exits 0', () => {
    green(withFile('sites/nikatru/README.md', 'subly.nikatru.com\n'));
  });

  test('an app web _headers is not a subject — exits 0', () => {
    green(withFile('apps/x/web/_headers', '# subly\n/*\n  X-Frame-Options: DENY\n'));
  });

  test('a binary file (a NUL byte) whose bytes spell the old name is not a subject — exits 0', () => {
    green(withFile('sites/nikatru/apps/shots/x-1-v1.webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 Subly', 'latin1')));
  });

  test('a listed dated snapshot is not a subject — exits 0', () => {
    green(withFile(SNAPSHOTS[3], '<p>Subly</p>\n'));
  });

  test('another site in the monorepo is not a subject — exits 0', () => {
    green(withFile('sites/rajasekarselvam/x.html', '<p>Subly</p>\n'));
  });
});

describe('assert-retired-names-visible — COVERAGE LOST, never a pass', () => {
  test('an empty tree exits 2', () => {
    lost(() => ({}), /does not exist/);
  });

  test('an empty token list exits 2', () => {
    lost(withFile('tooling/channel-register.json', { retiredIdentityTokens: { tokens: [] } }), /declares no `retiredIdentityTokens\.tokens`/);
  });

  test('no sites/nikatru/index.html exits 2', () => {
    lost(without('sites/nikatru/index.html'), /sites\/nikatru\/index\.html was not read/);
  });

  test('no app web index.html exits 2', () => {
    lost(without('apps/x/web/index.html'), /no apps\/\*\/web\/index\.html was read/);
  });

  test('no .arb value exits 2', () => {
    lost(withFile('apps/x/lib/l10n/app_en.arb', JSON.stringify({ '@@locale': 'en' })), /no \.arb value was read/);
  });

  test('no store title.txt exits 2', () => {
    lost(without('apps/x/store/android-play/title.txt'), /no apps\/\*\/store\/\*\/title\.txt was read/);
  });

  test('an empty ISSUE_TEMPLATE exits 2', () => {
    lost(without('.github/ISSUE_TEMPLATE/bug.yml'), /no \.github\/ISSUE_TEMPLATE\/\* file was read/);
  });
});

describe('assert-retired-names-visible — the real repository', () => {
  test('no customer-visible surface in this tree names a retired product', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
  });
});
