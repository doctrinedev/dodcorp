// Shared discovery for the ADR-0001 enforcement checks.
//
// Every check walks `packages/*` itself rather than relying on each package
// declaring a script. `pnpm -r run <script>` silently skips packages that do
// not define it, which would make a new package unenforced by default — the
// exact honour-system failure ADR-0001 §Enforcement exists to remove.

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Publishable workspace packages, in stable order.
 *
 * Private packages (fixtures, examples) are skipped: they ship no public
 * surface and are never packed, so neither check has anything to say about them.
 */
export async function findPackages() {
  const packagesDir = path.join(repoRoot, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(packagesDir, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private === true) continue;

    packages.push({ name: manifest.name, dir, manifestPath, manifest });
  }

  return packages;
}

/** Fail loudly rather than silently reporting success over an empty set. */
export function assertPackagesFound(packages) {
  if (packages.length === 0) {
    console.error('No publishable packages found under packages/. Expected at least one.');
    process.exit(1);
  }
}
