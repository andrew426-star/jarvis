"use client"

import * as THREE from "three"

// The try-on lit by the room it is shown in. Twice a second the camera's
// own picture becomes the scene's environment - blurred, mirrored into a
// seamless panorama, run through PMREM - so metal and gloss reflect the
// room's real colours, not a studio's; and its brightness and colour,
// above and below, set the sky and ground light and the key light, so a
// model in a dim, warm room is dim and warm too.

const PANO_W = 256
const PANO_H = 128
const EVERY_MS = 500

export class CameraLighting {
  private readonly pano = document.createElement("canvas")
  private readonly sample = document.createElement("canvas")
  private readonly texture: THREE.CanvasTexture
  private readonly pmrem: THREE.PMREMGenerator
  private target: THREE.WebGLRenderTarget | null = null
  private last = -Infinity
  /** Overall brightness of the room, 0-1. */
  level = 0.5

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly sky: THREE.HemisphereLight,
    private readonly key: THREE.DirectionalLight
  ) {
    this.pano.width = PANO_W
    this.pano.height = PANO_H
    this.sample.width = 8
    this.sample.height = 4
    this.texture = new THREE.CanvasTexture(this.pano)
    this.texture.mapping = THREE.EquirectangularReflectionMapping
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.pmrem = new THREE.PMREMGenerator(renderer)
  }

  update(video: HTMLVideoElement, now: number) {
    if (now - this.last < EVERY_MS || !video.videoWidth) return
    this.last = now
    const ctx = this.pano.getContext("2d")!
    // The picture, and its mirror image beside it, so the panorama wraps
    // without a seam; blurred, as a reflection of a room mostly is.
    ctx.filter = "blur(6px)"
    ctx.drawImage(video, 0, 0, PANO_W / 2, PANO_H)
    ctx.save()
    ctx.translate(PANO_W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, PANO_W / 2, PANO_H)
    ctx.restore()
    ctx.filter = "none"
    this.texture.needsUpdate = true
    this.target = this.pmrem.fromEquirectangular(this.texture, this.target)
    this.scene.environment = this.target.texture

    const s = this.sample.getContext("2d", { willReadFrequently: true })!
    s.drawImage(video, 0, 0, 8, 4)
    const data = s.getImageData(0, 0, 8, 4).data
    const mean = (rows: number[]) => {
      const c = new THREE.Color(0, 0, 0)
      let n = 0
      for (const y of rows) {
        for (let x = 0; x < 8; x += 1) {
          const i = (y * 8 + x) * 4
          c.r += data[i] / 255
          c.g += data[i + 1] / 255
          c.b += data[i + 2] / 255
          n += 1
        }
      }
      return c.multiplyScalar(1 / n).convertSRGBToLinear()
    }
    const top = mean([0, 1])
    const bottom = mean([2, 3])
    const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    this.level += (Math.min(1, (luminance(top) + luminance(bottom)) * 1.6) - this.level) * 0.5

    // Light the colour of the room, never so far off white it looks dyed.
    const tint = (c: THREE.Color) => {
      const l = Math.max(luminance(c), 1e-3)
      return new THREE.Color(1, 1, 1).lerp(c.clone().multiplyScalar(1 / l), 0.35)
    }
    this.sky.color.copy(tint(top))
    this.sky.groundColor.copy(tint(bottom)).multiplyScalar(0.35)
    this.sky.intensity = 0.5 + this.level * 1.4
    this.key.color.copy(tint(top))
    this.key.intensity = 0.8 + this.level * 2
    this.scene.environmentIntensity = 0.45 + this.level * 0.9
  }

  dispose() {
    this.target?.dispose()
    this.pmrem.dispose()
    this.texture.dispose()
  }
}
