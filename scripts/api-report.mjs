// ADR-0001 §Enforcement #1 — the committed public API report.
//
// Every publishable package carries an `api-report.md` describing its entire
// public surface. CI regenerates it from the built `.d.ts` and fails if the
// committed copy has drifted. That turns §3 semver classification from
// something a reviewer has to remember into a diff they can read: adding an
// optional field and adding a required one look different on the page.
//
//   node scripts/api-report.mjs           # verify (CI) — fails on drift
//   node scripts/api-report.mjs --update  # rewrite the committed reports
//
// Package config is synthesized here rather than committed per package, so a
// new package is covered the day it is created with nothing to opt into. The
// only per-package requirement is the ADR §1 layout: `src/index.ts` as the
// entire public API, built to `dist/index.d.ts`.

import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertPackagesFound, findPackages, repoRoot } from './lib/packages.mjs';

const shouldUpdate = process.argv.includes('--update');

const REPORT_FILE_NAME = 'api-report.md';
const ENTRY_DTS = path.join('dist', 'index.d.ts');

/**
 * API Extractor config for one package.
 *
 * The compiler options are supplied inline rather than read from the package's
 * tsconfig: that project is rooted at `src/` and would reject `dist/index.d.ts`
 * as an input. We only ever feed API Extractor already-built declarations, so
 * the strictness that matters was applied when they were emitted.
 */
function buildConfigObject(pkg, outDir, workDir) {
  return {
    projectFolder: pkg.dir,
    mainEntryPointFilePath: path.join(pkg.dir, ENTRY_DTS),
    bundledPackages: [],
    apiReport: {
      enabled: true,
      // Always generated into a scratch folder: API Extractor forces an
      // `.api.md` suffix on the filename and compares reports itself. We want
      // the exact filename ADR-0001 names and a diff we control, so it only
      // ever produces the content and this script owns compare-and-write.
      reportFolder: outDir,
      reportFileName: 'generated',
      reportTempFolder: workDir,
    },
    docModel: { enabled: false },
    dtsRollup: { enabled: false },
    tsdocMetadata: { enabled: false },
    // LF everywhere so the committed report is identical on every platform; a
    // CRLF checkout must not read as a public-surface change.
    newlineKind: 'lf',
    compiler: {
      overrideTsconfig: {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: [path.join(pkg.dir, ENTRY_DTS)],
      },
    },
    messages: {
      // Release tags (@public/@beta) are a docs-model feature we deliberately
      // do not use: ADR-0001 §1 says everything reachable from src/index.ts is
      // public, so a per-export tag would be a second source of truth.
      extractorMessageReporting: {
        default: { logLevel: 'warning' },
        'ae-missing-release-tag': { logLevel: 'none' },
        'ae-undocumented': { logLevel: 'none' },
      },
      tsdocMessageReporting: {
        default: { logLevel: 'none' },
      },
    },
  };
}

/** Line-level diff of committed vs generated report, so the drift is readable in the CI log. */
function diffReports(committed, actual) {
  const committedLines = committed.split('\n');
  const actualLines = actual.split('\n');
  const removed = committedLines.filter((line) => line.trim() && !actualLines.includes(line));
  const added = actualLines.filter((line) => line.trim() && !committedLines.includes(line));

  if (removed.length === 0 && added.length === 0) return '';

  return [
    'Public surface diff (committed → built):',
    ...removed.map((line) => `  - ${line}`),
    ...added.map((line) => `  + ${line}`),
  ].join('\n');
}

const packages = await findPackages();
assertPackagesFound(packages);

const failures = [];

for (const pkg of packages) {
  const entryPath = path.join(pkg.dir, ENTRY_DTS);
  if (!existsSync(entryPath)) {
    failures.push(
      `${pkg.name}: missing ${ENTRY_DTS}. The API report is generated from built declarations — run \`pnpm build\` first.`,
    );
    continue;
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'dodcorp-api-report-'));
  const outDir = path.join(tempDir, 'out');
  const workDir = path.join(tempDir, 'work');
  mkdirSync(outDir);
  mkdirSync(workDir);
  const messages = [];

  const reportPath = path.join(pkg.dir, REPORT_FILE_NAME);
  const relativeReport = path.relative(repoRoot, reportPath);

  try {
    const extractorConfig = ExtractorConfig.prepare({
      configObject: buildConfigObject(pkg, outDir, workDir),
      configObjectFullPath: undefined,
      packageJsonFullPath: pkg.manifestPath,
    });

    const result = Extractor.invoke(extractorConfig, {
      // Always a "local build" so API Extractor writes the report instead of
      // diffing it. Drift detection is this script's job, below.
      localBuild: true,
      showVerboseMessages: false,
      messageCallback: (message) => {
        // Own the output: API Extractor's default handler writes straight to
        // the console, which buries the one line that matters per package.
        message.handled = true;
        if (message.logLevel === 'error' || message.logLevel === 'warning') {
          messages.push(`  [${message.logLevel}] ${message.text}`);
        }
      },
    });

    const produced = existsSync(outDir) ? readdirSync(outDir) : [];
    if (!result.succeeded || produced.length === 0) {
      failures.push(
        `${pkg.name}: API Extractor could not analyze the built declarations.\n${messages.join('\n')}`,
      );
      continue;
    }

    const generated = readFileSync(path.join(outDir, produced[0]), 'utf8');

    if (shouldUpdate) {
      const changed = !existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== generated;
      writeFileSync(reportPath, generated);
      console.log(`${(changed ? 'wrote' : 'unchanged').padEnd(9)} ${pkg.name} → ${relativeReport}`);
      continue;
    }

    if (!existsSync(reportPath)) {
      failures.push(
        `${pkg.name}: ${relativeReport} is missing. Every publishable package must commit one (ADR-0001 §Enforcement).`,
      );
      continue;
    }

    const committed = readFileSync(reportPath, 'utf8');
    if (committed === generated) {
      console.log(`${'ok'.padEnd(9)} ${pkg.name} → ${relativeReport}`);
      continue;
    }

    // Show the drift itself, not just that drift exists — the reviewer needs
    // to classify it under §3, and that starts with seeing what moved.
    failures.push(
      `${pkg.name}: ${relativeReport} does not match the built public surface.\n\n${diffReports(committed, generated)}`,
    );
  } catch (error) {
    failures.push(`${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\nAPI report check failed for ${failures.length} package(s):\n`);
  for (const failure of failures) console.error(`${failure}\n`);
  console.error(
    'If this change to the public surface is intended, run `pnpm api:update`, then classify it\n' +
      'against ADR-0001 §3 (semver) and commit the updated report alongside the change.',
  );
  process.exit(1);
}

console.log(`\nAPI report ${shouldUpdate ? 'updated' : 'verified'} for ${packages.length} package(s).`);
