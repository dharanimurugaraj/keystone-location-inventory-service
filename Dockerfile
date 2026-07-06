# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./
COPY prisma ./prisma/

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

# Copy dependency manifests and install production deps only
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev

RUN npm run prisma:generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
