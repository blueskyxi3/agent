FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY apps apps
COPY packages packages
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    AGENT_HOST=0.0.0.0 \
    AGENT_PORT=3100 \
    AGENT_DATA_DIR=/data/agent \
    AGENT_SQLITE_PATH=/data/agent/agent.sqlite \
    AGENT_ASSETS_DIR=/app/apps/web/dist

WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
RUN mkdir -p /data/agent && chown -R node:node /data/agent /app
RUN mkdir -p /data/plugin && chown 10001:10001 /data/plugin

USER node
EXPOSE 3100
VOLUME ["/data/agent"]
CMD ["node", "apps/server/dist/app.js"]
