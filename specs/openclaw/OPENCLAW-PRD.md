# OpenClaw Product Requirements Document (PRD)

**Document Version:** 1.0  
**Date:** February 26, 2026  
**Author:** Birdie 🐦 (for Pebo)  
**Purpose:** Build specification for recreating/enhancing OpenClaw

---

## 1. PRODUCT OVERVIEW

### 1.1 Vision Statement
Build a **personal AI assistant platform** that runs locally, connects to all your messaging apps, and gives you full control over your AI interactions — no cloud lock-in, full privacy, complete customization.

### 1.2 Target User
- Power users who want AI integrated into their daily workflows
- Developers who want to extend and customize their assistant
- Privacy-conscious individuals who want local-first AI
- Network marketers, entrepreneurs, and professionals who need AI automation

### 1.3 Core Value Propositions
1. **Multi-channel inbox** — One AI, all your messaging platforms
2. **Local-first** — Your data stays on your machine
3. **Tool-native** — Execute code, browse web, control devices
4. **Extensible** — Skills, plugins, and custom tools
5. **Always-on** — Cron jobs, heartbeats, automation

---

## 2. FUNCTIONAL REQUIREMENTS

### 2.1 Gateway (Control Plane)

#### FR-G01: WebSocket Server
- **MUST** bind to configurable port (default 18789)
- **MUST** support loopback binding for security
- **MUST** handle concurrent client connections (CLI, apps, WebChat)
- **MUST** validate all frames against JSON schema
- **SHOULD** support Tailscale Serve/Funnel for remote access

#### FR-G02: Protocol
- **MUST** require `connect` as first frame
- **MUST** support request/response pattern with idempotency keys
- **MUST** support server-push events (agent, chat, presence, health)
- **MUST** authenticate via token when configured
- **SHOULD** support challenge-response for device pairing

#### FR-G03: Configuration
- **MUST** read JSON5 config from `~/.openclaw/openclaw.json`
- **MUST** hot-reload on file changes
- **MUST** validate against strict schema (reject unknown keys)
- **MUST** support environment variable overrides
- **SHOULD** provide CLI config commands (get/set/unset)

#### FR-G04: Session Management
- **MUST** persist sessions to `sessions.json`
- **MUST** store transcripts as JSONL files
- **MUST** support session scoping (main, per-peer, per-channel-peer)
- **MUST** track token counts (input, output, total, context)
- **SHOULD** implement session maintenance (prune, cap, rotate)

#### FR-G05: Cron Scheduler
- **MUST** persist jobs to `jobs.json`
- **MUST** support cron expressions, intervals, and one-shot at times
- **MUST** support timezone configuration
- **MUST** support main session (heartbeat) and isolated execution
- **SHOULD** support delivery to channels with announce

### 2.2 Agent Runtime

#### FR-A01: Pi SDK Integration
- **MUST** embed Pi agent via `createAgentSession()`
- **MUST** inject custom OpenClaw tools alongside Pi builtins
- **MUST** build dynamic system prompts per context
- **MUST** support model switching at runtime
- **SHOULD** implement auth profile rotation with failover

#### FR-A02: Model Support
- **MUST** support Anthropic (Claude family)
- **MUST** support OpenAI (GPT family)
- **SHOULD** support Google (Gemini family)
- **SHOULD** support custom/self-hosted providers via base URL
- **MUST** implement model fallback on failures

#### FR-A03: Context Management
- **MUST** limit context window per model
- **MUST** support manual and auto compaction
- **MUST** inject workspace files (AGENTS.md, SOUL.md, etc.)
- **SHOULD** implement context pruning extensions

#### FR-A04: Tool Execution
- **MUST** implement exec tool with PTY support
- **MUST** implement process tool for background sessions
- **MUST** implement read/write/edit file tools
- **MUST** implement web_search and web_fetch
- **MUST** implement message tool for cross-channel sends
- **SHOULD** implement browser tool with CDP
- **SHOULD** implement cron tool
- **SHOULD** implement nodes tool for companion apps

### 2.3 Channel System

#### FR-C01: Core Channels
- **MUST** support WhatsApp via Baileys
- **MUST** support Telegram via grammY
- **MUST** support Discord via discord.js
- **MUST** support Slack via Bolt
- **MUST** support WebChat (built-in HTTP)

#### FR-C02: Extension Channels
- **SHOULD** support Signal via signal-cli
- **SHOULD** support iMessage via BlueBubbles
- **SHOULD** support Microsoft Teams
- **SHOULD** support Google Chat
- **SHOULD** support Matrix

#### FR-C03: Channel Features
- **MUST** implement DM policies (pairing, allowlist, open, disabled)
- **MUST** implement group allowlists
- **MUST** support mention gating in groups
- **MUST** handle media (images, audio, video, documents)
- **SHOULD** support typing indicators
- **SHOULD** support reactions

#### FR-C04: Message Routing
- **MUST** route inbound messages to correct session
- **MUST** route outbound messages to correct channel
- **MUST** handle chunking for long messages
- **MUST** support reply threading where available

### 2.4 Skills System

#### FR-S01: Skill Loading
- **MUST** load from workspace, managed, and bundled locations
- **MUST** apply precedence (workspace > managed > bundled)
- **MUST** parse SKILL.md with YAML frontmatter
- **MUST** support metadata-based gating (bins, env, config)

#### FR-S02: Skill Features
- **SHOULD** support user-invocable slash commands
- **SHOULD** support tool dispatch mode
- **SHOULD** support skill-specific env/apiKey injection
- **SHOULD** integrate with ClawHub registry

### 2.5 Browser Control

#### FR-B01: Managed Browser
- **MUST** support isolated `openclaw` profile
- **MUST** launch and control via CDP
- **MUST** support tab management (list, open, focus, close)
- **MUST** support actions (click, type, press, hover, drag, select)
- **MUST** support snapshots and screenshots

#### FR-B02: Chrome Extension Relay
- **SHOULD** support `chrome` profile via extension
- **SHOULD** relay commands to attached tabs

### 2.6 Companion Apps (Nodes)

#### FR-N01: Node Protocol
- **MUST** connect to Gateway with role="node"
- **MUST** declare capabilities and permissions
- **MUST** support device pairing with approval

#### FR-N02: Node Commands
- **SHOULD** support `system.run` (macOS only)
- **SHOULD** support `system.notify`
- **SHOULD** support `camera.snap` and `camera.clip`
- **SHOULD** support `screen.record`
- **SHOULD** support `location.get`
- **SHOULD** support Canvas rendering

---

## 3. NON-FUNCTIONAL REQUIREMENTS

### 3.1 Performance
- Gateway startup: < 5 seconds
- Message latency (receive to response start): < 2 seconds
- Tool execution overhead: < 100ms
- Session load time: < 500ms

### 3.2 Reliability
- Gateway crash recovery via daemon (launchd/systemd)
- Session persistence survives restarts
- Cron jobs persist across restarts
- Channel reconnection on failure

### 3.3 Security
- Default: DM pairing required for unknown senders
- Exec sandboxing for non-main sessions
- No secrets in prompts or logs
- Host exec requires explicit approval

### 3.4 Scalability
- Support 500+ sessions (configurable cap)
- Support 10+ concurrent channels
- Support multiple companion app nodes
- Support multi-agent routing

### 3.5 Maintainability
- TypeScript with strict types
- JSON Schema for protocol validation
- Hot-reload configuration
- Comprehensive logging with levels

---

## 4. TECHNICAL SPECIFICATIONS

### 4.1 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js ≥22 | Modern ES modules, native fetch |
| Language | TypeScript | Type safety, IDE support |
| Build | tsdown + pnpm | Fast builds, monorepo support |
| Protocol | WebSocket | Real-time bidirectional |
| Config | JSON5 | Comments, trailing commas |
| Database | SQLite-vec | Vector search, embedded |
| Schema | TypeBox | Runtime + compile-time types |

### 4.2 Project Structure

```
openclaw/
├── src/
│   ├── gateway/                 # Gateway server
│   │   ├── server.ts           # WS + HTTP server
│   │   ├── protocol.ts         # Frame handling
│   │   ├── session-manager.ts  # Session CRUD
│   │   ├── channel-router.ts   # Message routing
│   │   ├── cron-scheduler.ts   # Job scheduling
│   │   └── config-manager.ts   # Config loading
│   │
│   ├── agents/                  # Agent runtime
│   │   ├── pi-embedded-runner/ # Pi SDK integration
│   │   ├── tools/              # Tool implementations
│   │   ├── skills/             # Skill loading
│   │   ├── system-prompt.ts    # Prompt building
│   │   └── model-catalog.ts    # Model registry
│   │
│   ├── channels/               # Core channels
│   │   ├── whatsapp.ts
│   │   ├── telegram.ts
│   │   ├── discord.ts
│   │   ├── slack.ts
│   │   └── webchat.ts
│   │
│   ├── plugins/                # Plugin system
│   │   ├── loader.ts
│   │   └── registry.ts
│   │
│   ├── cli/                    # CLI commands
│   │   ├── gateway.ts
│   │   ├── agent.ts
│   │   ├── config.ts
│   │   ├── cron.ts
│   │   └── channels.ts
│   │
│   └── shared/                 # Shared utilities
│       ├── types.ts
│       ├── logger.ts
│       └── utils.ts
│
├── extensions/                  # Extension channels
│   ├── signal/
│   ├── bluebubbles/
│   ├── msteams/
│   └── ...
│
├── skills/                      # Bundled skills
│   ├── weather/
│   ├── github/
│   └── ...
│
├── apps/                        # Companion apps
│   ├── macos/
│   ├── ios/
│   └── android/
│
├── ui/                          # Control UI + WebChat
│
├── docs/                        # Documentation
│
├── test/                        # Test suites
│
├── package.json
├── tsconfig.json
└── openclaw.mjs                 # CLI entry point
```

### 4.3 Key Interfaces

#### Gateway Protocol Frame
```typescript
// Request
interface RequestFrame {
  type: "req";
  id: string;           // UUID for correlation
  method: string;       // "connect", "agent", "send", etc.
  params: Record<string, unknown>;
}

// Response
interface ResponseFrame {
  type: "res";
  id: string;           // Matches request
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

// Event
interface EventFrame {
  type: "event";
  event: string;        // "agent", "chat", "presence", etc.
  payload: unknown;
  seq?: number;
  stateVersion?: number;
}
```

#### Channel Plugin Interface
```typescript
interface ChannelPlugin {
  name: string;
  
  // Lifecycle
  initialize(config: ChannelConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Messaging
  send(target: Target, message: OutboundMessage): Promise<SendResult>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  
  // Optional
  onTyping?(handler: (typing: TypingEvent) => void): void;
  onReaction?(handler: (reaction: ReactionEvent) => void): void;
}
```

#### Tool Interface
```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  
  execute(
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

interface ToolContext {
  sessionKey: string;
  workdir: string;
  config: OpenClawConfig;
  abortSignal: AbortSignal;
}
```

#### Skill Format
```typescript
interface SkillManifest {
  name: string;
  description: string;
  metadata?: {
    openclaw?: {
      requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
      };
      primaryEnv?: string;
      always?: boolean;
      os?: ("darwin" | "linux" | "win32")[];
    };
  };
}
```

### 4.4 Data Models

#### Session Store Entry
```typescript
interface SessionEntry {
  sessionId: string;
  sessionKey: string;
  createdAt: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  displayName?: string;
  channel?: string;
  origin?: {
    label: string;
    routing: Record<string, unknown>;
  };
}
```

#### Cron Job
```typescript
interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: "cron" | "every" | "at";
    value: string;
    tz?: string;
  };
  sessionTarget: "main" | "isolated";
  payload: {
    kind: "systemEvent" | "agentTurn";
    content: string;
  };
  delivery?: {
    mode: "announce" | "webhook" | "none";
    channel?: string;
    to?: string;
  };
  deleteAfterRun?: boolean;
  lastRun?: string;
  nextRun?: string;
}
```

---

## 5. IMPLEMENTATION PHASES

### Phase 1: Core Foundation (4-6 weeks)
- [ ] Gateway WebSocket server
- [ ] Basic protocol (connect, health, status)
- [ ] Config management with JSON5
- [ ] Session management (create, load, save)
- [ ] Single channel integration (Telegram)
- [ ] Pi SDK integration for agent runtime
- [ ] Basic exec tool

**Deliverable:** Working assistant on Telegram with shell access

### Phase 2: Multi-Channel (3-4 weeks)
- [ ] WhatsApp integration (Baileys)
- [ ] Discord integration
- [ ] Slack integration
- [ ] Channel router with DM policies
- [ ] Message chunking and threading
- [ ] Media handling (images, audio)

**Deliverable:** Assistant accessible on 4+ channels

### Phase 3: Tools & Automation (3-4 weeks)
- [ ] Full tool suite (read, write, edit, web_*)
- [ ] Browser control with CDP
- [ ] Cron scheduler with persistence
- [ ] Heartbeat system
- [ ] Webhook handlers

**Deliverable:** Fully capable automation platform

### Phase 4: Skills & Extensions (2-3 weeks)
- [ ] Skill loading system
- [ ] Plugin architecture
- [ ] Extension channels (Signal, iMessage)
- [ ] ClawHub integration

**Deliverable:** Extensible platform with skill ecosystem

### Phase 5: Companion Apps (4-6 weeks)
- [ ] macOS menu bar app
- [ ] Node protocol implementation
- [ ] Voice Wake / Talk Mode
- [ ] Canvas rendering
- [ ] iOS/Android apps

**Deliverable:** Full multi-device experience

### Phase 6: Polish & Security (2-3 weeks)
- [ ] Sandboxing (Docker)
- [ ] Exec approvals
- [ ] Session maintenance
- [ ] Logging and diagnostics
- [ ] Documentation

**Deliverable:** Production-ready platform

---

## 6. ENHANCEMENT OPPORTUNITIES

### 6.1 For Tiger Claw / Alien Claw
Based on your existing work, here's how OpenClaw could be enhanced for your use case:

| Enhancement | Purpose |
|-------------|---------|
| **Flavor System** | Profession-specific tool loadouts |
| **Prospect Discovery** | Automated lead finding via social APIs |
| **Nurture Sequences** | Multi-touch follow-up automation |
| **Brain State Machine** | Coaching conversation flows |
| **Multi-tenant** | One codebase, many customer bots |

### 6.2 Architecture Modifications for Multi-Tenant

```
                    ┌─────────────────────────────────┐
                    │      TENANT ROUTER              │
                    │  (Bot Token → Tenant Config)    │
                    └───────────────┬─────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Tenant A      │      │   Tenant B      │      │   Tenant C      │
│   (Debbie)      │      │   (Nancy)       │      │   (Pat)         │
│   Flavor: NM    │      │   Flavor: NM    │      │   Flavor: NM    │
│   LLM: Claude   │      │   LLM: Gemini   │      │   LLM: GPT      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

### 6.3 Pre-Dev Enhancement Checklist

For your pre-dev session, consider these enhancements:

1. **Multi-tenant support** — Route by bot token to tenant config
2. **Flavor database** — Store profession configs with hot-swap
3. **Key management** — Primary + fallback API keys per tenant
4. **Prospect tools** — Reddit, Facebook, LinkedIn scrapers
5. **Conversation state machine** — Onboarding flows, coaching scripts
6. **Webhook provisioning** — Auto-create bots on purchase
7. **Admin dashboard** — Tenant management, usage tracking
8. **Thai market support** — LINE integration, localization

---

## 7. TESTING STRATEGY

### 7.1 Unit Tests
- Tool implementations
- Config parsing
- Protocol frame validation
- Session management

### 7.2 Integration Tests
- Channel round-trips
- Cron job execution
- Browser automation
- Multi-agent messaging

### 7.3 E2E Tests
- Full message lifecycle
- Docker sandbox execution
- Companion app pairing

---

## 8. SUCCESS METRICS

| Metric | Target |
|--------|--------|
| Message latency (p95) | < 3s |
| Tool execution success | > 99% |
| Gateway uptime | > 99.9% |
| Channel connection stability | > 99% |
| Session data integrity | 100% |

---

## 9. RISKS & MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp ban | High | Use linked device, respect rate limits |
| Model API failures | Medium | Implement failover, multiple providers |
| Context overflow | Medium | Auto-compaction, token tracking |
| Security breach | High | Sandboxing, exec approvals, pairing |
| Data loss | High | Persistent storage, backup strategies |

---

## 10. APPENDICES

### A. Configuration Reference
See: `~/.npm-global/lib/node_modules/openclaw/docs/gateway/configuration-reference.md`

### B. Protocol Schema
See: `dist/protocol.schema.json`

### C. Tool Definitions
See: `src/agents/tools/`

### D. Skill Specification
See: https://agentskills.io

---

*This PRD is designed as a build specification. Use with pre-dev tools to generate implementation scaffolding.*
