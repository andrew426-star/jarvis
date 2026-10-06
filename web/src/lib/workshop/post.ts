import * as THREE from "three"
import {
  BlendFunction,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing"
import { N8AOPostPass } from "n8ao"

import type { Visuals } from "@/lib/workshop/visuals"

// The stage's post-processing (pmndrs postprocessing), in HDR half-float
// buffers until the end:
//
//   render -> ambient occlusion (N8AO, half resolution) -> bloom on what
//   is selected only (hologram edges, lit LEDs, the pad's rings) + ACES
//   tone mapping + film grain + vignette -> a faint chromatic fringe ->
//   SMAA
//
// Each stage follows its Visuals flag; changing one rebuilds the passes
// (a few milliseconds, only when a switch is flipped). Bloom is selective
// so lit plastic and white insulation stay plastic - a threshold bloom
// turned every white wire into a glare.

export type PostFlags = Pick<Visuals, "ao" | "bloom" | "lens">

export class StagePost {
  readonly composer: EffectComposer
  readonly bloom: SelectiveBloomEffect
  private readonly render: RenderPass
  private readonly ao: N8AOPostPass
  private readonly tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
  private readonly grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN })
  private readonly vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 })
  private readonly fringe = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0007, 0.0005),
    radialModulation: true,
    modulationOffset: 0.35,
  })
  private readonly smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM })
  private flags: PostFlags | null = null

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.render = new RenderPass(scene, camera)
    this.ao = new N8AOPostPass(scene, camera, 1, 1)
    // Stage units are 100 mm: a 12 mm radius finds the creases between
    // parts without darkening open faces.
    Object.assign(this.ao.configuration, {
      aoRadius: 0.12,
      distanceFalloff: 0.6,
      intensity: 2.2,
      halfRes: true,
      depthAwareUpsampling: true,
      gammaCorrection: false,
      aoSamples: 12,
      denoiseSamples: 6,
      denoiseRadius: 8,
    })
    this.bloom = new SelectiveBloomEffect(scene, camera, {
      intensity: 1.6,
      luminanceThreshold: 0.05,
      luminanceSmoothing: 0.4,
      mipmapBlur: true,
      radius: 0.7,
    })
    this.bloom.ignoreBackground = true
    this.grain.blendMode.opacity.value = 0.06
  }

  /** Build the chain for these flags (no-op when nothing changed). */
  configure(flags: PostFlags) {
    if (this.flags && this.flags.ao === flags.ao && this.flags.bloom === flags.bloom && this.flags.lens === flags.lens) return
    this.flags = { ...flags }
    this.composer.removeAllPasses()
    this.composer.addPass(this.render)
    if (flags.ao) this.composer.addPass(this.ao)
    const main = [
      ...(flags.bloom ? [this.bloom] : []),
      this.tone,
      ...(flags.lens ? [this.grain, this.vignette] : []),
    ]
    this.composer.addPass(new EffectPass(this.camera, ...main))
    // Separate passes: both sample neighbouring pixels.
    if (flags.lens) this.composer.addPass(new EffectPass(this.camera, this.fringe))
    this.composer.addPass(new EffectPass(this.camera, this.smaa))
  }

  /** Light something with bloom (and keep it lit until unselected). */
  glow(object: THREE.Object3D, on = true) {
    if (on) this.bloom.selection.add(object)
    else this.bloom.selection.delete(object)
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height)
  }

  draw(dt: number) {
    this.composer.render(dt)
  }

  dispose() {
    this.composer.dispose()
  }
}
