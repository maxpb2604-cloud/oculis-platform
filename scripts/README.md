# Scheduled data refresh (live feed)

`refresh-feed.sh` keeps the feed live: it runs the worker's `daily` (chamber
activity + deposits) and `feed` (news + social + legislative signals) against the
local Postgres, using the **offline heuristic** categorizer/scorer — no Anthropic
API credits required (it unsets `OCULIS_USE_CLAUDE`).

## Current setup — local launchd (this Mac)

A launchd agent runs the script at load and every 3 hours:

- Agent: `~/Library/LaunchAgents/com.oculis.feed-refresh.plist`
- Logs: `app/.logs/refresh-feed.log` (and `launchd.out/err.log`)

Manage it:

```bash
# status
launchctl list | grep oculis
# run once now
bash "scripts/refresh-feed.sh"
# stop / disable
launchctl unload -w ~/Library/LaunchAgents/com.oculis.feed-refresh.plist
# start / enable
launchctl load -w ~/Library/LaunchAgents/com.oculis.feed-refresh.plist
```

Caveat: a local agent only runs while this Mac is awake. For truly always-on
"live" data, move to the cloud option below.

## Cloud option (when the app is deployed)

A cloud cron can't reach `localhost:5433`. It becomes viable once the database is
hosted (Neon / Supabase / RDS) and `DATABASE_URL` points at it. Then either:

- run `scripts/refresh-feed.sh` from a CI/cron with the hosted `DATABASE_URL`, or
- create a Claude Code scheduled routine (`/schedule`) that runs the worker.

Until the DB is hosted, the local launchd agent above is the working setup.
