/* selftest.node.js — do the gates in scripts/ actually bite?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/test/selftest.node.js
     node scripts/test/selftest.node.js --keep     (leave the fixtures on disk)

   No dependencies, no framework, bare Node. It builds a small but REAL tool
   tree in the OS temp directory — real PNG icons copied out of templates/tool, a
   real manifest, a real locale catalogue — runs each gate against it, then
   breaks exactly one thing and runs the gate again.

   WHY THIS FILE EXISTS AT ALL

   The recurring failure in this family is not a broken check, it is a check
   that silently stopped checking. It still prints "clean", CI still goes green,
   and nothing surfaces until the thing it guarded is already broken. The
   defence is not more checks; it is a recorded failing case for every check.

   So every assertion below comes in pairs: the gate PASSES on a correct tree,
   and FAILS on one specific mutation, with a message that names the problem.
   An assertion that cannot fail is worse than none — it inflates apparent
   coverage — so if you add a gate to scripts/ and cannot write the mutation
   that makes it red, the gate is not real and belongs deleted rather than kept
   "for safety".

   THE TWO THINGS IT DELIBERATELY PROVES ABOUT ITSELF

     - the network scanner does NOT fire on the word "fetch" in a comment
       (a gate that is red on its own documentation is a gate people disable),
       and DOES fire on a real call four lines later;
     - an external <a href> does not fail the remote-subresource gate, while an
       external <script src> does.

   Exit codes: 0 every pair behaved · 1 a gate did not bite, or bit wrongly. */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const REPO = path.resolve(SCRIPTS, '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-selftest-'));

let PASS = 0;
const FAILURES = [];

function ok(label, extra) { PASS++; console.log('  PASS  ' + label + (extra ? '  — ' + extra : '')); }
function bad(label, why) { FAILURES.push({ label, why }); console.log('  FAIL  ' + label + '\n        ' + String(why).split('\n').join('\n        ')); }

/* `env` is for a gate whose offline affordance is an environment variable
   rather than a flag; as a function it is handed the root, so a case can point
   it at a file inside its own fixture tree. */
function run(script, argv, root, env) {
  const extra = typeof env === 'function' ? env(root) : env;
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...argv, '--repo-root', root], {
    encoding: 'utf8', cwd: REPO, env: extra ? { ...process.env, ...extra } : process.env
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

/* `expect` is the whole point: a case states the code it wants AND a fragment
   of the message. A gate that fails for an unrelated reason is not the gate
   working — that is how three "caught" mutations turned out to be compile
   errors in an earlier project in this family. */
function expect(label, { script, argv, root, code, contains, env }) {
  const r = run(script, argv, root, env);
  const codeOk = r.code === code;
  const textOk = !contains || r.out.includes(contains);
  if (codeOk && textOk) return ok(label, 'exit ' + r.code + (contains ? ' · says "' + contains + '"' : ''));
  bad(label,
    (codeOk ? '' : 'expected exit ' + code + ', got ' + r.code + '\n') +
    (textOk ? '' : 'expected the output to contain: ' + contains + '\n') +
    '--- output ---\n' + r.out.trim());
}

/* ---------------- fixture ---------------- */
function w(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const TOOL = 'Extension/Good_Tool';

function buildBase(root) {
  w(root, 'README.md',
    '# fixture\n\n## Extensions\n\n<!-- CATALOG:START -->\n' +
    '| Extension | What it does | Status |\n|---|---|---|\n| [Placeholder](x) | stale row | Built |\n' +
    '<!-- CATALOG:END -->\n\ntail\n');

  w(root, 'core/core.json', JSON.stringify({ version: '0.1.0', channel: 'v1' }, null, 2) + '\n');
  w(root, 'core/v1/a.js', "'use strict';\nglobalThis.A = 1;\n");
  w(root, 'core/v1/sub/b.js', "'use strict';\nglobalThis.B = 2;\n");

  w(root, TOOL + '/manifest.json', JSON.stringify({
    manifest_version: 3,
    default_locale: 'en',
    name: '__MSG_appName__',
    short_name: '__MSG_appShortName__',
    version: '1.0.0',
    description: '__MSG_appDescription__',
    permissions: ['storage', 'activeTab'],
    /* The posture the project intends, MINUS img-src, which is deliberately
       absent: it falls back to default-src 'self', which is a SAFE policy, and
       the CSP-fallback pair below asserts the gate reads it that way instead of
       reporting a hole this manifest does not have. */
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" },
    action: {
      default_popup: 'popup/popup.html',
      default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
    },
    background: { service_worker: 'background.js' },
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
  }, null, 2) + '\n');

  w(root, TOOL + '/background.js',
    "'use strict';\n" +
    'chrome.runtime.onInstalled.addListener(function () {});\n');

  w(root, TOOL + '/popup/popup.html',
    '<!doctype html><html><head><link rel="stylesheet" href="popup.css"></head>\n' +
    '<body><p><a href="https://nikatru.com/privacy">Privacy</a></p>\n' +
    '<script src="popup.js"></script></body></html>\n');
  w(root, TOOL + '/popup/popup.js', "'use strict';\ndocument.title = 'x';\n");
  w(root, TOOL + '/popup/popup.css', 'body { margin: 0 }\n');

  w(root, TOOL + '/_locales/en/messages.json', JSON.stringify({
    appName: { message: 'Good Tool' },
    appShortName: { message: 'GoodTool' },
    appDescription: { message: 'A fixture extension used by the scripts self-test.' }
  }, null, 2) + '\n');

  for (const size of [16, 32, 48, 128]) {
    const src = path.join(REPO, 'templates', 'tool', 'icons', 'icon' + size + '.png');
    const dst = path.join(root, TOOL, 'icons', 'icon' + size + '.png');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  w(root, TOOL + '/CHANGELOG.md', '# Changelog\n\n## [1.0.0] - 2026-08-14\n\n### Added\n\n- first release\n');
  w(root, TOOL + '/test/smoke.node.js', "'use strict';\nconsole.log('ok');\n");

  w(root, TOOL + '/tool.json', JSON.stringify({
    $schema: '../../scripts/schema/tool.schema.json',
    id: 'goodtool',
    name: 'Good Tool',
    surface: 'extension',
    status: 'wip',
    summary: 'A fixture extension used by the scripts self-test.',
    manifest: 'manifest.json',
    package: {
      include: ['manifest.json', 'background.js', 'popup/', 'icons/', '_locales/'],
      exclude: ['**/*.node.js', '**/test/**', '**/*.md']
    },
    targets: { chromium: { stores: ['chrome', 'edge'] } },
    tests: ['test/smoke.node.js'],
    policy: {
      permissions: { storage: 'remembers the user\'s settings', activeTab: 'acts on the tab the user invoked it on' },
      optionalHostPermissions: {},
      networkAllowlist: []
    },
    listings: { chrome: null, edge: null, firefox: null }
  }, null, 2) + '\n');
}

const BASE = path.join(TMP, '_base');
buildBase(BASE);

let caseNo = 0;
/* Each case gets a pristine copy, so one mutation can never leak into the next.
   A shared fixture that accumulates damage produces cascading failures whose
   first cause is the only real one. */
function fixture(mutate) {
  const root = path.join(TMP, 'case-' + (++caseNo));
  copyDir(BASE, root);
  if (mutate) mutate(root);
  return root;
}
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
/* mkdir first: a mutation that ADDS a locale writes into a directory the base
   fixture does not have. */
const writeJson = (root, rel, v) => w(root, rel, JSON.stringify(v, null, 2) + '\n');
const edit = (root, rel, fn) => {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fn(fs.readFileSync(abs, 'utf8')), 'utf8');
};

/* =====================================================================
   toolinfo + discover
   ===================================================================== */
console.log('\ndiscover.mjs');
expect('a well-formed tree yields a matrix', {
  script: 'discover.mjs', argv: ['--json'], root: fixture(), code: 0, contains: '["goodtool"]'
});
expect('a duplicate tool id is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'duplicate tool id',
  root: fixture(root => {
    copyDir(path.join(root, TOOL), path.join(root, 'Extension/Second_Tool'));
  })
});
expect('surface must match the category directory', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'A category IS the delivery surface',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.surface = 'web'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a listed test that does not exist is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'silently stops running',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.tests = ['test/gone.node.js']; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an id that is not lowercase-kebab is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'must be lowercase-kebab',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.id = 'Good_Tool'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a version in tool.json is fatal (the manifest is the only source)', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'single source of',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.version = '1.0.0'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('unparseable tool.json names the line and column', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'does not parse as JSON',
  root: fixture(root => { edit(root, TOOL + '/tool.json', s => s.replace('{', '{ oops')); })
});

/* =====================================================================
   lint
   ===================================================================== */
console.log('\nlint.mjs');
expect('clean sources parse', {
  script: 'lint.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('a syntax error in a shipped file fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const a = ;\n'); })
});
expect('a syntax error in a listed TEST also fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/test/smoke.node.js', s => s + 'function ( {\n'); })
});
expect('selecting zero files is a FAILURE, not a pass', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'REQUIRED COVERAGE',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = ['nothing-matches-this.json'];
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('the tool can be named by path as well as by id', {
  script: 'lint.mjs', argv: [TOOL], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('an unknown tool name refuses rather than checking nothing', {
  script: 'lint.mjs', argv: ['nosuchtool'], root: fixture(), code: 2, contains: 'no tool named'
});

/* =====================================================================
   check-version
   ===================================================================== */
console.log('\ncheck-version.mjs');
expect('manifest and CHANGELOG agree', {
  script: 'check-version.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a CHANGELOG behind the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: "CHANGELOG.md's newest entry is [0.9.0]",
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s.replace('1.0.0', '0.9.0')); })
});
expect('a missing CHANGELOG fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'CHANGELOG.md is missing',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'CHANGELOG.md')); })
});
expect('a reused version number fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'A version is never reused',
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s + '\n## [1.0.0] - 2026-01-01\n\n- again\n'); })
});
expect('--expect disagreeing with the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--expect', '1.0.1'], root: fixture(), code: 1, contains: 'the caller expected v1.0.1'
});
expect('a tag naming another tool fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--tag', 'othertool-v1.0.0'], root: fixture(), code: 1, contains: 'tag names this tool'
});
/* A malformed version must be reported BY the version gate, as its own
   failure (exit 1) — not by the loader as "cannot run" (exit 2). The first
   version of toolinfo.mjs made it a tool.json contract error, which meant the
   one script whose whole job is version agreement was the one script that could
   not say so. Both scripts that grade it are asserted here. */
expect('an illegal version format fails IN check-version, not in the loader', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'no leading zeros',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '1.0.0-beta'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('and policy-check grades it too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'manifest version format',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '01.2.3'; writeJson(root, TOOL + '/manifest.json', m); })
});

/* =====================================================================
   policy-check
   ===================================================================== */
console.log('\npolicy-check.mjs');
expect('a clean tool passes every gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a real fetch() in a shipped file fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'fetch("https://example.com/ping");\n'); })
});
expect('the word fetch in a COMMENT does not fail, and is still reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'only inside comments or strings',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// This extension never calls fetch(), XMLHttpRequest or navigator.sendBeacon.\n' +
      '/* Not a WebSocket in sight, and no EventSource either. */\n' + s);
  })
});
expect('a fetch hidden under a comment banner is still caught', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// We never call fetch(). Honest.\n' + s + 'const u = "/*"; fetch("https://example.com/x");\n');
  })
});
expect('a URL inside a string does not fail the gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const doc = "see https://example.com for how fetch() works";\n'); })
});
expect('eval() fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no runtime code generation',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'eval("1+1");\n'); })
});
expect('string-form setTimeout fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'string-form setTimeout',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'setTimeout("go()", 10);\n'); })
});
expect('a remote <script src> fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no remote subresources',
  root: fixture(root => { edit(root, TOOL + '/popup/popup.html', s => s.replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>')); })
});
expect('an external <a href> does NOT fail (it navigates, it does not load)', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'external <a href>'
});

/* ---------------- the CSP posture gate ----------------

   THE GATE THESE PAIRS EXIST FOR. Until 2026-08-26 policy-check.mjs read ONE
   of the seven directives FullShot's manifest declares. Measured on a scratch
   copy of the real tree that day, exit codes captured one per line: deleting
   img-src printed `16 passed` at EXIT 0, and `img-src *` — which reopens
   exactly the thing the directive claims to close — printed `16 passed` at
   EXIT 0 as well. Six directives were a sentence the manifest asserted and
   nothing checked, so six mutations of the manifest were invisible.

   THE FIXTURE'S POLICY DELIBERATELY OMITS img-src. It declares default-src
   'self', and an absent img-src FALLS BACK to it, which is a SAFE policy. The
   clean-tree case below asserts the gate says so rather than reporting the
   hole it does not have: a guard that cries wolf about a correct manifest is a
   guard someone deletes, and getting CSP3's fallback backwards is the easiest
   way to build one. The other half of that rule is pinned too — base-uri and
   form-action have NO fallback, and default-src must NOT be read as covering
   them.

   AND THE ONE THAT MATTERS. `img-src 'none' https://tracker.example` does not
   mean none: CSP3 ignores 'none' beside any other source. A check that greps
   for the token passes on that exact string, which is why two cases sit side
   by side below — the reopened policy must FAIL, and a genuine 'none' must
   still PASS. Either one alone proves nothing about the other. */
const setCsp = (root, value) => {
  const m = readJson(root, TOOL + '/manifest.json');
  if (value === null) delete m.content_security_policy;
  else m.content_security_policy = { extension_pages: value };
  writeJson(root, TOOL + '/manifest.json', m);
};
/* The fixture's policy, minus one directive, so a case can delete exactly one
   thing without restating the other five. */
const cspWithout = (drop, extra) => (
  "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; " +
  "frame-src 'none'; base-uri 'none'; form-action 'none'")
  .split('; ').filter(p => p.split(' ')[0] !== drop).concat(extra || []).join('; ');

/* THE PAIR BELOW IS ONE CASE, NOT TWO, AND THE FIRST HALF ALONE WAS NOT A BITE.
   `contains: 'default-src (inherited by img-src)'` on an UNMUTATED tree goes red
   against a script that never printed that string — which is every script that
   predates this line — while saying nothing about whether the inheritance was
   READ. Exit 0 is the verdict it does assert (a gate with CSP3's fallback
   backwards reports a hole this manifest does not have and exits 1), and the
   second half is what makes the reading itself falsifiable: widen the default-src
   img-src inherits and the finding must name img-src, not default-src. */
expect('an absent img-src that falls back to default-src is NOT reported as a hole', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0,
  contains: 'default-src (inherited by img-src)'
});
expect('and the inheritance is READ, not just printed: widening that default-src fails, naming img-src', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'img-src: NOT DECLARED, and the default-src it falls back to does not cover it',
  root: fixture(root => setCsp(root, cspWithout('default-src', 'default-src *')))
});
expect('a declared directive widened to * fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'permitted and not intended: *',
  root: fixture(root => setCsp(root, cspWithout(null, 'img-src *')))
});
expect("'none' beside another source is INERT, and the gate says so rather than passing", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is INERT',
  root: fixture(root => setCsp(root, cspWithout(null, "img-src 'none' https://tracker.example")))
});
expect('and it names the source that is actually permitted, not the token it read', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'permitted and not intended: https://tracker.example',
  root: fixture(root => setCsp(root, cspWithout(null, "img-src 'none' https://tracker.example")))
});
expect("a genuine 'none' still PASSES — the case above is not just 'any list containing none'", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'hold the intended posture',
  root: fixture(root => setCsp(root, cspWithout(null, "img-src 'none'")))
});
expect('a directive with nothing left to fall back to fails as ABSENT, not as widened', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'img-src: NOT DECLARED',
  root: fixture(root => setCsp(root, cspWithout('default-src')))
});
expect('base-uri has NO fallback, and a present default-src does not cover it', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'base-uri: NOT DECLARED, and it has NO fallback at all',
  root: fixture(root => setCsp(root, cspWithout('base-uri')))
});
expect('form-action has NO fallback either', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'form-action: NOT DECLARED, and it has NO fallback at all',
  root: fixture(root => setCsp(root, cspWithout('form-action')))
});
expect('frame-src falls back to child-src before default-src, and child-src none is enough', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  contains: "child-src (inherited by frame-src) 'none'",
  root: fixture(root => setCsp(root, cspWithout('frame-src', "child-src 'none'")))
});
expect("but inheriting default-src 'self' where 'none' was intended is a hole", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: "permitted and not intended: 'self'",
  root: fixture(root => setCsp(root, cspWithout('frame-src')))
});
expect('keyword case and source order do not change the verdict', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'hold the intended posture',
  root: fixture(root => setCsp(root,
    "form-action 'NONE'; base-uri 'None'; frame-src 'none'; connect-src 'none'; " +
    "img-src BLOB: 'SELF' data:; object-src 'none'; script-src 'self'"))
});
expect('no content_security_policy at all is a FAILURE, not an empty pass', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'THIS GATE HAS NO SUBJECT',
  root: fixture(root => setCsp(root, null))
});
/* SAME SHAPE AS THE img-src PAIR ABOVE, AND FOR THE SAME REASON. On its own,
   the case below asserts a NOTE string on an unmutated tree — and note() in
   lib/report.mjs only console.log()s: it never enters the counts and cannot
   move the exit code, so nothing about that line was ever falsifiable. The two
   cases after it are the verdict: an untabled directive DECLARED WIDE is a
   failure, and a closed one is not. */
expect('a declared directive the table does not grade is named on every run', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 0,
  contains: 'declared but NOT graded by CSP_POSTURE: default-src',
  root: fixture()
});
expect('an untabled directive DECLARED WIDE is a FAILURE, not a note nobody reads', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'every declared CSP directive outside CSP_POSTURE is closed',
  root: fixture(root => setCsp(root, cspWithout(null, 'media-src *')))
});
expect('and a closed one is not — the limb reads the sources, it does not fail on being untabled', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'hold the intended posture',
  root: fixture(root => setCsp(root, cspWithout(null, "media-src 'self' blob:")))
});

/* 🔴 FIRST-WINS, WHICH IS WHAT THE BROWSER DOES. The parse used to be
   last-wins — `cspDirectives.set(...)` on every occurrence — so a LATER copy of
   a directive overwrote an earlier one, while CSP3 and Chromium enforce the
   FIRST and ignore the rest. Measured on Extension/Full_Screen_Shot 2026-08-26:
   `"script-src *; script-src 'self'; ..."` printed `17 passed` at EXIT 0 while
   the browser enforced `script-src *`. One token bought a clean gate over a
   policy the browser does not use.

   THREE CASES, BECAUSE ONE PROVES NOTHING. "the duplicate fails" would also be
   true of a gate that simply rejects any repeat; the reverse order must PASS,
   or the direction is untested. The third pins that the ignored copy is NAMED —
   a FAIL reporting `found: script-src *` over a manifest whose text visibly
   contains `script-src 'self'` reads as a bug in the checker. */
expect('a repeated directive is graded on the FIRST occurrence, which is the one enforced', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'permitted and not intended: *',
  root: fixture(root => setCsp(root, 'script-src *; ' + cspWithout(null)))
});
expect('and the reverse order PASSES — first-wins, not "any repeat fails"', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'hold the intended posture',
  root: fixture(root => setCsp(root, cspWithout(null, 'script-src *')))
});
expect('and the copy the browser ignores is named, so the verdict does not read as a checker bug', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: "repeated and therefore IGNORED by the browser (first occurrence wins): script-src 'self'",
  root: fixture(root => setCsp(root, 'script-src *; ' + cspWithout(null)))
});

/* 🔴 THE DIRECTIVE CHROMIUM ACTUALLY CONSULTS. script-src-elem is preferred
   over script-src for <script> element loads, so a table that grades script-src
   alone grades the directive that does not apply: measured 2026-08-26,
   `"script-src 'self'; script-src-elem *; ..."` printed `6 more CSP directive(s)
   hold the intended posture` at EXIT 0. worker-src is the same shape one step
   further out — its CSP3 fallback runs through child-src BEFORE script-src, and
   getting that order backwards would report a child-src widened for framing as
   covered by a script-src nobody touched. */
expect('script-src-elem is graded in its own right, not left to script-src', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'script-src-elem: DECLARED, and it permits more than the intent',
  root: fixture(root => setCsp(root, cspWithout(null, 'script-src-elem *')))
});
expect('worker-src falls back through child-src BEFORE script-src', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: 'child-src (inherited by worker-src) *',
  root: fixture(root => setCsp(root, cspWithout(null, 'child-src *')))
});

/* 🔴 THE THREE FINDING KINDS ARE COUNTED APART, AND ONE USED TO BE MISFILED.
   `kind: eff.via ? 'absent' : 'widened'` filed an absent-but-INHERITING
   directive under "absent and uncovered" — a phrase the same failure message
   defines as "no fallback reaches it", while the finding one line above it read
   "the default-src it falls back to does not cover it". The tally and the
   finding it summarised contradicted each other inside one run. */
expect('an absent directive whose fallback is too wide counts as INHERITED, not absent-and-uncovered', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: '0 widened, 1 inherited too wide, 0 absent and uncovered',
  root: fixture(root => setCsp(root, cspWithout('frame-src')))
});
expect('and one with no fallback left counts as absent and uncovered', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1,
  contains: '0 widened, 0 inherited too wide, 1 absent and uncovered',
  root: fixture(root => setCsp(root, cspWithout('base-uri')))
});
expect('a directive READ AS A FALLBACK is named as such, not listed as flatly ungraded', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  contains: 'child-src (read only as the fallback for frame-src, worker-src)',
  root: fixture(root => setCsp(root, cspWithout('frame-src', "child-src 'none'")))
});

/* 🔴 THE LIMIT IS PRINTED, AND THE PRINTING IS GRADED. CSP_POSTURE models nine
   directives; the browser honours more. The note that lists the untabled
   DECLARED ones is structurally blind to a directive that is neither declared
   nor tabled — which is the state that leaves one unrestricted, and is
   Extension/Full_Screen_Shot's state today: no default-src, so style-src,
   font-src, media-src, manifest-src and child-src fall back to nothing.
   Both halves are graded through --warnings-as-errors, because this limb warns
   rather than fails and an exit code is the only thing that separates
   "reported" from "not reported". */
expect('the unmodelled directives are named every run, with what each one resolves to', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 0,
  contains: 'style-src: absent, inherits default-src',
  root: fixture()
});
expect('and with no default-src umbrella they are UNRESTRICTED, and the gate says so', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1,
  contains: 'CSP directive(s) this gate does not model are UNRESTRICTED',
  root: fixture(root => setCsp(root, cspWithout('default-src', "img-src 'self' data: blob:")))
});

/* 🔴 AN EMPTY TABLE IS A GATE WITH NO SUBJECT. Measured 2026-08-26: emptying
   CSP_POSTURE and changing nothing else printed `PASS 0 more CSP directive(s)
   hold the intended posture`, 17 passed, EXIT 0 — the manifest side of that hole
   was already guarded ("THIS GATE HAS NO SUBJECT"), the table side was not.
   Mutates the SCRIPT, like the rival-declaration case below, because the defect
   it guards against is a defect in the script. */
{
  const emptied = path.join(TMP, 'empty-posture-scripts');
  copyDir(SCRIPTS, emptied);
  const target = path.join(emptied, 'policy-check.mjs');
  const src = fs.readFileSync(target, 'utf8');
  const open = src.indexOf('const CSP_POSTURE = [');
  const close = src.indexOf('\n];', open);
  if (open === -1 || close === -1) {
    bad('an EMPTY CSP_POSTURE makes the gate REFUSE TO RUN',
      'CSP_POSTURE is no longer a bracketed array literal; this case is not testing what it claims to.');
  } else {
    fs.writeFileSync(target, src.slice(0, open) + 'const CSP_POSTURE = [' + src.slice(close), 'utf8');
    const res = spawnSync(process.execPath, [target, 'goodtool', '--repo-root', fixture()], { encoding: 'utf8', cwd: REPO });
    const out = (res.stdout || '') + (res.stderr || '');
    if (res.status === 2 && out.includes('CSP_POSTURE is empty')) {
      ok('an EMPTY CSP_POSTURE makes the gate REFUSE TO RUN rather than pass over nothing', 'exit 2');
    } else {
      bad('an EMPTY CSP_POSTURE makes the gate REFUSE TO RUN rather than pass over nothing',
        'expected exit 2 naming the empty table, got exit ' + res.status + '\n--- output ---\n' + out.trim());
    }
  }
}

/* THE INTENDED VALUES MUST LIVE IN ONE PLACE, AND THAT IS ENFORCED RATHER THAN
   REMEMBERED. connect-src's intended value is derived from tool.json's
   policy.networkAllowlist; CSP_POSTURE declares the other nine. If connect-src
   ever appears in BOTH, the run would grade one directive against two
   expectations that are free to disagree — so policy-check refuses to run at
   all. This is the only case here that mutates the SCRIPT rather than the tree,
   because the defect it guards against is a defect in the script. */
{
  const rival = path.join(TMP, 'rival-scripts');
  copyDir(SCRIPTS, rival);
  const target = path.join(rival, 'policy-check.mjs');
  const src = fs.readFileSync(target, 'utf8');
  const anchor = "  { name: 'script-src', intent: [\"'self'\"], fallback: ['default-src'],";
  if (!src.includes(anchor)) {
    bad('the one-declaration guard can be mutated', 'CSP_POSTURE no longer starts with script-src; this case is not testing what it claims to.');
  } else {
    fs.writeFileSync(target, src.replace(anchor,
      "  { name: 'connect-src', intent: [\"'none'\"], fallback: ['default-src'], why: 'a rival declaration' },\n" + anchor), 'utf8');
    const res = spawnSync(process.execPath, [target, 'goodtool', '--repo-root', fixture()], { encoding: 'utf8', cwd: REPO });
    const out = (res.stdout || '') + (res.stderr || '');
    if (res.status === 2 && out.includes('CSP_POSTURE declares "connect-src"')) {
      ok('declaring connect-src in CSP_POSTURE too makes the gate REFUSE TO RUN', 'exit 2');
    } else {
      bad('declaring connect-src in CSP_POSTURE too makes the gate REFUSE TO RUN',
        'expected exit 2 naming the duplicate declaration, got exit ' + res.status + '\n--- output ---\n' + out.trim());
    }
  }
}
expect('an unjustified permission fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no justification at all: downloads',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.permissions.push('downloads'); writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a placeholder justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'placeholder justification',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.policy.permissions.storage = 'TODO explain'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('static host_permissions without a justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'static host_permissions require',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.host_permissions = ['<all_urls>']; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a description over 132 characters fails, measured on the TRANSLATION', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'the limit is 132',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
expect('an over-long description in a NON-default locale is caught too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'de: description is',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/de/messages.json', m);
  })
});
expect('an unresolved __MSG_ key fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'every __MSG_ key resolves',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    delete m.appShortName;
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
/* The next three came from running policy-check against the real FullShot tree
   after the fixture was already green. The fixture had no bidi support and no
   file that documents the i18n mechanism in prose, so it could not have shown
   either bug — which is the whole argument for mutating something real. */
expect("Chrome's predefined __MSG_@@ messages are not demanded of messages.json", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body dir="__MSG_@@bidi_dir__">'));
  })
});
expect('a __MSG_ key quoted in a COMMENT is not demanded either', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// Chrome substitutes __MSG_someKeyThatDoesNotExist__ at load time; see the docs.\n' + s);
    edit(root, TOOL + '/popup/popup.html', s =>
      s.replace('<body>', '<!-- __MSG_anotherMissingKey__ is explained in the README -->\n<body>'));
  })
});
expect('a real unresolved key in real markup still fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: '__MSG_reallyMissing__',
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body title="__MSG_reallyMissing__">'));
  })
});
expect('a build-time .mjs swept into the package is reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'build-time file(s) are inside the packaged set',
  root: fixture(root => { w(root, TOOL + '/popup/make-thing.mjs', "export const x = 1;\n"); })
});
expect('a missing default locale catalogue fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'REFUSES TO LOAD',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.default_locale = 'fr'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('locales are packaged even when package.include forgets them', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'no longer reaches _locales on its own',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== '_locales/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
/* 🔴 PLURAL CATEGORIES — the locale-completeness limb, both directions.
   Chrome's messages.json has no plural support, so a count-agreeing sentence is
   spelled one key per CLDR category. Which categories exist differs by language,
   and until 2026-08-22 this gate did a naive key-set diff: it demanded
   `itemCountOne` of Japanese, a form Japanese does not have, on every run
   forever. The cases below pin the exemption from BOTH sides, and every one of
   them is graded through `--warnings-as-errors` on purpose — this limb warns
   rather than fails, so an exit code is the only thing that can tell "reported"
   from "not reported" apart. The base fixture exits 0 under that flag, so a 1
   here is this limb and nothing else.

   `en` = one|other · `ja` = other alone · `ru` = one|few|many|other.
   Read from Intl.PluralRules at run time, exactly as the gate reads it. */
const dropKeys = (obj, keys) => {
  const o = JSON.parse(JSON.stringify(obj));
  for (const k of keys) delete o[k];
  return o;
};
function withPlurals(mutate = () => {}) {
  return fixture(root => {
    const en = readJson(root, TOOL + '/_locales/en/messages.json');
    en.itemCountOne = { message: 'one item' };
    en.itemCountOther = { message: 'several items' };
    /* NOT a plural: `stepOne` has no `stepOther`, so the base's category set in
       the default locale is {one}, not en's {one, other}. A suffix is a
       spelling, not a semantic — the tool's own plurals.mjs records this family
       paying for that confusion once already. */
    en.stepOne = { message: 'Step one' };
    writeJson(root, TOOL + '/_locales/en/messages.json', en);
    writeJson(root, TOOL + '/_locales/ja/messages.json', dropKeys(en, ['itemCountOne']));
    writeJson(root, TOOL + '/_locales/ru/messages.json',
      Object.assign(dropKeys(en, []), { itemCountFew: { message: 'few' }, itemCountMany: { message: 'many' } }));
    mutate(root);
  });
}
expect('a CLDR category the locale does NOT have is not a missing key', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 0,
  contains: 'plural-aware: 1 key(s) across 1 locale(s) were NOT counted as missing',
  root: withPlurals()
});
expect('a genuinely missing key in the same locale is STILL reported', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (itemCountOther',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ja/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ja/messages.json'), ['itemCountOther']));
  })
});
expect('a key that merely ENDS in One is not exempted', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (stepOne',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ja/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ja/messages.json'), ['stepOne']));
  })
});
/* The other direction, and it is the one a key-set diff can NEVER see: `ru`
   needs `itemCountFew`, and `en` has no such key to diff against. Nothing falls
   back either — chrome.i18n resolves it to the empty string. */
expect('a plural form the DEFAULT locale does not have is reported when a locale needs it', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: '1 plural form(s) absent (itemCountFew',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ru/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ru/messages.json'), ['itemCountFew']));
  })
});

/* 🔴 AND THE CONVENTION THIS GATE MUST NOT BREAK. The corpus records a SECOND,
   incompatible plural strategy (pipeline/06-i18n.md I-4): the skeleton emits all
   SIX CLDR forms into EVERY catalogue so `_other` is a real fallback, and a
   plain key-set parity check is exactly right for that tree. The family
   recovery above declines such a base by construction — six suffixes in `en` is
   not `en`'s own set of two — so a tool following that convention is graded
   with no exemption at all, as it was before this change. This case is the pin
   on that, because widening the exemption to "any base with plural suffixes"
   would silently stop grading those trees. */
expect('a tool that emits all six forms into every locale keeps the plain parity check', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (itemCountOne',
  root: fixture(root => {
    const en = readJson(root, TOOL + '/_locales/en/messages.json');
    for (const s of ['Zero', 'One', 'Two', 'Few', 'Many', 'Other']) en['itemCount' + s] = { message: s };
    writeJson(root, TOOL + '/_locales/en/messages.json', en);
    const ja = JSON.parse(JSON.stringify(en));
    delete ja.itemCountOne;
    writeJson(root, TOOL + '/_locales/ja/messages.json', ja);
  })
});

expect('an underscore-prefixed root directory fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'reserved for use by the system',
  root: fixture(root => {
    w(root, TOOL + '/_core/ns.js', "'use strict';\n");
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include.push('_core/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('an icon of the wrong size fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is actually 128x128',
  root: fixture(root => {
    fs.copyFileSync(path.join(root, TOOL, 'icons/icon128.png'), path.join(root, TOOL, 'icons/icon16.png'));
  })
});
expect('a renamed non-PNG icon fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is not a PNG',
  root: fixture(root => { fs.writeFileSync(path.join(root, TOOL, 'icons/icon48.png'), 'not a png', 'utf8'); })
});
expect('a package with no manifest fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'Manifest file is missing or unreadable',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== 'manifest.json');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
/* An absent allowlist must be reported BY policy-check, not by the loader.
   These two cases exist because the first version of toolinfo.mjs made both
   fields tool.json contract errors — which made every gate exit 2 and turned
   the branches inside policy-check that handle them into assertions that could
   never fire. A gate must be able to fail for the reason it is about. */
expect('an absent networkAllowlist is not treated as an empty one', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.networkAllowlist is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an absent policy.permissions fails in policy-check', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.permissions is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.permissions; writeJson(root, TOOL + '/tool.json', t); })
});
expect('but the matrix can still be built — a policy gap is not a contract break', {
  script: 'discover.mjs', argv: ['--json'], code: 0, contains: '["goodtool"]',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});

/* =====================================================================
   sync-core + check-core-sync
   ===================================================================== */
console.log('\nsync-core.mjs / check-core-sync.mjs');
const withCore = root => { const t = readJson(root, TOOL + '/tool.json'); t.core = { channel: 'v1', pin: null }; writeJson(root, TOOL + '/tool.json', t); };

expect('a tool that vendors no core passes', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'vendors no core'
});
expect('an orphan vendor/core with no declaration fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'declares no core channel',
  root: fixture(root => { w(root, TOOL + '/vendor/core/ghost.js', "'use strict';\n"); })
});
expect('a declared channel that was never synced fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'never been created',
  root: fixture(withCore)
});
expect('a declared channel with no core/ directory fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'FAIL  core/v1/ exists',
  root: fixture(root => { withCore(root); fs.rmSync(path.join(root, 'core'), { recursive: true }); })
});

{
  const root = fixture(withCore);
  expect('sync-core vendors the channel', {
    script: 'sync-core.mjs', argv: ['goodtool'], root, code: 0, contains: 'vendored 2 file(s)'
  });
  const meta = path.join(root, TOOL, 'vendor/core/.coremeta.json');
  if (fs.existsSync(meta)) ok('.coremeta.json was written', JSON.parse(fs.readFileSync(meta, 'utf8')).coreVersion);
  else bad('.coremeta.json was written', 'not found at ' + meta);
  expect('and the sync then verifies', { script: 'check-core-sync.mjs', argv: ['goodtool'], root, code: 0, contains: 'byte-identical' });

  const synced = root; // reuse as the base for drift mutations
  const drift = mutate => { const r2 = path.join(TMP, 'case-' + (++caseNo)); copyDir(synced, r2); mutate(r2); return r2; };

  expect('a hand-edited vendored file fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => { edit(r2, TOOL + '/vendor/core/a.js', s => s + '// patched locally\n'); })
  });
  expect('editing the vendored file AND its recorded hash still fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, "'use strict';\nglobalThis.A = 99;\n", 'utf8');
      const crypto = require('crypto');
      const m = readJson(r2, TOOL + '/vendor/core/.coremeta.json');
      m.files['a.js'] = 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      writeJson(r2, TOOL + '/vendor/core/.coremeta.json', m);
    })
  });
  expect('a CRLF-only difference is named as line endings, not as a mystery hash', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'LINE ENDINGS',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
    })
  });
  expect('a core bump leaves the tool behind, and says so', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'the vendored core is current',
    root: drift(r2 => { const c = readJson(r2, 'core/core.json'); c.version = '0.2.0'; writeJson(r2, 'core/core.json', c); })
  });
  expect('a pin that names a version core/ does not hold is refused by sync-core', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 2, contains: 'confirm the lie',
    root: drift(r2 => { const t = readJson(r2, TOOL + '/tool.json'); t.core.pin = '9.9.9'; writeJson(r2, TOOL + '/tool.json', t); })
  });
  expect('a file deleted from vendor/core fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MISSING',
    root: drift(r2 => { fs.rmSync(path.join(r2, TOOL, 'vendor/core/sub/b.js')); })
  });
  expect('a stray file in vendor/core is not silently deleted', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 1, contains: 'this script did not put there',
    root: drift(r2 => { w(r2, TOOL + '/vendor/core/mine.js', "'use strict';\n"); })
  });
}

/* =====================================================================
   gen-catalog
   ===================================================================== */
console.log('\ngen-catalog.mjs');
{
  const root = fixture();
  expect('--check sees a stale table', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 1, contains: 'out of date' });
  expect('writing fixes it', { script: 'gen-catalog.mjs', argv: [], root, code: 0, contains: 'rewrote the catalog' });
  expect('and --check then agrees', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 0, contains: 'up to date' });
  const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (md.includes('| [Good Tool](Extension/Good_Tool) |') && md.includes('tail'))
    ok('the row is generated and the surrounding prose survives');
  else bad('the row is generated and the surrounding prose survives', md);
}
expect('no markers means no write', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'has no catalog markers',
  root: fixture(root => { edit(root, 'README.md', s => s.replace('<!-- CATALOG:START -->', '').replace('<!-- CATALOG:END -->', '')); })
});
expect('an empty result will not overwrite a real table', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'silently delete the catalog',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'tool.json')); })
});
expect('a null listing never becomes an invented URL', {
  script: 'gen-catalog.mjs', argv: ['--print'], root: fixture(), code: 0, contains: 'In progress'
});

/* =====================================================================
   check-catalog + publish-catalog

   The two consumers of gen-catalog's family, and the two gates whose recorded
   reason for having no case here described a THIRD script: check-catalog never
   opens README.md — grading the README markers is gen-catalog's job.

   The base fixture's tool.json keys `listings` for three stores while its
   `targets` builds for two, which publish-catalog refuses to turn into a row at
   all. The alignment below makes the fixture PUBLISHABLE; it does not soften
   the subject. Without it every case here would exit 1 for that unrelated
   reason while naming a limb it never reached — the exact vacuity an exit code
   alone cannot see, which is why every case states a message too.
   ===================================================================== */
console.log('\ncheck-catalog.mjs + publish-catalog.mjs');
const CATALOGUE = 'catalog/extensions.json';
const CAT_SEED = fixture(root => {
  const t = readJson(root, TOOL + '/tool.json');
  t.listings = { chrome: null, edge: null };
  writeJson(root, TOOL + '/tool.json', t);
});
expect('publish writes the catalogue the tool.json files derive', {
  script: 'publish-catalog.mjs', argv: [], root: CAT_SEED, code: 0, contains: 'wrote ' + CATALOGUE
});
expect('and --check then finds no drift', {
  script: 'publish-catalog.mjs', argv: ['--check'], root: CAT_SEED, code: 0, contains: CATALOGUE + ' is up to date'
});
expect('and what it wrote is an honest catalogue', {
  script: 'check-catalog.mjs', argv: [], root: CAT_SEED, code: 0,
  contains: 'the catalogue publishes exactly the extensions on disk'
});

/* Copies of the SEED, not of BASE. Both mutations below are only meaningful
   against a catalogue that passed both gates one line ago. */
const catFixture = mutate => {
  const root = path.join(TMP, 'catalogue-' + (++caseNo));
  copyDir(CAT_SEED, root);
  mutate(root);
  return root;
};

/* 🔴 `[]` is the cheapest way for this guard to stop guarding: every per-row
   limb below limb 0 is vacuously true over zero rows, and publish --check
   cannot see it — regenerating an empty catalogue over an empty one is not
   drift. */
expect('an empty catalogue is COVERAGE LOST, not a vacuous pass', {
  script: 'check-catalog.mjs', argv: [], code: 1,
  contains: 'COVERAGE LOST — ' + CATALOGUE + ' holds zero rows',
  root: catFixture(root => { w(root, CATALOGUE, '[]\n'); })
});

/* 🔴 THREE BYTES, AND THE CONTENT PERFECT. Both fixtures differ from the seed
   by EF BB BF and nothing else, so a red here is the byte order mark and cannot
   be drift, a missing file or an unparseable tool.json. These two read the raw
   Buffer, and a consumer's JSON.parse throws on the U+FEFF they would keep. */
const bomIt = root => {
  const abs = path.join(root, CATALOGUE);
  fs.writeFileSync(abs, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), fs.readFileSync(abs)]));
};
expect('a UTF-8 BOM on the published bytes is caught by check-catalog', {
  script: 'check-catalog.mjs', argv: [], code: 1,
  contains: CATALOGUE + ' starts with a UTF-8 byte order mark (EF BB BF)',
  root: catFixture(bomIt)
});
expect('and by publish --check, whose content comparison alone would call it up to date', {
  script: 'publish-catalog.mjs', argv: ['--check'], code: 1,
  contains: CATALOGUE + ' starts with a UTF-8 byte order mark (EF BB BF)',
  root: catFixture(bomIt)
});

/* =====================================================================
   new-tool
   ===================================================================== */
console.log('\nnew-tool.mjs');
{
  const root = fixture(r2 => {
    /* A minimal templates/tool so the copy is fast and the precedence rule
       (templates/tool wins over _skeleton) is the thing under test. */
    w(r2, 'templates/tool/manifest.json', JSON.stringify({
      manifest_version: 3, default_locale: 'en', name: '__MSG_appName__', version: '0.0.1',
      permissions: ['storage'], background: { service_worker: 'background.js' }
    }, null, 2) + '\n');
    w(r2, 'templates/tool/background.js', "'use strict';\n");
    w(r2, 'templates/tool/_locales/en/messages.json', JSON.stringify({ appName: { message: 'x' } }) + '\n');
    w(r2, 'templates/tool/test/smoke.node.js', "console.log('ok');\n");
    w(r2, 'templates/tool/publish/identity.json', JSON.stringify({ slug: 'skeleton', ownerDomain: 'REPLACE-WITH-YOUR-DOMAIN.example' }, null, 2) + '\n');
    w(r2, 'templates/tool/publish/old-release-1.0.0.zip', 'PK-not-really\n');
    w(r2, 'templates/tool/skeleton.json', JSON.stringify({ skeletonVersion: '1.1.0', tool: '', copiedAt: '' }, null, 2) + '\n');
  });

  expect('--dry-run writes nothing', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest', '--dry-run'],
    root, code: 0, contains: 'dry run'
  });
  if (!fs.existsSync(path.join(root, 'Extension/Tab_Digest'))) ok('--dry-run really created nothing');
  else bad('--dry-run really created nothing', 'Extension/Tab_Digest exists');

  expect('it scaffolds', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest'],
    root, code: 0, contains: 'wrote Extension/Tab_Digest/tool.json'
  });
  const made = path.join(root, 'Extension/Tab_Digest');
  const checks = [
    ['directory name is Title_Snake_Case', fs.existsSync(made)],
    ['skeleton.json stamped with the tool name', fs.existsSync(path.join(made, 'skeleton.json')) && JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).tool === 'Tab_Digest'],
    ['skeletonVersion left alone', JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).skeletonVersion === '1.1.0'],
    ['identity slug set to the tool id', JSON.parse(fs.readFileSync(path.join(made, 'publish/identity.json'), 'utf8')).slug === 'tabdigest'],
    ["the previous tool's release zip did NOT come along", !fs.existsSync(path.join(made, 'publish/old-release-1.0.0.zip'))],
    ['a CHANGELOG was seeded at the manifest version', fs.readFileSync(path.join(made, 'CHANGELOG.md'), 'utf8').includes('## [0.0.1]')],
    ['permission justifications are EMPTY, so policy-check is red by design', JSON.parse(fs.readFileSync(path.join(made, 'tool.json'), 'utf8')).policy.permissions.storage === '']
  ];
  for (const [label, cond] of checks) cond ? ok(label) : bad(label, 'condition false');

  expect('and the new tool is discovered', { script: 'discover.mjs', argv: ['--json'], root, code: 0, contains: 'tabdigest' });
  expect('its empty justification really does fail policy-check', {
    script: 'policy-check.mjs', argv: ['tabdigest'], root, code: 1, contains: 'no justification at all: storage'
  });
  expect('running it again refuses rather than overwriting', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest2'],
    root, code: 2, contains: 'already exists'
  });
  expect('a duplicate id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Other Thing', '--id', 'tabdigest'],
    root, code: 2, contains: 'already used by'
  });
  expect('an uppercase id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Nope', '--id', 'Nope'],
    root, code: 2, contains: 'not lowercase-kebab'
  });
  expect('a lowercase category is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'extension', '--name', 'Nope', '--id', 'nope'],
    root, code: 2, contains: 'not Capitalized_Singular'
  });
}

/* A half-built templates/tool with no manifest must not win precedence over a
   complete _skeleton. This is not hypothetical: templates/tool/ appeared in the
   real repo holding only README.md and tool.json while another agent was
   building it, and the first version of this script stamped a two-file scaffold
   from it and called that a success. */
expect('a template with no manifest.json is refused, and names the fallback', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt'],
  code: 2, contains: 'has no manifest.json',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, 'templates/tool/README.md', '# still being written\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});
expect('and --template can then point at the complete one', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt', '--template', '_skeleton', '--dry-run'],
  code: 0, contains: 'dry run',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});

/* =====================================================================
   check-store-packages.mjs

   The gate whose subject is the BUILT ARTIFACT rather than the source. Every
   mutation below is a real zip written byte by byte, because the defect it was
   written for is exactly a case where the source was right and the zip was not:
   on 2026-08-20 six -firefox.zip in Extension/Full_Screen_Shot/publish/ carried
   `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` while the overlay beside them
   carried `fullshot@nikatru.com`. A fixture that mocked the reader would have
   proved nothing about that.
   ===================================================================== */
console.log('\ncheck-store-packages.mjs');

/* A minimal STORED (method 0) zip. No compression, so the test depends on no
   codec and the reader's deflate path is exercised by the real packages the
   `package` job builds rather than by a synthetic one here. */
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    /* A Buffer body is passed through untouched. The freshness cases below put
       the fixture's real icon PNGs into a package and hash them back out, and
       Buffer.from(<png>, 'utf8') is a DIFFERENT FILE — it would report every
       package as stale and the case would "pass" for the wrong reason. */
    const nb = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb);
    offset += 30 + nb.length + body.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cp.length, 12); eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

/* The fixture tool declares only `chromium`, so a Firefox package needs the
   target adding too — a package for a target the tool does not declare is a
   different question, and conflating them would make these cases ambiguous. */
function withPackage(zipName, manifest, { firefoxTarget = true, identity = true } = {}) {
  return fixture(root => {
    if (identity) {
      writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' });
    }
    if (firefoxTarget) {
      const t = readJson(root, TOOL + '/tool.json');
      t.targets.firefox = { overlay: 'publish/manifest.firefox.json' };
      writeJson(root, TOOL + '/tool.json', t);
      /* The overlay must EXIST: toolinfo.mjs treats a `targets.firefox.overlay`
         pointing at a missing file as a tool.json contract error, which makes
         every gate exit 2 before it reads anything. Writing the declaration
         without the file is how the first draft of these cases turned nine
         mutations into nine identical CANNOT RUNs. */
      writeJson(root, TOOL + '/publish/manifest.firefox.json', {
        browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
      });
    }
    const abs = path.join(root, TOOL, 'publish', zipName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    /* Three shapes, and the Buffer case is here because leaving it out is a
       real bug this file caught: `zipOf({...})` returns a Buffer, fell through
       to the object branch, and was JSON.stringify'd INTO a manifest.json —
       so the "archive with no manifest" case shipped an archive that had one,
       and the gate correctly graded it and the assertion failed. A fixture that
       does not build what its name says builds is a test of nothing.
         string -> written as-is (a file that is not a zip at all)
         Buffer -> written as-is (a zip this case assembled itself)
         object -> wrapped as the archive's manifest.json */
    const bytes = Buffer.isBuffer(manifest) ? manifest
      : typeof manifest === 'string' ? Buffer.from(manifest, 'utf8')
        : zipOf({ 'manifest.json': JSON.stringify(manifest) });
    fs.writeFileSync(abs, bytes);
  });
}

const goodFfManifest = {
  manifest_version: 3, version: '1.0.0', name: 'x',
  browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
};

expect('a package whose gecko.id agrees with identity.json passes', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'goodtool@example.test',
  root: withPackage('goodtool-1.0.0-firefox.zip', goodFfManifest)
});

/* 🔴 THE RECORDED DEFECT. */
expect('a BUILT package carrying the placeholder gecko.id is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

/* Two real-looking domains. No placeholder test catches this one, and AMO fixes
   whichever reaches it first — permanently. */
expect('a package whose gecko.id disagrees with identity.json is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'agrees with publish/identity.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@someone-elses-domain.test' } }
  })
});

expect('a Firefox package with no gecko.id at all is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'carries a gecko.id',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest, browser_specific_settings: { gecko: { strict_min_version: '128.0' } }
  })
});

expect('a listed add-on that self-hosts updates is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'must not self-host updates',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@example.test', update_url: 'https://example.test/u.json' } }
  })
});

/* The chromium package goes to Chrome AND Edge unchanged, so a Firefox-only key
   in it ships twice. The target is decided by CONTENT, so this zip is graded as
   a Firefox one — which is itself the finding: it is named as a chromium
   artifact and is not one. */
expect('a chromium-named package carrying browser_specific_settings is not silently accepted', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0.zip', {
    manifest_version: 3, version: '1.0.0', name: 'x',
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

expect('a stale version beside the current one WARNS rather than passing silently', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'is v0.9.0, the tree is v1.0.0',
  root: withPackage('goodtool-0.9.0-firefox.zip', { ...goodFfManifest, version: '0.9.0' })
});

/* An unreadable archive must not read as a clean one. */
expect('a .zip that is not a zip is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'is a readable zip',
  root: withPackage('goodtool-1.0.0-firefox.zip', 'this is not a zip at all, it is prose')
});

expect('an archive with no manifest.json is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'contains a manifest.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', zipOf({ 'README.md': '# not a store package' }))
});

/* 🔴 THE ANTI-VACUITY PAIR. Zero packages is the CI state and it is legitimate,
   so it exits 0 — and the run must SAY so, because "0 packages, clean" and
   "12 packages, clean" printing the same thing is the failure this whole file
   exists to prevent. */
expect('zero packages exits 0 but says out loud that it proved nothing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'ZERO PACKAGES WERE PRESENT',
  root: fixture(root => { writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' }); })
});

/* 🔴 THE CHROMIUM HALF HAD NO update_url REFUSAL. The gecko branch has refused
   `gecko.update_url` since it was written; the Chromium branch had no equivalent,
   so the SAME bytes could carry a top-level `update_url` to Chrome Web Store and
   Edge Add-ons unremarked. Both stores refuse a listed extension that self-hosts
   updates, at review — which costs a submission slot instead of a build. */
expect('a chromium package that self-hosts updates is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'has no top-level update_url',
  root: withPackage('goodtool-1.0.0-chromium.zip',
    { manifest_version: 3, version: '1.0.0', name: 'x', update_url: 'https://example.test/updates.xml' },
    { firefoxTarget: false })
});

/* 🔴 ONE PACKAGE, TWO STORES. These bytes go to Chrome Web Store AND Edge
   Add-ons, so a localised store field reading "for Chrome" is right in one
   listing and wrong in the other — the same defect as the Edge listing that told
   users to open `chrome://`, one layer down. Resolved through the PACKAGED
   locales, because the store resolves `__MSG_` in the reader's language. */
expect('a localised store field naming Chrome is caught in the shared package', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'names no browser in its localised store fields',
  root: withPackage('goodtool-1.0.0-chromium.zip', zipOf({
    'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', default_locale: 'en', name: '__MSG_appName__' }),
    '_locales/en/messages.json': JSON.stringify({ appName: { message: 'GoodTool for Chrome' } }),
  }), { firefoxTarget: false })
});

/* 🔴 AND THE CASE THAT PROVES THE CHECK PARSES INSTEAD OF GREPPING. `description`
   in a messages.json is TRANSLATOR GUIDANCE and is never shown to a user.
   MEASURED 2026-08-20 on the real tool: 55 of 55 locale files contain the word
   "chrome", every one of them in a `description`. A grep would fire 55 times and
   be wrong 55 times; this must PASS. Without this case the check above could be
   "fixed" into a grep and no test would notice. */
expect('the word chrome in a translator DESCRIPTION is not a finding', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'names no browser in its localised store fields',
  root: withPackage('goodtool-1.0.0-chromium.zip', zipOf({
    'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', default_locale: 'en', name: '__MSG_appName__' }),
    '_locales/en/messages.json': JSON.stringify({
      appName: { message: 'GoodTool', description: 'Shown in the Chrome Web Store and chrome://extensions.' },
    }),
  }), { firefoxTarget: false })
});

expect('a tool declaring no targets CANNOT RUN rather than passing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 2, contains: 'declares no `targets`',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    delete t.targets;
    writeJson(root, TOOL + '/tool.json', t);
  })
});

/* ---------------------------------------------------------------------------
   THE FRESHNESS LIMB — "is this package the tree, or a photograph of it?"

   🔴 THE RECORDED DEFECT, MEASURED 2026-08-26 ON THE REAL TREE. dist/ held a
   build that predated two privacy fixes — content/capture.js, pages/history.js,
   pages/result.js and all 55 locale catalogues differed from the source beside
   it — and `node scripts/check-store-packages.mjs fullshot` printed five PASS
   lines and exited 0. Nothing in that output was false; the missing sentence was
   about age, and a reader seeing 5-PASS concluded the shipping package contained
   the current code.

   The pair below is deliberately a pair with the SAME EXIT CODE, which is
   unusual in this file and is the point: staleness must be LOUD and must NOT
   redden the lane, because opening a package you built earlier is a supported
   use of this command. So the mutation is proven by the WORDS, not by the code,
   and the fresh case proves the words are not printed unconditionally.
   --------------------------------------------------------------------------- */

/* The exact set of files buildBase() writes that goodtool's package.include
   selects. WRITTEN OUT rather than re-derived: a test that computes its
   expectation with the same rules as the code under test proves only that one
   function agrees with itself. The count is asserted below, so a packaged file
   added to the fixture turns this case red instead of quietly shrinking it. */
const PACKAGED = [
  '_locales/en/messages.json',
  'background.js',
  'icons/icon128.png', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png',
  'manifest.json',
  'popup/popup.css', 'popup/popup.html', 'popup/popup.js'
];

/* Writes a package that genuinely IS the fixture tree, into dist/ at the repo
   root — where `pack.mjs --out dist` writes and what ci.yml passes.
   DELIBERATELY NOT the tool's publish/: a zip there is a golden master, the
   bytes a store received, and the limb says something different (and opposite)
   about those — it must never tell anyone to rebuild over one. */
function withBuiltPackage(mutateAfterBuild) {
  return fixture(root => {
    const files = {};
    for (const rel of PACKAGED) files[rel] = fs.readFileSync(path.join(root, TOOL, rel));
    const abs = path.join(root, 'dist', 'goodtool-chromium.zip');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipOf(files));
    if (mutateAfterBuild) mutateAfterBuild(root);
  });
}

expect('a package built from the tree is reported as carrying it', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0,
  contains: '10 packaged file(s) hashed',
  root: withBuiltPackage()
});

/* THE MUTATION IS TO THE SOURCE, NOT TO THE ZIP, because that is the shape the
   defect actually has: nobody edits an artifact. The tree moves on underneath
   one that is still sitting there. */
const staleRoot = withBuiltPackage(root => {
  fs.appendFileSync(path.join(root, TOOL, 'background.js'),
    "chrome.runtime.onStartup.addListener(function () {});\n");
});
expect('a package the tree has moved on from is called stale', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0, contains: 'is STALE'
});
expect('...it names the file that is newer than the package', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0,
  contains: 'newest differing file: background.js'
});
/* 🔴 AND IT STAYS EXIT 0. Asserted as its own line rather than left implicit in
   the two above, because "warns" and "does not fail" are two claims and the one
   that would be silently lost is the second. If this limb is ever "strengthened"
   into a failure, this is the case that says no. */
expect('...and grading an old artifact does NOT redden the lane', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0, contains: '1 warning(s)'
});

/* 🔴 THE ANTI-VACUITY PAIR FOR THIS LIMB. A freshness check that examined
   nothing must never be reachable from the word "fresh", and there are two ways
   to examine nothing. */
expect('a package sharing no file with the tree is not reported as fresh', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0,
  contains: 'shares no file with the tree that would pack it',
  root: withPackage('goodtool-1.0.0-firefox.zip', goodFfManifest)
});

/* The other way: the RULER is empty. include patterns that have stopped
   matching, in a tree with no _locales/ for the unconditional collector to
   union in. This one FAILS while staleness only warns — deliberately, and the
   reason is in the limb's own comment: "this package is old" is a fact about an
   artifact, and "I compared zero files" is the check not running. */
expect('a freshness limb with no file set at all FAILS rather than certifying', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1,
  contains: 'has a file set to compare packages against',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = ['nothing-here/*.js'];
    writeJson(root, TOOL + '/tool.json', t);
    fs.rmSync(path.join(root, TOOL, '_locales'), { recursive: true });
    const m = readJson(root, TOOL + '/manifest.json');
    delete m.default_locale;
    delete m.name;
    delete m.short_name;
    delete m.description;
    writeJson(root, TOOL + '/manifest.json', m);
    const abs = path.join(root, 'dist', 'goodtool-chromium.zip');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipOf({
      'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', name: 'x' })
    }));
  })
});

/* =====================================================================
   check-store-metadata.mjs

   The STORE axis. Two builds, three stores — so the mutations that matter are
   the ones where those two axes are allowed to drift apart, and the one where a
   store limit arrives without anybody having read it from the store.
   ===================================================================== */
console.log('\ncheck-store-metadata.mjs');

const STORE_FILES = {
  'title.txt': 'Good Tool',
  'short-description.txt': 'A fixture extension used by the scripts self-test.',
  'long-description.txt': 'x'.repeat(400),
  'category.txt': 'Productivity',
};
const SHARED_FILES = {
  'privacy-policy-url.txt': 'https://example.test/privacy',
  'support-url.txt': 'https://example.test/support',
  'screenshots/README.md': '# 1280x800, the one size all three stores take\n',
};

/* A complete, correct store layer on the fixture tool: three rows, two targets,
   every directory populated. Mutations below start from this and break one
   thing, so a failure can only be the thing that was broken. */
function withStores(mutate = () => {}) {
  return fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.targets = { chromium: { stores: ['chrome', 'edge'] }, firefox: { overlay: 'publish/manifest.firefox.json' } };
    writeJson(root, TOOL + '/publish/manifest.firefox.json', {
      browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
    });
    /* The URL files are a SECOND copy of what identity.json declares, so the
       fixture carries both — a drift check with only one side present is not a
       drift check, it is an existence check wearing one. */
    writeJson(root, TOOL + '/publish/identity.json', {
      slug: 'goodtool', ownerDomain: 'example.test', supportEmail: 'support@example.test',
      privacyPolicyUrl: SHARED_FILES['privacy-policy-url.txt'],
    });
    t.storeMetadata = {
      sharedDir: 'store/_shared',
      stores: {
        chrome: { target: 'chromium', dir: 'store/chrome', served: false },
        edge: { target: 'chromium', dir: 'store/edge', served: false },
        firefox: { target: 'firefox', dir: 'store/firefox', served: false },
      },
    };
    const dirs = { chrome: 'store/chrome', edge: 'store/edge', firefox: 'store/firefox' };
    for (const d of Object.values(dirs)) {
      for (const [f, body] of Object.entries(STORE_FILES)) w(root, TOOL + '/' + d + '/' + f, body + '\n');
    }
    for (const [f, body] of Object.entries(SHARED_FILES)) w(root, TOOL + '/store/_shared/' + f, body + '\n');
    /* A real PNG, so the screenshots limb's PASS path is exercised too and the
       mutations below are the only thing that can empty the directory. */
    fs.copyFileSync(path.join(REPO, 'templates', 'tool', 'icons', 'icon128.png'),
      path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png'));
    mutate(t, root);
    writeJson(root, TOOL + '/tool.json', t);
  });
}

expect('a complete three-store layer passes', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: '3 store row(s) graded',
  root: withStores()
});

/* 🔴 THE AXIS MUTATIONS — the two that let builds and stores drift apart. */
expect('a store naming a target that does not exist is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'which is not in targets',
  root: withStores(t => { t.storeMetadata.stores.edge.target = 'webkit'; })
});
expect('a target no store claims is caught — an artifact going nowhere', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'is claimed by at least one store',
  root: withStores(t => { t.targets.safari = { overlay: null }; })
});

/* The three declarations of the store set must agree. */
expect('a store set that disagrees with the schema vocabulary is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'two declarations of one fact',
  root: withStores(t => { delete t.storeMetadata.stores.firefox; })
});

/* served is a GATE — the same absence, two verdicts. */
expect('a MISSING directory on an unserved store PRINTS and exits 0', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'NO TREE (not served)',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true }); })
});
expect('the SAME missing directory on a SERVED store FAILS', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the listing is live',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true });
  })
});

/* What is owner-gated is CREATING a listing, not KEEPING one. */
expect('an EMPTIED listing field fails even on an unserved store', {
  /* A single-line fragment on purpose: Report.fail() re-indents every wrapped
     line by eight spaces, so a `contains` that spans the wrap never matches
     even when the gate is behaving perfectly. */
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An empty listing field is worse than a missing one',
  root: withStores((t, root) => { w(root, TOOL + '/store/chrome/title.txt', '   \n'); })
});
expect('a missing required listing field is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'category.txt exists',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'edge', 'category.txt')); })
});

expect('an orphan directory under store/ is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'orphaned, unreachable',
  root: withStores((t, root) => { w(root, TOOL + '/store/opera/title.txt', 'left behind\n'); })
});

/* 🔴 THE LIMIT MUTATIONS. An invented limit fires on correct input. */
expect('a limit with no source is REFUSED rather than enforced', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An invented limit fires on CORRECT input',
  root: withStores(t => { t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 75 } }; })
});
expect('a value over a SOURCED limit is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a maximum of 5',
  root: withStores(t => {
    t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 5, source: 'https://developer.chrome.com/x (fetched 2026-08-20)' } };
  })
});
expect('a value under a SOURCED minimum is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a minimum of 250',
  root: withStores(t => {
    t.storeMetadata.stores.edge.limits = { 'title.txt': { min: 250, source: 'https://learn.microsoft.com/x (fetched 2026-08-20)' } };
  })
});

/* 🔴 THE CONTENT MUTATIONS ON THE SHARED URL FILES.
   Until 2026-08-22 these files were graded on existence and non-blankness
   alone, and the real tree shipped a `privacy-policy-url.txt` whose entire
   content was the word NOT-YET-HOSTED plus a comment saying no submission could
   proceed — printing PASS the whole time, a day after identity.json had been
   filled with the live URL. Every case below is red against that version of the
   guard and green against this one. */
expect('a URL file holding a refusal notice instead of a URL is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'which is not an https URL',
  root: withStores((t, root) => { w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'NOT-YET-HOSTED\n'); })
});
expect('a URL file that disagrees with publish/identity.json is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'One URL, two files, two values',
  root: withStores((t, root) => { w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'https://example.test/other-privacy\n'); })
});
expect('a URL file holding two URLs is caught — a store field takes one', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'Two lines is two answers',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'https://example.test/privacy\nhttps://example.test/privacy2\n');
  })
});
/* The file may carry a dated correction beside the value — the real tree's does
   — so a `#` comment must not be read as a second URL. */
expect('a # comment beside the URL is not a second URL', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'agrees with publish/identity.json privacyPolicyUrl',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '# CORRECTED 2026-08-22, was NOT-YET-HOSTED\nhttps://example.test/privacy\n');
  })
});
/* Hosting is owner work, so an unfilled URL PRINTS while nothing is served and
   FAILS the moment a listing is live — the same split `served` already governs.
   A guard permanently red on one person's work teaches everyone red is
   negotiable; a guard green over a live wrong listing teaches nothing at all. */
expect('an unfilled URL with identity.json ALSO unfilled is an OWNER action, not a failure', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'is not filled in yet',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '⟨HTTPS URL OF THE HOSTED PRIVACY POLICY⟩\n');
    const id = readJson(root, TOOL + '/publish/identity.json');
    delete id.privacyPolicyUrl;
    writeJson(root, TOOL + '/publish/identity.json', id);
  })
});
expect('the SAME unfilled URL FAILS once a store is served', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the listing is live and this field is already public',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '⟨HTTPS URL OF THE HOSTED PRIVACY POLICY⟩\n');
    const id = readJson(root, TOOL + '/publish/identity.json');
    delete id.privacyPolicyUrl;
    writeJson(root, TOOL + '/publish/identity.json', id);
  })
});

/* A read that FAILS is not a result that is EMPTY. An identity.json that does
   not parse would leave every URL file graded as "nothing to compare against" —
   the agreement check disarmed, in silence, still printing PASS. */
expect('an unparseable identity.json is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'must not read as',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', '{ oops\n'); })
});
/* 🔴 AND THE SAME HOLE ONE LEVEL IN: PARSES ≠ USABLE. `[]`, `null`, `"x"` and
   `3` are all valid JSON, so the catch above never fires for them — and every
   one of them makes `identity[field]` undefined, which the grader then reads as
   "identity.json declares no URL". The drift check is disarmed exactly as an
   unparseable file would disarm it, in silence, while the URL file still prints
   a bare PASS. Both cases below exit 0 against the version of the guard shipped
   earlier in this round and 1 against this one. */
expect('an identity.json that is an ARRAY is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'it parses as an array',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', '[]\n'); })
});
expect('an identity.json that is JSON `null` is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'it parses as null',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', 'null\n'); })
});

/* 🔴 SCREENSHOTS: the README is not an image. REQUIRED_SHARED lists
   `screenshots/README.md`, so the entire screenshot requirement used to be
   satisfied by a text file explaining that there are no screenshots. */
expect('a served listing with zero screenshots is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the directory holds no .png/.jpg, and a store row is `served: true`',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    fs.rmSync(path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png'));
  })
});
expect('the SAME empty screenshots directory is an OWNER action while nothing is served', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'holds no images yet',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png')); })
});

/* 🔴 THE DOCUMENTED `--all` INVOCATION, WHICH HAD NEVER RUN. loadAllTools
   returns an object, not an array, so `!tools.length` was always true and the
   flag in this guard's own usage line died with "no tool resolved" on a tree
   holding a complete store layer. No case covered it, which is why it survived.
   The second limb is the half that matters more: --all must not swallow a
   tool.json that will not load. */
expect('--all grades the tree instead of refusing to run', {
  script: 'check-store-metadata.mjs', argv: ['--all'], code: 0, contains: '3 store row(s) graded',
  root: withStores()
});
expect('--all refuses when a tool.json will not load, rather than grading a shorter tree', {
  script: 'check-store-metadata.mjs', argv: ['--all'], code: 2, contains: 'the tool set is not the tree',
  root: withStores((t, root) => { w(root, 'Extension/Broken_Tool/tool.json', '{ oops\n'); })
});

/* Anti-vacuity. */
expect('an emptied store set CANNOT RUN rather than passing', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'row set IS the subject',
  root: withStores(t => { t.storeMetadata.stores = {}; })
});
expect('a tool with targets but NO storeMetadata is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'checked by nothing',
  root: withStores(t => { delete t.storeMetadata; })
});

/* =====================================================================
   assert-e2e-proof-fresh.mjs

   Network-backed and ADVISORY, so every case drives its offline affordance:
   PROOF_ALARM_FIXTURE injects the run history, PROOF_ALARM_NOW pins the clock,
   and the ceiling stays DERIVED from the fixture tree's own e2e.yml cron.
   ===================================================================== */
console.log('\nassert-e2e-proof-fresh.mjs');

const PROOF_NOW = '2026-08-26T00:00:00Z';
const PROOF_HISTORY = 'proof-history.json';
const proofAgo = d => new Date(Date.parse(PROOF_NOW) - d * 86400000).toISOString();
const proofEnv = root => ({ PROOF_ALARM_FIXTURE: path.join(root, PROOF_HISTORY), PROOF_ALARM_NOW: PROOF_NOW });

/* A weekly cron and a matrix job named at the 4-space job indent: the two facts
   the gate re-derives its ceiling and its GREEN matcher from. */
const E2E_WEEKLY = [
  'name: e2e',
  'on:',
  '  schedule:',
  "    - cron: '17 4 * * 1'",
  'jobs:',
  '  e2e:',
  '    name: e2e (${{ matrix.dir }})',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo fixture',
  ''
].join('\n');

/* THE REAL LEG SHAPE. e2e.yml:84 names the matrix job `e2e · <Category>/<Tool>`,
   and the gate now parses that payload and compares it as a SET — so a fixture
   carrying a made-up name would prove nothing about the real one. The separator
   is the real U+00B7, written as itself so the character makes the whole trip:
   this source, a utf8 fixture write, a JSON parse, the gate. The case below
   drives what happens when that trip mangles it. */
const proofLeg = (c, dirs = [TOOL]) => dirs.map(d => ({ name: 'e2e · ' + d, conclusion: c }));
/* Three weekly scheduled runs, all green, the newest 2 days old.

   `wf.suites` is the DISK side of the subject and it is separate from `h` on
   purpose: the gate derives how many legs a green run must carry by walking
   the tree for <Category>/<Tool>/test/e2e/package.json, so a case that moves
   the tree and a case that moves the history are testing different limbs. The
   base tree carries exactly one suite, which is what makes the shipped history
   above green.

   `wf.wiredDoc` is the COMMITTED side, scripts/e2e-suites.json, and it lives in
   the fixture tree rather than in the gate as of 2026-08-27. Left alone it is
   written to agree with `wf.suites`, which is what keeps every case above about
   the limb it is about; `null` means WRITE NO FILE, and a string is written
   verbatim so a malformed document can be driven too. */
const SUITES_REL = 'scripts/e2e-suites.json';
function withProof(mutate = () => {}) {
  return fixture(root => {
    const h = {
      workflow_runs: [
        { id: 3, event: 'schedule', created_at: proofAgo(2) },
        { id: 2, event: 'schedule', created_at: proofAgo(9) },
        { id: 1, event: 'schedule', created_at: proofAgo(16) }
      ],
      jobs: { 3: proofLeg('success'), 2: proofLeg('success'), 1: proofLeg('success') }
    };
    const wf = { yaml: E2E_WEEKLY, suites: [TOOL], wiredDoc: undefined };
    mutate(h, wf, root);
    if (wf.yaml !== null) w(root, '.github/workflows/e2e.yml', wf.yaml);
    for (const dir of wf.suites) w(root, dir + '/test/e2e/package.json', '{ "name": "e2e-fixture", "private": true }\n');
    if (wf.wiredDoc === null) { /* the file is absent on purpose */ }
    else if (typeof wf.wiredDoc === 'string') w(root, SUITES_REL, wf.wiredDoc);
    else writeJson(root, SUITES_REL, wf.wiredDoc === undefined ? { suites: wf.suites } : wf.wiredDoc);
    writeJson(root, PROOF_HISTORY, h);
  });
}

/* 🔴 ALSO THE path.sep SEAM, AND WINDOWS IS THE SIDE THAT CAN SEE IT. The gate
   derives `Extension/Good_Tool` from a directory walk and compares it to a leg
   name a Linux runner built from `${cat}/${tool}`. Joined with path.sep instead
   of '/', this case is RED here and GREEN on Ubuntu — so the local recipe is
   the one that catches it, which is the rarer direction and worth saying. */
expect('a fired timer and a green scheduled run pass', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: withProof(), env: proofEnv
});
expect('a dead cron is caught — no scheduled run inside the ceiling', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'THE CRON IS DEAD OR DISABLED',
  root: withProof(h => { h.workflow_runs.forEach((r, i) => { r.created_at = proofAgo(30 + i * 7); }); }),
  env: proofEnv
});
expect('a firing cron whose every run was red is caught', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'NO GREEN SCHEDULED RUN',
  root: withProof(h => { for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('failure'); }),
  env: proofEnv
});
expect('a green proof past the ceiling is caught while the timer is still fresh', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'THE WEEKLY PROOF IS STALE',
  root: withProof(h => { h.jobs[3] = proofLeg('failure'); h.jobs[2] = proofLeg('failure'); }),
  env: proofEnv
});
/* 🔴 THE VACUITY LIMB. A run with ZERO matching legs must not read as green —
   a vacuous `every` over an empty list is how a renamed job reports health. */
expect('a run whose e2e legs no longer match is not-green rather than green', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'legs=0/1  not-green',
  root: withProof(h => { for (const k of Object.keys(h.jobs)) h.jobs[k] = [{ name: 'Discover e2e suites', conclusion: 'success' }]; }),
  env: proofEnv
});
/* 🔴 THE PARTIAL-DISCOVERY LIMB, AND THE REASON THIS GATE AND e2e.yml'S JOB ARE
   ONE FILE AS OF 2026-08-27. The tree carries TWO suites, the history carries
   ONE green leg per run, and a vacuity-only floor certifies that as a fresh
   proof of both. This case is what the collapse is for: until that day the gate
   read `legs.length > 0`, which is the shape MEASURED to pass this — the count
   mutated back out, this case returns exit 0 and logs `legs=1/2  GREEN`. */
expect('a proof covering FEWER suites than the checkout is not-green', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'did not run the 2 leg(s) this checkout expects',
  root: withProof((h, wf) => { wf.suites = [TOOL, 'Extension/Second_Tool']; }),
  env: proofEnv
});
/* 🔴 THE SET LIMB — the one a CARDINALITY cannot have. One suite in the
   checkout, one green leg in every run, count 1 === 1 — and the leg names a
   tool this checkout does not carry, so Good_Tool has never been exercised by
   any run in that history. MEASURED 2026-08-27 against the count this replaced:
   exit 0, `legs=1/1  GREEN`. Both directions of the difference are asserted in
   one string, because naming only the missing side would let a gate that
   silently accepted foreign legs still pass this. */
expect('a proof whose legs name a DIFFERENT tool of the same count is not-green', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'NEVER EXERCISED: Extension/Good_Tool  NOT IN THIS CHECKOUT: Extension/GONE_Tool',
  root: withProof(h => {
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', ['Extension/GONE_Tool']);
  }),
  env: proofEnv
});
/* 🔴 THE ENCODING BOUNDARY, DRIVEN RATHER THAN ASSUMED. `·` is U+00B7 and it
   crosses the GitHub API and a source-encoding boundary to reach the gate. The
   separator is matched as a run of non-alphanumerics, never as that byte pair,
   so the classic Windows-side mangling of it — U+00C2 U+00B7 — still yields the
   same dir. A parse pinned to the character would have reported this perfect
   proof as no proof at all. */
expect('a mangled leg separator still yields the same dir', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: withProof(h => {
    for (const k of Object.keys(h.jobs)) h.jobs[k] = [{ name: 'e2e Â· ' + TOOL, conclusion: 'success' }];
  }),
  env: proofEnv
});
/* 🔴 A leg name that yields NO payload must not read as a missing leg — that is
   a true-sounding red for the wrong reason. Zero payloads across the whole walk
   is the gate having gone blind, and it says so. */
expect('leg names that yield no <cat>/<tool> are COVERAGE LOST, not a missing leg', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'this gate is reading nothing out of it',
  root: withProof(h => {
    for (const k of Object.keys(h.jobs)) h.jobs[k] = [{ name: 'e2e ·', conclusion: 'success' }];
  }),
  env: proofEnv
});
/* Anti-vacuity on the DERIVATION itself: an expected count of 0 makes
   `legs.length === EXPECT_LEGS` true of every empty run, so the count must
   refuse to be zero rather than grade against nothing. */
expect('a checkout carrying no e2e suite at all CANNOT grade a run', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'carries no <Category>/<Tool>/test/e2e/package.json',
  root: withProof((h, wf) => { wf.suites = []; }),
  env: proofEnv
});
/* 🔴 THE FOUR MEASURED 2026-08-27 AS EXIT 0 ON THE SHIPPED GATE, each a green
   that the mutation named in its label produces without touching the history. */
expect('a run whose legs DUPLICATE one dir is not-green, not a matching count', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: '1 DUPLICATE leg name(s) — 2 legs naming 1 dir(s)',
  root: withProof(h => {
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', [TOOL, TOOL]);
  }),
  env: proofEnv
});
expect('deleting one test/e2e/package.json cannot silence the red it was raising', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'a test/e2e directory with no package.json in it: Extension/Second_Tool',
  root: withProof((h, wf, root) => {
    fs.mkdirSync(path.join(root, 'Extension', 'Second_Tool', 'test', 'e2e'), { recursive: true });
  }),
  env: proofEnv
});
/* 🔴 THE SIBLING THE CASE ABOVE DOES NOT REACH, MEASURED 2026-08-27 AS EXIT 0.
   `rm test/e2e/package.json` is caught only because it LEAVES THE DIRECTORY
   BEHIND to be found; `rm -r test/e2e` leaves nothing, so the tool stops being
   discovered and the expected set shrinks with no red — the same commit deletes
   the suite and silences the alarm about it. On the bite tree (two suites, a
   proof covering one): exit 1, then rm -r the second suite's test/e2e and
   nothing else, exit 0, `legs=1/1 GREEN`.

   scripts/e2e-suites.json is the committed side that closes it, and the cases
   below are its pair. Held as a constant inside the gate until 2026-08-27 it had
   to be inert wherever the TOOL directory was absent — one repository's fact
   would otherwise have been smuggled into whatever `--repo-root` named — and
   that inertness was a hole of its own: MEASURED 2026-08-27 on a two-suite bite
   tree, `rm -rf Extension/Full_Screen_Shot` with the run history losing the same
   leg gave `legs=1/1  GREEN`, exit 0. The list travels with the checkout now, so
   the case below deletes the WHOLE TOOL and still expects a red. */
const WIRED = 'Extension/Full_Screen_Shot';
expect('deleting the WHOLE TOOL directory cannot silence the red it was raising', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: WIRED + ' is named in scripts/e2e-suites.json and this checkout has no',
  root: withProof((h, wf) => { wf.wiredDoc = { suites: [TOOL, WIRED] }; }),
  env: proofEnv
});
/* The nearer sibling, one step over: the tool directory survives and only its
   test/e2e is gone. Both must redden, and for the same reason. */
expect('deleting only test/e2e, with the tool directory left behind, reddens too', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: WIRED + ' is named in scripts/e2e-suites.json and this checkout has no',
  root: withProof((h, wf, root) => {
    wf.wiredDoc = { suites: [TOOL, WIRED] };
    fs.mkdirSync(path.join(root, WIRED), { recursive: true });
  }),
  env: proofEnv
});
/* The half that stops the two above from being checks that are simply always
   red: the SAME committed tool, its suite intact and exercised, passes. Without
   this they could not tell "the directory is gone" from "the name is listed". */
expect('a committed suite that still has its test/e2e is not reported as removed', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: withProof((h, wf) => {
    wf.suites = [TOOL, WIRED];
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', [TOOL, WIRED]);
  }),
  env: proofEnv
});
/* 🔴 THE OTHER DIRECTION, WHICH WAS A `::notice::` AND EXIT 0 UNTIL 2026-08-27.
   A suite that is in the tree and in no committed list is protected by nothing:
   deleting it shrinks the derived set and there is no committed side to
   disagree. It could not be a red while the list was a constant in the gate,
   because that constant was wrong for every checkout but one. A file that
   travels with the checkout can be right for it, so it is a red that names the
   suite — and a suite added today is protected today. */
expect('a suite in the tree and NOT in the committed file is a RED, not a notice', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'Extension/Second_Tool carries a test/e2e suite and is NOT named in scripts/e2e-suites.json',
  root: withProof((h, wf) => {
    wf.suites = [TOOL, 'Extension/Second_Tool'];
    wf.wiredDoc = { suites: [TOOL] };
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', wf.suites);
  }),
  env: proofEnv
});
/* 🔴 THE DECOY SHAPE, WHICH THIS REPOSITORY HAS ALREADY BEEN BITTEN BY ONCE —
   see the PROOF_ALARM_WORKFLOW case below. Resolved against the gate's own repo
   instead of ROOT, the list would be THIS repository's for every `--repo-root`
   tree, and every fixture above would be graded against a suite set that has
   nothing to do with it. The name below exists in no checkout anywhere, so it
   can only have come out of the fixture tree's own file. */
expect('the committed list is read from the GRADED tree, not from this repository', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'Vendor/Not_On_Disk is named in scripts/e2e-suites.json',
  root: withProof((h, wf) => {
    wf.suites = ['Vendor/Only_Here'];
    wf.wiredDoc = { suites: ['Vendor/Not_On_Disk'] };
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', wf.suites);
  }),
  env: proofEnv
});
/* 🔴 THE FOUR WAYS THE COMMITTED SIDE CAN GO ABSENT WHILE THE GATE STILL RUNS.
   Every one of them would leave `WIRED_SUITES` an empty array, and an empty
   array is a comparison over nothing that EVERY deletion passes — the exact
   green-while-broken this whole limb exists to prevent. Three CANNOT RUN; the
   fourth, an explicitly emptied list, is a red that says how a suite is
   actually retired. */
expect('no scripts/e2e-suites.json at all CANNOT RUN rather than passing', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2,
  contains: 'could not reach scripts/e2e-suites.json',
  root: withProof((h, wf) => { wf.wiredDoc = null; }),
  env: proofEnv
});
expect('a RENAMED suites key CANNOT RUN rather than reading as an empty list', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2,
  contains: 'carries no `suites` array',
  root: withProof((h, wf) => { wf.wiredDoc = { Suites: [TOOL] }; }),
  env: proofEnv
});
expect('an unparseable scripts/e2e-suites.json CANNOT RUN', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2,
  contains: 'could not be read as JSON',
  root: withProof((h, wf) => { wf.wiredDoc = '{ "suites": [ oops\n'; }),
  env: proofEnv
});
expect('an EMPTIED suites array is COVERAGE LOST, not a list every deletion passes', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'is empty, so the comparison below is over nothing',
  root: withProof((h, wf) => { wf.wiredDoc = { suites: [] }; }),
  env: proofEnv
});
/* A name listed twice: the set comparison collapses the repeat, so one of the
   two lines can be deleted with the tree untouched and NOTHING here moves. The
   tree and the list agree in this case, so the duplicate is the only red — which
   is what proves it is caught here and not incidentally by the comparison. */
expect('a name listed TWICE is COVERAGE LOST — one of those lines protects nothing', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'names ' + TOOL + ' more than once',
  root: withProof((h, wf) => { wf.wiredDoc = { suites: [TOOL, TOOL] }; }),
  env: proofEnv
});
/* 🔴 THE path.sep SEAM ON THE COMMITTED SIDE. The walk builds every name by
   joining with '/', so a backslash-joined entry can never equal one — it would
   sit in the list reading as protection while protecting nothing, and it is
   exactly what a Windows author copying a path produces. */
expect('a backslash-joined entry CANNOT RUN rather than sitting in the list inert', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2,
  contains: 'entr(ies) that are not a `<Category>/<Tool>` string',
  root: withProof((h, wf) => { wf.wiredDoc = { suites: ['Extension\\Good_Tool'] }; }),
  env: proofEnv
});
/* 🔴 THE CASE-ONLY RENAME, WHICH WAS INERT UNTIL 2026-08-27 AND IS CLOSED HERE
   BY IDENTITY, NEVER BY SPELLING. Nothing casefolds: the walk reports the name
   the filesystem actually holds, and the committed list still holds the old one,
   so the two sets differ on BOTH hosts. MEASURED 2026-08-27 on a two-suite bite
   tree renamed Full_Screen_Shot -> full_screen_shot: Windows exit 1 and WSL2 on
   a case-SENSITIVE native filesystem exit 1, the same two findings. A casefolded
   compare would have passed here and failed on Ubuntu. */
expect('a CASE-ONLY rename of the tool directory reddens, on either host', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'Extension/second_tool carries a test/e2e suite and is NOT named in',
  root: withProof((h, wf) => {
    wf.suites = [TOOL, 'Extension/second_tool'];
    wf.wiredDoc = { suites: [TOOL, 'Extension/Second_Tool'] };
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', wf.suites);
  }),
  env: proofEnv
});
/* The one case that grades the SHIPPED bytes rather than a fixture: this
   repository's own tree against this repository's own scripts/e2e-suites.json,
   with the run history injected and built FROM that file. A file naming a suite
   the tree does not carry, or a tree carrying a suite the file does not name,
   fails it in the respective direction. Without this every case above could
   pass over a committed list that describes nothing here. */
const shippedHistoryDir = (() => {
  const d = fixture();
  const wired = JSON.parse(fs.readFileSync(path.join(REPO, SUITES_REL), 'utf8')).suites;
  writeJson(d, PROOF_HISTORY, {
    workflow_runs: [{ id: 9, event: 'schedule', created_at: proofAgo(2) }],
    jobs: { 9: proofLeg('success', wired) }
  });
  return d;
})();
expect('the SHIPPED scripts/e2e-suites.json is the SHIPPED tree, both directions', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: REPO,
  env: () => ({ PROOF_ALARM_FIXTURE: path.join(shippedHistoryDir, PROOF_HISTORY), PROOF_ALARM_NOW: PROOF_NOW })
});
/* 🔴 A FALSE RED WITH A NONSENSE MESSAGE, MEASURED 2026-08-27 ON A PERFECT
   PROOF: the leg parser's separator run `[^A-Za-z0-9]+` is greedy and the
   payload had to start alphanumeric, so `e2e · _Vendor/Tool_A` yielded
   `Vendor/Tool_A` and the gate reported `NEVER EXERCISED: _Vendor/Tool_A  NOT
   IN THIS CHECKOUT: Vendor/Tool_A`, exit 1. The tree walk skips dot-names and
   LEG_SKIP only, so an underscore category is discovered and reachable. */
expect('a category directory starting with an underscore is not a false red', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: withProof((h, wf) => {
    wf.suites = ['_Vendor/Tool_A'];
    for (const k of Object.keys(h.jobs)) h.jobs[k] = proofLeg('success', ['_Vendor/Tool_A']);
  }),
  env: proofEnv
});
/* The guarantee the underscore repair must not cost: the gate's own comment
   promises a separator retyped as a dash still parses, and the whitespace form
   that fixes the underscore cannot see this one. It is pinned rather than
   assumed, because a fallback nothing exercises is a fallback nobody knows is
   dead. */
expect('a leg separator retyped as a bare dash still yields the same dir', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 0, contains: 'proof-fresh ok',
  root: withProof(h => {
    for (const k of Object.keys(h.jobs)) h.jobs[k] = [{ name: 'e2e-' + TOOL, conclusion: 'success' }];
  }),
  env: proofEnv
});
expect('a suite reachable only as Test/E2E is named and excluded, on either host', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'reachable only under a different case: Extension/Case_Tool',
  root: withProof((h, wf, root) => {
    w(root, 'Extension/Case_Tool/Test/E2E/package.json', '{ "name": "e2e-fixture", "private": true }\n');
  }),
  env: proofEnv
});
expect('a workflow reachable only as .github/workflows/E2E.yml CANNOT RUN either', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2,
  contains: 'a case a Linux runner does not open',
  root: withProof((h, wf, root) => {
    wf.yaml = null;
    w(root, '.github/workflows/E2E.yml', E2E_WEEKLY);
  }),
  env: proofEnv
});

/* The two self-checks: the ceiling and the matcher are derived, so the facts
   they are derived FROM are load-bearing. */
expect('a cron that stopped being weekly reddens the derived ceiling', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'are not weekly',
  root: withProof((h, wf) => { wf.yaml = wf.yaml.replace('17 4 * * 1', '17 4 1 * *'); }),
  env: proofEnv
});
expect('a renamed e2e job reddens the matcher the GREEN limb keys on', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1,
  contains: 'no job in e2e.yml carries a name starting e2e at the job indent',
  root: withProof((h, wf) => { wf.yaml = wf.yaml.replace('    name: e2e (', '    name: suite ('); }),
  env: proofEnv
});
expect('an unreadable e2e.yml CANNOT RUN rather than reporting freshness', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 2, contains: 'nothing to derive it from',
  root: withProof((h, wf) => { wf.yaml = null; }), env: proofEnv
});
/* 🔴 BOTH SELF-CHECKS ABOVE READ ONE FILE, AND UNTIL 2026-08-27 `wfPath` opened
   `process.env.PROOF_ALARM_WORKFLOW ||` — no banner, unlike PROOF_ALARM_FIXTURE.
   Pointed at the real healthy e2e.yml, this cron-less checkout MEASURED exit 0. */
expect('a decoy workflow path cannot move the self-check off this checkout', {
  script: 'assert-e2e-proof-fresh.mjs', argv: [], code: 1, contains: 'declares no cron',
  root: withProof((h, wf) => { wf.yaml = wf.yaml.replace(/^ *- cron:.*\n/m, ''); }),
  env: root => ({ ...proofEnv(root), PROOF_ALARM_WORKFLOW: path.join(REPO, '.github', 'workflows', 'e2e.yml') })
});

/* =====================================================================
   argument handling
   ===================================================================== */
console.log('\nargument handling');
expect('a mistyped flag is refused, not ignored', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warings-as-errors'], root: fixture(), code: 2, contains: 'unknown option'
});
expect('naming no tool at all refuses', {
  script: 'policy-check.mjs', argv: [], root: fixture(), code: 2, contains: 'no tool given'
});

/* =====================================================================
   coverage — is there a case in this file for every gate CI actually runs?
   =====================================================================

   EXT-GUARD-COVERAGE. Every pair above proves that ONE NAMED gate bites.
   Nothing above notices a gate that has NO pair at all, and on the checks
   list a gate nobody tests is indistinguishable from a gate that passes —
   which is this file's own opening paragraph turned back on itself.
   Platform_Public answers this with an assert-guard-coverage step; this
   repository has no such script, and the only file the answer can live in
   is the suite whose coverage is in question.

   BOTH SETS ARE DERIVED, NEITHER IS LISTED. The invoked set is read out of
   .github/workflows; the covered set is read out of this file's own source.
   A hand-written copy of either would be a second declaration of a fact the
   workflows already state, and the copy is the one that rots — toward
   looking healthier than the repository is. That is the same reasoning the
   `gate-inventory` job in ci.yml is built on, and this is the other half of
   it: that job asks whether a called gate EXISTS, this asks whether a
   called gate is PROVEN.

   WHAT IT IS NOT. It does not assert that a gate is well tested — one case
   satisfies it. It asserts only that the number of cases is not zero, which
   is the distinction between a gate that was thought about and one that was
   never looked at. ===================================================== */
console.log('\ncoverage (which workflow-invoked gates have a case here)');

/* Filled in from the derived sets below and printed by the final summary line,
   which used to end "every gate proven to bite on a real mutation" full stop.
   ⚠️ CORRECTED 2026-08-25: measured that day, that sentence was true of the 7
   gates with a case and said nothing about the 10 that have none — an
   overclaim of exactly the kind this section exists to detect, printed by the
   suite itself on every green run. The numbers in it are now derived on the
   run that prints them rather than asserted in prose. */
let COVERAGE_NOTE = '';

/* Kept deliberately in step with the pattern in ci.yml's `gate-inventory`
   step, including its narrowness: the full `Extension/<Tool>/publish/`
   prefix is required, because a bare `publish/<name>.node.js` is a
   tool-relative path that does not resolve from the repository root and
   appears in prose. A fresh RegExp per call — a shared /g literal carries
   lastIndex between calls and would silently drop matches. */
const gateHits = text => text.match(
  /(?:scripts|Extension\/[A-Za-z0-9_]+\/publish)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:mjs|node\.js)/g
) || [];

/* One line in, one line out, comment removed. YAML comments and the shell
   comments inside a `run: |` body are the same shape and the same hazard, so
   they get the same treatment: a `#` counts only where a comment can start —
   at the head of the line or after whitespace — and never inside quotes. The
   quote state is per line on purpose; a string spanning lines inside a run
   body would be a block scalar of its own. */
function stripComments(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
const stripAll = text => text.split(/\r?\n/).map(stripComments).join('\n');

const repoRel = abs => path.relative(REPO, abs).split(path.sep).join('/');

/* Resolve the directory GitHub reads workflows from, for THIS checkout. */
function workflowDir() {
  const own = path.join(REPO, '.github', 'workflows');
  try { fs.readdirSync(own); return own; } catch (_) { /* fall through */ }
  try {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' });
    if (top.status === 0) {
      const at = path.join(path.resolve(top.stdout.trim()), '.github', 'workflows');
      fs.readdirSync(at);
      return at;
    }
  } catch (_) { /* not a work tree, or no workflows above it */ }
  return null;
}

/* gate path -> Set of workflow files that call it. `null` means the workflow
   directory could not be read at all, which is COVERAGE LOST, not zero gaps. */
function gatesInvokedByWorkflows() {
  /* WHERE GITHUB ACTUALLY READS WORKFLOWS FROM. This tree's own directory is
     tried first — the standalone-repository case, and the case again after a
     `git subtree split --prefix=extensions` — and the enclosing repository's
     root second, which is where they live since 2026-09-05 ([ADR 067]
     decision 1). git is ASKED rather than assumed, so a fixture tree that is
     not a work tree simply yields the one candidate it has. */
  const dir = workflowDir();
  if (dir === null) return null;
  let files;
  try { files = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f)); }
  catch (_) { return null; }

  /* 🔴 WHEN THE WORKFLOWS ARE ABOVE THIS TREE, ONLY THIS TREE'S LANE COUNTS —
     and the first spelling of this function did not say so, which produced a
     real false red on the day of the merge: it read the platform's ci.yml,
     matched `scripts/check-selection-record.mjs` and `scripts/provision-backend.mjs`
     (which are tooling/scripts/ files belonging to a different tree entirely),
     and demanded a red/green case here for gates this repository does not own.

     The predicate is the same one tooling/ci/assert-lane-coverage.mjs uses to
     recognise the extension lane: a workflow whose defaults set
     `working-directory: extensions`. That is what makes a bare `scripts/x.mjs`
     in its body mean THIS tree's scripts/. A workflow without it is talking
     about some other tree, and its gates are not this file's business.

     ⚠️ It applies ONLY when the directory is not this tree's own. In a
     standalone checkout — which is what `git subtree split --prefix=extensions`
     produces — every workflow is this tree's and no filter is wanted. */
  const own = path.join(REPO, '.github', 'workflows');
  if (path.resolve(dir) !== path.resolve(own)) {
    files = files.filter((f) => /^[ \t]*working-directory:[ \t]*extensions[ \t]*$/m
      .test(fs.readFileSync(path.join(dir, f), 'utf8')));
  }

  const found = new Map();
  for (const f of files) {
    for (const hit of gateHits(stripAll(fs.readFileSync(path.join(dir, f), 'utf8')))) {
      const gate = path.posix.normalize(hit);
      if (!found.has(gate)) found.set(gate, new Set());
      found.get(gate).add(f);
    }
  }
  return found;
}

/* The covered set is this file, read as text. A case names its gate in the
   same key `run()` resolves against SCRIPTS, so the same resolution is done
   here and the result is made repo-relative — a future case reaching a gate
   outside scripts/ lands in the set without this needing to change.
   SELF-REFERENCE, PINNED: the matcher below is anchored to the head of a
   line, and the only line in this block that carries that key is inside a
   regular expression whose line starts with `const`. Measured 2026-08-25 on
   the file as written: 10 gate names, unchanged by adding this section. */
function gatesWithACaseInThisFile() {
  const src = fs.readFileSync(__filename, 'utf8');
  const re = /^[ \t]*script:[ \t]*'([^'\n]+)'/gm;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(repoRel(path.resolve(SCRIPTS, m[1])));
  return out;
}

/* THE RECORDED EXEMPTIONS. An entry here is not a claim that the gate is
   fine; it is a claim that its absence was LOOKED AT and why it is still
   absent. Two rules below keep it from becoming a place to hide things: an
   entry naming a gate no workflow invokes is dead and fails, and an entry
   naming a gate that has since gained a case is stale and fails. The list
   can therefore only shrink without someone editing this file on purpose. */
const NO_CASE_RECORDED = [
  { gate: 'scripts/test/selftest.node.js',
    why: 'PERMANENT. This is the suite itself. A case for it would be this file spawning this file; what grades it is that every other case in it is a proven red/green pair.' },
  { gate: 'scripts/pack.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. The check-store-packages cases synthesise their zips with the local zipOf() helper rather than running pack.mjs, so pack\'s allowlist and its determinism are asserted by nothing in this file — CI compares two pack runs, which catches non-determinism but not a wrong allowlist.' },
  { gate: 'scripts/verify-refs.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. Both workflow calls are `--zip <file> --strict|--leaks`, so a case needs a built package as its subject, not the --repo-root tree every case here mutates. The zip fixture exists (zipOf) and wiring it to this gate is the next step.' },
  { gate: 'scripts/run-tests.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. It runs exactly the commands in a tool.json "tests" block, so a case must let the fixture spawn a real child command and prove both limbs: a failing command fails the gate, and an EMPTY tests block does not pass silently.' },
  { gate: 'scripts/secret-scan.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. A case has to plant a credential-shaped literal, and this file is inside the tree CI scans with `secret-scan.mjs .` — so the literal must be assembled at run time rather than written as source, or the suite becomes the finding. Deliberately not bodged in without that being got right.' },
  { gate: 'scripts/sha256.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. The plainest of the nine: one file in, one hash out, used by the determinism comparison in ci.yml. Nothing here proves it reports a missing file rather than printing an empty hash.' },
  { gate: 'scripts/changelog-section.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. Called only from release.yml, to cut one version section out of a CHANGELOG for the release body. Uncovered means a release note that silently comes out empty is caught by nobody.' },
  { gate: 'Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js',
    why: 'OPEN GAP, recorded 2026-08-25. It lives in a tool\'s publish/, not in scripts/, and the run() helper here resolves against SCRIPTS and appends --repo-root, which this gate does not take — it takes --zip. It needs its own runner before it can have a case.' }
];

/* The evaluation, as a pure function, so it can be pointed at synthetic sets
   and shown to bite before it is pointed at the real ones. */
function unexplainedGaps(invoked, covered, recorded) {
  const excused = new Set(recorded.map(e => e.gate));
  return [...invoked].filter(g => !covered.has(g) && !excused.has(g)).sort();
}

/* ---- the evaluator must itself be shown to go red ---- */
{
  const uncovered = 'scripts/' + 'nobody-tests-me.mjs';
  const proven = 'scripts/' + 'has-a-case.mjs';
  const red = unexplainedGaps([proven, uncovered], new Set([proven]), []);
  const green = unexplainedGaps([proven, uncovered], new Set([proven]), [{ gate: uncovered, why: 'recorded' }]);
  if (red.length === 1 && red[0] === uncovered && green.length === 0) {
    ok('the coverage evaluator reports an uncovered gate, and only an unrecorded one');
  } else {
    bad('the coverage evaluator reports an uncovered gate, and only an unrecorded one',
      'on a synthetic pair it returned ' + JSON.stringify(red) + ' unrecorded and ' +
      JSON.stringify(green) + ' recorded; it cannot fail over the input class it exists for');
  }
}

/* ---- a gate named in a COMMENT is not a gate anybody invokes ---- */
/* The two names are assembled from halves so that no full path to a file that
   does not exist ever appears as one token in this repository — a whole-path
   grep somewhere else must not start reporting a missing script because of a
   fixture string. */
{
  const inRun = 'scripts/' + 'ghost-invoked.mjs';
  const inComment = 'scripts/' + 'ghost-mentioned.mjs';
  const synthetic = [
    '# a workflow header that discusses ' + inComment + ' at length',
    'jobs:',
    '  demo:',
    '    steps:',
    '      - name: real',
    '        run: |',
    '          # and a shell comment inside a run body, naming ' + inComment,
    '          node ' + inRun + ' --all  # ' + inComment,
    ''
  ].join('\n');
  const seen = new Set(gateHits(stripAll(synthetic)));
  if (seen.has(inRun) && !seen.has(inComment)) {
    ok('a gate named only in a comment is not counted as invoked', 'YAML header, shell comment and trailing comment all stripped');
  } else {
    bad('a gate named only in a comment is not counted as invoked',
      'the comment stripper let through ' + JSON.stringify([...seen]) +
      '; prose would enter the invoked set and this whole case would grade the wrong thing');
  }
}

/* ---- the real sets ---- */
const INVOKED = gatesInvokedByWorkflows();
const COVERED = gatesWithACaseInThisFile();

if (INVOKED === null) {
  bad('the set of gates the workflows invoke can be read',
    'COVERAGE LOST — no workflow directory could be read: neither this tree\'s (' +
      path.join(REPO, '.github', 'workflows') + ') nor the repository above it.\n' +
    'An unreadable workflow directory produces an empty invoked set, and an empty invoked set has no gaps in it. ' +
    'That is not a clean bill of health, so it is a failure here rather than a silent pass.');
} else if (INVOKED.size === 0) {
  bad('the set of gates the workflows invoke is not empty',
    'COVERAGE LOST — the workflow files parsed but named no gate at all.\n' +
    'Either every gate call was removed, or the pattern in this section no longer matches the way they are written. ' +
    'Both mean this case is grading nothing, and grading nothing must never be green.');
} else if (COVERED.size === 0) {
  bad('the set of gates with a case in this file is not empty',
    'COVERAGE LOST — this file read its own source and found no case naming a gate, ' +
    'which cannot be true while the cases above are running. The matcher has drifted from the way a case is written, ' +
    'and every gate would be reported as uncovered — or, with the check inverted, none would.');
} else {
  ok('both sets are derived, neither is listed',
    INVOKED.size + ' gate(s) invoked by .github/workflows · ' + COVERED.size + ' gate(s) with a case here');

  const gaps = unexplainedGaps(INVOKED.keys(), COVERED, NO_CASE_RECORDED);
  if (gaps.length === 0) {
    const excused = NO_CASE_RECORDED.length;
    COVERAGE_NOTE = '\n' + excused + ' of ' + INVOKED.size + ' workflow-invoked gate(s) have NO case here. ' +
      'Every one is recorded in NO_CASE_RECORDED with the reason; none is a silent gap.';
    ok('every gate the workflows invoke has a case here or a recorded reason',
      (INVOKED.size - excused) + ' proven · ' + excused + ' recorded as having no case');
  } else {
    bad('every gate the workflows invoke has a case here or a recorded reason',
      gaps.length + ' gate(s) are called by a workflow, have no case in this file, and no recorded reason:\n' +
      gaps.map(g => '  · ' + g + '   (called by ' + [...INVOKED.get(g)].sort().join(', ') + ')').join('\n') +
      '\nAdd a red/green pair for each, or add an entry to NO_CASE_RECORDED saying what is missing and why. ' +
      'Do not add the entry to make this green if you can write the pair.');
  }

  /* Both directions of rot in the recorded list. */
  const dead = NO_CASE_RECORDED.filter(e => !INVOKED.has(e.gate)).map(e => e.gate).sort();
  if (dead.length === 0) ok('every recorded reason still names a gate a workflow invokes');
  else bad('every recorded reason still names a gate a workflow invokes',
    'these entries excuse a gate no workflow calls any more, so they excuse nothing and hide the next real gap:\n' +
    dead.map(g => '  · ' + g).join('\n'));

  const stale = NO_CASE_RECORDED.filter(e => COVERED.has(e.gate)).map(e => e.gate).sort();
  if (stale.length === 0) ok('no recorded reason survives the case that closed it');
  else bad('no recorded reason survives the case that closed it',
    'these gates now HAVE a case in this file, so the entry recording their absence is false:\n' +
    stale.map(g => '  · ' + g).join('\n') +
    '\nDelete the entry. The list is a ratchet; leaving a closed gap in it is how the count stops meaning anything.');
}

/* ---------------- summary ---------------- */
console.log('');
if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
else console.log('fixtures kept at ' + TMP);

if (FAILURES.length) {
  console.log(FAILURES.length + ' of ' + (PASS + FAILURES.length) + ' checks FAILED');
  for (const f of FAILURES) console.log('  - ' + f.label);
  process.exit(1);
}
console.log('ALL PASS — ' + PASS + ' checks, every gate THAT HAS A CASE proven to bite on a real mutation' + COVERAGE_NOTE);
process.exit(0);
