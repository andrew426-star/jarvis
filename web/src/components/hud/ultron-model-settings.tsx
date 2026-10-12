"use client"

import { useEffect, useRef, useState } from "react"

import {
  clearUltronModel,
  loadUltronModel,
  onUltronModelChange,
  orientUltronModel,
  saveUltronModel,
  type UltronModel,
} from "@/lib/ultron-model"

// Settings > Appearance: Andrew's own model of Ultron's head (STL or 3MF),
// shown in serious mode in place of the built one. It is simplified and kept
// in this browser (lib/ultron-model.ts); nothing is uploaded.
export function UltronModelSettings() {
  const [model, setModel] = useState<UltronModel | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const refresh = () => void loadUltronModel().then(setModel)
    refresh()
    return onUltronModelChange(refresh)
  }, [])

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    setBusy("Reading the model")
    try {
      await saveUltronModel(file, setBusy)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that model.")
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <>
      <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
        <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
          ULTRON HEAD
        </span>
        <div className="flex shrink-0" style={{ gap: "var(--sp-1)" }}>
          <button type="button" className="btn" style={{ padding: "4px 10px" }} disabled={!!busy} onClick={() => input.current?.click()}>
            {model ? "Replace" : "Load model"}
          </button>
          {model && !busy && (
            <button type="button" className="btn" style={{ padding: "4px 10px" }} onClick={() => void clearUltronModel()}>
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept=".stl,.3mf" hidden onChange={(event) => void pick(event.target.files?.[0])} />
      </div>
      <p className="wrap-words" style={{ fontSize: "11px", color: busy || error ? "var(--accent)" : "var(--text-secondary)", lineHeight: 1.4 }}>
        {busy
          ? `${busy}...`
          : error
            ? error
            : model
              ? `${model.name}${model.triangles ? ` · ${model.triangles.toLocaleString()} triangles` : ""}`
              : "The built-in head - or your mesh ultron-head from Workshop > Meshes, if you uploaded one. Load an STL or 3MF here to show a model in this browser instead."}
      </p>
      {model && !busy && (
        <div className="flex min-w-0 items-center justify-between" style={{ gap: "var(--sp-2)" }}>
          <span className="t-label truncate-1" style={{ color: "var(--text-secondary)" }}>
            ORIENTATION
          </span>
          <div className="flex shrink-0" style={{ gap: "var(--sp-1)" }}>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px" }}
              title="Which axis is up in the file"
              onClick={() => void orientUltronModel({ up: model.up === "z" ? "y" : "z" })}
            >
              {model.up.toUpperCase()} up
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px" }}
              title="Turn it until the face looks out of the screen"
              onClick={() => void orientUltronModel({ turn: (model.turn + 90) % 360 })}
            >
              Turn {model.turn}°
            </button>
          </div>
        </div>
      )}
      <p className="wrap-words" style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
        Shown in serious mode. The file stays in this browser and is never uploaded.
      </p>
    </>
  )
}
