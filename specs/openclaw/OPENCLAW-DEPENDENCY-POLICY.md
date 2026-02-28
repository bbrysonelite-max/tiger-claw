# OpenClaw Dependency Management Policy

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. OVERVIEW

### 1.1 Goals

| Goal | Description |
|------|-------------|
| **Security** | Minimize exposure to vulnerable dependencies |
| **Stability** | Prevent unexpected breaking changes |
| **Maintainability** | Keep dependencies current and supported |
| **Reproducibility** | Ensure consistent builds across environments |

### 1.2 Dependency Categories

| Category | Examples | Update Policy |
|----------|----------|---------------|
| **Runtime Critical** | Pi SDK, Baileys, grammY | Conservative, tested |
| **Runtime Standard** | Express, ws, sharp | Regular updates |
| **Build Tools** | TypeScript, tsdown | Regular updates |
| **Dev Dependencies** | Jest, ESLint, Prettier | Liberal updates |

---

## 2. VERSION PINNING STRATEGY

### 2.1 Pinning Rules

| Category | Strategy | Example |
|----------|----------|---------|
| Runtime Critical | Exact version | `"@mariozechner/pi-coding-agent": "0.54.1"` |
| Runtime Standard | Minor locked | `"express": "~5.0.0"` |
| Build Tools | Minor locked | `"typescript": "~5.4.0"` |
| Dev Dependencies | Range allowed | `"jest": "^29.0.0"` |

### 2.2 Lock File Policy

```yaml
lockFile:
  tool: pnpm-lock.yaml
  committed: true
  updateFrequency: weekly
  
rules:
  - Always commit lock file
  - Never manually edit lock file
  - Regenerate on CI if missing
  - Review lock file changes in PRs
```

### 2.3 package.json Example

```json
{
  "dependencies": {
    // Critical - exact versions
    "@mariozechner/pi-coding-agent": "0.54.1",
    "@mariozechner/pi-ai": "0.54.1",
    "@whiskeysockets/baileys": "7.0.1",
    "grammy": "1.21.1",
    
    // Standard - minor locked
    "express": "~5.0.0",
    "ws": "~8.16.0",
    "better-sqlite3": "~9.4.0",
    "sharp": "~0.33.0",
    
    // Flexible - caret range
    "chalk": "^5.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    // Build tools - minor locked
    "typescript": "~5.4.0",
    "tsdown": "~0.2.0",
    
    // Dev tools - flexible
    "jest": "^29.7.0",
    "eslint": "^8.57.0",
    "@types/node": "^20.11.0"
  }
}
```

---

## 3. UPDATE POLICY

### 3.1 Update Schedule

| Update Type | Frequency | Process |
|-------------|-----------|---------|
| Security patches | Immediate | Automated PR, expedited review |
| Bug fixes (patch) | Weekly | Batch update, standard review |
| Minor versions | Monthly | Test suite, staged rollout |
| Major versions | Quarterly | Full evaluation, migration plan |

### 3.2 Update Process

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DEPENDENCY UPDATE PROCESS                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. DISCOVERY (Automated - Daily)                                   │
│     └── Dependabot/Renovate scans for updates                       │
│     └── Security advisories checked                                 │
│     └── PRs created for updates                                     │
│                                                                     │
│  2. TRIAGE (Manual - Weekly)                                        │
│     └── Review pending update PRs                                   │
│     └── Categorize by risk (patch/minor/major)                     │
│     └── Prioritize security updates                                 │
│                                                                     │
│  3. TESTING (Automated + Manual)                                    │
│     └── CI runs full test suite                                     │
│     └── Integration tests for critical deps                         │
│     └── Manual testing for major updates                            │
│                                                                     │
│  4. REVIEW (Manual)                                                 │
│     └── Review changelog for breaking changes                       │
│     └── Check GitHub issues for known problems                      │
│     └── Verify license compatibility                                │
│                                                                     │
│  5. MERGE (Manual)                                                  │
│     └── Approve PR                                                  │
│     └── Update documentation if needed                              │
│     └── Tag for release notes                                       │
│                                                                     │
│  6. MONITOR (Automated + Manual)                                    │
│     └── Watch for issues post-merge                                 │
│     └── Rollback if problems detected                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Renovate Configuration

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  
  "schedule": ["before 6am on monday"],
  "timezone": "America/Phoenix",
  
  "packageRules": [
    {
      "description": "Critical dependencies - manual review",
      "matchPackagePatterns": [
        "@mariozechner/pi-*",
        "@whiskeysockets/baileys",
        "grammy",
        "discord.js"
      ],
      "automerge": false,
      "labels": ["critical-dep"],
      "reviewers": ["team:core"]
    },
    {
      "description": "Security updates - auto-merge patches",
      "matchUpdateTypes": ["patch"],
      "matchCategories": ["security"],
      "automerge": true,
      "automergeType": "pr",
      "schedule": ["at any time"]
    },
    {
      "description": "Dev dependencies - auto-merge",
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "description": "Major updates - separate PRs",
      "matchUpdateTypes": ["major"],
      "separateMajorMinor": true,
      "automerge": false,
      "labels": ["major-update"]
    }
  ],
  
  "vulnerabilityAlerts": {
    "enabled": true,
    "labels": ["security"]
  }
}
```

---

## 4. SECURITY VULNERABILITY RESPONSE

### 4.1 Severity Classification

| Severity | CVSS Score | Response Time | Action |
|----------|------------|---------------|--------|
| Critical | 9.0-10.0 | 24 hours | Immediate patch or mitigation |
| High | 7.0-8.9 | 72 hours | Priority update |
| Medium | 4.0-6.9 | 1 week | Scheduled update |
| Low | 0.1-3.9 | 2 weeks | Normal update cycle |

### 4.2 Vulnerability Response Process

```typescript
interface VulnerabilityResponse {
  severity: 'critical' | 'high' | 'medium' | 'low';
  steps: string[];
}

const VULNERABILITY_PLAYBOOK: Record<string, VulnerabilityResponse> = {
  critical: {
    severity: 'critical',
    steps: [
      '1. Assess if OpenClaw is affected by the vulnerability',
      '2. If affected, determine if exploit is possible in our usage',
      '3. If exploitable, implement mitigation immediately:',
      '   - Update dependency if patch available',
      '   - Disable affected feature if no patch',
      '   - Add input validation/sanitization as defense',
      '4. Release hotfix within 24 hours',
      '5. Notify users via Discord and GitHub',
      '6. Post-incident review within 1 week',
    ],
  },
  high: {
    severity: 'high',
    steps: [
      '1. Assess impact on OpenClaw',
      '2. Create priority PR for update',
      '3. Expedite testing (critical paths only)',
      '4. Release within 72 hours',
      '5. Document in changelog',
    ],
  },
  // ... medium, low
};
```

### 4.3 Security Scanning

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        
      - name: Audit dependencies
        run: pnpm audit --audit-level moderate
        
      - name: Check for known vulnerabilities
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

---

## 5. LICENSE COMPLIANCE

### 5.1 Allowed Licenses

| License | Status | Notes |
|---------|--------|-------|
| MIT | ✅ Allowed | Preferred |
| Apache-2.0 | ✅ Allowed | Include NOTICE if required |
| BSD-2-Clause | ✅ Allowed | |
| BSD-3-Clause | ✅ Allowed | |
| ISC | ✅ Allowed | |
| CC0-1.0 | ✅ Allowed | Public domain |
| MPL-2.0 | ⚠️ Review | File-level copyleft |
| LGPL-2.1 | ⚠️ Review | Dynamic linking usually OK |
| GPL-2.0 | ❌ Prohibited | Strong copyleft |
| GPL-3.0 | ❌ Prohibited | Strong copyleft |
| AGPL-3.0 | ❌ Prohibited | Network copyleft |
| Unlicensed | ❌ Prohibited | No clear license |

### 5.2 License Checking

```bash
# Check licenses before adding new dependency
npx license-checker --summary

# CI check for prohibited licenses
npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;CC0-1.0"

# Detailed report
npx license-checker --json > licenses.json
```

### 5.3 License Audit

```json
// .licensechecker.json
{
  "allowedLicenses": [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "CC0-1.0"
  ],
  "prohibitedLicenses": [
    "GPL-2.0",
    "GPL-3.0",
    "AGPL-3.0"
  ],
  "reviewRequired": [
    "MPL-2.0",
    "LGPL-2.1",
    "LGPL-3.0"
  ],
  "exceptions": {
    "some-package": "Reviewed and approved on 2026-01-15"
  }
}
```

---

## 6. VENDOR LOCK-IN ASSESSMENT

### 6.1 Critical Dependencies

| Dependency | Lock-in Risk | Mitigation |
|------------|--------------|------------|
| Pi SDK | High | Core functionality, monitor for alternatives |
| Baileys | High | Community-maintained, WhatsApp Web protocol |
| grammY | Medium | Standard Bot API, alternatives exist |
| discord.js | Medium | Standard Bot API, alternatives exist |
| Anthropic SDK | Low | Can use raw API, multi-provider support |
| OpenAI SDK | Low | Can use raw API, multi-provider support |
| SQLite | Low | Standard SQL, can migrate to other DBs |
| Playwright | Medium | Can use Puppeteer as alternative |

### 6.2 Lock-in Mitigation Strategies

```typescript
// Use abstraction layers for high-risk dependencies

// ❌ Tight coupling
import { createAgentSession } from '@mariozechner/pi-coding-agent';
const session = createAgentSession(params);

// ✅ Abstraction layer
// src/agents/agent-factory.ts
interface AgentSession {
  run(message: string): Promise<AgentResponse>;
  // ... other methods
}

interface AgentSessionFactory {
  create(params: AgentParams): Promise<AgentSession>;
}

// Pi implementation
class PiAgentSessionFactory implements AgentSessionFactory {
  async create(params: AgentParams): Promise<AgentSession> {
    const piSession = await createAgentSession(params);
    return new PiAgentSessionAdapter(piSession);
  }
}

// Future alternative implementation
class AlternativeAgentSessionFactory implements AgentSessionFactory {
  async create(params: AgentParams): Promise<AgentSession> {
    // Different implementation
  }
}
```

### 6.3 Dependency Health Monitoring

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Last commit | < 3 months | 3-12 months | > 12 months |
| Open issues | < 100 | 100-500 | > 500 |
| Security advisories | None | Patched | Unpatched |
| Bus factor | > 3 | 2-3 | 1 |
| Downloads/week | Growing/stable | Declining | Abandoned |

---

## 7. ADDING NEW DEPENDENCIES

### 7.1 Evaluation Criteria

```markdown
## New Dependency Evaluation Checklist

### Basic Requirements
- [ ] Solves a real problem (not just "nice to have")
- [ ] No existing dependency already solves this
- [ ] Actively maintained (commits in last 6 months)
- [ ] Has reasonable test coverage
- [ ] Documentation exists

### Security
- [ ] No known vulnerabilities
- [ ] Security policy exists (SECURITY.md)
- [ ] Responsive to security reports

### License
- [ ] License is on allowed list
- [ ] License is clearly stated
- [ ] No conflicting sub-dependencies

### Quality
- [ ] TypeScript types available
- [ ] Bundle size is reasonable
- [ ] No excessive transitive dependencies
- [ ] Works in our Node version

### Community
- [ ] > 1000 weekly downloads (unless niche)
- [ ] > 1 maintainer (bus factor)
- [ ] Issues are being addressed
- [ ] Not deprecated
```

### 7.2 Approval Process

```
Small dependency (< 100KB, dev only):
  → Self-approve, document in PR

Standard dependency (< 1MB, well-known):
  → 1 reviewer approval
  → Evaluation checklist completed

Large dependency (> 1MB or critical path):
  → 2 reviewer approvals
  → Evaluation checklist completed
  → Architecture review if new category
```

### 7.3 Rejection Criteria

Automatically reject dependencies that:
- Have GPL/AGPL license
- Have unpatched critical vulnerabilities
- Are abandoned (> 2 years no updates)
- Have no clear license
- Would significantly increase bundle size without justification

---

## 8. REMOVING DEPENDENCIES

### 8.1 Removal Criteria

Consider removing a dependency when:
- It's no longer used
- A better alternative exists
- It has become unmaintained
- It has recurring security issues
- The functionality can be implemented in < 100 lines

### 8.2 Removal Process

```bash
# 1. Find unused dependencies
npx depcheck

# 2. Verify no usage
grep -r "package-name" src/

# 3. Remove dependency
pnpm remove package-name

# 4. Run tests
pnpm test

# 5. Verify build
pnpm build
```

---

## 9. MONOREPO CONSIDERATIONS

### 9.1 Workspace Dependencies

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'extensions/*'
  - 'apps/*'
```

### 9.2 Version Alignment

```json
// package.json (root)
{
  "pnpm": {
    "overrides": {
      // Force consistent versions across workspace
      "typescript": "~5.4.0",
      "zod": "^3.22.0"
    }
  }
}
```

### 9.3 Internal Dependencies

```json
// packages/gateway/package.json
{
  "dependencies": {
    // Workspace dependencies use workspace protocol
    "@openclaw/shared": "workspace:*",
    "@openclaw/types": "workspace:*"
  }
}
```

---

## 10. DOCUMENTATION

### 10.1 Dependency Documentation

```markdown
# Dependencies

## Runtime Dependencies

### @mariozechner/pi-coding-agent
- **Purpose:** Core agent runtime and session management
- **Version:** 0.54.1 (pinned)
- **License:** MIT
- **Lock-in Risk:** High
- **Update Policy:** Conservative, full testing required
- **Alternatives:** None currently viable

### @whiskeysockets/baileys
- **Purpose:** WhatsApp Web protocol implementation
- **Version:** 7.0.1 (pinned)
- **License:** MIT
- **Lock-in Risk:** High (WhatsApp-specific)
- **Update Policy:** Conservative, breaking changes common
- **Alternatives:** None for unofficial WhatsApp Web
```

### 10.2 Update Log

```markdown
# Dependency Update Log

## 2026-02-26
- Updated `express` from 5.0.0 to 5.0.1 (security patch)
- Updated `typescript` from 5.3.3 to 5.4.2 (minor features)

## 2026-02-15
- Added `sqlite-vec` 0.1.5 for vector search
- Removed `faiss-node` (replaced by sqlite-vec)
```

---

*This dependency management policy ensures OpenClaw's dependencies remain secure, stable, and maintainable.*
