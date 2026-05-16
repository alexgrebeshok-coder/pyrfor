# Contributing to Pyrfor

Thank you for helping improve Pyrfor.

## Repository

Clone the canonical upstream:

```bash
git clone https://github.com/alexgrebeshok-coder/pyrfor.git
cd pyrfor
```

## Development setup

From the repository root (targets **under ~10 minutes** on a typical machine):

```bash
pnpm install
pnpm test
```

Use Node versions compatible with the repo’s toolchain (see CI workflows).

## Releases

Maintainers: see [`docs/RELEASE.md`](docs/RELEASE.md) for npm (`NPM_TOKEN`), Tauri signing, and notarization checklists.

## Workflow

1. Create a **feature branch** from `main`.
2. Open a **pull request** with a clear description.
3. Request **review** from maintainers.
4. After approval, changes are **merged to `main`**.

## Commits

Use **[Conventional Commits](https://www.conventionalcommits.org/)** (for example `feat:`, `fix:`, `docs:`, `chore:`) so history and automation stay readable.

## Tests

All tests touched by your change must pass before merge:

```bash
pnpm test
```

CI should remain green. Fix failures rather than disabling checks.

## Publishing npm packages

This repository is a **monorepo**. **`npm publish` targets `packages/engine` only** (`@pyrfor/engine`). Do **not** publish from the repository root even if the root `package.json` is public — that avoids accidentally shipping the entire workspace as one package.

The `@pyrfor/cli` package is released as needed alongside engine via changesets; consumers installing `@pyrfor/engine` get the CLI dependency required for gateway-oriented commands.

**Note:** `pnpm install` may warn about a cyclic workspace link between `@pyrfor/engine` and `@pyrfor/cli`. That is intentional so the `pyrfor` binary can route Universal CLI commands while the CLI keeps importing engine helpers; npm publishing still works.

## Code of conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
