import * as THREE from "three"

import type { Cabling } from "@/lib/workshop/project/wires3d"
import { FINGERS, isFingerAnchor, PARTS, type Anchor, type FingerAnchor, type Part, type PrintedPart, type Project, type Segment, type Side } from "@/lib/workshop/project/types"

// A project's rig: the pieces of it that move on their own (types.ts
// Segment). Every project with a controller gets one segment for it, so
// the board can be moved off the build - onto a forearm or upper-arm
// mount, a belt, a back plate - with its wiring following. A wearable on
// the arm with no rig of its own gets the joint it obviously has: a
// gauntlet's hand plate hinged at the wrist and tracked on the hand,
// while the bracer stays on the wrist. Finger armour named by finger and
// bone ("Index 2 R", "thumb tip") gets a segment on that bone, so every
// cap follows its own bone of the real finger.
//
// In 3D each segment is three groups, in the design frame (mm, z up):
//   holder  - what the stage's exploded view moves;
//   joint   - at the pivot (plus the move), turned by the pose, or set
//             from the body in the try-on;
//   inner   - back by the pivot, so its members keep their layout
//             coordinates: the design frame, carried by the joint.

export const CONTROLLER = "Controller"

/** Where each arm anchor's origin is at rest, mm along the arm (x, toward
 *  the fingers) from the wrist joint (WEAR_GUIDE's frames). */
export const ARM_X: Partial<Record<Anchor, number>> = { upper_arm: -400, forearm: -100, wrist: 0, hand: 70 }

/** A wrist's reach: roll (x), flexion (y), side to side (z). */
const WRIST_LIMITS = [[-25, 25], [-70, 70], [-30, 30]]
const FREE_LIMITS = [[-180, 180], [-180, 180], [-180, 180]]

const HAND_RE = /\b(hand|palm|finger|knuckle|glove|repulsor)/i
const ARM_RE = /\b(wrist|bracer|cuff|forearm|vambrace|gauntlet)/i
/** A finger bone's reach: curl (y) and a little side to side (z). */
const BONE_LIMITS = [[-10, 10], [-20, 110], [-25, 25]]

/** The finger bone a name means: a finger, then which bone (1 base, 2
 *  middle, 3 tip; the thumb's 1 is in the palm). Null if it names none. */
export function fingerBoneOf(name: string): FingerAnchor | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const alias: Record<string, (typeof FINGERS)[number]> = { little: "pinky", pinkie: "pinky", pointer: "index" }
  const finger = words.map((w) => alias[w] ?? w).find((w) => (FINGERS as readonly string[]).includes(w)) as (typeof FINGERS)[number] | undefined
  if (!finger) return null
  // "middle" is a finger before it is a bone: count only the words after it.
  const rest = words.slice(words.findIndex((w) => (alias[w] ?? w) === finger) + 1)
  const bone = rest.some((w) => ["3", "tip", "distal", "3rd"].includes(w))
    ? 3
    : rest.some((w) => ["2", "mid", "middle", "intermediate", "2nd"].includes(w))
      ? 2
      : rest.some((w) => ["1", "base", "proximal", "1st"].includes(w))
        ? 1
        : null
  return bone ? (`${finger}_${bone}` as FingerAnchor) : null
}

/** The side a name says, if any ("Bracer shell L", "Right hand"). */
export function sideNamed(name: string): Side | undefined {
  const words = name.toLowerCase().split(/[^a-z0-9]+/)
  if (words.some((w) => w === "r" || w === "right")) return "right"
  if (words.some((w) => w === "l" || w === "left")) return "left"
  return undefined
}

export interface RigSegment extends Segment {
  /** Made up here, not saved with the project (yet). */
  auto?: boolean
}

const v3 = (v: number[] | undefined, d = 0): [number, number, number] => [v?.[0] ?? d, v?.[1] ?? d, v?.[2] ?? d]

/** What a member key can name: a part, a printed part, or a group. */
interface Member {
  key: string
  group?: string
  text: string
}

function members(project: Pick<Project, "parts" | "printed">): Member[] {
  return [
    ...project.parts.map((p: Part) => ({ key: p.id, group: p.group, text: `${p.id} ${p.label ?? ""} ${p.type}` })),
    ...project.printed.map((p: PrintedPart) => ({ key: p.name, group: p.group, text: p.name })),
  ]
}

/** The segment a part or printed part belongs to: one that names it, else
 *  one that names its group. */
export function ownerOf(segments: Segment[], key: string, group?: string): Segment | undefined {
  const k = key.toLowerCase()
  const named = segments.find((s) => s.members.some((m) => m.toLowerCase() === k))
  if (named || !group) return named
  const g = group.toLowerCase()
  return segments.find((s) => s.members.some((m) => m.toLowerCase() === g))
}

/** Parents before children; a parent that is missing or loops is dropped. */
function ordered(segments: RigSegment[]): RigSegment[] {
  const byName = new Map(segments.map((s) => [s.name, s]))
  const out: RigSegment[] = []
  const done = new Set<string>()
  const visit = (s: RigSegment, path: Set<string>) => {
    if (done.has(s.name)) return
    if (s.parent && (!byName.has(s.parent) || path.has(s.parent) || s.parent === s.name)) s = { ...s, parent: undefined }
    if (s.parent) visit(byName.get(s.parent)!, new Set([...path, s.name]))
    done.add(s.name)
    out.push(s)
  }
  for (const s of segments) visit(s, new Set([s.name]))
  return out
}

/** The project's segments as the workshop uses them: the saved ones, the
 *  wrist joint a wearable on the arm obviously has (when none are saved),
 *  and the controller's mount (when no segment holds the board). */
export function rigOf(project: Pick<Project, "parts" | "printed" | "segments" | "wear">): RigSegment[] {
  const saved: RigSegment[] = (project.segments ?? []).map((s) => ({ ...s, members: [...s.members] }))
  const out = [...saved]
  const all = members(project)
  const main = project.wear?.anchor
  const free = (m: Member) => !ownerOf(out, m.key, m.group)

  // Finger armour by bone, worn on the arm or hand: a segment on each
  // named bone (not already in a segment by name), hanging from the hand
  // plate of its side if there is one. Pieces named by side pair up.
  const sidedBuild = all.some((m) => sideNamed(m.key)) || saved.some((s) => s.side || sideNamed(s.name))
  if (main && (ARM_X[main] !== undefined || isFingerAnchor(main))) {
    for (const m of project.printed) {
      const bone = fingerBoneOf(m.name)
      if (!bone || out.some((s) => s.members.some((k) => k.toLowerCase() === m.name.toLowerCase()))) continue
      const side = sidedBuild ? sideNamed(m.name) : undefined
      const hand = out.find((s) => s.anchor === "hand" && (s.side ?? sideNamed(s.name)) === side)
      out.push({ name: m.name, members: [m.name], parent: hand?.name, anchor: bone, side, limits: BONE_LIMITS, auto: true })
    }
  }
  // Saved segments named for a side follow that side.
  if (sidedBuild) for (const s of out) if (!s.side && s.anchor) s.side = sideNamed(s.name)

  if (!saved.length && main && ARM_X[main] !== undefined) {
    // Grouped pieces go by their group's name, loose ones by their own.
    const pick = (re: RegExp) => {
      const keys = new Set<string>()
      for (const m of all.filter(free)) {
        if (m.group && re.test(m.group)) keys.add(m.group)
        else if (!m.group && re.test(m.text)) keys.add(m.key)
      }
      return [...keys]
    }
    const wristX = ARM_X.wrist! - ARM_X[main]!
    if (main === "wrist" || main === "forearm") {
      const hand = pick(HAND_RE)
      // Not everything: a build that is all hand has no joint to make.
      if (hand.length && hand.length < all.length) {
        out.push({ name: "Hand", members: hand, pivot: [wristX, 0, 0], anchor: "hand", limits: WRIST_LIMITS, auto: true })
      }
    } else if (main === "hand") {
      const arm = pick(ARM_RE)
      if (arm.length && arm.length < all.length) {
        out.push({ name: "Wrist", members: arm, pivot: [wristX, 0, 0], anchor: "wrist", limits: WRIST_LIMITS, auto: true })
      }
    }
  }

  // Finger bones made before the hand plate's joint hang from it too.
  for (const s of out) {
    if (!s.auto || s.parent || !isFingerAnchor(s.anchor)) continue
    s.parent = out.find((h) => h.anchor === "hand" && (h.side ?? sideNamed(h.name)) === s.side)?.name
  }

  const boards = project.parts.filter((p) => PARTS[p.type]?.kind === "mcu" && !ownerOf(out, p.id, p.group))
  if (boards.length && !out.some((s) => s.name === CONTROLLER)) {
    out.push({ name: CONTROLLER, members: boards.map((p) => p.id), auto: true })
  }
  return ordered(out)
}

/** Segments as saved: no auto marks, no zero vectors. */
export function savedSegments(segments: RigSegment[]): Segment[] {
  const zero = (v?: number[]) => !v || v.every((n) => Math.abs(n) < 1e-6)
  return segments.map((s) => {
    const out: Segment = { name: s.name, members: s.members }
    if (s.parent) out.parent = s.parent
    if (!zero(s.pivot)) out.pivot = v3(s.pivot)
    if (!zero(s.move)) out.move = v3(s.move)
    if (!zero(s.pose)) out.pose = v3(s.pose)
    if (s.limits) out.limits = s.limits
    if (s.anchor) out.anchor = s.anchor
    if (s.side) out.side = s.side
    if (s.at) out.at = v3(s.at)
    return out
  })
}

export function limitsOf(segment: Segment): number[][] {
  return [0, 1, 2].map((i) => {
    const [lo, hi] = segment.limits?.[i] ?? FREE_LIMITS[i]
    return [Math.min(lo, hi), Math.max(lo, hi)]
  })
}

const deg = THREE.MathUtils.degToRad

interface Joint {
  segment: RigSegment
  holder: THREE.Group
  joint: THREE.Group
  inner: THREE.Group
  /** Its members' extent at rest, in the design frame. */
  box: THREE.Box3
}

/** The rig in 3D (see the top of the file). Built by assembly.ts. */
export class Rig {
  readonly joints = new Map<string, Joint>()
  cabling: Cabling | null = null

  constructor(
    readonly zUp: THREE.Group,
    segments: RigSegment[],
    /** The anchor the whole build is worn on, for each segment's default `at`. */
    readonly mainAnchor: Anchor | null = null
  ) {
    for (const segment of segments) {
      const holder = new THREE.Group()
      const joint = new THREE.Group()
      const inner = new THREE.Group()
      holder.name = `segment:${segment.name}`
      holder.userData.segment = segment.name
      joint.userData.joint = segment.name
      holder.add(joint)
      joint.add(inner)
      const parent = segment.parent ? this.joints.get(segment.parent)?.inner : undefined
      ;(parent ?? zUp).add(holder)
      this.joints.set(segment.name, { segment, holder, joint, inner, box: new THREE.Box3() })
    }
  }

  get segments(): RigSegment[] {
    return [...this.joints.values()].map((j) => j.segment)
  }

  /** Where a part or printed part is added: its segment's inner group, or
   *  the design frame itself. */
  container(key: string, group?: string): THREE.Object3D {
    const owner = ownerOf(this.segments, key, group)
    return (owner && this.joints.get(owner.name)?.inner) || this.zUp
  }

  /** Measure each segment's members at rest (call once they are added). */
  measure() {
    for (const j of this.joints.values()) {
      const kept = { p: j.joint.position.clone(), q: j.joint.quaternion.clone(), i: j.inner.position.clone() }
      j.joint.position.set(0, 0, 0)
      j.joint.quaternion.identity()
      j.inner.position.set(0, 0, 0)
      j.box.makeEmpty()
      j.inner.updateMatrixWorld(true)
      // In the inner frame, which at rest is the design frame.
      const toInner = new THREE.Matrix4().copy(j.inner.matrixWorld).invert()
      for (const child of j.inner.children) {
        if (child.userData.segment) continue
        const b = new THREE.Box3().setFromObject(child)
        if (!b.isEmpty()) j.box.union(b.applyMatrix4(toInner))
      }
      j.joint.position.copy(kept.p)
      j.joint.quaternion.copy(kept.q)
      j.inner.position.copy(kept.i)
    }
  }

  /** Set the segments as the editor has them (move, pose, pivot), clamped
   *  to their joints' range, and re-route the cables. Segments not given
   *  keep what they had. */
  apply(segments: Segment[], rewire = true) {
    for (const s of segments) {
      const j = this.joints.get(s.name)
      if (!j) continue
      j.segment = { ...j.segment, ...s }
      this.rest(s.name)
    }
    if (rewire) this.rewire()
  }

  /** Put a segment back where the editor has it (the try-on, once its
   *  anchor is lost). */
  rest(name: string) {
    const j = this.joints.get(name)
    if (!j) return
    const s = j.segment
    const pivot = v3(s.pivot)
    const move = v3(s.move)
    const lim = limitsOf(s)
    const pose = v3(s.pose).map((a, i) => THREE.MathUtils.clamp(a, lim[i][0], lim[i][1]))
    j.joint.position.set(pivot[0] + move[0], pivot[1] + move[1], pivot[2] + move[2])
    j.joint.rotation.set(deg(pose[0]), deg(pose[1]), deg(pose[2]))
    j.inner.position.set(-pivot[0], -pivot[1], -pivot[2])
  }

  rewire(detail = 1) {
    this.cabling?.update(detail)
  }

  /** The design point that sits on a segment's own anchor in the try-on:
   *  its `at`, else where that anchor rests along the arm from the main
   *  one, else the middle of its members (as moved). */
  anchorAt(name: string): THREE.Vector3 {
    const j = this.joints.get(name)!
    const s = j.segment
    if (s.at) return new THREE.Vector3(...v3(s.at))
    const own = s.anchor ? ARM_X[s.anchor] : undefined
    const main = this.mainAnchor ? ARM_X[this.mainAnchor] : undefined
    if (own !== undefined && main !== undefined) return new THREE.Vector3(own - main, 0, 0)
    const centre = j.box.isEmpty() ? new THREE.Vector3() : j.box.getCenter(new THREE.Vector3())
    // Finger armour sits on the back of its bone: the bone's axis (where
    // the tracker puts the anchor) runs under the cap, at its underside.
    if (isFingerAnchor(s.anchor) && !j.box.isEmpty()) centre.z = j.box.min.z
    return centre.add(new THREE.Vector3(...v3(s.move)))
  }

  /** The frame an action's `at` is in: its named segment's, else the
   *  smallest segment whose members are around that point, else the
   *  design frame - so a palm repulsor rides on the hand. */
  frameFor(at: number[], segment?: string): THREE.Object3D {
    if (segment) {
      const named = this.joints.get(segment)
      if (named) return named.inner
    }
    const p = new THREE.Vector3(...v3(at))
    let best: Joint | null = null
    let bestSize = Infinity
    for (const j of this.joints.values()) {
      if (j.box.isEmpty() || !j.box.clone().expandByScalar(15).containsPoint(p)) continue
      const size = j.box.getSize(new THREE.Vector3()).length()
      if (size < bestSize) {
        best = j
        bestSize = size
      }
    }
    return best?.inner ?? this.zUp
  }
}
