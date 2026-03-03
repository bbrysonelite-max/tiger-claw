# OpenClaw Cron Job Schema (v2026.3.2)

> Discovered during Phase 0 (P0-5b). This schema is NOT in the Tiger Claw
> specification — it was reverse-engineered from OpenClaw docs and runtime
> validation. All Phase 1 cron work must conform to this schema.

**Source:** https://docs.openclaw.ai/automation/cron-jobs

---

## Storage Location

Individual jobs are stored in `~/.openclaw/cron/jobs.json` — an array of job
objects. They are **not** defined inside `openclaw.json`.

The `cron` section in `openclaw.json` only holds global settings:

```json
{
  "cron": {
    "enabled": true,
    "maxConcurrentRuns": 2,
    "sessionRetention": "7d",
    "runLog": true
  }
}
```

## Job Object Schema

Each entry in `jobs.json` is a single job object:

```json
{
  "jobId": "daily-scout",
  "name": "Daily Scout",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 8 * * *",
    "tz": "UTC"
  },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": {
    "kind": "agentTurn",
    "message": "Run tiger_scout with action: hunt."
  },
  "delivery": {
    "mode": "none"
  },
  "deleteAfterRun": false,
  "runCount": 0
}
```

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | Unique identifier. Lowercase, kebab-case recommended. |
| `name` | string | no | Human-readable display name. |
| `enabled` | boolean | yes | Whether the job runs on schedule. |
| `schedule.kind` | `"cron"` \| `"interval"` | yes | Cron expression or fixed interval. |
| `schedule.expr` | string | yes | Cron expression (5-field) or interval string (e.g. `"30m"`). |
| `schedule.tz` | string | no | IANA timezone. Defaults to UTC. |
| `sessionTarget` | `"isolated"` \| `"reuse"` | yes | `isolated` = new session per run. `reuse` = continue last session. |
| `wakeMode` | `"now"` \| `"lazy"` | no | `now` = start immediately on trigger. `lazy` = wait for next user message. |
| `payload.kind` | `"agentTurn"` | yes | Currently only `agentTurn` is supported. |
| `payload.message` | string | yes | The message sent to the agent when the job fires. |
| `delivery.mode` | `"none"` \| `"channel"` | yes | `none` = result stays in session. `channel` = push to a channel. |
| `delivery.channel` | string | if mode=channel | Channel name (e.g. `"telegram"`). |
| `delivery.to` | string | if mode=channel | Recipient identifier. |
| `deleteAfterRun` | boolean | no | If true, job is deleted after first execution. Default false. |
| `runCount` | number | no | Tracks how many times the job has run. Starts at 0. |

## Registration Methods

1. **Direct file write** — write `jobs.json` before gateway startup (used in `entrypoint.sh`).
2. **CLI** — `openclaw cron add --job-id daily-scout --schedule "0 8 * * *" ...`
3. **Gateway tool call** — `cron.add` tool available during agent sessions.

## Tiger Claw Jobs

The following cron jobs are registered by `entrypoint.sh`:

| jobId | Schedule | Purpose |
|---|---|---|
| `daily-scout` | `SCOUT_CRON` env (default `0 8 * * *`) | Run `tiger_scout` to find new prospects |
| `daily-report` | `REPORT_CRON` env (default `0 17 * * *`) | Generate end-of-day summary report |
| `nurture-check` | `NURTURE_CRON` env (default `0 */4 * * *`) | Check nurture pipeline for follow-ups |
| `contact-check` | `CONTACT_CRON` env (default `30 9 * * *`) | Review contacts needing outreach |
| `aftercare-check` | `AFTERCARE_CRON` env (default `0 10 * * 1`) | Weekly aftercare/retention check |
