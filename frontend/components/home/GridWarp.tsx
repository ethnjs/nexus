'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const CELL = 48          // grid cell size, px
const SEGMENT = 16        // px per line segment — smaller bends more smoothly
const INFLUENCE_RADIUS = 260 // px — how far the "gravity" reaches
const EASE = 0.07        // cursor-follow smoothing, 0-1

// At the cursor itself, points are radially compressed to this fraction of
// their original distance from it. 0 means points directly at the cursor
// converge onto that exact pixel (a true point). Scales smoothly back up
// to 1 (no change) at INFLUENCE_RADIUS.
const SHRINK_MIN = 0.5

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

const LINE_COLOR = 0xc8c8c2 // matches --color-border-strong

// Full-viewport WebGL grid that warps toward the cursor like a gravity well —
// grid points near the cursor get pulled toward it with inverse-linear falloff.
export function GridWarp() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let width = window.innerWidth
    let height = window.innerHeight

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 10)
    camera.position.z = 5

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    let restArray = new Float32Array(0)
    let geometry = new THREE.BufferGeometry()
    let lines: THREE.LineSegments | null = null

    function buildGrid(w: number, h: number) {
      if (lines) {
        scene.remove(lines)
        geometry.dispose()
      }

      const positions: number[] = []
      const startX = -w / 2 - CELL
      const startY = -h / 2 - CELL
      const cols = Math.ceil((w + 2 * CELL) / CELL)
      const rows = Math.ceil((h + 2 * CELL) / CELL)

      // vertical lines
      for (let c = 0; c <= cols; c++) {
        const x = startX + c * CELL
        const segCount = Math.ceil((h + 2 * CELL) / SEGMENT)
        for (let s = 0; s < segCount; s++) {
          const y0 = startY + s * SEGMENT
          const y1 = startY + (s + 1) * SEGMENT
          positions.push(x, y0, 0, x, y1, 0)
        }
      }
      // horizontal lines
      for (let r = 0; r <= rows; r++) {
        const y = startY + r * CELL
        const segCount = Math.ceil((w + 2 * CELL) / SEGMENT)
        for (let s = 0; s < segCount; s++) {
          const x0 = startX + s * SEGMENT
          const x1 = startX + (s + 1) * SEGMENT
          positions.push(x0, y, 0, x1, y, 0)
        }
      }

      const posArray = new Float32Array(positions)
      restArray = posArray.slice()

      geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3))

      const material = new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.9 })
      lines = new THREE.LineSegments(geometry, material)
      scene.add(lines)
    }

    buildGrid(width, height)

    const mouse = new THREE.Vector2(0, 0)
    const displayMouse = new THREE.Vector2(0, 0)
    let hasMoved = false

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX - width / 2
      mouse.y = -(e.clientY - height / 2)
      if (!hasMoved) {
        displayMouse.copy(mouse)
        hasMoved = true
      }
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })

    let frameId: number
    function animate() {
      displayMouse.lerp(mouse, EASE)

      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = posAttr.array as Float32Array

      for (let i = 0; i < arr.length; i += 3) {
        const rx = restArray[i]
        const ry = restArray[i + 1]
        const dx = rx - displayMouse.x
        const dy = ry - displayMouse.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (hasMoved && dist < INFLUENCE_RADIUS) {
          // Scale each point's offset from the cursor (not translate toward
          // it) — this preserves both angle and radial ordering exactly, so
          // no two points can ever swap sides or cross paths. A translate-
          // by-fixed-amount approach let points fold across each other right
          // at the cursor (a visible X/knot artifact); a pure radial scale
          // can't fold since scaled distance = dist * scale(dist) is
          // strictly increasing in dist.
          const scale = SHRINK_MIN + (1 - SHRINK_MIN) * smoothstep(dist / INFLUENCE_RADIUS)
          arr[i] = displayMouse.x + dx * scale
          arr[i + 1] = displayMouse.y + dy * scale
        } else {
          arr[i] = rx
          arr[i + 1] = ry
        }
      }
      posAttr.needsUpdate = true

      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    function onResize() {
      width = window.innerWidth
      height = window.innerHeight
      camera.left = -width / 2
      camera.right = width / 2
      camera.top = height / 2
      camera.bottom = -height / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      buildGrid(width, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      geometry.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />
}
