#!/bin/bash
set -e

echo "🐯 Tiger Claw container starting..."
echo "   Tenant: ${TENANT_NAME:-unknown}"
echo "   Language: ${PREFERRED_LANGUAGE:-en}"

# Create OpenClaw config directory
mkdir -p /root/.openclaw

# Generate openclaw.json from environment variables
cat > /root/.openclaw/openclaw.json << EOF
{
  "gateway": {
    "port": ${OPENCLAW_PORT:-18789},
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN:-dev-token}"
    }
  },
  "agent": {
    "model": "${AI_MODEL:-claude-haiku-4-5-20251001}",
    "anthropicApiKey": "${ANTHROPIC_API_KEY:-}"
  },
  "channels": {
    "telegram": {
      "enabled": ${TELEGRAM_ENABLED:-false},
      "token": "${TELEGRAM_BOT_TOKEN:-}"
    },
    "line": {
      "enabled": ${LINE_ENABLED:-false},
      "channelSecret": "${LINE_CHANNEL_SECRET:-}",
      "channelAccessToken": "${LINE_CHANNEL_ACCESS_TOKEN:-}"
    }
  },
  "skills": {
    "entries": {
      "tiger-claw": {
        "enabled": true,
        "env": {
          "TIGER_CLAW_API_URL": "${TIGER_CLAW_API_URL:-http://host.docker.internal:4000}",
          "TIGER_CLAW_TENANT_ID": "${TENANT_ID:-dev-tenant-001}",
          "PREFERRED_LANGUAGE": "${PREFERRED_LANGUAGE:-en}",
          "BOT_FLAVOR": "${BOT_FLAVOR:-network-marketer}",
          "REGION": "${REGION:-us-en}"
        }
      }
    }
  },
  "cron": {
    "daily-scout": {
      "schedule": "${SCOUT_CRON_SCHEDULE:-0 12 * * *}",
      "tool": "tiger_scout"
    },
    "daily-report": {
      "schedule": "${REPORT_CRON_SCHEDULE:-0 14 * * *}",
      "tool": "tiger_briefing",
      "args": { "send": true }
    },
    "nurture-check": {
      "schedule": "0 */1 * * *",
      "tool": "tiger_nurture",
      "args": { "mode": "check" }
    },
    "contact-check": {
      "schedule": "30 */1 * * *",
      "tool": "tiger_contact",
      "args": { "mode": "check" }
    },
    "aftercare-check": {
      "schedule": "0 15 * * *",
      "tool": "tiger_aftercare",
      "args": { "mode": "daily" }
    }
  }
}
EOF

echo "   Config generated at /root/.openclaw/openclaw.json"
echo "🐯 Starting OpenClaw gateway..."

exec openclaw gateway --port ${OPENCLAW_PORT:-18789} --verbose
