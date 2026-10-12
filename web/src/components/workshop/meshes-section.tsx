"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react"

import { deleteMesh, listMeshes, type MeshInfo } from "@/lib/jarvis-client"
import { useLock } from "@/lib/lock-state"

// The unlock token (past the face or PIN scan): the one the API accepts. The
// Google session token only opens the lock - sent to the API it gets 423,
// which locks the console.
const apiToken = () => useLock.getState().unlock?.token ?? null
import { addMesh, forgetMesh, meshName } from "@/lib/workshop/meshes"

// The workshop's meshes (lib/workshop/meshes.ts): STLs or 3MFs Andrew has -
// a downloaded helmet, Dum-E's parts - uploaded once (simplified first) to
// his private storage, and imported by printed parts with
// import("mesh/<name>.stl"). Several files at once are fine: each becomes
// a mesh named after its file.
export function MeshesSection() {
  const [meshes, setMeshes] = useState<MeshInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const fetchList = () => {
    const token = apiToken()
    return token ? listMeshes(token).catch(() => null) : Promise.resolve(null)
  }
  const show = (result: Awaited<ReturnType<typeof listMeshes>> | null) => {
    if (result?.ok) setMeshes(result.meshes ?? [])
    else setError(result?.error ?? "Could not list the meshes.")
  }
  const refresh = async () => show(await fetchList())

  useEffect(() => {
    let alive = true
    void fetchList().then((result) => alive && show(result))
    return () => {
      alive = false
    }
  }, [])

  async function upload(files: FileList | null) {
    const token = apiToken()
    if (!files?.length || !token) return
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const name = meshName(file.name)
        await addMesh(file, name, token, (text) => setBusy(`${name}: ${text}`))
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload it.")
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ""
    }
  }

  async function remove(name: string) {
    const token = apiToken()
    if (!token) return
    await deleteMesh(name, token)
    await forgetMesh(name)
    await refresh()
  }

  return (
    <section style={{ marginBottom: 10, border: "1px solid rgba(var(--accent-rgb), 0.18)", padding: "4px 8px 6px" }}>
      <div className="flex items-center justify-between">
        <h3 className="t-label" style={{ margin: "var(--sp-2) 0 6px", color: "var(--accent)", letterSpacing: "0.12em" }}>
          MESHES
        </h3>
        <button type="button" className="btn flex items-center" style={{ gap: 4, padding: "2px 8px" }} disabled={!!busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2Icon size={11} className="animate-spin" /> : <UploadIcon size={11} />} STL / 3MF
        </button>
        <input ref={input} type="file" accept=".stl,.3mf" multiple hidden onChange={(event) => void upload(event.target.files)} />
      </div>
      {busy && <p className="t-time" style={{ margin: "2px 0" }}>{busy}...</p>}
      {error && <p className="t-time" style={{ margin: "2px 0", color: "var(--accent)" }}>{error}</p>}
      {meshes?.length === 0 && !busy && (
        <p className="t-time" style={{ margin: "2px 0" }}>None yet. Upload a shell you have; printed parts import it as mesh/&lt;name&gt;.stl.</p>
      )}
      {meshes?.map((m) => (
        <div key={m.name} className="flex items-center" style={{ gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(var(--accent-rgb), 0.08)" }}>
          <span className="min-w-0 flex-1">
            <span className="wrap-words" style={{ color: "var(--text-primary)" }}>mesh/{m.name}.stl</span>
            <span className="t-time" style={{ display: "block" }}>
              {m.size_mm.map((v) => v.toFixed(0)).join(" × ")} mm · {m.triangles.toLocaleString()} triangles
            </span>
          </span>
          <button type="button" className="btn shrink-0" style={{ width: 22, height: 22, padding: 0 }} title="Delete this mesh" aria-label={`Delete ${m.name}`} onClick={() => void remove(m.name)}>
            <Trash2Icon size={11} className="mx-auto" />
          </button>
        </div>
      ))}
    </section>
  )
}
