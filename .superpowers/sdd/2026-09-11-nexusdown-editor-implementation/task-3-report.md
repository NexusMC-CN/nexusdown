# Task 3 Report: Framework-agnostic toolbar command model

## Result

Implemented and committed as `f593c3c` (`feat: add extensible toolbar command model`).

## Changes

- Added `ToolbarGroup`, `ToolbarCommand`, `ToolbarSession`, `ToolbarContext`, and `ToolbarItem` contracts in `src/core/toolbar.ts`.
- Added `createDefaultToolbarItems()` with 14 stable command IDs, Iconify-compatible `lucide:*` icon names, Chinese labels, and history/block/inline/extension grouping.
- Default items execute only the session command contract. Active and disabled state is derived through the session `isActive()` and `can()` functions.
- Re-exported the toolbar model from `src/core/index.ts`.
- Added focused tests covering stable ordering/metadata, command execution, and active/disabled state.

## Verification

- `npm test -- tests/core/toolbar.test.ts` passed: 3 tests.
- `npm run typecheck` passed.
- `git diff --check` passed.

## TDD evidence

The initial focused test run failed because `src/core/toolbar` did not exist. The implementation was then added and the focused suite passed.
