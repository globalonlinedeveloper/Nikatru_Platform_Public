<!--
Title convention (CONTRIBUTING.md → Commits):
  fullshot: guard importScripts for Gecko event pages
  skeleton: fold the report section into the options page
  repo:     widen the secret scan to the whole tree
The three lines above exist to show the SCOPE PREFIX, nothing else. Keep their
payloads version-free: the `repo:` example used to read "pin setup-node to the
v4 major", which stopped being true when the workflows moved to the v7 major and
left a comment block quietly recommending a dead pin. Bumping the number would
only re-arm the same rot on the next major, so the example no longer names one.
The tool id (not the directory) is what CI, tags and zip names key on, and it is
what `discover.mjs` falls back to when path detection is ambiguous. Use
`skeleton:` for `templates/tool/` and `repo:` for anything at the root.
-->

**Tool(s):** <!-- tool ids, e.g. `fullshot` — or `skeleton` / `repo` -->

## What and why

<!-- What changes, and the reason. Link the issue if there is one. -->

## How it was verified

<!-- Real output, not intent. Which gates you ran, on what, and what they said.
     "Should work" is not a verification. -->

Per-tool gates — these are the ones that exist today, and they run from inside
the tool directory. Cheap tiers first (`CONTRIBUTING.md` → Gates before you push):

```powershell
cd Extension\<Tool>
# every Node sim; capture the status on its own line, before anything else runs
foreach ($t in Get-ChildItem test\*.node.js) { node $t.FullName; "$($t.Name) EXIT $LASTEXITCODE" }
node publish\package.node.js                    # FullShot: builds both packages
node publish\verify-firefox-package.node.js     # grades the AMO archive
```

Repo-level gates, run from the repo root:

```powershell
node scripts\lint.mjs <id>
node scripts\policy-check.mjs <id>
node scripts\check-core-sync.mjs <id>
node scripts\check-version.mjs <id>
node scripts\run-tests.mjs <id>
node scripts\pack.mjs <id> --target chromium --out dist
node scripts\verify-refs.mjs --zip dist\<id>-chromium.zip --strict --leaks
```

> **Not all of those are written yet.** The `gate-inventory` job in `ci.yml`
> prints `PRESENT` / `ABSENT` for every gate script the workflows call, on every
> run — that is the current answer, not this list. Run the ones that exist, and
> never read a `Cannot find module` as a gate that passed. Tool-local script
> names also differ between tools: FullShot predates the template's and has no
> `preflight.mjs`. Pasting one tool's command list into another tool's terminal
> and reading "command not found" as green is the same mistake twice.

## Checklist

- [ ] **No build step.** Clone → load unpacked → it runs. (A per-tool bundler is an opt-in with its own `tool.json` `build` block, never a repo-wide requirement.)
- [ ] **No runtime dependency.** Nothing from npm ends up inside a shipped zip.
- [ ] **No network.** No `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / remote `src` in any packaged file. These extensions collect no analytics; `tool.json` → `policy.networkAllowlist` is the machine-readable form of that claim, and the gate must read the packaged bytes rather than grep the prose — the only current "hit" in FullShot is a comment saying there are none.
- [ ] **Nothing forbidden committed:** secrets, `.pem`/`.key`, `node_modules/`, generated `out/`, built zips, third-party screenshots.
- [ ] Signed off (`git commit -s`).

### If this touches a bug fix

- [ ] A sim or fixture that **failed before the fix** exists and passes now. A real-world failure becomes a permanent test, or it comes back.

### If this changes `manifest.json`, a permission, or the Firefox overlay

- [ ] Every permission has a justification string in `tool.json` → `policy.permissions`.
- [ ] `description` ≤ 132 chars, `name` ≤ 45, `short_name` ≤ 12, `manifest_version` is 3.
- [ ] 🔴 **No packaged root file or directory starts with `_`, except `_locales`.** Chrome refuses to load the whole extension otherwise — which is why the vendored core is `vendor/core/` and never `_core/`, and why `_locales/` has to be allowlist-*always* in the packer rather than pattern-matched.
- [ ] The Firefox manifest stays an **RFC 7386 overlay**, not a second full manifest — one place to edit, or one of them will drift. (FullShot's is still a full duplicate; `tool.json` → `targets.firefox.overlay` is `null` and says so.)
- [ ] ⚠️ **`browser_specific_settings.gecko.id` is permanent once AMO signs the first build.** Changing it later starts a new listing and loses reviews and users. FullShot's is still a placeholder — confirm the final value *before* the first AMO submission, not after.

### If this changes store listing copy

- [ ] Each store's listing metadata stays **distinct** — Microsoft Store policy 10.1.4 rejects listings that reuse another listing's metadata.
- [ ] Legal pages (privacy policy, terms) are linked from **nikatru.com**, not GitHub Pages.

### If this releases a version

- [ ] `manifest.json` version == top entry of the tool's `CHANGELOG.md` == the tag (`<tool-id>-v<version>`).
- [ ] Chrome's version format: 1–4 integers, no pre-release suffix (`1.10.2`, or `1.10.2.1` for a store-only re-upload).
- [ ] The version has never been used before. Two different packages under one number is unrecoverable in public.

### If this adds a tool

- [ ] `tool.json` exists (the entire coupling surface — CI discovers the tool from it; there is no list to add it to).
- [ ] The tool id appears in the dropdowns of `.github/ISSUE_TEMPLATE/bad-page.yml` and `bug.yml`. Issue forms can't be generated, so this is the one hand-maintained list — CI checks it, but it is on you to write.
- [ ] It has its own `CHANGELOG.md`, `README.md`, and at least one Node sim.

### If this adds to `core/`

- [ ] **Two tools already ship it** and a third credibly wants it. Shared code with one consumer is a second copy in a harder place to change.
- [ ] Mechanism, not policy; no DOM at load; no top-level side effects; zero npm dependencies.
- [ ] A sim in `core/test/` covers it. Core has N consumers, so a regression is N outages — and `core/test/` does not exist yet, so the first core PR creates it.
- [ ] Every tool that vendors core re-synced it (`node scripts\sync-core.mjs <tool>`) — a hand-edited vendored file fails `check-core-sync`. (No tool vendors core today: every `tool.json` has `"core": null` and there is no `vendor/core/` anywhere.)
