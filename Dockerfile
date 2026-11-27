# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY adapters ./adapters
COPY scripts ./scripts

RUN bun install --frozen-lockfile
RUN bun run check:licenses
RUN bun run build:web

FROM oven/bun:1.3.14 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3456
ENV HOST=0.0.0.0
ENV INKADE_DB_PATH=/data/inkade.db
ENV INKADE_DATA_DIR=/data
ENV INKADE_WEB_DIST_DIR=/app/apps/web/dist

COPY --from=builder /app/package.json /app/bun.lock /app/tsconfig.base.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server ./apps/server
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data

EXPOSE 3456

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3456) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "apps/server/src/index.ts"]
