/// <reference lib="webworker" />

// OpenSCAD, compiled to WebAssembly, running off the main thread so a
// compile never freezes the console. The module (~11 MB, WebAssembly
// inlined) loads with this worker, which only starts the first time
// something asks for OpenSCAD.
//
// One OpenSCAD instance serves exactly one compile - its runtime exits
// after main() - so each request builds a fresh one.

import { createOpenSCAD } from "openscad-wasm-prebuilt"

import { JARVIS_SCAD } from "@/lib/workshop/jarvis-scad"

export interface ScadRequest {
  id: number
  code: string
}

export type ScadResponse =
  | { id: number; ok: true; stl: Uint8Array; log: string[] }
  | { id: number; ok: false; error: string; log: string[] }

self.onmessage = async (event: MessageEvent<ScadRequest>) => {
  const { id, code } = event.data
  const log: string[] = []
  try {
    const scad = await createOpenSCAD({ print: (line) => log.push(line), printErr: (line) => log.push(line) })
    const instance = scad.getInstance()
    instance.FS.writeFile("/jarvis.scad", JARVIS_SCAD)
    instance.FS.writeFile("/part.scad", code)
    // Manifold: fast (tens of milliseconds, not the seconds CGAL takes) and
    // always a closed, printable solid.
    let status = 1
    try {
      status = instance.callMain(["/part.scad", "--backend=manifold", "--export-format=binstl", "-o", "/part.stl"])
    } catch {
      status = 1
    }
    if (status !== 0) {
      const errors = log.filter((line) => /ERROR|WARNING/.test(line))
      const reply: ScadResponse = { id, ok: false, error: errors.join("\n") || "OpenSCAD could not compile this part.", log }
      self.postMessage(reply)
      return
    }
    const stl = instance.FS.readFile("/part.stl") as Uint8Array
    if (stl.byteLength <= 84) {
      self.postMessage({ id, ok: false, error: "The part compiled to nothing: no solid geometry.", log } satisfies ScadResponse)
      return
    }
    self.postMessage({ id, ok: true, stl, log } satisfies ScadResponse, [stl.buffer])
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err), log } satisfies ScadResponse)
  }
}
