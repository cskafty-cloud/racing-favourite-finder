# Betfair adapter configuration template

This is the setup guide for `Start-BetfairAuProxy.ps1`. Do **not** paste real secrets into source code, GitHub, this file, screenshots, or chat.

## Three different values are required

| Environment variable | What belongs here | Where it comes from |
|---|---|---|
| `BETFAIR_APP_KEY` | Your Betfair application key | Your authorised Betfair API/developer account |
| `BETFAIR_SESSION_TOKEN` | A current Betfair session token | Obtained by authenticating to Betfair using your own account and approved API access |
| `BETFAIR_FEED_TOKEN` | A long random secret you control | Set the same exact value in the Railway app's Variables and enter it into the Windows launcher |

**Important:** `BETFAIR_FEED_TOKEN` only protects the connection between Railway and your Windows adapter. It is not a Betfair login, app key, or session token. It cannot replace the first two credentials.

## Where to enter the values

1. In Railway, open the Racing Favourite Finder service → **Variables**.
2. Set `BETFAIR_FEED_TOKEN` to your own long random secret. Save the variable and wait for the service to redeploy.
3. On the Australian Windows PC, open PowerShell in the repository's `betfair-au-proxy` folder.
4. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Start-BetfairAuProxy.ps1
   ```

5. The launcher prompts for the three values in order. Enter your Betfair app key at the first prompt, your active Betfair session token at the second, and the exact same shared secret saved in Railway at the third.
6. Keep the adapter PowerShell window open. In another PowerShell window, run `tailscale funnel --bg 8080` and then `tailscale funnel status`.
7. Confirm `http://127.0.0.1:8080/health` reports `credentialsConfigured: true`. This confirms only that both Betfair credential fields are present; it does **not** prove Betfair accepts them.
8. Test the protected `/api/races` and `/api/sports` endpoints. They must return actual markets and timestamped offers before the feed is considered connected.

## Troubleshooting

- `credentialsConfigured: false`: one or both Betfair credentials were not entered into the local launcher process. Stop the adapter with Ctrl+C and run the launcher again.
- HTTP 401 / shared adapter token mismatch: the third prompt does not match Railway's `BETFAIR_FEED_TOKEN`. Update Railway and restart the local adapter using the same secret.
- HTTP 502 / Betfair authentication error: the app key or session token may be invalid, expired, or not authorised for the API. Obtain/refresh credentials through Betfair's authorised process. Never send them to anyone.
- HTTP 403 / Cloudflare or location restriction: this is a host/network restriction, not necessarily a bad password. Do not try to evade Betfair's geographic or API restrictions.

The adapter is read-only. It requests delayed Betfair Exchange markets and does not place bets. Exchange BACK/LAY prices are not Sportsbet or Bet365 fixed odds.
