# OpenClaw C4 Architecture Diagrams

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. CONTEXT DIAGRAM (Level 1)

*Shows the system in its environment — who uses it and what it connects to.*

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   CONTEXT DIAGRAM                                    │
│                                     OpenClaw                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────┐
                                    │    Owner    │
                                    │   (Human)   │
                                    │             │
                                    │ Configures, │
                                    │  monitors,  │
                                    │  approves   │
                                    └──────┬──────┘
                                           │
                                           │ CLI / WebChat / macOS App
                                           ▼
┌─────────────┐    Messages     ┌─────────────────────────┐     API Calls    ┌─────────────┐
│  End Users  │ ───────────────>│                         │<────────────────>│ LLM Providers│
│             │                 │                         │                  │             │
│  WhatsApp   │                 │       OPENCLAW          │                  │  Anthropic  │
│  Telegram   │<───────────────>│                         │                  │  OpenAI     │
│  Discord    │    Responses    │   Personal AI Assistant │                  │  Google     │
│  Slack      │                 │                         │                  │  Custom     │
│  Signal     │                 │                         │                  └─────────────┘
│  iMessage   │                 │                         │
└─────────────┘                 │                         │     Web Requests  ┌─────────────┐
                                │                         │<────────────────>│   Internet  │
                                │                         │                  │             │
┌─────────────┐                 │                         │                  │  Websites   │
│   Nodes     │<───────────────>│                         │                  │  APIs       │
│             │   Commands      └─────────────────────────┘                  │  Services   │
│  macOS App  │                                                              └─────────────┘
│  iOS App    │                            │
│  Android    │                            │ Executes
└─────────────┘                            ▼
                                    ┌─────────────┐
                                    │ Host System │
                                    │             │
                                    │ File System │
                                    │  Processes  │
                                    │   Network   │
                                    └─────────────┘
```

### Context Entities

| Entity | Type | Description |
|--------|------|-------------|
| Owner | Person | Configures OpenClaw, approves operations, monitors health |
| End Users | People | Send messages via messaging platforms, receive AI responses |
| Nodes | Systems | Companion apps that provide device capabilities |
| LLM Providers | External Systems | AI model APIs (Anthropic, OpenAI, Google) |
| Internet | External System | Web content, external APIs, webhooks |
| Host System | Infrastructure | Local machine where OpenClaw runs |

---

## 2. CONTAINER DIAGRAM (Level 2)

*Shows the high-level technology choices and how containers communicate.*

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  CONTAINER DIAGRAM                                   │
│                                     OpenClaw                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐           │
│  │   CLI Client     │     │   macOS App      │     │    WebChat       │           │
│  │                  │     │                  │     │                  │           │
│  │  Node.js/TS      │     │  Swift/SwiftUI   │     │  Lit/TypeScript  │           │
│  │  Commander       │     │  Menu Bar        │     │  Browser SPA     │           │
│  └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘           │
│           │                        │                        │                      │
│           │         WebSocket (JSON frames)                 │                      │
│           └────────────────────────┼────────────────────────┘                      │
│                                    ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                            GATEWAY                                           │  │
│  │                         [Container]                                          │  │
│  │                                                                              │  │
│  │   Node.js 22+ / TypeScript                                                   │  │
│  │   WebSocket Server (ws)                                                      │  │
│  │   HTTP Server (Express)                                                      │  │
│  │   Port: 18789                                                                │  │
│  │                                                                              │  │
│  │   Responsibilities:                                                          │  │
│  │   • Protocol handling (connect, agent, send)                                 │  │
│  │   • Session management                                                       │  │
│  │   • Channel routing                                                          │  │
│  │   • Tool orchestration                                                       │  │
│  │   • Cron scheduling                                                          │  │
│  │   • Config management                                                        │  │
│  │                                                                              │  │
│  └───────────┬──────────────────┬──────────────────┬──────────────────┬────────┘  │
│              │                  │                  │                  │            │
│              ▼                  ▼                  ▼                  ▼            │
│  ┌───────────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────────┐  │
│  │  Channel Plugins  │ │ Agent Runtime │ │  Tool Layer   │ │   Data Stores     │  │
│  │   [Container]     │ │  [Container]  │ │  [Container]  │ │   [Container]     │  │
│  │                   │ │               │ │               │ │                   │  │
│  │ • WhatsApp        │ │ Pi SDK        │ │ • Exec        │ │ • Sessions (SQLite)│ │
│  │   (Baileys)       │ │ (embedded)    │ │ • Browser     │ │ • Transcripts     │  │
│  │ • Telegram        │ │               │ │   (Playwright)│ │   (JSONL)         │  │
│  │   (grammY)        │ │ Handles:      │ │ • Web Fetch   │ │ • Memory          │  │
│  │ • Discord         │ │ • Prompts     │ │ • Cron        │ │   (SQLite-vec)    │  │
│  │   (discord.js)    │ │ • Tool calls  │ │ • Message     │ │ • Config (JSON5)  │  │
│  │ • Slack (Bolt)    │ │ • Streaming   │ │ • Sessions    │ │ • Credentials     │  │
│  │ • Signal          │ │ • Context     │ │ • Nodes       │ │                   │  │
│  │ • Extensions...   │ │               │ │               │ │                   │  │
│  └─────────┬─────────┘ └───────┬───────┘ └───────┬───────┘ └─────────┬─────────┘  │
│            │                   │                 │                   │            │
└────────────┼───────────────────┼─────────────────┼───────────────────┼────────────┘
             │                   │                 │                   │
             ▼                   ▼                 ▼                   ▼
     ┌───────────────┐   ┌───────────────┐   ┌──────────┐   ┌──────────────────┐
     │   Messaging   │   │ LLM Provider  │   │  Browser │   │   File System    │
     │   Platforms   │   │     APIs      │   │ (Chrome) │   │   ~/.openclaw/   │
     │               │   │               │   │          │   │                  │
     │  [External]   │   │  [External]   │   │ [Local]  │   │    [Local]       │
     └───────────────┘   └───────────────┘   └──────────┘   └──────────────────┘
```

### Container Specifications

| Container | Technology | Purpose | Scaling |
|-----------|------------|---------|---------|
| Gateway | Node.js 22+, TypeScript | Central control plane | Single instance per host |
| CLI Client | Node.js, Commander | User interaction | N/A (on-demand) |
| macOS App | Swift, SwiftUI | GUI + Voice Wake | Single per Mac |
| WebChat | Lit, TypeScript | Browser-based chat | Served by Gateway |
| Channel Plugins | Various SDKs | Messaging integration | One per channel |
| Agent Runtime | Pi SDK (embedded) | AI processing | Per-session |
| Tool Layer | TypeScript | Capability execution | Shared |
| Data Stores | SQLite, JSON | Persistence | Local files |

---

## 3. COMPONENT DIAGRAM (Level 3)

### 3.1 Gateway Components

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            GATEWAY COMPONENT DIAGRAM                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                          │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           TRANSPORT LAYER                                    │   │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │   │
│  │  │  WebSocket Server │  │   HTTP Server     │  │  Protocol Handler │       │   │
│  │  │                   │  │                   │  │                   │       │   │
│  │  │ • Connection mgmt │  │ • Health endpoint │  │ • Frame validation│       │   │
│  │  │ • Frame routing   │  │ • Webhook receive │  │ • Request/Response│       │   │
│  │  │ • Auth handshake  │  │ • Static serving  │  │ • Event broadcast │       │   │
│  │  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘       │   │
│  └────────────┼──────────────────────┼──────────────────────┼──────────────────┘   │
│               │                      │                      │                      │
│               └──────────────────────┼──────────────────────┘                      │
│                                      ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           CORE SERVICES                                      │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Session Manager │  │ Channel Router  │  │  Auth Service   │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Create/load   │  │ • Inbound route │  │ • Token validate│             │   │
│  │  │ • Update tokens │  │ • Outbound route│  │ • Device pairing│             │   │
│  │  │ • Maintenance   │  │ • DM policies   │  │ • Scopes        │             │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │   │
│  │           │                    │                    │                       │   │
│  │  ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐             │   │
│  │  │  Cron Scheduler │  │  Config Manager │  │ Presence Manager│             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Job storage   │  │ • Load/validate │  │ • Client track  │             │   │
│  │  │ • Timer mgmt    │  │ • Hot reload    │  │ • Health status │             │   │
│  │  │ • Execution     │  │ • Migration     │  │ • Broadcast     │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                             │
│                                      ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           INTEGRATION LAYER                                  │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Agent Invoker   │  │  Tool Registry  │  │ Channel Manager │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Session setup │  │ • Tool catalog  │  │ • Plugin loader │             │   │
│  │  │ • Run agent     │  │ • Policy apply  │  │ • Lifecycle     │             │   │
│  │  │ • Stream results│  │ • Execution     │  │ • Status        │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Runtime Components

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT RUNTIME COMPONENT DIAGRAM                              │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                 AGENT RUNTIME                                       │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                              PI SDK LAYER                                    │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Session Manager │  │   Model Router  │  │   Tool Executor │             │   │
│  │  │ (pi-coding-     │  │                 │  │                 │             │   │
│  │  │  agent)         │  │ • Provider APIs │  │ • Call dispatch │             │   │
│  │  │                 │  │ • Failover      │  │ • Result capture│             │   │
│  │  │ • createSession │  │ • Auth profiles │  │ • Timeout mgmt  │             │   │
│  │  │ • Context mgmt  │  │ • Rate limiting │  │                 │             │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │   │
│  └───────────┼───────────────────┼───────────────────┼─────────────────────────┘   │
│              │                   │                   │                             │
│              ▼                   ▼                   ▼                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           OPENCLAW LAYER                                     │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Prompt Builder  │  │  Skill Loader   │  │  Tool Injector  │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • System prompt │  │ • Load skills   │  │ • Core tools    │             │   │
│  │  │ • Workspace     │  │ • Gate check    │  │ • Channel tools │             │   │
│  │  │ • Context files │  │ • Prompt build  │  │ • Custom tools  │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Context Manager │  │ Stream Handler  │  │ Error Handler   │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Window guard  │  │ • Chunk text    │  │ • Classify      │             │   │
│  │  │ • Compaction    │  │ • Deliver       │  │ • Retry/fail    │             │   │
│  │  │ • Pruning       │  │ • Progress      │  │ • Degrade       │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Channel Plugin Components

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        CHANNEL PLUGIN COMPONENT DIAGRAM                              │
│                              (Telegram Example)                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              TELEGRAM PLUGIN                                        │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                            ADAPTER LAYER                                     │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Messaging       │  │ Outbound        │  │ Status          │             │   │
│  │  │ Adapter         │  │ Adapter         │  │ Adapter         │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Parse updates │  │ • Send message  │  │ • Connection    │             │   │
│  │  │ • Extract media │  │ • Upload media  │  │ • Health        │             │   │
│  │  │ • Build inbound │  │ • Edit message  │  │ • Metrics       │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                             │
│                                      ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                            grammY SDK                                        │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ Bot Instance    │  │ Update Handler  │  │ API Client      │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • Token auth    │  │ • Middleware    │  │ • sendMessage   │             │   │
│  │  │ • Polling/hook  │  │ • Routing       │  │ • getUpdates    │             │   │
│  │  │ • Error handler │  │ • Filters       │  │ • setWebhook    │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                             │
│                                      ▼                                             │
│                              Telegram Bot API                                      │
│                              (api.telegram.org)                                    │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. CODE DIAGRAM (Level 4)

### 4.1 Key Module Relationships

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CODE DIAGRAM                                            │
│                          Key Module Dependencies                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

src/
├── gateway/
│   ├── server.ts ─────────────────┐
│   │   imports:                   │
│   │   • protocol.ts              │
│   │   • session-manager.ts       │
│   │   • channel-router.ts        │
│   │   • auth.ts                  │
│   │                              │
│   ├── protocol.ts ◄──────────────┤
│   │   imports:                   │
│   │   • @sinclair/typebox        │
│   │   • types.ts                 │
│   │                              │
│   ├── session-manager.ts ◄───────┤
│   │   imports:                   │
│   │   • store.ts                 │
│   │   • transcript.ts            │
│   │                              │
│   └── channel-router.ts ◄────────┘
│       imports:
│       • channels/index.ts
│       • pairing-store.ts
│
├── agents/
│   ├── pi-embedded-runner.ts ─────┐
│   │   imports:                   │
│   │   • @mariozechner/pi-*       │
│   │   • system-prompt.ts         │
│   │   • model-router.ts          │
│   │   • tools/index.ts           │
│   │                              │
│   ├── system-prompt.ts ◄─────────┤
│   │   imports:                   │
│   │   • skills/loader.ts         │
│   │   • workspace.ts             │
│   │                              │
│   ├── model-router.ts ◄──────────┤
│   │   imports:                   │
│   │   • auth-profiles.ts         │
│   │   • circuit-breaker.ts       │
│   │                              │
│   └── tools/
│       ├── index.ts ◄─────────────┘
│       │   exports:
│       │   • exec-tool.ts
│       │   • browser-tool.ts
│       │   • web-tools.ts
│       │   • session-tools.ts
│       │
│       ├── exec-tool.ts
│       │   imports:
│       │   • sandbox.ts
│       │   • approvals.ts
│       │
│       └── browser-tool.ts
│           imports:
│           • playwright-core
│           • cdp-client.ts
│
├── channels/
│   ├── index.ts ──────────────────┐
│   │   exports:                   │
│   │   • whatsapp/                │
│   │   • telegram/                │
│   │   • discord/                 │
│   │   • slack/                   │
│   │                              │
│   ├── whatsapp/                  │
│   │   └── index.ts ◄─────────────┤
│   │       imports:               │
│   │       • @whiskeysockets/     │
│   │         baileys              │
│   │       • ../types.ts          │
│   │                              │
│   └── telegram/                  │
│       └── index.ts ◄─────────────┘
│           imports:
│           • grammy
│           • ../types.ts
│
└── shared/
    ├── types.ts ◄─────────────────── (imported by most modules)
    ├── logger.ts ◄────────────────── (imported by most modules)
    ├── config.ts ◄────────────────── (imported by most modules)
    └── utils.ts ◄─────────────────── (imported by most modules)
```

### 4.2 Request Flow Through Code

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW THROUGH CODE                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

Inbound Telegram Message:

1. telegram/index.ts
   │  bot.on('message', async (ctx) => {
   │    const inbound = parseUpdate(ctx);
   │    await gateway.routeInbound(inbound);
   │  });
   │
   ▼
2. gateway/channel-router.ts
   │  async routeInbound(msg: InboundMessage) {
   │    const allowed = await checkPolicy(msg);
   │    if (!allowed) return sendPairingCode(msg);
   │    const sessionKey = resolveSessionKey(msg);
   │    await invokeAgent(sessionKey, msg);
   │  }
   │
   ▼
3. gateway/session-manager.ts
   │  async getOrCreateSession(key: string) {
   │    let session = await store.load(key);
   │    if (!session) session = await store.create(key);
   │    return session;
   │  }
   │
   ▼
4. agents/pi-embedded-runner.ts
   │  async runEmbeddedPiAgent(params) {
   │    const prompt = buildSystemPrompt(params);
   │    const tools = createOpenClawTools(params);
   │    const session = await createAgentSession({...});
   │    return await session.run(params.message);
   │  }
   │
   ▼
5. agents/tools/exec-tool.ts (if tool called)
   │  async execute(params, context) {
   │    const approved = await checkApproval(params);
   │    if (!approved) return { error: 'denied' };
   │    return await sandbox.run(params.command);
   │  }
   │
   ▼
6. gateway/channel-router.ts
   │  async routeOutbound(sessionKey, response) {
   │    const channel = resolveChannel(sessionKey);
   │    await channel.send(response);
   │  }
   │
   ▼
7. telegram/index.ts
   │  async send(target, message) {
   │    await bot.api.sendMessage(target, message.text);
   │  }
```

---

## 5. DEPLOYMENT DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                             DEPLOYMENT DIAGRAM                                       │
│                            Typical Home Setup                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              HOME NETWORK                                           │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                         HOST MACHINE                                         │   │
│  │                     (Mac / Linux / Windows WSL)                              │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ OpenClaw        │  │ Chrome Browser  │  │ File System     │             │   │
│  │  │ Gateway         │  │ (CDP Controlled)│  │                 │             │   │
│  │  │                 │  │                 │  │ ~/.openclaw/    │             │   │
│  │  │ Port: 18789     │  │ Port: 18800     │  │ ├── config      │             │   │
│  │  │ (loopback)      │  │ (loopback)      │  │ ├── sessions    │             │   │
│  │  │                 │  │                 │  │ ├── credentials │             │   │
│  │  │ Process:        │  │ Profile:        │  │ └── logs        │             │   │
│  │  │ node openclaw   │  │ openclaw        │  │                 │             │   │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────────────┘             │   │
│  │           │                    │                                            │   │
│  │           │ CDP                │                                            │   │
│  │           └────────────────────┘                                            │   │
│  │                                                                              │   │
│  └──────────────────────────────────┬───────────────────────────────────────────┘   │
│                                     │                                               │
│                                     │ Tailscale / SSH Tunnel                        │
│                                     │ (optional remote access)                      │
│                                     │                                               │
│  ┌──────────────────────────────────┴───────────────────────────────────────────┐   │
│  │                         COMPANION DEVICES                                     │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │   │
│  │  │ macOS App       │  │ iPhone          │  │ Android         │             │   │
│  │  │ (Menu Bar)      │  │ (OpenClaw iOS)  │  │ (OpenClaw)      │             │   │
│  │  │                 │  │                 │  │                 │             │   │
│  │  │ • WebSocket     │  │ • WebSocket     │  │ • WebSocket     │             │   │
│  │  │ • Voice Wake    │  │ • Camera        │  │ • Camera        │             │   │
│  │  │ • Talk Mode     │  │ • Voice Wake    │  │ • Talk Mode     │             │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTPS
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                      │
│                                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                    │
│  │ Anthropic API   │  │ Telegram API    │  │ WhatsApp        │                    │
│  │ api.anthropic.  │  │ api.telegram.   │  │ (Web Protocol)  │                    │
│  │ com             │  │ org             │  │                 │                    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                    │
│                                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                    │
│  │ OpenAI API      │  │ Discord API     │  │ Slack API       │                    │
│  │ api.openai.com  │  │ discord.com/api │  │ slack.com/api   │                    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                    │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. TECHNOLOGY MAPPING

| C4 Element | Technology | Version | Purpose |
|------------|------------|---------|---------|
| Gateway | Node.js | ≥22 | Runtime |
| Gateway | TypeScript | 5.x | Language |
| Gateway | ws | 8.x | WebSocket |
| Gateway | Express | 5.x | HTTP server |
| Agent | @mariozechner/pi-* | 0.54.x | Agent SDK |
| WhatsApp | @whiskeysockets/baileys | 7.x | WhatsApp Web |
| Telegram | grammy | 1.x | Telegram Bot |
| Discord | discord.js | 14.x | Discord Bot |
| Slack | @slack/bolt | 4.x | Slack App |
| Browser | playwright-core | 1.58.x | CDP automation |
| Database | better-sqlite3 | - | SQLite |
| Vectors | sqlite-vec | 0.1.x | Vector search |
| macOS | Swift | 5.x | Native app |
| iOS | Swift | 5.x | Mobile app |
| Android | Kotlin | 1.x | Mobile app |

---

*These C4 diagrams provide a complete architectural view from context to code level.*
