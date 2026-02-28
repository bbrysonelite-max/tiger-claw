# Tiger Claw — Per-Tenant Container
# This is the SAME image used in dev and production.
# OpenClaw is installed at a pinned version.
# Tiger Claw skills are pre-installed.

FROM node:22-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw at pinned version
# TODO: Pin to specific tested commit hash before launch
RUN npm i -g openclaw

# Create workspace structure
RUN mkdir -p /root/.openclaw/workspace/skills/tiger-claw

# Copy Tiger Claw skills into the container
COPY skill/ /root/.openclaw/workspace/skills/tiger-claw/

# Copy entrypoint
COPY docker/customer/entrypoint.sh /root/entrypoint.sh
RUN chmod +x /root/entrypoint.sh

# OpenClaw gateway port
EXPOSE 18789

ENTRYPOINT ["/root/entrypoint.sh"]
