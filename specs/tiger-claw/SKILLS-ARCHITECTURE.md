# Tiger Claw Scout - Skills Architecture
> **For:** Gemini, Claude Code, Birdie, MANAS, Agent Zero
> **Date:** 2026-02-10
> **Version:** 3.1.0

## 1. SKILL REQUIREMENTS FOR RECRUITING BOTS

These skills enable Tiger Claw Scout to find, enrich, and engage MLM prospects.

### Skill Categories

| Category | Skills | Priority |
|----------|--------|----------|
| **Data Acquisition** | Web Scraping, Social Media Access | 🔴 Critical |
| **Security** | Secret Management, Credential Vault | 🔴 Critical |
| **Intelligence** | Profile Enrichment, AI Summarization | 🟡 High |
| **Engagement** | Message Generation, Response Handling | 🟡 High |
| **Coordination** | Agent Communication, Task Handoff | 🟢 Medium |

---

## 2. DATA ACQUISITION SKILLS

### 2.1 Web Browsing Skill
**Purpose:** Scrape public profiles and pages for prospect data

```typescript
interface WebBrowsingSkill {
  name: "web_browsing";
  capabilities: [
    "navigate_to_url",
    "extract_text",
    "extract_structured_data",
    "screenshot",
    "handle_pagination"
  ];
  
  config: {
    browser: "puppeteer" | "playwright";
    headless: boolean;
    proxy?: {
      type: "residential" | "datacenter";
      provider: "brightdata" | "oxylabs" | "smartproxy";
    };
    fingerprint_evasion: boolean;
    human_like_delays: [min_ms: number, max_ms: number];
  };
}
```

**Implementation Notes:**
- Use Puppeteer with stealth plugin for fingerprint evasion
- Rotate residential proxies to avoid IP bans
- Random delays between actions (2-7 seconds)
- Respect robots.txt where legally required

### 2.2 Social Media Access Skill
**Purpose:** Access customer's social accounts to find warm leads

```typescript
interface SocialMediaSkill {
  name: "social_media_access";
  platforms: [
    {
      name: "facebook";
      auth_method: "oauth" | "session_cookies";
      capabilities: ["friends_list", "groups", "profile_view"];
    },
    {
      name: "linkedin";
      auth_method: "session_cookies"; // No official API for prospecting
      capabilities: ["connections", "profile_view", "company_search"];
      risk_level: "high"; // Aggressive bot detection
    },
    {
      name: "instagram";
      auth_method: "session_cookies" | "unofficial_api";
      capabilities: ["followers", "following", "bio_scrape"];
    }
  ];
}
```

**Risk Mitigation:**
- Use customer's OWN credentials (with consent)
- Low volume: max 50 profile views/day/platform
- Human-like patterns: random scrolling, pauses
- Session rotation: logout/login cycles

---

## 3. SECURITY SKILLS

### 3.1 Secret Management Skill
**Purpose:** Securely store and retrieve sensitive credentials

```typescript
interface SecretManagementSkill {
  name: "secret_vault";
  
  storage: {
    encryption: "AES-256-GCM";
    key_derivation: "PBKDF2" | "Argon2id";
    per_tenant_keys: true; // Each customer has unique encryption key
  };
  
  operations: {
    store_secret(tenant_id: string, key: string, value: string): void;
    retrieve_secret(tenant_id: string, key: string): string;
    rotate_key(tenant_id: string): void;
    delete_all(tenant_id: string): void; // GDPR compliance
  };
  
  audit: {
    log_access: true;
    never_log_values: true;
    retention_days: 90;
  };
}
```

**Secret Types to Store:**
- Telegram Bot Tokens (per customer)
- Social Media Session Cookies
- API Keys (Apollo, Hunter, etc.)
- OAuth Refresh Tokens

### 3.2 Credential Vault Schema

```sql
CREATE TABLE credential_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  credential_type VARCHAR(50) NOT NULL,
  encrypted_value BYTEA NOT NULL,
  iv BYTEA NOT NULL, -- Initialization vector
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- Encryption key stored separately (env var or KMS)
-- Never store key in same database as encrypted data
```

---

## 4. INTELLIGENCE SKILLS

### 4.1 Profile Enrichment Skill
**Purpose:** Gather comprehensive data about prospects

```typescript
interface EnrichmentSkill {
  name: "profile_enrichment";
  
  data_sources: [
    { name: "apollo"; api: true; cost: "$0.01/contact"; },
    { name: "hunter"; api: true; cost: "$0.005/search"; },
    { name: "linkedin_scrape"; api: false; cost: "free"; risk: "high"; },
    { name: "facebook_scrape"; api: false; cost: "free"; risk: "medium"; }
  ];
  
  output: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    title?: string;
    location?: string;
    interests: string[];
    mutual_connections: number;
    engagement_score: 1-100;
  };
}
```

### 4.2 AI Summarization Skill
**Purpose:** Condense scraped data into actionable insights

```typescript
interface SummarizationSkill {
  name: "ai_summarizer";
  model: "gpt-4" | "claude-3";
  
  prompts: {
    prospect_summary: `Given this profile data, extract:
      1. Key talking points for MLM approach
      2. Likely objections they might have
      3. Products/services they might be interested in
      4. Best approach angle (health, wealth, freedom)`;
      
    objection_handler: `Given this objection: "{objection}"
      Generate 3 empathetic responses that redirect to benefits.`;
  };
}
```

---

## 5. ENGAGEMENT SKILLS

### 5.1 Message Generation Skill
**Purpose:** Create personalized outreach scripts

```typescript
interface MessageGenerationSkill {
  name: "script_generator";
  
  templates: {
    cold_approach: string;
    warm_introduction: string;
    follow_up: string;
    objection_response: string;
  };
  
  personalization_fields: [
    "{name}",
    "{company}",
    "{mutual_connection}",
    "{shared_interest}",
    "{pain_point}"
  ];
  
  tone_options: ["casual", "professional", "enthusiastic", "empathetic"];
}
```

### 5.2 Response Classification Skill
**Purpose:** Analyze prospect replies and classify intent

```typescript
interface ResponseClassifierSkill {
  name: "response_classifier";
  
  classifications: [
    { label: "interested"; confidence_threshold: 0.7; action: "schedule_call"; },
    { label: "curious"; confidence_threshold: 0.6; action: "send_info"; },
    { label: "objection"; confidence_threshold: 0.5; action: "handle_objection"; },
    { label: "not_interested"; confidence_threshold: 0.8; action: "nurture_sequence"; },
    { label: "spam_report"; confidence_threshold: 0.9; action: "stop_contact"; }
  ];
}
```

---

## 6. COORDINATION SKILLS

### 6.1 Agent Communication Skill
**Purpose:** Enable agents to share tasks and updates

**PROPOSED PLATFORM: Shared Bulletin Board Website**

```typescript
interface AgentCommunicationSkill {
  name: "agent_bulletin";
  
  platform_options: [
    {
      name: "moltbook";
      url: "https://moltbook.com";
      type: "public_ai_social_network";
      pros: ["established", "AI-native", "free"];
      cons: ["public", "no control over data"];
    },
    {
      name: "private_bulletin";
      url: "https://tigerbots.botcraftwrks.ai/bulletin";
      type: "self_hosted";
      pros: ["private", "controlled", "customizable"];
      cons: ["requires setup", "maintenance"];
    },
    {
      name: "github_discussions";
      url: "https://github.com/bbrysonelite-max/tiger-bot-scout/discussions";
      type: "existing_infrastructure";
      pros: ["already have access", "version controlled", "free"];
      cons: ["not real-time", "requires GitHub access"];
    }
  ];
  
  message_types: [
    "task_assignment",
    "task_completion",
    "blocker_alert",
    "status_update",
    "handoff_request"
  ];
}
```

### 6.2 MCP (Model Context Protocol) Integration
**Purpose:** Standardized communication between different AI systems

```typescript
interface MCPIntegration {
  name: "mcp_connector";
  
  supported_agents: [
    { name: "Agent Zero"; type: "agent-zero"; },
    { name: "Birdie"; type: "openclaw"; },
    { name: "Claude Code"; type: "anthropic"; },
    { name: "Gemini"; type: "google"; },
    { name: "MANAS"; type: "custom"; }
  ];
  
  protocol: {
    version: "1.0";
    transport: "http" | "websocket";
    auth: "bearer_token";
    format: "json";
  };
}
```

---

## 7. IMPLEMENTATION PRIORITY

### Phase 1: TODAY (Critical for Launch)
1. ✅ Secret Management - store Telegram tokens
2. ⏳ gramjs Provisioning - automate BotFather
3. ⏳ Gateway + Worker - process webhooks

### Phase 2: THIS WEEK
4. Web Browsing - Puppeteer scraper
5. AI Summarization - GPT-4 enrichment
6. Message Generation - personalized scripts

### Phase 3: NEXT WEEK
7. Social Media Access - session-based login
8. Response Classification - NLP analysis
9. Agent Communication - bulletin board

---

## 8. QUESTIONS FOR GEMINI

1. **Proxy Strategy:** What's the best residential proxy provider for social media scraping in 2026?

2. **Fingerprint Evasion:** What Puppeteer/Playwright techniques best avoid bot detection?

3. **Credential Security:** Should we use AWS KMS, HashiCorp Vault, or database encryption for multi-tenant secrets?

4. **Rate Limits:** What's the safe daily limit for LinkedIn profile views before ban risk?

5. **Legal Compliance:** What disclosures do we need for automated social media prospecting?

6. **Agent Coordination:** Moltbook vs private bulletin vs GitHub Discussions - which is best for our use case?

---

## 9. AGENT ASSIGNMENT

| Skill | Primary Agent | Backup |
|-------|--------------|--------|
| Web Browsing | Birdie | Agent Zero |
| Secret Management | Claude Code | Agent Zero |
| gramjs Provisioning | Fleet Worker | Manual |
| AI Summarization | Claude Code | Gemini |
| Message Generation | Claude Code | GPT-4 |
| Agent Communication | Agent Zero | All |

---

*Document prepared for multi-agent review. All agents should contribute their expertise.*
