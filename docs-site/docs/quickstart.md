# Quickstart

## Clone and install

```bash
git clone https://github.com/pyrfor-org/pyrfor.git
cd pyrfor
pnpm install
pnpm test
```

## Run the engine

```bash
pnpm runtime:dev
```

In another terminal:

```bash
pnpm cli:build
node packages/cli/dist/index.js concept "Hello from docs" --json
```

## npm install (published engine)

When `@pyrfor/engine` is published:

```bash
npx @pyrfor/engine concept "hello" --version
```

Requires `NPM_TOKEN` in CI for maintainers to publish — see [Release guide](https://github.com/pyrfor-org/pyrfor/blob/main/docs/RELEASE.md).
