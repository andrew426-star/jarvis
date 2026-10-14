# Wallpapers

Three live wallpapers, Jarvis and Kivaro AI together. Jarvis brings the
console's cyan, the sphere core, the HUD rings and the hex grid. Kivaro
brings its green and lime, the three-cube mark, and its site's scanline
dissolve. Type is JetBrains Mono, Kivaro's mono face.

| | Size | Loop | What moves |
|---|---|---|---|
| **Standby** (`lock/`) — lock screen | 1290 × 2796 | 8 s | The core turns, rings counter-rotate, and the Kivaro cubes breathe and ripple at its heart. The top third stays dark for the iOS clock. |
| **Signal** (`home/`) — home screen | 1290 × 2796 | 10 s | Kivaro's mark, ghosted in scanlines, streams off to the right. Two tide lines, cyan and green, roll low on the screen. Dim, so icons read on top. |
| **Command** (`command/`) — desktop | 2560 × 1440, any size live | 12 s | A launch HUD: the clock, the countdown to January 12, 2027, where the plan stands, and the six segments running along the bottom. |

Every motion repeats a whole number of times per loop, so the videos loop
with no seam. Command is live only as a web wallpaper. In the video, the
clock, countdown and today's marker give way to fixed labels, so it never
shows a stale number.

## Blueprint: the Chrome new tab

`newtab/` is a Chrome extension that makes every new tab a holographic
blueprint. On a navy drafting sheet (grid, frame and zone marks), three
engineering plates draw themselves the way a draughtsman would: dashed
construction lines first, then outlines, hidden edges, dimensions and
callouts, with a lit pen tip at the head of the line. Each plate holds,
glitches out, and the next one draws:

- **KIV-001:** Kivaro's mark as an exploded isometric, with its face
  plates in green, its seams and spacing dimensioned.
- **KIV-002:** a reactor core in front elevation, with section A-A hatched
  beside it.
- **KIV-003:** Jarvis's sphere core in front and top views, on its
  15-degree grid.

A clock, a search box (it uses your default search engine) and the launch
countdown sit above the drawing. A title block in the corner names the
plate. Each new tab starts on a different plate. With "reduce motion" on
in your system settings, the plates show fully drawn and change once a
minute.

To install: open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and pick the `wallpapers/newtab` folder. Chrome asks
once whether to keep the changed new-tab page; keep it. It works in Edge
and Brave the same way (`edge://extensions`, `brave://extensions`).

To preview a single plate without installing, serve the folder
(`python wallpapers/render.py serve`) and open
`http://localhost:8777/newtab/newtab.html?plate=1&t=18`. `plate` is 0-2,
and `t` is the number of seconds into the plate's 23.6-second cycle.

## Putting them on

**iPhone, lock screen (Standby).** iOS takes motion on the lock screen
only as a Live Photo (iOS 17+). Convert `out/lock.mp4` to a Live Photo
with a converter app (intoLive, or any "video to Live Photo" app). Then
go to Settings → Wallpaper → Add New → Photos, pick it, and make sure Live
Photo is on. iOS plays roughly the first few seconds when the phone wakes.

**iPhone, home screen (Signal).** iOS does not animate the home screen.
Use the still `out/home.png` there; it is the same design, at rest. Pair
it with Standby: when iOS offers "Set as Wallpaper Pair", choose Customize
Home Screen → Photos → `home.png`.

**Android.** Use a video wallpaper app with `out/lock.mp4` or
`out/home.mp4`, or a web wallpaper app with `out/home.html` /
`out/lock.html`, which run live.

**Windows (Command).** Install Lively Wallpaper (free, Microsoft Store),
then Add Wallpaper → choose `out/command.html`. It runs live, with the
real clock and countdown. `out/command.mp4` works in any video wallpaper
app, and on macOS.

## Rebuilding

```
pip install imageio-ffmpeg
python wallpapers/render.py serve
```

Open `http://localhost:8777/<name>/index.html?capture` in a browser, paste
`capture.js` into the console, and run `await capture("<name>")`. Then:

```
python wallpapers/render.py encode <name>
python wallpapers/render.py bundle
```

`out/` is not committed. Open any `index.html` through the server (not
from disk) to see a design live at your screen's size.

JetBrains Mono is under the SIL Open Font License.
