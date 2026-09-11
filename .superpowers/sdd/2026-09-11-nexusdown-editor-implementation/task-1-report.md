# Task 1 Report

Status: DONE_WITH_CONCERNS

## Commit

Implementation commit: d5e54a303f86712a290e32200f612a5b202854fb

## Changes

- Initialized the `nexusdown` ESM package metadata and subpath exports.
- Added TypeScript, Vitest, and tsup configuration plus an initial fixture.
- Added empty type-only core, Vue, and root entry points.
- Installed the requested Tiptap, Vue, Iconify, and test/build dependencies.
- Declared Vue as a peer dependency and development dependency so it is not bundled for consumers.

## Verification

- `npm run typecheck`: PASS; `tsc -p tsconfig.json --noEmit` completed without diagnostics.
- `npm test -- --passWithNoTests`: PASS; Vitest started successfully and exited 0 with no test files.
- `npm pack --dry-run`: PASS; package contents were listed and the dry-run completed.
- `git diff --check`: PASS; no whitespace errors reported.
- `npm run pack:check`: CONCERN; JavaScript bundling succeeds, but tsup declaration generation fails in `rollup-plugin-dts` with `TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')` under TypeScript 7.0.2.

## Concerns

- npm emitted `EBADENGINE` warnings for `nopt` and `abbrev` because the installed Node version is `v24.13.0` while those packages require a newer Node 24 patch line or Node 22.22.2+.
- npm audit reports 1 low-severity vulnerability.
- The `pack:check` declaration-generation incompatibility should be resolved by a later dependency/configuration task before relying on the package build pipeline.

## P1 Review Fix Verification (2026-09-11)

- `npm run build`: PASS; tsup 8.5.1 completed ESM, CJS, and DTS builds. Generated `dist/index.d.ts`, `dist/core/index.d.ts`, `dist/vue/index.d.ts` and corresponding `.d.cts` files.
- `npm run pack:check`: PASS; build and dry-run packaging completed successfully.
- `npm pack --dry-run --json`: PASS; 14 files listed, limited to `package.json` and `dist/**`; `dist/style.css` and every export target were present.
- `git diff --check`: PASS; no whitespace errors reported.

The TypeScript 7 declaration crash was fixed by pinning TypeScript to `5.7.3`. The package now uses `files: ["dist"]`, and tsup copies `public/style.css` into `dist/style.css` through `publicDir`.

Review fix commit: 58a20d807fd972f689aef97a6b6c910ba4ab5091
