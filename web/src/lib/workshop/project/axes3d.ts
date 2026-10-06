import * as THREE from "three"

// The design frame's axes on an open project: X, Y and Z from the origin
// the layout and the OpenSCAD use (mm, z up), with a tick every step and
// the distance at each major one - so a layout position read in the
// panel can be found on the stage, and a part moved along an axis can be
// measured as it goes. CAD colours: X red, Y green, Z blue. Lines and
// labels only (no meshes), drawn over the model, never picked, exploded
// or exported.

export const AXIS_COLORS = [0xff5a5a, 0x5aff8c, 0x5aa8ff] as const
const NAMES = ["X", "Y", "Z"] as const

function label(text: string, color: number, height: number) {
  const canvas = document.createElement("canvas")
  const px = 64
  const ctx = canvas.getContext("2d")!
  ctx.font = `600 ${px}px ui-monospace, Menlo, Consolas, monospace`
  const width = Math.ceil(ctx.measureText(text).width) + 16
  canvas.width = width
  canvas.height = px + 16
  ctx.font = `600 ${px}px ui-monospace, Menlo, Consolas, monospace`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineWidth = 10
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
  ctx.strokeText(text, width / 2, canvas.height / 2)
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`
  ctx.fillText(text, width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  sprite.renderOrder = 31
  return sprite
}

/** A round step for ticks along `length` mm. */
function stepFor(length: number) {
  for (const s of [5, 10, 25, 50, 100, 250]) if (length / s <= 8) return s
  return 500
}

/** Axes `length` mm long each way from the design origin. */
export function buildAxes(length: number): THREE.Group {
  const group = new THREE.Group()
  group.name = "axes"
  group.userData.helper = true
  const L = Math.max(30, Math.ceil(length / 10) * 10)
  const major = stepFor(L)
  const minor = major / 5
  const tick = L * 0.025
  const text = L * 0.045

  for (let axis = 0; axis < 3; axis += 1) {
    const color = AXIS_COLORS[axis]
    const dir = new THREE.Vector3().setComponent(axis, 1)
    // A tick's sideways direction: the next axis round.
    const side = new THREE.Vector3().setComponent((axis + 1) % 3, 1)
    const bright: number[] = []
    const faint: number[] = []
    const push = (to: number[], a: THREE.Vector3, b: THREE.Vector3) => to.push(a.x, a.y, a.z, b.x, b.y, b.z)
    push(bright, new THREE.Vector3(), dir.clone().multiplyScalar(L))
    push(faint, dir.clone().multiplyScalar(-L), new THREE.Vector3())
    for (let d = minor; d <= L + 1e-6; d += minor) {
      const isMajor = Math.abs(d / major - Math.round(d / major)) < 1e-6
      const size = isMajor ? tick : tick * 0.45
      for (const sign of [1, -1]) {
        const at = dir.clone().multiplyScalar(d * sign)
        push(sign > 0 ? bright : faint, at.clone().addScaledVector(side, -size), at.clone().addScaledVector(side, size))
      }
      if (isMajor && d < L - 1e-6) {
        const tag = label(`${d}`, color, text * 0.7)
        tag.position.copy(dir).multiplyScalar(d).addScaledVector(side, tick * 3)
        group.add(tag)
      }
    }
    // An arrowhead at the positive end.
    const tip = dir.clone().multiplyScalar(L)
    const back = dir.clone().multiplyScalar(L - tick * 2.4)
    const across = new THREE.Vector3().setComponent((axis + 2) % 3, 1)
    for (const v of [side, across]) {
      push(bright, tip, back.clone().addScaledVector(v, tick * 1.1))
      push(bright, tip, back.clone().addScaledVector(v, -tick * 1.1))
    }
    for (const [points, opacity] of [[bright, 0.95], [faint, 0.28]] as const) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
      )
      lines.renderOrder = 30
      group.add(lines)
    }
    const name = label(NAMES[axis], color, text * 1.6)
    name.position.copy(dir).multiplyScalar(L + text * 1.6)
    group.add(name)
  }
  const origin = label("0", 0xd8e6f0, text * 0.8)
  origin.position.set(-text, -text, -text)
  group.add(origin)
  return group
}
