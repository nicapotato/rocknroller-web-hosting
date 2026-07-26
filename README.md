# rocknroller.nicapotato.com

Static GitHub Pages site for Rock N Roller. Raw HTML/JS, no build step
(same pattern as the shaders repo). **No game payloads are committed here** —
the pages are a thin same-origin shell and the game bytes stream from S3.

## Routes

| Route | What |
| --- | --- |
| `/` | redirects to `/latest/` |
| `/latest/` | play the newest published build |
| `/play/?v=0.1.33` | play a specific version |
| `/0.1.33/` | same as above (served via `404.html` path routing) |
| `/version/` | version × platform table (web play + desktop zips) |
| `/about/` | project description |

## How the player works

The document stays on this origin; `assets/player.js` pulls the build from
`s3://prod-nicapotato-public-software/games/released/rocknroller/<ver>/web/`:

1. `coi-serviceworker.min.js` (committed here, must be same-origin) injects the
   COOP/COEP headers GitHub Pages cannot send — required for
   SharedArrayBuffer/pthreads. First visit reloads once.
2. `Module.locateFile` points `.wasm`/`.data` requests at S3. The bucket CORS
   allows GET from `https://rocknroller.nicapotato.com` (and
   `http://localhost:8098` / `http://127.0.0.1:8098` for `make serve`).
3. Worker scripts must be same-origin, so `RockNRoller.js` is fetched as a Blob
   and handed to `Module.mainScriptUrlOrBlob`; blob: URLs inherit this origin.

Publishing is unchanged: the rocknroller CI (`publish-s3-web` job) writes the
versioned prefix, overwrites `latest/`, and merges the catalogs. This site
picks all of that up with zero changes here.

## Local dev

    make serve   # http://127.0.0.1:8098 (port is allow-listed in bucket CORS)

## DNS

`CNAME` file targets `rocknroller.nicapotato.com`; the DNS record is a CNAME
from `rocknroller` → `nicapotato.github.io` at the registrar.
