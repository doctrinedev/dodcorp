# ADR-0001: Component API design standard

**Status:** Accepted · **Date:** 2026-07-27 · **Author:** Founding Engineer · **Reviewer:** SChief (CEO)
**Applies to:** every package published under `@dodcorp/*`, starting with `@dodcorp/webhooks`.

## Context

Our advantage over a hosted vendor is that we are not in the adopter's data path. Our advantage over the version they'd write themselves in a weekend is that our contracts are small, typed, and stable. Both are properties of API design rather than implementation — so they get decided once, here, and every package inherits them.

## Decision

### 0. The boundary — non-negotiable

A component is **headless** and **storage-agnostic**: it runs in the adopter's process, on their infrastructure, against their store. Out of bounds, no exceptions:

- Any path that sends adopter data to a DodCorp-operated service.
- Any required network egress other than to destinations the adopter configured.
- Any required DodCorp account, key, license check, or telemetry — we ship none, not even opt-out.
- Any hard dependency on a specific HTTP framework, logger, DI container, or deploy target.

A design that fails this section is rejected regardless of its other merits.

### 1. Public API surface

- **One package, one capability.** If the whole public surface doesn't fit on a page, the scope is wrong.
- **`src/index.ts` is the entire public API.** Anything reachable from it is public and bound by §3; everything else lives in `src/internal/` and may never appear in a public type signature. `package.json#exports` declares `"."` and `"./package.json"` only — no deep imports, and new subpaths require an ADR.
- **Factory functions over classes** — `createDeliveryEngine(options)` returning an interface, not `new DeliveryEngine()`. Classes leak construction and inheritance into the contract. Exception: error types (§2), which adopters need as values.
- **Options objects** for anything taking more than one argument. No positional booleans, no overloads. Adding a parameter must not be a call-site change.
- **Async by default** for anything touching I/O; no sync twin, and every async public method accepts an `AbortSignal`.
- **No module-level mutable state.** Two instances must coexist in one process without seeing each other — no singletons, no global registries, no process-wide config.
- **Naming:** types are nouns (`Delivery`), functions are verbs (`createX`, `signPayload`), booleans read as assertions (`isActive`, not `active`), durations are milliseconds and say so (`timeoutMs`). Nothing is abbreviated.
- **Observability is a hook, not a dependency:** an optional `onEvent(event)` callback emitting typed structured events. We never pick the adopter's logger and never write to `console`.

### 2. Errors

- **Throw for broken contracts, return for expected outcomes.** Invalid config or arguments throw at construction — those are bugs in adopter code and failing fast is correct. A delivery that got a 500 is *normal operation*, so it is a returned result, never an exception. If it can happen on a healthy production day, it is data.
- **One exported base type per package** (e.g. `WebhooksError extends Error`), carrying a `code` from a documented string-literal union, plus `cause`.
- **Identify by brand, never `instanceof`.** Duplicate copies of a package in one dependency tree break prototype checks, silently. Each package exports a type guard (`isWebhooksError`) testing a `Symbol.for('dodcorp.error')` marker property; adopters branch on `.code`, never on class identity.
- **Adapter and transport failures are wrapped**, not leaked — nobody should catch a `pg` error to use us. Original preserved in `cause`.
- **No secrets or payload bodies in messages.** Signing keys, headers, and request bodies never appear in an error string. Include the identifiers needed to find the record in the adopter's own logs.

### 3. Semver

**Types are part of the API.** A change that breaks `tsc` for a compiling adopter is a breaking change, even with no runtime effect.

| Breaking (major) | Not breaking (minor) |
|---|---|
| Removing or renaming any export | Adding a new export |
| Narrowing a parameter type, widening a return type | Widening a parameter, narrowing a return |
| Adding a required field to an options object | Adding an *optional* field |
| Adding **any** member to an interface adopters implement | Adding a member to an interface only we implement |
| Changing or removing an error `code` | Adding a new error `code` (see below) |
| Changing observable default behaviour | New behaviour behind a new opt-in option |
| Raising minimum Node or TypeScript version | Raising a devDependency |

Two consequences worth stating outright:

- **Interfaces adopters implement — the storage adapter above all — are variance-inverted: any addition is breaking**, so they change only in a major. This is exactly why the adapter interface (DOD-4) is worth getting right before the engine exists.
- **Error-code unions are open.** New codes may appear in a minor and adopters must have a default branch. We document that at the union rather than pretend the set is closed, because the alternative is a major every time we discover a failure mode.

**While 0.x:** minor means breaking, stated in the README rather than assumed known.

**Deprecation:** mark `@deprecated` naming the replacement, warn once per process (never per call) where a runtime path exists, ship it in a minor. Removal only in the next major and never sooner than **two minors and 90 days**, whichever is longer, with a `MIGRATING.md` entry giving mechanical before/after code. A breaking change with no mechanical migration path is a signal to redesign the change, not to write a longer note. No more than one major per six months, security fixes excepted.

### 4. The storage-adapter contract — principle

DOD-4 defines the concrete interface. It must satisfy these, which are not negotiable there:

- **The adopter owns the connection, transaction, schema, and lifecycle.** We never open a connection, hold a pool, or run a migration implicitly. Migrations ship as SQL text they choose to run.
- **Narrow and total.** The smallest set of operations the engine needs, each implementable *efficiently* on both a KV store and SQL. An operation that only works well on Postgres belongs behind an optional capability the core degrades without, not in the interface.
- **State requirements, not mechanisms.** Each method documents the guarantee it needs — "atomic claim of one pending delivery" — and the adapter chooses how to provide it. The core never assumes a transaction model.
- **Async and cancellable**, every method. Errors wrapped by the core into our own codes, `cause` preserved (§2).
- **A conformance suite ships with the interface**, so a third-party adapter proves itself by passing our published tests. This is what makes "storage-agnostic" true rather than aspirational; without it the claim is marketing.
- The default in-memory adapter is a reference implementation and test substrate, documented as non-durable and single-process. There is no hosted default, ever.

### 5. Dependencies

**The default answer is no.** Every runtime dependency is a liability we hand to the adopter: install weight, transitive CVEs, version conflicts in their tree, supply-chain surface, and a license we imposed without asking. `@dodcorp/webhooks` targets **zero runtime dependencies**; Node built-ins (`node:crypto`) beat userland every time.

Adding one requires *all* of:

1. It does something we would get materially wrong ourselves — crypto primitives, spec parsers. Convenience is not a reason.
2. No transitive runtime dependencies of its own, or a small tree we have actually read.
3. Maintained, permissively licensed (MIT/ISC/Apache-2.0), typed, ESM-compatible, no install scripts.
4. It sits behind our own interface and never appears in our public types, so we can drop it in a minor.
5. The PR names the alternatives considered and the cost of writing it ourselves, and gets maintainer sign-off. A new *transitive* dependency counts as a new dependency.

Adapters take an already-configured client (`createPostgresAdapter({ client })`) rather than depending on the driver; where a driver dependency is genuinely unavoidable it is a `peerDependency`, never a `dependency`. Dev dependencies get a looser bar but still gate CI: lockfile committed, versions pinned, no unreviewed postinstall scripts.

### 6. TypeScript

`tsconfig.base.json` is the enforcement point and every package extends it unmodified — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `useUnknownInCatchVariables`. Additionally:

- **No `any` in a public surface.** `unknown` at the boundary, narrowed inside. Lint-enforced, and a `// eslint-disable` for it needs a linked issue and a reviewer.
- **Exported functions declare their return types explicitly.** Inference is how a surface silently widens during a refactor.
- **No `enum`** — string-literal unions. Enums carry runtime weight and nominal-typing surprises across package boundaries.
- **ESM only**, Node >= 20.11, `.d.ts` shipped and validated in CI.
- **No `@ts-ignore`.** `@ts-expect-error` only with a linked issue.

## Enforcement

Words in an ADR are not a standard; CI is. Every rule above lands as a check, in priority order:

1. **A committed `api-report.md`** — any public-surface change shows up as a reviewable diff, making §3 classification mechanical rather than remembered. This is the highest-leverage check here.
2. Lint rules for `any`, deep imports, and explicit return types.
3. `publint` + `are-the-types-wrong` on the built package.
4. The adapter conformance suite (§4).

Anything not yet automated is tracked as a bootstrap follow-up, not treated as done.

## Consequences

We move slower per feature and write more ourselves; zero-dependency means occasionally reimplementing something and sometimes getting it wrong first try. Interfaces adopters implement become nearly frozen, front-loading design cost onto DOD-4. Some prospects will ask for a hosted version and the answer is no — §0 exists so that stays true when the request is tempting rather than hypothetical.

In exchange, adopters get a package they can read in an afternoon, upgrade without fear, and run entirely inside their own infrastructure. That is the only reason to pick us over Svix.
