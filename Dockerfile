FROM node:22-alpine AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build:browser && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
COPY --from=build --chown=1000:1000 /app ./
ARG APP_VERSION=dev
ENV PORT=8080 APP_VERSION=$APP_VERSION NODE_ENV=production
# The node image's "node" user, by number so runAsNonRoot can check it.
USER 1000
EXPOSE 8080
CMD ["node", "--require", "./telemetry.cjs", "server.js"]
