# Repository Guidelines

## Project Structure & Module Organization

VeloCity is a React 19 and Vite dashboard for exploring Toronto cycling-corridor scenarios. Application entry points and UI live in `src/` (`main.tsx`, `App.tsx`, `TorontoMap.tsx`), while scoring, simulation, and artifact parsing are grouped under `src/lib/`. Static corridor fixtures are in `src/data/`; deployable JSON and GeoJSON artifacts belong in `public/data/`. Data schemas, provenance, and source metadata live in `data/`, and ingestion/validation utilities are in `scripts/`. Keep large downloads in the ignored `data/raw/` directory.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies.
- `npm run dev` starts the local Vite development server.
- `npm run build` type-checks the project and creates `dist/`.
- `npm run lint` runs ESLint across TypeScript and React files.
- `node --experimental-strip-types --test src/lib/*.test.ts` runs the TypeScript tests with Node 22.
- `npm run data:validate` validates committed public data against project rules.
- `npm run preview` serves the production build locally.

Use `npm run data:fetch` and `npm run data:prepare:bike-share` only when updating source data; these may download or process large files.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and descriptive domain names such as `simulateCorridor`. Keep reusable domain logic in `src/lib/`, not in UI components. ESLint, TypeScript strict checks, and React Hooks rules are the source of truth.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name files `*.test.ts` beside the tested module and write behavior-focused test names. Cover scoring boundaries, malformed runtime data, deterministic simulations, and artifact fallback behavior. Before submitting changes, run tests, lint, data validation, and the production build.

## Commit & Pull Request Guidelines

Recent history favors short, imperative subjects, sometimes with Conventional Commit prefixes (for example, `feat: add simulation and corridor scoring engine`). Prefer `feat:`, `fix:`, `docs:`, or `data:` when applicable. Keep commits scoped. Pull requests should explain the user-visible or data-contract impact, link relevant issues, list verification commands, and include screenshots for UI changes. Announce schema changes before merge; never commit raw archives or push directly to `main`.
