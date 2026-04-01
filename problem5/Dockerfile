# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json openapi.yaml ./
COPY src ./src
RUN npx tsc

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# openapi.yaml must be at dist/ because __dirname=dist/src → ../openapi.yaml = dist/openapi.yaml
COPY openapi.yaml ./dist/
# Copy static assets (not compiled by tsc)
COPY src/public ./dist/src/public
EXPOSE 3005
VOLUME ["/app/data"]
CMD ["node", "dist/src/server.js"]
