# OpenClaw Function Definitions

**For Pre-Dev Planning**  
**Version:** 2026.2.23  
**Date:** February 26, 2026

---

## 1. GATEWAY FUNCTIONS

### 1.1 Server Lifecycle

```typescript
/**
 * Start the Gateway WebSocket server
 * @param config - Gateway configuration
 * @returns Running server instance
 */
function startGateway(config: GatewayConfig): Promise<GatewayServer>;

/**
 * Stop the Gateway server gracefully
 * @param server - Server instance to stop
 * @param timeoutMs - Grace period for connections
 */
function stopGateway(server: GatewayServer, timeoutMs?: number): Promise<void>;

/**
 * Reload configuration without restart
 * @param server - Running server instance
 * @param config - New configuration
 */
function reloadGatewayConfig(server: GatewayServer, config: OpenClawConfig): void;

/**
 * Get current gateway health status
 * @returns Health snapshot with channel states
 */
function getGatewayHealth(): GatewayHealthSnapshot;
```

### 1.2 Protocol Handling

```typescript
/**
 * Handle incoming WebSocket connection
 * @param socket - WebSocket connection
 * @param request - HTTP upgrade request
 */
function handleConnection(socket: WebSocket, request: IncomingMessage): void;

/**
 * Process incoming frame
 * @param frame - Parsed frame
 * @param context - Connection context
 * @returns Response frame or void for events
 */
function processFrame(frame: RequestFrame, context: ConnectionContext): Promise<ResponseFrame | void>;

/**
 * Validate frame against protocol schema
 * @param frame - Raw frame data
 * @returns Validated frame or error
 */
function validateFrame(frame: unknown): RequestFrame | ResponseFrame | EventFrame;

/**
 * Broadcast event to all connected clients
 * @param event - Event name
 * @param payload - Event payload
 * @param filter - Optional client filter
 */
function broadcastEvent(event: string, payload: unknown, filter?: ClientFilter): void;

/**
 * Send response to specific client
 * @param clientId - Target client
 * @param response - Response frame
 */
function sendResponse(clientId: string, response: ResponseFrame): void;
```

### 1.3 Authentication

```typescript
/**
 * Validate authentication token
 * @param token - Token from connect params
 * @returns Whether token is valid
 */
function validateAuthToken(token: string): boolean;

/**
 * Generate device token after pairing
 * @param deviceId - Device fingerprint
 * @param role - Client role
 * @param scopes - Granted scopes
 * @returns Signed device token
 */
function generateDeviceToken(deviceId: string, role: ClientRole, scopes: string[]): string;

/**
 * Verify device signature for connect
 * @param device - Device auth payload
 * @param challenge - Challenge nonce
 * @returns Whether signature is valid
 */
function verifyDeviceSignature(device: DeviceAuth, challenge: string): boolean;

/**
 * Load or create device identity
 * @param filePath - Path to identity file
 * @returns Device identity with keys
 */
function loadOrCreateDeviceIdentity(filePath?: string): DeviceIdentity;
```

---

## 2. SESSION FUNCTIONS

### 2.1 Session Management

```typescript
/**
 * Create or load session for key
 * @param sessionKey - Session identifier
 * @param agentId - Agent identifier
 * @returns Session entry
 */
function getOrCreateSession(sessionKey: string, agentId: string): Promise<SessionEntry>;

/**
 * Resolve session key from inbound message
 * @param message - Inbound message
 * @param config - Config with dmScope
 * @returns Resolved session key
 */
function resolveSessionKey(message: InboundMessage, config: SessionConfig): string;

/**
 * Update session after agent run
 * @param sessionKey - Session to update
 * @param usage - Token usage from run
 */
function updateSessionUsage(sessionKey: string, usage: TokenUsage): Promise<void>;

/**
 * List sessions with optional filters
 * @param params - Filter parameters
 * @returns Matching session entries
 */
function listSessions(params: SessionsListParams): Promise<SessionEntry[]>;

/**
 * Delete session and transcript
 * @param sessionKey - Session to delete
 */
function deleteSession(sessionKey: string): Promise<void>;

/**
 * Compact session context
 * @param sessionKey - Session to compact
 * @param summary - Compacted summary
 */
function compactSession(sessionKey: string, summary: string): Promise<void>;
```

### 2.2 Session Maintenance

```typescript
/**
 * Run session maintenance
 * @param config - Maintenance config
 * @param mode - Warn or enforce
 * @returns Maintenance report
 */
function runSessionMaintenance(config: SessionMaintenanceConfig, mode: "warn" | "enforce"): Promise<MaintenanceReport>;

/**
 * Prune stale sessions older than threshold
 * @param threshold - Cutoff timestamp
 * @returns Pruned session keys
 */
function pruneStaleSession(threshold: number): Promise<string[]>;

/**
 * Rotate session store when too large
 * @param maxBytes - Size threshold
 */
function rotateSessionStore(maxBytes: number): Promise<void>;
```

### 2.3 Transcript Operations

```typescript
/**
 * Append message to transcript
 * @param sessionFile - Path to JSONL file
 * @param message - Message to append
 */
function appendToTranscript(sessionFile: string, message: TranscriptMessage): Promise<void>;

/**
 * Load transcript history
 * @param sessionFile - Path to JSONL file
 * @param limit - Max messages to load
 * @returns Transcript messages
 */
function loadTranscript(sessionFile: string, limit?: number): Promise<TranscriptMessage[]>;

/**
 * Truncate transcript to limit
 * @param sessionFile - Path to JSONL file
 * @param keepMessages - Messages to keep
 */
function truncateTranscript(sessionFile: string, keepMessages: number): Promise<void>;
```

---

## 3. CHANNEL FUNCTIONS

### 3.1 Channel Lifecycle

```typescript
/**
 * Initialize all configured channels
 * @param config - Channels configuration
 * @returns Initialized plugins
 */
function initializeChannels(config: ChannelsConfig): Promise<Map<ChannelId, ChannelPlugin>>;

/**
 * Start channel plugin
 * @param channel - Channel identifier
 * @param plugin - Plugin instance
 */
function startChannel(channel: ChannelId, plugin: ChannelPlugin): Promise<void>;

/**
 * Stop channel plugin gracefully
 * @param channel - Channel identifier
 * @param plugin - Plugin instance
 */
function stopChannel(channel: ChannelId, plugin: ChannelPlugin): Promise<void>;

/**
 * Get channel status
 * @param channel - Channel identifier
 * @returns Status with connection state
 */
function getChannelStatus(channel: ChannelId): ChannelStatus;

/**
 * Reload channel configuration
 * @param channel - Channel identifier
 * @param config - New configuration
 */
function reloadChannelConfig(channel: ChannelId, config: ChannelConfig): Promise<void>;
```

### 3.2 Message Routing

```typescript
/**
 * Route inbound message to session
 * @param message - Inbound message
 * @returns Processing result
 */
function routeInboundMessage(message: InboundMessage): Promise<RouteResult>;

/**
 * Check if sender is allowed
 * @param channel - Channel identifier
 * @param senderId - Sender identifier
 * @param isGroup - Whether group context
 * @returns Whether allowed
 */
function checkSenderAllowed(channel: ChannelId, senderId: string, isGroup: boolean): Promise<boolean>;

/**
 * Generate pairing code for sender
 * @param channel - Channel identifier
 * @param senderId - Sender identifier
 * @returns Pairing code
 */
function generatePairingCode(channel: ChannelId, senderId: string): Promise<string>;

/**
 * Approve pairing by code
 * @param channel - Channel identifier
 * @param code - Pairing code
 * @returns Approved sender or null
 */
function approvePairingCode(channel: ChannelId, code: string): Promise<string | null>;
```

### 3.3 Outbound Delivery

```typescript
/**
 * Send message to channel target
 * @param channel - Channel identifier
 * @param target - Target (chat/user)
 * @param message - Message to send
 * @returns Send result
 */
function sendToChannel(channel: ChannelId, target: string, message: OutboundMessage): Promise<SendResult>;

/**
 * Chunk message for channel limits
 * @param channel - Channel identifier
 * @param text - Full text
 * @returns Chunked parts
 */
function chunkMessage(channel: ChannelId, text: string): string[];

/**
 * Upload media to channel
 * @param channel - Channel identifier
 * @param media - Media attachment
 * @returns Uploaded URL or ID
 */
function uploadMedia(channel: ChannelId, media: MediaAttachment): Promise<string>;

/**
 * Stream response to channel
 * @param channel - Channel identifier
 * @param target - Target chat
 * @param stream - Response stream
 */
function streamToChannel(channel: ChannelId, target: string, stream: AsyncIterable<string>): Promise<void>;
```

---

## 4. AGENT FUNCTIONS

### 4.1 Agent Runtime

```typescript
/**
 * Run embedded Pi agent
 * @param params - Run parameters
 * @returns Run result with response
 */
function runEmbeddedPiAgent(params: AgentRunParams): Promise<AgentRunResult>;

/**
 * Create agent session
 * @param sessionKey - Session identifier
 * @param config - Agent config
 * @returns Agent session
 */
function createAgentSession(sessionKey: string, config: AgentConfig): Promise<AgentSession>;

/**
 * Build system prompt for context
 * @param context - Session context
 * @param config - Agent config
 * @returns Built system prompt
 */
function buildSystemPrompt(context: SessionContext, config: AgentConfig): string;

/**
 * Inject workspace files into prompt
 * @param workspaceDir - Workspace path
 * @param files - Files to inject
 * @returns Injected content
 */
function injectWorkspaceFiles(workspaceDir: string, files: string[]): Promise<string>;

/**
 * Handle vision model image injection
 * @param images - Image paths/URLs
 * @param config - Vision config
 * @returns Processed images
 */
function processVisionImages(images: string[], config: VisionConfig): Promise<ProcessedImage[]>;
```

### 4.2 Model Management

```typescript
/**
 * Resolve model from config
 * @param modelRef - Model reference (provider/model or alias)
 * @param config - Model config
 * @returns Resolved model
 */
function resolveModel(modelRef: string, config: ModelConfig): ResolvedModel;

/**
 * Get auth profile for provider
 * @param provider - Provider name
 * @returns Auth credentials
 */
function getAuthProfile(provider: string): AuthProfile;

/**
 * Handle model failover
 * @param primary - Primary model
 * @param fallbacks - Fallback models
 * @param error - Primary error
 * @returns Fallback model or throws
 */
function handleModelFailover(primary: string, fallbacks: string[], error: Error): ResolvedModel;

/**
 * Check context window limit
 * @param model - Model to check
 * @param tokens - Current token count
 * @returns Whether within limit
 */
function checkContextWindow(model: ResolvedModel, tokens: number): boolean;
```

### 4.3 Tool Registration

```typescript
/**
 * Create OpenClaw coding tools
 * @param context - Tool context
 * @returns Tool array
 */
function createOpenClawCodingTools(context: ToolContext): AgentTool[];

/**
 * Register custom tool
 * @param tool - Tool to register
 * @param agentId - Agent scope
 */
function registerTool(tool: AgentTool, agentId?: string): void;

/**
 * Get tool by name
 * @param name - Tool name
 * @param agentId - Agent scope
 * @returns Tool or undefined
 */
function getTool(name: string, agentId?: string): AgentTool | undefined;

/**
 * Apply tool policy (allow/deny)
 * @param tools - Available tools
 * @param policy - Tool policy config
 * @returns Filtered tools
 */
function applyToolPolicy(tools: AgentTool[], policy: ToolPolicyConfig): AgentTool[];
```

---

## 5. TOOL FUNCTIONS

### 5.1 Exec Tool

```typescript
/**
 * Execute shell command
 * @param params - Exec parameters
 * @param context - Tool context
 * @returns Execution result
 */
function executeCommand(params: ExecParams, context: ToolContext): Promise<ExecResult>;

/**
 * Analyze command for safety
 * @param command - Command string
 * @param cwd - Working directory
 * @returns Analysis result
 */
function analyzeShellCommand(command: string, cwd?: string): ExecCommandAnalysis;

/**
 * Check exec approval
 * @param command - Command to check
 * @param approvals - Approval config
 * @returns Whether approved
 */
function checkExecApproval(command: string, approvals: ExecApprovalsResolved): boolean;

/**
 * Request exec approval via socket
 * @param params - Approval request
 * @returns Decision or null if timeout
 */
function requestExecApproval(params: ExecApprovalRequest): Promise<ExecApprovalDecision | null>;

/**
 * Create PTY session
 * @param command - Command to run
 * @param options - PTY options
 * @returns PTY session
 */
function createPtySession(command: string, options: PtyOptions): PtySession;
```

### 5.2 Process Tool

```typescript
/**
 * List active process sessions
 * @param agentId - Agent scope
 * @returns Session list
 */
function listProcessSessions(agentId: string): ProcessSession[];

/**
 * Poll process session for output
 * @param sessionId - Session to poll
 * @param timeoutMs - Poll timeout
 * @returns Output since last poll
 */
function pollProcessSession(sessionId: string, timeoutMs?: number): Promise<ProcessPollResult>;

/**
 * Write to process stdin
 * @param sessionId - Target session
 * @param data - Data to write
 */
function writeToProcess(sessionId: string, data: string): Promise<void>;

/**
 * Send keys to PTY session
 * @param sessionId - Target session
 * @param keys - Key tokens
 */
function sendKeysToProcess(sessionId: string, keys: string[]): Promise<void>;

/**
 * Kill process session
 * @param sessionId - Session to kill
 * @param signal - Signal to send
 */
function killProcess(sessionId: string, signal?: string): Promise<void>;
```

### 5.3 Browser Tool

```typescript
/**
 * Start browser for profile
 * @param profile - Profile name
 * @param config - Browser config
 * @returns Browser instance
 */
function startBrowser(profile: string, config: BrowserConfig): Promise<BrowserInstance>;

/**
 * Stop browser profile
 * @param profile - Profile name
 */
function stopBrowser(profile: string): Promise<void>;

/**
 * Get browser status
 * @param profile - Profile name
 * @returns Status with tabs
 */
function getBrowserStatus(profile: string): BrowserStatus;

/**
 * Open URL in browser
 * @param profile - Profile name
 * @param url - URL to open
 * @returns Tab info
 */
function openBrowserTab(profile: string, url: string): Promise<TabInfo>;

/**
 * Take page snapshot
 * @param profile - Profile name
 * @param targetId - Tab target
 * @returns Snapshot with content
 */
function takeSnapshot(profile: string, targetId: string): Promise<BrowserSnapshot>;

/**
 * Execute browser action
 * @param profile - Profile name
 * @param targetId - Tab target
 * @param action - Action to perform
 */
function executeBrowserAction(profile: string, targetId: string, action: BrowserRequest): Promise<void>;

/**
 * Take screenshot
 * @param profile - Profile name
 * @param targetId - Tab target
 * @param options - Screenshot options
 * @returns Screenshot buffer
 */
function takeScreenshot(profile: string, targetId: string, options?: ScreenshotOptions): Promise<Buffer>;
```

### 5.4 Web Tools

```typescript
/**
 * Search web via Brave API
 * @param query - Search query
 * @param options - Search options
 * @returns Search results
 */
function webSearch(query: string, options?: WebSearchOptions): Promise<WebSearchResult>;

/**
 * Fetch URL content
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Extracted content
 */
function webFetch(url: string, options?: WebFetchOptions): Promise<WebFetchResult>;

/**
 * Guard fetch against SSRF
 * @param params - Guarded fetch params
 * @returns Response with release
 */
function fetchWithSsrfGuard(params: GuardedFetchOptions): Promise<GuardedFetchResult>;
```

### 5.5 Message Tool

```typescript
/**
 * Send message via channel
 * @param params - Send parameters
 * @returns Send result
 */
function sendMessage(params: MessageSendParams): Promise<MessageSendResult>;

/**
 * React to message
 * @param channel - Channel identifier
 * @param messageId - Message to react to
 * @param emoji - Reaction emoji
 */
function addReaction(channel: ChannelId, messageId: string, emoji: string): Promise<void>;

/**
 * Delete message
 * @param channel - Channel identifier
 * @param messageId - Message to delete
 */
function deleteMessage(channel: ChannelId, messageId: string): Promise<void>;
```

### 5.6 Session Tools

```typescript
/**
 * Spawn sub-agent session
 * @param params - Spawn parameters
 * @returns Spawned session info
 */
function spawnSubagent(params: SessionsSpawnParams): Promise<SpawnedSession>;

/**
 * Send message to session
 * @param sessionKey - Target session
 * @param message - Message content
 * @returns Send result
 */
function sendToSession(sessionKey: string, message: string): Promise<SessionSendResult>;

/**
 * Fetch session history
 * @param sessionKey - Target session
 * @param limit - Max messages
 * @returns History messages
 */
function fetchSessionHistory(sessionKey: string, limit?: number): Promise<HistoryMessage[]>;

/**
 * List active subagents
 * @param parentSession - Parent session key
 * @returns Subagent list
 */
function listSubagents(parentSession: string): SubagentInfo[];

/**
 * Kill subagent session
 * @param sessionKey - Session to kill
 */
function killSubagent(sessionKey: string): Promise<void>;

/**
 * Steer subagent with message
 * @param sessionKey - Target session
 * @param message - Steering message
 */
function steerSubagent(sessionKey: string, message: string): Promise<void>;
```

---

## 6. CRON FUNCTIONS

```typescript
/**
 * Add cron job
 * @param job - Job definition
 * @returns Created job ID
 */
function addCronJob(job: Omit<CronJob, "id" | "createdAt" | "runCount">): Promise<string>;

/**
 * Update cron job
 * @param jobId - Job to update
 * @param updates - Fields to update
 */
function updateCronJob(jobId: string, updates: Partial<CronJob>): Promise<void>;

/**
 * Delete cron job
 * @param jobId - Job to delete
 */
function deleteCronJob(jobId: string): Promise<void>;

/**
 * List cron jobs
 * @param filter - Optional filter
 * @returns Matching jobs
 */
function listCronJobs(filter?: CronJobFilter): CronJob[];

/**
 * Run cron job immediately
 * @param jobId - Job to run
 * @returns Run result
 */
function runCronJob(jobId: string): Promise<CronRunResult>;

/**
 * Calculate next run time
 * @param schedule - Job schedule
 * @returns Next run timestamp
 */
function calculateNextRun(schedule: CronSchedule): Date;

/**
 * Start cron scheduler
 * @param config - Cron config
 * @returns Scheduler instance
 */
function startCronScheduler(config: CronConfig): CronScheduler;

/**
 * Stop cron scheduler
 * @param scheduler - Scheduler to stop
 */
function stopCronScheduler(scheduler: CronScheduler): void;
```

---

## 7. SKILL FUNCTIONS

```typescript
/**
 * Load skills from all locations
 * @param config - Skills config
 * @returns Loaded skills
 */
function loadSkills(config: SkillsConfig): Promise<LoadedSkill[]>;

/**
 * Parse SKILL.md file
 * @param filePath - Path to SKILL.md
 * @returns Parsed manifest
 */
function parseSkillManifest(filePath: string): SkillManifest;

/**
 * Check skill requirements
 * @param skill - Skill to check
 * @param env - Environment
 * @returns Whether requirements met
 */
function checkSkillRequirements(skill: SkillManifest, env: NodeJS.ProcessEnv): boolean;

/**
 * Build skill prompt section
 * @param skills - Skills to include
 * @returns Formatted prompt section
 */
function buildSkillsPrompt(skills: LoadedSkill[]): string;

/**
 * Install skill from ClawHub
 * @param slug - Skill slug
 * @param targetDir - Install directory
 */
function installSkill(slug: string, targetDir: string): Promise<void>;

/**
 * Update installed skills
 * @param targetDir - Skills directory
 * @returns Updated skill names
 */
function updateSkills(targetDir: string): Promise<string[]>;
```

---

## 8. NODE FUNCTIONS

```typescript
/**
 * List connected nodes
 * @returns Node info list
 */
function listNodes(): NodeInfo[];

/**
 * Describe node capabilities
 * @param nodeId - Node to describe
 * @returns Detailed capabilities
 */
function describeNode(nodeId: string): NodeDescription;

/**
 * Invoke command on node
 * @param params - Invoke parameters
 * @returns Invoke result
 */
function invokeNodeCommand(params: NodeInvokeParams): Promise<NodeInvokeResult>;

/**
 * Send notification to node
 * @param nodeId - Target node
 * @param notification - Notification content
 */
function notifyNode(nodeId: string, notification: NodeNotification): Promise<void>;

/**
 * Take camera snapshot
 * @param nodeId - Target node
 * @param options - Camera options
 * @returns Image data
 */
function cameraSnap(nodeId: string, options?: CameraOptions): Promise<Buffer>;

/**
 * Start screen recording
 * @param nodeId - Target node
 * @param options - Recording options
 * @returns Recording handle
 */
function startScreenRecord(nodeId: string, options?: ScreenRecordOptions): Promise<RecordingHandle>;

/**
 * Get device location
 * @param nodeId - Target node
 * @param options - Location options
 * @returns Location data
 */
function getLocation(nodeId: string, options?: LocationOptions): Promise<LocationData>;
```

---

## 9. MEMORY FUNCTIONS

```typescript
/**
 * Search memory files
 * @param params - Search parameters
 * @returns Search results
 */
function searchMemory(params: MemorySearchParams): Promise<MemorySearchResult[]>;

/**
 * Get memory snippet
 * @param params - Get parameters
 * @returns File content
 */
function getMemory(params: MemoryGetParams): Promise<string>;

/**
 * Index memory file
 * @param filePath - File to index
 */
function indexMemoryFile(filePath: string): Promise<void>;

/**
 * Rebuild memory index
 * @param workspaceDir - Workspace path
 */
function rebuildMemoryIndex(workspaceDir: string): Promise<void>;
```

---

## 10. CONFIG FUNCTIONS

```typescript
/**
 * Load config from file
 * @param filePath - Config file path
 * @returns Parsed config
 */
function loadConfig(filePath?: string): OpenClawConfig;

/**
 * Save config to file
 * @param config - Config to save
 * @param filePath - Target path
 */
function saveConfig(config: OpenClawConfig, filePath?: string): void;

/**
 * Validate config against schema
 * @param config - Config to validate
 * @returns Validation result
 */
function validateConfig(config: unknown): ValidationResult;

/**
 * Get config value by path
 * @param path - Dot-separated path
 * @returns Config value
 */
function getConfigValue(path: string): unknown;

/**
 * Set config value by path
 * @param path - Dot-separated path
 * @param value - Value to set
 */
function setConfigValue(path: string, value: unknown): void;

/**
 * Watch config file for changes
 * @param callback - Change callback
 * @returns Unwatch function
 */
function watchConfig(callback: (config: OpenClawConfig) => void): () => void;

/**
 * Migrate config to latest version
 * @param config - Config to migrate
 * @returns Migrated config
 */
function migrateConfig(config: unknown): OpenClawConfig;
```

---

## 11. LOGGING FUNCTIONS

```typescript
/**
 * Get logger instance
 * @returns Root logger
 */
function getLogger(): Logger;

/**
 * Create subsystem logger
 * @param subsystem - Subsystem name
 * @returns Subsystem logger
 */
function createSubsystemLogger(subsystem: string): SubsystemLogger;

/**
 * Set log level
 * @param level - New level
 */
function setLogLevel(level: LogLevel): void;

/**
 * Enable console capture
 * @param enabled - Whether to capture
 */
function enableConsoleCapture(enabled: boolean): void;

/**
 * Route logs to stderr
 * @param enabled - Whether to route
 */
function routeLogsToStderr(enabled: boolean): void;

/**
 * Set subsystem filter
 * @param filter - Subsystem patterns
 */
function setConsoleSubsystemFilter(filter: string[]): void;
```

---

## 12. UTILITY FUNCTIONS

```typescript
/**
 * Parse duration string
 * @param duration - Duration string (e.g., "30m")
 * @returns Milliseconds
 */
function parseDuration(duration: string): number;

/**
 * Parse size string
 * @param size - Size string (e.g., "10mb")
 * @returns Bytes
 */
function parseSize(size: string): number;

/**
 * Extract archive
 * @param params - Extract parameters
 */
function extractArchive(params: ArchiveExtractParams): Promise<void>;

/**
 * Load JSON file
 * @param pathname - File path
 * @returns Parsed JSON
 */
function loadJsonFile<T>(pathname: string): T;

/**
 * Save JSON file
 * @param pathname - File path
 * @param data - Data to save
 */
function saveJsonFile(pathname: string, data: unknown): void;

/**
 * Check if file exists
 * @param filePath - File path
 * @returns Whether exists
 */
function fileExists(filePath: string): Promise<boolean>;

/**
 * Resolve home directory path
 * @param path - Path with ~ prefix
 * @returns Resolved absolute path
 */
function resolveHomePath(path: string): string;

/**
 * Generate UUID
 * @returns UUID string
 */
function generateUuid(): string;

/**
 * Hash string with SHA256
 * @param input - String to hash
 * @returns Hex hash
 */
function hashSha256(input: string): string;

/**
 * Sleep for duration
 * @param ms - Milliseconds
 */
function sleep(ms: number): Promise<void>;

/**
 * Retry with backoff
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Function result
 */
function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
```

---

*These function signatures provide the complete API surface for implementing OpenClaw. Use with Pre-Dev for detailed implementation planning.*
