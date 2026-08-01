# Security policy

This repository is public. Its code builds the apps NIKATRU publishes, and the
Cloudflare Workers under `services/` that those apps talk to. If you have found a
way to reach data you should not reach, we want to hear about it before anybody
else does.

## Reporting a vulnerability

**Email `support@nikatru.com`.** That is the same address published on
<https://nikatru.com/contact.html> and compiled into every app we ship as
`AppConfig.supportEmail`, so there is exactly one address to get wrong, and
`tooling/ci/assert-repo-posture.mjs` fails the build if these three ever
disagree.

Please include:

- what you can reach that you should not be able to reach,
- the smallest sequence of steps that reproduces it,
- the commit SHA, deployed URL or app version you tested against.

**Please do not open a public GitHub issue for a security report.** An issue is
readable by everyone the moment it is filed, including before we have read it.

## What happens next

NIKATRU is a sole proprietorship — one person reads this mailbox. You will get a
human reply. We will tell you what we found, what we changed, and when the change
shipped. We will credit you if you want to be credited and stay quiet if you do
not.

We do **not** run a paid bug bounty, and we will not pretend otherwise: there is
no payout waiting at the end of a report.

## Scope

In scope:

- this repository's source, including the Cloudflare Workers in `services/` and
  the Cloudflare Pages Functions under `sites/*/functions/`,
- the sites deployed from `sites/` (`nikatru.com`, `rajasekarselvam.com`),
- the published apps built from `apps/`.

Out of scope, because they are not ours to fix and reporting them here only
delays the person who can:

- vulnerabilities in third-party services we consume (report those to the
  vendor),
- findings that require a compromised device or a physically present attacker,
- volumetric denial of service.

## Secrets

No credential belongs in this repository. `tooling/ci/scan-secrets.mjs` runs on
every push and self-tests before it scans. If you find a live credential in the
history, that is a security report — send it to the address above rather than
demonstrating it.
