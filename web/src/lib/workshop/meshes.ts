"use client"

import { fetchMeshBytes, uploadMesh, type MeshInfo } from "@/lib/jarvis-client"
import { simplifyModel, stlSize } from "@/lib/model-simplify"
import { getStoredToken } from "@/lib/storage"

// Meshes a printed part can import (app/services/workshop_meshes.py): an STL
// Andrew has - a downloaded helmet, Dum-E's parts - uploaded once, simplified
// first, and brought into OpenSCAD with import("mesh/<name>.stl") so the
// real shell is what prints, with the electronics' cut-outs and mounts
// added in code. Fetched meshes are kept for the session, and in this
// browser's IndexedDB so a reload does not fetch them again.

const MESH_IMPORT = /import\s*\(\s*"mesh\/([a-z0-9][a-z0-9-]{0,47})\.stl"\s*\)/g

/** The mesh names an OpenSCAD program imports. */
export function meshesIn(code: string): string[] {
  return [...new Set([...code.matchAll(MESH_IMPORT)].map((m) => m[1]))]
}

/** A file's name as a mesh name: lowercase, dashes. */
export function meshName(fileName: string): string {
  return (
    fileName
      .replace(/\.(stl|3mf)$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "mesh"
  )
}

// --- the browser's copy ----------------------------------------------------------

function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("jarvis-meshes", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("meshes")
    open.onsuccess = () => resolve(open.result.transaction("meshes", mode).objectStore("meshes"))
    open.onerror = () => reject(open.error)
  })
}

async function cached(name: string): Promise<ArrayBuffer | null> {
  try {
    const objects = await store("readonly")
    return await new Promise((resolve) => {
      const req = objects.get(name)
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function keep(name: string, data: ArrayBuffer | null) {
  try {
    const objects = await store("readwrite")
    if (data) objects.put(data, name)
    else objects.delete(name)
  } catch {
    // Not kept: it is fetched again next time.
  }
}

const session = new Map<string, Promise<Uint8Array>>()

/** A mesh's bytes, from this session, this browser, or the server. */
export function loadMesh(name: string): Promise<Uint8Array> {
  let entry = session.get(name)
  if (!entry) {
    entry = (async () => {
      const local = await cached(name)
      if (local) return new Uint8Array(local)
      const token = getStoredToken()
      if (!token) throw new Error(`Mesh ${name}: not signed in.`)
      const data = await fetchMeshBytes(name, token).catch(() => {
        throw new Error(`Mesh ${name} is not uploaded (Workshop > Meshes).`)
      })
      void keep(name, data)
      return new Uint8Array(data)
    })()
    session.set(name, entry)
    entry.catch(() => session.delete(name))
  }
  return entry
}

/** Simplify and upload a file as a mesh; replaces one of the same name. */
export async function addMesh(file: File, name: string, token: string, onProgress?: (text: string) => void): Promise<MeshInfo> {
  const simple = await simplifyModel(file, onProgress)
  onProgress?.("Uploading")
  const size = stlSize(simple.data)
  const result = await uploadMesh(name, simple.data, size, file.name, token)
  if (!result.ok || !result.mesh) throw new Error(result.error ?? "Could not upload it.")
  session.delete(name)
  await keep(name, simple.data)
  return result.mesh
}

export async function forgetMesh(name: string) {
  session.delete(name)
  await keep(name, null)
}
