# OpenClaw API Versioning & Deprecation Policy

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. VERSIONING STRATEGY

### 1.1 Version Numbering Scheme

OpenClaw uses **Calendar Versioning (CalVer)** for releases and **Integer Versioning** for protocols.

**Package Version (CalVer):**
```
YYYY.M.D[-modifier]

Examples:
  2026.2.26        # Release on Feb 26, 2026
  2026.2.26-1      # Patch release same day
  2026.2.26-beta.1 # Beta release
  2026.2.26-rc.1   # Release candidate
```

**Protocol Version (Integer):**
```
N (incrementing integer)

Examples:
  Protocol 3  # Current stable
  Protocol 4  # Next major (breaking changes)
```

**Rationale:**
- CalVer for packages: Clear release timeline, no "what does major mean?" debates
- Integer for protocol: Simple negotiation, clear breaking changes

### 1.2 Version Components

| Component | Versioning | Location | Breaking Change = |
|-----------|------------|----------|-------------------|
| npm Package | CalVer | package.json | New date |
| Gateway Protocol | Integer | PROTOCOL_VERSION const | Increment |
| Config Schema | Integer | schema.$version | Increment |
| Database Schema | Integer | migrations table | New migration |
| CLI Commands | N/A (stable) | - | Deprecation cycle |
| Tool Definitions | Semver-ish | Tool schema | Major increment |

---

## 2. PROTOCOL VERSIONING

### 2.1 Version Negotiation

```
┌─────────┐                              ┌─────────┐
│  Client │                              │ Gateway │
└────┬────┘                              └────┬────┘
     │                                        │
     │  connect {                             │
     │    minProtocol: 3,                     │
     │    maxProtocol: 4                      │
     │  }                                     │
     │───────────────────────────────────────>│
     │                                        │
     │                     Negotiate: max(min(client.max, server.current), client.min)
     │                                        │
     │  hello-ok {                            │
     │    protocol: 3                         │
     │  }                                     │
     │<───────────────────────────────────────│
     │                                        │
     │  (Communication uses protocol 3)       │
     │                                        │
```

### 2.2 Version Compatibility Rules

| Client | Server | Result |
|--------|--------|--------|
| min=3, max=3 | current=3 | ✅ Use 3 |
| min=3, max=4 | current=3 | ✅ Use 3 |
| min=3, max=4 | current=4 | ✅ Use 4 |
| min=4, max=4 | current=3 | ❌ Reject (client too new) |
| min=2, max=2 | current=3 | ❌ Reject (client too old) |

### 2.3 Protocol Change Categories

| Category | Example | Version Impact |
|----------|---------|----------------|
| **Additive** | New optional field | None (backwards compatible) |
| **Additive** | New method | None (unknown methods already error) |
| **Behavioral** | Change default value | Document, no version bump |
| **Breaking** | Remove field | Increment protocol version |
| **Breaking** | Change field type | Increment protocol version |
| **Breaking** | Change method signature | Increment protocol version |

---

## 3. BACKWARDS COMPATIBILITY

### 3.1 Compatibility Guarantees

| Component | Guarantee |
|-----------|-----------|
| Protocol N | Supported for 12 months after N+1 release |
| Config keys | Deprecated keys work for 6 months |
| CLI commands | Deprecated commands work for 6 months |
| Tool parameters | Additive only (no removal without deprecation) |
| File formats | Migration provided for 2 major versions |

### 3.2 Compatibility Matrix

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROTOCOL COMPATIBILITY MATRIX                    │
├───────────────┬─────────────┬─────────────┬─────────────┬──────────┤
│ Gateway       │ Protocol 2  │ Protocol 3  │ Protocol 4  │ Protocol 5│
│ Version       │ (legacy)    │ (current)   │ (next)      │ (future) │
├───────────────┼─────────────┼─────────────┼─────────────┼──────────┤
│ 2025.x        │ ✅ Native   │ ❌          │ ❌          │ ❌       │
│ 2026.1.x      │ ⚠️ Compat   │ ✅ Native   │ ❌          │ ❌       │
│ 2026.6.x      │ ❌ Removed  │ ✅ Native   │ ⚠️ Preview  │ ❌       │
│ 2026.12.x     │ ❌          │ ⚠️ Compat   │ ✅ Native   │ ❌       │
│ 2027.6.x      │ ❌          │ ❌ Removed  │ ✅ Native   │ ⚠️ Preview│
└───────────────┴─────────────┴─────────────┴─────────────┴──────────┘

Legend: ✅ Full support  ⚠️ Compatibility/Preview  ❌ Not supported
```

### 3.3 Feature Flags for Compatibility

```json5
{
  "compatibility": {
    // Enable legacy protocol support
    "protocolV2": true,  // Default: false after 2026.6
    
    // Accept deprecated config keys
    "legacyConfigKeys": true,  // Default: true
    
    // Accept deprecated CLI flags
    "legacyCLIFlags": true,  // Default: true
  }
}
```

---

## 4. DEPRECATION PROCESS

### 4.1 Deprecation Timeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DEPRECATION TIMELINE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  T+0: Announce Deprecation                                          │
│  ├── Add to CHANGELOG                                               │
│  ├── Add deprecation warning in code                                │
│  ├── Update documentation                                           │
│  └── Announce in Discord #announcements                             │
│                                                                     │
│  T+3 months: Active Warning Phase                                   │
│  ├── Log warnings on use (WARN level)                               │
│  ├── Show deprecation notice in CLI output                          │
│  └── Include migration guide                                        │
│                                                                     │
│  T+6 months: Removal Eligible                                       │
│  ├── Feature can be removed in next release                         │
│  ├── Error instead of warning (configurable)                        │
│  └── Final migration reminder                                       │
│                                                                     │
│  T+6+ months: Removed                                               │
│  ├── Code removed from codebase                                     │
│  ├── Clear error message with migration path                        │
│  └── Documentation archived                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Deprecation Announcement Template

```markdown
## Deprecation Notice: [Feature Name]

**Deprecated in:** 2026.2.26
**Removal planned:** 2026.8.26 (or later)
**Affects:** [Who/what is affected]

### What's Changing
[Description of what's being deprecated]

### Why
[Rationale for deprecation]

### Migration Path
[Step-by-step migration instructions]

### Example

Before (deprecated):
```json
{ "oldKey": "value" }
```

After (new):
```json
{ "newKey": "value" }
```

### Timeline
- 2026.2.26: Deprecation warning added
- 2026.5.26: Warning becomes more prominent
- 2026.8.26: Feature may be removed

### Questions?
Join #support on Discord or open a GitHub issue.
```

### 4.3 Deprecation Warning Implementation

```typescript
// Deprecation helper
function deprecated(
  feature: string,
  since: string,
  removal: string,
  migration: string
): void {
  const message = [
    `DEPRECATED: ${feature}`,
    `Deprecated since: ${since}`,
    `Planned removal: ${removal}`,
    `Migration: ${migration}`,
  ].join('\n');
  
  logger.warn(message);
  
  // Emit metric for tracking
  metrics.increment('deprecation.usage', { feature });
}

// Usage in code
if (config.oldKey !== undefined) {
  deprecated(
    'config.oldKey',
    '2026.2.26',
    '2026.8.26',
    'Use config.newKey instead. See https://docs.openclaw.ai/migration/old-key'
  );
  config.newKey = config.newKey ?? config.oldKey;
}
```

---

## 5. MIGRATION GUIDES

### 5.1 Migration Guide Template

```markdown
# Migration Guide: [Version X] to [Version Y]

## Overview
- **From:** 2026.1.x
- **To:** 2026.2.x
- **Breaking changes:** Yes/No
- **Estimated effort:** 5 minutes / 30 minutes / 2 hours

## Prerequisites
- Backup your configuration
- Ensure no active sessions

## Step-by-Step Migration

### Step 1: Update Package
```bash
npm update -g openclaw@latest
```

### Step 2: Run Migration
```bash
openclaw doctor --fix
```

### Step 3: Update Configuration
[Specific config changes needed]

### Step 4: Verify
```bash
openclaw doctor
openclaw status
```

## Breaking Changes

### [Change 1 Name]
**Before:**
```json
{ "old": "format" }
```

**After:**
```json
{ "new": "format" }
```

**Automatic migration:** Yes / No
**Manual steps required:** [Steps if any]

## Rollback Procedure
If issues occur:
```bash
npm install -g openclaw@2026.1.x
openclaw backup restore --from <backup>
```

## FAQ

**Q: Will my sessions be preserved?**
A: Yes, sessions are automatically migrated.

**Q: Do I need to re-pair devices?**
A: No, unless noted in breaking changes.
```

### 5.2 Automated Migration System

```typescript
// Migration registry
const migrations: Migration[] = [
  {
    fromVersion: '2026.1.0',
    toVersion: '2026.2.0',
    description: 'Rename channels.whatsapp.dm to channels.whatsapp.dmPolicy',
    
    async check(config: unknown): Promise<boolean> {
      return config?.channels?.whatsapp?.dm !== undefined;
    },
    
    async migrate(config: unknown): Promise<unknown> {
      if (config?.channels?.whatsapp?.dm) {
        config.channels.whatsapp.dmPolicy = config.channels.whatsapp.dm.policy;
        delete config.channels.whatsapp.dm;
      }
      return config;
    },
    
    async rollback(config: unknown): Promise<unknown> {
      // Reverse migration if needed
      if (config?.channels?.whatsapp?.dmPolicy) {
        config.channels.whatsapp.dm = { 
          policy: config.channels.whatsapp.dmPolicy 
        };
        delete config.channels.whatsapp.dmPolicy;
      }
      return config;
    }
  },
];

// Migration runner
async function runMigrations(
  config: unknown, 
  fromVersion: string, 
  toVersion: string
): Promise<MigrationResult> {
  const applicable = migrations.filter(m => 
    semver.gt(m.toVersion, fromVersion) && 
    semver.lte(m.toVersion, toVersion)
  );
  
  const results: MigrationStepResult[] = [];
  let current = config;
  
  for (const migration of applicable) {
    const needed = await migration.check(current);
    if (needed) {
      const backup = structuredClone(current);
      try {
        current = await migration.migrate(current);
        results.push({ migration, success: true });
      } catch (error) {
        current = backup;
        results.push({ migration, success: false, error });
        break; // Stop on first failure
      }
    }
  }
  
  return { config: current, results };
}
```

---

## 6. CLIENT VERSION REQUIREMENTS

### 6.1 Minimum Client Versions

| Gateway Version | CLI Min | macOS App Min | iOS App Min | Android Min |
|-----------------|---------|---------------|-------------|-------------|
| 2026.2.x | 2026.1.0 | 1.5.0 | 1.3.0 | 1.2.0 |
| 2026.6.x | 2026.2.0 | 1.6.0 | 1.4.0 | 1.3.0 |
| 2026.12.x | 2026.6.0 | 2.0.0 | 2.0.0 | 2.0.0 |

### 6.2 Version Check Flow

```typescript
// Gateway checks client version on connect
function checkClientVersion(
  clientVersion: string,
  clientType: 'cli' | 'macos' | 'ios' | 'android'
): VersionCheckResult {
  const minVersion = MIN_CLIENT_VERSIONS[clientType];
  
  if (semver.lt(clientVersion, minVersion)) {
    return {
      allowed: false,
      error: `Client version ${clientVersion} is too old. ` +
             `Minimum required: ${minVersion}. ` +
             `Please update your ${clientType} client.`,
      upgradeUrl: UPGRADE_URLS[clientType],
    };
  }
  
  const warnVersion = WARN_CLIENT_VERSIONS[clientType];
  if (warnVersion && semver.lt(clientVersion, warnVersion)) {
    return {
      allowed: true,
      warning: `Client version ${clientVersion} is outdated. ` +
               `Consider upgrading to ${warnVersion} or later.`,
    };
  }
  
  return { allowed: true };
}
```

---

## 7. CHANGELOG STANDARDS

### 7.1 Changelog Format

```markdown
# Changelog

All notable changes to OpenClaw are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2026.2.26] - 2026-02-26

### Added
- New feature X that does Y (#123)
- Support for Z integration (#124)

### Changed
- Improved performance of A by 50% (#125)
- Updated dependency B to v2.0 (#126)

### Deprecated
- `config.oldKey` - Use `config.newKey` instead. Removal in 2026.8.
- CLI flag `--old-flag` - Use `--new-flag` instead.

### Removed
- `config.ancientKey` (deprecated in 2025.8)
- Support for Protocol 1

### Fixed
- Bug where X would cause Y (#127)
- Memory leak in Z component (#128)

### Security
- Fixed vulnerability in dependency A (CVE-2026-XXXX)

### Migration Required
- Run `openclaw doctor --fix` after upgrade
- See [Migration Guide](./docs/migrations/2026.2.md)
```

### 7.2 Change Classification

| Type | Description | Requires |
|------|-------------|----------|
| Added | New features | Documentation |
| Changed | Behavior changes | Documentation, possibly migration |
| Deprecated | Soon-to-be-removed | Deprecation notice, migration guide |
| Removed | Deleted features | Migration guide |
| Fixed | Bug fixes | Release notes |
| Security | Security patches | CVE reference if applicable |

---

## 8. SDK/CLIENT VERSIONING

### 8.1 SDK Compatibility Promise

For clients integrating via the WebSocket protocol:

1. **Protocol stability**: Same protocol version = same behavior
2. **Additive changes**: New fields/methods don't break existing clients
3. **Negotiation**: Clients specify supported protocol range
4. **Graceful degradation**: Unknown fields are ignored

### 8.2 SDK Version Recommendations

```typescript
// Recommended version check in SDK
const RECOMMENDED_PROTOCOL = 3;
const MIN_PROTOCOL = 3;
const MAX_PROTOCOL = 4;

function getProtocolRange(): { min: number; max: number } {
  return {
    min: MIN_PROTOCOL,
    max: MAX_PROTOCOL,
  };
}

function handleProtocolMismatch(serverProtocol: number): void {
  if (serverProtocol < MIN_PROTOCOL) {
    throw new Error(
      `Server protocol ${serverProtocol} is too old. ` +
      `This SDK requires at least protocol ${MIN_PROTOCOL}. ` +
      `Please upgrade your OpenClaw server.`
    );
  }
  if (serverProtocol > MAX_PROTOCOL) {
    console.warn(
      `Server protocol ${serverProtocol} is newer than SDK supports. ` +
      `Consider upgrading this SDK for full compatibility.`
    );
  }
}
```

---

## 9. EMERGENCY VERSIONING

### 9.1 Hotfix Process

For critical bugs or security issues:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOTFIX PROCESS                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Identify critical issue                                         │
│     └── Security vulnerability OR                                   │
│     └── Data loss bug OR                                            │
│     └── Complete outage                                             │
│                                                                     │
│  2. Create hotfix branch from latest release tag                    │
│     └── git checkout -b hotfix/2026.2.26-1 v2026.2.26              │
│                                                                     │
│  3. Apply minimal fix                                               │
│     └── Only fix the critical issue                                 │
│     └── No other changes                                            │
│                                                                     │
│  4. Test                                                            │
│     └── Run full test suite                                         │
│     └── Manual verification                                         │
│                                                                     │
│  5. Release                                                         │
│     └── Tag: v2026.2.26-1                                           │
│     └── Publish to npm                                              │
│     └── Announce in Discord + GitHub                                │
│                                                                     │
│  6. Backport to main if needed                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 Security Release Versioning

Security releases follow the same CalVer but are clearly marked:

- Version: `2026.2.26-security.1`
- Changelog: Marked with `### Security` section
- Announcement: Includes CVE if applicable
- Timeline: Released within 24-48 hours of confirmed vulnerability

---

## 10. VERSION COMMUNICATION

### 10.1 Version Announcement Channels

| Channel | Audience | Content |
|---------|----------|---------|
| GitHub Releases | Developers | Full changelog, assets |
| npm | Developers | Package update |
| Discord #announcements | Community | Summary, highlights |
| docs.openclaw.ai | Everyone | Migration guides |
| In-app notification | Users | Upgrade prompt |

### 10.2 Version Check Notification (In-App)

```typescript
// Check for updates periodically
async function checkForUpdates(): Promise<UpdateInfo | null> {
  const current = getCurrentVersion();
  const latest = await fetchLatestVersion();
  
  if (semver.gt(latest.version, current)) {
    return {
      currentVersion: current,
      latestVersion: latest.version,
      releaseDate: latest.date,
      isSecurityUpdate: latest.security,
      isMajorUpdate: latest.breaking,
      changelogUrl: latest.changelog,
      upgradeCommand: 'npm update -g openclaw@latest',
    };
  }
  
  return null;
}

// Display update notification
function notifyUpdate(info: UpdateInfo): void {
  if (info.isSecurityUpdate) {
    logger.warn(`⚠️ Security update available: ${info.latestVersion}`);
    logger.warn(`Run: ${info.upgradeCommand}`);
  } else {
    logger.info(`Update available: ${info.latestVersion}`);
    logger.info(`Run: ${info.upgradeCommand}`);
  }
}
```

---

*This versioning policy ensures predictable, manageable evolution of OpenClaw.*
