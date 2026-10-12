"use client"

import type { ModelResponse } from "@/lib/model-simplify.worker"

// An STL or 3MF Andrew picks, read and simplified off the main thread
// (model-simplify.worker.ts) into a binary STL of at most a few hundred
// thousand triangles - for Ultron's head (ultron-model.ts) and for the
// workshop's meshes (workshop/meshes.ts).

export interface Simplified {
  data: ArrayBuffer
  triangles: number
  original: number
}

export async function simplifyModel(file: File, onProgress?: (text: string) => void): Promise<Simplified> {
  if (!/\.(stl|3mf)$/i.test(file.name)) throw new Error("That is not an STL or 3MF file.")
  const data = await file.arrayBuffer()
  const worker = new Worker(new URL("./model-simplify.worker.ts", import.meta.url), { type: "module" })
  try {
    return await new Promise<Simplified>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ModelResponse>) => {
        const message = event.data
        if (message.kind === "progress") onProgress?.(message.text)
        else if (message.kind === "done") resolve(message)
        else reject(new Error(message.error))
      }
      worker.onerror = () => reject(new Error("Could not read that model."))
      worker.postMessage({ name: file.name, data }, [data])
    })
  } finally {
    worker.terminate()
  }
}

/** A binary STL's size along x, y and z, in its own units (mm). */
export function stlSize(data: ArrayBuffer): [number, number, number] {
  const view = new DataView(data)
  const count = view.getUint32(80, true)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let t = 0; t < count; t += 1) {
    for (let v = 0; v < 3; v += 1) {
      for (let k = 0; k < 3; k += 1) {
        const value = view.getFloat32(84 + t * 50 + 12 + v * 12 + k * 4, true)
        if (value < min[k]) min[k] = value
        if (value > max[k]) max[k] = value
      }
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}
