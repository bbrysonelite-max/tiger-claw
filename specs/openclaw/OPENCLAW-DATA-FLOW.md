# OpenClaw Data Flow Diagrams

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. DATA INVENTORY

### 1.1 Data at Rest

| Data Type | Location | Format | Sensitivity | Retention |
|-----------|----------|--------|-------------|-----------|
| Configuration | `~/.openclaw/openclaw.json` | JSON5 | Low | Permanent |
| Session Store | `~/.openclaw/agents/*/sessions/sessions.db` | SQLite | Medium | 30 days |
| Transcripts | `~/.openclaw/agents/*/sessions/*.jsonl` | JSONL | High | 90 days |
| Memory Index | `~/.openclaw/agents/*/memory/memory.db` | SQLite | Medium | Permanent |
| Credentials | `~/.openclaw/credentials/` | Various | Critical | Permanent |
| Cron Jobs | `~/.openclaw/cron/jobs.json` | JSON | Low | Permanent |
| Exec Approvals | `~/.openclaw/exec-approvals.json` | JSON | Medium | Permanent |
| Pairing Store | `~/.openclaw/pairing/*.json` | JSON | Medium | Permanent |
| Device Auth | `~/.openclaw/device-auth/*.json` | JSON | High | Permanent |
| Logs | `~/.openclaw/logs/` | Structured | Low-Medium | 14 days |
| Dead Letter | `~/.openclaw/dead-letter/` | JSONL | High | 7 days |

### 1.2 Data in Transit

| Flow | Protocol | Encryption | Authentication |
|------|----------|------------|----------------|
| Client ↔ Gateway | WebSocket | TLS optional | Token/Device |
| Gateway ↔ LLM Provider | HTTPS | TLS 1.2+ | API Key |
| Gateway ↔ WhatsApp | WebSocket | Signal Protocol | Session |
| Gateway ↔ Telegram | HTTPS | TLS | Bot Token |
| Gateway ↔ Discord | WebSocket/HTTPS | TLS | Bot Token |
| Gateway ↔ Slack | WebSocket/HTTPS | TLS | OAuth/Token |
| Gateway ↔ Browser (CDP) | WebSocket | None (localhost) | None |
| Gateway ↔ Node | WebSocket | TLS optional | Device Token |

### 1.3 Data Classification

| Classification | Examples | Handling |
|----------------|----------|----------|
| **Critical** | API keys, tokens, credentials | Encrypted at rest, never logged |
| **High** | Message content, transcripts | Access controlled, retention limited |
| **Medium** | Session metadata, config | Standard protection |
| **Low** | Logs (sanitized), metrics | Standard handling |

---

## 2. SYSTEM CONTEXT DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          SYSTEM CONTEXT DATA FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │      User       │
                              └────────┬────────┘
                                       │
                          Chat Messages│Response Messages
                           (via apps)  │ (via apps)
                                       ▼
┌─────────────────┐          ┌─────────────────────────┐         ┌─────────────────┐
│  End Users      │◄────────►│                         │◄───────►│ LLM Providers   │
│  (Messaging)    │ Messages │      OPENCLAW           │ Prompts │                 │
│                 │          │                         │ Tokens  │ Anthropic       │
│ • WhatsApp      │          │                         │         │ OpenAI          │
│ • Telegram      │          │                         │         │ Google          │
│ • Discord       │          │                         │         └─────────────────┘
│ • Slack         │          │                         │
│ • Signal        │          │                         │         ┌─────────────────┐
└─────────────────┘          │                         │◄───────►│   Web           │
                             │                         │ HTTP    │                 │
┌─────────────────┐          │                         │         │ Websites        │
│  Owner          │◄────────►│                         │         │ APIs            │
│  (Control)      │ Commands │                         │         │ Webhooks        │
│                 │ Status   └─────────────────────────┘         └─────────────────┘
│ • CLI           │                    │
│ • macOS App     │                    │ File I/O
│ • WebChat       │                    ▼
└─────────────────┘          ┌─────────────────────────┐
                             │    Local Storage        │
┌─────────────────┐          │                         │
│  Nodes          │◄────────►│ • Sessions              │
│  (Devices)      │ Commands │ • Transcripts           │
│                 │ Data     │ • Memory                │
│ • iOS           │          │ • Credentials           │
│ • Android       │          │ • Configuration         │
│ • macOS         │          └─────────────────────────┘
└─────────────────┘
```

---

## 3. INBOUND MESSAGE DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         INBOUND MESSAGE DATA FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐
│ User sends  │
│ message on  │
│ WhatsApp    │
└──────┬──────┘
       │
       │ 1. Encrypted message (Signal Protocol)
       ▼
┌─────────────────────┐
│ WhatsApp Servers    │
└──────┬──────────────┘
       │
       │ 2. Forwarded to linked device
       ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                          │
│                                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐                │
│  │ Baileys Client  │───►│ Channel Plugin  │───►│ Channel Router  │                │
│  │                 │    │ (WhatsApp)      │    │                 │                │
│  │ Decrypts msg    │    │ Parses payload  │    │ Checks policy:  │                │
│  │                 │    │ Extracts:       │    │ • DM allowed?   │                │
│  └─────────────────┘    │ • sender        │    │ • Group allowed?│                │
│                         │ • content       │    │ • Pairing needed│                │
│  3. Decrypted           │ • media         │    │                 │                │
│     message             │ • timestamp     │    └────────┬────────┘                │
│                         └─────────────────┘             │                         │
│                                                         │ 4. Routing decision      │
│                         ┌───────────────────────────────┼───────────────────┐     │
│                         │                               │                   │     │
│                         ▼                               ▼                   ▼     │
│                  ┌─────────────┐              ┌─────────────┐      ┌───────────┐ │
│                  │ Pairing     │              │ Session     │      │ Block     │ │
│                  │ Request     │              │ Resolution  │      │ (policy)  │ │
│                  │             │              │             │      │           │ │
│                  │ Generate    │              │ Create/Load │      │ Silent    │ │
│                  │ code, store │              │ session     │      │ drop      │ │
│                  └──────┬──────┘              └──────┬──────┘      └───────────┘ │
│                         │                           │                            │
│                         │                           │ 5. Session loaded           │
│                         │                           ▼                            │
│                         │                    ┌─────────────────┐                 │
│                         │                    │ Session Store   │                 │
│                         │                    │                 │                 │
│                         │                    │ Load context:   │                 │
│                         │                    │ • history       │                 │
│                         │                    │ • token counts  │                 │
│                         │                    │ • preferences   │                 │
│                         │                    └────────┬────────┘                 │
│                         │                             │                          │
│                         │                             │ 6. Context ready          │
│                         │                             ▼                          │
│                         │                    ┌─────────────────┐                 │
│                         │                    │ Agent Invoker   │                 │
│                         │                    │                 │                 │
│                         │                    │ Build:          │                 │
│                         │                    │ • system prompt │                 │
│                         │                    │ • user message  │                 │
│                         │                    │ • tools         │                 │
│                         │                    └────────┬────────┘                 │
│                         │                             │                          │
└─────────────────────────┼─────────────────────────────┼──────────────────────────┘
                          │                             │
                          │                             │ 7. LLM request
                          │                             ▼
                          │                    ┌─────────────────┐
                          │                    │ LLM Provider    │
                          │                    │ (Anthropic)     │
                          │                    │                 │
                          │                    │ Process prompt  │
                          │                    │ Return response │
                          │                    └────────┬────────┘
                          │                             │
                          │                             │ 8. Response stream
                          │                             ▼
                          │            ┌────────────────────────────┐
                          │            │        CONTINUES TO        │
                          │            │   OUTBOUND FLOW (DFD-4)    │
                          ▼            └────────────────────────────┘
                   ┌─────────────┐
                   │ Reply with  │
                   │ pairing code│
                   └─────────────┘
```

---

## 4. OUTBOUND MESSAGE DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         OUTBOUND MESSAGE DATA FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ LLM Response    │
│ (streaming)     │
└────────┬────────┘
         │
         │ 1. Token stream
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                          │
│                                                                                     │
│  ┌─────────────────┐                                                               │
│  │ Stream Handler  │                                                               │
│  │                 │                                                               │
│  │ Buffers tokens  │                                                               │
│  │ Detects:        │                                                               │
│  │ • tool calls    │                                                               │
│  │ • end of stream │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 2. Complete response or tool call                                       │
│           ▼                                                                         │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐             │
│  │ Tool Router     │────►│ Tool Executor   │────►│ Result Handler  │             │
│  │ (if tool call)  │     │                 │     │                 │             │
│  │                 │     │ • exec          │     │ Returns to      │             │
│  │ Identifies tool │     │ • browser       │     │ agent for       │             │
│  │ Validates args  │     │ • web_fetch     │     │ continuation    │             │
│  └────────┬────────┘     │ • message       │     └─────────────────┘             │
│           │              │ • etc.          │                                      │
│           │              └─────────────────┘                                      │
│           │ 3. If text response                                                    │
│           ▼                                                                         │
│  ┌─────────────────┐                                                               │
│  │ Response        │                                                               │
│  │ Processor       │                                                               │
│  │                 │                                                               │
│  │ • Parse reply   │                                                               │
│  │   tags          │                                                               │
│  │ • Chunk for     │                                                               │
│  │   channel       │                                                               │
│  │ • Format        │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 4. Formatted response                                                   │
│           ▼                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐                                       │
│  │ Session         │───►│ Transcript      │                                       │
│  │ Updater         │    │ Writer          │                                       │
│  │                 │    │                 │                                       │
│  │ Update:         │    │ Append to       │                                       │
│  │ • token counts  │    │ JSONL file      │                                       │
│  │ • last activity │    │                 │                                       │
│  └────────┬────────┘    └─────────────────┘                                       │
│           │                                                                         │
│           │ 5. Ready to send                                                        │
│           ▼                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐                                       │
│  │ Channel Router  │───►│ Channel Plugin  │                                       │
│  │                 │    │ (WhatsApp)      │                                       │
│  │ Resolve target  │    │                 │                                       │
│  │ channel         │    │ Format for      │                                       │
│  │                 │    │ platform:       │                                       │
│  └─────────────────┘    │ • chunking      │                                       │
│                         │ • media upload  │                                       │
│                         │ • reply thread  │                                       │
│                         └────────┬────────┘                                       │
│                                  │                                                 │
└──────────────────────────────────┼─────────────────────────────────────────────────┘
                                   │
                                   │ 6. Formatted message
                                   ▼
                          ┌─────────────────┐
                          │ WhatsApp        │
                          │ Servers         │
                          │                 │
                          │ Deliver to user │
                          └────────┬────────┘
                                   │
                                   │ 7. Encrypted delivery
                                   ▼
                          ┌─────────────────┐
                          │ User receives   │
                          │ response        │
                          └─────────────────┘
```

---

## 5. TOOL EXECUTION DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          TOOL EXECUTION DATA FLOW                                    │
│                              (exec tool example)                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ Agent requests  │
│ exec tool       │
└────────┬────────┘
         │
         │ Tool call: { name: "exec", args: { command: "git status" } }
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                TOOL LAYER                                           │
│                                                                                     │
│  ┌─────────────────┐                                                               │
│  │ Tool Registry   │                                                               │
│  │                 │                                                               │
│  │ Lookup tool     │                                                               │
│  │ Validate args   │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 1. Valid tool call                                                      │
│           ▼                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐                                       │
│  │ Command         │───►│ Approval        │                                       │
│  │ Analyzer        │    │ Checker         │                                       │
│  │                 │    │                 │                                       │
│  │ Parse command   │    │ Check against:  │                                       │
│  │ Resolve paths   │    │ • allowlist     │                                       │
│  │ Check safety    │    │ • safe bins     │                                       │
│  └─────────────────┘    │ • skill rules   │                                       │
│                         └────────┬────────┘                                       │
│                                  │                                                 │
│                    ┌─────────────┼─────────────┐                                  │
│                    │             │             │                                  │
│                    ▼             ▼             ▼                                  │
│             ┌───────────┐ ┌───────────┐ ┌───────────┐                            │
│             │ Allowed   │ │ Approval  │ │ Denied    │                            │
│             │           │ │ Required  │ │           │                            │
│             │ Proceed   │ │           │ │ Return    │                            │
│             │           │ │ Request   │ │ error     │                            │
│             └─────┬─────┘ │ approval  │ └───────────┘                            │
│                   │       │ from user │                                           │
│                   │       └─────┬─────┘                                           │
│                   │             │                                                  │
│                   │             │ 2. Approval decision                             │
│                   │             ▼                                                  │
│                   │       ┌───────────────┐                                       │
│                   │       │ Approval      │                                       │
│                   │       │ Socket        │◄──────── User approves via CLI         │
│                   │       │               │                                       │
│                   │       │ Wait for      │                                       │
│                   │       │ decision      │                                       │
│                   │       └───────┬───────┘                                       │
│                   │               │                                                │
│                   └───────────────┤                                                │
│                                   │ 3. Execute command                             │
│                                   ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                           SANDBOX / HOST                                     │  │
│  │                                                                              │  │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │  │
│  │  │ Process         │───►│ Command         │───►│ Output          │         │  │
│  │  │ Spawner         │    │ Execution       │    │ Capture         │         │  │
│  │  │                 │    │                 │    │                 │         │  │
│  │  │ Create process  │    │ Run in shell    │    │ Capture:        │         │  │
│  │  │ Set timeout     │    │ Handle PTY      │    │ • stdout        │         │  │
│  │  │ Set cwd         │    │                 │    │ • stderr        │         │  │
│  │  └─────────────────┘    └─────────────────┘    │ • exit code     │         │  │
│  │                                                └────────┬────────┘         │  │
│  └─────────────────────────────────────────────────────────┼───────────────────┘  │
│                                                            │                      │
│                                                            │ 4. Execution result  │
│                                                            ▼                      │
│  ┌─────────────────┐    ┌─────────────────┐                                       │
│  │ Result          │───►│ Audit Logger    │                                       │
│  │ Formatter       │    │                 │                                       │
│  │                 │    │ Log:            │                                       │
│  │ Format output   │    │ • command       │                                       │
│  │ Truncate if     │    │ • result        │                                       │
│  │ needed          │    │ • duration      │                                       │
│  └────────┬────────┘    └─────────────────┘                                       │
│           │                                                                         │
└───────────┼─────────────────────────────────────────────────────────────────────────┘
            │
            │ 5. Tool result
            ▼
   ┌─────────────────┐
   │ Return to agent │
   │ for next turn   │
   └─────────────────┘
```

---

## 6. AUTHENTICATION DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION DATA FLOW                                     │
│                           (Device Pairing)                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ New device      │
│ (macOS App)     │
└────────┬────────┘
         │
         │ 1. WebSocket connect
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                          │
│                                                                                     │
│  ┌─────────────────┐                                                               │
│  │ Connection      │                                                               │
│  │ Handler         │                                                               │
│  │                 │                                                               │
│  │ Generate nonce  │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 2. Challenge { nonce, timestamp }                                       │
│           ▼                                                                         │
└───────────┼─────────────────────────────────────────────────────────────────────────┘
            │
            │ Challenge sent to client
            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENT                                           │
│                                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐                │
│  │ Device Identity │───►│ Signature       │───►│ Connect Request │                │
│  │ Manager         │    │ Generator       │    │ Builder         │                │
│  │                 │    │                 │    │                 │                │
│  │ Load/create:    │    │ Sign nonce with │    │ Build connect   │                │
│  │ • device ID     │    │ private key     │    │ params with:    │                │
│  │ • key pair      │    │                 │    │ • device auth   │                │
│  └─────────────────┘    └─────────────────┘    │ • signature     │                │
│                                                └────────┬────────┘                │
│                                                         │                         │
└─────────────────────────────────────────────────────────┼─────────────────────────┘
                                                          │
                                                          │ 3. Connect request with signed device auth
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                          │
│                                                                                     │
│  ┌─────────────────┐                                                               │
│  │ Auth Service    │                                                               │
│  │                 │                                                               │
│  │ Verify:         │                                                               │
│  │ • signature     │                                                               │
│  │ • nonce fresh   │                                                               │
│  │ • public key    │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 4. Check device known                                                   │
│           ▼                                                                         │
│  ┌─────────────────┐                                                               │
│  │ Device Store    │                                                               │
│  │                 │                                                               │
│  │ Lookup device   │                                                               │
│  │ by ID           │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│     ┌─────┴─────┐                                                                   │
│     │           │                                                                   │
│     ▼           ▼                                                                   │
│  ┌───────┐   ┌───────┐                                                             │
│  │ Known │   │ New   │                                                             │
│  │       │   │Device │                                                             │
│  │ Allow │   │       │                                                             │
│  │       │   │ Check │                                                             │
│  └───┬───┘   │ if    │                                                             │
│      │       │ local │                                                             │
│      │       └───┬───┘                                                             │
│      │           │                                                                  │
│      │     ┌─────┴─────┐                                                           │
│      │     │           │                                                           │
│      │     ▼           ▼                                                           │
│      │  ┌───────┐   ┌───────┐                                                     │
│      │  │ Local │   │Remote │                                                     │
│      │  │       │   │       │                                                     │
│      │  │ Auto  │   │Require│                                                     │
│      │  │approve│   │manual │                                                     │
│      │  └───┬───┘   │approve│                                                     │
│      │      │       └───┬───┘                                                     │
│      │      │           │                                                          │
│      └──────┼───────────┤                                                          │
│             │           │                                                          │
│             │ 5. Issue  │ 6. Wait for                                              │
│             │ token     │ owner approval                                           │
│             ▼           │                                                          │
│  ┌─────────────────┐    │                                                          │
│  │ Token Generator │◄───┘                                                          │
│  │                 │                                                               │
│  │ Generate JWT:   │                                                               │
│  │ • device ID     │                                                               │
│  │ • role          │                                                               │
│  │ • scopes        │                                                               │
│  │ • expiry        │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 7. Store token                                                          │
│           ▼                                                                         │
│  ┌─────────────────┐                                                               │
│  │ Device Store    │                                                               │
│  │                 │                                                               │
│  │ Save device     │                                                               │
│  │ token           │                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
└───────────┼─────────────────────────────────────────────────────────────────────────┘
            │
            │ 8. hello-ok with device token
            ▼
   ┌─────────────────┐
   │ Client stores   │
   │ token for       │
   │ future connects │
   └─────────────────┘
```

---

## 7. DATA RETENTION FLOW

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          DATA RETENTION FLOW                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ Session         │
│ Maintenance     │
│ Trigger         │
│ (on write or    │
│  scheduled)     │
└────────┬────────┘
         │
         │ 1. Start maintenance
         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            MAINTENANCE PROCESS                                      │
│                                                                                     │
│  ┌─────────────────┐                                                               │
│  │ Load Config     │                                                               │
│  │                 │                                                               │
│  │ pruneAfter: 30d │                                                               │
│  │ maxEntries: 500 │                                                               │
│  │ rotateBytes: 10m│                                                               │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ 2. Identify stale sessions                                              │
│           ▼                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐                                       │
│  │ Session Scanner │───►│ Stale Session   │                                       │
│  │                 │    │ List            │                                       │
│  │ Find sessions   │    │                 │                                       │
│  │ older than      │    │ Sessions with   │                                       │
│  │ pruneAfter      │    │ lastActivity >  │                                       │
│  │                 │    │ 30 days ago     │                                       │
│  └─────────────────┘    └────────┬────────┘                                       │
│                                  │                                                 │
│                    ┌─────────────┴─────────────┐                                  │
│                    │                           │                                  │
│                    ▼                           ▼                                  │
│             ┌─────────────┐            ┌─────────────┐                           │
│             │ mode: warn  │            │mode: enforce│                           │
│             │             │            │             │                           │
│             │ Log what    │            │ Actually    │                           │
│             │ would be    │            │ delete      │                           │
│             │ deleted     │            │             │                           │
│             └─────────────┘            └──────┬──────┘                           │
│                                               │                                   │
│                                               │ 3. Delete stale                   │
│                                               ▼                                   │
│                                        ┌─────────────────┐                       │
│                                        │ Session Deleter │                       │
│                                        │                 │                       │
│                                        │ For each stale: │                       │
│                                        │ • Remove from   │                       │
│                                        │   sessions.db   │                       │
│                                        │ • Archive       │                       │
│                                        │   transcript    │                       │
│                                        └────────┬────────┘                       │
│                                                 │                                 │
│                                                 │ 4. Check entry count           │
│                                                 ▼                                 │
│                                        ┌─────────────────┐                       │
│                                        │ Entry Capper    │                       │
│                                        │                 │                       │
│                                        │ If count > 500: │                       │
│                                        │ Remove oldest   │                       │
│                                        │ until at limit  │                       │
│                                        └────────┬────────┘                       │
│                                                 │                                 │
│                                                 │ 5. Archive old transcripts     │
│                                                 ▼                                 │
│                                        ┌─────────────────┐                       │
│                                        │ Transcript      │                       │
│                                        │ Archiver        │                       │
│                                        │                 │                       │
│                                        │ Move orphaned   │                       │
│                                        │ .jsonl to       │                       │
│                                        │ .jsonl.deleted. │                       │
│                                        │ {timestamp}     │                       │
│                                        └────────┬────────┘                       │
│                                                 │                                 │
│                                                 │ 6. Purge old archives          │
│                                                 ▼                                 │
│                                        ┌─────────────────┐                       │
│                                        │ Archive Purger  │                       │
│                                        │                 │                       │
│                                        │ Delete archives │                       │
│                                        │ older than      │                       │
│                                        │ retention       │                       │
│                                        │ (default: 30d)  │                       │
│                                        └────────┬────────┘                       │
│                                                 │                                 │
│                                                 │ 7. Rotate store file           │
│                                                 ▼                                 │
│                                        ┌─────────────────┐                       │
│                                        │ Store Rotator   │                       │
│                                        │                 │                       │
│                                        │ If sessions.db  │                       │
│                                        │ > rotateBytes:  │                       │
│                                        │ Vacuum / rotate │                       │
│                                        └────────┬────────┘                       │
│                                                 │                                 │
└─────────────────────────────────────────────────┼─────────────────────────────────┘
                                                  │
                                                  │ 8. Maintenance complete
                                                  ▼
                                         ┌─────────────────┐
                                         │ Report          │
                                         │                 │
                                         │ Sessions pruned │
                                         │ Space freed     │
                                         │ Errors if any   │
                                         └─────────────────┘
```

---

## 8. PII DATA MAPPING

### 8.1 PII Locations

| Data | PII Type | Location | Protection |
|------|----------|----------|------------|
| User names | Identifier | Transcripts, session store | Encryption optional |
| Phone numbers | Contact | WhatsApp sender IDs, config | Hashed in logs |
| Email addresses | Contact | Message content | Redacted in logs |
| Telegram usernames | Identifier | Sender IDs | Hashed in logs |
| Message content | Communication | Transcripts | Access controlled |
| Location data | Sensitive | Node location tool | Not persisted |
| Photos/media | Sensitive | Transcripts (refs) | Access controlled |

### 8.2 PII Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PII DATA FLOW                                           │
└─────────────────────────────────────────────────────────────────────────────────────┘

         User PII enters system
                  │
                  ▼
         ┌───────────────────┐
         │ Channel Plugin    │
         │                   │
         │ Receives:         │
         │ • name            │
         │ • phone/username  │
         │ • message content │
         └─────────┬─────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌────────┐   ┌────────────┐   ┌────────────┐
│ Logs   │   │ Session    │   │ Transcript │
│        │   │ Store      │   │            │
│ REDACT │   │            │   │ STORE      │
│ phone  │   │ Store:     │   │ (access    │
│ email  │   │ • senderId │   │ controlled)│
│        │   │ • name     │   │            │
└────────┘   └────────────┘   └────────────┘
                   │
                   │ Session maintenance
                   ▼
            ┌─────────────┐
            │ Archive/    │
            │ Delete      │
            │             │
            │ Per policy  │
            └─────────────┘
```

---

## 9. CROSS-BOUNDARY DATA TRANSFERS

### 9.1 External API Transfers

| Destination | Data Sent | Purpose | Data Returned |
|-------------|-----------|---------|---------------|
| Anthropic | Prompts, context | AI completion | Responses, tokens |
| OpenAI | Prompts, context | AI completion | Responses, tokens |
| Telegram | Messages, media | Delivery | Status, message IDs |
| Discord | Messages, media | Delivery | Status, message IDs |
| Web (fetch) | URLs | Content retrieval | Page content |
| Browser | URLs | Automation | Page content, screenshots |

### 9.2 Data Minimization

```typescript
// Before sending to LLM, minimize context
function minimizeContext(context: Context): MinimizedContext {
  return {
    // Include
    messages: context.messages.map(m => ({
      role: m.role,
      content: m.content,  // Necessary for continuity
    })),
    
    // Exclude
    // - Full sender details (use anonymized ID)
    // - Exact timestamps (use relative)
    // - Channel metadata
    // - Session tokens
  };
}
```

---

*These data flow diagrams document how information moves through OpenClaw, supporting security analysis and compliance requirements.*
