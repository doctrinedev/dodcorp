#!/usr/bin/env node
// Resolves a release tag to the package it refers to, and fails loudly if the
// tag disagrees with what is actually committed.
//
// The git tag is the source of truth for *which* release is happening, but
// package.json is the source of truth for the version that gets published.
// If those two ever disagree, the tag is a lie about the tree it points at —
// so we stop rather than publish something nobody asked for.
//
// Usage:  node scripts/check-release-tag.mjs '@dodcorp/webhooks@0.0.1-alpha.0'
//         RELEASE_TAG='@dodcorp/webhooks@0.0.1-alpha.0' node scripts/check-release-tag.mjs
//
// In GitHub Actions it appends name/version/dist-tag/directory to $GITHUB_OUTPUT.

import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = 'packages';

/** Tags look like `@scope/name@1.2.3`; split on the last `@`. */
function parseReleaseTag(tag) {
  const separator = tag.lastIndexOf('@');
  if (separator <= 0) {
    fail(`Tag "${tag}" is not of the form <package-name>@<version>.`);
  }
  return {
    packageName: tag.slice(0, separator),
    version: tag.slice(separator + 1),
  };
}

/**
 * npm dist-tag for a version. A prerelease must never land on `latest`, or
 * `npm install <pkg>` starts handing alpha code to everyone.
 */
function distTagFor(version) {
  const match =
    /^\d+\.\d+\.\d+(?:-(?<identifier>[0-9A-Za-z-]+)(?:\.\d+)?)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  if (!match) fail(`Version "${version}" is not valid semver.`);

  const identifier = match.groups?.identifier;
  if (!identifier) return 'latest';
  return ['alpha', 'beta', 'rc', 'next', 'canary'].includes(identifier) ? identifier : 'next';
}

function findPackage(packageName) {
  const candidates = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_DIR, entry.name));

  for (const directory of candidates) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (manifest.name === packageName) return { directory, manifest };
  }

  fail(
    `No package named "${packageName}" under ${PACKAGES_DIR}/. ` +
      `Found: ${candidates.join(', ') || '(none)'}`,
  );
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const tag = process.argv[2] ?? process.env.RELEASE_TAG;
if (!tag) fail('No release tag given (argv[2] or $RELEASE_TAG).');

const { packageName, version } = parseReleaseTag(tag);
const { directory, manifest } = findPackage(packageName);

if (manifest.version !== version) {
  fail(
    `Tag "${tag}" claims version ${version}, but ${directory}/package.json says ` +
      `${manifest.version}. Bump the manifest and re-tag the corrected commit.`,
  );
}

if (manifest.private) {
  fail(`${packageName} is marked "private": true and must not be published.`);
}

const distTag = distTagFor(version);

console.log(`✓ ${packageName}@${version}`);
console.log(`  directory: ${directory}`);
console.log(`  dist-tag:  ${distTag}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `package_name=${packageName}`,
      `version=${version}`,
      `dist_tag=${distTag}`,
      `directory=${directory}`,
      '',
    ].join('\n'),
  );
}
