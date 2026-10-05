/// <reference lib="webworker" />

// Depth Anything V2 (small), off the main thread: a camera frame in, a
// depth map out - one number per pixel saying how near that point is
// (relative inverse depth: bigger is nearer, no units). The try-on scales
// it to centimetres against something it knows the true distance of (a
// tracked face or hand) and uses it to hide holograms behind real things
// and to set objects on real surfaces.
//
// The model (~50 MB fp16 on WebGPU, ~27 MB 8-bit on the CPU) downloads
// from Hugging Face the first time depth is switched on; the browser
// caches it after that.

import { AutoModel, Tensor, env } from "@huggingface/transformers"

const MODEL = "onnx-community/depth-anything-v2-small"

export type DepthRequest = { kind: "frame"; bitmap: ImageBitmap }
export type DepthResponse =
  | { kind: "progress"; text: string }
  | { kind: "ready"; device: string }
  | { kind: "depth"; data: Float32Array; width: number; height: number; ms: number }
  | { kind: "error"; error: string }

env.allowLocalModels = false

type Model = Awaited<ReturnType<typeof AutoModel.from_pretrained>>

let model: Model | null = null
let busy = false

// ImageNet normalisation, as the model was trained with.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
/** Input height: a multiple of the model's 14 px patch, well under its
 *  default 518 - occlusion and placement need no fine detail, and it runs
 *  several times faster. */
const INPUT_H = 252

const post = (message: DepthResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer)

async function load() {
  const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu?.requestAdapter())
  const device = gpu ? "webgpu" : "wasm"
  const files = new Map<string, number>()
  const progress = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === "progress" && p.file) {
      files.set(p.file, p.progress ?? 0)
      const avg = [...files.values()].reduce((a, b) => a + b, 0) / files.size
      post({ kind: "progress", text: `DOWNLOADING DEPTH MODEL ${Math.round(avg)}%` })
    }
  }
  model = await AutoModel.from_pretrained(MODEL, { device, dtype: gpu ? "fp16" : "q8", progress_callback: progress })
  post({ kind: "ready", device })
}

const loading = load().catch((err) => post({ kind: "error", error: err instanceof Error ? err.message : String(err) }))

self.onmessage = async (event: MessageEvent<DepthRequest>) => {
  const { bitmap } = event.data
  await loading
  if (!model || busy) {
    bitmap.close()
    return
  }
  busy = true
  const started = performance.now()
  try {
    const height = INPUT_H
    const width = Math.round(((bitmap.width / bitmap.height) * height) / 14) * 14
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")!
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const rgba = context.getImageData(0, 0, width, height).data
    const plane = width * height
    const input = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i += 1) {
      for (let c = 0; c < 3; c += 1) input[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c]
    }
    const { predicted_depth } = await model({ pixel_values: new Tensor("float32", input, [1, 3, height, width]) })
    const dims = predicted_depth.dims as number[]
    const h = dims[dims.length - 2]
    const w = dims[dims.length - 1]
    const data = new Float32Array(predicted_depth.data as Float32Array)
    post({ kind: "depth", data, width: w, height: h, ms: performance.now() - started }, [data.buffer])
  } catch (err) {
    post({ kind: "error", error: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
  }
}
