# One image, two commands (like automation-runner): web (default CMD) and worker.
# Based on Playwright's image: Chromium and its system libraries for the review browser,
# plus git for checking out pull request branches. Claude Code comes with the Agent SDK
# (platform package installed by pnpm), no global install needed.

# ---- Base ----------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS base
ENV PNPM_HOME=/pnpm \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- Build ---------------------------------------------------------------
FROM base AS build
# Dependencies first for layer caching: fetch only needs the lockfile.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
# Shown nowhere yet, but handy in `kubectl exec ... env` and the image labels.
ARG GIT_SHA=
ARG GIT_REF=
ENV GIT_SHA=$GIT_SHA \
    GIT_REF=$GIT_REF
RUN pnpm --filter @claudio/web build

# ---- Runtime -------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Europe/Berlin \
    CLAUDIO_ROOT=/app \
    CLAUDIO_RUNS_DIR=/data/runs
# The worker runs the TypeScript sources with tsx, so the installed workspace is kept as is.
COPY --from=build --chown=1001:1001 /app /app
RUN mkdir -p /data/runs && chown -R 1001:1001 /data
USER 1001
EXPOSE 3000
# Web (default). Worker: node_modules/.bin/tsx apps/worker/src/main.ts
# Migrations:      node_modules/.bin/tsx packages/db/src/migrate.ts
CMD ["node", "apps/web/build"]
