# Racing Favourite Finder — live + results history

Australian horse and greyhound racing dashboard. Informational only; it does not log into Bet365 or place bets.

## Live feed

Uses PuntersEdge's authenticated `GET /v1/racing/next-to-go` endpoint, requesting Australian horse and greyhound races. Bet365 price is used to rank the favourite when that quote is available; otherwise the app uses the median of available, non-stale bookmaker quotes and labels the source.

1. Create a free API key at https://puntersedge.online/api/integrate (or https://puntersedge.online).
2. Set `PUNTERSEDGE_API_KEY` in your server environment. Never put the key in browser JavaScript or commit `.env`.
3. Run `npm install` then `npm start`; visit http://localhost:3000.

The provider's free tier has limited monthly credits. Check its current endpoint access, bookmaker coverage, usage limits, and licence before deployment or use. Prices can be stale, incomplete, suspended, or unavailable.

## Favourite history

Whenever the live endpoint is polled, the app saves the first favourite it sees for each race. It then calls `/v1/racing/results` to settle saved picks against final results. The history page shows settled selections, wins/losses and strike rates for horse, greyhound and combined races. It also shows pending selections.

The history is a record of favourites captured while this app was running. It cannot reconstruct favourites from before deployment unless historical odds are separately obtained and imported. The app uses a JSON file at `DATA_DIR/history.json`; set a persistent disk/volume at `/data` and `DATA_DIR=/data` on Railway so records survive redeploys. Without persistent storage, the file can be lost when the host replaces the container.

## Deploy on Railway (recommended for this Express server)

1. Push this project to a GitHub repository (do not upload `.env`).
2. In Railway, create a project and choose **Deploy from GitHub repo**.
3. Add environment variable `PUNTERSEDGE_API_KEY` in the Railway service Variables tab.
4. Add a Railway Volume mounted at `/data`; set `DATA_DIR=/data`.
5. Generate a public domain under service Settings / Networking.
6. Confirm `/api/health` returns `ok: true` and `liveFeedConfigured: true`.

Railway supports Node services and server-side environment variables. This app is not a static-only Netlify site; Netlify would require a serverless conversion and a separate persistent database. Railway is the simpler fit for this Express server and its history file.

## Important

- The data provider key and commercial-use terms are separate matters. Confirm the provider's current licence allows your intended use.
- A market favourite is not a prediction or a guarantee.
- This dashboard is not betting advice and never places bets.
- 18+ only. Gambling Help Online (Australia): 1800 858 858.
