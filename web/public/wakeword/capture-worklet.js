// Hands the wake-word listener (web/src/lib/wakeword/listener.ts) the mic's
// audio at the context's rate (16 kHz), scaled like 16-bit samples, in
// blocks of about 128 ms so the main thread is not woken 125 times a second.
class WakeCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(2048)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.block[this.filled++] = channel[i] * 32767
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block)
          this.block = new Float32Array(2048)
          this.filled = 0
        }
      }
    }
    return true
  }
}

registerProcessor("wake-capture", WakeCapture)
