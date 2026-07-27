# Contributing

## Setup

```sh
corepack enable      # use the pnpm version pinned in package.json
pnpm install
pnpm run check
```

## Workflow

1. Branch off `main`.
2. Make the change, with tests.
3. Run `pnpm run check` locally — it runs exactly what CI runs.
4. Open a PR.

`main` is protected: changes land through a PR with a green check suite. Force
pushes and deletions are blocked.

## Standards

**TypeScript is strict**, and then some — `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and `noUnusedLocals` are all on. This is
deliberate: these packages ship to other people, and the compiler catching a
missing `undefined` case is cheaper than a consumer hitting it.

**Tests live next to the code**, as `src/foo.test.ts` beside `src/foo.ts`.
Test behaviour rather than implementation, and cover the failure paths — for
security-sensitive code such as signature verification, the rejection cases
matter more than the happy path.

**Packages declare their own dependencies.** Tooling shared by the whole
workspace (TypeScript, ESLint, Vitest) belongs in the root `devDependencies`;
anything a package needs at runtime belongs in that package's manifest.

**Public API changes need a doc change.** The package README is the contract.

## Adding a package

```
packages/<name>/
  package.json        name it @dodcorp/<name>; start at 0.0.1-alpha.0
  tsconfig.json       extends ../../tsconfig.base.json
  tsup.config.ts      copy from packages/webhooks
  src/index.ts        the public surface — export deliberately
  README.md
```

Then add it to the root `tsconfig.json` `references` array and to the package
table in the root README.

Copy `packages/webhooks/package.json` as the starting point: it already has the
correct `exports` map (separate `types` per condition), `files`, `sideEffects`,
`engines`, and `publishConfig.access: public`. `pnpm run check:package` will tell
you if any of it drifts.

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md).
