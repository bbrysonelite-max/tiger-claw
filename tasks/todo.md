# Tiger Claw — tiger_onboard Implementation Plan

**Task:** Implement `skill/tools/tiger_onboard.ts` — the onboarding interview flow (Block 5, Section 5.2 of TIGERCLAW-MASTER-SPEC-v2.md).

---

## Spec Reference

The onboarding tool runs the **5-phase interview flow** after a new tenant container boots:

| Phase | Name | Description |
|-------|------|-------------|
| 1 | Identity | "Who are you?" — 6 questions |
| 2 | ICP | "Who are you looking for?" — 5 questions + summary/confirm. Runs TWICE for two-oar flavors (builder + customer), ONCE for single-oar |
| 3 | Key Setup | Primary API key → validate. Fallback API key → validate. Cannot skip fallback (LOCKED). |
| 4 | Naming | Bot name ceremony → regenerate SOUL.md |
| 5 | Flywheel Start | Set tenant status → "active", trigger first scout, confirm cron jobs |

**Key locked decisions:**
- Fallback key is REQUIRED — cannot be skipped (Block 1.7, Block 5 Decision #7)
- SOUL.md regenerated with full tenant data after naming (Block 5 Decision #8)
- Platform onboarding key deactivated after fallback key accepted (Section 5.2 Phase 3)
- Conducted in tenant's preferredLanguage (Section 5.2)
- First scout triggers immediately on completion (Block 5 Decision #9)

---

## Implementation Plan

### Phase 1 — Identity Interview
- [ ] Define `IDENTITY_QUESTIONS` array (6 questions, flavor-adapted)
- [ ] Build state machine to track which question we're on
- [ ] Store each answer into `identity` object keyed by field name

### Phase 2 — ICP Interview
- [ ] Define `ICP_QUESTIONS` array (5 questions with oar-specific labels)
- [ ] Run once for single-oar flavors (`icp_single` phase)
- [ ] Run twice for two-oar flavors (`icp_builder` → `icp_builder_confirm` → `icp_customer` → `icp_customer_confirm`)
- [ ] After 5 questions: generate ICP summary → ask tenant to confirm or adjust
- [ ] On confirm: advance. On adjustment: incorporate and re-confirm.

### Phase 3 — Key Setup
- [ ] Instruct tenant on getting primary API key (with provider links)
- [ ] Accept primary key → validate via HTTP test call to LLM provider
- [ ] On invalid: explain error and ask again
- [ ] Instruct tenant on fallback key (explain WHY it's required)
- [ ] Accept fallback key → validate
- [ ] Notify Tiger Claw API to deactivate platform onboarding key (Layer 1)

### Phase 4 — Naming Ceremony
- [ ] Ask "What do you want to call me?"
- [ ] Accept bot name
- [ ] Generate SOUL.md with full tenant data (name, edification, ICP, flavor, language)
- [ ] Write SOUL.md to `{workdir}/SOUL.md`

### Phase 5 — Flywheel Start
- [ ] Call Tiger Claw API `PATCH /tenants/{id}/status` → `active`
- [ ] Call Tiger Claw API to trigger first scout immediately
- [ ] Return completion message to tenant

---

## Technical Design

### Tool Interface (matches OpenClaw `AgentTool`)
```typescript
export const tiger_onboard: AgentTool = {
  name: 'tiger_onboard',
  description: '...',
  parameters: { type: 'object', properties: { action, response } },
  execute(params, context): Promise<ToolResult>
}
```

### Parameters
```typescript
{
  action: 'start' | 'respond' | 'status',
  response?: string   // tenant's answer to current question
}
```

### State Persistence
- State stored as JSON file at `{workdir}/onboard_state.json`
- No external dependencies — uses Node.js `fs` module only
- Single row of truth for entire onboarding session

### State Shape
```typescript
{
  phase: OnboardPhase,
  questionIndex: number,
  identity: IdentityAnswers,
  icpBuilder: ICPAnswers,
  icpCustomer: ICPAnswers,
  icpSingle: ICPAnswers,
  primaryKeyValidated: boolean,
  fallbackKeyValidated: boolean,
  botName?: string,
  startedAt: string,
  completedAt?: string
}
```

### SOUL.md Template
Generated from collected data containing:
- Bot name
- Tiger Claw brand + OpenClaw attribution
- Tenant edification (credentials, story, biggest win, differentiator)
- ICP summary (builder + customer, or single)
- Language directive
- Tone directive

### HTTP Calls
- **Key validation:** `POST https://api.anthropic.com/v1/messages` (minimal test call) or `POST https://api.openai.com/v1/chat/completions` based on key prefix
- **Status update:** `PATCH ${TIGER_CLAW_API_URL}/tenants/${TIGER_CLAW_TENANT_ID}/status`
- **Trigger scout:** `POST ${TIGER_CLAW_API_URL}/tenants/${TIGER_CLAW_TENANT_ID}/scout`

### Environment Variables Used
- `TIGER_CLAW_API_URL` — Tiger Claw API base URL
- `TIGER_CLAW_TENANT_ID` — this tenant's ID
- `PREFERRED_LANGUAGE` — `en` or `th`
- `BOT_FLAVOR` — `network-marketer`, `real-estate`, `health-wellness`
- `REGION` — `us-en` or `th-th`

---

## Files to Create/Modify
- `skill/tools/tiger_onboard.ts` — main implementation (replace stub)

---

---

# tiger_score Implementation Plan

**Task:** Implement `skill/tools/tiger_score.ts` — lead scoring engine (Block 3.2).

## Todos
- [x] Scoring math (weighted composite, intent decay, unicorn bonus)
- [x] Engagement event system
- [x] Lead persistence (leads.json)
- [x] Tool actions: score, update_engagement, recalculate, get, list
- [x] Export AgentTool

## Review

**Completed:** Feb 27, 2026

### What was implemented

`skill/tools/tiger_score.ts` — ~500 lines. Replaces stub.

**Scoring math (LOCKED constants):**
- Weights Builder: `profileFit×0.30 + intentSignals×0.45 + engagement×0.25`
- Weights Customer: `profileFit×0.25 + intentSignals×0.50 + engagement×0.25`
- Threshold: `80` — constant, non-configurable
- Unicorn Bonus: `+15` on higher oar score when both oars show meaningful signals

**Intent decay:** Exponential `e^(-t/τ)` with τ = 43.3 days (half-life = 30 days). Signal from today = 100%, 30 days ago = ~50%, 60 days ago = ~25%.

**Engagement events with deltas:** `opened_message +10`, `replied +25`, `asked_question +35`, `clicked_link +15`, `requested_info +40`, `ignored_touch -5`, `blocked_opted_out → 0 + permanent opt-out flag`.

**Actions:**
- `score` — new prospect or re-score existing (dedupes by platform+platformId, merges signals)
- `update_engagement` — record interaction event, recompute, detect newly-qualified
- `recalculate` — recompute all leads (intent decay ages daily), purge expired below-threshold (90-day rule)
- `get` — fetch lead record by leadId or platform+platformId
- `list` — sorted pipeline: unicorns first, then by score desc. Filters: qualified/warming/all

**Lead persistence:** `{workdir}/leads.json`. Keyed by UUID. No external dependencies.

**Locked decisions honored:**
- Threshold 80 not 70 (CORRECTION from v4) ✓
- Builder weights 30/45/25, Customer 25/50/25 ✓
- Unicorn +15 on higher score, builder prioritized if both qualify ✓
- Below-threshold 90-day purge ✓
- Opted-out = score → 0, permanent, no re-contact ✓

---

# tiger_onboard Implementation Plan

## Review

**Completed:** Feb 27, 2026

### What was implemented

`skill/tools/tiger_onboard.ts` — 420 lines. Replaces the 4-line stub.

**State machine phases:** `identity → icp_builder → icp_builder_confirm → icp_customer → icp_customer_confirm → naming → complete` (two-oar) or `identity → icp_single → icp_single_confirm → keys_primary → keys_fallback → naming → complete` (single-oar).

**Phase 1 — Identity:** 6 flavor-adapted questions stored into `IdentityAnswers`. Profession label adapts per `BOT_FLAVOR` env var.

**Phase 2 — ICP:** 5 questions per oar. Two-oar flavors (network-marketer) run builder ICP first, then customer ICP. Each pass ends with a summary + confirmation loop. Tenant can adjust before confirming.

**Phase 3 — Key Setup:** Primary key asked → validated via HTTP test call to Anthropic or OpenAI (detected by key prefix `sk-ant-` vs `sk-`). Fallback key asked next — **cannot be skipped per locked spec decision**. On validation of fallback, notifies Tiger Claw API to deactivate the platform onboarding key (Layer 1). Retry phases on invalid keys.

**Phase 4 — Naming:** Accepts bot name → generates full `SOUL.md` written to `{workdir}/SOUL.md`. SOUL.md includes: bot name, brand edification, tenant identity data, ICP summaries (both oars or single), language directive, tone directive.

**Phase 5 — Flywheel Start:** `PATCH /tenants/{id}/status → active` + `POST /tenants/{id}/scout` (first hunt immediately). Both are fire-and-forget with timeouts.

### Design decisions

- **No external dependencies** — only Node.js built-ins (`fs`, `path`, `https`, `http`). Zero npm installs needed.
- **State file** at `{workdir}/onboard_state.json` — survives container restarts, allows resuming mid-interview.
- **All HTTP calls have 15s timeout + error handling** — never throws, returns `{ valid: false, error }` or resolves void.
- **Exports both named (`tiger_onboard`) and default** — matches OpenClaw `AgentTool` interface.
- **Language/flavor from env vars** — `PREFERRED_LANGUAGE`, `BOT_FLAVOR`, `REGION`, `TIGER_CLAW_TENANT_ID`, `TIGER_CLAW_API_URL`.

### Locked spec decisions honored

- Fallback key REQUIRED, cannot skip (Block 1.7, Block 5 Decision #7) ✓
- SOUL.md regenerated with full tenant data after naming (Block 5 Decision #8) ✓
- Platform onboarding key deactivated after fallback key accepted (Section 5.2 Phase 3) ✓
- Two-oar flavors run ICP interview twice (Section 5.2 Phase 2) ✓
- First scout triggered immediately on completion (Block 5 Decision #9) ✓
- Tool type: Tool, no cron (Appendix C.3) ✓
