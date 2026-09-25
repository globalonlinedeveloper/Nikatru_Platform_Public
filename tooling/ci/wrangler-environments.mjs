// ─────────────────────────────────────────────────────────────────────────────
// wrangler-environments.mjs — the ONE reading of "this wrangler environment is a
// SANDBOX deploy target that cannot touch production".
//
// Not a guard: pure functions over an ALREADY-PARSED config, no filesystem, no
// exit. Extracted 2026-09-25 from assert-money-config.mjs limb 1c (capsand-b,
// parent ruling CAPSAND-5 item 1), its five messages moved byte for byte, so
// that the two callers below read one definition:
//   · assert-money-config.mjs limb 1c — a sandbox environment of a money-door
//     config that returns ANY finding here is a red build;
//   · assert-release-provenance.mjs limb 2b — a Cloudflare deploy of
//     `--env <name>` is excused from record-deployment.mjs only when
//     `env.<name>` declares MONEY_ENVIRONMENT "sandbox" AND returns NO finding.
// What an environment inherits was READ, not assumed (the limb 1b/1c block in
// assert-money-config.mjs): `routes`, `triggers` and `workers_dev` ARE
// inherited; `vars` and `d1_databases` are not.
// ─────────────────────────────────────────────────────────────────────────────

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The HOSTNAMES a config block binds, from `route` and `routes` (a string, or an
 *  object with a `pattern` — `custom_domain` entries included). */
export function routeHosts(block) {
  const out = [];
  const add = (r) => {
    const p = typeof r === 'string' ? r : isObject(r) && typeof r.pattern === 'string' ? r.pattern : null;
    if (p !== null) out.push(p.split('/')[0].toLowerCase());
  };
  if (block?.route !== undefined) add(block.route);
  if (Array.isArray(block?.routes)) block.routes.forEach(add);
  return out;
}
export const d1Of = (block) => (Array.isArray(block?.d1_databases) ? block.d1_databases.filter(isObject) : []);

/** Every reason `e` (the block at `env.<name>` of the parsed top-level
 *  config `cfg`) is NOT a sandbox that stays off production: routes that
 *  inherit or share a production host, any cron, `workers_dev` not `true`, a
 *  missing or unnamed PLATFORM_DB where the top level binds one, and any D1
 *  binding to a database the top level binds. `where` prefixes each message.
 *  An empty array is the proof; it says nothing about MONEY_ENVIRONMENT, which
 *  each caller reads itself. */
export function sandboxEnvironmentFindings(where, cfg, e) {
  const out = [];
  const topHosts = new Set(routeHosts(cfg));
  if (e?.route === undefined && e?.routes === undefined) {
    if (topHosts.size > 0) {
      out.push(
        `${where} declares no \`routes\`, so it INHERITS the top level's (${[...topHosts].join(', ')}). A sandbox ` +
          'deploy would then answer on the production hostnames, and a sandbox payment would be served as a real ' +
          'one. Declare `routes: []` (or its own hostnames). [5]M-12',
      );
    }
  } else {
    for (const h of routeHosts(e)) {
      if (topHosts.has(h)) {
        out.push(`${where} binds \`${h}\`, a hostname the top level (the production deploy) already binds. A sandbox rail must never answer on a production host. [5]M-12`);
      }
    }
  }
  const crons = e?.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== 0) {
    out.push(
      `${where} ${Array.isArray(crons) ? `runs ${crons.length} cron(s)` : 'declares no `triggers.crons`, so it INHERITS the top level\'s'}. ` +
        'A sandbox environment must declare `triggers: { "crons": [] }`: the production crons include the destructive ' +
        'nightly retention sweep, and a second copy of it has no business running from a sandbox. [5]M-12',
    );
  }
  // `workers_dev` is inherited too (above), and with `routes: []` the
  // workers.dev host is the ONLY one a sandbox answers on — the
  // `<name>-sandbox.<subdomain>.workers.dev` URL a smoke or a store capture
  // addresses. Absent, the environment serves whatever the top level decides;
  // false, it serves nothing. Either way the sandbox URL is a guess. (RZPA-7
  // item 4, accepted for PR A as vacuous and added with the first environment.)
  if (e?.workers_dev !== true) {
    out.push(
      `${where} ${e?.workers_dev === undefined ? 'declares no `workers_dev`, so it INHERITS the top level\'s' : `sets workers_dev = ${JSON.stringify(e.workers_dev)}`}. ` +
        'A sandbox environment must declare `"workers_dev": true`: with no route of its own, its workers.dev host is ' +
        'the one address it has, and an inherited value is a deploy target nobody decided. [5]M-12',
    );
  }
  const topD1 = d1Of(cfg);
  const topIds = new Set(topD1.map((d) => d.database_id).filter((id) => typeof id === 'string'));
  const topPlatformDb = topD1.find((d) => d.binding === 'PLATFORM_DB');
  const envPlatformDb = d1Of(e).find((d) => d.binding === 'PLATFORM_DB');
  if (topPlatformDb !== undefined) {
    if (envPlatformDb === undefined) {
      out.push(`${where} binds no PLATFORM_DB. Wrangler does not inherit \`d1_databases\`, so the sandbox money door would have no store to record a notification in. [5]M-12`);
    } else if (typeof envPlatformDb.database_id !== 'string' || envPlatformDb.database_id.trim() === '') {
      out.push(`${where} binds PLATFORM_DB with no \`database_id\`. Wrangler 4 can PROVISION a database for a binding that names none, on deploy — a resource nobody decided to create. Name the sandbox database. [5]M-12`);
    }
  }
  for (const d of d1Of(e)) {
    if (typeof d.database_id === 'string' && topIds.has(d.database_id)) {
      out.push(
        `${where} binds ${d.binding} to a PRODUCTION database (${d.database_id}, bound at the top level). Sandbox ` +
          'money written there is indistinguishable from real money to every reader of that table, so a sandbox ' +
          'environment binds no production database. [5]M-12',
      );
    }
  }
  return out;
}
