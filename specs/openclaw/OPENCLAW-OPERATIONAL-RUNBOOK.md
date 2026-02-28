# OpenClaw Operational Runbook

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. SYSTEM OVERVIEW

### 1.1 Component Health Map

```
┌─────────────────────────────────────────────────────────────────┐
│                     OPENCLAW HEALTH DASHBOARD                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  GATEWAY          [●] Running     Port: 18789     Uptime: 5d   │
│  ├── WebSocket    [●] Healthy     Connections: 3               │
│  ├── HTTP         [●] Healthy     Requests/min: 45             │
│  └── Config       [●] Loaded      Last reload: 2h ago          │
│                                                                 │
│  CHANNELS                                                       │
│  ├── WhatsApp     [●] Connected   Messages/hr: 120             │
│  ├── Telegram     [●] Connected   Messages/hr: 85              │
│  ├── Discord      [●] Connected   Messages/hr: 200             │
│  └── Slack        [○] Disabled    --                           │
│                                                                 │
│  PROVIDERS                                                      │
│  ├── Anthropic    [●] Healthy     Latency: 1.2s   Quota: 80%   │
│  ├── OpenAI       [●] Healthy     Latency: 0.9s   Quota: 45%   │
│  └── Google       [◐] Degraded    Latency: 5.2s   Quota: 90%   │
│                                                                 │
│  RESOURCES                                                      │
│  ├── CPU          [●] 15%         Normal                       │
│  ├── Memory       [●] 45%         512MB / 1.1GB                │
│  ├── Disk         [●] 62%         15GB / 24GB                  │
│  └── Sessions     [●] 127         Active: 23                   │
│                                                                 │
│  Legend: [●] Healthy  [◐] Degraded  [○] Disabled  [✕] Critical │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Metrics

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Gateway response time | < 100ms | < 500ms | > 500ms |
| Agent turn latency | < 5s | < 15s | > 15s |
| LLM API latency | < 3s | < 10s | > 10s |
| Error rate | < 1% | < 5% | > 5% |
| Memory usage | < 60% | < 80% | > 80% |
| Disk usage | < 70% | < 85% | > 85% |
| Session count | < 400 | < 450 | > 500 |

---

## 2. STARTUP PROCEDURES

### 2.1 Normal Startup

```bash
# 1. Verify prerequisites
node --version  # Must be >= 22
openclaw --version

# 2. Check configuration
openclaw doctor

# 3. Start gateway (foreground for initial verification)
openclaw gateway --verbose

# 4. Verify health
curl http://127.0.0.1:18789/__openclaw__/health

# 5. If healthy, restart as daemon
openclaw gateway stop
openclaw gateway start

# 6. Verify daemon running
openclaw status
```

### 2.2 First-Time Setup

```bash
# 1. Run onboarding wizard
openclaw onboard --install-daemon

# 2. Configure at least one channel
openclaw channels login  # For WhatsApp
# OR
openclaw config set channels.telegram.botToken "YOUR_TOKEN"

# 3. Configure LLM provider
openclaw config set agents.defaults.model "anthropic/claude-opus-4-6"
# Ensure ANTHROPIC_API_KEY is set in environment

# 4. Start gateway
openclaw gateway start

# 5. Send test message
openclaw agent --message "Hello, are you working?"
```

### 2.3 Post-Upgrade Startup

```bash
# 1. Stop current gateway
openclaw gateway stop

# 2. Upgrade
npm update -g openclaw@latest

# 3. Run migrations
openclaw doctor --fix

# 4. Verify config compatibility
openclaw doctor

# 5. Start gateway
openclaw gateway start

# 6. Verify functionality
openclaw status
openclaw agent --message "Post-upgrade test"
```

---

## 3. SHUTDOWN PROCEDURES

### 3.1 Graceful Shutdown

```bash
# 1. Check for active operations
openclaw sessions list --active

# 2. Wait for in-flight requests (optional)
# Monitor logs for "processing" messages

# 3. Stop gateway gracefully
openclaw gateway stop

# 4. Verify stopped
openclaw status  # Should show "not running"
```

### 3.2 Emergency Shutdown

```bash
# 1. Force stop immediately
openclaw gateway stop --force

# 2. If still running, kill process
pkill -f "openclaw gateway"

# 3. Verify stopped
pgrep -f "openclaw gateway"  # Should return nothing
```

### 3.3 Maintenance Window

```bash
# 1. Notify users (if applicable)
openclaw agent --message "Going down for maintenance in 5 minutes"

# 2. Wait for notification delivery
sleep 300

# 3. Stop gateway
openclaw gateway stop

# 4. Perform maintenance
# ...

# 5. Start gateway
openclaw gateway start

# 6. Notify users
openclaw agent --message "Back online!"
```

---

## 4. MONITORING

### 4.1 Health Check Commands

```bash
# Quick status
openclaw status

# Detailed health
openclaw health

# Channel status
openclaw channels status

# Session overview
openclaw sessions list --summary

# Cron job status
openclaw cron list

# Recent errors
openclaw logs --level error --since "1h ago" --limit 50
```

### 4.2 Log Analysis

```bash
# View live logs
openclaw logs --follow

# Filter by component
openclaw logs --subsystem gateway
openclaw logs --subsystem agent
openclaw logs --subsystem channels.telegram

# Search for patterns
openclaw logs --grep "ERROR" --since "24h ago"
openclaw logs --grep "timeout" --since "1h ago"

# Export for analysis
openclaw logs --since "7d ago" --format json > logs-week.jsonl
```

### 4.3 Metrics Collection

```bash
# Current metrics (JSON)
curl http://127.0.0.1:18789/__openclaw__/metrics

# Prometheus format (if enabled)
curl http://127.0.0.1:18789/__openclaw__/metrics/prometheus
```

**Key Metrics to Monitor:**

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `gateway_requests_total` | Total requests | N/A (trend) |
| `gateway_request_duration_seconds` | Request latency | p95 > 5s |
| `agent_turns_total` | Agent invocations | N/A (trend) |
| `agent_turn_duration_seconds` | Agent latency | p95 > 30s |
| `channel_messages_received_total` | Inbound messages | N/A (trend) |
| `channel_messages_sent_total` | Outbound messages | N/A (trend) |
| `llm_requests_total` | LLM API calls | N/A (trend) |
| `llm_request_duration_seconds` | LLM latency | p95 > 10s |
| `llm_tokens_total` | Token usage | Cost monitoring |
| `circuit_breaker_state` | Circuit states | Any OPEN |
| `session_count` | Active sessions | > 450 |
| `error_total` | Error count | > 10/min |

---

## 5. TROUBLESHOOTING

### 5.1 Gateway Won't Start

**Symptom:** `openclaw gateway start` fails or exits immediately

**Diagnosis:**
```bash
# Check for port conflicts
lsof -i :18789

# Check config validity
openclaw doctor

# Check logs
openclaw logs --level error --limit 20

# Try verbose mode
openclaw gateway --verbose
```

**Common Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Port in use | `openclaw config set gateway.port 18790` or kill conflicting process |
| Invalid config | `openclaw doctor --fix` |
| Missing credentials | Re-run `openclaw channels login` |
| Permission denied | Check file permissions on `~/.openclaw/` |
| Node version | Upgrade to Node >= 22 |

### 5.2 Channel Disconnected

**Symptom:** Messages not being received/sent on specific channel

**Diagnosis:**
```bash
# Check channel status
openclaw channels status

# Check channel-specific logs
openclaw logs --subsystem channels.whatsapp --since "1h ago"

# Test channel manually
openclaw channels test whatsapp
```

**Channel-Specific Fixes:**

| Channel | Common Issue | Fix |
|---------|--------------|-----|
| WhatsApp | Session expired | `openclaw channels login`, re-scan QR |
| WhatsApp | Banned | New number, wait 24-48h |
| Telegram | Token invalid | Regenerate token via @BotFather |
| Discord | Bot offline | Check token, verify bot in server |
| Slack | App uninstalled | Reinstall app to workspace |

### 5.3 Agent Not Responding

**Symptom:** Messages received but no response generated

**Diagnosis:**
```bash
# Check agent logs
openclaw logs --subsystem agent --since "30m ago"

# Check LLM provider status
openclaw providers status

# Check for queued messages
openclaw sessions list --queued

# Test agent directly
openclaw agent --message "test" --verbose
```

**Common Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| LLM provider down | Check provider status page, wait or switch to fallback |
| Rate limited | Wait for rate limit reset, configure fallback |
| Invalid API key | Verify/regenerate API key |
| Context too large | Compact session: `/compact` |
| Session corrupted | Reset session: `/reset` |

### 5.4 High Latency

**Symptom:** Responses taking > 10 seconds

**Diagnosis:**
```bash
# Check metrics
openclaw metrics --component latency

# Check LLM provider latency
openclaw providers status --latency

# Check system resources
top -l 1 | head -10
df -h ~/.openclaw
```

**Optimization Steps:**

1. **LLM latency high:** Switch to faster model or fallback
2. **System resources low:** Increase resources or reduce load
3. **Large context:** Enable auto-compaction, reduce history limit
4. **Tool execution slow:** Check sandbox resources, optimize tools

### 5.5 Memory Issues

**Symptom:** Gateway using excessive memory or OOM kills

**Diagnosis:**
```bash
# Check memory usage
ps aux | grep openclaw

# Check session count
openclaw sessions list --summary

# Check transcript sizes
du -sh ~/.openclaw/agents/*/sessions/*.jsonl | sort -h | tail -20
```

**Fixes:**

```bash
# 1. Compact large sessions
openclaw sessions compact --all

# 2. Prune old sessions
openclaw sessions cleanup --mode enforce

# 3. Reduce history limit
openclaw config set session.historyLimit 50

# 4. Restart gateway (clears caches)
openclaw gateway restart
```

---

## 6. COMMON PROCEDURES

### 6.1 Add New User (Pairing)

```bash
# 1. User sends message to bot

# 2. Check pending pairing requests
openclaw pairing list telegram

# 3. Approve by code
openclaw pairing approve telegram ABC123

# Or approve by ID
openclaw pairing approve telegram --id "tg:123456789"

# 4. Verify user added
openclaw pairing list telegram --approved
```

### 6.2 Reset User Session

```bash
# 1. Find session key
openclaw sessions list --channel telegram --grep "username"

# 2. Reset specific session
openclaw sessions reset "main:telegram:tg:123456789"

# Or user can send /reset in chat
```

### 6.3 Update Configuration

```bash
# 1. Edit via CLI
openclaw config set agents.defaults.model "anthropic/claude-sonnet-4-6"

# 2. Or edit file directly
nano ~/.openclaw/openclaw.json

# 3. Config reloads automatically (hot reload)
# Verify in logs:
openclaw logs --grep "config reloaded" --limit 5

# 4. For changes requiring restart
openclaw gateway restart
```

### 6.4 Backup & Restore

**Backup:**
```bash
# Full backup
openclaw backup create --output ~/backups/openclaw-$(date +%Y%m%d).tar.gz

# Backup specific components
openclaw backup create --sessions --transcripts --output ~/backups/sessions.tar.gz
```

**Restore:**
```bash
# Stop gateway first
openclaw gateway stop

# Restore from backup
openclaw backup restore --from ~/backups/openclaw-20260226.tar.gz

# Start gateway
openclaw gateway start
```

### 6.5 Rotate API Keys

```bash
# 1. Generate new key at provider

# 2. Update configuration
openclaw config set providers.anthropic.apiKey "sk-new-key..."

# 3. Verify working
openclaw providers test anthropic

# 4. Revoke old key at provider
```

---

## 7. INCIDENT RESPONSE

### 7.1 Incident Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **SEV1** | Complete outage | Immediate | Gateway down, all channels offline |
| **SEV2** | Major degradation | < 1 hour | Primary LLM down, main channel offline |
| **SEV3** | Minor degradation | < 4 hours | High latency, single channel issues |
| **SEV4** | Cosmetic/minor | < 24 hours | Logging issues, minor UI bugs |

### 7.2 Incident Response Checklist

**SEV1/SEV2:**
```
□ Acknowledge incident
□ Page on-call if needed
□ Start incident channel/doc
□ Assess scope and impact
□ Implement immediate mitigation
□ Communicate status to users
□ Root cause analysis
□ Permanent fix
□ Post-incident review
```

### 7.3 Runbook: Gateway Down

```bash
# 1. Verify gateway status
openclaw status
pgrep -f "openclaw gateway"

# 2. Check for crash logs
openclaw logs --level error --limit 50

# 3. Check system resources
df -h
free -m
top -l 1

# 4. Attempt restart
openclaw gateway start

# 5. If fails, check config
openclaw doctor

# 6. If config issue, fix and retry
openclaw doctor --fix
openclaw gateway start

# 7. If still failing, check dependencies
node --version
npm list -g openclaw

# 8. If dependency issue, reinstall
npm install -g openclaw@latest
openclaw gateway start

# 9. If still failing, escalate with logs
openclaw logs --since "1h ago" > incident-logs.txt
```

### 7.4 Runbook: Channel Ban (WhatsApp)

```bash
# 1. Confirm ban
openclaw channels status whatsapp
# Look for: "Connection closed: banned"

# 2. DO NOT attempt to reconnect immediately
# This can extend the ban

# 3. Wait period
# Temporary ban: 24-48 hours
# Permanent ban: Requires new number

# 4. For temporary ban:
# Wait 48 hours, then:
openclaw channels login whatsapp

# 5. For permanent ban:
# a. Obtain new phone number
# b. Update config with new credentials directory
# c. Re-link device
# d. Update allowlists with new number

# 6. Prevention:
# - Respect rate limits
# - Don't send to unknown numbers
# - Avoid broadcast-like behavior
```

### 7.5 Runbook: API Key Compromise

```bash
# 1. IMMEDIATELY revoke key at provider
# Go to provider dashboard and revoke

# 2. Stop gateway to prevent further use
openclaw gateway stop

# 3. Generate new key at provider

# 4. Update configuration
openclaw config set providers.<provider>.apiKey "new-key"

# 5. Search logs for unauthorized usage
openclaw logs --grep "api_key\|token" --since "7d ago" > key-audit.txt

# 6. Start gateway with new key
openclaw gateway start

# 7. Verify working
openclaw providers test <provider>

# 8. Review how key was compromised
# - Check git history
# - Check logs for leaks
# - Check file permissions
```

---

## 8. MAINTENANCE TASKS

### 8.1 Daily Tasks

```bash
# Automated via cron or scheduled task

# 1. Health check
openclaw health > /var/log/openclaw/health-$(date +%Y%m%d).log

# 2. Log rotation (handled by openclaw)
# Verify: ls -la ~/.openclaw/logs/

# 3. Check for errors
openclaw logs --level error --since "24h ago" --count
```

### 8.2 Weekly Tasks

```bash
# 1. Session cleanup
openclaw sessions cleanup --dry-run
openclaw sessions cleanup --mode enforce

# 2. Review metrics
openclaw metrics --period week --report

# 3. Update check
npm outdated -g openclaw

# 4. Backup verification
openclaw backup verify --latest
```

### 8.3 Monthly Tasks

```bash
# 1. Full backup
openclaw backup create --full --output ~/backups/monthly/openclaw-$(date +%Y%m).tar.gz

# 2. Security audit
openclaw security audit > security-audit-$(date +%Y%m).txt

# 3. Performance review
openclaw metrics --period month --report > performance-$(date +%Y%m).txt

# 4. Credential rotation
# Review and rotate any credentials older than 90 days

# 5. Update to latest version (if not automatic)
npm update -g openclaw@latest
openclaw doctor --fix
openclaw gateway restart
```

---

## 9. CAPACITY PLANNING

### 9.1 Resource Requirements

| Load Level | Sessions | Messages/hr | CPU | Memory | Disk |
|------------|----------|-------------|-----|--------|------|
| Light | < 50 | < 100 | 1 core | 512MB | 5GB |
| Medium | 50-200 | 100-500 | 2 cores | 1GB | 20GB |
| Heavy | 200-500 | 500-2000 | 4 cores | 2GB | 50GB |

### 9.2 Scaling Indicators

**Time to scale up:**
- Sustained CPU > 70%
- Memory > 75%
- Disk > 80%
- Latency p95 > 10s
- Error rate > 2%

**Scaling options:**
1. Vertical: Increase resources on current host
2. Session cleanup: Prune inactive sessions
3. Model optimization: Use faster/cheaper models
4. Feature reduction: Disable unused channels/tools

---

## 10. CONTACTS & ESCALATION

### 10.1 Escalation Path

```
Level 1: Self-service (this runbook)
    ↓ (if unresolved after 30 min)
Level 2: Community Discord (#support)
    ↓ (if critical or security issue)
Level 3: GitHub Issues (public) or Security email (private)
```

### 10.2 Resources

| Resource | URL |
|----------|-----|
| Documentation | https://docs.openclaw.ai |
| GitHub Issues | https://github.com/openclaw/openclaw/issues |
| Discord | https://discord.gg/clawd |
| Security Reports | security@openclaw.ai |

### 10.3 Provider Status Pages

| Provider | Status URL |
|----------|------------|
| Anthropic | https://status.anthropic.com |
| OpenAI | https://status.openai.com |
| Google AI | https://status.cloud.google.com |

---

*This runbook should be reviewed and updated quarterly. Last review: February 2026.*
