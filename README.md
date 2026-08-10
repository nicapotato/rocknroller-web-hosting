# rocknroller.nicapotato.com

Static GitHub Pages site for Rock N Roller. Raw HTML/JS, no build step
(same pattern as the shaders repo). **No game payloads are committed here** —
the pages are a thin same-origin shell and the game bytes stream from S3.

## Routes

| Route | What |
| --- | --- |
| `/` | redirects to `/latest/` |
| `/latest/` | play the newest published build (song-free; Add Folder) |
| `/latest/?demo=songs` | same build + curated demo PSARCs from S3 |
| `/latest/?demo=stems` | demos + 6-stem MP3 trees (large extra download) |
| `/0.1.35/` | play a specific version (via `404.html` path routing) |
| `/0.1.35/?demo=songs` | specific version + demo PSARCs |
| `/versions/` | version × platform table (web play + desktop zips) |
| `/about/` | project description |
| `/features/` | technical feature breakdown (language, wasm, threading, …) |
| `/keybinds/` | keyboard shortcuts (catalog + in-song) |
| `/configurations/` | what Settings / play options mean |
| `/play/?v=…` | **legacy redirect** → `/<ver>/` (preserves `?demo=`) |
| `/version/` | **legacy redirect** → `/versions/` |

`?demo=songs` or `?demo=stems` (case-insensitive) makes `player.js` fetch
`apps/released/rocknroller/demos/catalog.json` and the listed `*_p.psarc`
files. `?demo=stems` also downloads the 6-stem MP3 trees under
`demos/stems/{psarc_basename}/` into MEMFS at `/weblib/DemoStems/` (additive
stems root — coexists with any user-picked stems folders) before the PSARCs
are granted. Any other `?demo=` value fails loudly. Without the flag, no demo
network requests are made.

Demo content is **session-only**: the engine purges the demo roots
(`/weblib/Demos`, `/weblib/DemoStems`) and their cached songs from the
persistent settings DB at every startup, so a demo visit never leaves phantom
folders or unplayable songs behind on a later plain `/latest/` visit. User-added
folders, profiles, and scores are untouched. Demo psarcs and stem MP3s are
published with `Cache-Control: max-age=86400`, so repeat demo visits within a
day serve the big files from the browser HTTP cache (`catalog.json` stays
`no-cache` as the freshness authority).

## How the player works

The document stays on this origin; `assets/player.js` pulls the build from
`s3://prod-nicapotato-public-software/apps/released/rocknroller/<ver>/web/`:

1. `coi-serviceworker.min.js` (committed here, must be same-origin) injects the
   COOP/COEP headers GitHub Pages cannot send — required for
   SharedArrayBuffer/pthreads. First visit reloads once.
2. `Module.locateFile` points `.wasm`/`.data` requests at S3. The bucket CORS
   allows GET from `https://rocknroller.nicapotato.com` (and
   `http://localhost:8098` / `http://127.0.0.1:8098` for `make serve`).
3. Worker scripts must be same-origin, so `RockNRoller.js` is fetched as a Blob
   and handed to `Module.mainScriptUrlOrBlob`; blob: URLs inherit this origin.

Publishing: the rocknroller CI (`publish-s3-web` job) writes the versioned
engine prefix, overwrites `latest/`, syncs curated demos to
`apps/released/rocknroller/demos/`, and merges the apps catalog with
`play_url` like `https://rocknroller.nicapotato.com/<ver>/`. This site picks
that up when pages here are deployed.

## Local dev

    make serve   # http://127.0.0.1:8098 (port is allow-listed in bucket CORS)

## DNS

`CNAME` file targets `rocknroller.nicapotato.com`; the DNS record is a CNAME
from `rocknroller` → `nicapotato.github.io` at the registrar.
