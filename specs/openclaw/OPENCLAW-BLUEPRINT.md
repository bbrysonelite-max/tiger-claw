# OpenClaw Architecture Blueprint

**Version:** 2026.2.23  
**Analysis Date:** February 26, 2026  
**Analyst:** Birdie 🐦

---

## Executive Summary

OpenClaw is a **personal AI assistant platform** that runs locally on your devices and connects to messaging channels you already use. Unlike cloud-hosted assistants, OpenClaw gives you full control: your data stays local, your conversations are private, and you can customize everything.

**Core Philosophy:** "The Gateway is just the control plane — the product is the assistant."

---

## 1. HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MESSAGING SURFACES                            │
│  WhatsApp │ Telegram │ Discord │ Slack │ Signal │ iMessage │ WebChat   │
│  Google Chat │ Microsoft Teams │ Matrix │ Zalo │ IRC │ LINE             │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          GATEWAY (Control Plane)                        │
│                        ws://127.0.0.1:18789                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   Session   │  │   Channel   │  │    Tool     │  │    Event    │   │
│  │   Manager   │  │   Router    │  │   Registry  │  │   System    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │    Cron     │  │   Config    │  │   Webhook   │  │    Auth     │   │
│  │  Scheduler  │  │   Manager   │  │   Handler   │  │   System    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Pi Agent      │    │    CLI/TUI      │    │   Companion     │
│   (RPC Mode)    │    │   Interface     │    │     Apps        │
│                 │    │                 │    │ (macOS/iOS/     │
│  Model Routing  │    │  openclaw ...   │    │  Android)       │
│  Tool Execution │    │                 │    │                 │
│  Context Mgmt   │    │                 │    │  Voice Wake     │
└─────────────────┘    └─────────────────┘    │  Talk Mode      │
                                              │  Canvas         │
                                              └─────────────────┘
```

---

## 2. CORE COMPONENTS

### 2.1 Gateway (The Brain)

**Location:** `src/gateway/` → compiled to `dist/`  
**Default Port:** 18789 (configurable)  
**Protocol:** WebSocket + HTTP

The Gateway is the central control plane:

| Subsystem | Purpose |
|-----------|---------|
| **Session Manager** | Tracks conversations, context, token counts |
| **Channel Router** | Routes messages to/from messaging platforms |
| **Tool Registry** | Manages available tools and permissions |
| **Event System** | Pub/sub for agent, chat, presence, health events |
| **Cron Scheduler** | Persisted job scheduling with wakeups |
| **Config Manager** | JSON5 config with hot-reload |
| **Auth System** | Device pairing, tokens, DM policies |

**Key Files:**
- `dist/gateway-cli-*.js` - Gateway CLI entry
- `dist/service-*.js` - Core service logic
- `dist/manager-*.js` - Session/state management
- `~/.openclaw/openclaw.json` - Configuration

### 2.2 Pi Agent SDK Integration

**Dependencies:**
```json
{
  "@mariozechner/pi-agent-core": "0.54.1",
  "@mariozechner/pi-ai": "0.54.1",
  "@mariozechner/pi-coding-agent": "0.54.1",
  "@mariozechner/pi-tui": "0.54.1"
}
```

OpenClaw embeds the Pi SDK directly (not subprocess/RPC). This provides:

| Feature | Implementation |
|---------|---------------|
| **Session Creation** | `createAgentSession()` from pi-coding-agent |
| **Tool Injection** | Custom OpenClaw tools merged with Pi builtins |
| **System Prompts** | Dynamic per-channel/context prompts |
| **Model Switching** | Runtime model changes with failover |
| **Auth Profiles** | Rotate OAuth vs API keys |

**Agent File Structure:**
```
src/agents/
├── pi-embedded-runner/          # Main agent runner
│   ├── run.ts                   # Entry point
│   ├── attempt.ts               # Single run attempt
│   ├── model.ts                 # Model resolution
│   ├── system-prompt.ts         # Prompt building
│   └── tools/                   # Tool implementations
├── pi-tools.ts                  # createOpenClawCodingTools()
├── auth-profiles.ts             # Profile store + failover
├── model-catalog.ts             # Model registry
└── skills/                      # Skill loading
```

### 2.3 Channel Plugins

OpenClaw supports **18+ messaging platforms** via a plugin architecture:

**Core Channels (Built-in):**
| Channel | Library | Config Key |
|---------|---------|------------|
| WhatsApp | `@whiskeysockets/baileys` | `channels.whatsapp` |
| Telegram | `grammy` | `channels.telegram` |
| Discord | `discord.js` | `channels.discord` |
| Slack | `@slack/bolt` | `channels.slack` |
| WebChat | Built-in HTTP | `webchat` |

**Extension Channels:**
| Channel | Location |
|---------|----------|
| Signal | `extensions/signal/` |
| iMessage (BlueBubbles) | `extensions/bluebubbles/` |
| iMessage (Legacy) | `extensions/imessage/` |
| Microsoft Teams | `extensions/msteams/` |
| Google Chat | `extensions/googlechat/` |
| Matrix | `extensions/matrix/` |
| LINE | `extensions/line/` |
| Zalo | `extensions/zalo/` |
| IRC | `extensions/irc/` |
| Twitch | `extensions/twitch/` |
| Mattermost | `extensions/mattermost/` |
| Nostr | `extensions/nostr/` |

**Channel Interface Pattern:**
```typescript
interface ChannelPlugin {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(target: string, message: Message): Promise<void>;
  onMessage(handler: MessageHandler): void;
}
```

### 2.4 Tools System

**Core Tools (Always Available):**

| Tool | Purpose |
|------|---------|
| `exec` | Shell command execution |
| `process` | Background session management |
| `read` | File reading |
| `write` | File creation/overwrite |
| `edit` | Precise text editing |
| `web_search` | Brave Search API |
| `web_fetch` | URL content extraction |

**Platform Tools:**

| Tool | Purpose |
|------|---------|
| `browser` | CDP-based browser automation |
| `canvas` | A2UI visual workspace |
| `nodes` | Companion app control |
| `cron` | Job scheduling |
| `message` | Cross-channel messaging |
| `tts` | Text-to-speech |

**Agent Tools:**

| Tool | Purpose |
|------|---------|
| `sessions_list` | Discover active sessions |
| `sessions_history` | Fetch transcripts |
| `sessions_send` | Cross-session messaging |
| `sessions_spawn` | Sub-agent creation |
| `subagents` | Orchestration (list/steer/kill) |
| `memory_search` | Semantic memory recall |
| `memory_get` | Memory snippet retrieval |

### 2.5 Skills System

**Locations (Precedence Order):**
1. `<workspace>/skills/` (highest)
2. `~/.openclaw/skills/` (managed)
3. Bundled skills (lowest)

**Skill Format (AgentSkills-compatible):**
```markdown
---
name: weather
description: Get weather and forecasts via wttr.in
metadata: {"openclaw": {"requires": {"bins": ["curl"]}}}
---

# Weather Skill Instructions

Use curl to fetch weather from wttr.in...
```

**52 Bundled Skills Including:**
- 1password, github, coding-agent
- weather, openai-image-gen, openai-whisper-api
- discord, slack, trello, notion
- camsnap, canvas, video-frames
- And many more...

### 2.6 Extensions System

**Extension Types:**

| Type | Purpose | Location |
|------|---------|----------|
| Channel | Messaging platform integration | `extensions/<channel>/` |
| Memory | Semantic search/storage | `extensions/memory-*/` |
| Voice | Voice call handling | `extensions/voice-call/` |
| Auth | OAuth portal integrations | `extensions/*-auth/` |
| Misc | Device pairing, diagnostics | `extensions/*/` |

**Extension Manifest (`openclaw.plugin.json`):**
```json
{
  "name": "telegram",
  "description": "Telegram channel integration",
  "main": "dist/index.js",
  "skills": ["skills/telegram"]
}
```

### 2.7 Companion Apps (Nodes)

**macOS App:**
- Menu bar control plane
- Voice Wake + Push-to-Talk
- WebChat embedded
- Remote gateway control
- Canvas host

**iOS App:**
- Node pairing via Bonjour
- Voice Wake + Talk Mode
- Camera snap/clip
- Screen recording
- Location services

**Android App:**
- Same capabilities as iOS
- Optional SMS integration

**Node Protocol:**
```typescript
// Nodes connect with role: "node"
interface NodeCapabilities {
  commands: ["canvas.*", "camera.*", "screen.record", "location.get"];
  permissions: { camera: "authorized", location: "authorized" };
}
```

---

## 3. DATA FLOW

### 3.1 Message Lifecycle

```
1. USER sends message on WhatsApp
         │
         ▼
2. BAILEYS library receives message
         │
         ▼
3. CHANNEL ROUTER identifies session
         │
         ▼
4. SESSION MANAGER loads context
         │
         ▼
5. PI AGENT processes with tools
         │
         ▼
6. RESPONSE chunks streamed back
         │
         ▼
7. CHANNEL ROUTER sends to WhatsApp
         │
         ▼
8. USER sees response
```

### 3.2 Tool Execution Flow

```
1. MODEL requests tool call (e.g., exec)
         │
         ▼
2. TOOL REGISTRY validates permissions
         │
         ▼
3. SANDBOX POLICY checked (main vs sandbox)
         │
         ▼
4. TOOL EXECUTOR runs command
         │
         ▼
5. RESULT returned to model
         │
         ▼
6. MODEL continues or responds
```

---

## 4. CONFIGURATION SYSTEM

**Config File:** `~/.openclaw/openclaw.json` (JSON5)

**Key Sections:**
```json5
{
  // Agent defaults
  agents: {
    defaults: {
      model: "anthropic/claude-opus-4-6",
      workspace: "~/.openclaw/workspace",
      heartbeat: { every: "30m" },
      sandbox: { mode: "non-main" }
    }
  },
  
  // Channel configurations
  channels: {
    whatsapp: { allowFrom: ["+1234567890"] },
    telegram: { botToken: "123:abc" },
    discord: { token: "xyz" }
  },
  
  // Gateway settings
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: { mode: "password" }
  },
  
  // Tool settings
  tools: {
    exec: { host: "sandbox", security: "allowlist" },
    browser: { enabled: true, defaultProfile: "openclaw" }
  },
  
  // Session management
  session: {
    dmScope: "per-channel-peer",
    maintenance: { mode: "enforce", pruneAfter: "30d" }
  }
}
```

---

## 5. SECURITY MODEL

### 5.1 DM Policies
- `pairing` (default): Unknown senders get pairing code
- `allowlist`: Only approved senders
- `open`: All inbound (requires explicit opt-in)
- `disabled`: Ignore all DMs

### 5.2 Sandboxing
- Main session: Full host access
- Non-main (groups): Docker sandboxes
- Tool allowlist/denylist per session type

### 5.3 Exec Security
- `deny`: Block all exec
- `allowlist`: Only approved commands
- `full`: Allow everything (elevated only)

---

## 6. FILE STRUCTURE

```
~/.openclaw/
├── openclaw.json              # Main config
├── credentials/               # Channel auth (WhatsApp, etc.)
├── agents/
│   └── <agentId>/
│       ├── sessions/
│       │   ├── sessions.json  # Session store
│       │   └── *.jsonl        # Transcripts
│       └── workspace/         # Agent workspace
│           ├── AGENTS.md
│           ├── SOUL.md
│           ├── TOOLS.md
│           ├── MEMORY.md
│           ├── memory/
│           └── skills/
├── skills/                    # Managed skills
├── cron/
│   └── jobs.json              # Scheduled jobs
├── logs/                      # Gateway logs
└── exec-approvals.json        # Exec allowlist
```

---

## 7. TECHNOLOGY STACK

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js ≥22 |
| **Language** | TypeScript (compiled to JS) |
| **Build** | tsdown, pnpm |
| **Protocol** | WebSocket (JSON frames) |
| **Database** | SQLite-vec (memory), JSON files |
| **Browser** | Playwright-core (CDP) |
| **TTS** | ElevenLabs, Edge TTS |
| **STT** | OpenAI Whisper |
| **LLM** | Anthropic, OpenAI, Google, custom |

**Key Dependencies:**
- `@whiskeysockets/baileys` - WhatsApp
- `grammy` - Telegram
- `discord.js` - Discord
- `@slack/bolt` - Slack
- `playwright-core` - Browser automation
- `sharp` - Image processing
- `sqlite-vec` - Vector search

---

## 8. SCALING CHARACTERISTICS

| Aspect | Current Design |
|--------|---------------|
| **Users** | Single-user (personal assistant) |
| **Gateway** | One per host |
| **Sessions** | Hundreds (maintenance caps at 500 default) |
| **Channels** | Multiple concurrent |
| **Agents** | Multi-agent supported |
| **Nodes** | Multiple companion apps |

---

## 9. EXTENSION POINTS

### For Building On Top:
1. **Custom Skills** - Drop in `<workspace>/skills/`
2. **Channel Plugins** - Implement channel interface
3. **Tool Plugins** - Add via plugin manifest
4. **Webhook Handlers** - Gateway webhook routes
5. **A2UI Apps** - Canvas visual applications

### For Forking/Modifying:
1. **Pi SDK** - Core agent behavior
2. **Gateway Protocol** - WS API extensions
3. **System Prompts** - Agent personality
4. **Tool Implementations** - Custom tool logic

---

*This blueprint reflects OpenClaw v2026.2.23. Architecture may evolve.*
