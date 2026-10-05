"use client"

import * as THREE from "three"

import type { DepthRequest, DepthResponse } from "@/lib/ar/depth.worker"

// The scene's depth, frame after frame, from the depth model in its worker
// (depth.worker.ts): what is near and far in the camera's picture, for the
// try-on to hide holograms behind real things and to set objects on real
// surfaces.
//
// The model only knows depth up to scale - "this is twice as near as
// that" - so it is put into centimetres against a point whose true
// distance the trackers know: the gap between his eyes, or his hand. The
// map holds inverse depth, so distance = k / value, with k refitted on
// every new map from the latest such point.

export interface DepthReference {
  /** Where the point is in the (unmirrored) picture, 0-1. */
  u: number
  v: number
  /** Its true distance from the camera, cm. */
  cm: number
}

export class DepthField {
  private worker: Worker | null = null
  private data: Float32Array | null = null
  private width = 0
  private height = 0
  private k = 0
  private reference: DepthReference | null = null
  private referenceAt = 0
  private stopped = false
  /** For the occlusion pass: the map as a float texture, refreshed in place. */
  texture: THREE.DataTexture | null = null
  /** Depth maps per second, recently. */
  rate = 0
  private lastMap = 0

  constructor(
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onStatus: (text: string, ready: boolean, error?: boolean) => void
  ) {}

  start() {
    this.stopped = false
    this.onStatus("LOADING DEPTH MODEL", false)
    this.worker = new Worker(new URL("./depth.worker.ts", import.meta.url), { type: "module" })
    this.worker.onmessage = (event: MessageEvent<DepthResponse>) => this.receive(event.data)
  }

  stop() {
    this.stopped = true
    this.worker?.terminate()
    this.worker = null
    this.data = null
    this.texture?.dispose()
    this.texture = null
  }

  /** A point whose true distance is known: what the map is scaled by. */
  setReference(reference: DepthReference | null) {
    if (!reference) return
    this.reference = reference
    this.referenceAt = performance.now()
  }

  get ready() {
    return !!this.data && this.k > 0
  }

  get scale() {
    return this.k
  }

  private async send() {
    const video = this.getVideo()
    if (this.stopped || !this.worker) return
    if (!video || !video.videoWidth) {
      setTimeout(() => void this.send(), 200)
      return
    }
    try {
      const bitmap = await createImageBitmap(video)
      this.worker.postMessage({ kind: "frame", bitmap } satisfies DepthRequest, [bitmap])
    } catch {
      setTimeout(() => void this.send(), 200)
    }
  }

  private receive(message: DepthResponse) {
    if (this.stopped) return
    if (message.kind === "progress") this.onStatus(message.text, false)
    else if (message.kind === "error") this.onStatus(`DEPTH FAILED: ${message.error}`, false, true)
    else if (message.kind === "ready") {
      this.onStatus(`DEPTH ON · ${message.device === "webgpu" ? "GPU" : "CPU"}`, true)
      void this.send()
    } else if (message.kind === "depth") {
      this.data = message.data
      this.width = message.width
      this.height = message.height
      const now = performance.now()
      if (this.lastMap) this.rate = this.rate * 0.7 + (1000 / (now - this.lastMap)) * 0.3
      this.lastMap = now
      this.calibrate()
      this.upload()
      // The next frame as soon as this one is done: as fast as the model goes.
      void this.send()
    }
  }

  /** Raw map value around a point (median of a small patch, which shrugs
   *  off the odd bad pixel at an edge). */
  private raw(u: number, v: number): number {
    if (!this.data) return 0
    const cx = Math.round(u * (this.width - 1))
    const cy = Math.round(v * (this.height - 1))
    const values: number[] = []
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = Math.min(this.width - 1, Math.max(0, cx + dx))
        const y = Math.min(this.height - 1, Math.max(0, cy + dy))
        values.push(this.data[y * this.width + x])
      }
    }
    values.sort((a, b) => a - b)
    return values[12]
  }

  private calibrate() {
    const ref = this.reference
    // A reference over two seconds old has probably moved; keep the scale.
    if (!ref || performance.now() - this.referenceAt > 2000) {
      // Never calibrated: assume the middle of the picture is about 60 cm away.
      if (!this.k) this.k = 60 * this.raw(0.5, 0.5)
      return
    }
    const value = this.raw(ref.u, ref.v)
    if (value <= 0) return
    const k = ref.cm * value
    this.k = this.k ? this.k * 0.6 + k * 0.4 : k
  }

  private upload() {
    if (!this.data) return
    if (!this.texture || this.texture.image.width !== this.width || this.texture.image.height !== this.height) {
      this.texture?.dispose()
      this.texture = new THREE.DataTexture(new Float32Array(this.width * this.height), this.width, this.height, THREE.RedFormat, THREE.FloatType)
      this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    }
    ;(this.texture.image.data as Float32Array).set(this.data)
    this.texture.needsUpdate = true
  }

  /** Distance to whatever is at a point of the picture, cm (null before
   *  the first map). */
  distance(u: number, v: number): number | null {
    if (!this.ready) return null
    const value = this.raw(u, v)
    return value > 0 ? this.k / value : null
  }
}
