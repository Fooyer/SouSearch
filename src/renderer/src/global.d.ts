export {}

interface SearchResult {
  id: string
  name: string
  comment?: string
  iconId: string
  hasIcon: boolean
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface DirsResult {
  ok: boolean
  dirs: string[]
}

interface ThemeSettings {
  type: 'solid' | 'gradient'
  color1: string
  color2?: string
}

interface LauncherSettings {
  shortcut: string
  appImageDirs: string[]
  showTray: boolean
  autostart: boolean
  theme: ThemeSettings
}

declare global {
  interface Window {
    launcher: {
      search: (query: string) => Promise<SearchResult[]>
      launch: (id: string) => Promise<ActionResult>
      hide: () => void
      resize: (height: number) => void
      getSettings: () => Promise<LauncherSettings>
      setShortcut: (accelerator: string) => Promise<ActionResult>
      pickAppImageDir: () => Promise<DirsResult>
      removeAppImageDir: (dir: string) => Promise<DirsResult>
      setAutostart: (enabled: boolean) => Promise<ActionResult>
      setShowTray: (enabled: boolean) => Promise<ActionResult>
      setTheme: (theme: ThemeSettings) => Promise<ActionResult>
      openKeyboardSettings: () => void
      quit: () => void
      copyToClipboard: (text: string) => void
      onShown: (cb: () => void) => void
      onIndexUpdated: (cb: () => void) => void
    }
  }
}
