#!/bin/bash
# Tiger Claw — Per-Tenant Container Entrypoint
# Generates openclaw.json from environment variables.
# Implements four-layer key management per Block 1.7 + Block 4.
# Computes timezone-aware cron schedules per Block 5.1 / Block 6.
set -e

echo "🐯 Tiger Claw container starting..."
echo "   Tenant:   ${TENANT_NAME:-unknown}"
echo "   Language: ${PREFERRED_LANGUAGE:-en}"
echo "   Flavor:   ${BOT_FLAVOR:-network-marketer}"
echo "   Region:   ${REGION:-us-en}"

# ── Directory setup ──────────────────────────────────────────────────────────
DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
mkdir -p /root/.openclaw

KEY_STATE_FILE="${DATA_DIR}/key_state.json"

# ── Four-layer key resolution ────────────────────────────────────────────────
# Block 1.7 / Block 4: Four layers (LOCKED):
#   Layer 1 — PLATFORM_ONBOARDING_KEY  (Tiger Claw's, 50 msgs, 72h expiry)
#   Layer 2 — TENANT_PRIMARY_KEY        (tenant's, no TC limit)
#   Layer 3 — TENANT_FALLBACK_KEY       (tenant's, 20 msgs/day)
#   Layer 4 — PLATFORM_EMERGENCY_KEY    (Tiger Claw's, 5 msgs then pause)
#
# Priority at startup:
#   1. Read key_state.json to find activeLayer and any persisted layer2Key/layer3Key.
#   2. For layers 2+3, prefer the key stored in key_state.json (written by
#      tiger_keys restore_key action). Fall back to env var if not stored yet.
#   3. For layers 1+4, always use env vars (platform-controlled keys).
#   4. If no key_state.json exists, container is in fresh onboarding mode → Layer 1.

resolve_key_state() {
  # Outputs: ACTIVE_LAYER ACTIVE_KEY ACTIVE_PROVIDER
  # Uses node (guaranteed available in node:22-slim image).
  node - << 'JSEOF'
const fs = require('fs');

const stateFile = process.env.DATA_DIR
  ? `${process.env.DATA_DIR}/key_state.json`
  : '/app/data/key_state.json';

// Four layer key env vars
const L1 = process.env.PLATFORM_ONBOARDING_KEY || '';
const L2_env = process.env.TENANT_PRIMARY_KEY || '';
const L3_env = process.env.TENANT_FALLBACK_KEY || '';
const L4 = process.env.PLATFORM_EMERGENCY_KEY || '';

let activeLayer = 1;
let layer2Key = L2_env;
let layer3Key = L3_env;

// Read persisted state if it exists
try {
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    activeLayer = state.activeLayer || 1;
    // Prefer persisted key values (written by tiger_keys restore_key)
    // over env vars — they reflect what the tenant actually entered during onboarding.
    if (state.layer2Key) layer2Key = state.layer2Key;
    if (state.layer3Key) layer3Key = state.layer3Key;
    // If tenant is paused, still start up (skill layer handles the paused state).
  }
} catch (e) {
  // Corrupted state — safe default to Layer 1 (onboarding mode)
  activeLayer = 1;
  process.stderr.write(`[entrypoint] WARNING: key_state.json unreadable, defaulting to Layer 1: ${e}\n`);
}

// Pick the active key for this layer
const keyMap = { 1: L1, 2: layer2Key, 3: layer3Key, 4: L4 };
const activeKey = keyMap[activeLayer] || L1 || '';

// Detect provider from key prefix (mirrors tiger_keys.ts detectProvider)
let provider = 'anthropic';
if (activeKey.startsWith('sk-ant-')) provider = 'anthropic';
else if (activeKey.startsWith('sk-')) provider = 'openai';
// Platform keys (layers 1+4) are always Anthropic

// Select model: layers 1+4 use cheapest model; layers 2+3 use tenant's configured model
const cheapModel = process.env.PLATFORM_CHEAP_MODEL || 'claude-haiku-4-5-20251001';
const primaryModel = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : cheapModel);
const model = (activeLayer === 1 || activeLayer === 4) ? cheapModel : primaryModel;

process.stdout.write(JSON.stringify({ activeLayer, activeKey, provider, model }));
JSEOF
}

KEY_JSON="$(resolve_key_state)"

ACTIVE_LAYER="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).activeLayer))" "$KEY_JSON")"
ACTIVE_KEY="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).activeKey)" "$KEY_JSON")"
ACTIVE_PROVIDER="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).provider)" "$KEY_JSON")"
ACTIVE_MODEL="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).model)" "$KEY_JSON")"

echo "   Key layer: ${ACTIVE_LAYER} (${ACTIVE_PROVIDER})"

if [ -z "$ACTIVE_KEY" ]; then
  echo "   ⚠️  WARNING: No API key available for Layer ${ACTIVE_LAYER}."
  echo "              Bot will start but LLM calls will fail until a key is provided."
fi

# Build the provider-specific API key field for openclaw.json
if [ "$ACTIVE_PROVIDER" = "openai" ]; then
  API_KEY_FIELD='"openaiApiKey": "'"$ACTIVE_KEY"'"'
else
  API_KEY_FIELD='"anthropicApiKey": "'"$ACTIVE_KEY"'"'
fi

# ── Timezone-aware cron schedule computation ─────────────────────────────────
# Block 5.1 LOCKED: Daily scout at 5 AM tenant timezone.
# Block 5.1 LOCKED: Daily report at 7 AM tenant timezone.
# OpenClaw cron runs in the process timezone (TZ env var). However, to guarantee
# correct behavior regardless of how OpenClaw handles TZ, we compute UTC equivalents
# using Node's Intl API and express schedules in UTC.

TENANT_TIMEZONE="${TENANT_TIMEZONE:-${TZ:-UTC}}"

compute_utc_cron() {
  # Usage: compute_utc_cron <local_hour> <minute> <timezone>
  # Outputs a UTC cron expression: "minute utc_hour * * *"
  local local_hour="$1"
  local minute="$2"
  local tz="$3"
  node -e "
    const tz = '$tz';
    const localHour = $local_hour;
    const minute = $minute;
    try {
      // Use a reference date (not DST-transition date) to get stable offset
      const ref = new Date('2024-01-15T12:00:00Z');
      // Get local hour for this reference date in the tenant timezone
      const localParts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', hour12: false
      }).formatToParts(ref);
      const localRefHour = parseInt(localParts.find(p => p.type === 'hour').value);
      const utcRefHour = ref.getUTCHours(); // 12
      // offset = localRefHour - utcRefHour  (positive = ahead of UTC)
      const offsetHours = localRefHour - utcRefHour;
      const utcHour = ((localHour - offsetHours) + 24) % 24;
      process.stdout.write(minute + ' ' + utcHour + ' * * *');
    } catch (e) {
      // Timezone unrecognized — fall back to treating local == UTC
      process.stdout.write(minute + ' ' + localHour + ' * * *');
    }
  " 2>/dev/null || echo "${minute} ${local_hour} * * *"
}

# LOCKED schedules (Block 5.1 / Block 3.6):
#   Scout:    5:00 AM tenant timezone
#   Report:   7:00 AM tenant timezone
#   Aftercare: 8:00 AM tenant timezone
SCOUT_CRON="${SCOUT_CRON_SCHEDULE:-$(compute_utc_cron 5 0 "$TENANT_TIMEZONE")}"
REPORT_CRON="${REPORT_CRON_SCHEDULE:-$(compute_utc_cron 7 0 "$TENANT_TIMEZONE")}"
AFTERCARE_CRON="${AFTERCARE_CRON_SCHEDULE:-$(compute_utc_cron 8 0 "$TENANT_TIMEZONE")}"

echo "   Timezone: ${TENANT_TIMEZONE}"
echo "   Scout cron:    ${SCOUT_CRON} (UTC)"
echo "   Report cron:   ${REPORT_CRON} (UTC)"
echo "   Aftercare cron: ${AFTERCARE_CRON} (UTC)"

# ── Channel enablement ───────────────────────────────────────────────────────
# Auto-enable channels based on which credentials are present.
TELEGRAM_ENABLED="false"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then TELEGRAM_ENABLED="true"; fi

LINE_ENABLED="false"
if [ -n "${LINE_CHANNEL_SECRET:-}" ] && [ -n "${LINE_CHANNEL_ACCESS_TOKEN:-}" ]; then
  LINE_ENABLED="true"
fi

# ── Generate openclaw.json ───────────────────────────────────────────────────
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
    "model": "${ACTIVE_MODEL}",
    ${API_KEY_FIELD}
  },
  "channels": {
    "telegram": {
      "enabled": ${TELEGRAM_ENABLED},
      "token": "${TELEGRAM_BOT_TOKEN:-}"
    },
    "line": {
      "enabled": ${LINE_ENABLED},
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
          "TIGER_CLAW_HIVE_TOKEN": "${TIGER_CLAW_HIVE_TOKEN:-}",
          "PREFERRED_LANGUAGE": "${PREFERRED_LANGUAGE:-en}",
          "BOT_FLAVOR": "${BOT_FLAVOR:-network-marketer}",
          "REGION": "${REGION:-us-en}",
          "DATA_DIR": "${DATA_DIR:-/app/data}",
          "ENCRYPTION_KEY": "${ENCRYPTION_KEY:-}",
          "PLATFORM_ONBOARDING_KEY": "${PLATFORM_ONBOARDING_KEY:-}",
          "TENANT_PRIMARY_KEY": "${TENANT_PRIMARY_KEY:-}",
          "TENANT_FALLBACK_KEY": "${TENANT_FALLBACK_KEY:-}",
          "PLATFORM_EMERGENCY_KEY": "${PLATFORM_EMERGENCY_KEY:-}",
          "PLATFORM_CHEAP_MODEL": "${PLATFORM_CHEAP_MODEL:-claude-haiku-4-5-20251001}"
        }
      }
    }
  },
  "cron": {
    "daily-scout": {
      "schedule": "${SCOUT_CRON}",
      "tool": "tiger_scout"
    },
    "daily-report": {
      "schedule": "${REPORT_CRON}",
      "tool": "tiger_briefing",
      "args": { "action": "generate" }
    },
    "nurture-check": {
      "schedule": "0 * * * *",
      "tool": "tiger_nurture",
      "args": { "action": "check" }
    },
    "contact-check": {
      "schedule": "30 * * * *",
      "tool": "tiger_contact",
      "args": { "action": "check" }
    },
    "aftercare-check": {
      "schedule": "${AFTERCARE_CRON}",
      "tool": "tiger_aftercare",
      "args": { "action": "daily" }
    }
  }
}
EOF

echo "   Config written to /root/.openclaw/openclaw.json"
echo "🐯 Starting OpenClaw gateway on port ${OPENCLAW_PORT:-18789}..."

exec openclaw gateway --port "${OPENCLAW_PORT:-18789}" --verbose
