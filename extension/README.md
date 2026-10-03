# J.A.R.V.I.S. browser extension

Lets Jarvis follow along in Chrome or Edge: read the page you're on, your
selected text and the box you're typing in, see your open tabs, and speak up
when he can help — in a bubble on the page, out loud. Version 1 is
read-only: he cannot click, type or navigate.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → choose this `extension` folder.
4. Pin the J.A.R.V.I.S. button to the toolbar.

After pulling changes to this folder, press the reload arrow on the
extension's card.

## Pair

Open your Jarvis console (signed in), click the toolbar button, then **Pair
with this console**. The extension gets its own token, which only opens the
browser link and Jarvis's voice and chat — not mail, files or anything else.
Unpair from the popup or from the console's Settings → Browser; either
revokes every extension token at once.

## Using it

- **Alt+J** opens the bubble on any page to ask Jarvis about it.
- With **Follow along** on, Jarvis looks again when a page settles after real
  change (a new page, new text, a paragraph you've written, a selection) —
  at most every 30 seconds and 60 times an hour — and speaks only when it's
  worth it. **Quiet / Normal / Coach** set how readily.
- In the bubble: **Not now** silences remarks for 15 minutes; **Not on this
  site** blocks the site for good.

## Privacy

Checked in the browser, before anything leaves it:

- Never read: banking & payments, email, and health & insurance sites (each
  category can be switched off in the popup), sites you block, incognito
  windows (the extension doesn't run there), and password, card and similar
  fields on any page.
- **Pause** (15 min, 1 hour, or until you resume) stops everything.
- Only the page in front of you is sent as you work; another tab is read
  only when Jarvis is asked about it. Page text is held in the server's
  memory, never stored, and gone on restart.

## How it works

`background.js` keeps a WebSocket to `/browser/ws` (app/api/routes/browser.py)
and is the only part that talks to Jarvis. `content.js` reads a page when
asked, pings when it settles, and draws the bubble. `offscreen.js` plays the
voice. `blocklist.js` decides what's private. Jarvis reads it all through his
`browser` tool (app/tools/browser.py); remarks are judged by
app/services/browser_watch.py.

Known limits: Google Docs draws its text on a canvas, so its document body
isn't readable this way; PDFs in the browser's viewer and the Chrome Web
Store can't be read by any extension.
