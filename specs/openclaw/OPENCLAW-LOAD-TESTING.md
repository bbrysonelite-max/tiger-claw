# OpenClaw Load Testing Specification

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. TESTING OBJECTIVES

### 1.1 Goals

| Goal | Description |
|------|-------------|
| **Baseline** | Establish performance baseline for normal operation |
| **Capacity** | Determine maximum throughput before degradation |
| **Limits** | Find breaking points (crash, OOM, timeout) |
| **Regression** | Detect performance regressions between versions |
| **Sizing** | Inform resource recommendations |

### 1.2 Key Questions to Answer

1. How many concurrent sessions can the system handle?
2. What's the maximum messages per minute before degradation?
3. How does latency change under load?
4. What are the resource bottlenecks (CPU, memory, network)?
5. How long can the system sustain peak load?

---

## 2. TEST ENVIRONMENT

### 2.1 Reference Hardware

**Minimum Test Environment:**
| Component | Specification |
|-----------|---------------|
| CPU | 4 cores |
| Memory | 4 GB |
| Disk | 20 GB SSD |
| Network | 100 Mbps |
| OS | macOS 14+ / Ubuntu 22.04+ |

**Recommended Test Environment:**
| Component | Specification |
|-----------|---------------|
| CPU | 8 cores |
| Memory | 8 GB |
| Disk | 50 GB NVMe |
| Network | 1 Gbps |
| OS | Ubuntu 22.04 LTS |

### 2.2 Test Configuration

```json5
{
  // Disable rate limiting for load tests
  "loadTest": {
    "mode": true,
    "disableRateLimiting": true,
    "mockLLM": true,  // Use mock LLM for consistent latency
    "llmLatencyMs": 1000,  // Simulated LLM response time
  },
  
  // Standard config for baseline
  "agents": {
    "defaults": {
      "model": "mock/instant",  // Mock model
      "heartbeat": { "enabled": false },
    }
  },
  
  // Channels in mock mode
  "channels": {
    "telegram": { "enabled": false },
    "whatsapp": { "enabled": false },
  }
}
```

### 2.3 LLM Mocking Strategy

```typescript
// Mock LLM for predictable load testing
class MockLLMProvider {
  constructor(
    private responseLatencyMs: number,
    private tokensPerResponse: number
  ) {}
  
  async complete(prompt: string): Promise<LLMResponse> {
    // Simulate network + processing latency
    await sleep(this.responseLatencyMs);
    
    return {
      content: generateMockResponse(this.tokensPerResponse),
      usage: {
        inputTokens: estimateTokens(prompt),
        outputTokens: this.tokensPerResponse,
      },
    };
  }
}

// Mock configurations
const MOCK_PROFILES = {
  instant: { latencyMs: 10, tokens: 50 },
  fast: { latencyMs: 500, tokens: 100 },
  normal: { latencyMs: 2000, tokens: 200 },
  slow: { latencyMs: 5000, tokens: 500 },
  realWorld: { latencyMs: 3000, tokens: 300 },  // Typical Claude response
};
```

---

## 3. LOAD PROFILES

### 3.1 Traffic Patterns

**Pattern A: Steady State**
```
Messages/min
     │
  60 │ ████████████████████████████████████████████
     │
  30 │
     │
   0 └────────────────────────────────────────────────
     0       15       30       45       60 (minutes)
```

**Pattern B: Ramp Up**
```
Messages/min
     │
 120 │                              ██████████████
     │                        ██████
  60 │                  ██████
     │            ██████
  30 │      ██████
     │██████
   0 └────────────────────────────────────────────────
     0       15       30       45       60 (minutes)
```

**Pattern C: Spike**
```
Messages/min
     │
 300 │                    ████
     │                  ██    ██
 120 │                ██        ██
  60 │████████████████            ████████████████
   0 └────────────────────────────────────────────────
     0       15       30       45       60 (minutes)
```

**Pattern D: Diurnal (Realistic)**
```
Messages/min
     │
 120 │              ████████████
     │            ██            ██
  60 │          ██                ██████████████
     │        ██                              ██
  30 │████████                                  ████
   0 └────────────────────────────────────────────────
     0   4   8   12  16  20  24 (hours - simulated)
```

### 3.2 Load Levels

| Level | Description | Messages/min | Concurrent Sessions |
|-------|-------------|--------------|---------------------|
| **Baseline** | Normal personal use | 1-5 | 1-3 |
| **Moderate** | Active use | 10-30 | 5-10 |
| **High** | Heavy use | 60-120 | 20-50 |
| **Peak** | Maximum expected | 200-300 | 50-100 |
| **Stress** | Beyond expected | 500+ | 200+ |
| **Break** | Find limits | Until failure | Until failure |

---

## 4. TEST SCENARIOS

### 4.1 Scenario 1: Baseline Performance

**Purpose:** Establish baseline metrics for normal operation

```yaml
scenario: baseline
duration: 30m
pattern: steady
load:
  messagesPerMinute: 5
  concurrentSessions: 3
  messageTypes:
    simple: 70%      # "Hello", "Thanks"
    moderate: 25%    # Single tool call
    complex: 5%      # Multi-tool, long context

measurements:
  - gateway_latency_p50
  - gateway_latency_p95
  - agent_turn_latency_p50
  - agent_turn_latency_p95
  - error_rate
  - cpu_usage_avg
  - memory_usage_avg
  - memory_usage_max

success_criteria:
  - agent_turn_latency_p95 < 5000ms
  - error_rate < 0.1%
  - cpu_usage_avg < 30%
  - memory_usage_max < 500MB
```

### 4.2 Scenario 2: Sustained Load

**Purpose:** Verify stability under continuous moderate load

```yaml
scenario: sustained_load
duration: 4h
pattern: steady
load:
  messagesPerMinute: 60
  concurrentSessions: 20
  messageTypes:
    simple: 50%
    moderate: 40%
    complex: 10%

measurements:
  - latency_percentiles
  - error_rate
  - throughput_actual
  - resource_usage
  - memory_growth_rate
  - gc_frequency

success_criteria:
  - agent_turn_latency_p95 < 10000ms
  - error_rate < 1%
  - memory_growth_rate < 10MB/hour  # No significant leak
  - no_oom_kills
  - no_crashes
```

### 4.3 Scenario 3: Ramp to Capacity

**Purpose:** Find maximum throughput before degradation

```yaml
scenario: ramp_capacity
duration: 60m
pattern: ramp
load:
  startMessagesPerMinute: 10
  endMessagesPerMinute: 500
  rampDuration: 45m
  holdDuration: 15m
  concurrentSessions: dynamic  # Scales with load

measurements:
  - throughput_vs_latency
  - saturation_point
  - error_rate_by_load
  - queue_depth

analysis:
  - Find knee in latency curve
  - Identify first errors
  - Determine sustainable maximum

success_criteria:
  - Identify clear saturation point
  - No crashes during ramp
  - Graceful degradation (not cliff)
```

### 4.4 Scenario 4: Spike Handling

**Purpose:** Verify behavior under sudden load spike

```yaml
scenario: spike
duration: 30m
pattern: spike
load:
  baselineMessagesPerMinute: 30
  spikeMessagesPerMinute: 300
  spikeDuration: 5m
  spikeStart: 10m

measurements:
  - latency_during_spike
  - queue_depth_max
  - error_rate_during_spike
  - recovery_time

success_criteria:
  - error_rate_during_spike < 5%
  - queue_depth_max < 1000
  - recovery_time < 2m
  - no_data_loss
```

### 4.5 Scenario 5: Soak Test

**Purpose:** Verify long-term stability

```yaml
scenario: soak
duration: 24h
pattern: diurnal
load:
  peakMessagesPerMinute: 60
  troughMessagesPerMinute: 5
  concurrentSessions: 10-50

measurements:
  - memory_over_time
  - disk_usage_over_time
  - latency_stability
  - connection_stability

success_criteria:
  - memory_stable (no continuous growth)
  - disk_growth < expected (transcripts only)
  - latency_stable (no degradation over time)
  - channels_remain_connected
  - no_restarts_required
```

### 4.6 Scenario 6: Stress Test

**Purpose:** Find breaking points

```yaml
scenario: stress
duration: until_failure
pattern: ramp_to_break
load:
  startMessagesPerMinute: 100
  incrementPerMinute: 50
  noLimit: true

measurements:
  - first_error_load
  - first_timeout_load
  - oom_load
  - crash_load

analysis:
  - Document failure modes
  - Identify bottleneck resources
  - Recommend hard limits
```

---

## 5. TEST IMPLEMENTATION

### 5.1 Load Generator (k6)

```javascript
// k6 load test script
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const messagesSent = new Counter('messages_sent');
const messagesReceived = new Counter('messages_received');
const turnLatency = new Trend('turn_latency');

// Configuration
export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1m',
      duration: '30m',
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    'turn_latency': ['p95<5000'],
    'messages_received': ['count>0'],
  },
};

export default function() {
  const url = 'ws://localhost:18789';
  
  const res = ws.connect(url, {}, function(socket) {
    // Connect handshake
    socket.send(JSON.stringify({
      type: 'req',
      id: `connect-${__VU}-${__ITER}`,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'k6', version: '1.0', platform: 'test', mode: 'operator' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
      }
    }));
    
    socket.on('message', (msg) => {
      const data = JSON.parse(msg);
      if (data.type === 'res' && data.payload?.type === 'hello-ok') {
        // Send test message
        const start = Date.now();
        socket.send(JSON.stringify({
          type: 'req',
          id: `agent-${__VU}-${__ITER}`,
          method: 'agent',
          params: {
            message: 'Hello, this is a load test message.',
            sessionKey: `loadtest:session:${__VU}`,
          }
        }));
        messagesSent.add(1);
      }
      
      if (data.type === 'res' && data.id?.startsWith('agent-')) {
        const duration = Date.now() - start;
        turnLatency.add(duration);
        messagesReceived.add(1);
      }
    });
    
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });
  
  check(res, { 'status is 101': (r) => r && r.status === 101 });
  sleep(1);
}
```

### 5.2 Metrics Collection

```yaml
# Prometheus scrape config for load tests
scrape_configs:
  - job_name: 'openclaw-loadtest'
    scrape_interval: 5s
    static_configs:
      - targets: ['localhost:18789']
    metrics_path: '/__openclaw__/metrics'

# Key metrics to collect
metrics:
  # Throughput
  - openclaw_requests_total
  - openclaw_messages_received_total
  - openclaw_agent_turns_total
  
  # Latency
  - openclaw_request_duration_seconds
  - openclaw_agent_turn_duration_seconds
  
  # Resources
  - process_cpu_seconds_total
  - process_resident_memory_bytes
  - nodejs_heap_size_used_bytes
  - nodejs_eventloop_lag_seconds
  
  # Queues
  - openclaw_queue_depth
  - openclaw_active_sessions
```

### 5.3 Results Collection

```typescript
interface LoadTestResults {
  scenario: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  
  // Load achieved
  totalMessages: number;
  messagesPerMinute: number;
  peakConcurrentSessions: number;
  
  // Latency
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  
  // Throughput
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  
  // Resources
  cpuAvgPercent: number;
  cpuMaxPercent: number;
  memoryAvgMb: number;
  memoryMaxMb: number;
  
  // Stability
  crashes: number;
  oomKills: number;
  restarts: number;
  
  // Analysis
  saturationPoint?: number;
  bottleneck?: string;
  recommendations?: string[];
}
```

---

## 6. PERFORMANCE BASELINES

### 6.1 Expected Baselines (Reference Hardware)

| Metric | Minimum Spec | Recommended Spec |
|--------|--------------|------------------|
| **Throughput** | | |
| Sustained messages/min | 30 | 120 |
| Peak messages/min | 60 | 300 |
| Concurrent sessions | 20 | 100 |
| **Latency (mock LLM)** | | |
| p50 | < 100ms | < 50ms |
| p95 | < 500ms | < 200ms |
| p99 | < 1000ms | < 500ms |
| **Latency (real LLM)** | | |
| p50 | < 3s | < 2s |
| p95 | < 8s | < 5s |
| p99 | < 15s | < 10s |
| **Resources (at moderate load)** | | |
| CPU | < 50% | < 30% |
| Memory | < 1GB | < 500MB |
| Disk I/O | < 10 MB/s | < 5 MB/s |

### 6.2 Baseline Recording

```bash
# Run baseline tests
openclaw loadtest baseline --duration 30m --output baseline-$(date +%Y%m%d).json

# Compare to previous baseline
openclaw loadtest compare \
  --baseline baseline-20260201.json \
  --current baseline-20260226.json \
  --threshold 10%  # Alert if >10% regression
```

---

## 7. REGRESSION DETECTION

### 7.1 Performance Regression Criteria

| Metric | Regression Threshold | Action |
|--------|---------------------|--------|
| p95 Latency | +20% | Warning |
| p95 Latency | +50% | Block release |
| Throughput | -20% | Warning |
| Throughput | -50% | Block release |
| Memory usage | +30% | Investigate |
| Error rate | +0.5% | Warning |
| Error rate | +2% | Block release |

### 7.2 CI Integration

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Nightly

jobs:
  performance:
    runs-on: ubuntu-latest-8core
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Install
        run: pnpm install && pnpm build
      
      - name: Start Gateway
        run: |
          pnpm openclaw gateway &
          sleep 10
      
      - name: Run Load Tests
        run: |
          k6 run --out json=results.json tests/load/baseline.js
      
      - name: Check Regression
        run: |
          pnpm openclaw loadtest compare \
            --baseline .performance-baseline.json \
            --current results.json \
            --fail-on-regression
      
      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          name: performance-results
          path: results.json
```

---

## 8. BOTTLENECK ANALYSIS

### 8.1 Common Bottlenecks

| Symptom | Likely Bottleneck | Investigation |
|---------|-------------------|---------------|
| High CPU, OK latency | Processing bound | Profile CPU, check hot paths |
| OK CPU, high latency | I/O bound | Check disk, network, LLM API |
| Memory growing | Memory leak | Heap snapshot, check caches |
| Timeouts under load | Queue saturation | Check queue depth, concurrency |
| Sporadic failures | Resource exhaustion | Check file handles, connections |

### 8.2 Investigation Tools

```bash
# CPU profiling
node --prof openclaw gateway
# Then: node --prof-process isolate-*.log > profile.txt

# Memory profiling
node --inspect openclaw gateway
# Then: Chrome DevTools > Memory > Heap Snapshot

# Network analysis
ss -tlnp | grep 18789
netstat -an | grep ESTABLISHED | wc -l

# File descriptors
lsof -p $(pgrep -f "openclaw gateway") | wc -l
cat /proc/$(pgrep -f "openclaw gateway")/limits | grep "open files"

# Event loop lag
# Built into metrics: nodejs_eventloop_lag_seconds
```

### 8.3 Bottleneck Resolution

| Bottleneck | Resolution Options |
|------------|-------------------|
| CPU | Optimize hot paths, reduce JSON parsing, cache |
| Memory | Reduce session state, implement LRU caches, compress |
| Disk I/O | Buffer writes, async I/O, SSD requirement |
| Network | Connection pooling, keep-alive, compression |
| LLM API | Caching, request batching, fallback to faster model |
| Event Loop | Move CPU work to worker threads, async everything |

---

## 9. REPORTING

### 9.1 Load Test Report Template

```
╔════════════════════════════════════════════════════════════════════╗
║                    OPENCLAW LOAD TEST REPORT                       ║
║                    Scenario: Sustained Load                         ║
║                    Date: 2026-02-26                                 ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  SUMMARY                                                           ║
║  ───────                                                           ║
║  Duration:      4 hours                                            ║
║  Total Messages: 14,400                                            ║
║  Success Rate:  99.7%                                              ║
║  Status:        ✅ PASSED                                          ║
║                                                                    ║
║  THROUGHPUT                                                        ║
║  ──────────                                                        ║
║  Target:        60 msg/min                                         ║
║  Achieved:      59.8 msg/min                                       ║
║  Peak:          62 msg/min                                         ║
║                                                                    ║
║  LATENCY (Agent Turn)                                              ║
║  ────────────────────                                              ║
║  p50:           2.1s    (target: 3s)   ✅                         ║
║  p95:           7.2s    (target: 8s)   ✅                         ║
║  p99:          12.8s    (target: 15s)  ✅                         ║
║  max:          28.5s                                               ║
║                                                                    ║
║  RESOURCES                                                         ║
║  ─────────                                                         ║
║  CPU avg:       35%     (limit: 70%)   ✅                         ║
║  CPU max:       58%                                                ║
║  Memory avg:    412 MB  (limit: 1GB)   ✅                         ║
║  Memory max:    523 MB                                             ║
║  Memory growth: 8 MB/hr (limit: 10)    ✅                         ║
║                                                                    ║
║  ERRORS                                                            ║
║  ──────                                                            ║
║  Total:         43 (0.3%)                                          ║
║  Timeouts:      38                                                 ║
║  Server errors: 5                                                  ║
║                                                                    ║
║  COMPARISON TO BASELINE                                            ║
║  ────────────────────────                                          ║
║  p95 Latency:   +5% (within threshold)                            ║
║  Throughput:    -1% (within threshold)                            ║
║  Memory:        +8% (within threshold)                            ║
║                                                                    ║
║  RECOMMENDATIONS                                                   ║
║  ───────────────                                                   ║
║  • System handles target load well                                 ║
║  • Consider investigating timeout errors                           ║
║  • Memory growth acceptable but monitor                           ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 10. TEST SCHEDULE

### 10.1 Regular Testing

| Test | Frequency | Trigger |
|------|-----------|---------|
| Baseline | Weekly | Automated (Sunday night) |
| Regression | Per PR | CI pipeline |
| Sustained | Weekly | Automated |
| Soak | Monthly | Manual |
| Stress | Quarterly | Manual |
| Full suite | Pre-release | Manual |

### 10.2 Pre-Release Checklist

- [ ] Baseline test passes
- [ ] No regression vs previous release
- [ ] Sustained load (4h) passes
- [ ] Spike test passes
- [ ] Soak test (24h) passes
- [ ] Document any performance changes in release notes

---

*This load testing specification ensures OpenClaw performs reliably under expected conditions.*
