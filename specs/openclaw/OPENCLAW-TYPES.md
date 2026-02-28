# OpenClaw Type Definitions

**For Pre-Dev Planning**  
**Version:** 2026.2.23  
**Date:** February 26, 2026

---

## 1. GATEWAY PROTOCOL TYPES

### 1.1 Frame Types

```typescript
// Base frame structure
type FrameType = "req" | "res" | "event";

// Request frame (client → server)
interface RequestFrame {
  type: "req";
  id: string;                    // UUID for correlation
  method: string;                // Method name (connect, agent, send, etc.)
  params: Record<string, unknown>;
}

// Response frame (server → client)
interface ResponseFrame {
  type: "res";
  id: string;                    // Matches request id
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Event frame (server → client, push)
interface EventFrame {
  type: "event";
  event: string;                 // Event name (agent, chat, presence, etc.)
  payload: unknown;
  seq?: number;                  // Sequence number for ordering
  stateVersion?: number;         // State version for optimistic updates
}
```

### 1.2 Connect Handshake

```typescript
// Challenge (server → client, before connect)
interface ConnectChallenge {
  nonce: string;
  ts: number;                    // Unix timestamp ms
}

// Connect request params
interface ConnectParams {
  minProtocol: number;           // Minimum protocol version
  maxProtocol: number;           // Maximum protocol version
  client: ClientInfo;
  role: ClientRole;
  scopes: string[];
  caps: string[];                // Capability claims (for nodes)
  commands: string[];            // Command allowlist (for nodes)
  permissions: Record<string, boolean>;
  auth?: {
    token?: string;
    deviceToken?: string;
  };
  locale?: string;
  userAgent?: string;
  device?: DeviceAuth;
}

interface ClientInfo {
  id: string;                    // Client identifier
  version: string;               // Client version
  platform: string;              // darwin | linux | win32 | ios | android
  mode: ClientMode;              // operator | node
}

type ClientRole = "operator" | "node";
type ClientMode = "operator" | "node";

interface DeviceAuth {
  id: string;                    // Device fingerprint
  publicKey: string;             // Base64url public key
  signature: string;             // Base64url signature
  signedAt: number;              // Unix timestamp ms
  nonce: string;                 // Challenge nonce
}

// Connect response (hello-ok)
interface HelloOkPayload {
  type: "hello-ok";
  protocol: number;
  policy: {
    tickIntervalMs: number;
  };
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
}
```

### 1.3 Presence Types

```typescript
interface PresenceEntry {
  deviceId: string;
  roles: ClientRole[];
  scopes: string[];
  connectedAt: number;
  lastSeenAt: number;
  client: ClientInfo;
}

interface PresenceSnapshot {
  entries: Record<string, PresenceEntry>;
  stateVersion: number;
}
```

---

## 2. SESSION TYPES

### 2.1 Session Store

```typescript
interface SessionEntry {
  sessionId: string;             // UUID
  sessionKey: string;            // e.g., "main:whatsapp:+1234567890"
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  displayName?: string;
  channel?: ChannelId;
  subject?: string;              // Group subject/name
  room?: string;                 // Room/space identifier
  space?: string;
  origin?: SessionOrigin;
}

interface SessionOrigin {
  label: string;
  routing: Record<string, unknown>;
}

// Session key patterns
type SessionKey = 
  | `main:${ChannelId}:${string}`           // Main DM session
  | `group:${ChannelId}:${string}`          // Group session
  | `cron:${string}`                        // Cron job session
  | `agent:${string}:${string}`;            // Multi-agent session

// DM scoping options
type DmScope = 
  | "main"                       // All DMs share main session
  | "per-peer"                   // Isolate by sender
  | "per-channel-peer"           // Isolate by channel + sender
  | "per-account-channel-peer";  // Isolate by account + channel + sender
```

### 2.2 Session Maintenance

```typescript
interface SessionMaintenanceConfig {
  mode: "warn" | "enforce";
  pruneAfter: string;            // Duration (e.g., "30d")
  maxEntries: number;
  rotateBytes: string;           // Size (e.g., "10mb")
  resetArchiveRetention?: string;
  maxDiskBytes?: string;
  highWaterBytes?: string;
}
```

---

## 3. CHANNEL TYPES

### 3.1 Core Channel Types

```typescript
type ChannelId = 
  | "whatsapp"
  | "telegram"
  | "discord"
  | "slack"
  | "signal"
  | "imessage"
  | "bluebubbles"
  | "googlechat"
  | "msteams"
  | "matrix"
  | "line"
  | "zalo"
  | "irc"
  | "webchat";

type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
type GroupPolicy = "allowlist" | "open" | "disabled";

interface ChannelConfig {
  enabled?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  mediaMaxMb?: number;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  historyLimit?: number;
}
```

### 3.2 Channel Plugin Interface

```typescript
interface ChannelPlugin {
  readonly id: ChannelId;
  readonly name: string;
  readonly meta: ChannelMeta;
  
  // Lifecycle
  initialize(context: ChannelSetupInput): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Adapters (optional capabilities)
  messaging?: ChannelMessagingAdapter;
  outbound?: ChannelOutboundAdapter;
  status?: ChannelStatusAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter;
  heartbeat?: ChannelHeartbeatAdapter;
  threading?: ChannelThreadingAdapter;
  streaming?: ChannelStreamingAdapter;
  directory?: ChannelDirectoryAdapter;
  messageAction?: ChannelMessageActionAdapter;
  agentPrompt?: ChannelAgentPromptAdapter;
  agentTool?: ChannelAgentToolFactory;
}

interface ChannelMeta {
  displayName: string;
  icon?: string;
  color?: string;
  supportsMedia?: boolean;
  supportsReactions?: boolean;
  supportsThreads?: boolean;
  supportsTyping?: boolean;
}

interface ChannelSetupInput {
  config: ChannelConfig;
  logger: ChannelLogSink;
  gateway: ChannelGatewayContext;
}
```

### 3.3 Message Types

```typescript
interface InboundMessage {
  id: string;
  channel: ChannelId;
  accountId?: string;
  chatId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  text?: string;
  media?: MediaAttachment[];
  replyTo?: string;
  timestamp: number;
  isGroup: boolean;
  groupSubject?: string;
  mentions?: string[];
  raw?: unknown;
}

interface OutboundMessage {
  text?: string;
  media?: MediaAttachment[];
  replyTo?: string;
  silent?: boolean;
  effect?: string;
  buttons?: MessageButton[];
}

interface MediaAttachment {
  type: "image" | "audio" | "video" | "document" | "sticker" | "voice";
  url?: string;
  path?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface MessageButton {
  text: string;
  callback?: string;
  url?: string;
}
```

### 3.4 Channel-Specific Configs

```typescript
// WhatsApp
interface WhatsAppConfig extends ChannelConfig {
  sendReadReceipts?: boolean;
  groups?: Record<string, WhatsAppGroupConfig>;
  accounts?: Record<string, WhatsAppAccountConfig>;
}

// Telegram
interface TelegramConfig extends ChannelConfig {
  botToken?: string;
  tokenFile?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  customCommands?: TelegramCommand[];
  replyToMode?: "off" | "first" | "all";
  linkPreview?: boolean;
  streaming?: "off" | "partial" | "block" | "progress";
  actions?: {
    reactions?: boolean;
    sendMessage?: boolean;
  };
  groups?: Record<string, TelegramGroupConfig>;
}

// Discord
interface DiscordConfig extends ChannelConfig {
  token?: string;
  allowBots?: boolean;
  replyToMode?: "off" | "first" | "all";
  streaming?: "off" | "partial" | "block" | "progress";
  guilds?: Record<string, DiscordGuildConfig>;
  dm?: {
    enabled?: boolean;
    groupEnabled?: boolean;
    groupChannels?: string[];
  };
  actions?: DiscordActions;
  threadBindings?: {
    enabled?: boolean;
    ttlHours?: number;
    spawnSubagentSessions?: boolean;
  };
  voice?: DiscordVoiceConfig;
}

// Slack
interface SlackConfig extends ChannelConfig {
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
}
```

---

## 4. AGENT TYPES

### 4.1 Agent Configuration

```typescript
interface AgentConfig {
  id?: string;
  name?: string;
  model?: ModelConfig;
  workspace?: string;
  heartbeat?: HeartbeatConfig;
  sandbox?: SandboxConfig;
  tools?: ToolsConfig;
  skills?: SkillsConfig;
  systemPrompt?: string;
}

interface ModelConfig {
  primary: string;               // provider/model
  fallbacks?: string[];
  thinkingLevel?: ThinkingLevel;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface HeartbeatConfig {
  enabled?: boolean;
  every?: string;                // Duration (e.g., "30m")
  prompt?: string;
  target?: string;
  model?: string;
  ackMaxChars?: number;
}
```

### 4.2 Agent Runtime

```typescript
interface AgentSession {
  sessionId: string;
  sessionKey: string;
  agentId: string;
  workspaceDir: string;
  model: ResolvedModel;
  tools: AgentTool[];
  systemPrompt: string;
  contextWindow: number;
  abortSignal?: AbortSignal;
}

interface ResolvedModel {
  provider: string;
  model: string;
  alias?: string;
  contextWindow: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

interface AgentRunParams {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  config: OpenClawConfig;
  prompt: string;
  images?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

interface AgentRunResult {
  ok: boolean;
  response?: string;
  error?: Error;
  usage?: TokenUsage;
  durationMs: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
```

---

## 5. TOOL TYPES

### 5.1 Core Tool Interface

```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema7;
  
  execute(
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

interface ToolContext {
  sessionKey: string;
  agentId: string;
  workdir: string;
  config: OpenClawConfig;
  abortSignal: AbortSignal;
  logger: Logger;
}

interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
  attachments?: ToolAttachment[];
}

interface ToolAttachment {
  type: "image" | "file" | "audio" | "video";
  path?: string;
  url?: string;
  mimeType?: string;
  name?: string;
}
```

### 5.2 Exec Tool Types

```typescript
type ExecHost = "sandbox" | "gateway" | "node";
type ExecSecurity = "deny" | "allowlist" | "full";
type ExecAsk = "off" | "on-miss" | "always";

interface ExecParams {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  yieldMs?: number;
  background?: boolean;
  timeout?: number;
  pty?: boolean;
  host?: ExecHost;
  security?: ExecSecurity;
  ask?: ExecAsk;
  node?: string;
  elevated?: boolean;
}

interface ExecResult {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  sessionId?: string;
  backgrounded?: boolean;
  error?: string;
}

interface ProcessAction {
  action: "list" | "poll" | "log" | "write" | "send-keys" | "kill";
  sessionId?: string;
  data?: string;
  keys?: string[];
  timeout?: number;
  offset?: number;
  limit?: number;
}
```

### 5.3 Browser Tool Types

```typescript
interface BrowserParams {
  action: BrowserAction;
  profile?: string;
  targetId?: string;
  targetUrl?: string;
  url?: string;
  selector?: string;
  ref?: string;
  request?: BrowserRequest;
  compact?: boolean;
  interactive?: boolean;
}

type BrowserAction = 
  | "status" | "start" | "stop" | "profiles"
  | "tabs" | "open" | "focus" | "close"
  | "snapshot" | "screenshot" | "navigate"
  | "console" | "pdf" | "upload" | "dialog" | "act";

interface BrowserRequest {
  kind: BrowserRequestKind;
  ref?: string;
  text?: string;
  key?: string;
  button?: string;
  modifiers?: string[];
  submit?: boolean;
  slowly?: boolean;
}

type BrowserRequestKind = 
  | "click" | "type" | "press" | "hover"
  | "drag" | "select" | "fill" | "resize"
  | "wait" | "evaluate" | "close";

interface BrowserSnapshot {
  url: string;
  title: string;
  content: string;
  refs?: Record<string, string>;
}
```

### 5.4 Session Tool Types

```typescript
interface SessionsListParams {
  kinds?: string[];
  activeMinutes?: number;
  limit?: number;
  messageLimit?: number;
}

interface SessionsSpawnParams {
  task: string;
  agentId?: string;
  label?: string;
  mode?: "run" | "session";
  model?: string;
  thinking?: string;
  thread?: boolean;
  cleanup?: "delete" | "keep";
  timeoutSeconds?: number;
  runTimeoutSeconds?: number;
}

interface SubagentsParams {
  action: "list" | "kill" | "steer";
  target?: string;
  message?: string;
  recentMinutes?: number;
}
```

---

## 6. CRON TYPES

```typescript
interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  sessionTarget: "main" | "isolated";
  payload: CronPayload;
  delivery?: CronDelivery;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  deleteAfterRun?: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
}

type CronSchedule = 
  | { kind: "cron"; value: string; tz?: string }
  | { kind: "every"; value: string }
  | { kind: "at"; value: string };

type CronPayload =
  | { kind: "systemEvent"; content: string }
  | { kind: "agentTurn"; content: string };

interface CronDelivery {
  mode: "announce" | "webhook" | "none";
  channel?: ChannelId;
  to?: string;
  url?: string;
}

interface CronRunResult {
  jobId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  response?: string;
  error?: string;
}
```

---

## 7. SKILL TYPES

```typescript
interface SkillManifest {
  name: string;
  description: string;
  homepage?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  commandDispatch?: "tool";
  commandTool?: string;
  commandArgMode?: "raw";
  metadata?: SkillMetadata;
}

interface SkillMetadata {
  openclaw?: {
    always?: boolean;
    emoji?: string;
    homepage?: string;
    os?: ("darwin" | "linux" | "win32")[];
    requires?: SkillRequirements;
    primaryEnv?: string;
    install?: SkillInstaller[];
  };
}

interface SkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

interface SkillInstaller {
  type: "brew" | "node" | "go" | "uv" | "download";
  package?: string;
  url?: string;
}

interface LoadedSkill {
  name: string;
  description: string;
  instructions: string;
  location: string;
  source: "bundled" | "managed" | "workspace";
  metadata?: SkillMetadata;
}
```

---

## 8. CONFIG TYPES

### 8.1 Root Config

```typescript
interface OpenClawConfig {
  $schema?: string;
  
  // Agent configuration
  agents?: {
    defaults?: AgentDefaultsConfig;
    list?: AgentConfig[];
  };
  
  // Channel configurations
  channels?: ChannelsConfig;
  
  // Gateway settings
  gateway?: GatewayConfig;
  
  // Tool settings
  tools?: ToolsConfig;
  
  // Session settings
  session?: SessionConfig;
  
  // Skills settings
  skills?: SkillsConfig;
  
  // Browser settings
  browser?: BrowserConfig;
  
  // Web settings
  web?: WebConfig;
  
  // Cron settings
  cron?: CronConfig;
}
```

### 8.2 Gateway Config

```typescript
interface GatewayConfig {
  port?: number;                 // Default: 18789
  bind?: "loopback" | "tailscale" | "lan" | "any";
  auth?: {
    mode?: "none" | "token" | "password";
    token?: string;
    password?: string;
    allowTailscale?: boolean;
  };
  tailscale?: {
    mode?: "off" | "serve" | "funnel";
    resetOnExit?: boolean;
  };
  tls?: {
    cert?: string;
    key?: string;
  };
}
```

### 8.3 Tools Config

```typescript
interface ToolsConfig {
  exec?: ExecToolConfig;
  browser?: BrowserToolConfig;
  web?: WebToolConfig;
}

interface ExecToolConfig {
  host?: ExecHost;
  security?: ExecSecurity;
  ask?: ExecAsk;
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  safeBinProfiles?: Record<string, SafeBinProfile>;
  safeBinTrustedDirs?: string[];
  notifyOnExit?: boolean;
  approvalRunningNoticeMs?: number;
}

interface BrowserToolConfig {
  enabled?: boolean;
  defaultProfile?: string;
  headless?: boolean;
  noSandbox?: boolean;
  attachOnly?: boolean;
  executablePath?: string;
  color?: string;
  profiles?: Record<string, BrowserProfileConfig>;
  ssrfPolicy?: SsrfPolicy;
}

interface WebToolConfig {
  search?: {
    provider?: "brave" | "perplexity";
    apiKey?: string;
  };
  fetch?: {
    maxChars?: number;
    timeoutMs?: number;
  };
}
```

---

## 9. NODE TYPES

```typescript
interface NodeInfo {
  id: string;
  name?: string;
  platform: string;
  version: string;
  caps: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  connectedAt: number;
  lastSeenAt: number;
}

interface NodeInvokeParams {
  node: string;
  command: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

interface NodeInvokeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// Node commands
type NodeCommand =
  | "system.run"
  | "system.notify"
  | "canvas.present"
  | "canvas.hide"
  | "canvas.navigate"
  | "canvas.eval"
  | "canvas.snapshot"
  | "camera.snap"
  | "camera.clip"
  | "camera.list"
  | "screen.record"
  | "location.get";
```

---

## 10. MEMORY TYPES

```typescript
interface MemorySearchParams {
  query: string;
  maxResults?: number;
  minScore?: number;
}

interface MemorySearchResult {
  path: string;
  line: number;
  content: string;
  score: number;
}

interface MemoryGetParams {
  path: string;
  from?: number;
  lines?: number;
}
```

---

## 11. UTILITY TYPES

```typescript
// Duration parsing
type DurationString = `${number}${"s" | "m" | "h" | "d" | "w"}`;

// Size parsing
type SizeString = `${number}${"b" | "kb" | "mb" | "gb"}`;

// Logger interface
interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

// Subsystem logger
interface SubsystemLogger extends Logger {
  subsystem: string;
  child(subsystem: string): SubsystemLogger;
}

// JSON Schema subset
interface JSONSchema7 {
  type?: string | string[];
  properties?: Record<string, JSONSchema7>;
  items?: JSONSchema7;
  required?: string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}
```

---

*These types form the foundation for implementing OpenClaw. Use with Pre-Dev for detailed planning.*
