## Build stage
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /tmp/prod_modules
RUN npm ci

COPY . .
RUN npm run build

## Production stage
FROM node:22-slim

WORKDIR /app

# No docker.io, no build-essential — multi-tenant doesn't need them
COPY --from=builder /tmp/prod_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/migrations ./migrations

EXPOSE 4000

CMD ["npm", "start"]
