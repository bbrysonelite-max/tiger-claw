# OpenClaw Database Schema Specification

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. DATABASE STRATEGY

### 1.1 Storage Architecture

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Sessions | SQLite + JSON files | Fast local access, portable |
| Transcripts | JSONL files | Append-only, easy streaming |
| Configuration | JSON5 file | Human-editable, hot-reload |
| Credentials | Encrypted JSON | Security, per-channel isolation |
| Memory/Vectors | SQLite-vec | Embedded vector search |
| Cron Jobs | JSON file | Simple persistence |
| Exec Approvals | JSON file | Audit trail |
| Pairing Store | JSON file | Per-channel allowlists |

### 1.2 File Locations

```
~/.openclaw/
├── openclaw.json                    # Main configuration
├── credentials/
│   ├── whatsapp/
│   │   └── default/                 # Baileys auth state
│   ├── telegram/
│   │   └── session.json            # Bot token (encrypted)
│   └── ...
├── agents/
│   └── {agentId}/
│       ├── sessions/
│       │   ├── sessions.db         # SQLite session store
│       │   ├── sessions.json       # Session index (legacy/backup)
│       │   └── {sessionId}.jsonl   # Transcript files
│       ├── memory/
│       │   └── memory.db           # SQLite-vec for embeddings
│       └── workspace/              # Agent workspace
├── cron/
│   └── jobs.json                   # Cron job definitions
├── exec-approvals.json             # Exec allowlist
├── pairing/
│   └── {channel}.json              # Per-channel pairing store
├── device-auth/
│   └── {deviceId}.json             # Device tokens
├── dead-letter/
│   └── messages.jsonl              # Poison messages
└── logs/
    └── openclaw.log                # Application logs
```

---

## 2. CORE SCHEMAS

### 2.1 Sessions Table (SQLite)

```sql
-- sessions.db

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL DEFAULT 'main',
    
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity_at TEXT,
    
    -- Token tracking
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    
    -- Cost tracking (cents)
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    channel TEXT,
    display_name TEXT,
    subject TEXT,                    -- Group subject
    room TEXT,
    space TEXT,
    
    -- State
    status TEXT NOT NULL DEFAULT 'active',  -- active, archived, deleted
    model_override TEXT,
    thinking_level TEXT,
    
    -- Origin (JSON)
    origin_json TEXT,
    
    -- Indexes
    CONSTRAINT valid_status CHECK (status IN ('active', 'archived', 'deleted'))
);

CREATE INDEX idx_sessions_key ON sessions(session_key);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_channel ON sessions(channel);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_activity ON sessions(last_activity_at DESC);
```

### 2.2 Messages Table (for indexed search)

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    
    -- Content
    role TEXT NOT NULL,              -- user, assistant, system, tool
    content TEXT,
    content_hash TEXT,               -- SHA256 for dedup
    
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- Metadata
    model TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    
    -- Tool calls (JSON array)
    tool_calls_json TEXT,
    tool_results_json TEXT,
    
    -- Foreign key
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at DESC);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_hash ON messages(content_hash);
```

### 2.3 Cron Jobs Schema

```sql
-- Could be SQLite, currently JSON file
-- Schema for validation:

CREATE TABLE cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    
    -- Schedule (JSON)
    schedule_kind TEXT NOT NULL,     -- cron, every, at
    schedule_value TEXT NOT NULL,
    schedule_tz TEXT,
    
    -- Target
    session_target TEXT NOT NULL,    -- main, isolated
    agent_id TEXT,
    
    -- Payload (JSON)
    payload_kind TEXT NOT NULL,      -- systemEvent, agentTurn
    payload_content TEXT NOT NULL,
    
    -- Delivery (JSON)
    delivery_mode TEXT,              -- announce, webhook, none
    delivery_channel TEXT,
    delivery_to TEXT,
    delivery_url TEXT,
    
    -- Model settings
    model TEXT,
    thinking_level TEXT,
    
    -- Lifecycle
    delete_after_run INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    
    -- Error tracking
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_cron_enabled ON cron_jobs(enabled, next_run_at);
```

---

## 3. MEMORY/VECTOR SCHEMA

### 3.1 Memory Chunks Table

```sql
-- memory.db (SQLite with sqlite-vec extension)

CREATE TABLE memory_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    
    -- Position
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    
    -- Content
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    
    -- Metadata
    file_modified_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- Embedding (stored separately in vec table)
    embedding_id INTEGER,
    
    UNIQUE(file_path, line_start, content_hash)
);

CREATE INDEX idx_chunks_file ON memory_chunks(file_path);
CREATE INDEX idx_chunks_hash ON memory_chunks(content_hash);

-- Vector table (sqlite-vec)
CREATE VIRTUAL TABLE memory_embeddings USING vec0(
    embedding FLOAT[1536]  -- OpenAI ada-002 dimensions
);
```

### 3.2 Memory Files Table

```sql
CREATE TABLE memory_files (
    file_path TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'indexed'  -- indexed, pending, error
);

CREATE INDEX idx_files_status ON memory_files(status);
CREATE INDEX idx_files_modified ON memory_files(modified_at DESC);
```

---

## 4. CHANNEL-SPECIFIC SCHEMAS

### 4.1 Pairing Store Schema

```json
{
  "$schema": "pairing-store.schema.json",
  "version": 1,
  "channel": "telegram",
  "accountId": "default",
  "allowFrom": [
    "tg:123456789",
    "tg:987654321"
  ],
  "pendingRequests": [
    {
      "id": "tg:555555555",
      "code": "ABC123",
      "createdAt": "2026-02-26T12:00:00Z",
      "lastSeenAt": "2026-02-26T12:05:00Z",
      "meta": {
        "username": "@someuser",
        "firstName": "John"
      }
    }
  ],
  "updatedAt": "2026-02-26T12:05:00Z"
}
```

### 4.2 Device Auth Store Schema

```json
{
  "$schema": "device-auth.schema.json",
  "version": 1,
  "devices": {
    "device_abc123": {
      "deviceId": "device_abc123",
      "role": "operator",
      "token": "encrypted:...",
      "scopes": ["operator.read", "operator.write"],
      "issuedAt": "2026-02-26T10:00:00Z",
      "lastUsedAt": "2026-02-26T12:00:00Z",
      "expiresAt": "2026-03-26T10:00:00Z"
    }
  }
}
```

### 4.3 Exec Approvals Schema

```json
{
  "$schema": "exec-approvals.schema.json",
  "version": 1,
  "socket": {
    "path": "/tmp/openclaw-exec.sock",
    "token": "random_token"
  },
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny",
    "autoAllowSkills": true
  },
  "agents": {
    "main": {
      "security": "allowlist",
      "ask": "on-miss",
      "allowlist": [
        {
          "id": "rule_001",
          "pattern": "git *",
          "lastUsedAt": 1708963200000,
          "lastUsedCommand": "git status",
          "lastResolvedPath": "/usr/bin/git"
        },
        {
          "pattern": "npm *"
        },
        {
          "pattern": "ls *"
        }
      ]
    }
  }
}
```

---

## 5. TRANSCRIPT SCHEMA (JSONL)

### 5.1 Message Entry

```json
{
  "id": "msg_abc123",
  "role": "user",
  "content": "Hello, how are you?",
  "timestamp": "2026-02-26T12:00:00.000Z",
  "channel": "telegram",
  "senderId": "tg:123456789",
  "senderName": "John Doe",
  "replyTo": null,
  "media": null
}
```

### 5.2 Assistant Response Entry

```json
{
  "id": "msg_def456",
  "role": "assistant",
  "content": "I'm doing well, thank you!",
  "timestamp": "2026-02-26T12:00:05.000Z",
  "model": "anthropic/claude-opus-4-6",
  "usage": {
    "inputTokens": 150,
    "outputTokens": 25,
    "totalTokens": 175,
    "cacheReadTokens": 100,
    "cacheWriteTokens": 0
  },
  "thinkingLevel": "low",
  "durationMs": 2500,
  "toolCalls": null
}
```

### 5.3 Tool Call Entry

```json
{
  "id": "msg_ghi789",
  "role": "assistant",
  "content": null,
  "timestamp": "2026-02-26T12:01:00.000Z",
  "model": "anthropic/claude-opus-4-6",
  "toolCalls": [
    {
      "id": "call_001",
      "name": "exec",
      "arguments": {
        "command": "ls -la"
      }
    }
  ]
}
```

### 5.4 Tool Result Entry

```json
{
  "id": "msg_jkl012",
  "role": "tool",
  "toolCallId": "call_001",
  "name": "exec",
  "content": "total 48\ndrwxr-xr-x  12 user  staff  384 Feb 26 12:00 .\n...",
  "timestamp": "2026-02-26T12:01:01.000Z",
  "durationMs": 150,
  "ok": true
}
```

### 5.5 System Event Entry

```json
{
  "id": "msg_mno345",
  "role": "system",
  "content": "[Heartbeat] Checking for updates...",
  "timestamp": "2026-02-26T12:30:00.000Z",
  "eventType": "heartbeat",
  "metadata": {
    "cronJobId": null,
    "source": "scheduler"
  }
}
```

---

## 6. MIGRATION STRATEGY

### 6.1 Migration Table

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum TEXT NOT NULL
);
```

### 6.2 Migration Naming Convention

```
{version}_{description}.sql

Examples:
001_initial_schema.sql
002_add_cost_tracking.sql
003_add_memory_index.sql
004_add_session_status.sql
```

### 6.3 Migration Rules

1. **Forward-only**: No rollback migrations (backup before migrate)
2. **Idempotent**: Migrations must be safe to run multiple times
3. **Atomic**: Each migration in a transaction
4. **Tested**: All migrations must have tests
5. **Documented**: Each migration has a description

### 6.4 Sample Migration

```sql
-- 002_add_cost_tracking.sql
-- Adds cost tracking fields to sessions table

-- Check if migration needed
SELECT CASE 
    WHEN EXISTS (
        SELECT 1 FROM pragma_table_info('sessions') 
        WHERE name = 'total_cost_cents'
    ) 
    THEN 'SKIP' 
    ELSE 'RUN' 
END;

-- Migration
ALTER TABLE sessions ADD COLUMN total_cost_cents INTEGER NOT NULL DEFAULT 0;

-- Backfill (estimate from tokens)
UPDATE sessions 
SET total_cost_cents = (input_tokens * 3 + output_tokens * 15) / 1000000
WHERE total_cost_cents = 0;

-- Record migration
INSERT INTO schema_migrations (version, name, checksum)
VALUES (2, 'add_cost_tracking', 'sha256:abc123...');
```

---

## 7. BACKUP & RECOVERY

### 7.1 Backup Strategy

| Data | Frequency | Retention | Method |
|------|-----------|-----------|--------|
| sessions.db | Hourly | 7 days | SQLite .backup |
| memory.db | Daily | 30 days | SQLite .backup |
| Transcripts | Daily | 90 days | tar.gz |
| Config | On change | 30 versions | Copy with timestamp |
| Credentials | On change | 5 versions | Encrypted copy |

### 7.2 Backup Locations

```
~/.openclaw/backups/
├── sessions/
│   ├── sessions.db.2026-02-26T12.bak
│   └── sessions.db.2026-02-26T13.bak
├── memory/
│   └── memory.db.2026-02-26.bak
├── transcripts/
│   └── transcripts.2026-02-26.tar.gz
└── config/
    ├── openclaw.json.2026-02-26T120000.bak
    └── openclaw.json.2026-02-26T130000.bak
```

### 7.3 Recovery Procedures

**Session Recovery:**
```bash
# Stop gateway
openclaw gateway stop

# Restore from backup
cp ~/.openclaw/backups/sessions/sessions.db.{timestamp}.bak \
   ~/.openclaw/agents/main/sessions/sessions.db

# Verify integrity
sqlite3 ~/.openclaw/agents/main/sessions/sessions.db "PRAGMA integrity_check"

# Start gateway
openclaw gateway start
```

**Full Recovery:**
```bash
openclaw restore --from ~/.openclaw/backups/full.2026-02-26.tar.gz
```

---

## 8. DATA RETENTION POLICIES

### 8.1 Retention Rules

| Data Type | Default Retention | Configurable | Purge Method |
|-----------|-------------------|--------------|--------------|
| Active sessions | Forever | No | Manual delete |
| Inactive sessions | 30 days | Yes | Auto-prune |
| Transcripts | 90 days | Yes | Archive then delete |
| Logs | 14 days | Yes | Rotate |
| Dead-letter | 7 days | Yes | Auto-purge |
| Backups | Per schedule | Yes | Rotate oldest |

### 8.2 Purge Configuration

```yaml
retention:
  sessions:
    inactiveAfterDays: 30
    maxCount: 500
    
  transcripts:
    maxAgeDays: 90
    archiveAfterDays: 30
    maxSizeBytes: 10737418240  # 10GB
    
  logs:
    maxAgeDays: 14
    maxSizeBytes: 1073741824  # 1GB
    
  deadLetter:
    maxAgeDays: 7
    maxCount: 1000
```

---

## 9. INDEXES & PERFORMANCE

### 9.1 Query Patterns & Indexes

| Query Pattern | Index | Expected Performance |
|---------------|-------|---------------------|
| Get session by key | idx_sessions_key | O(1), < 1ms |
| List sessions by agent | idx_sessions_agent | O(n), < 10ms for 500 |
| List recent sessions | idx_sessions_updated | O(n), < 10ms |
| Search memory | memory_embeddings (vec) | O(log n), < 50ms |
| Get messages by session | idx_messages_session | O(n), < 5ms |

### 9.2 Performance Targets

| Operation | Target | Max Acceptable |
|-----------|--------|----------------|
| Session lookup | < 1ms | 5ms |
| Session create | < 5ms | 20ms |
| Transcript append | < 2ms | 10ms |
| Memory search (top 10) | < 50ms | 200ms |
| Full backup | < 30s | 120s |

---

## 10. CONSTRAINTS & VALIDATION

### 10.1 Field Constraints

| Table | Field | Constraint |
|-------|-------|------------|
| sessions | session_key | NOT NULL, UNIQUE, max 500 chars |
| sessions | status | ENUM: active, archived, deleted |
| sessions | tokens | >= 0 |
| messages | role | ENUM: user, assistant, system, tool |
| messages | content | max 1MB |
| cron_jobs | schedule_kind | ENUM: cron, every, at |
| cron_jobs | session_target | ENUM: main, isolated |

### 10.2 Referential Integrity

```sql
-- Messages must belong to valid session
FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE

-- Memory chunks reference valid embedding
FOREIGN KEY (embedding_id) REFERENCES memory_embeddings(rowid) ON DELETE SET NULL
```

### 10.3 Data Validation Rules

1. **Session keys**: Must match pattern `^[a-z]+:[a-z]+:.+$`
2. **Timestamps**: Must be valid ISO 8601
3. **Tokens**: Must be non-negative integers
4. **JSON fields**: Must be valid JSON when not null
5. **File paths**: Must be within allowed directories

---

*This database schema provides the foundation for persistent, reliable data storage in OpenClaw.*
