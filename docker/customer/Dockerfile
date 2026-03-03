# Tiger Claw — Per-Tenant Container
# This is the SAME image used in dev and production.
# OpenClaw is installed at a pinned version.
# Tiger Claw skills are pre-installed.

FROM node:22-slim

# System dependencies (build-essential + python3 needed for native module compilation)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    curl \
    git \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw at pinned version
ARG OPENCLAW_VERSION=2026.3.2
RUN npm install -g "openclaw@${OPENCLAW_VERSION}"

# Version labels
ARG TC_VERSION=dev
LABEL tc.version="${TC_VERSION}" oc.version="${OPENCLAW_VERSION}"

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
