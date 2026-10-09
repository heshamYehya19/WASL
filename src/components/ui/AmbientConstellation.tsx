import { ConstellationField } from "./ConstellationField"

/**
 * Full-viewport, low-opacity constellation used as a shared background across
 * light-themed screens (public pages, dashboards). Tuned to sit quietly behind
 * opaque cards/panels and only read as texture in the page's empty margins.
 */
export function AmbientConstellation() {
  return (
    <ConstellationField
      mode="viewport"
      className="pointer-events-none fixed inset-0 -z-10"
      particleColor="rgba(13, 148, 136, 0.4)"
      lineColor="rgba(13, 148, 136, 0.09)"
      cursorLineColor="rgba(15, 118, 110, 0.32)"
      cursorGlowColor="rgba(20, 184, 166, 0.4)"
      density={30000}
      minParticles={22}
      maxParticles={55}
    />
  )
}
