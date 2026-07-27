# Releasing

Every package in this repo publishes to npm under the `@dodcorp` scope. Releases
are driven by a **git tag**; there is no manual `npm publish` from a laptop, and
no npm credential exists outside GitHub Actions.

## The model in one paragraph

You bump the version in the package's `package.json`, merge that through a PR,
then push a tag naming the exact package and version. The `Release` workflow
re-runs the whole check suite against the tagged tree, refuses to proceed unless
the tagged commit is already on `main`, and publishes with the dist-tag implied
by the version number. Prereleases never land on `latest`.

## Cutting a release

### 1. Bump the version on a branch

```sh
git switch -c release/webhooks-0.0.1-alpha.1
cd packages/webhooks
npm version 0.0.1-alpha.1 --no-git-tag-version   # edits package.json only
```

Use a prerelease version (`-alpha.N`, `-beta.N`, `-rc.N`) until the package is
ready for general use. See [Version → channel](#version--channel) below.

### 2. Open a PR and get it green

CI must pass. Branch protection will not let you merge otherwise.

### 3. Tag the merged commit

Tag format is **`<package-name>@<version>`** — the full scoped name:

```sh
git switch main && git pull
git tag '@dodcorp/webhooks@0.0.1-alpha.1'
git push origin '@dodcorp/webhooks@0.0.1-alpha.1'
```

The tag must point at a commit that is already on `main`. The workflow verifies
this and aborts otherwise, so a tag on an unreviewed branch cannot ship.

### 4. Approve the deployment

The `release` job runs in the `npm-publish` environment. If required reviewers
are configured, the run pauses in the Actions tab until someone approves it. That
approval is the last human gate before the registry.

### 5. Verify

```sh
npm view @dodcorp/webhooks versions
npm view @dodcorp/webhooks dist-tags
npm install @dodcorp/webhooks@0.0.1-alpha.1
```

## Version → channel

`scripts/check-release-tag.mjs` derives the npm dist-tag from the version, so the
channel is never chosen by hand:

| Version | dist-tag | `npm install @dodcorp/webhooks` gets it? |
| --- | --- | --- |
| `1.2.3` | `latest` | yes |
| `0.0.1-alpha.0` | `alpha` | no — needs `@alpha` or the exact version |
| `1.0.0-beta.2` | `beta` | no |
| `2.0.0-rc.1` | `rc` | no |
| `3.0.0-unrecognised.1` | `next` | no |

**While a package is pre-1.0, publish prereleases only.** The first `latest`
release is a deliberate decision, not a side effect of forgetting a suffix.

## Dry run

To exercise the pipeline without publishing, run the workflow manually:

Actions → **Release** → *Run workflow* → set `tag` to the release tag and
`dry_run` to `true`. Everything runs except the publish; `npm publish --dry-run`
prints the exact file list that would be uploaded.

## What the pipeline guarantees

- **The tag cannot lie.** If the tag's version and the package's `package.json`
  version disagree, the release fails before publishing.
- **Private packages cannot escape.** `"private": true` aborts the release.
- **Only reviewed code ships.** The tagged commit must be an ancestor of `main`.
- **The published tree is the tested tree.** The full suite re-runs against the
  tag, not just against the PR branch.
- **Provenance is attached.** Published with `--provenance`, so npm records which
  workflow, commit, and repository produced the tarball.
- **Prereleases stay off `latest`.** Derived from the version, not typed by hand.

## First-time setup (one-off, per registry account)

Publishing requires two things that live outside this repo:

1. An npm account or organisation owning the **`@dodcorp` scope**.
2. A **granular access token** with write access to that scope, stored as the
   repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions),
   scoped to the `npm-publish` environment.

Prefer a granular token with an expiry over a classic automation token, and
prefer npm **trusted publishing** (OIDC) over any long-lived token once the scope
exists — the workflow already requests `id-token: write`, so moving to trusted
publishing means removing the `NODE_AUTH_TOKEN` line, nothing more.

## Troubleshooting

**`✗ Tag "..." claims version X, but packages/…/package.json says Y`**
The tag was pushed against the wrong commit. Delete it
(`git push --delete origin '<tag>'`), fix the version on `main`, re-tag.

**`✗ Commit … is not an ancestor of origin/main`**
You tagged a branch commit. Merge the PR first, then tag the commit on `main`.

**`npm ERR! 402 Payment Required`**
The scope is private. `publishConfig.access` is already `public` in each package
manifest; if this appears, the npm **organisation** defaults to private packages —
change it in the org settings.

**`npm ERR! 403 Forbidden`**
`NPM_TOKEN` is missing, expired, or lacks write access to `@dodcorp`.

**Version already published**
npm versions are immutable and cannot be reused, even after `npm unpublish`.
Bump to the next version and release again.
