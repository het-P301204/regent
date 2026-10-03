# syntax=docker/dockerfile:1.7
#
# REGENT production image: the API serves the built console from one origin.
# Node 24 runs the TypeScript sources directly (type stripping), so there is no
# server compile step. Pin the base image by digest in your registry mirror.

ARG NODE_IMAGE=node:24.18-alpine3.22

# ---- build: install everything, build the web console ----------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN npm run build -w @regent/web

# ---- runtime: production dependencies only, non-root ----------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    REGENT_WEB_DIST=/app/apps/web/dist \
    REGENT_DATA_DIR=/data/pglite
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY apps/cli apps/cli
COPY database database
COPY scenarios scenarios
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/src/index.ts", "--production"]
