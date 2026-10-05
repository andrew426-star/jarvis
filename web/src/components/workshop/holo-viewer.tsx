"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"

import { accentHex } from "@/lib/core-events"
import { compileScadCached } from "@/lib/workshop/openscad"
import { buildAssembly } from "@/lib/workshop/project/assembly"
import { fitTo, hologram } from "@/lib/workshop/project/holo"
import type { Project } from "@/lib/workshop/project/types"

// The finished product, turning slowly on a pedestal in the project's
// folder: the assembly with its real materials and its edges in light.
// A small renderer of its own, so it works whatever is on the stage.

export function HoloViewer({ project, version }: { project: Project; version: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading")

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!project.parts.length && !project.printed.length) {
      setTimeout(() => setState("empty"))
      return
    }
    let disposed = false
    let raf = 0
    const color = accentHex()
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.domElement.style.display = "block"
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x101010, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 2)
    key.position.set(3, 5, 4)
    scene.add(key)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.0, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    scene.add(ring)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50)
    camera.position.set(0, 1.5, 3.4)
    camera.lookAt(0, 0.45, 0)
    const turntable = new THREE.Group()
    scene.add(turntable)

    const size = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = "100%"
      renderer.domElement.style.height = "100%"
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(size)
    observer.observe(host)
    size()

    const clock = new THREE.Clock()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      turntable.rotation.y += clock.getDelta() * 0.4
      renderer.render(scene, camera)
    }
    frame()

    void buildAssembly(project, compileScadCached, { bind: false })
      .then(({ item }) => {
        if (disposed) return
        hologram(item.object, color, { solid: true })
        turntable.add(fitTo(item.object, 1.5))
        setState("ready")
      })
      .catch(() => !disposed && setState("empty"))

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | undefined
        material?.dispose?.()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
    // A new copy of the project is a new product to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  return (
    <div className="relative" style={{ height: 220, border: "1px solid rgba(var(--accent-rgb), 0.2)", background: "radial-gradient(ellipse at 50% 80%, rgba(var(--accent-rgb), 0.12), transparent 70%)" }}>
      <div ref={hostRef} className="absolute inset-0" />
      {state !== "ready" && (
        <p className="t-time absolute inset-0 m-0 flex items-center justify-center" style={{ textAlign: "center", padding: 16 }}>
          {state === "loading" ? "PROJECTING THE FINISHED PRODUCT..." : "NOTHING DESIGNED YET: ASK JARVIS TO DRAW IT UP"}
        </p>
      )}
    </div>
  )
}
