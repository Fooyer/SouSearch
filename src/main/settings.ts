import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ThemeSettings {
  type: 'solid' | 'gradient'
  color1: string
  color2?: string
}

export interface Settings {
  shortcut: string
  appImageDirs: string[]
  showTray: boolean
  theme: ThemeSettings
}

export const DEFAULT_SHORTCUT = 'Ctrl+Space'
export const DEFAULT_THEME: ThemeSettings = { type: 'solid', color1: '#5b8def' }

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value)
}

function sanitizeTheme(value: unknown): ThemeSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_THEME
  const v = value as Record<string, unknown>
  const type = v.type === 'gradient' ? 'gradient' : 'solid'
  const color1 = isValidHex(v.color1) ? v.color1 : DEFAULT_THEME.color1
  const color2 = isValidHex(v.color2) ? v.color2 : undefined
  if (type === 'gradient' && !color2) return { type: 'solid', color1 }
  return { type, color1, color2 }
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function detectDefaultAppImageDirs(): string[] {
  const candidates = [join(homedir(), 'Applications'), join(homedir(), 'AppImages')]
  return candidates.filter(existsSync)
}

let current: Settings = { shortcut: DEFAULT_SHORTCUT, appImageDirs: [], showTray: true, theme: DEFAULT_THEME }

export function loadSettings(): Settings {
  try {
    if (existsSync(file())) {
      const parsed = JSON.parse(readFileSync(file(), 'utf-8'))
      const shortcut =
        typeof parsed.shortcut === 'string' && parsed.shortcut.length <= 64 ? parsed.shortcut : DEFAULT_SHORTCUT
      const appImageDirs = Array.isArray(parsed.appImageDirs)
        ? parsed.appImageDirs.filter((d: unknown) => typeof d === 'string')
        : []
      const showTray = typeof parsed.showTray === 'boolean' ? parsed.showTray : true
      const theme = sanitizeTheme(parsed.theme)
      current = { shortcut, appImageDirs, showTray, theme }
      return current
    }
  } catch {
    // Fall back to defaults below.
  }
  // First run (or unreadable file): seed with any conventional folders that already exist.
  current = { shortcut: DEFAULT_SHORTCUT, appImageDirs: detectDefaultAppImageDirs(), showTray: true, theme: DEFAULT_THEME }
  return current
}

export function getSettings(): Settings {
  return current
}

export function saveSettings(next: Settings): void {
  current = next
  try {
    writeFileSync(file(), JSON.stringify(current))
  } catch {
    // Non-fatal: settings still work for this session, just won't persist.
  }
}
