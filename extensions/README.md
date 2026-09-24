# NIKATRU — browser extensions

> ### 🔴 THIS DIRECTORY WAS A REPOSITORY UNTIL 2026-09-05.
>
> It is now a **subtree of `Nikatru_Platform_Public`**, at `extensions/`, under
> [ADR 067] decision 1 — *"a sovereign, build-free `extensions/` subtree"*. The old
> repository, `globalonlinedeveloper/Nikatru_Extensions_Public`, was **DELETED on GitHub on
> 2026-09-05** — not archived. Re-measured 2026-09-06: `gh api
> repos/globalonlinedeveloper/Nikatru_Extensions_Public` exits non-zero and the name is absent from
> `gh api user/repos`. All 61 of its commits came across with `git subtree add` and are in this
> repository's history, **which is now the only copy of them on GitHub**. A frozen local snapshot
> is at `Projects/_archived-2026-09-05/Nikatru_Extensions_Public`. Any old link 404s; it does not
> redirect.
>
> **What did not change, and is the reason the word "sovereign" is in that sentence:**
> there is still no package manager, no bundler and no transpiler under this
> directory, every gate is still one `node scripts/<name>.mjs`, and every workflow
> command still runs with `working-directory: extensions` so it is byte-identical to
> the one that ran when this was its own repository.
>
> **What changed:** the three workflows are now one, at
> `.github/workflows/extensions.yml` in the repository root, with job-level change
> detection driven by this tree's own `scripts/discover.mjs`. And two checks exist
> that could not exist before, because they read files on both sides of what used to
> be a repository boundary — `tooling/ci/assert-extensions-build-free.mjs`, which
> makes the no-build property an invariant rather than a habit, and
> `tooling/ci/assert-lane-coverage.mjs`, which now counts every extension as a
> deployable unit and refuses a tree where one is claimed by no lane.
>
> **The exit is one command, and it is worth knowing before you need it:**
>
> ```
> git subtree split --prefix=extensions -b extensions-only
> ```
>
> That reconstructs a standalone repository with full, correct history at any future
> date. Nothing about the merge is expensive to reverse — which is why it was the
> cheaper decision to be wrong about.

Cross-browser extensions for Chrome, Firefox and Edge. Built by
[NIKATRU](https://nikatru.com), a sole proprietorship registered in India.

Small, single-purpose tools that do one thing well, work offline where they can, and ask for the fewest
permissions the job allows.

## Extensions

<!-- CATALOG:START -->
| Extension | What it does | Status |
|---|---|---|
| [FullShot](Extension/Full_Screen_Shot) | Full-page, visible-area, region and element capture, with an annotation editor, PDF export and on-device redaction. | In progress |
<!-- CATALOG:END -->

That table is generated from each tool's `tool.json` by `scripts/gen-catalog.mjs` and lives between the
two markers around it. Edit the `tool.json`; a hand-typed row is a second place for the same fact to be
written, and the second place is the one that goes stale.

## Repository layout

```
Extension/            the extensions themselves
  Full_Screen_Shot/     FullShot — the reference implementation
templates/tool/       the template a new extension is stamped from
core/                 the shared runtime, copied into a tool as vendor/core/ (MPL-2.0)
scripts/              the repo-level gates and the scaffolder — lint, policy-check,
                        check-version, discover, new-tool, gen-catalog, sync-core
docs/                 architecture, core policy, releasing, the store playbook
.github/              (emptied 2026-09-08 — see below)
                      (the pre-commit credential gate moved out on 2026-09-08 — see below)
```

Each extension carries its own `manifest.json`, `_locales/` (FullShot ships 55), a `test/` tree, and a
`publish/` folder holding the store paperwork.

`core/` is MPL-2.0 while each extension is source-available under PolyForm Shield — the file you are
editing decides which applies, not the pull request. No tool vendors `core/` yet, so the drift gate that
guards the copies has nothing to check today.

## Working on this

Before your first commit, install the repository's hooks. Git runs nothing on clone and
`core.hooksPath` lives in `.git/config`, which is never cloned, so nothing in this repository can do
it for you:

```sh
node tooling/scripts/install-hooks.mjs           # once per clone, from the repository ROOT
node tooling/scripts/install-hooks.mjs --check   # verify only; exit 1 if it is not installed
```

⏱ 2026-09-08 — THIS INSTRUCTION CHANGED, and the old one had become wrong rather than merely
old. It read `git config core.hooksPath .githooks` followed by `sh .githooks/pre-commit
--self-test`. Run from the repository root — the only place `core.hooksPath` can be set — that
first line selects the ROOT `.githooks/`, not this subtree's, because git honours exactly ONE
`core.hooksPath` per repository. The subtree copy had been inert since the 2026-09-05 merge and
was removed; it is at `ref/pre-prune-2026-09-08:extensions/.githooks/pre-commit`. The root hook takes no
`--self-test`, so the second line would have failed. The credential patterns it carried are run
by two live gates instead: `node scripts/secret-scan.mjs .` here (extensions-ci.yml:339, and the release job at extensions.yml:1201) and
`tooling/ci/scan-secrets.mjs` repo-wide (ci.yml:598).

⏱ 2026-09-08 — `extensions/.github/` AND `extensions/renovate.json` ARE GONE, and every one of
them was inert from the day the subtree was merged. GitHub reads `.github/` at the repository ROOT
only, and Renovate reads its configuration at the ROOT only — so the workflows here were already
folded into the root `.github/workflows/extensions.yml` on 2026-09-05, the issue forms were
promoted to `<root>/.github/ISSUE_TEMPLATE/` (where a reporter can finally see them), the pull
request template's "No network" clause was folded into `<root>/.github/PULL_REQUEST_TEMPLATE.md`,
and the root `renovate.json` already reaches this subtree — it declares no `ignorePaths` entry for
it. Recover any of them with `git show ref/pre-prune-2026-09-08:<path>`.

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the two licences, the rules that get a pull request rejected on
  sight, the gates to run before you push, and what that hook does and does not cover.
- [`PRINCIPLES.md`](PRINCIPLES.md) — eight rules, each with an honest note on whether a machine enforces
  it today or a human does.
- [`SECURITY.md`](../SECURITY.md) — how to report a vulnerability. Not in a public issue.
  ⏱ 2026-09-08: repointed to the repository root. `extensions/SECURITY.md` stated the opposite
  reporting policy and GitHub never surfaced it; it is at `ref/pre-prune-2026-09-08:extensions/SECURITY.md`.
- [`docs/`](docs/) — architecture, core policy, releasing, the store playbook.

## Privacy

**Extensions in this repository do not collect analytics, and do not send your browsing data anywhere.**
FullShot's redaction runs entirely on your machine — the detection never contacts a server.

Each extension's privacy policy is written in its own `publish/` folder. That file is the source of the
served page, not the served page: the policy is published at [nikatru.com](https://nikatru.com) and
linked from the store listing when the extension is listed. **Nothing here is listed yet** — FullShot's
three store listings are all null in its `tool.json`, and the repo's own `policy-check` says so.

## Permissions

Every permission an extension requests is justified in its own README. FullShot requests
`activeTab`, `scripting`, `downloads`, `storage` and `unlimitedStorage`, with `<all_urls>` **optional** —
it is requested only if you choose to enable capture on every site, and the extension works without it.

## Testing

Extensions here are tested at several levels: node-side simulations that load the real shipped source,
pixel simulations that render without a browser, and Playwright end-to-end runs against a real extension
build. The suites live under each extension's `test/`.

## Licence

There is no repository-wide `LICENSE`, on purpose — the terms are per directory. See `LICENSE` in each
extension directory (PolyForm Shield 1.0.0) and `core/LICENSE` (MPL-2.0).

## Reporting a problem

Open an issue. If a page captures incorrectly, include the URL where possible — a reproducible page is
worth more than a description.
