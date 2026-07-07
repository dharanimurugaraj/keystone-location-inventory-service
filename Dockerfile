# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./
COPY prisma ./prisma/

# Install openssl for Prisma generation
RUN apk add --no-cache openssl

RUN npm ci

# Copy source and build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src/

RUN npm run prisma:generate
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install openssl for Prisma (alpine might need it)
RUN apk add --no-cache openssl

# Copy dependency manifests and install production deps only
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev

# Copy generated Prisma Client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Use non-root user for security
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/main"]
