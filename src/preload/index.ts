import { contextBridge, ipcRenderer } from 'electron'

export interface SearchResult {
  id: string
  name: string
  comment?: string
  iconId: string
  hasIcon: boolean
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export interface DirsResult {
  ok: boolean
  dirs: string[]
}

export interface ThemeSettings {
  type: 'solid' | 'gradient'
  color1: string
  color2?: string
}

export interface LauncherSettings {
  shortcut: string
  appImageDirs: string[]
  showTray: boolean
  autostart: boolean
  theme: ThemeSettings
}

// Minimal, whitelisted surface — the renderer never gets ipcRenderer directly,
// only these specific request/response shapes.
const api = {
  search: (query: string): Promise<SearchResult[]> => ipcRenderer.invoke('search', query),
  launch: (id: string): Promise<ActionResult> => ipcRenderer.invoke('launch', id),
  hide: (): void => {
    ipcRenderer.send('hide')
  },
  resize: (height: number): void => {
    ipcRenderer.send('resize', height)
  },
  getSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke('settings:get'),
  setShortcut: (accelerator: string): Promise<ActionResult> =>
    ipcRenderer.invoke('settings:setShortcut', accelerator),
  pickAppImageDir: (): Promise<DirsResult> => ipcRenderer.invoke('settings:pickAppImageDir'),
  removeAppImageDir: (dir: string): Promise<DirsResult> => ipcRenderer.invoke('settings:removeAppImageDir', dir),
  setAutostart: (enabled: boolean): Promise<ActionResult> => ipcRenderer.invoke('settings:setAutostart', enabled),
  setShowTray: (enabled: boolean): Promise<ActionResult> => ipcRenderer.invoke('settings:setShowTray', enabled),
  setTheme: (theme: ThemeSettings): Promise<ActionResult> => ipcRenderer.invoke('settings:setTheme', theme),
  openKeyboardSettings: (): void => {
    ipcRenderer.send('system:openKeyboardSettings')
  },
  quit: (): void => {
    ipcRenderer.send('app:quit')
  },
  copyToClipboard: (text: string): void => {
    ipcRenderer.send('clipboard:writeText', text)
  },
  onShown: (cb: () => void): void => {
    ipcRenderer.on('window-shown', cb)
  },
  onIndexUpdated: (cb: () => void): void => {
    ipcRenderer.on('index-updated', cb)
  }
}

contextBridge.exposeInMainWorld('launcher', api)

export type LauncherAPI = typeof api
