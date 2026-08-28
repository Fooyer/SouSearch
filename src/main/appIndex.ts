import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, watch } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parseDesktopFile } from './desktopEntryParser'
import { resolveIconPath } from './iconResolver'
import { getSettings } from './settings'

export interface IndexedApp {
  id: string
  name: string
  genericName?: string
  comment?: string
  exec: string
  terminal: boolean
  iconPath?: string
  kind: 'desktop' | 'appimage'
  path?: string
}

function xdgDataDirs(): string[] {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share')
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)
  const dirs = [dataHome, ...dataDirs].map((d) => join(d, 'applications'))
  // Extra locations not always covered by XDG_DATA_DIRS.
  dirs.push(join(homedir(), '.local/share/flatpak/exports/share/applications'))
  dirs.push('/var/lib/flatpak/exports/share/applications')
  dirs.push('/var/lib/snapd/desktop/applications')
  return [...new Set(dirs)].filter(existsSync)
}

function allScanDirs(): { desktopDirs: string[]; appImageDirs: string[] } {
  return {
    desktopDirs: xdgDataDirs(),
    appImageDirs: [...new Set(getSettings().appImageDirs)].filter(existsSync)
  }
}

let cachedIndex: IndexedApp[] = []
let dirSignature = ''

function computeSignature(dirs: string[]): string {
  return dirs
    .map((d) => {
      try {
        return `${d}:${statSync(d).mtimeMs}`
      } catch {
        return `${d}:0`
      }
    })
    .join('|')
}

function scanDesktopDirectory(dir: string, seenIds: Set<string>, out: IndexedApp[]): void {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return
  }

  for (const file of files) {
    if (!file.endsWith('.desktop')) continue
    // XDG precedence: the first directory in scan order (data-home first) wins for a given id.
    if (seenIds.has(file)) continue
    seenIds.add(file)

    const full = join(dir, file)
    let content: string
    try {
      content = readFileSync(full, 'utf-8')
    } catch {
      continue
    }

    const parsed = parseDesktopFile(content, full, file)
    if (!parsed || parsed.hidden || parsed.noDisplay) continue

    out.push({
      id: parsed.id,
      name: parsed.name,
      genericName: parsed.genericName,
      comment: parsed.comment,
      exec: parsed.exec,
      terminal: parsed.terminal,
      iconPath: resolveIconPath(parsed.icon),
      kind: 'desktop'
    })
  }
}

function prettifyAppImageName(filename: string): string {
  return filename
    .replace(/\.appimage$/i, '')
    // Strip the common "-<version>-<arch>" suffix AppImage filenames use
    // (e.g. "App-1.2.3-x86_64" -> "App"), then fall back to just tidying
    // separators if that leaves nothing usable.
    .replace(/[-_](v?\d[\w.]*)?[-_]?(x86_64|amd64|aarch64|arm64|armhf|i386|i686)$/i, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scanAppImageDirectory(dir: string, seenPaths: Set<string>, out: IndexedApp[]): void {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return
  }

  for (const file of files) {
    if (!/\.appimage$/i.test(file)) continue
    const full = join(dir, file)
    if (seenPaths.has(full)) continue
    seenPaths.add(full)

    let isFile = false
    try {
      isFile = statSync(full).isFile()
    } catch {
      continue
    }
    if (!isFile) continue

    out.push({
      id: full,
      name: prettifyAppImageName(file) || file,
      exec: full,
      terminal: false,
      kind: 'appimage',
      path: full
    })
  }
}

function cacheFile(): string {
  return join(app.getPath('userData'), 'app-index.json')
}

function persistCache(): void {
  try {
    writeFileSync(cacheFile(), JSON.stringify({ signature: dirSignature, entries: cachedIndex }))
  } catch {
    // Non-fatal: worst case we rebuild the index next launch.
  }
}

export function buildIndex(): IndexedApp[] {
  const { desktopDirs, appImageDirs } = allScanDirs()
  const out: IndexedApp[] = []

  const seenIds = new Set<string>()
  for (const dir of desktopDirs) scanDesktopDirectory(dir, seenIds, out)

  const seenPaths = new Set<string>()
  for (const dir of appImageDirs) scanAppImageDirectory(dir, seenPaths, out)

  cachedIndex = out.sort((a, b) => a.name.localeCompare(b.name))
  dirSignature = computeSignature([...desktopDirs, ...appImageDirs])
  persistCache()
  return cachedIndex
}

export function loadIndex(): IndexedApp[] {
  const { desktopDirs, appImageDirs } = allScanDirs()
  const signature = computeSignature([...desktopDirs, ...appImageDirs])
  try {
    const raw = readFileSync(cacheFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.signature === signature && Array.isArray(parsed.entries)) {
      cachedIndex = parsed.entries
      dirSignature = signature
      return cachedIndex
    }
  } catch {
    // No usable cache yet; fall through to a full scan.
  }
  return buildIndex()
}

export function getIndex(): IndexedApp[] {
  return cachedIndex
}

const watchedDirs = new Set<string>()
let debounce: NodeJS.Timeout | undefined
let lastOnChange: (() => void) | undefined

/**
 * Watches every currently known app source directory for changes. Safe to
 * call again later (e.g. after the user adds an AppImage folder in settings)
 * — already-watched directories are skipped so watchers never pile up.
 */
export function watchAppDirs(onChange: () => void): void {
  lastOnChange = onChange
  const scheduleRebuild = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      buildIndex()
      onChange()
    }, 500)
  }

  const { desktopDirs, appImageDirs } = allScanDirs()
  for (const dir of [...desktopDirs, ...appImageDirs]) {
    if (watchedDirs.has(dir)) continue
    try {
      watch(dir, { persistent: false }, scheduleRebuild)
      watchedDirs.add(dir)
    } catch {
      // Directory may not support watching (e.g. some overlay/flatpak mounts); ignore.
    }
  }
}

/** Re-scans for newly configured directories (e.g. a freshly added AppImage folder) and watches them too. */
export function rewatchAppDirs(): void {
  if (lastOnChange) watchAppDirs(lastOnChange)
}
