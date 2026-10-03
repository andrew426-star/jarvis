"use client"

import { create } from "zustand"

import { getFilesManifest, syncFiles, unlinkFolderFiles } from "@/lib/jarvis-client"

// Folders on Andrew's PC that Jarvis can read (his CSC 1013 projects).
// Jarvis's backend is in the cloud and cannot see the disk, so the console
// does the reading: Chrome and Edge let a page read a folder the user picks
// (the File System Access API), and while the console is open this keeps a
// copy of the folder's code and text files in Jarvis's database
// (POST /files/sync), which his files tool reads (app/tools/files.py).
// Read-only throughout: nothing here can write to the disk.
//
// The folder handles live in IndexedDB, so a link survives reloads. The
// browser may still ask once per visit before reading again (Chrome offers
// "allow on every visit"), which is the "needs permission" state below.

const SYNC_EVERY_MS = 20_000
// What is worth reading. Code and text, not binaries or build output.
const EXTENSIONS = new Set([
  "py", "pyw", "ipynb", "txt", "md", "csv", "tsv", "json", "yaml", "yml", "toml", "ini", "cfg",
  "java", "c", "h", "cpp", "hpp", "cs", "js", "ts", "jsx", "tsx", "html", "css", "sql", "r", "m",
  "tex", "sh", "bat", "ps1", "xml",
])
const SKIP_DIRS = new Set([
  ".git", "__pycache__", ".venv", "venv", "env", "node_modules", ".idea", ".vscode", "dist", "build",
  ".ipynb_checkpoints", ".mypy_cache", ".pytest_cache",
])
const MAX_FILE_BYTES = 300_000
const MAX_FILES = 2000
// Per request, so one sync is a few modest POSTs rather than one huge one.
const BATCH_CHARS = 800_000

export type FolderStatus = "syncing" | "synced" | "needs-permission" | "error"

export interface LinkedFolder {
  name: string
  status: FolderStatus
  files: number
  lastSync: number | null
  error?: string
}

interface LinkedFoldersState {
  folders: LinkedFolder[]
  supported: boolean
  set: (name: string, change: Partial<LinkedFolder>) => void
  remove: (name: string) => void
}

export const useLinkedFolders = create<LinkedFoldersState>((set, get) => ({
  folders: [],
  supported: typeof window !== "undefined" && "showDirectoryPicker" in window,
  set: (name, change) => {
    const existing = get().folders.find((f) => f.name === name)
    set({
      folders: existing
        ? get().folders.map((f) => (f.name === name ? { ...f, ...change } : f))
        : [...get().folders, { name, status: "syncing", files: 0, lastSync: null, ...change }],
    })
  },
  remove: (name) => set({ folders: get().folders.filter((f) => f.name !== name) }),
}))

// --- The parts of the File System Access API the DOM typings lack. ---

type Mode = { mode: "read" }
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor: Mode): Promise<PermissionState>
  requestPermission(descriptor: Mode): Promise<PermissionState>
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>
}
type PickerWindow = Window & { showDirectoryPicker(options: { mode: "read"; id?: string }): Promise<DirHandle> }

// --- Handles, kept in IndexedDB. ---

function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("jarvis-files", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("folders")
    open.onsuccess = () => resolve(open.result.transaction("folders", mode).objectStore("folders"))
    open.onerror = () => reject(open.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function savedHandles(): Promise<DirHandle[]> {
  try {
    return (await request((await store("readonly")).getAll())) as DirHandle[]
  } catch {
    return []
  }
}

// --- Reading a folder. ---

interface Entry {
  path: string
  handle: FileSystemFileHandle
}

async function walk(dir: DirHandle, prefix = "", out: Entry[] = []): Promise<Entry[]> {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) break
    if (entry.kind === "directory") {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await walk(entry as DirHandle, `${prefix}${entry.name}/`, out)
      }
    } else {
      const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : ""
      if (EXTENSIONS.has(ext)) out.push({ path: prefix + entry.name, handle: entry as FileSystemFileHandle })
    }
  }
  return out
}

// A notebook's JSON is mostly outputs and metadata; Jarvis wants the cells.
function notebookText(raw: string): string {
  try {
    const notebook = JSON.parse(raw) as { cells?: { cell_type: string; source: string | string[] }[] }
    return (notebook.cells ?? [])
      .map((cell) => {
        const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source
        return `# %% [${cell.cell_type}]\n${source}`
      })
      .join("\n\n")
  } catch {
    return raw
  }
}

const running = new Set<string>()

async function syncFolder(dir: DirHandle, token: string, known: Map<string, Map<string, number>>) {
  const name = dir.name
  if (running.has(name)) return
  if ((await dir.queryPermission({ mode: "read" })) !== "granted") {
    useLinkedFolders.getState().set(name, { status: "needs-permission" })
    return
  }
  running.add(name)
  const folders = useLinkedFolders.getState()
  try {
    // What Jarvis already has, once per page load; after that, what this
    // page last sent.
    let manifest = known.get(name)
    if (!manifest) {
      const server = await getFilesManifest(name, token)
      manifest = new Map(Object.entries(server).map(([path, at]) => [path, Date.parse(at)]))
      known.set(name, manifest)
    }

    const entries = await walk(dir)
    const changed: { path: string; content: string; size: number; modified_at: string }[] = []
    for (const { path, handle } of entries) {
      const file = await handle.getFile()
      if (file.size > MAX_FILE_BYTES || manifest.get(path) === file.lastModified) continue
      if (changed.length === 0) folders.set(name, { status: "syncing" })
      const raw = await file.text()
      changed.push({
        path,
        content: path.endsWith(".ipynb") ? notebookText(raw) : raw,
        size: file.size,
        modified_at: new Date(file.lastModified).toISOString(),
      })
      manifest.set(path, file.lastModified)
    }
    const present = entries.map((e) => e.path)
    const removed = [...manifest.keys()].some((path) => !present.includes(path))

    if (changed.length || removed) {
      // Batches by size; the last one carries every path still on disk,
      // so files deleted since last time are dropped from Jarvis's copy.
      let batch: typeof changed = []
      let chars = 0
      for (const file of changed) {
        if (batch.length && chars + file.content.length > BATCH_CHARS) {
          await syncFiles(name, batch, null, token)
          batch = []
          chars = 0
        }
        batch.push(file)
        chars += file.content.length
      }
      await syncFiles(name, batch, present, token)
      for (const path of [...manifest.keys()]) if (!present.includes(path)) manifest.delete(path)
    }
    folders.set(name, { status: "synced", files: present.length, lastSync: Date.now(), error: undefined })
  } catch (err) {
    // The next round tries again from what the server has.
    known.delete(name)
    folders.set(name, { status: "error", error: err instanceof Error ? err.message : "Sync failed." })
  } finally {
    running.delete(name)
  }
}

// --- What the console and Settings call. ---

let session: { token: string; known: Map<string, Map<string, number>>; timer: ReturnType<typeof setInterval> } | null =
  null

async function syncAll() {
  if (!session) return
  const { token, known } = session
  for (const dir of await savedHandles()) await syncFolder(dir, token, known)
}

/** From the console's mount: syncs now and every SYNC_EVERY_MS. */
export function startFolderSync(token: string): () => void {
  if (!useLinkedFolders.getState().supported) return () => {}
  session = { token, known: new Map(), timer: setInterval(() => void syncAll(), SYNC_EVERY_MS) }
  void syncAll()
  return () => {
    if (session) clearInterval(session.timer)
    session = null
  }
}

/** Pick a folder and link it. Must run from a click. */
export async function linkFolder(): Promise<string | null> {
  let dir: DirHandle
  try {
    dir = await (window as unknown as PickerWindow).showDirectoryPicker({ mode: "read", id: "jarvis-files" })
  } catch {
    return null // cancelled
  }
  await request((await store("readwrite")).put(dir, dir.name))
  useLinkedFolders.getState().set(dir.name, { status: "syncing" })
  if (session) await syncFolder(dir, session.token, session.known)
  return dir.name
}

/** Ask again for a folder the browser wants re-approved. Must run from a click. */
export async function reconnectFolder(name: string) {
  const dir = (await savedHandles()).find((d) => d.name === name)
  if (!dir) return
  if ((await dir.requestPermission({ mode: "read" })) === "granted" && session) {
    await syncFolder(dir, session.token, session.known)
  }
}

export async function syncFolderNow(name: string) {
  const dir = (await savedHandles()).find((d) => d.name === name)
  if (dir && session) await syncFolder(dir, session.token, session.known)
}

/** Forget the folder here and delete Jarvis's copy of it. */
export async function unlinkFolder(name: string, token: string) {
  await request((await store("readwrite")).delete(name))
  session?.known.delete(name)
  useLinkedFolders.getState().remove(name)
  await unlinkFolderFiles(name, token)
}

/** Linked folders as the console starts, before any sync has run. */
export async function loadLinkedFolders() {
  for (const dir of await savedHandles()) {
    if (!useLinkedFolders.getState().folders.some((f) => f.name === dir.name)) {
      useLinkedFolders.getState().set(dir.name, { status: "syncing" })
    }
  }
}
