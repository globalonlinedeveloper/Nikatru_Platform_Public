# NIKATRU — browser extensions

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
.github/              CI workflows, issue forms, renovate
.githooks/            the pre-commit credential gate — git installs nothing, you do
```

Each extension carries its own `manifest.json`, `_locales/` (FullShot ships 55), a `test/` tree, and a
`publish/` folder holding the store paperwork.

`core/` is MPL-2.0 while each extension is source-available under PolyForm Shield — the file you are
editing decides which applies, not the pull request. No tool vendors `core/` yet, so the drift gate that
guards the copies has nothing to check today.

## Working on this

Before your first commit, install the credential hook. Git runs nothing on clone and `core.hooksPath`
lives in `.git/config`, which is never cloned, so nothing in this repository can do it for you:

```sh
git config core.hooksPath .githooks     # once per clone
sh .githooks/pre-commit --self-test     # and watch it prove its own patterns
```

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the two licences, the rules that get a pull request rejected on
  sight, the gates to run before you push, and what that hook does and does not cover.
- [`PRINCIPLES.md`](PRINCIPLES.md) — eight rules, each with an honest note on whether a machine enforces
  it today or a human does.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability. Not in a public issue.
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
