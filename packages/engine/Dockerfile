# =============================================================================
# Pyrfor Runtime — Dockerfile (multi-stage)
#
# Build context: REPO ROOT (required for pnpm-lock.yaml and workspace files)
#   docker build -f packages/engine/Dockerfile .
#   docker build -f packages/engine/Dockerfile -t pyrfor:latest .
#
# ESM NOTE:
#   packages/engine uses "moduleResolution": "bundler" + "module": "esnext".
#   tsc emits valid ES modules but WITHOUT .js extensions on relative imports,
#   which breaks bare-Node ESM resolution (ERR_MODULE_NOT_FOUND).
#   The runtime stage therefore executes the compiled output via `tsx`
#   (esbuild-backed loader) which resolves bare specifiers transparently.
#   No source-code changes are required.
#
#   If you ever switch tsconfig to "moduleResolution": "node16" or "nodenext",
#   tsc will emit .js extensions and `node dist/runtime/cli.js` will work
#   directly — at that point you can replace the CMD below with:
#     CMD ["node", "dist/runtime/cli.js", "--telegram", "--config", "/etc/pyrfor/runtime.json"]
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — deps: enable pnpm, install all workspace dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

# Enable corepack and activate pnpm (version pinned to latest stable)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root manifest and lockfile first (maximises layer-cache reuse)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy every package.json so pnpm can resolve the full workspace graph.
# These files are tiny and change rarely; adding them before any source
# files keeps dependency layers cached across source-only rebuilds.
COPY packages/engine/package.json     ./packages/engine/
COPY packages/business/package.json   ./packages/business/
COPY packages/freeclaude/package.json ./packages/freeclaude/
COPY packages/ochag/package.json      ./packages/ochag/
COPY packages/ui/package.json         ./packages/ui/

# Install engine + its transitive workspace deps (prod + dev, needed for build)
RUN pnpm install --frozen-lockfile --filter @ceoclaw/engine...

# -----------------------------------------------------------------------------
# Stage 2 — build: compile TypeScript → dist/
# -----------------------------------------------------------------------------
FROM deps AS build

WORKDIR /app

# Copy base TypeScript configuration (extended by packages/engine/tsconfig.json)
COPY tsconfig.base.json ./

# Copy engine tsconfig and all source files
COPY packages/engine/tsconfig.json ./packages/engine/
COPY packages/engine/src            ./packages/engine/src/

# Compile: outDir is ./dist per packages/engine/tsconfig.json, noEmit is not set.
# Output lands at packages/engine/dist/ relative to WORKDIR (/app).
#
# NOTE: emitted JS uses ESM bare imports — see top-level ESM NOTE.
RUN pnpm --filter @ceoclaw/engine run build

# -----------------------------------------------------------------------------
# Stage 3 — runtime: lean production image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# System utilities:
#   ffmpeg — audio pre-processing for voice transcription
#   wget   — used by the HEALTHCHECK probe below
#
# voice-local (on-device whisper transcription) requires a locally compiled
# whisper.cpp binary. This is NOT available via apk and must be set up
# manually. See: https://github.com/ggerganov/whisper.cpp
RUN apk add --no-cache ffmpeg wget

# Install tsx globally so it is available on PATH.
# tsx (esbuild-backed) correctly resolves ESM bare-specifier imports that tsc
# emits when "moduleResolution" is "bundler" — see top-level ESM NOTE.
RUN npm install --global tsx

WORKDIR /app

# ---------------------------------------------------------------------------
# Copy artefacts from previous stages
# ---------------------------------------------------------------------------

# pnpm hoists all packages into /app/node_modules (the .pnpm virtual store).
# Copying the root node_modules preserves internal symlinks and the store,
# so all runtime imports resolve correctly from any subdirectory.
COPY --from=deps  /app/node_modules               ./node_modules

# Compiled engine output (dist/) produced by tsc in the build stage
COPY --from=build /app/packages/engine/dist        ./packages/engine/dist

# package.json files needed for Node module-resolution heuristics
COPY --from=deps  /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=deps  /app/package.json                 ./package.json

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

# Gateway HTTP port
EXPOSE 18790

# /etc/pyrfor      — config volume; mount your runtime.json here
#                   e.g. -v $(pwd)/pyrfor-config:/etc/pyrfor
# /var/lib/pyrfor  — session-store volume (Linux FHS convention)
#                   e.g. -v $(pwd)/pyrfor-data:/var/lib/pyrfor
#
# Override the sessions directory at runtime via the PYRFOR_SESSIONS_PATH
# environment variable without remounting the volume:
#   docker run -e PYRFOR_SESSIONS_PATH=/mnt/nfs/sessions ...
VOLUME ["/etc/pyrfor", "/var/lib/pyrfor"]
ENV PYRFOR_SESSIONS_PATH=/var/lib/pyrfor

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:18790/ping || exit 1

# Set working directory to the engine package so relative paths resolve cleanly
WORKDIR /app/packages/engine

CMD ["tsx", "dist/runtime/cli.js", "--telegram", "--config", "/etc/pyrfor/runtime.json"]
