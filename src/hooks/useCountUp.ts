import { useEffect, useState } from "react"

/** Eases a number from 0 up to `target` on mount (and whenever target changes). Jumps straight there under reduced motion. */
export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / duration)
      setValue(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return value
}

/** Renders a number that counts up; `decimals` keeps e.g. GPA at 2 places. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const shown = useCountUp(value)
  return `${shown.toFixed(decimals)}${suffix}`
}
