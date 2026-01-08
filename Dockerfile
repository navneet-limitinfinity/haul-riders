# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app

# Install only production dependencies for a smaller image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
