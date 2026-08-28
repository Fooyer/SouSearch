export interface RGB {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean
        .split('')
        .map((c) => c + c)
        .join('')
    : clean
  const num = parseInt(full, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const clamp = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`
}

function srgbToLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** WCAG contrast ratio between two colors: 1 (no contrast) to 21 (max). */
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

// Softened extremes read better on a saturated background than pure #fff/#000.
const NEAR_WHITE: RGB = { r: 250, g: 250, b: 252 }
const NEAR_BLACK: RGB = { r: 22, g: 22, b: 26 }

/** Picks whichever of near-white or near-black contrasts better against `bg`. */
export function pickContrastText(bg: RGB): RGB {
  const whiteRatio = contrastRatio(bg, NEAR_WHITE)
  const blackRatio = contrastRatio(bg, NEAR_BLACK)
  return whiteRatio >= blackRatio ? NEAR_WHITE : NEAR_BLACK
}

export interface ThemeInput {
  type: 'solid' | 'gradient'
  color1: string
  color2?: string
}

export interface ThemeVars {
  accentBg: string
  accentSolid: string
  accentText: string
  accentTextMuted: string
  accentOverlay: string
}

/**
 * Derives every CSS custom property the UI needs from a user-picked theme —
 * including a text color that's always readable against it, computed via
 * WCAG contrast ratio rather than assumed.
 */
export function computeThemeVars(theme: ThemeInput): ThemeVars {
  const c1 = hexToRgb(theme.color1)
  const c2 = theme.type === 'gradient' && theme.color2 ? hexToRgb(theme.color2) : c1
  // Text sits somewhere across the whole gradient, so base the contrast
  // decision on its midpoint rather than either single stop.
  const midpoint = mix(c1, c2, 0.5)
  const text = pickContrastText(midpoint)
  const textMuted = mix(text, midpoint, 0.32)
  const isLightText = text.r > 128

  return {
    accentBg: theme.type === 'gradient' && theme.color2 ? `linear-gradient(135deg, ${theme.color1}, ${theme.color2})` : theme.color1,
    accentSolid: theme.color1,
    accentText: rgbToHex(text),
    accentTextMuted: rgbToHex(textMuted),
    accentOverlay: isLightText ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.18)'
  }
}

export function applyThemeVars(vars: ThemeVars): void {
  const root = document.documentElement.style
  root.setProperty('--accent-bg', vars.accentBg)
  root.setProperty('--accent-solid', vars.accentSolid)
  root.setProperty('--accent-text', vars.accentText)
  root.setProperty('--accent-text-muted', vars.accentTextMuted)
  root.setProperty('--accent-overlay', vars.accentOverlay)
}
