import { useEffect, useRef, useState, type ReactNode } from "react"

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Reduced-motion visitors see everything immediately — derived up front, not set from an effect.
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const [revealed, setRevealed] = useState(false)
  const visible = reducedMotion || revealed

  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [reducedMotion])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  )
}
