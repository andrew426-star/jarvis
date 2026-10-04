// Jarvis's service worker: notifications only (web/src/lib/push.ts). It
// has no fetch handler and caches nothing, on purpose: the console is
// served no-cache so every load is the latest deploy, and a caching worker
// would quietly undo that.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "J.A.R.V.I.S."
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || undefined,
        // A newer push for the same tag replaces the old one, and still buzzes.
        renotify: Boolean(data.tag),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: data.url || "/?inbox=1" },
      }),
      // An open console refreshes its inbox straight away.
      self.clients.matchAll({ type: "window" }).then((clients) =>
        clients.forEach((client) => client.postMessage({ type: "jarvis-inbox" }))
      ),
    ])
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/?inbox=1"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        open.postMessage({ type: "jarvis-open-inbox" })
        return open.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
