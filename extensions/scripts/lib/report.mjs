/* Shared reporting for scripts/*.mjs — the shape every gate prints.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   Not in the spec's `scripts/lib/` list (§1.2 names zip.mjs, mergepatch.mjs,
   toolinfo.mjs). It exists because eight gates that each invent their own
   pass/fail printing drift into eight different answers to "did it fail?", and
   the one thing every gate in this repo must agree on is that.

   THREE EXIT CODES, AND THE MIDDLE ONE IS THE POINT

     0  the gate ran and everything it checked passed
     1  the gate ran and something it checked FAILED
     2  the gate COULD NOT RUN — bad usage, missing file, unparseable input

   A script that cannot run must never exit 0. "Silence is not success" is the
   most expensive lesson in this family's history: a scanner that quietly stopped
   scanning still prints clean and CI still goes green, and nothing surfaces
   until the thing it guarded is already broken. So `die()` exits 2 and says what
   it could not do, rather than reporting an empty, cheerful pass.

   FOUR VERDICTS, AND ONLY ONE OF THEM IS FATAL BY DEFAULT

     PASS   checked, correct
     FAIL   checked, wrong — exit 1
     WARN   checked, suspicious — printed, not fatal (unless --warnings-as-errors)
     OWNER  a gap only the owner can close (a domain to buy, a store account, a
            decision) — printed on EVERY run, never fatal by default

   The OWNER verdict is deliberate and is copied from this corpus's own rule:
   when a capability's on-switch is owner-gated, the guard must print the gap on
   every run rather than fail the build, because otherwise it blocks all CI on
   work only one person is able to do — and a build that is permanently red
   teaches everyone that red is negotiable.

   `why` is REQUIRED on fail(). A gate that prints "FAIL  permissions" and stops
   has told you a fact you cannot act on. Every failure here carries the file,
   the value found, the value expected, and the fix. */

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CANNOT_RUN = 2;

/* Written to stdout, never stderr, so a CI log reads top to bottom in order.
   Errors that abort go to stderr because a caller may be piping stdout. */
export class Report {
  constructor(title) {
    this.title = title;
    this.passes = 0;
    this.fails = [];
    this.warns = [];
    this.owners = [];
    if (title) console.log(title);
  }

  pass(label, extra) {
    this.passes++;
    console.log('  PASS  ' + label + (extra ? '  — ' + extra : ''));
    return true;
  }

  /* `why` must say what was found, what was expected, and where. */
  fail(label, why) {
    if (!why) throw new Error('report.fail() without a reason: "' + label + '"');
    this.fails.push({ label, why });
    console.log('  FAIL  ' + label);
    for (const line of String(why).split('\n')) console.log('        ' + line);
    return false;
  }

  warn(label, why) {
    this.warns.push({ label, why });
    console.log('  WARN  ' + label);
    if (why) for (const line of String(why).split('\n')) console.log('        ' + line);
    return true;
  }

  /* A gap only the owner can close. Printed always; fatal only on demand. */
  owner(label, action) {
    this.owners.push({ label, action });
    console.log('  OWNER ' + label);
    if (action) for (const line of String(action).split('\n')) console.log('        ' + line);
    return true;
  }

  note(text) { console.log('        ' + text); }
  blank() { console.log(''); }

  /* Grade a boolean in one call, so the pass and the fail can never describe
     different things. */
  check(label, ok, passExtra, failWhy) {
    return ok ? this.pass(label, passExtra) : this.fail(label, failWhy || passExtra || 'no reason given');
  }

  /* Returns the exit code. Callers do process.exit() themselves so this module
     is importable by the self-test without killing the process. */
  finish({ warningsAsErrors = false, ownerActionsFatal = false } = {}) {
    console.log('');
    const bits = [this.passes + ' passed'];
    if (this.fails.length) bits.push(this.fails.length + ' FAILED');
    if (this.warns.length) bits.push(this.warns.length + ' warning(s)');
    if (this.owners.length) bits.push(this.owners.length + ' owner action(s)');
    console.log(bits.join(' · '));

    if (this.owners.length) {
      console.log('\nOWNER ACTIONS — nobody else can do these:');
      this.owners.forEach((o, i) => console.log('  ' + (i + 1) + '. ' + o.label +
        (o.action ? '\n     ' + String(o.action).split('\n').join('\n     ') : '')));
    }

    let code = EXIT_OK;
    if (this.fails.length) code = EXIT_FAIL;
    if (warningsAsErrors && this.warns.length) code = EXIT_FAIL;
    if (ownerActionsFatal && this.owners.length) code = EXIT_FAIL;
    return code;
  }
}

/* The gate could not run. Never exit 0 from here. */
export function die(message, code = EXIT_CANNOT_RUN) {
  console.error('CANNOT RUN — ' + message);
  process.exit(code);
}

/* Tiny argv reader. No dependency, and deliberately dumb: `--flag`, `--key val`,
   `--key=val`, and positionals. Unknown flags are returned, not swallowed, so a
   caller can reject a typo instead of silently ignoring it. */
export function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { flags.set(a.slice(2, eq), a.slice(eq + 1)); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags.set(a.slice(2), next); i++; }
    else flags.set(a.slice(2), true);
  }
  return {
    positional,
    flags,
    has: k => flags.has(k),
    get: (k, dflt) => (flags.has(k) ? flags.get(k) : dflt),
    bool: k => flags.get(k) === true || flags.get(k) === 'true',
    /* Reject anything not in the known set — a typo'd `--strickt` must not read
       as "strict mode off". */
    rejectUnknown(known) {
      const bad = [...flags.keys()].filter(k => !known.includes(k));
      if (bad.length) die('unknown option(s): ' + bad.map(b => '--' + b).join(', ') +
        '\nknown options: ' + known.map(k => '--' + k).join(', '));
    }
  };
}
