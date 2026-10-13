"use client"

import * as THREE from "three"

import { InfinityUltronHead } from "@/lib/infinity-ultron"
import type { AgentStatus } from "@/lib/store"
import { sfx } from "@/lib/sfx"
import { mouthShape } from "@/lib/speech-track"

// Ultron's head, for the console's centre in serious mode (lib/core-cipher.ts
// swaps it in for Jarvis's cipher): Infinity Ultron's helmet with Vision
// inside it, the model in public/models/infinity-ultron.glb
// (lib/infinity-ultron.ts) - gunmetal and bronze-gold, red only in the eye
// slots, the stone in the faceplate's brow and Vision's eyes.
//
// It pays attention: the head follows the pointer or a hand, drops its
// gaze to the chat while Andrew types, and looks about on its own. While
// he is engaged the faceplate swings up to show Vision, and closes after a
// quiet quarter-minute; Vision's jaw moves with the letter being said and
// the voice's loudness; his Mind Stone flares, with its hum, as Ultron
// appears and each time he starts to speak; the eye slots burn hotter with
// his energy and pulse while he thinks; and now and then he glitches.

export interface FaceInput {
  status: AgentStatus
  /** 0..1, his voice (or Andrew's while listening). */
  amp: number
  energy: number
  /** -1..1 where the pointer or a hand is, relative to the core; null when away. */
  look: { x: number; y: number } | null
  /** Seconds since Andrew last typed. */
  sinceTyped: number
  /** The live tint (accent, pulled red by an error). */
  tint: THREE.Color
}

/** The helmet is about 1.5 wide; this sets it inside the tick ring (r 2.85). */
const SCALE = 1.75
/** Seconds of quiet before the faceplate closes. */
const QUIET_S = 15

export class UltronFace {
  readonly group = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly ultron = new InfinityUltronHead({ eyeMode: "glow" })
  private loaded = false
  private disposed = false
  private readonly rim: THREE.DirectionalLight

  private readonly gaze = new THREE.Vector2()
  private readonly gazeTarget = new THREE.Vector2()
  private wander = 0
  private readonly wanderAt = new THREE.Vector2()
  private glitch = 0
  private glitchTimer = 3
  private plateGoal = false
  /** The Mind Stone's flare, 1 at its peak, decaying. */
  private flare = 0
  private lastFlare = -100
  private lastActive = -100
  private lastSeen = -100
  private wasSpeaking = false

  // (The glow texture and accent are the old built head's; the model brings its own light.)
  constructor(_glow: THREE.Texture, color: number, renderer: THREE.WebGLRenderer) {
    // Lights travel with the group, not the head, so turning shows the form.
    const key = new THREE.DirectionalLight(0xfff6f0, 1.6)
    key.position.set(-4, 4, 5)
    this.rim = new THREE.DirectionalLight(color, 0.8)
    this.rim.position.set(4, 1.5, -3)
    this.group.add(key, this.rim, new THREE.AmbientLight(0x8fa3cc, 0.15))
    this.group.add(this.head)

    void this.ultron
      .load(renderer)
      .then((u) => {
        if (this.disposed || !u.root) return
        u.root.scale.setScalar(SCALE)
        this.head.add(u.root)
        this.loaded = true
      })
      .catch((error) => console.warn("Ultron's head did not load:", error))
  }

  update(dt: number, t: number, input: FaceInput) {
    const { status, amp, energy, look, sinceTyped, tint } = input
    const thinking = status === "thinking"
    const speaking = status === "speaking"

    // Gaze: the pointer or hand when there is one; Andrew's typing pulls it
    // down toward the chat; left alone, he looks about on his own.
    this.wander -= dt
    if (this.wander <= 0) {
      this.wander = 1.5 + Math.random() * 3.5
      this.wanderAt.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.7)
    }
    if (look) this.gazeTarget.set(look.x, look.y)
    else if (sinceTyped < 2.5) this.gazeTarget.set(0, 0.8)
    else if (thinking) this.gazeTarget.set(Math.sin(t * 0.9) * 0.5, -0.35)
    else this.gazeTarget.copy(this.wanderAt)
    this.gaze.lerp(this.gazeTarget, Math.min(1, dt * (look ? 7 : 4)))
    this.head.rotation.y = this.gaze.x * 0.5 + Math.sin(t * 0.37) * 0.04
    this.head.rotation.x = this.gaze.y * 0.28
    this.head.rotation.z = -this.gaze.x * 0.04

    const hot = 0.55 + energy * 0.5 + amp * 0.9 + (thinking ? 0.25 + 0.25 * Math.sin(t * 18) : 0)
    this.rim.color.copy(tint)
    this.rim.intensity = 0.5 + hot * 0.4

    // Glitch: now and then (more often while he thinks) the head jumps
    // sideways for a few frames and the slots stutter.
    this.glitchTimer -= dt
    if (this.glitchTimer <= 0) {
      this.glitch = 0.12 + Math.random() * 0.15
      this.glitchTimer = thinking ? 0.8 + Math.random() * 1.5 : 4 + Math.random() * 7
    }
    this.glitch = Math.max(0, this.glitch - dt)
    const flicker = this.glitch > 0 && Math.random() < 0.4 ? 0.3 : 1
    if (this.glitch > 0) this.head.position.set((Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.05, 0)
    else this.head.position.set(0, 0, 0)

    if (!this.loaded) return

    // The Mind Stone flares - and hums - as he appears (back after being
    // hidden) and each time he starts to speak.
    const active = speaking || status === "listening" || thinking
    if (active) this.lastActive = t
    const appeared = t - this.lastSeen > 1.5
    if ((appeared || (speaking && !this.wasSpeaking)) && t - this.lastFlare > 6) {
      this.flare = 1
      this.lastFlare = t
      sfx.stoneHum()
    }
    this.lastSeen = t
    this.wasSpeaking = speaking
    this.flare = Math.max(0, this.flare - dt / 2.4)
    this.ultron.setStoneGlow(0.3 + this.flare * 2)
    this.ultron.setFaceplateStone((1.6 + hot * 0.8 + this.flare * 3) * flicker)

    // The faceplate opens while he is engaged and closes after a quiet
    // quarter-minute, with its sound.
    const goal = t - this.lastActive < QUIET_S
    if (goal !== this.plateGoal) sfx.helm(goal, goal ? this.ultron.openTime : this.ultron.closeTime)
    this.plateGoal = goal
    this.ultron.setOpenGoal(goal)

    // The slots burn with him.
    this.ultron.setGlow(Math.min(1, (hot - 0.4) * 0.8) * flicker)

    // Vision's jaw: the letter being said now, opened by the voice's
    // loudness; between words, it rests.
    const voice = Math.min(1, amp * 2.6)
    const shape = speaking ? mouthShape() : null
    this.ultron.setVoiceLevel(speaking ? voice : 0)
    this.ultron.setJaw(shape ? shape.open * (0.45 + 0.75 * voice) : speaking ? voice * 0.8 : thinking ? 0.08 : 0)
    this.ultron.update(dt)
  }

  dispose() {
    this.disposed = true
    this.ultron.dispose()
  }
}
