"use client"

// Andrew's own model of Ultron's head (an STL or 3MF), used in place of the
// built-in one (lib/ultron-face.ts) when he loads it in Settings >
// Appearance. It is kept in this browser's IndexedDB and never uploaded:
// the file is his, and it stays on his machine.

import { simplifyModel } from "@/lib/model-simplify"

export type UpAxis = "z" | "y"

export interface UltronModel {
  name: string
  /** The model as a binary STL, already simplified. */
  data: ArrayBuffer
  triangles?: number
  /** Which axis is up in the file: Z for most printing models, Y for most others. */
  up: UpAxis
  /** Degrees turned about the vertical, so the face looks out of the screen. */
  turn: number
}

const DB = "jarvis-ultron"
const STORE = "model"
const KEY = "head"
const EVENT = "ultron-model"

function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onsuccess = () => resolve(open.result.transaction(STORE, mode).objectStore(STORE))
    open.onerror = () => reject(open.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadUltronModel(): Promise<UltronModel | null> {
  try {
    return ((await request((await store("readonly")).get(KEY))) as UltronModel | undefined) ?? null
  } catch {
    return null
  }
}

async function put(model: UltronModel | null) {
  const objects = await store("readwrite")
  if (model) await request(objects.put(model, KEY))
  else await request(objects.delete(KEY))
  window.dispatchEvent(new Event(EVENT))
}

/** Reads an STL or 3MF, simplifies it (model-simplify.ts) and keeps it.
 *  Resolves with its triangle count. */
export async function saveUltronModel(file: File, onProgress?: (text: string) => void): Promise<number> {
  const result = await simplifyModel(file, onProgress)
  await put({ name: file.name, data: result.data, up: "z", turn: 0, triangles: result.triangles })
  return result.triangles
}

export async function orientUltronModel(change: Partial<Pick<UltronModel, "up" | "turn">>): Promise<void> {
  const current = await loadUltronModel()
  if (current) await put({ ...current, ...change })
}

export async function clearUltronModel(): Promise<void> {
  await put(null)
}

/** Called whenever the model is loaded, re-oriented or removed. */
export function onUltronModelChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
