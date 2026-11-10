# Racing Favourite Finder — Windows desktop app

This folder contains the Electron desktop launcher for the public Racing Favourite Finder website.

## Download

The Windows x64 portable executable is published as a public GitHub Release:

https://github.com/cskafty-cloud/racing-favourite-finder/releases/latest

## How it works

- Opens the production website in a dedicated Windows desktop window.
- Uses the live hosted website for current racing and sports information.
- Requires an internet connection.
- Does not contain bookmaker login credentials and cannot place bets.
- Does not bundle API keys or Railway secrets.

## Build locally

Requires Node.js 22 or newer and Windows x64:

```powershell
npm install
npm run desktop:dist
```

The portable executable is written to `release/`.

The GitHub Actions workflow at `.github/workflows/windows-app.yml` builds and publishes the Windows executable automatically when desktop app files change on the main branch.
