// ADR-0001 §Enforcement #3 — packaging and .d.ts correctness.
//
// `publint` and `are-the-types-wrong` both run against the actual packed
// tarball, not the working directory. That difference matters: the tarball is
// filtered by `package.json#files`, so packing is the only way to catch a
// `dist/` artefact or an `exports` target that exists locally and is missing
// for the adopter. ADR-0001 §6 requires `.d.ts` files "shipped and validated in
// CI"; validating anything other than the published artefact is theatre.
//
//   node scripts/check-package.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertPackagesFound, findPackages, repoRoot } from './lib/packages.mjs';

/** Packs a package exactly as `npm publish` would and returns the tarball path. */
function pack(pkg, destination) {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: pkg.dir,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one tarball from \`pnpm pack\`, got ${tarballs.length}`);
  }

  return path.join(destination, tarballs[0]);
}

function run(command, args) {
  try {
    const stdout = execFileSync(command, args, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
  }
}

const packages = await findPackages();
assertPackagesFound(packages);

const failures = [];

for (const pkg of packages) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'dodcorp-check-package-'));

  try {
    const tarball = pack(pkg, tempDir);

    // `--strict` promotes publint's warnings to errors. A warning here is
    // something an adopter will hit; there is no tier of packaging problem we
    // are willing to publish knowingly.
    const publint = run('pnpm', ['exec', 'publint', 'run', tarball, '--strict']);
    if (!publint.ok) failures.push(`${pkg.name} — publint:\n${publint.output}`);

    const attw = run('pnpm', ['exec', 'attw', tarball]);
    if (!attw.ok) failures.push(`${pkg.name} — are-the-types-wrong:\n${attw.output}`);

    if (publint.ok && attw.ok) console.log(`ok        ${pkg.name}`);
  } catch (error) {
    failures.push(`${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\nPackage check failed:\n`);
  for (const failure of failures) console.error(`${failure}\n`);
  console.error(
    'These run against the packed tarball, so a failure here is what an adopter would\n' +
      'install. Check `files`, `exports`, and that `pnpm build` ran before this check.',
  );
  process.exit(1);
}

console.log(`\nPackaging verified for ${packages.length} package(s).`);
