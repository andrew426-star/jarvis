# J.A.R.V.I.S.

Andrew's personal AI chief-of-staff — FastAPI backend and Next.js console
in one repo, served by one process on one port.

```
app/    FastAPI: agent loop, tools, memory, auth, /panels REST
web/    Next.js console (static export -> web/out/, mounted by app/main.py)
```

The console is a pure client-side SPA — one route, no route handlers, no
middleware — so `next build` emits plain static files and there is no
Node runtime in production. FastAPI mounts `web/out/` at `/`, which puts
the UI and the API on the same origin (so the browser needs no CORS
preflight and no API base URL).

## Run it

```
pip install -r requirements.txt
cp .env.example .env          # fill in real values

npm ci --prefix web
npm run build --prefix web    # rebuild after any UI change

uvicorn app.main:app --port 8000
```

UI and API are both on http://localhost:8000.

## Iterating on the UI

The build step above is too slow for actual frontend work, so `next dev`
still exists for that — the one case where two processes are worth it:

```
uvicorn app.main:app --reload --port 8000    # terminal 1
npm run dev --prefix web                     # terminal 2 -> :3000
```

Hit :3000 for HMR. `web/.env.development.local` points it at the backend
on :8000, and :3000 is already in the CORS allowlist (`app/main.py`).
`next build` ignores that file, so production stays same-origin.

If `web/out/` has never been built, the static mount is simply skipped
and :8000 serves the API alone.

## Try the API

```
curl -X POST localhost:8000/invoke \
  -H "Authorization: Bearer $JARVIS_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What can you do right now?"}'
```

## Deploy

One Railway service. `nixpacks.toml` adds Node to the build image so
`web/` compiles during the build; `railway.json` starts uvicorn alone.
