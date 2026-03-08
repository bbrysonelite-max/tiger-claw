---
name: tiger-capabilities
description: "Tiger Claw capability manifest, ecosystem index, Flavor-based skill discovery, X Feed intelligence, and RSS feed generation. The bot's self-awareness layer."
version: 1.0.0
author: tiger-claw
tags: ["core", "capabilities", "flavors", "discovery", "rss", "xfeed"]
---

# Tiger Capabilities

The self-awareness layer for Tiger Claw bots. This skill lets the bot know what it can do, what it could do, and what's working for others.

## What This Skill Does

1. **Manifest** — Maintains a local `capabilities.json` of installed skills. The bot reads this on startup to know its current abilities.
2. **Index** — Queries the OpenClaw/ClawdHub ecosystem for available skills, filtered and vetted through Tiger Claw standards.
3. **Flavors** — Applies industry-specific mission profiles that determine which skills are relevant, which are noise, and how to prioritize.
4. **X Feed** — Monitors the ecosystem for trending and successfully-used skills, scoped by the active Flavor.
5. **RSS** — Generates an operator-facing RSS feed of new/trending capabilities for human monitoring.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Tiger Claw Bot                  │
│                                              │
│  ┌──────────────┐   ┌───────────────────┐   │
│  │ capabilities │   │  Active Flavor    │   │
│  │   .json      │◄──│  (mission profile)│   │
│  └──────┬───────┘   └────────┬──────────┘   │
│         │                    │               │
│  ┌──────▼────────────────────▼──────────┐   │
│  │       tiger-capabilities engine       │   │
│  │  ┌─────────┐ ┌────────┐ ┌─────────┐  │   │
│  │  │ Scanner │ │ Vetter │ │ X Feed  │  │   │
│  │  └────┬────┘ └───┬────┘ └────┬────┘  │   │
│  └───────┼──────────┼───────────┼────────┘   │
│          │          │           │             │
└──────────┼──────────┼───────────┼────────────┘
           │          │           │
    ┌──────▼──────────▼───────────▼──────┐
    │   OpenClaw / ClawdHub Ecosystem    │
    │        (~8,600+ skills)            │
    └────────────────────────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `/capabilities` | List all currently installed capabilities |
| `/capabilities search <query>` | Search the ecosystem index for matching skills |
| `/capabilities scan` | Scan ClawdHub for new skills matching the active Flavor |
| `/capabilities vet <skill>` | Run Tiger Claw vetting on a specific skill before install |
| `/capabilities install <author/skill>` | Install a vetted skill from the ecosystem |
| `/capabilities flavor` | Show the active Flavor profile |
| `/capabilities flavor set <name>` | Switch to a different Flavor |
| `/capabilities flavor list` | List all available Flavors |
| `/capabilities trending` | Show trending/successful skills from X Feed, scoped by Flavor |
| `/capabilities rss` | Generate the RSS feed for operator monitoring |
| `/capabilities export` | Export the full capabilities manifest |

## Flavors

A Flavor is a mission profile — a JSON file that defines what matters for a specific industry vertical. Flavors control:

- **Relevance filters** — Which skill categories to prioritize and which to ignore
- **Keyword weights** — Terms that boost or suppress skill relevance scores
- **Compliance rules** — Region-specific legal constraints (e.g., Thai PDPA for Thailand operations)
- **Channel priorities** — Which messaging platforms matter (LINE for Thailand, WhatsApp for global, etc.)
- **Behavior modifiers** — How aggressive the bot should be in discovery and outreach

### Built-in Flavors

| Flavor | Target | Key Priorities |
|--------|--------|----------------|
| `network-marketing` | MLM/Network Marketing distributors | Prospecting, messaging, CRM, lead nurture, social media |
| `network-marketing-thailand` | Thai market network marketers | LINE, Thai PDPA compliance, Southeast Asia platforms |
| `real-estate` | Real estate agents | Lead gen, property data, scheduling, local search |
| `gig-economy` | Gig workers and freelancers | Platform integrations, scheduling, client communication |
| `general` | General-purpose agent | Balanced across all categories, no filters |

### Flavor File Format

Flavors live in `flavors/` as JSON files:

```json
{
  "name": "network-marketing",
  "version": "1.0.0",
  "description": "Mission profile for network marketing distributors",
  "priorities": {
    "boost": [
      "prospecting", "lead-gen", "crm", "messaging", "whatsapp",
      "telegram", "line", "social-media", "linkedin", "facebook",
      "instagram", "outreach", "nurture", "follow-up", "script",
      "email", "sms", "voice", "calendar", "scheduling"
    ],
    "suppress": [
      "crypto", "nft", "defi", "blockchain", "gaming", "steam",
      "iot", "smart-home", "hue", "sonos", "arduino"
    ]
  },
  "compliance": {
    "regions": ["global"],
    "rules": []
  },
  "channels": {
    "primary": ["whatsapp", "telegram", "email", "sms"],
    "secondary": ["linkedin", "facebook", "instagram"]
  },
  "aggression": "high"
}
```

### Stacking Flavors

Flavors can be stacked. When you set `network-marketing + thailand`, the Thailand overlay adds:

- LINE as primary channel
- Thai PDPA compliance rules
- Southeast Asia platform priorities
- Thai-language skill preference

## Vetting Process

Skills pulled from the OpenClaw ecosystem are **not trusted by default**. Before any skill touches a Tiger Claw bot, it goes through vetting:

1. **Structure check** — Valid SKILL.md with proper frontmatter
2. **Content scan** — No prompt injection, no data exfiltration patterns, no hidden instructions
3. **Dependency audit** — No excessive or suspicious external dependencies
4. **Relevance score** — How well does this skill match the active Flavor (0-100)
5. **Community signal** — Is this skill used successfully by others (from X Feed data)
6. **Manual override** — Operator can force-approve or force-reject

Skills scoring below 40 relevance are auto-rejected. Skills between 40-70 are flagged for operator review. Skills above 70 are auto-approved if they pass security checks.

## X Feed Intelligence

The X Feed monitors the OpenClaw ecosystem for signals about skill usage and success:

- **GitHub activity** — Stars, forks, recent commits on skill repos
- **ClawdHub metrics** — Install counts, ratings, update frequency
- **Community mentions** — References in discussions, issues, and social media
- **Failure signals** — Skills with high error rates, security advisories, or abandonment

X Feed data is scoped by the active Flavor. A network marketing bot only sees intelligence relevant to its mission.

## RSS Feed

The RSS feed is generated at `~/.tiger-claw/capabilities/feed.xml` and includes:

- New skills matching the active Flavor (last 7 days)
- Trending skills in the Flavor's domain
- Security advisories for installed skills
- Skill updates available for installed capabilities

Operators can subscribe to this feed in any RSS reader for passive monitoring.

## File Structure

```
skills/tiger-capabilities/
├── SKILL.md                    # This file
├── scripts/
│   ├── capabilities.sh         # Main CLI entry point
│   ├── scanner.py              # ClawdHub ecosystem scanner
│   ├── vetter.py               # Skill vetting engine
│   ├── xfeed.py                # X Feed intelligence collector
│   └── rss_gen.py              # RSS feed generator
├── flavors/
│   ├── general.json            # General-purpose flavor
│   ├── network-marketing.json  # Network marketing flavor
│   ├── network-marketing-thailand.json  # Thai market overlay
│   ├── real-estate.json        # Real estate flavor
│   └── gig-economy.json        # Gig economy flavor
└── index/
    └── ecosystem-index.json    # Cached ecosystem index (auto-updated)
```

## Data Storage

All runtime data lives in `~/.tiger-claw/capabilities/`:

```
~/.tiger-claw/capabilities/
├── capabilities.json           # Installed skills manifest
├── ecosystem-index.json        # Full ecosystem cache
├── xfeed-cache.json            # X Feed intelligence cache
├── feed.xml                    # Generated RSS feed
├── vet-log.json                # Vetting decision log
└── flavor-stack.json           # Currently active flavor(s)
```

## Usage Examples

### Check what the bot can do
```
/capabilities
```
Returns the full list of installed capabilities with descriptions.

### Find prospecting skills
```
/capabilities search prospecting
```
Searches the ecosystem index, filtered by the active Flavor, returns ranked results.

### See what's trending
```
/capabilities trending
```
Shows the top 20 trending skills in the active Flavor's domain, with usage signals.

### Switch to Thailand operations
```
/capabilities flavor set network-marketing-thailand
```
Stacks the Thailand overlay onto the network marketing base flavor.

### Vet and install a new skill
```
/capabilities vet okaris/linkedin-prospector
/capabilities install okaris/linkedin-prospector
```
Runs full vetting, then installs if approved.
