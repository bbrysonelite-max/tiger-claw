# Tiger Claw

**AI-powered recruiting and sales engine for network marketing professionals.**

Built on [OpenClaw](https://github.com/openclaw) — the open-source personal AI assistant platform.

---

## For Developers (Human or AI)

**START HERE:** Read `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` before writing any code.

That document contains 127 locked architectural decisions. Do not override them.

---

## Repo Structure

```
tiger-claw/
│
├── specs/                          ← ALL SPECIFICATIONS
│   ├── tiger-claw/                 ← Tiger Claw spec (THE source of truth)
│   │   └── TIGERCLAW-MASTER-SPEC-v2.md
│   ├── openclaw/                   ← OpenClaw platform docs (18 files)
│   │   ├── OPENCLAW-PRD.md
│   │   ├── OPENCLAW-BLUEPRINT.md
│   │   ├── OPENCLAW-C4-ARCHITECTURE.md
│   │   ├── OPENCLAW-DATABASE-SCHEMA.md
│   │   ├── OPENCLAW-SEQUENCE-DIAGRAMS.md
│   │   ├── OPENCLAW-DATA-FLOW.md
│   │   ├── OPENCLAW-TYPES.md
│   │   ├── OPENCLAW-FUNCTIONS.md
│   │   ├── OPENCLAW-ERROR-HANDLING.md
│   │   ├── OPENCLAW-SECURITY-THREAT-MODEL.md
│   │   ├── OPENCLAW-LOAD-TESTING.md
│   │   ├── OPENCLAW-SLI-SLO.md
│   │   ├── OPENCLAW-API-VERSIONING.md
│   │   ├── OPENCLAW-I18N-STRATEGY.md
│   │   ├── OPENCLAW-ACCESSIBILITY.md
│   │   ├── OPENCLAW-DEPENDENCY-POLICY.md
│   │   ├── OPENCLAW-TEST-CASES.md
│   │   └── OPENCLAW-OPERATIONAL-RUNBOOK.md
│   └── legacy/                     ← Previous versions (reference only)
│       ├── TIGERCLAW-MASTER-SPEC-v1.md
│       ├── PRD_v4.md
│       └── BLUEPRINT_v4.md
│
├── skill/                          ← Tiger Claw OpenClaw Skill (TO BUILD)
│   ├── SKILL.md                    ← Skill definition
│   ├── tools/                      ← Flywheel tools
│   └── lib/                        ← Shared libraries
│
├── api/                            ← Tiger Claw API / TenantOrchestrator (TO BUILD)
│   ├── server.ts
│   └── routes/
│
├── docker/                         ← Docker infrastructure
│   ├── customer/                   ← Per-tenant container (Dockerfile, entrypoint)
│   ├── dev/                        ← Dev environment compose
│   └── infrastructure/             ← Shared services (PostgreSQL, Redis, Nginx)
│
├── ops/                            ← Operations scripts
│   └── provision-customer.sh       ← Working provisioning script (from v4)
│
├── .devcontainer/                  ← Cursor dev container config
│   └── devcontainer.json
│
├── .cursor/                        ← Cursor AI agent rules
│   └── rules.md
│
└── README.md                       ← This file
```

---

## Development Setup

### Prerequisites
- Docker Desktop installed on your Mac
- Cursor IDE
- GitHub account

### First Time Setup
1. Clone this repo
2. Open in Cursor
3. Cursor will detect `.devcontainer/devcontainer.json` and offer "Reopen in Container"
4. Click yes — you're now developing inside the same Docker container that runs in production

### Important
All code runs INSIDE Docker. If it works in dev, it works in prod. No "works on my machine" issues.

---

## Architecture Summary

- **One Docker container per tenant** running unmodified OpenClaw
- **Tiger Claw = OpenClaw skills** that implement the recruiting/sales flywheel
- **Tiger Claw API (port 4000)** manages the fleet of containers
- **Per-tenant SQLite** for tenant data isolation
- **Shared PostgreSQL** for platform operations (billing, Hive patterns)

See `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` for complete details.
