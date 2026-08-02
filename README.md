# H2O Guide-Board

A live dashboard for the guides at [H2O Adventure](https://www.h2o-adventure.at) (rafting & canyoning on the Inn river, Tyrol, Austria) — real-time booking numbers per tour, historical stats, and the current water level, all in one place.

No login, no booking-system access needed on the day: just a phone or a laptop and this page.

![Today view](docs/screenshots/heute.png)

## What it does

- **Heute / Morgen** — every tour running today or tomorrow, sorted Rafting → Canyoning → everything else, with a live "water level" bar showing how full each tour is relative to the fullest one that day.
- **Statistik** — when do people actually book (by hour of day), which category and tour are most popular, which weekdays are busiest, and how bookings trend over the season. Only counts scrapes taken before 18:00 local time, since anything later can be manually adjusted by staff and isn't a real customer booking anymore.
- **Wasserstand** — current water level (cm) and discharge (m³/s) of the Inn near the Imster Schlucht, plus a 24h trend line per gauge, sourced from the official Tyrolean hydrographic service.
- **Aktualisieren button** — triggers a real, immediate scrape (today/tomorrow's tours + water level) via `POST /api/refresh`, then reloads the display with a cache-busting timestamp. This is a genuine on-demand fetch, not just a page re-read — but it runs in **manual mode**: it updates what's currently on screen and nothing else. It never writes a history line and never touches `stats.json`, so it can never skew the Statistik data no matter how often it's clicked. See [Manual refresh API](#manual-refresh-api) below.

| Booking list | Statistics |
|---|---|
| ![Tomorrow view](docs/screenshots/morgen.png) | ![Statistics](docs/screenshots/statistik.png) |

| Water level |
|---|
| ![Water level](docs/screenshots/wasserstand.png) |

Works just as well on a laptop:

![Desktop view](docs/screenshots/desktop.png)

## How it's built

There's no database — it's a static site (Vite + React) backed by a handful of JSON files that a scheduled worker keeps up to date. Everything the frontend fetches (`/data/*.json`, `/history/*.jsonl`) lives on a Docker volume shared between two containers:

```
                    ┌───────────────────────────────┐
                    │        volume: h2o_data        │
                    │   /shared/data  /shared/history │
                    └───────────────▲────────────────┘
                       writes only  │   reads only (nginx alias)
                                    │
   worker (node-cron, Express)     │        web (nginx, static build)
   scheduled: scraper.js+buildStats│        serves dist/ + /data/ + /history/
     hourly, wasserstand /15min    │        proxies /api/ -> worker:3000
   manual: POST /api/refresh   ────┘        reachable via Coolify's proxy
     (no history/stats writes)
```

The **worker** container never talks to Git — it just writes JSON straight to the volume, atomically (temp file + rename, see `lib/atomicWrite.js`) so the **web** container's nginx never serves a half-written file. The **web** container only ever reads that volume for `/data/`/`/history/`; the one thing it writes is nothing — it just proxies `/api/refresh` through to the worker.

Every run has a **mode** — `scheduled` or `manual` — which controls a single flag, `persistHistory`, threaded through `runScrape()`/`holeWasserstand()` (see `scraper.js`, `wasserstand.js`). This is the one thing that decides whether a run is allowed to touch history/stats:

| Mode | Triggered by | `persistHistory` | Writes `<date>.json` / `wasserstand.json` (current state) | Writes `history/*.jsonl` / `wasserstand-history.json` | Runs `buildStats.js` |
|---|---|:---:|:---:|:---:|:---:|
| `scheduled` | node-cron, in `worker/server.js` | `true` | ✅ | ✅ | ✅ |
| `manual` | `POST /api/refresh` (the button) | `false` | ✅ | ❌ never | ❌ never |

| Script | Scheduled cadence | What it does |
|---|---|---|
| `scraper.js` | hourly, on the hour | Scrapes today's and tomorrow's tour program from h2o-adventure.at (title, category, time, location, current registrations). `persistHistory:true` additionally appends one line per tour to `<historyDir>/<date>.jsonl`. |
| `buildStats.js` | right after every **scheduled** scrape only | Aggregates the full history into `<dataDir>/stats.json` — booking activity by hour, category/weekday/season breakdowns, top tours — grouped by season, cutoff at 18:00. Never runs for a manual refresh. |
| `wasserstand.js` | every 15 minutes | Pulls the current water level/discharge for two Inn gauges near the Imster Schlucht from [riverapp.net](https://www.riverapp.net) (source: Hydrographischer Dienst Tirol). `persistHistory:true` additionally folds the reading into the rolling 24h `wasserstand-history.json`. |

`<dataDir>`/`<historyDir>` are `./public/data`/`./public/history` by default (used for local dev) or `/shared/data`/`/shared/history` inside the worker container, controlled by the `H2O_DATA_DIR`/`H2O_HISTORY_DIR` env vars (see `config.js`).

> **Transition note:** the two GitHub Actions workflows (`.github/workflows/scrape.yml`, `wasserstand.yml`) that used to commit this data to Git still exist and still run — see [GitHub Actions: transition status](#github-actions-transition-status) below. They're intentionally left running until the worker is confirmed stable in production; they no longer have anything to do with what the live site actually serves once the `web`/`worker` containers are deployed, since the site now reads from the Docker volume, not from the repo.

## Tech stack

- [Vite](https://vitejs.dev) + [React](https://react.dev) — frontend
- [Framer Motion](https://www.framer.com/motion/) — the animated tab pill, number transitions
- [Recharts](https://recharts.org) — all charts
- [Cheerio](https://cheerio.js.org) — HTML parsing in the scraper
- Plain Node scripts, run on a schedule (`node-cron`) and on demand ([Express](https://expressjs.com), `POST /api/refresh`) by a dedicated `worker` container — the entire "backend"
- Docker + [Coolify](https://coolify.io) — hosting (self-hosted on Hetzner Cloud), `web` redeploys automatically on every push to `main`

Design is deliberately two-color (dark gray + white) with one small branded exception (H2O's own blue, for the "new" badges), typeset in Geist, Space Grotesk, Milker and JetBrains Mono.

## Local development

```bash
npm install
npm run dev          # starts Vite on localhost:5173
```

The dev server reads whatever is already in `public/data` — run the scripts once to get real data locally:

```bash
node scraper.js       # today + tomorrow's tours
node buildStats.js     # rebuild public/data/stats.json from the history
node wasserstand.js   # current water level + history
```

Build for production:

```bash
npm run build         # outputs to dist/
npm run preview       # serve the production build locally
```

## Deploying

Two containers, one shared volume, no Git involved in serving or producing data:

| File | Container | Role |
|---|---|---|
| `Dockerfile.web` | `web` | Multi-stage build (`node:20-alpine` → `nginx:alpine`). Serves the built app, `/data/` and `/history/` as nginx `alias`es straight from the volume, and proxies `/api/` to `worker:3000`. SPA fallback to `index.html`. `Cache-Control: no-cache` on `/data/` and `/history/`. Config is a `.template` (see [nginx templating](#coolify-setup)). |
| `Dockerfile.worker` | `worker` | `node:20-alpine` running `worker/server.js`: one process, `node-cron` (timezone `Europe/Vienna`) for the schedule plus an Express app for `POST /api/refresh` and `GET /healthz`. Writes only to the volume. No Git, no GitHub token, no network egress except to h2o-adventure.at and riverapp.net. |

Both are defined together in `docker-compose.yml` as a single Coolify **Docker Compose** resource, sharing the named volume `h2o_data`, mounted at `/shared` in both containers (`/shared/data`, `/shared/history`).

### Local

```bash
docker compose up --build
```

Neither service binds a host port — `web` uses `expose: ["80"]` (reachable only from other containers on the Compose network, matching how Coolify's proxy reaches it in production) and `worker` publishes nothing at all. This means there's no automatic `localhost:PORT` to open in a browser locally. To smoke-test without a browser, run commands from *inside* the network via `docker compose exec`:

```bash
docker compose exec web wget -qO- http://localhost/                      # confirm nginx serves the app
docker compose exec web wget -qO- http://localhost/data/wasserstand.json # confirm the /data/ alias reaches the volume
docker compose exec web wget -qO- --post-data="" \
  --header="X-Internal-Secret: change-me-in-coolify" http://localhost/api/refresh  # exercise the real refresh endpoint end-to-end
```

For actual browser testing locally, add a git-ignored `docker-compose.override.yml` (Compose merges it automatically) rather than editing the committed file:

```yaml
services:
  web:
    ports:
      - "8080:80"
```

### Coolify setup

1. Create **one** new resource of type **Docker Compose**, pointing at this repo's `docker-compose.yml`. Coolify will bring up both `web` and `worker` together.
2. In the resource's domain settings, point the domain at the **`web`** service, port `80`. Coolify's proxy talks to the container directly over its internal network. `worker` is never assigned a domain and has no `ports:`/`expose:` entry at all — it's unreachable from the outside by design; the only path to it is `web`'s nginx `proxy_pass`.
3. Set `INTERNAL_API_SECRET` to a real random value (e.g. `openssl rand -hex 32`) in Coolify's environment/secrets UI for **both** `web` and `worker` — same value in both. `docker-compose.yml` ships a placeholder (`change-me-in-coolify`) that's fine for local testing but must be overridden for a real deployment (see [Manual refresh API](#manual-refresh-api) for what it protects). Still **no GitHub token needed anywhere** — the worker never touches Git.
4. nginx's config is a `.template` (`nginx.conf.template` → `/etc/nginx/templates/default.conf.template`); the official `nginx:alpine` image substitutes `${INTERNAL_API_SECRET}` into it from the environment automatically at container start (`docker-entrypoint.d`) — no manual step needed beyond setting the env var in step 3.
5. Auto-deploy-on-push works normally for this resource: redeploying `worker` just restarts the process (harmless, existing volume data stays exactly as it is — see [Initialization](#initialization--data-safety) below).

### Schedules

Both run in the `worker` process's configured timezone, `Europe/Vienna` (the `timezone` option passed to every `cron.schedule()` call in `worker/server.js`, backed by the `tzdata` package installed in `Dockerfile.worker`) — real recurring timers in a long-lived Node process (`node-cron`), not GitHub Actions' best-effort `schedule` trigger, so these fire exactly on the minute:

- `scraper.js` + `buildStats.js`: `0 * * * *` — every hour, on the hour (e.g. exactly 09:00, 10:00, …)
- `wasserstand.js`: `*/15 * * * *` — every 15 minutes

Both are registered with `noOverlap: true` (skip a tick rather than stack it if a previous run is still going) and a global mutex additionally prevents *any* two runs — scheduled or manual — from scraping concurrently (see [Manual refresh API](#manual-refresh-api)). DST is handled correctly (CET in winter, CEST in summer): `node-cron` v4 is DST-aware by design, backed by the same IANA timezone database (`tzdata`) that `date`/Node's `Intl` use everywhere else in this project (e.g. `config.js`'s `timezone` setting) — no manual offset math anywhere. One documented edge case: across the autumn DST fall-back, the repeated hour runs once, so `wasserstand.js`'s 15-minute schedule can pause for up to the length of that shift during that specific hour — expected behavior, not a bug.

### Initialization & data safety

- On first start, `worker/init-volume.sh` copies the reference data baked into the worker image (`public/data`, `public/history` as of the last Git commit) into the empty volume — this is what seeds a brand-new `h2o_data` volume so the site isn't blank on day one.
- `data` and `history` are checked **independently** — if one is already populated but the other somehow isn't (e.g. a manually pruned subfolder), only the empty one gets seeded; the populated one is left untouched.
- Once a directory has data in it, this step is a no-op on every subsequent container start/redeploy — nothing already in the volume is ever overwritten or deleted, no matter how often the containers restart or redeploy.
- The named volume itself (`h2o_data`) is pinned via `name: h2o_data` in `docker-compose.yml`, so the same underlying Docker volume is always reused, even if Coolify's compose project prefix ever changes — a redeploy never creates a new, empty volume by accident.
- All JSON writes (`scraper.js`, `buildStats.js`, `wasserstand.js`) go through `lib/atomicWrite.js`: write to a temp file **in the same directory** as the target (so `rename()` stays on one filesystem and is guaranteed atomic per POSIX), then `rename()` it over the target. nginx in the `web` container can never serve a half-written file, even if it reads mid-write.

### Manual refresh API

`POST /api/refresh` (proxied by `web` through to `worker:3000`) is what the "Aktualisieren" button calls. It runs `runScrape({ persistHistory: false })` and `holeWasserstand({ persistHistory: false })` in parallel — real requests to h2o-adventure.at and riverapp.net, right now — and updates `<date>.json`/`wasserstand.json`. It never runs `buildStats.js` and never writes a history line (see the mode table near the top of this doc).

Concurrency and abuse protection, all in `worker/server.js`:

- **One run at a time, period.** A single in-memory mutex (`activeRun`) is shared across the two cron schedules *and* the manual endpoint — a manual click while a scheduled scrape is running (or vice versa, or two clicks at once) gets `409 Conflict` with the mode/start time of whatever's currently running. Nothing ever hits h2o-adventure.at/riverapp.net from two runs simultaneously.
- **Rate limit.** At most one *completed* manual refresh per 30 seconds (`MANUAL_COOLDOWN_MS`) — a request inside that window gets `429` with the remaining wait time.
- **Timeout without losing the lock.** If a run takes longer than 45s (`MANUAL_TIMEOUT_MS`), the HTTP request returns `202` ("running in the background, reload shortly") instead of hanging — but the mutex stays held until the run *actually* finishes, so a fast follow-up request still correctly gets `409`, not a second concurrent scrape.
- **Same-origin, structurally.** The frontend calls the relative path `fetch("/api/refresh")` — nginx is the only thing that can reach `worker:3000` (no published port, no Coolify domain on `worker`), so there is no cross-origin path to this endpoint at all; CORS doesn't even enter into it.
- **Shared secret, defense in depth.** nginx injects `X-Internal-Secret` (from `INTERNAL_API_SECRET`) on every proxied `/api/` request; the worker rejects anything without the matching header with `403`. A client can't set or spoof this header themselves — `proxy_set_header` always overwrites it.
- **Optional origin allowlist.** If `H2O_PUBLIC_ORIGIN` is set on the worker, requests with a mismatching `Origin` header are also rejected with `403`. Off by default (unset) since the exact production domain isn't known until Coolify assigns it.

Response shape on success:

```json
{ "success": true, "mode": "manual", "updatedAt": "...", "durationMs": 8213, "data": { "scrape": { "dates": ["2026-08-02","2026-08-03"] }, "wasserstand": { "stationen": 3 } } }
```

### Manually testing a worker run

```bash
# Exactly what the button does. In Coolify: curl -X POST -H "X-Internal-Secret: <value>" https://<domain>/api/refresh
# Locally (no host port by default - see "Local" above): via the docker-compose.override.yml port, or:
docker compose exec web wget -qO- --post-data="" --header="X-Internal-Secret: <value>" http://localhost/api/refresh

# Or run the underlying scripts directly inside the container:
docker compose exec worker sh -c "node scraper.js --manual"      # manual mode, no history
docker compose exec worker sh -c "node scraper.js"                # scheduled mode, writes history
docker compose exec worker sh -c "node wasserstand.js --manual"
docker compose exec worker sh -c "node buildStats.js"              # only ever run manually/scheduled by scraper's own cron tick, never by the API
```

### Checking logs

```bash
docker compose logs -f worker   # node-cron tick logs + Express request handling, all on stdout
docker compose logs -f web      # nginx access/error log
```

`node-cron` and the run functions log directly to the worker process's own stdout/stderr — no crond, no mail spool, no separate log-wrapper script to route through. A failed scheduled tick is caught internally by `node-cron` (logged, `execution:failed` event) and never crashes the process; a failed manual run is caught in `runManualRefresh()`'s `Promise.allSettled` and reported in the API response instead of throwing.

### Healthchecks

- **`web`**: `wget -qO- http://127.0.0.1:80/` from inside the container — a real HTTP request against the nginx process on the port it actually serves, not just "is the container running".
- **`worker`**: `GET /healthz` checks two things, not just one — the process is up (trivially true if it can answer at all) *and* that the last **scheduled** `wasserstand.js` run succeeded within the last 20 minutes (in-memory `lastScheduledWasserstandAt`, updated only by the cron path — manual refreshes deliberately don't count here, since they say nothing about whether the schedule itself is healthy). Since `wasserstand.js` runs every 15 minutes on schedule, a gap past 20 minutes means the cron is actually stuck, not just "the process exists but nothing's succeeding". `start_period: 20m` in `docker-compose.yml` gives the very first cron tick after a fresh start room to happen before failing checks count against the container.

### Backup & restore of the volume

Backup (from the host, while the containers keep running — reads are non-blocking against atomic writes):

```bash
docker run --rm -v h2o_data:/shared -v "$PWD":/backup alpine \
  tar czf /backup/h2o_data_$(date -u +%Y-%m-%dT%H-%M-%SZ).tar.gz -C /shared .
```

Restore into a (new or emptied) volume:

```bash
docker run --rm -v h2o_data:/shared -v "$PWD":/backup alpine \
  sh -c "cd /shared && tar xzf /backup/<file>.tar.gz"
```

Coolify manages the named volume like any other Docker volume — it survives redeploys and container recreation by default, but isn't automatically backed up externally, so keep an occasional snapshot using the command above if the data matters beyond what GitHub Actions' Git history (below) already retains.

### GitHub Actions: transition status

`.github/workflows/scrape.yml` and `wasserstand.yml` still run on their original schedule and still commit to `public/data`/`public/history` in Git — they're deliberately left as-is for now, running in parallel with the worker, as a safety net and a Git-history backup of the data. They no longer feed the live site once `web`/`worker` are deployed (the site reads the Docker volume, not the repo), so this is redundant data production, not a conflict — nothing to reconcile, no double-write hazard.

**Do not disable them yet.** Once the worker has been running in production long enough to trust it (recommendation: at least a few days, checked via the logs above), remove the `schedule:` block from both workflow files (keep `workflow_dispatch` as a manual fallback) — each file has a comment marking exactly where. That's a deliberate follow-up step, not something to do automatically after this change.

## Data sources

- Tour and booking data: [h2o-adventure.at](https://www.h2o-adventure.at) (publicly visible registration counts, scraped respectfully with a delay between requests)
- Water level: [riverapp.net](https://www.riverapp.net), sourced from the Hydrographischer Dienst Tirol (Tyrolean hydrographic service)
