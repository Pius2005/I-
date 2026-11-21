# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Iṣẹ́ — production image (API + built SPA served by Express)
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate --schema server/prisma/schema.prisma \
    && npm run build -w server \
    && npm run build -w client

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 ise

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /app/server/uploads && chown -R ise:ise /app
USER ise
WORKDIR /app/server

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are applied on boot; the seed is a separate one-off command.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/src/index.js"]
