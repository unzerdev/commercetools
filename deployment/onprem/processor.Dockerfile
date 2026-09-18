# Production image for the processor (Fastify service). Multi-stage: a full-dependency build stage
# compiles TypeScript to dist/, then a minimal runtime stage installs prod-only deps and runs the
# compiled server as the non-root `node` user on 8080.
#
# NODE_IMAGE is an ARG so the runbook's pin-digests step can pass an immutable `node@sha256:...`.
# No secret is ever an ARG or baked in — all runtime config arrives via the env file.

ARG NODE_IMAGE=node:22.14.0-alpine3.21

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Install with the lockfile against a clean tree, then compile. package*.json first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Prod-only dependencies — no devDependencies, no build toolchain in the runtime image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Drop to the image's built-in unprivileged user.
USER node
EXPOSE 8080

# Liveness: any HTTP response (even the JWT-guarded 401) proves the server is listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/operations/status',r=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
