# Stage 1: Build & Generate Prisma Client
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. sharp)
RUN apk add --no-cache python3 make g++

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
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV ADMIN_PORT=4001

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 expressjs

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

USER expressjs

EXPOSE 4001

CMD ["node", "dist/src/main.js"]

