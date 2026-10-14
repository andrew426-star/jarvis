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

## Reminders, holding calls, protocols, weather

Features taken from the films' JARVIS:

- **Reminders** (`app/tools/reminders.py`): "remind me at three to call
  Dr. Lee", "every weekday at 7:30, Italian". Unlike console timers they
  fire with the console closed: pg_cron calls `/reminders/run` every
  minute, which pushes the reminder and files it in the inbox under
  **Reminders**. Apply `supabase/migrations/0015_jarvis_reminders.sql`
  after deploying.
- **Hold** (`app/tools/hold.py`): "hold my calls for an hour". Pushes stop
  for that long, but the inbox keeps filling. Security alerts and reminders
  still get through. "I'm back" lifts the hold and Jarvis says what came in.
- **Protocols** (`app/tools/protocols.py`): one word that sets several
  systems going. Built in: wake up, house party (every system reports
  in), focus, clean slate, lights out, debrief, dossier. Andrew can save
  his own ("when I say gym time, ..."), kept in `jarvis_state`.
- **Weather** (`app/tools/weather.py`): Open-Meteo, no key, Ruston by
  default. It is part of the morning brief.
- **Notes** can now be taken as well as read ("take a note: ...").

## Sentinel, wake word, voice and the house

- **Sentinel** (`app/services/sentinel.py`): every 20 minutes it checks
  the news on his topics, new mail in all three inboxes (Gemini picks out
  what needs him), and how Kivaro's posts are being received: numbers,
  new comments, sentiment and who to reply to, plus new mentions of
  Kivaro AI. Findings land in the inbox under **Intel**, **Mail** and
  **Publicity**. Apply `0016_jarvis_sentinel.sql` after deploying. Reddit,
  YouTube and X numbers need `REDDIT_CLIENT_ID`/`_SECRET`,
  `YOUTUBE_API_KEY` and `X_BEARER_TOKEN`. LinkedIn has no API for this;
  Jarvis reads it through the browser instead.
- **"Hey Jarvis"** (`web/src/lib/wakeword/`): turn it on in Settings. The
  phrase is detected on the device by openWakeWord's models
  (`web/public/wakeword/`, CC BY-NC-SA 4.0: fine for personal use, not for
  Kivaro's product). Nothing is sent until the phrase is heard. It also
  wakes the console from standby.
- **Voice** (`app/services/persona.py`): his character, after the films,
  and delivery cues (`[break]`, `[emphasis]`, `[calm]`, ...) that Fish
  Audio's S2 model performs. They are stripped from anything shown.
- **House** (`app/services/home.py`, `hardware/room-hub/`): devices check
  in at `/devices/state` with the device token, and collect the commands
  Jarvis queued for them with the `home` tool.

## The phone line

Jarvis answers the calls you don't (`app/services/phone.py`,
`app/api/routes/phone.py`):

1. He asks who's calling and why, and greets your contacts by name.
2. Spam gets a polite goodbye.
3. Otherwise your phone rings from the Jarvis number, and you hear
   "Sir, Dana from Citadel, about the pilot. Press 1 to take it."
4. If you don't take it, the caller leaves a message. It's transcribed and
   lands in the inbox under **Calls**, with a push to your phone.

"Hold my calls" sends everyone straight to messages.

Text the number from your own phone to talk to Jarvis anywhere. Over text
he can read anything but changes only reminders, checklists, notes, habits
and the hold, because a text can come from a borrowed phone.

Setup, once:

1. Buy a voice and SMS number in Twilio (about $1.15 a month). Set
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`,
   `ANDREW_PHONE` (your cell, `+1...`) and `PUBLIC_BASE_URL` (this
   service's https address, exactly as Twilio calls it) on Render.
2. On the number in the Twilio console:
   - A call comes in: Webhook, POST `<PUBLIC_BASE_URL>/phone/voice`
   - Call status changes: `<PUBLIC_BASE_URL>/phone/status`
   - A message comes in: Webhook, POST `<PUBLIC_BASE_URL>/phone/sms`
3. Apply `supabase/migrations/0017_jarvis_calls.sql`.
4. On your phone, forward unanswered calls to the Twilio number. iPhone's
   Settings → Phone → Call Forwarding forwards every call, which is not
   what you want. Use your carrier's conditional forwarding instead:
   T-Mobile and AT&T dial `**61*<number>#` (no answer) and
   `**67*<number>#` (busy); Verizon dials `*71<number>`. Undo it with
   `##61#` / `##67#` or `*73`.
5. Save the Twilio number as "Jarvis" in your contacts, so you know a ring
   from it is him putting someone through.

Jarvis rings you for 15 seconds, less than a carrier waits before
forwarding, so a call can never loop back to him. Twilio's speech
recognition and recordings are billed per minute, a few cents a call.
Louisiana needs only one party's consent to record, but callers elsewhere
may need two; Jarvis says up front that he is an assistant taking a
message.

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
