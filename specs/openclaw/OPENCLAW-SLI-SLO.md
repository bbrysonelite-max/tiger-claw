# OpenClaw SLI/SLO/SLA Definitions

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. OVERVIEW

### 1.1 Definitions

| Term | Definition |
|------|------------|
| **SLI** (Service Level Indicator) | A quantitative measure of service behavior |
| **SLO** (Service Level Objective) | A target value or range for an SLI |
| **SLA** (Service Level Agreement) | A contract with consequences for missing SLOs |
| **Error Budget** | Allowed amount of unreliability (100% - SLO) |

### 1.2 Philosophy

OpenClaw is a **personal assistant** running on user hardware. SLOs are:
- **Self-imposed quality targets**, not contractual obligations
- **Optimized for single-user experience**, not massive scale
- **Measured locally**, with optional cloud reporting

---

## 2. SERVICE LEVEL INDICATORS (SLIs)

### 2.1 Availability SLIs

| SLI | Definition | Measurement |
|-----|------------|-------------|
| **Gateway Availability** | % of time Gateway accepts connections | `(uptime_seconds / total_seconds) * 100` |
| **Channel Availability** | % of time each channel is connected | `(connected_seconds / expected_seconds) * 100` |
| **Agent Availability** | % of requests that get a response | `(successful_turns / total_turns) * 100` |

**Measurement Method:**
```typescript
// Gateway availability - measured by health check
const gatewayAvailability = {
  numerator: healthCheckSuccesses,
  denominator: healthCheckAttempts,
  window: '30d',
};

// Channel availability - measured by connection state
const channelAvailability = {
  numerator: connectedDurationMs,
  denominator: expectedDurationMs, // Excludes planned downtime
  window: '24h',
};

// Agent availability - measured by turn completion
const agentAvailability = {
  numerator: turnsWithResponse,
  denominator: totalTurns,
  window: '7d',
};
```

### 2.2 Latency SLIs

| SLI | Definition | Measurement Point |
|-----|------------|-------------------|
| **Message Receive Latency** | Time from channel receive to session queue | Channel → Gateway |
| **Agent Turn Latency** | Time from message to response start | Queue → First token |
| **End-to-End Latency** | Time from user send to user receive | User → User |
| **Tool Execution Latency** | Time for tool call to complete | Call → Result |

**Measurement Method:**
```typescript
// Latency histogram buckets (milliseconds)
const LATENCY_BUCKETS = [
  100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000
];

// Measure each request
function measureLatency(start: number, end: number, operation: string): void {
  const durationMs = end - start;
  metrics.histogram(`${operation}_latency_ms`, durationMs);
  metrics.percentile(`${operation}_latency_p50`, durationMs, 0.50);
  metrics.percentile(`${operation}_latency_p95`, durationMs, 0.95);
  metrics.percentile(`${operation}_latency_p99`, durationMs, 0.99);
}
```

### 2.3 Error Rate SLIs

| SLI | Definition | Calculation |
|-----|------------|-------------|
| **Request Error Rate** | % of requests returning errors | `errors / total_requests * 100` |
| **Tool Error Rate** | % of tool executions failing | `tool_errors / tool_calls * 100` |
| **Channel Error Rate** | % of send operations failing | `send_errors / send_attempts * 100` |

**Error Classification:**
```typescript
// Errors that count against SLO
const SLO_COUNTED_ERRORS = [
  'INTERNAL_ERROR',      // 3001 - Our fault
  'DEPENDENCY_FAILED',   // 3004 - Our fault (should have fallback)
  'TIMEOUT_INTERNAL',    // 3006 - Our fault
];

// Errors that DON'T count against SLO
const SLO_EXCLUDED_ERRORS = [
  'INVALID_INPUT',       // 2001 - User's fault
  'AUTH_REQUIRED',       // 2002 - Expected behavior
  'RATE_LIMITED',        // 1003 - External, expected
  'PROVIDER_DOWN',       // 5001 - External, has fallback
];
```

### 2.4 Throughput SLIs

| SLI | Definition | Measurement |
|-----|------------|-------------|
| **Messages Processed** | Messages handled per time period | Count per hour |
| **Agent Turns** | Agent invocations per time period | Count per hour |
| **Tool Executions** | Tool calls per time period | Count per hour |

---

## 3. SERVICE LEVEL OBJECTIVES (SLOs)

### 3.1 Availability SLOs

| Service | SLO | Allowed Downtime (30 days) | Allowed Downtime (Year) |
|---------|-----|---------------------------|------------------------|
| Gateway | 99.9% | 43.2 minutes | 8.76 hours |
| Channels (each) | 99.5% | 3.6 hours | 43.8 hours |
| Agent | 99.0% | 7.2 hours | 87.6 hours |

**Note:** These are targets for a personal system. Gateway unavailability usually means the host machine is off or rebooting.

### 3.2 Latency SLOs

| Operation | p50 Target | p95 Target | p99 Target |
|-----------|------------|------------|------------|
| Message Receive | < 100ms | < 500ms | < 1s |
| Agent Turn (simple) | < 3s | < 8s | < 15s |
| Agent Turn (complex) | < 10s | < 30s | < 60s |
| Tool: exec | < 1s | < 5s | < 30s |
| Tool: browser | < 3s | < 10s | < 30s |
| Tool: web_fetch | < 2s | < 5s | < 15s |
| End-to-End | < 5s | < 15s | < 45s |

### 3.3 Error Rate SLOs

| Metric | SLO Target |
|--------|------------|
| Request Error Rate | < 1% |
| Tool Error Rate | < 5% |
| Channel Send Error Rate | < 0.5% |
| Agent Turn Error Rate | < 2% |

### 3.4 Freshness SLOs

| Data | Freshness Target |
|------|------------------|
| Session token counts | Real-time (on turn completion) |
| Channel connection status | < 5 seconds |
| Cron job next run time | < 1 minute |
| Config changes | < 10 seconds (hot reload) |

---

## 4. ERROR BUDGETS

### 4.1 Budget Calculation

```
Error Budget = 100% - SLO

Example for Gateway (99.9% SLO):
  Error Budget = 100% - 99.9% = 0.1%
  
  Per 30 days:
    Total minutes = 30 * 24 * 60 = 43,200
    Budget minutes = 43,200 * 0.001 = 43.2 minutes
```

### 4.2 Error Budget by Service

| Service | SLO | Error Budget (30 days) | Error Budget (Quarter) |
|---------|-----|------------------------|------------------------|
| Gateway | 99.9% | 43.2 min | 2.16 hours |
| Channels | 99.5% | 3.6 hours | 10.8 hours |
| Agent | 99.0% | 7.2 hours | 21.6 hours |

### 4.3 Budget Consumption Tracking

```typescript
interface ErrorBudget {
  service: string;
  sloTarget: number;
  windowDays: number;
  
  // Current state
  totalMinutes: number;
  errorMinutes: number;
  budgetMinutes: number;
  budgetRemaining: number;
  budgetConsumedPercent: number;
  
  // Burn rate
  burnRateLastHour: number;
  burnRateLastDay: number;
  projectedBudgetExhaustion: Date | null;
}

function calculateErrorBudget(
  service: string,
  sloTarget: number,
  windowDays: number,
  incidents: Incident[]
): ErrorBudget {
  const totalMinutes = windowDays * 24 * 60;
  const errorMinutes = incidents.reduce((sum, i) => sum + i.durationMinutes, 0);
  const budgetMinutes = totalMinutes * (1 - sloTarget);
  const budgetRemaining = budgetMinutes - errorMinutes;
  
  return {
    service,
    sloTarget,
    windowDays,
    totalMinutes,
    errorMinutes,
    budgetMinutes,
    budgetRemaining,
    budgetConsumedPercent: (errorMinutes / budgetMinutes) * 100,
    // ... calculate burn rates
  };
}
```

### 4.4 Budget Policies

| Budget Consumed | Action |
|-----------------|--------|
| 0-50% | Normal development velocity |
| 50-75% | Increased review for risky changes |
| 75-90% | Freeze non-critical changes |
| 90-100% | Focus on reliability only |
| 100%+ | Incident review required |

---

## 5. ALERTING THRESHOLDS

### 5.1 Alert Definitions

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **Gateway Down** | Health check fails 3x | P1 | Page immediately |
| **High Error Rate** | > 5% errors in 5 min | P2 | Investigate within 1h |
| **High Latency** | p95 > 30s for 10 min | P2 | Investigate within 1h |
| **Channel Disconnected** | Disconnected > 5 min | P3 | Investigate within 4h |
| **Budget Burn** | > 10% budget in 1h | P2 | Review immediately |
| **Disk Space** | < 10% free | P2 | Clean up within 4h |
| **Memory High** | > 85% for 15 min | P3 | Monitor, may need restart |

### 5.2 Alert Configuration

```yaml
alerts:
  gateway_down:
    condition: health_check_failures >= 3
    window: 5m
    severity: P1
    channels: [pushover, discord]
    
  high_error_rate:
    condition: error_rate > 0.05
    window: 5m
    severity: P2
    channels: [discord]
    
  high_latency:
    condition: agent_turn_latency_p95 > 30000
    window: 10m
    severity: P2
    channels: [discord]
    
  channel_disconnected:
    condition: channel_connected == false
    window: 5m
    severity: P3
    channels: [log]
    
  budget_burn_high:
    condition: budget_burn_rate_1h > 0.10
    window: 1h
    severity: P2
    channels: [discord]
```

### 5.3 Multi-Window Alerting

For burn rate alerts, use multiple windows to catch both sudden spikes and slow burns:

```
Fast Burn Alert:
  Condition: 2% of monthly budget consumed in 1 hour
  Interpretation: On track to exhaust budget in ~2 days
  
Slow Burn Alert:
  Condition: 10% of monthly budget consumed in 24 hours
  Interpretation: On track to exhaust budget in ~10 days
```

---

## 6. DASHBOARDS

### 6.1 SLO Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              OPENCLAW SLO DASHBOARD                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │ GATEWAY AVAILABILITY        │  │ ERROR BUDGET STATUS                         │  │
│  │                             │  │                                             │  │
│  │   Current: 99.95%           │  │   Gateway:  ████████░░ 80% remaining        │  │
│  │   SLO:     99.9%            │  │   Channels: █████████░ 90% remaining        │  │
│  │   Status:  ✅ Meeting       │  │   Agent:    ███████░░░ 70% remaining        │  │
│  │                             │  │                                             │  │
│  │   [30-day trend graph]      │  │   Burn rate: 0.5%/day (normal)              │  │
│  └─────────────────────────────┘  └─────────────────────────────────────────────┘  │
│                                                                                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │ LATENCY (Agent Turns)       │  │ ERROR RATE                                  │  │
│  │                             │  │                                             │  │
│  │   p50:  2.1s  ✅            │  │   Current:  0.3%  ✅                        │  │
│  │   p95:  7.8s  ✅            │  │   SLO:      < 1%                            │  │
│  │   p99: 14.2s  ✅            │  │                                             │  │
│  │                             │  │   [24-hour error rate graph]                │  │
│  │   [Latency distribution]    │  │                                             │  │
│  └─────────────────────────────┘  └─────────────────────────────────────────────┘  │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ CHANNEL STATUS                                                               │  │
│  │                                                                              │  │
│  │   WhatsApp:  ✅ Connected  99.8% (30d)   Telegram: ✅ Connected  99.9% (30d) │  │
│  │   Discord:   ✅ Connected  99.7% (30d)   Slack:    ⚪ Disabled               │  │
│  │   Signal:    ⚠️ Reconnecting             iMessage: ✅ Connected  99.5% (30d) │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Key Metrics to Display

| Panel | Metrics |
|-------|---------|
| Availability | Current %, SLO target, 30-day trend |
| Error Budget | Remaining %, burn rate, projected exhaustion |
| Latency | p50/p95/p99, distribution histogram |
| Error Rate | Current rate, breakdown by type |
| Channels | Connection status, per-channel availability |
| Throughput | Messages/hour, turns/hour, trend |

---

## 7. SLO REVIEW PROCESS

### 7.1 Review Cadence

| Review | Frequency | Focus |
|--------|-----------|-------|
| Daily | Glance | Any active alerts? Budget on track? |
| Weekly | 15 min | SLO performance, notable incidents |
| Monthly | 1 hour | Budget review, SLO adjustments |
| Quarterly | 2 hours | Comprehensive review, target updates |

### 7.2 Weekly Review Template

```markdown
## SLO Weekly Review - Week of [DATE]

### Summary
- [ ] All SLOs met
- [ ] Error budget on track
- [ ] No outstanding incidents

### Availability
| Service | Target | Actual | Status |
|---------|--------|--------|--------|
| Gateway | 99.9% | 99.95% | ✅ |
| Channels | 99.5% | 99.7% | ✅ |
| Agent | 99.0% | 99.2% | ✅ |

### Incidents
| Date | Duration | Impact | Root Cause |
|------|----------|--------|------------|
| None | - | - | - |

### Error Budget
| Service | Budget (30d) | Consumed | Remaining |
|---------|--------------|----------|-----------|
| Gateway | 43.2 min | 2.5 min | 40.7 min |

### Action Items
- [ ] None this week

### Notes
[Any observations or concerns]
```

### 7.3 SLO Adjustment Criteria

**When to tighten SLOs:**
- Consistently exceeding SLO by large margin (>10x)
- Users reporting satisfaction
- No budget pressure

**When to loosen SLOs:**
- Consistently missing SLO despite good practices
- SLO causing excessive alert fatigue
- External dependencies make SLO unrealistic

---

## 8. IMPLEMENTATION

### 8.1 Metrics Collection

```typescript
// Core metrics interface
interface SLIMetrics {
  // Counters
  requestsTotal: Counter;
  requestsSuccess: Counter;
  requestsError: Counter;
  
  // Histograms
  requestDuration: Histogram;
  agentTurnDuration: Histogram;
  toolExecutionDuration: Histogram;
  
  // Gauges
  channelConnected: Gauge;
  sessionCount: Gauge;
  errorBudgetRemaining: Gauge;
}

// Collection points
function recordRequest(result: 'success' | 'error', durationMs: number): void {
  metrics.requestsTotal.inc();
  if (result === 'success') {
    metrics.requestsSuccess.inc();
  } else {
    metrics.requestsError.inc();
  }
  metrics.requestDuration.observe(durationMs);
}
```

### 8.2 SLO Calculation Service

```typescript
class SLOCalculator {
  async calculateAvailability(
    service: string,
    windowHours: number
  ): Promise<number> {
    const total = await this.getMetric(`${service}_requests_total`, windowHours);
    const success = await this.getMetric(`${service}_requests_success`, windowHours);
    return (success / total) * 100;
  }
  
  async calculateLatencyPercentile(
    service: string,
    percentile: number,
    windowHours: number
  ): Promise<number> {
    const histogram = await this.getHistogram(
      `${service}_duration_ms`,
      windowHours
    );
    return this.computePercentile(histogram, percentile);
  }
  
  async calculateErrorBudget(
    service: string,
    sloTarget: number,
    windowDays: number
  ): Promise<ErrorBudget> {
    const availability = await this.calculateAvailability(
      service,
      windowDays * 24
    );
    const errorRate = 100 - availability;
    const budgetPercent = 100 - sloTarget;
    const consumed = errorRate / budgetPercent;
    
    return {
      service,
      sloTarget,
      currentAvailability: availability,
      budgetPercent,
      budgetConsumed: consumed * 100,
      budgetRemaining: (1 - consumed) * 100,
    };
  }
}
```

---

## 9. REPORTING

### 9.1 SLO Report Format

```
╔════════════════════════════════════════════════════════════════════╗
║                    OPENCLAW SLO MONTHLY REPORT                     ║
║                        February 2026                                ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  EXECUTIVE SUMMARY                                                 ║
║  ─────────────────                                                 ║
║  All SLOs met. Error budget healthy at 85% remaining.             ║
║                                                                    ║
║  AVAILABILITY                                                      ║
║  ────────────                                                      ║
║  Gateway:    99.97% (target: 99.9%)  ✅ +0.07%                    ║
║  Channels:   99.82% (target: 99.5%)  ✅ +0.32%                    ║
║  Agent:      99.45% (target: 99.0%)  ✅ +0.45%                    ║
║                                                                    ║
║  LATENCY                                                           ║
║  ───────                                                           ║
║  Agent Turn p95:  6.2s (target: 8s)   ✅                          ║
║  Agent Turn p99: 12.1s (target: 15s)  ✅                          ║
║                                                                    ║
║  ERROR BUDGET                                                      ║
║  ────────────                                                      ║
║  Gateway:  6.5 min consumed of 43.2 min (15%)                     ║
║  Channels: 47 min consumed of 216 min (22%)                       ║
║  Agent:    2.4 hrs consumed of 7.2 hrs (33%)                      ║
║                                                                    ║
║  INCIDENTS                                                         ║
║  ─────────                                                         ║
║  1 incident, 6.5 min total downtime                               ║
║  • Feb 15: Gateway restart during config update (6.5 min)         ║
║                                                                    ║
║  RECOMMENDATIONS                                                   ║
║  ───────────────                                                   ║
║  • Continue current practices                                      ║
║  • Consider tightening Gateway SLO to 99.95% next quarter         ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
```

---

*These SLI/SLO definitions provide measurable targets for OpenClaw reliability.*
