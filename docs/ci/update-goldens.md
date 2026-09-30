# `update-goldens.yml` — re-render golden PNGs on Linux, on demand

CI renders every golden on Linux (`ci.yml` `workspace-gate`, `ubuntu-24.04`,
`.github/actions/setup-flutter` reading `tooling/versions.json`). A golden
rendered on Windows or macOS differs by antialiasing and fails there. No laptop
here has a Linux Flutter any more, so this workflow is how any lane re-renders
goldens: a pipeline capability, not a machine.

## The dispatch command

```
gh workflow run update-goldens.yml -R globalonlinedeveloper/Nikatru_Platform_Public \
  -f ref=<branch> \
  -f tests="apps/<id>/test/a_test.dart apps/<id>/test/b_test.dart" \
  -f mode=commit
```

- `ref` — the branch to re-render on and push to. Never `main`: refused.
- `tests` — space-separated test files, relative to the repository root, each
  `apps/<id>/test/…_test.dart` or `packages/<name>/test/…_test.dart`. The
  packages are derived from these paths; each package's tests run from its own
  root, as `melos run test` does in CI.
- `mode` — `commit` (default) pushes one commit; `artifact` only uploads the
  PNGs as `goldens-<run id>`, laid out at their repository paths, so unzipping
  the artifact at the repository root puts every file in place.

The workflow runs from `main`'s copy of this file and checks `ref` out, so a
branch cannot change what the workflow does.

## What it does

1. **`regenerate`** (`contents: read`; it runs the branch's test code):
   refuses a bad `ref` or test path, checks `ref` out, sets Flutter up with the
   same composite action CI uses, resolves the workspace with
   `flutter pub get --enforce-lockfile`, records the tree, runs
   `flutter test --update-goldens <tests>`, and fails if anything other than a
   golden PNG (`<package>/test/…/goldens/*.png`) of a tested package changed.
   It then runs the same tests **without** `--update-goldens`; red there fails
   the job and nothing is committed or uploaded.
2. **`commit`** (`contents: write`, `mode=commit` only, and only when a PNG
   changed): checks out the exact commit `regenerate` tested, re-checks every
   staged path and PNG signature against the dispatch inputs, commits
   `test(goldens): regenerate on linux (<run url>)` and pushes to `ref`
   without force, so a branch that moved in the meantime is refused, not
   overwritten. It runs no code from the branch.

## After a green `commit` run

A push made with `GITHUB_TOKEN` starts no workflow, so **CI does not re-run by
itself**. Re-trigger it on the pull request: edit its body (`ci.yml` runs on
`edited`) or push any commit.

The ops row is `duty.workflow.update-goldens.yml` in `tooling/ops/register.json`.
