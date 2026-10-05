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

## Workshop projects

Real builds: parts from Louisiana Tech's catalog (`app/data/latech_*.psv`,
searched by the `parts_catalog` tool), their wiring, an Arduino UNO
sketch, printed OpenSCAD parts and a 3D layout, made by Jarvis's
`project` tool and shown in the workshop's project panel. The server
checks the wiring against the sketch, prices the parts and compiles the
sketch (`app/tools/workshop_project.py`, `app/services/arduino.py`); the
browser runs it on an emulated UNO (avr8js) against a DC circuit solver
(`web/src/lib/workshop/sim/`). Part types, pins and sizes live in one file
both sides read: `web/src/lib/workshop/parts.json`.

Compiling needs `arduino-cli` with the `arduino:avr` core (the Docker
image has it). Locally, install them, or point `ARDUINO_CLI` at the
binary; without one, projects still save and check, but sketches don't
compile and the simulation can't run. Projects are stored in
`jarvis_workshop_projects` (`supabase/migrations/0014_...`).

## On a phone

Phones get a separate, lightweight view of the console (chat, voice in
and out, nothing to operate) — `web/src/components/mobile/`. It is picked
by screen size and touch; `?view=mobile` or `?view=desktop` overrides it
and is remembered per device, and each view's menu can switch. Turns from
it go out on the `mobile` channel, which keeps replies short.

To install it like an app: open the site in Safari, Share → Add to Home
Screen. It opens full-screen, straight into the phone view.

Keeping the two views in step:

- One turn engine, `web/src/lib/turn.ts`, runs every message for both
  views: streaming, speaking a sentence at a time, the "what he has said
  so far" caption, and the cards a reply carries. Change it there and
  both views get it.
- Cards under a reply (checklists, inbox items) render from
  `web/src/components/reply-cards.tsx` in both chats. A new kind of card
  goes there.
- New server tools reach the phone automatically. Only the console tools
  (panels, workshop, camera, showcase) are desktop-only.
- An open console notices a deploy (`web/src/lib/update-check.ts`). The
  phone app reloads itself when it is idle, because its thread is saved.
  The desktop shows a notice instead, because its chat is not saved.

## Checklists

Say or type a loose note ("pick up printer paper, email Dr. Lee about lab
4, book the dentist") and Jarvis makes a checklist from it
(`app/tools/checklist.py`, table `jarvis_checklists`). It shows as a card
in the chat on both views, and items tick off with a tap. He can also
add to a list, tick items off, show it, or archive it.

## Rounds, inbox and notifications

Every two hours outside quiet hours (10pm–8am Central by default), Jarvis
makes his rounds on his own (`app/services/autonomy.py`). He looks over
tasks, the launch, habits, calendar, mail and open lists, and files what
he finds in the **inbox**:

- **Notices**: things worth knowing now.
- **Proposals**: one exact tool call he would make (send this email,
  mark that task done), with why.

He can read anything on rounds, but nothing that changes anything runs
without you. `app/tools/rounds.py` enforces this in code: every write is
refused there, and the only way through is a proposal that runs when you
tap **Approve**. In a conversation he can list, decline or dismiss inbox
items, but he cannot approve one.

The inbox is a tab on the desktop and in the phone's menu. From it you
can switch rounds on or off, run a round now, and turn notifications on
for that device. Notifications use Web Push (`app/services/push.py`,
`web/public/sw.js`). On an iPhone they only work in the home-screen app.

Every 15 minutes the inbox also gets market and signal updates
(`app/services/market_updates.py`): a new K.I.V. scan and its top trades,
a top trade reaching its target or stop, and big moves on the watchlist.
Each is filed once. The inbox filters by topic: rounds, markets, signals.

Setup, once:

1. Apply `supabase/migrations/0008_jarvis_checklists.sql` and
   `0009_jarvis_autonomy.sql`. 0009 schedules the rounds in pg_cron, so
   apply it after this code is deployed.
2. Run `python scripts/make_vapid_keys.py` and set `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:`) on the service.
   Without them the inbox works, but devices get no notifications.

## Locks

Signing in with Google only opens the lock. The phone asks for a PIN, the
desktop for a face scan, and either gives the console a 12-hour unlock
token, the only token the API accepts (`app/core/auth.py`). A Google
session on its own gets `423 Locked`, so a stolen one is not enough.
The console locks itself again when the token runs out, after five
minutes away on the phone, and after 30 minutes away on the desktop.

- **PIN** (`app/services/lock.py`): only a salted scrypt hash is stored,
  in `jarvis_lock`. Set or change it with `python scripts/set_pin.py`.
  Five wrong tries lock the PIN for 15 minutes, and each further five
  doubles that.
- **Face** (`web/src/components/lock/face-gate.tsx`): the scan runs in the
  browser (MediaPipe's face mesh, face-api's descriptors). Only face
  descriptors are sent, never images, and the server decides the match.
  Each scan asks for a blink and a head turn, in a random order and
  direction. The first scan enrols the face, and enrolling takes the PIN.

Limits: the liveness steps run in the browser, so they stop a photo held
up to the camera, not someone who already has your Google session and
crafts the requests by hand. And the server accepts either factor from
any device; which lock appears depends on the view.

`JARVIS_ACCESS_TOKEN` (curl, the terminal CLI) and the browser
extension's token are unaffected.

## Signing in

The console authenticates with Google, restricted to an allowlist. Three
settings turn it on, and it fails closed without them:

```
GOOGLE_LOGIN_REDIRECT_URI=https://<host>/auth/login/callback
JARVIS_ALLOWED_EMAILS=you@example.com          # unset = nobody gets in
JARVIS_SESSION_SECRET=$(openssl rand -hex 32)  # rotating it signs everyone out
```

`GOOGLE_LOGIN_REDIRECT_URI` must also be registered on the OAuth client in
the Google Cloud console. It is a *second* redirect URI alongside
`GOOGLE_REDIRECT_URI` — sign-in and the Gmail/Drive connect flow are
separate flows with different scopes, and share nothing but the client.

`JARVIS_ACCESS_TOKEN` still works as a bearer credential. Nothing types it
into the console any more, but curl and scripts use it, and it is the way
back in if sign-in is misconfigured:

```js
// devtools console, then reload
localStorage.setItem("jarvis_access_token", "<JARVIS_ACCESS_TOKEN>")
```

For `next dev`, also set `JARVIS_LOGIN_RETURN_ORIGIN=http://localhost:3000`
so sign-in redirects back to the HMR server rather than to the API, and
register `http://localhost:8000/auth/login/callback` in Google too. In
production leave it unset — sign-in then returns to whichever host the
request came in on, which is always right when FastAPI serves the console.

Note it is *not* `JARVIS_FRONTEND_ORIGIN`. That one is a CORS allowance
and tends to outlive the host it names; pointing sign-in at it once sent
users to a decommissioned deployment.

## Try the API

```
curl -X POST localhost:8000/invoke \
  -H "Authorization: Bearer $JARVIS_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What can you do right now?"}'
```

## Deploy

One Render service, from `render.yaml`. The `Dockerfile` builds `web/`
with Node 22 in a throwaway stage and ships a Python image that runs
uvicorn alone — Node is a build-time dependency only.

Docker rather than Render's native Python runtime because that runtime's
bundled Node version is undocumented and `NODE_VERSION` is documented as
Node-runtime-only, while Next 16 needs Node 20+.

Two things do not carry over from the old Railway setup:

- **Redirect URIs are host-dependent.** `GOOGLE_REDIRECT_URI` (and
  `SPOTIFY_`/`ZOHO_` if used) must point at the Render host *and* be
  registered as such in each provider's console.
- **`JARVIS_FRONTEND_ORIGIN` is obsolete.** It only existed to CORS-allow
  a separately-deployed frontend; the console is same-origin now.
