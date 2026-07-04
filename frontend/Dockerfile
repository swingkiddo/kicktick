# syntax=docker/dockerfile:1
# KickTick Frontend — Next.js 14 + Node.js 22
# Build: docker build -t kicktick-frontend .
# Run dev:  docker run --rm -it -v $(pwd):/app -p 3000:3000 kicktick-frontend npm run dev
# Run prod: docker run --rm -it -p 3000:3000 kicktick-frontend npm start

FROM node:22-alpine AS base
WORKDIR /app

# Install build deps
RUN apk add --no-cache libc6-compat

# --- Dependencies stage ---
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- Build stage ---
FROM deps AS builder
COPY . .
RUN npm run build

# --- Dev stage ---
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# --- Prod stage ---
FROM base AS prod
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
EXPOSE 3000
CMD ["npm", "start"]
