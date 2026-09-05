/* secret-scan.mjs — credential shapes, over everything that can be committed.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/secret-scan.mjs .                    the whole tree (what CI runs)
     node scripts/secret-scan.mjs Extension            one subtree
     node scripts/secret-scan.mjs . --repo-root <dir>  aim it at a fixture tree

   The `secrets-scan` job in .github/workflows/ci.yml is one step —
   `node scripts/secret-scan.mjs .` — and it reads nothing but the exit code. So
   the exit code IS the contract: 0 nothing matched · 1 something matched, or the
   scan could not cover its subject · 2 could not run. Nothing else is consumed:
   no $GITHUB_OUTPUT, no artifact, no file written anywhere.

   That job is cited here by NAME and not by `ci.yml:NNN`, deliberately. A line
   number is a pointer into a file other people edit, and it is correct only
   until somebody inserts a job above it — which nothing recomputes, and which
   this repository has already paid for. A job name survives the insert.

   .githooks/pre-commit is the same check one step earlier, on the staged diff,
   and its patterns are the ones below. Both exist because they fail differently:
   the hook is bypassed by `--no-verify` and skipped entirely when the mode bit
   is wrong, and this one cannot be bypassed by anybody pushing a branch. Neither
   is a permit. A credential that reaches either of them is already on disk.

   WHAT IS IN SCOPE, AND WHY GIT DECIDES IT AND NOT A PATTERN LIST HERE

   The subject is "content that can be committed": every file git tracks, plus
   every untracked file no ignore rule covers. That is a definition, not a
   heuristic, and it is the reason this gate can be strict about `.claude/` and
   `private/` without being red on every run — those are gitignored, they cannot
   reach the public remote through a commit, and a gate that fails a correct tree
   gets switched off, after which it guards nothing.

   The list is git's, deliberately, rather than a copy of .gitignore maintained
   here. A second copy of an ignore list is a second thing to forget.

   AND WHEN GIT CANNOT ANSWER, THE SET WIDENS — IT NEVER NARROWS

   A filter that cannot run must not be allowed to remove files from the subject.
   With no git on PATH, or a scan root that is not a work tree (the fixture
   case), this scans everything the filesystem walk found, minus the fixed
   directory list below, and says so on stdout. Failing safe here means MORE is
   scanned, never less; the opposite arrangement is the exact shape this corpus
   is written against — a check that stopped checking and kept printing green.

   TWO DERIVATIONS OF THE SUBJECT SET, COMPARED, BECAUSE ONE CANNOT BE CHECKED

   Every verdict below is a sentence about `subject`, so the dangerous state is
   not "a pattern is wrong", it is "the patterns are right, about a smaller set
   than the one that exists". That prints as a clean PASS with a smaller number
   in it that nobody diffs. So the set is derived twice:

     A  a filesystem walk of the scan root, minus SKIP_DIRS below. lib/toolinfo's
        walk() exits 2 on any errno but ENOENT, so a subtree that cannot be READ
        can never arrive here spelled `[]`.
     B  git's own answer: tracked ∪ untracked-not-ignored.

   B is what gets scanned. Then every file in B that exists on disk must appear
   in A — a file git will happily commit that the walk never enumerated means the
   walk lost a subtree, and that is a FAIL, not a smaller number. The reverse
   difference (A minus B) is the ignored content, and it is printed as a count so
   "out of scope" is a number a reader can see rather than an assumption.

   THE SCANNER PROVES IT STILL BITES, ON EVERY RUN, BEFORE IT READS THE TREE

   Each rule carries the sample it must match and the whole benign corpus it must
   not. An assertion that cannot fail is worse than none, and a regex edited into
   something that matches nothing is indistinguishable — from the outside — from
   a clean repository. The samples are assembled from fragments at run time so
   that no literal credential prefix appears in this file's own bytes, and the
   patterns are written `github[_]pat_` rather than spelled out for the same
   reason: a scanner whose own source trips its own gate gets exempted from
   itself, and that exemption is a hole straight through the middle of it.
   `'this gate is committable'` below is the assertion that keeps it true.

   AND A SECOND CLASS: INDIAN IDENTITY NUMBERS, WHOSE SAMPLES ARE THE HARD PART

   Everything above this line is a CREDENTIAL rule, and a credential scanner has
   no opinion about a national identity number. That gap is not hypothetical:
   Nikatru_Platform_Public found the proprietor's real PAN committed to a public
   repository in the PII scrubber's own test fixture, past a green gate and past
   a .gitignore whose exclusions were PATH-based while the leak was a string
   literal in ordinary source. [ADR 034] settles WHERE the control belongs — the
   PRIVATE corpus may carry these in clear, the PUBLIC repos may not — and
   Platform_Public carries it in .gitleaks.toml. This repository has no
   .gitleaks.toml; this file is its whole content gate, so the control lands here
   or it lands nowhere. Measured on 2026-08-25: `git grep` for those literals at
   HEAD found nothing here. This closes a FUTURE hole, it does not clean a leak.

   THE TRAP, WHICH IS THE WHOLE DIFFICULTY. Every rule in this file proves it
   still bites by matching a `sample` that lives in this file's own bytes. A
   sample for an identity rule that were a REAL number would put real PII into a
   public repository — precisely what the rule exists to prevent. So each sample
   below is chosen to be OUTSIDE THE ISSUABLE VALUE SPACE by construction, on a
   published numbering rule, and each rule states which rule and why. "It looks
   obviously fake" is NOT one of those arguments and is measurably worthless: of
   the ten twelve-digit repdigits, the all-9s, the all-3s and the all-6s each
   carry a VALID Verhoeff check digit, so each is a number UIDAI could have
   issued — a value can look like a placeholder and still be somebody's.

   ⚠️ AND THAT SENTENCE NAMES THEM RATHER THAN SPELLING THEM, deliberately.
   Writing those digits out here made this file a finding in its own scan, and
   the gate below caught it on the first run — the identical trap
   Nikatru_Platform_Public's .gitleaks.toml records for its own PAN comment. A
   rule's documentation is inside that rule's blast radius. Nothing in this file
   may contain a matchable identity number: the samples exist only as fragments
   joined at run time, and the prose describes values instead of quoting them.

   AND THE REMEDY IS NOT THE CREDENTIAL REMEDY. A leaked token is rotated. A PAN
   cannot be rotated, a GSTIN cannot be rotated and an Aadhaar cannot be rotated —
   the person is stuck with the number. That is why these hits get their own
   verdict below instead of being folded into the credential one under advice
   ("ROTATE IT FIRST") that is impossible to follow.

   READ AS BYTES, NOT AS TEXT

   Every file is read as a buffer and decoded latin1, so one byte is one
   character: a token inside a .png, a .zip entry name or any file carrying a
   stray NUL is visible, and a match index still maps to a byte offset. This is
   `git diff --text` in the hook, for the same reason it is there.

   UTF-16 gets a second pass, and that is not theoretical on this repo's own
   platform: PowerShell 5.1 writes UTF-16LE from a bare `Out-File`, and a token
   written that way is `t\0o\0k\0e\0n\0` — invisible to every pattern here. A
   BOM-marked file is therefore scanned again with its NUL bytes removed.

   WHAT THIS GATE DOES NOT SEE, NAMED RATHER THAN IMPLIED

     - anything COMPRESSED. templates/tool/publish/skeleton-0.0.1.zip is tracked,
       and a token deflated inside it matches nothing here. The zip side is
       verify-refs.mjs --leaks, which is the architecture's own name for it.
     - the hook's third gate, owner-private planning documents by filename. That
       is a different class of leak — sensitivity in a document's SUBJECT rather
       than its vocabulary — and it belongs with the staged-path check, where the
       carve-out list already lives. Duplicating it here would put the carve-outs
       in two places.
     - history. Everything below reads the working tree. A credential already in
       a commit is a rotation, not a scan. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, walk } from './lib/toolinfo.mjs';

/* `--allow-empty` is a BOOLEAN and parseArgs is deliberately dumb: it takes the
   next token as a flag's value (report.mjs:137-139), so `secret-scan.mjs
   --allow-empty .` would hand "." to --allow-empty and leave the positional
   empty. Pinning the booleans to `--key=value` before parseArgs sees them keeps
   a positional a positional. Only --repo-root takes a value here. */
const BOOLEAN_FLAGS = ['allow-empty', 'warnings-as-errors', 'owner-actions-fatal'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown([...BOOLEAN_FLAGS, 'repo-root']);
const root = repoRoot(args);

if (args.positional.length > 1) {
  die('more than one path given: ' + args.positional.map(t => '"' + t + '"').join(', ') +
    '\nThis gate takes exactly ONE — a directory to scan, or nothing at all for the whole repo.\n' +
    'It will not pick one of them for you.');
}
const scanRoot = path.resolve(root, args.positional[0] || '.');

/* A path that is not a directory is a usage error and exits 2, not a scan of
   nothing that exits 0. Checked here rather than left to the walk so the message
   names the argument the caller typed instead of an errno. */
let rootStat;
try { rootStat = fs.statSync(scanRoot); }
catch (e) { die('cannot scan ' + scanRoot + ': ' + e.code + ' — ' + e.message); }
if (!rootStat.isDirectory()) {
  die(scanRoot + ' is not a directory.\n' +
    'This gate scans a tree. Give it a directory — "." for the whole repository.');
}

const relFromRoot = path.relative(root, scanRoot).split(path.sep).join('/');
const label = relFromRoot === '' ? '.' : (relFromRoot.startsWith('..') ? scanRoot : relFromRoot);
const r = new Report('secret-scan · ' + label);

/* Never descended, in either derivation. Build outputs and .git are not content
   anyone commits, and .git in particular is most of the bytes on disk. A TRACKED
   file underneath one of these names is not silently forgiven: it lands in B and
   not in A, and the cross-check below fails naming it. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'web-ext-artifacts']);

/* A file this big is a build artefact or a media blob, not a place a credential
   is typed. Anything over it is REPORTED by name rather than dropped quietly —
   a skipped file that nobody hears about is the whole failure mode. */
const MAX_BYTES = 16 * 1024 * 1024;

/* ---------------- the rules ---------------- */
/* Kept at parity with CONTENT_RE and PATHS_RE in .githooks/pre-commit. `sample`
   is what the rule must match on every run; if it stops, the rule is dead and
   this gate says so before it reads a single file of the tree.

   Every `sample` is assembled from fragments, and every pattern places a
   character class where the literal would otherwise be complete, so that none of
   them matches this file. */
const CONTENT_RULES = [
  { name: 'GitHub token (classic)', re: /ghp_[A-Za-z0-9]{30,}/,
    sample: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7' },
  { name: 'GitHub token (OAuth)', re: /gho_[A-Za-z0-9]{30,}/,
    sample: 'gho_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7' },
  { name: 'GitHub token (fine-grained)', re: /github[_]pat_/,
    sample: 'github' + '_pat_' + '11ABCDEFGHIJKLMNOPQRSTUV' },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/,
    sample: 'xox' + 'b-1234567890-0987654321-AbCdEfGhIjKl' },
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    sample: '-----BEGIN RSA PRIVATE KEY' + '-----' },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/,
    sample: 'AKIA' + 'IOSFODNN7EXAMPLE' },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/,
    sample: 'AIza' + 'SyB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R' },
  /* Requiring the SECOND dotted segment is what keeps this off ordinary base64,
     of which an extension that touches images has a great deal. */
  { name: 'JSON web token', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./,
    sample: 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc' },
  /* The store upload flow's OAuth refresh token — an extension factory meets
     these long before it meets anything of Amazon's. */
  { name: 'OAuth refresh token', re: /1\/\/[0-9A-Za-z_-]{30,}/,
    sample: '1//' + '04aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' }
];

/* Indian identity numbers — a DIFFERENT CLASS, kept in its own array on purpose.
   CONTENT_RULES above is the parity claim against CONTENT_RE in
   .githooks/pre-commit, and that hook has no identity patterns. Folding these in
   there would make a true parity statement quietly false; leaving the arrays
   apart keeps it checkable. THE HOOK IS THEREFORE ONE CLASS BEHIND THIS FILE —
   stated rather than implied, because the hook is not this change's file to edit.

   Every `sample` here is fragmented and every one is outside the issuable value
   space; the per-rule comments carry the argument, which is the point of them. */
const IDENTITY_RULES = [
  /* PAN — 5 letters, 4 digits, 1 letter. Same shape Platform_Public's
     `nikatru-india-pan` uses, deliberately: two public repos disagreeing about
     what a PAN looks like is a gap shaped like a policy.

     SAMPLE SAFETY. The 4th character of a PAN encodes the holder's status and
     comes from a FIXED published set — A, B, C, E, F, G, H, J, K, L, P, T
     (individual, company, firm, HUF, trust, government, …). `Z` is in no
     published set, so a value carrying it is shape-valid for this loose regex
     and CANNOT HAVE BEEN ISSUED to anybody. That is the whole argument, and it
     is why the regex is deliberately NOT narrowed to `[A-Z]{3}[ABCEFGHJKLPT]…`:
     narrowing it would force this sample to become an issuable PAN in order to
     keep matching, which is the self-reference trap this class is full of. The
     looseness is paid for by measurement, not by hope — see below.

     FALSE POSITIVES, MEASURED not reasoned about: this shape can in principle
     match a build hash or a base32 fragment, and Platform_Public carries an
     allowlist for exactly that. Run across all 540 committable files in this
     repository on 2026-08-25 it matched ZERO of them, so it ships with no
     allowlist — an allowlist entry with no user is a permanent hole in the net
     that nothing is using, and this file already argues that case for `_PAT`. */
  { name: 'Indian PAN', re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/,
    sample: 'AAA' + 'ZA' + '1111' + 'A' },

  /* GSTIN — 2-digit state code, then the holder's PAN at characters 3-12, then
     entity number, then a fixed letter, then a checksum character. IT NEEDS ITS
     OWN RULE even though it contains a PAN: the PAN rule is `\b`-anchored, and
     inside a GSTIN the PAN is bounded by digits on the left, so no word boundary
     exists and the PAN rule cannot see it. Verified, not assumed.

     SAMPLE SAFETY — TWO INDEPENDENT REASONS, because one leaked PAN is one too
     many and a GSTIN sample IS a PAN sample:
       1. it embeds the same impossible-4th-character PAN as the rule above, so
          no real person's PAN is written down here either;
       2. its state code is `00`. GST state codes are the census codes 01-38,
          plus 97 (Other Territory) and 99 (Centre Jurisdiction). 00 is assigned
          to nothing, so this value cannot be issued on that ground alone.
     Measured across the same 540 files: ZERO matches, no allowlist. */
  { name: 'Indian GSTIN', re: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}\b/,
    sample: '00' + 'AAA' + 'ZA' + '1111' + 'A' + '1Z5' },

  /* Aadhaar — 12 digits, optionally grouped 4-4-4.
     The leading `[2-9]` is the UIDAI numbering rule, not a shortcut: no issued
     Aadhaar begins 0 or 1. Carried across from Platform_Public's
     `nikatru-india-aadhaar`, where it is what lets that rule need no allowlist.

     BUT IT CANNOT DO THE SAMPLE'S WORK HERE, and that difference matters. Over
     there the fixtures begin with 1, so the rule is unable to match them — a
     stronger guarantee than being excused by an allowlist. Here the sample must
     MATCH or the rule is dead, so it has to begin 2-9 and the safety has to come
     from somewhere else: the 12th digit is a VERHOEFF check digit, and the
     all-2s repdigit — the sample below, which exists in this file only as three
     fragments joined at run time — has Verhoeff residue 9 rather than 0. It
     fails the check UIDAI applies, so it is not an issuable Aadhaar. (The
     Verhoeff implementation used to establish that was validated first against
     the published vectors 2363 and 758722, with 2364 as a one-digit-off control
     that correctly failed. Repdigits are NOT self-evidently safe: three of the
     ten pass Verhoeff — see the header, which names them without spelling them.)

     THE BOUNDARY GUARDS ARE THE ENTIRE DIFFERENCE BETWEEN A RULE AND A DELETED
     RULE, and they were measured on this tree rather than imagined. The
     `\b`-only form matched 51 times across 23 tracked files here — every one of
     them a payment-card or order-id fixture in Full_Screen_Shot's redaction
     tests, because the middle three groups of `4242 4242 4242 4242` ARE the
     4-4-4 Aadhaar shape. Platform_Public's own guarded form still matched all
     51: it excludes a leading `+` or hyphen (phone numbers) but not a preceding
     GROUP. So two guards are added on top of it —
       (?<![0-9][ -])  not a continuation of an earlier 4-digit group
       (?![ -]?[0-9])  not continued by a later one
     — which is to say: match 12 digits, never 12 digits carved out of 16. With
     both, the same sweep matches 0 of 540. A rule that reddens every branch is a
     rule somebody deletes.

     KNOWN, ACCEPTED FALSE NEGATIVE, stated rather than discovered later: a real
     Aadhaar written immediately after some other digit run and a single space
     ("560001 2345 6789 0123") is skipped by the leading guard. That is the price
     of not firing on every card fixture in the repository, and it is the right
     side to fail on for a gate that blocks commits.

     Lookaround is used rather than Platform_Public's captured-boundary trick
     because Go's RE2 has none and JavaScript does; it also keeps the reported
     match length equal to the length of the number itself, which the verdict
     below prints instead of the value. */
  { name: 'Indian Aadhaar', re: /(?<![0-9A-Za-z+-])(?<![0-9][ -])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9A-Za-z-])(?![ -]?[0-9])/,
    sample: '2222' + ' 2222' + ' 2222' }
];

/* One list for the machinery, two for the reader and for the verdicts. `kind`
   is what lets a PAN hit avoid being printed under advice to rotate it. */
const ALL_CONTENT_RULES = [
  ...CONTENT_RULES.map(rule => ({ ...rule, kind: 'credential' })),
  ...IDENTITY_RULES.map(rule => ({ ...rule, kind: 'identity' }))
];

/* WHAT THIS CLASS STILL DOES NOT SEE, named rather than implied: these are
   CONTENT rules only. A PAN spelled in a FILENAME is not caught by them, and
   PATH_RULES below is a credential-file list, not a PII one. Same position
   Platform_Public's .gitleaks.toml is in — gitleaks scans content too — so this
   is a shared gap and not a local oversight. */

/* Paths that are credential files by name, whatever they happen to contain. An
   empty `.pem` is still a signing key that was in this directory. */
const PATH_RULES = [
  { name: 'a dotenv or secrets file', re: /secrets\.env|(^|\/)\.env($|\.)|secrets\.json/i,
    sample: 'Extension/My_Tool/.claude/secrets.env' },
  { name: 'a store upload token', re: /upload-token/i, sample: 'publish/upload-token.json' },
  { name: 'a key or certificate', re: /\.pem$|\.p12$|\.key$|\.crx$|id_rsa/i, sample: 'keys/webstore.pem' },
  /* `_PAT` alone matches `_path`, `_patch` and `_pattern` case-insensitively,
     and in a JavaScript extension factory those are ordinary filenames. The
     trailing class is what keeps this gate off `core/lib/url_path.js`. */
  { name: 'a personal access token file', re: /_PAT($|[^A-Za-z])/i, sample: 'GITHUB_PAT.txt' },
  { name: 'the local secrets vault', re: /(^|\/)\.claude\//i, sample: '.claude/settings.json' }
];

/* Must match NOTHING. The first four are the shapes that produced false
   positives in this family; the fifth is this file, which is scanned by the tree
   sweep when it runs at the repo root and by nothing at all when it is pointed
   at a fixture — so the assertion has to be made here too. */
const BENIGN = [
  { name: 'ordinary source', text: 'const NET = /fetch|XMLHttpRequest|WebSocket/;' },
  { name: 'prose about tokens', text: 'The hook refuses classic and fine-grained PATs.' },
  { name: 'ordinary base64', text: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
  { name: 'a bare // comment', text: 'return 1 // 0 is not a token' },
  /* The next five pin the Aadhaar boundary guards down, and they are here
     because they were MEASURED, not anticipated: the unguarded 4-4-4 shape
     matched 51 times across 23 tracked files in this repository, and every one
     of those matches was one of these shapes. They are the redaction tests'
     own fixtures — Full_Screen_Shot has to render a card number in order to
     prove it redacts one — so they are not going away and must not redden the
     tree. A future widening of that rule now trips over these instead of over
     twenty-three test files and a contributor's afternoon. */
  { name: 'a grouped card number', text: 'Card 4242 4242 4242 4242' },
  { name: 'a hyphen-grouped card number', text: 'card=4242-4242-4242-4242;' },
  { name: 'a 16-digit order id', text: 'Order 1234 5678 9012 3456' },
  { name: 'a bare 16-digit run', text: 'ref 2345678901234567 ok' },
  /* A UUID's leading groups are eight digits, a hyphen and four more, which is
     the 4-4-4 shape again; digits-only here so the assertion is not accidentally
     satisfied by a stray letter. And an E.164 number is twelve digits behind a
     `+`, which is what the `+` in the leading guard's class is for. */
  { name: 'a digit-only UUID', text: '24680135-2468-4013-8246-801324680135' },
  { name: 'an E.164 phone number', text: 'tel:+919876543210' },
  { name: 'this gate is committable', text: fs.readFileSync(fileURLToPath(import.meta.url), 'latin1') }
];

/* ---------------- gate A: the scanner still bites ---------------- */
{
  const dead = [];
  const noisy = [];
  for (const rule of ALL_CONTENT_RULES) {
    if (!rule.re.test(rule.sample)) {
      dead.push('  ' + rule.name + '  ' + String(rule.re) + '  no longer matches its own sample');
    }
    for (const b of BENIGN) {
      if (rule.re.test(b.text)) noisy.push('  ' + rule.name + '  ' + String(rule.re) + '  matches "' + b.name + '"');
    }
  }
  for (const rule of PATH_RULES) {
    if (!rule.re.test(rule.sample)) {
      dead.push('  ' + rule.name + '  ' + String(rule.re) + '  no longer matches its own sample "' + rule.sample + '"');
    }
  }
  /* The three filenames that pinned `_PAT` down when the hook was widened. They
     are the only benign PATHS, and they are checked against every path rule so a
     future widening trips over them rather than over a contributor. */
  for (const p of ['core/lib/url_path.js', 'scripts/lib/zip_patch.mjs', 'test/net_patterns.js',
    'Extension/My_Tool/manifest.json', 'Extension/My_Tool/_locales/en/messages.json']) {
    for (const rule of PATH_RULES) {
      if (rule.re.test(p)) noisy.push('  ' + rule.name + '  ' + String(rule.re) + '  matches the ordinary path "' + p + '"');
    }
  }

  if (dead.length || noisy.length) {
    r.fail('the scanner still bites',
      [...dead, ...noisy].join('\n') +
      '\nEvery verdict this gate prints is a claim made by these patterns. A pattern that no longer\n' +
      'matches its own sample reports a clean tree for the same reason an empty tree does, and there\n' +
      'is nothing in the output that tells the two apart. Fix the pattern or fix the sample — do not\n' +
      'delete the assertion.');
    process.exit(EXIT_FAIL);
  }
  r.pass('the scanner still bites',
    CONTENT_RULES.length + ' credential + ' + IDENTITY_RULES.length + ' identity + ' + PATH_RULES.length +
    ' path rule(s) matched their own samples; ' + BENIGN.length + ' benign sample(s) matched none');
}

/* ---------------- derivation A: the filesystem ---------------- */
/* walk() exits 2 naming the path and the errno on any read failure that is not
   ENOENT, which is what makes an unreadable subtree impossible to confuse with
   an empty one. Nothing here has to re-implement that promise. */
const onDisk = walk(scanRoot, {
  skip: rel => SKIP_DIRS.has(rel.slice(rel.lastIndexOf('/') + 1))
});
const onDiskSet = new Set(onDisk);

/* ---------------- derivation B: git ---------------- */
/* Three answers, not two, in the same shape the hook reads grep: git ran and
   answered · git is not available here · git ran and FAILED. Reading the third
   as the second is how a filter quietly becomes a no-op, so it exits 2. */
function gitList(argv) {
  const res = spawnSync('git', ['-C', scanRoot, ...argv], { maxBuffer: 512 * 1024 * 1024 });
  if (res.error) {
    if (res.error.code === 'ENOENT') return { unavailable: 'git is not on PATH' };
    die('git could not be started: ' + (res.error.code || '') + ' — ' + res.error.message);
  }
  const err = res.stderr ? res.stderr.toString('utf8') : '';
  if (res.status !== 0) {
    /* Exactly git's own words for "there is no repository here", and nothing
       looser. A broader test — `/does not exist/` was in this line for one
       draft — turns some future genuine failure into the widening branch, and
       widening is the branch that keeps running. The narrow test's failure
       direction is exit 2, which stops. */
    if (/not a git repository/i.test(err)) return { unavailable: 'this is not a git work tree' };
    die('git ' + argv.join(' ') + ' exited ' + res.status + ' in ' + scanRoot + ':\n' + err.trim() +
      '\nThat is git FAILING, not git reporting an empty repository, and the difference decides how\n' +
      'much of this tree gets scanned. Refusing to guess which one it was.');
  }
  return { paths: res.stdout.toString('utf8').split('\0').filter(Boolean) };
}

let subject;          // the paths that get scanned, relative to scanRoot
let subjectSource;    // how they were chosen, printed with the count
let widened = false;
{
  const tracked = gitList(['ls-files', '-z']);
  const untracked = tracked.unavailable ? tracked : gitList(['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked.unavailable || untracked.unavailable) {
    widened = true;
    const why = tracked.unavailable || untracked.unavailable;
    subject = onDisk;
    subjectSource = 'every file on disk';
    r.note('the ignore filter could not run — ' + why + '.');
    r.note('So the subject WIDENS to every file the walk found rather than narrowing: a filter that');
    r.note('cannot run must not be allowed to remove files from the set it was supposed to filter.');
    r.note('Gitignored content — .claude/, private/ — is therefore in scope on this run.');
  } else {
    const both = new Set([...tracked.paths, ...untracked.paths]);

    /* The cross-check. A file git will commit that the independent walk never
       enumerated means the walk lost a subtree, and every count below would be
       a smaller number nobody diffs. A file git names that is NOT on disk is a
       different thing entirely — a working-tree deletion — and it is counted,
       not failed. */
    const lost = [];
    let deleted = 0;
    for (const p of both) {
      if (onDiskSet.has(p)) continue;
      if (fs.existsSync(path.join(scanRoot, p))) lost.push('  ' + p);
      else deleted++;
    }
    if (lost.length) {
      r.fail('every committable file was enumerated by the disk walk',
        lost.slice(0, 20).join('\n') + (lost.length > 20 ? '\n  … and ' + (lost.length - 20) + ' more' : '') +
        '\ngit names ' + lost.length + ' file(s) as content that can be committed, and they exist on disk,\n' +
        'but the filesystem walk never saw them — so one of the two derivations is wrong. The\n' +
        'expensive way to be wrong is the low one: a file that goes unscanned looks exactly like a\n' +
        'file that was scanned and found clean. Most likely cause: a directory name was added to\n' +
        'SKIP_DIRS in this file that a tracked file lives under.');
      process.exit(EXIT_FAIL);
    }

    subject = [...both].filter(p => onDiskSet.has(p)).sort();
    subjectSource = tracked.paths.length + ' tracked + ' + untracked.paths.length + ' untracked-not-ignored';
    r.note(onDisk.length + ' file(s) on disk · ' + subject.length + ' committable and in scope · ' +
      (onDisk.length - subject.length) + ' gitignored and out of scope' +
      (deleted ? ' · ' + deleted + ' tracked but deleted from the working tree' : ''));
  }
}

/* ---------------- gate 0: there is a subject at all ---------------- */
if (subject.length === 0) {
  if (args.bool('allow-empty')) {
    r.warn('0 file(s) scanned', '--allow-empty was given, so an empty set is not a failure here.');
    process.exit(r.finish({ warningsAsErrors: args.bool('warnings-as-errors'), ownerActionsFatal: args.bool('owner-actions-fatal') }));
  }
  r.fail('0 file(s) scanned — REQUIRED COVERAGE not met',
    'Nothing under ' + scanRoot + ' was selected, and a scanner that reads no file prints exactly\n' +
    'the same green as one that read every file and found it clean. Either the path is wrong, or\n' +
    'every file under it is gitignored. If zero really is correct here, pass --allow-empty so the\n' +
    'decision is visible in the workflow file rather than invisible in a glob.');
  process.exit(EXIT_FAIL);
}

/* ---------------- read, then scan ---------------- */
/* A file that cannot be OPENED is a failure that names the path and the errno.
   It is never `catch (_) { continue; }`: an ACL-denied file scores identically
   to a clean one under that, and this whole gate is one claim about a file set. */
const unreadable = [];
const oversize = [];
const pathHits = [];
const contentHits = [];
let bytes = 0;
let scanned = 0;
let utf16 = 0;

for (const rel of subject) {
  for (const rule of PATH_RULES) {
    if (rule.re.test(rel)) pathHits.push({ rel, rule: rule.name });
  }

  const abs = path.join(scanRoot, rel);
  let st;
  try { st = fs.statSync(abs); }
  catch (e) { unreadable.push('  ' + rel + ': ' + (e.code || 'error') + ' — ' + e.message); continue; }
  if (st.size > MAX_BYTES) { oversize.push('  ' + rel + '  (' + st.size + ' bytes)'); continue; }

  let buf;
  try { buf = fs.readFileSync(abs); }
  catch (e) { unreadable.push('  ' + rel + ': ' + (e.code || 'error') + ' — ' + e.message); continue; }
  scanned++;
  bytes += buf.length;

  /* latin1 is the identity decode: one byte in, one character out, so every
     index below is a byte offset and nothing is lost to a replacement char. */
  const views = [{ how: '', text: buf.toString('latin1') }];
  if ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF)) {
    utf16++;
    views.push({ how: ' (UTF-16, NUL bytes removed)', text: views[0].text.replace(/\0/g, '') });
  }

  for (const view of views) {
    for (const rule of ALL_CONTENT_RULES) {
      const re = new RegExp(rule.re.source, 'g');
      let m;
      while ((m = re.exec(view.text)) !== null) {
        /* The MATCH IS NEVER PRINTED — only where it is and what shape it is. A
           secret echoed to a terminal is a secret in scrollback, in a
           screenshot, and in whatever bug report the log gets pasted into. */
        contentHits.push({
          rel, rule: rule.name, kind: rule.kind, how: view.how,
          line: view.text.slice(0, m.index).split('\n').length,
          length: m[0].length
        });
        if (m[0].length === 0) break;
      }
    }
  }
}

if (unreadable.length) {
  r.fail('every file in scope is readable',
    unreadable.join('\n') +
    '\nA file git will commit that this scanner could not open has not been checked, and there is\n' +
    'nothing in a clean report that says so. Fix the permissions or the path and re-run.');
}
if (oversize.length) {
  r.warn(oversize.length + ' file(s) over the ' + MAX_BYTES + '-byte cap were not read',
    oversize.join('\n') +
    '\nNamed rather than dropped in silence. If a credential could plausibly be in one of these,\n' +
    'raise MAX_BYTES in this file — do not leave the gap unstated.');
}

/* ---------------- the verdicts ---------------- */
if (pathHits.length) {
  const by = new Map();
  for (const h of pathHits) { if (!by.has(h.rel)) by.set(h.rel, []); by.get(h.rel).push(h.rule); }
  /* Counted over `by`, not over `pathHits`: one path can trip two rules —
     `.claude/secrets.env` trips both the vault rule and the dotenv rule — and a
     headline of "2 path(s)" above a list of one is a report contradicting
     itself inside a single verdict. Measured on a fixture, not reasoned about. */
  r.fail(by.size + ' path(s) are credential files by name',
    [...by.entries()].map(([rel, rules]) => '  ' + rel + '  — ' + [...new Set(rules)].join(', ')).join('\n') +
    '\nThese are committable: git either tracks them already or no ignore rule covers them. Add the\n' +
    'path to .gitignore, and if it is already committed, ROTATE the credential first — removing it\n' +
    'in a later commit does not remove it from history.');
} else {
  r.pass('no committable path is a credential file by name', subject.length + ' path(s) against ' + PATH_RULES.length + ' rule(s)');
}

/* Split by class before printing. Both verdicts say "the match is not printed"
   for the same reason, but they part company completely on the remedy, and a
   verdict that gives impossible advice is a verdict people learn to skim. */
const list = hits => hits.slice(0, 20)
  .map(h => '  ' + h.rel + ':' + h.line + h.how + '  — ' + h.rule + ' (' + h.length + ' chars, not printed)')
  .join('\n') + (hits.length > 20 ? '\n  … and ' + (hits.length - 20) + ' more' : '');

const credentialHits = contentHits.filter(h => h.kind === 'credential');
const identityHits = contentHits.filter(h => h.kind === 'identity');

if (credentialHits.length) {
  r.fail(credentialHits.length + ' credential-shaped string(s) in committable content',
    list(credentialHits) +
    '\nThe match itself is deliberately not printed: a secret in a CI log is a secret in every fork\n' +
    'of that log. Open the line above to see it.\n' +
    'If it is a real credential, ROTATE IT FIRST. Deleting it from the tree does not delete it from\n' +
    'history, and treating the deletion as the fix is how an exposed credential stays live.\n' +
    'If it is a fixture, assemble it from fragments the way this file assembles its own samples —\n' +
    'that is the same reason .githooks/pre-commit does it, and it costs one plus sign.');
} else {
  r.pass('no credential-shaped string in committable content',
    scanned + ' file(s) · ' + bytes + ' bytes · ' + CONTENT_RULES.length + ' rule(s)' +
    (utf16 ? ' · ' + utf16 + ' scanned twice for UTF-16' : ''));
}

if (identityHits.length) {
  r.fail(identityHits.length + ' Indian identity number(s) in committable content',
    list(identityHits) +
    '\nThe match is not printed, for the same reason a credential is not: this is the exact class of\n' +
    'value the rule exists to keep out of a public repository, and a CI log is public too.\n' +
    'THERE IS NO ROTATION HERE. A PAN, a GSTIN and an Aadhaar all belong to a person or an entity\n' +
    'for life — the credential playbook does not apply and there is no undo. If this reaches a\n' +
    'commit the remedy is history rewriting, not a follow-up commit, so deal with it now.\n' +
    'If it is a REAL number: it belongs in the private corpus, which [ADR 034] says may carry these\n' +
    'in clear. It does not belong here. This repository is public.\n' +
    'If it is a FIXTURE: make it unissuable rather than merely unfamiliar. The rules above each\n' +
    'document how — a PAN whose 4th character is outside the published holder-status set, a GSTIN\n' +
    'on state code 00, an Aadhaar that fails its Verhoeff check digit or simply begins with 0 or 1,\n' +
    'which no issued Aadhaar does. "It looks made up" is not a property anything can check.');
} else {
  r.pass('no Indian identity number in committable content',
    scanned + ' file(s) · ' + IDENTITY_RULES.length + ' rule(s) — PAN, GSTIN, Aadhaar');
}

r.note('subject: ' + subjectSource + (widened ? ' — WIDENED, see above' : ''));

process.exit(r.finish({
  warningsAsErrors: args.bool('warnings-as-errors'),
  ownerActionsFatal: args.bool('owner-actions-fatal')
}));
