"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

import { accentHex } from "@/lib/core-events"
import { compileScadCached } from "@/lib/workshop/openscad"
import { buildAssembly } from "@/lib/workshop/project/assembly"
import { fitTo } from "@/lib/workshop/project/holo"
import type { Project } from "@/lib/workshop/project/types"

// The finished product, turning slowly on a pedestal in the project's
// folder: the assembly in its real materials, lit like a product shot - a
// studio environment for the reflections, a soft key light and the
// shadow it casts on the pedestal. A small renderer of its own, so it
// works whatever is on the stage.

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
    renderer.toneMappingExposure = 0.95
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.style.display = "block"
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.8
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101010, 0.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(2.5, 5, 3)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.radius = 6
    key.shadow.bias = -0.0005
    const sc = key.shadow.camera
    sc.left = sc.bottom = -1.2
    sc.right = sc.top = 1.2
    sc.near = 1
    sc.far = 12
    scene.add(key)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), new THREE.ShadowMaterial({ opacity: 0.45 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
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

    // A worn project shows what is worn (its wear group), not the pack on his belt.
    const group = project.wear?.group
    const shown = group ? { ...project, parts: project.parts.filter((p) => p.group === group), printed: project.printed.filter((p) => p.group === group) } : project
    void buildAssembly(shown, compileScadCached, { bind: false })
      .then(({ item }) => {
        if (disposed) return
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
      scene.environment?.dispose()
      pmrem.dispose()
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
