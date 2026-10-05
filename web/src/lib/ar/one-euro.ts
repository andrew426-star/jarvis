import * as THREE from "three"

// The One Euro filter (Casiez, Roussel and Vogel, 2012): heavy smoothing
// while something is held still, almost none while it moves fast. That is
// what a tracked pose needs - no shimmer on a steady wrist, no lag when the
// arm swings. Time is in seconds.

class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff = 1
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value
      this.t = t
      return value
    }
    const dt = Math.max(1e-3, t - this.t)
    this.t = t
    const dx = (value - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

/** A pose filter: position in cm, rotation as a quaternion. */
export class PoseFilter {
  private readonly position = [0, 1, 2].map(() => new OneEuro(1.2, 0.08))
  private readonly rotation = [0, 1, 2, 3].map(() => new OneEuro(1.5, 0.6))
  private last: THREE.Quaternion | null = null

  apply(position: THREE.Vector3, quaternion: THREE.Quaternion, t: number) {
    // q and -q are the same rotation; keep to one hemisphere so the
    // filter never averages across the flip.
    const q = quaternion.clone()
    if (this.last && this.last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
    const p = position.toArray().map((v, i) => this.position[i].filter(v, t))
    const r = [q.x, q.y, q.z, q.w].map((v, i) => this.rotation[i].filter(v, t))
    const out = new THREE.Quaternion(r[0], r[1], r[2], r[3]).normalize()
    this.last = out.clone()
    return { position: new THREE.Vector3(p[0], p[1], p[2]), quaternion: out }
  }

  reset() {
    this.position.forEach((f) => f.reset())
    this.rotation.forEach((f) => f.reset())
    this.last = null
  }
}
