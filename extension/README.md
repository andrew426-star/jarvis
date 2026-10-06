# J.A.R.V.I.S. browser extension

Lets Jarvis follow along in Chrome or Edge: read the page you're on, your
selected text and the box you're typing in, see your open tabs, and speak up
when he can help — in a bubble on the page, out loud — and act for you:
open pages, click, type, choose from lists, scroll, and switch or close tabs.

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

## Acting

Ask Jarvis to do something in the browser ("search Digi-Key for a 9g servo",
"fill in my name on this form", "open my Moodle lab 4 page") and he works it
step by step: he lists the page's buttons, links and fields, acts on one,
then reads what happened before the next.

- While he works, a **glowing cyan rim** surrounds the page, with a pill at
  the top saying what he is doing. **STOP** (or **Esc**) halts him for 45
  seconds.
- Anything with consequences (send, post, buy, pay, order, delete, submit
  a form, Enter outside a search box, closing one of your own tabs) turns
  the rim **amber**, outlines the control and waits for you to press
  **ALLOW**. No answer in 18 seconds counts as no.
- **Acts for you** in the popup: **Off** (read only), **Ask first** (you
  allow every click and keystroke), or **Auto** (the default: you allow
  only the consequential ones).
- He never types into password, card or similar fields, never acts on the
  private sites below, and his unattended rounds can only read.
- Clicks and keys are simulated in the page, so the odd site that only
  accepts real input won't respond; he'll see that nothing changed.

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
and is the only part that talks to Jarvis; it also runs tab actions (open,
back, switch, close), one at a time. `content.js` reads a page when asked,
pings when it settles, draws the bubble, and carries out page actions with
the rim and the ALLOW prompt. `offscreen.js` plays the
voice. `blocklist.js` decides what's private. Jarvis reads it all through his
`browser` tool (app/tools/browser.py); remarks are judged by
app/services/browser_watch.py.

Known limits: Google Docs draws its text on a canvas, so its document body
isn't readable this way; PDFs in the browser's viewer and the Chrome Web
Store can't be read by any extension.
