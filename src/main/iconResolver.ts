import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, isAbsolute } from 'path'
import { execFileSync } from 'child_process'

const SIZES = ['48x48', '64x64', '32x32', '128x128', '256x256', 'scalable']
const EXTENSIONS = ['png', 'svg', 'xpm']

function detectActiveTheme(): string {
  try {
    // Fixed argv, no shell involved: safe even though this shells out to gsettings.
    const out = execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'icon-theme'], {
      timeout: 1000
    })
      .toString()
      .trim()
    const match = out.match(/'([^']+)'/)
    if (match) return match[1]
  } catch {
    // gsettings unavailable (non-GNOME session) or no result; fall back to hicolor.
  }
  return 'hicolor'
}

function themeDirs(theme: string): string[] {
  return [join(homedir(), '.local/share/icons', theme), join('/usr/share/icons', theme), join(homedir(), '.icons', theme)]
}

const activeTheme = detectActiveTheme()
const searchRoots = [...themeDirs(activeTheme), ...(activeTheme !== 'hicolor' ? themeDirs('hicolor') : [])]

const cache = new Map<string, string | undefined>()

export function resolveIconPath(icon: string | undefined): string | undefined {
  if (!icon) return undefined
  if (cache.has(icon)) return cache.get(icon)

  let result: string | undefined

  if (isAbsolute(icon) || icon.startsWith('~')) {
    const p = icon.startsWith('~') ? join(homedir(), icon.slice(1)) : icon
    if (existsSync(p)) result = p
  }

  if (!result) {
    search: for (const size of SIZES) {
      for (const root of searchRoots) {
        for (const ext of EXTENSIONS) {
          const candidate = join(root, size, 'apps', `${icon}.${ext}`)
          if (existsSync(candidate)) {
            result = candidate
            break search
          }
        }
      }
    }
  }

  if (!result) {
    for (const ext of EXTENSIONS) {
      const candidate = join('/usr/share/pixmaps', `${icon}.${ext}`)
      if (existsSync(candidate)) {
        result = candidate
        break
      }
    }
  }

  cache.set(icon, result)
  return result
}
