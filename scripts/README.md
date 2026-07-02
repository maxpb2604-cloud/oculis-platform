# Oculis local operations (this Mac)

Three launchd agents keep the platform live. All are calendar-scheduled, so runs
missed while the Mac sleeps are coalesced into one catch-up run at wake.

| Agent | What it runs | Schedule |
|---|---|---|
| `com.oculis.web` | `start-web.sh` — **production** Next.js server on :3000 (builds if needed, restarts if it dies) | at login, always on |
| `com.oculis.feed-refresh` | `refresh-feed.sh` — worker `daily` + `regulatory` + `feed` | 6×/day at 6:15, 9:15, 12:15, 15:15, 18:15, 21:15 |
| `com.fhc.monitoring.roster` | `roster-run.sh` — worker `roster` (legislators + committees) | Mondays 04:30 |

`refresh-feed.sh` is the single scheduled ingestion driver (the old
`com.fhc.monitoring.daily` agent duplicated the chamber scrape and was retired).
It starts the local Postgres cluster (:5433) if it is down, and **exports**
`OCULIS_USE_CLAUDE=0` so scheduled runs always use the free offline heuristic —
note the worker's `env.ts` refills *unset* vars from `app/.env`, so exporting an
override is the only way to force the offline path.

## Manage the agents

```bash
# status
launchctl list | grep -E "oculis|fhc"
# run a refresh once now
bash "scripts/refresh-feed.sh"
# web server: rebuild + restart after pulling new code
bash "scripts/start-web.sh" --build      # or: launchctl kickstart -k gui/$(id -u)/com.oculis.web
# stop / disable an agent
launchctl bootout gui/$(id -u)/com.oculis.feed-refresh
# start / enable an agent
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.oculis.feed-refresh.plist
```

Logs: `app/.logs/` (`web.log`, `refresh-feed.log`, `launchd.*.log`) and
`app/.data/logs/` (roster).

## AI-quality data passes (needs a funded Anthropic key)

Scheduled runs use the free heuristic. When credits are available, run the
Claude-quality passes by hand (they read `OCULIS_USE_CLAUDE=1` + key from `app/.env`):

```bash
cd apps/worker
npm run recategorize   # categorize rows with no category (--only-missing; never overwrites)
npm run rescore        # re-score EVERYTHING with Claude (overwrites heuristic scores)
npx tsx src/index.ts --rescore --only-missing   # or: only fill score gaps
```

## Cloud option (when the app is deployed)

A cloud cron can't reach `localhost:5433`. It becomes viable once the database is
hosted (Neon / Supabase / RDS) and `DATABASE_URL` points at it. Then either:

- run `scripts/refresh-feed.sh` from a CI/cron with the hosted `DATABASE_URL`, or
- create a Claude Code scheduled routine (`/schedule`) that runs the worker.

Until the DB is hosted, the local launchd agents above are the working setup.
