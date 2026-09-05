# The twelve packages that were in `publish/` — all deleted 2026-08-20

**This is the record that made deleting them safe. It is deliberately the only thing that survived
them.** Everything below was measured from the files themselves before they were removed.

> **Why the filename says FIREFOX when this now covers all twelve.** The six Firefox packages were
> deleted first, for a specific and serious reason (§1); the six Chromium ones followed a few hours
> later for an ordinary housekeeping reason (§2). The name is kept because two merged commits and the
> private corpus already cite this path, and a stable reference that under-describes its contents is a
> far smaller problem than a broken one.

---

# §1 — Six Firefox packages that carried a placeholder add-on id

## What they were

Six built Firefox store packages whose `browser_specific_settings.gecko.id` was the placeholder
`fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. All six predated 2026-08-18, the day
`publish/manifest.firefox.json` was converted to an RFC 7386 merge patch and its id set to
`fullshot@nikatru.com` from `publish/identity.json`.

Measured by inflating `manifest.json` out of each archive — first on 2026-08-20 when they were moved
out of `publish/`, and re-measured immediately before deletion. Both readings agreed exactly.

| file | version | bytes | `gecko.id` | sha256 |
|---|---|---:|---|---|
| `fullshot-1.9.7-firefox.zip`   | 1.9.7  | 105 439 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `f357fc634bd0c095a118e31193bdaaa211d15a493fac6f4f80916b1854a52994` |
| `fullshot-1.9.11-firefox.zip`  | 1.9.11 | 106 619 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `1c682500d1a565ab65efcc1c61a42a25466b33af4ade94c7226b454fc553d7f4` |
| `fullshot-1.9.13-firefox.zip`  | 1.9.13 | 137 063 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `4883d5423ef089f8dca24afa1ef9f151e4ea7d7cb38710df95cd6169c99c9f86` |
| `fullshot-1.10.0-firefox.zip`  | 1.10.0 | 595 715 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `37c73e3b5b382839335097b40ddcb9790f045628170d2b21ac76aec7c4a6c086` |
| `fullshot-1.10.1-firefox.zip`  | 1.10.1 | 940 175 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `6ee44ed30a3e329f9f1414bc991deedab8ef73e7d1e56889b080389bc1a3efa4` |
| `fullshot-1.10.2-firefox.zip`  | 1.10.2 | 940 164 | `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` | `a20093b9e32f1cf66962dfe5e11fff9974e12389eeaac4ef304d47e37df5d8cd` |

2 825 175 bytes in total.

**Use this table to identify a copy that turns up elsewhere** — on a backup drive, in a cloud sync, in
somebody's Downloads. A file matching any sha256 above is one of these six and **must not be uploaded
to AMO**, whatever its filename.

The six **chromium** zips in `publish/` were never affected: they carry no `browser_specific_settings`
at all, which is correct for Chrome and Edge. They were not touched at the time — see §2, where they
were deleted a few hours later for an entirely different and much duller reason.

## 🔴 Why these six were dangerous and an ordinary stale artifact is not

The placeholder **passes AMO validation**. It is a syntactically valid email-style id on a domain
nobody owns, so an upload does not bounce — it succeeds, and binds the add-on to that identity.
Mozilla's addons-server documentation states that a guid *"cannot be restored and will forever be
unusable for submission"*.

The failure mode was therefore not a rejected upload somebody retries. It was an **accepted** upload
discovered afterwards, with no way back: a new listing, and every install, review and rating starting
from zero.

There was also a live trap while they sat in `publish/`. `publish/verify-firefox-package.node.js`
defaults its `--zip` argument to `publish/fullshot-<version>-firefox.zip`, so running that script with
no arguments graded one of these files rather than a fresh build.

## Why deleting was safe, and why it needed this file first

They were **untracked** — `Extension/Full_Screen_Shot/.gitignore` ignores `*.zip` — and this
repository has **zero tags**, so there was no commit to rebuild them from. Deletion was genuinely
irreversible.

What made it safe is that nothing needed them. They cannot be uploaded, no script reads them, and no
build depends on them. The only value they had was forensic, and this table is that value, kept.

## What holds the line now

`scripts/check-store-packages.mjs` opens every built store package it can find and refuses a
`gecko.id` that is the placeholder or that disagrees with `publish/identity.json`. It runs in `ci.yml`
twice:

- in `gates`, where a clean checkout has no packages and it **says so on every run**, so
  "0 packages, clean" cannot be misread as "12 clean";
- in `package`, where it grades the zip that job just built — the one place in CI where the subject
  really exists.

Verified in CI on 2026-08-20: the freshly built `dist/fullshot-firefox.zip` carries
`fullshot@nikatru.com` and passes. Stale versus fresh is exactly the distinction the gate draws.

## The `.gitignore` contradiction that hid them — since fixed

*(This section said "still open" when written a few hours earlier. It was closed the same day and is
corrected here rather than left standing: a stale "still open" is how a fixed thing gets fixed twice,
or worse, gets un-fixed by someone reading this as current.)*

`Extension/Full_Screen_Shot/.gitignore` ignored `*.zip` while the **root** `.gitignore` said a
recursive glob over `publish/` zips was *"deliberately NOT ignored"* because *"each release zip is a
golden master"* — and the nested file wins, which is why these six sat where no gate could see them.
There was a third file too: `templates/tool/.gitignore`, which agreed with the root and had predicted
the exact consequence in as many words.

It was not a matter of taste. `scripts/pack.mjs`'s dropped-file floor graded **0 entries on every run
for the life of the repo** as a result, and said so in its own output. Fixed: `!publish/*.zip` in the
nested file, and the root's self-contradicting closing sentence removed. All three files now agree.

---

# §2 — Six Chromium packages, deleted a few hours later

**Nothing was wrong with these.** They are recorded and deleted for housekeeping, not safety, and the
distinction matters: §1's files were dangerous, these were merely stale.

| file | version | bytes | `browser_specific_settings` | sha256 |
|---|---|---:|---|---|
| `fullshot-1.9.7.zip`   | 1.9.7  | 105 154 | absent (correct) | `4e26c7c9608550f14c555bad328761a39d5e7958e6de025b087046a5d181ab45` |
| `fullshot-1.9.11.zip`  | 1.9.11 | 106 320 | absent (correct) | `30b37cf3ccd2b0ec6fd97dd8e1cb947d703a4090c9cd6485fcff7bb260e5cbb7` |
| `fullshot-1.9.13.zip`  | 1.9.13 | 136 774 | absent (correct) | `10d6ef510067bfbd910ee2da45adbf32967cadeb93c90141e671a14b5622441f` |
| `fullshot-1.10.0.zip`  | 1.10.0 | 595 425 | absent (correct) | `37e414891796c465b311037f35b8f4c3ef19310638c186de77becc11b82532fb` |
| `fullshot-1.10.1.zip`  | 1.10.1 | 939 887 | absent (correct) | `652fa19691d9ed61faf22d22c61a6e7b6a394907c206a776ad13efb88815dc30` |
| `fullshot-1.10.2.zip`  | 1.10.2 | 939 887 | absent (correct) | `448ddbbac073a814a13c581d22a83887d8b54941f2a551f5ce863305364c1cc4` |

2 823 447 bytes in total. Every digest was cross-checked against the inventory taken at 02:00Z, before
any of this session's changes: **6 of 6 identical, zero discrepancies**, and every one confirmed to
carry no `browser_specific_settings` — i.e. none of them was ever in §1's dangerous class.

## Why they went

Not because they were unsafe. Because **none of them is a golden master and keeping them invited one
to be mistaken for one.**

`scripts/pack.mjs`'s third floor compares a new build against *"the last released package"* to catch a
silently dropped file, and `.gitignore` was corrected earlier the same day so that `publish/*.zip` is
tracked precisely to give that floor an anchor. But **this repository has zero tags and zero
releases** — no store has ever received any of these files. They are local build leftovers of versions
that were never shipped.

So after the `.gitignore` fix they were in an actively bad position: sitting in the directory the
packer looks in, newly un-ignored, and one `git add -A` away from being committed as a "golden
master" they are not. That very mistake was made and caught in this session — a commit swept all six
in and had to be undone before pushing. Deleting them removes the trap; the first real release
supplies a real anchor, and until then `pack.mjs` correctly prints *"graded 0 entries … NOT a clean
diff"*.

## What deleting them does NOT cost

- **Not the dropped-file floor.** It was already grading zero entries — these were never released, so
  they were never a valid anchor for it.
- **Not reproducibility.** `node scripts/pack.mjs fullshot --target chromium --out dist` rebuilds a
  package from any given commit, byte-reproducibly (CI checks that on every run). What cannot be
  reconstructed is *which* commit produced these particular bytes — which is exactly what the sha256
  column above preserves.
- **Not identification.** A copy of any of these that turns up on a backup drive or a cloud sync can
  be matched against the table above.

Unlike §1, **there is no danger in a copy of one of these existing.** They are ordinary, correct
Chromium packages of old versions. The only reason not to upload one is that it is stale.
