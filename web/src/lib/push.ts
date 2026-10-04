"use client"

import { removePushSubscription, savePushSubscription } from "@/lib/jarvis-client"

// Notifications on this device: a service worker (public/sw.js) and a
// Web Push subscription the server sends to (app/services/push.py). On an
// iPhone, push only exists for the home-screen app (iOS 16.4+), so in
// Safari itself this reports "needs-install". Switching on has to come
// from a tap: browsers only show the permission prompt for a gesture.

export type PushStatus = "unsupported" | "needs-install" | "unconfigured" | "denied" | "off" | "on"

const WORKER = "/sw.js"

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function deviceName(): string {
  const standalone = window.matchMedia("(display-mode: standalone)").matches
  if (isIos()) return standalone ? "iPhone app" : "iPhone Safari"
  if (/Android/.test(navigator.userAgent)) return "Android"
  return /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : "Browser"
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration(WORKER)) ?? navigator.serviceWorker.register(WORKER)
}

/** Where this device stands. `serverKey` is null when the server has no
 *  VAPID keys, in which case nothing here can be switched on. */
export async function pushStatus(serverKey: string | null): Promise<PushStatus> {
  if (!("serviceWorker" in navigator)) return "unsupported"
  if (!("PushManager" in window)) return isIos() ? "needs-install" : "unsupported"
  if (!serverKey) return "unconfigured"
  if (Notification.permission === "denied") return "denied"
  const reg = await navigator.serviceWorker.getRegistration(WORKER)
  const sub = await reg?.pushManager.getSubscription()
  return sub ? "on" : "off"
}

/** Asks permission (call from a tap), subscribes, and tells the server. */
export async function enablePush(token: string, serverKey: string): Promise<PushStatus> {
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return permission === "denied" ? "denied" : "off"
  const reg = await registration()
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  // A subscription made under an older key cannot receive this server's pushes.
  const current = sub?.options.applicationServerKey
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(serverKey)))) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(serverKey) })
  await savePushSubscription(sub.toJSON(), deviceName(), token)
  return "on"
}

export async function disablePush(token: string): Promise<PushStatus> {
  const reg = await navigator.serviceWorker.getRegistration(WORKER)
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await removePushSubscription(sub.endpoint, token).catch(() => {})
    await sub.unsubscribe()
  }
  return "off"
}

/** Messages from the worker: a push arrived, or a notification was tapped. */
export function onWorkerMessage(handler: (type: string) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {}
  const listener = (event: MessageEvent) => {
    const type = (event.data as { type?: string } | null)?.type
    if (type) handler(type)
  }
  navigator.serviceWorker.addEventListener("message", listener)
  // Keeps the worker installed and current on every visit, so a push can
  // be delivered even before this device has switched notifications on.
  if ("PushManager" in window) void registration().catch(() => {})
  return () => navigator.serviceWorker.removeEventListener("message", listener)
}
