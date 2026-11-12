# Racing Favourite Finder

Australian horse, greyhound and harness racing, plus sports markets and settled results. This is a **read-only information dashboard**: it does not log in to betting accounts, place bets or automate wagering.

## Current production data sources

The live production board currently uses:

- **MoviOdds** for Australian racing fixtures and Bet365 fixed WIN/PLACE runner quotes where the provider returns them.
- **MoviOdds sports stream** for Bet365 sports-market updates.
- **Betfair Exchange** through the separately hosted Australian adapter for delayed Exchange BACK/LAY markets. Exchange prices are not bookmaker fixed odds.
- **MoviOdds results** for final horse, greyhound and harness results, used to settle saved favourite history.

The provider is the data source; the bookmaker is the quote origin. The dashboard must keep those identities separate. A quote is eligible for a verified bookmaker ranking only when it is genuinely attributed to that bookmaker, belongs to the correct market, has a usable source timestamp and is fresh (under 180 seconds). Estimates, consensus prices, untimestamped previews, suspended markets and stale quotes are not verified bookmaker prices.

### Sportsbet availability

The current public production feed has **no verified Sportsbet racing WIN or PLACE quotes**. Do not label Bet365, Betfair Exchange, market consensus or preview prices as Sportsbet. PuntersEdge Free/Hobby/Standard credentials are personal-use only and are not enabled for the public board. Krok Odds is also excluded unless the required public-display permission is configured. A provider must explicitly permit public display before its quotes can be used on this site.

### Optional provider credentials

- `PUNTERSEDGE_API_KEY` and `PUNTERSEDGE_PLAN`: legacy/optional PuntersEdge integration only. A free personal-use key must not be used to power this public dashboard. The public-display licence flag is intentionally not enabled by default.
- `KROKODDS_API_KEY`: optional Krok integration. Public use is blocked unless the applicable written public-display permission is configured. Do not set the permission flag merely to make the feed appear.
- `ODDS_DATA_API_TOKEN`: optional sports fallback credential. The paid fallback is disabled unless `ENABLE_PAID_ODDS_FALLBACK=true` is deliberately set; it is not part of the free-only production setup.
- Betfair credentials belong on the Australian adapter, not in browser code. See the adapter instructions below.

Do not commit `.env`, API keys, session tokens or shared adapter tokens.

## Run locally

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env` only if you need optional integrations.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000` (or the configured `PORT`).

The public MoviOdds sources do not require a browser-side API key. Optional provider credentials must remain server-side.

## Memory protection

The server samples Node and cgroup memory every 30 seconds. It begins rebuildable-cache cleanup at 384 MB Node RSS or 62.5% of the detected cgroup memory limit, capped at 600 MB (596 MB on the current approximately 954 MB container), with a 30-second cleanup cooldown. The threshold follows the actual cgroup limit instead of assuming every deployment has the same memory allocation. Under pressure it clears rebuildable sports caches, reduces retained market-signature maps, trims result history in memory and caps the all-sports fixture cache. The persistent `/data` history file is not deleted by pressure cleanup. Railway's historical maximum is a rolling metric and is not reset by application code.

## Favourite history and persistent storage

The app records favourite snapshots and settles saved selections against final results. It cannot reconstruct selections from before the app began recording them unless historical data is separately obtained and imported.

The history file is stored at `DATA_DIR/history.json`. For Railway, attach the existing persistent volume at `/data` and set `DATA_DIR=/data`. Keep that volume attached when deploying; it protects existing history. The application flushes queued history writes during graceful shutdown.

## Railway production

Production service: [Racing Favourite Finder](https://racing-favourite-finder-production.up.railway.app/)

- Service listens on Railway's `PORT` (production target port 8080).
- Health endpoint: `/api/health`.
- Persistent history volume: `/data` (500 MB).
- Node is started with a bounded heap to reduce memory pressure.
- The application logs cgroup memory, Node RSS/heap, cache sizes and sports-stream telemetry.
- Railway deployments that share an attached volume may briefly interrupt requests; the browser retries transient same-origin 502/503/504 and network failures. This does not promise zero downtime.

Useful local checks:

```sh
npm test
node --check server.js
node --check betfair-au-proxy/server.js
node --check betfair-feed.js
node --check public/app.js
```

## Data-quality and safety rules

- Show genuine Bet365 fixed WIN/PLACE only when the actual quote and its market timestamp are present and fresh.
- Show Sportsbet only when a genuine Sportsbet quote is returned by a provider whose licence permits public display.
- Keep Betfair Exchange BACK and LAY separate from fixed bookmaker prices.
- Never promote estimated, indicative, projected, modelled, consensus, synthetic or predicted prices into verified rankings or top tips.
- Do not treat feed receipt time or a race-card refresh time as the bookmaker's quote timestamp.
- Do not substitute one bookmaker's price for another bookmaker's missing price.
- Do not claim a fixture count means every race has live prices.
- No paid subscription fallback, login bypass, scraping of protected pages or bet-placement actions are enabled by default.
- This dashboard is informational, not betting advice. 18+ only. Gambling Help Online (Australia): 1800 858 858.

## Free racing-source policy

- B337 is a separate reference for publicly accessible racing information. Compare its limited free Sportsbet/TAB view manually where available.
- Do not bypass B337 login restrictions or scrape protected pages. Import B337 quotes only if an authorised public machine-readable export/feed is available.
- Automatically combine only accessible public racing fixtures and genuine bookmaker-labelled odds. Keep bookmaker identity separate from the data provider.
- Compare Sportsbet, Bet365 and TAB independently, and only where a source returns an actual quote for that bookmaker and market.
- Keep missing, stale, untimestamped, suspended or otherwise unverified prices unavailable or clearly marked as reference-only. Never infer one bookmaker's price from another bookmaker or from a market consensus.
- The Betfair Exchange delayed feed is an exchange source, not a Sportsbet, Bet365 or TAB fixed-odds feed. Keep that distinction visible.
- No paid subscriptions, API purchases, login bypasses, or bet-placement actions are part of this policy.


## Betfair Exchange display

- When valid `BETFAIR_APP_KEY` and `BETFAIR_SESSION_TOKEN` environment variables are configured, the server requests Australian horse, greyhound and harness WIN and PLACE markets from Betfair Exchange.
- Best available BACK and LAY prices are preserved as separate exchange quotes, with available size and feed observation time. The delayed feed may be up to 180 seconds behind.
- Exchange quotes are labelled **Betfair Exchange**, not Sportsbet, Bet365 or TAB. They are excluded from bookmaker fixed-odds favourite selection, bookmaker quote counts and fixed-odds comparisons.
- If the two Betfair credentials are not configured, the dashboard reports that status instead of pretending the feed is connected. Do not add credentials unless the account owner supplies them.


## Australian Betfair Exchange adapter (read-only)

The `betfair-au-proxy` service now exposes:
- `GET /health` — reports region and whether credentials are configured (never returns secrets).
- `GET /api/races` — Australian horse, greyhound and harness WIN and PLACE markets, preserving Exchange BACK and LAY offers separately.
- `GET /api/sports` — upcoming/in-play sports Exchange markets, with separate BACK and LAY offers, market timestamps and delayed-data metadata.

This adapter must run on a host whose outbound IP is in a Betfair-permitted Australian location. It cannot run on Railway's currently available regions to solve the documented Cloudflare geo block. Do not deploy it to another restricted region, use a VPN/proxy to evade restrictions, or assume a successful build means the feed is connected.

### Connect adapter to the main Railway app

After deploying the adapter on a permitted Australian host:
1. Set `BETFAIR_APP_KEY` and `BETFAIR_SESSION_TOKEN` as private environment variables on the adapter service only.
2. Set `BETFAIR_FEED_URL` on the main Railway service to the adapter's full `/api/races` URL.
3. Set `BETFAIR_SPORTS_FEED_URL` on the main Railway service to the adapter's full `/api/sports` URL.
4. Confirm `/health` reports Australia and credentials configured; then check both adapter endpoints return actual market prices and timestamps.
5. Confirm the main app reports priced BACK/LAY offers. A successful health check or event catalogue alone is not proof of a working odds feed.

The main app keeps Exchange prices separate from fixed Sportsbet/Bet365 bookmaker prices. Never count Exchange offers as fixed-odds bookmaker quotes or bookmaker favourites.

### No-card/local-host option

If no Australian cloud host is available, the proxy can run on an Australian Windows PC with Node.js 22 or newer. The PC must remain powered on and connected. A local `localhost` URL is not reachable from Railway; a secure, authenticated inbound connection and stable public endpoint would still be needed. Do not expose the proxy publicly without authentication. This option has not been deployed or connected automatically.


### Run the adapter on an Australian Windows PC (no cloud card)

1. Install Node.js 22 or newer from https://nodejs.org/.
2. Install Tailscale on the Windows PC and sign in. Tailscale Funnel is an optional public HTTPS tunnel; it is available on Tailscale plans but must be enabled for your tailnet.
3. In Railway, add a private variable named `BETFAIR_FEED_TOKEN` with a long random secret value. Use the same value locally when the PowerShell launcher asks for it. Never commit or paste this token into GitHub.
4. In the Railway service variables, set:
   - `BETFAIR_FEED_URL` = `https://YOUR-TAILSCALE-FUNNEL-HOST/api/races`
   - `BETFAIR_SPORTS_FEED_URL` = `https://YOUR-TAILSCALE-FUNNEL-HOST/api/sports`
   - `BETFAIR_FEED_TOKEN` = the same secret entered in the Windows launcher.
5. Download a fresh ZIP from the repository **main** branch after the latest launcher update and extract it. In PowerShell, use the actual extracted folder (the `(2)` suffix may differ):
   `Set-Location "$HOME\Downloads\racing-favourite-finder-main\betfair-au-proxy"`
   `Set-ExecutionPolicy -Scope Process Bypass`
   `./Start-BetfairAuProxy.ps1`
6. The Windows launcher securely prompts for the Betfair delayed app key, session token and shared token. It saves them encrypted with Windows DPAPI outside the downloaded repository at `%LOCALAPPDATA%\RacingFavouriteFinder\BetfairAdapter\credentials.dpapi`. This stable location survives ZIP re-downloads, extraction to a new folder and repository updates. On the first launch after this update, the launcher automatically migrates the previous repo-local encrypted file if it finds one. The secrets are never written in plaintext or committed to GitHub. The file is decryptable only by the same Windows user on the same PC. On later starts, answer `Y` to **Use the saved encrypted credentials?** to reuse them. Answer `N` only when deliberately replacing the saved values. Keep the adapter PowerShell window open while the feed is in use.
7. The updated launcher starts Funnel using `tailscale.exe` (not the PowerShell `tailscale.ps1` shim), then prints Funnel status. If Funnel is not enabled, approve it in the Tailscale admin flow. If you need to start/check it manually, use `& "$env:ProgramFiles\Tailscale\tailscale.exe" funnel --bg 8080` and `& "$env:ProgramFiles\Tailscale\tailscale.exe" funnel status`. Copy the HTTPS hostname into the two Railway URL variables above.
8. Restart/redeploy the Railway service after setting its variables. Test `/health`, then the protected `/api/races` and `/api/sports` routes. The latter two require the bearer token and should return real timestamped quotes before the feed is considered connected.

The Windows adapter binds only to `127.0.0.1`; Funnel supplies HTTPS from outside. The shared bearer token protects the API routes. Keep the PC awake and online. If you stop the Node process, turn off Funnel with `tailscale funnel reset`. Funnel makes the endpoint publicly reachable, so keep the token secret and do not share its URL unnecessarily.

Tailscale Funnel is a third-party service and requires a Tailscale login and enabling Funnel. It is not a Betfair restriction bypass: the adapter still makes normal Betfair API requests from your Australian connection, and Betfair may still deny access or require approved account/API credentials.


## Betfair adapter credential setup

See [`betfair-au-proxy/CONFIGURATION-TEMPLATE.md`](betfair-au-proxy/CONFIGURATION-TEMPLATE.md) for the exact three-value setup, where each value comes from, and how to test the protected adapter endpoints. The current Windows launcher saves these values encrypted with DPAPI outside the repository. Older ZIP copies may still prompt every time and do not save them; download a fresh ZIP from the main branch before starting the adapter. Do not put real secrets in source code or commit them to GitHub.


## Data-quality safeguards

- Estimated, indicative, projected, modelled, consensus, synthetic and predicted prices are excluded from verified bookmaker favourites and top-tip rankings.
- Exchange BACK/LAY offers remain separate from fixed bookmaker WIN/PLACE prices.
- A bookmaker quote is eligible for verified racing rankings only when its market is supported, its source timestamp is known, and it is younger than 180 seconds.
- Run `npm test` to execute the market-quality regression tests. The GitHub Actions workflows run these tests and JavaScript syntax checks before release builds.


## Railway deployment resilience and history safety

Production currently uses a Railway Volume mounted at `/data` for `history.json`. Railway cannot keep the old and new deployment online simultaneously when both need the same attached volume. The service therefore cannot promise zero-downtime deployments while this volume remains attached. The application does not detach or delete the volume automatically.

The deployment resilience changes in this release:
- On `SIGTERM`, stop recurring racing/results refresh timers, finish in-flight HTTP requests, and flush the queued history-file write before the process exits (with a 25-second safety limit).
- The browser retries same-origin API requests after transient HTTP 502, 503, 504 responses and transient network/timeout errors, with bounded backoff. This can recover short interruptions automatically; it does not remove the underlying volume restriction.
- Keep the Railway healthcheck at `/api/health`, timeout 120 seconds, and 30-second shutdown drain.

A true zero-downtime migration requires moving `history.json` to shared external persistent storage, verifying a complete backup, switching the application to that store, and only then detaching the Railway Volume. Railway Buckets are not zero-cost: current pricing is $0.015 per GB-month, and uploads from the service also incur normal service egress. No bucket or paid storage has been provisioned for this project. The volume is intentionally retained to protect the existing history.

### Historical production feed snapshot — 12 November 2026\n\nThe following figures are a historical startup diagnostic, not current live totals. Use the live dashboard and current health/telemetry endpoints for present availability.

The latest production log sample checked on 12 November 2026 at 10:47 UTC reported:
- Betfair Australian racing adapter: 160 races, 1,653 runners, 4,835 Exchange quotes.
- Betfair sports adapter: 573 markets, including 275 priced soccer markets; zero adapter errors in its startup test.
- Combined Australian race board: 509 cards (276 horse, 225 greyhound, 8 harness) in that refresh.
- Bet365: 198 verified WIN and 118 verified PLACE quotes in that sample.
- Sportsbet: zero verified racing quotes. The public preview supplied 24 untimestamped WIN preview rows and no PLACE quotes; these remain unverified and are excluded from verified rankings.

These are time-stamped diagnostic snapshots, not guaranteed live totals. The live dashboard and feed timestamps remain the source of current availability. Do not relabel exchange prices, public previews, or another bookmaker's prices as Sportsbet.
