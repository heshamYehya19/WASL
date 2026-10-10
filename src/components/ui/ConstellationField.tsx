import { useEffect, useRef } from "react"

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

type ConstellationFieldProps = {
  className?: string
  particleColor?: string
  lineColor?: string
  cursorLineColor?: string
  cursorGlowColor?: string
  /** Roughly one particle per this many px² of area. Lower = denser. */
  density?: number
  /** "container" sizes to the canvas's parent element (default). "viewport" sizes to the window and tracks the cursor anywhere on screen — use for a full-page ambient background. */
  mode?: "container" | "viewport"
  /** Particle count is clamped to [minParticles, maxParticles]. */
  minParticles?: number
  maxParticles?: number
}

const LINK_DIST = 118
const CURSOR_LINK_DIST = 160
const CURSOR_PULL_DIST = 70

export function ConstellationField({
  className = "",
  particleColor = "rgba(165, 180, 252, 0.8)",
  lineColor = "rgba(165, 180, 252, 0.16)",
  cursorLineColor = "rgba(165, 180, 252, 0.5)",
  cursorGlowColor = "rgba(165, 180, 252, 0.9)",
  density = 11000,
  mode = "container",
  minParticles = 18,
  maxParticles = 70,
}: ConstellationFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    if (mode === "container" && !container) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let width = 0
    let height = 0
    let particles: Particle[] = []
    let frameId = 0
    const pointer = { x: 0, y: 0, active: false }

    function resize() {
      if (mode === "viewport") {
        width = window.innerWidth
        height = window.innerHeight
      } else {
        const rect = container!.getBoundingClientRect()
        width = rect.width
        height = rect.height
      }
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      const count = Math.round(Math.max(minParticles, Math.min(maxParticles, (width * height) / density)))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.2 + 0.6,
      }))
    }

    function handlePointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      pointer.active = true
    }
    function handlePointerLeave() {
      pointer.active = false
    }

    function step() {
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x <= 0 || p.x >= width) p.vx *= -1
        if (p.y <= 0 || p.y >= height) p.vy *= -1
        p.x = Math.min(Math.max(p.x, 0), width)
        p.y = Math.min(Math.max(p.y, 0), height)

        if (pointer.active) {
          const dx = p.x - pointer.x
          const dy = p.y - pointer.y
          const dist = Math.hypot(dx, dy)
          if (dist < CURSOR_PULL_DIST && dist > 0.01) {
            const force = ((CURSOR_PULL_DIST - dist) / CURSOR_PULL_DIST) * 0.02
            p.vx += (dx / dist) * force
            p.vy += (dy / dist) * force
          }
        }
        p.vx *= 0.995
        p.vy *= 0.995
      }
    }

    function render() {
      ctx!.clearRect(0, 0, width, height)

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dist = Math.hypot(a.x - b.x, a.y - b.y)
          if (dist < LINK_DIST) {
            ctx!.globalAlpha = 1 - dist / LINK_DIST
            ctx!.strokeStyle = lineColor
            ctx!.lineWidth = 0.6
            ctx!.beginPath()
            ctx!.moveTo(a.x, a.y)
            ctx!.lineTo(b.x, b.y)
            ctx!.stroke()
          }
        }
      }

      if (pointer.active) {
        for (const p of particles) {
          const dist = Math.hypot(p.x - pointer.x, p.y - pointer.y)
          if (dist < CURSOR_LINK_DIST) {
            ctx!.globalAlpha = 1 - dist / CURSOR_LINK_DIST
            ctx!.strokeStyle = cursorLineColor
            ctx!.lineWidth = 0.8
            ctx!.beginPath()
            ctx!.moveTo(p.x, p.y)
            ctx!.lineTo(pointer.x, pointer.y)
            ctx!.stroke()
          }
        }

        ctx!.globalAlpha = 1
        const glow = ctx!.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 9)
        glow.addColorStop(0, cursorGlowColor)
        glow.addColorStop(1, "rgba(165, 180, 252, 0)")
        ctx!.fillStyle = glow
        ctx!.beginPath()
        ctx!.arc(pointer.x, pointer.y, 9, 0, Math.PI * 2)
        ctx!.fill()
      }

      ctx!.globalAlpha = 1
      ctx!.fillStyle = particleColor
      for (const p of particles) {
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    function loop() {
      step()
      render()
      frameId = requestAnimationFrame(loop)
    }

    resize()
    if (reduceMotion) {
      render()
    } else {
      frameId = requestAnimationFrame(loop)
    }

    const ro = mode === "container" ? new ResizeObserver(resize) : null
    if (ro && container) ro.observe(container)

    if (mode === "viewport") {
      window.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("mouseleave", handlePointerLeave)
      window.addEventListener("resize", resize)
    } else {
      container!.addEventListener("pointermove", handlePointerMove)
      container!.addEventListener("pointerleave", handlePointerLeave)
    }

    return () => {
      cancelAnimationFrame(frameId)
      ro?.disconnect()
      if (mode === "viewport") {
        window.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("mouseleave", handlePointerLeave)
        window.removeEventListener("resize", resize)
      } else {
        container!.removeEventListener("pointermove", handlePointerMove)
        container!.removeEventListener("pointerleave", handlePointerLeave)
      }
    }
  }, [particleColor, lineColor, cursorLineColor, cursorGlowColor, density, mode, minParticles, maxParticles])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
