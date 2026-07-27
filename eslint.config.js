// Shared flat ESLint config for every package in the monorepo.
// Type-aware rules are scoped to package source; config/scripts get the
// non-type-aware baseline so they don't need to live in a tsconfig project.
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ADR-0001 §1: `src/index.ts` is the entire public API and `package.json#exports`
// declares "." and "./package.json" only. Reaching past a package's entry point
// couples a consumer to layout we are free to change in a patch.
//
// This covers bare specifiers (`@dodcorp/webhooks/dist/internal.js`). The
// relative form (`../../other-package/src/x.js`) is already blocked by the
// compiler: each package sets `rootDir: ./src`, so a file from a sibling
// package cannot enter the program at all.
const NO_DEEP_IMPORTS = {
  patterns: [
    {
      group: ['@dodcorp/*/*', '@dodcorp/*/**'],
      message:
        'Deep imports are not part of the public API (ADR-0001 §1). Import the package root; if you need something it does not export, export it from that package’s src/index.ts.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.tsbuild/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  comments.recommended,
  {
    // ADR-0001 §6 says an `any` escape hatch "needs a linked issue and a
    // reviewer". A rule that can be turned off with a bare one-line comment is
    // not enforced, so every disable directive must say why in writing — that
    // is the artefact a reviewer actually responds to.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: ['eslint-enable'] },
      ],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // --- ADR-0001 §6: TypeScript conventions -------------------------------
      // `no-explicit-any` and the `@ts-ignore` half of `ban-ts-comment` already
      // come from tseslint's recommended set; the rest of §6 lands here.

      // "Exported functions declare their return types explicitly. Inference is
      // how a surface silently widens during a refactor."
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // "No `enum` — string-literal unions. Enums carry runtime weight and
      // nominal-typing surprises across package boundaries."
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message:
            'Enums are banned (ADR-0001 §6). Use a string-literal union, which has no runtime weight and no nominal-typing surprises across package boundaries.',
        },
      ],

      // "No `@ts-ignore`. `@ts-expect-error` only with a linked issue."
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],

      'no-restricted-imports': ['error', NO_DEEP_IMPORTS],

      // --- ADR-0001 §1: public API surface -----------------------------------
      // "Observability is a hook, not a dependency: ... We never pick the
      // adopter's logger and never write to `console`."
      'no-console': 'error',
    },
  },
  {
    // ADR-0001 §1: "everything else lives in `src/internal/` and may never
    // appear in a public type signature". Re-exporting from the entry point is
    // the most direct way for that to happen — if something belongs in the
    // public API it does not belong under internal/.
    files: ['packages/*/src/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...NO_DEEP_IMPORTS,
          patterns: [
            ...NO_DEEP_IMPORTS.patterns,
            {
              group: ['./internal/*', './internal/**'],
              message:
                'src/index.ts must not re-export from src/internal/ (ADR-0001 §1). Anything reachable from the entry point is public and bound by §3 semver, so it belongs outside internal/.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests are not a published surface: they may narrate with `console`, and
    // fixtures legitimately reach for `any` to construct invalid input that the
    // public types are designed to reject.
    files: ['packages/*/src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Config files and release scripts: syntax-level linting only. These run
    // directly on Node, so they need the Node globals declared.
    files: ['*.js', '*.ts', 'scripts/**/*.mjs', 'packages/*/tsup.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
