FROM node:22-slim

WORKDIR /app

# Install dependencies needed for native modules and docker socket
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and Prisma (if any)
COPY . .

# Build the project
RUN npm run build

EXPOSE 4000

CMD ["npm", "start"]
