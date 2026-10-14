// Run in the browser console on a wallpaper opened with ?capture, while
// `python wallpapers/render.py serve` is running: draws every frame of one
// period at full size and posts it to the renderer. Resolves to the count.
//   await capture("lock")            // all frames
//   await capture("lock", [0, 120])  // just these, for a look
//   await capture("gx", null, "image/jpeg")  // JPEG frames: far faster for long loops
async function capture(name, only, type = "image/png") {
  const { period, frame } = window.WALL
  const fps = 30
  const total = Math.round(period * fps)
  const canvas = document.querySelector("canvas")
  const indices = only ?? [...Array(total).keys()]
  for (const i of indices) {
    frame(i / fps)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95))
    await fetch(`/frame/${name}/${i}`, { method: "POST", body: blob, headers: { "Content-Type": type } })
  }
  return indices.length
}
