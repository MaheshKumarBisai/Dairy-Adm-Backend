# Stage 1: Build & Generate Prisma Client
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Generate Prisma Client
RUN npx prisma generate

COPY . .

# Build TypeScript to dist/
RUN npm run build

# Remove development dependencies
RUN npm prune --production

# Stage 2: Production Runner
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV ADMIN_PORT=4001

# Security: non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs expressjs

# Pre-create uploads directory with proper ownership so non-root expressjs can write
RUN mkdir -p /app/uploads && chown -R expressjs:nodejs /app/uploads

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

USER expressjs

EXPOSE 4001

CMD ["node", "dist/main.js"]

