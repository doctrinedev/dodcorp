# DodCorp

TypeScript monorepo for the `@dodcorp` packages.

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@dodcorp/webhooks`](packages/webhooks) | `0.0.1-alpha.0` | Webhook signing and signature verification. |

## Getting started

Requires **Node 20.11+** and **pnpm** (the version is pinned by `packageManager`;
`corepack enable` will honour it).

```sh
pnpm install
pnpm run check     # typecheck + lint + test + build + package validation
```

Individual steps:

| Command | What it does |
| --- | --- |
| `pnpm run typecheck` | `tsc --build` across all packages |
| `pnpm run lint` | ESLint, type-aware on package sources |
| `pnpm run test` | Vitest across the workspace |
| `pnpm run test:watch` | Vitest in watch mode |
| `pnpm run test:coverage` | Vitest with V8 coverage |
| `pnpm run build` | tsup → ESM + CJS + `.d.ts` per package |
| `pnpm run check:package` | publint + are-the-types-wrong on built output |

## Layout

```
packages/*          publishable packages
scripts/            release tooling
docs/               contributor and process docs
tsconfig.base.json  shared compiler options — every package extends this
eslint.config.js    shared lint config for the workspace
vitest.config.ts    shared test config for the workspace
```

Shared configuration lives at the root and is inherited, not copied. A new
package needs only its own `package.json`, a `tsconfig.json` extending
`../../tsconfig.base.json`, and a `tsup.config.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: branch, open a PR, keep CI
green. `main` is protected and requires a passing check suite.

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md). Releases are tag-driven and run
through GitHub Actions; nobody publishes from a laptop.

## License

MIT
