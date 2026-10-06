// n8ao ships JavaScript only. The part of it the workshop uses
// (lib/workshop/post.ts): the ambient-occlusion pass for pmndrs
// postprocessing, and its live configuration.
declare module "n8ao" {
  import type { Camera, Color, Scene } from "three"
  import { Pass } from "postprocessing"

  export interface N8AOConfiguration {
    aoSamples: number
    aoRadius: number
    denoiseSamples: number
    denoiseRadius: number
    distanceFalloff: number
    intensity: number
    color: Color
    gammaCorrection: boolean
    screenSpaceRadius: boolean
    halfRes: boolean
    depthAwareUpsampling: boolean
    colorMultiply: boolean
    transparencyAware: boolean
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void
  }
}
