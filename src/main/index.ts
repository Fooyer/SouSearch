import { app, BrowserWindow, Tray, Menu, ipcMain, protocol, screen, session, dialog, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { loadIndex, buildIndex, getIndex, watchAppDirs, rewatchAppDirs } from './appIndex'
import { loadFrecency, recordLaunch } from './frecency'
import { loadSettings, getSettings, saveSettings, DEFAULT_SHORTCUT } from './settings'
import { applyShortcutSetting, unregisterAll } from './shortcutManager'
import { launchApp } from './launcher'
import { searchApps } from './search'
import { isAutostartEnabled, setAutostart } from './autostart'
import { ensureTapKeycodeMapped, releaseTapKeycode } from './superTap'
import { createTrayIcon } from './trayIcon'

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-icon', privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: false } }
])

// Must happen before Electron/GDK touch the X11 keyboard map at all — see
// the long comment in superTap.ts. Doing this later (even in
// app.whenReady()) is too late: the mapping would never be picked up for
// the rest of the process's life.
ensureTapKeycodeMapped()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let tray: Tray | null = null
  let pickerOpen = false

  app.on('second-instance', () => showWindow())

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 640,
      height: 76,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        devTools: isDev
      }
    })

    win.setMenu(null)
    win.on('blur', () => {
      if (!pickerOpen) hideWindow()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('will-attach-webview', (e) => e.preventDefault())

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    return win
  }

  function centerOnActiveDisplay(win: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { width } = win.getBounds()
    const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2)
    const y = Math.round(display.bounds.y + display.bounds.height * 0.22)
    win.setPosition(x, y)
  }

  function showWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
    centerOnActiveDisplay(mainWindow)
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('window-shown')
  }

  function hideWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  }

  function toggleWindow(): void {
    if (mainWindow && mainWindow.isVisible()) hideWindow()
    else showWindow()
  }

  function createTray(): void {
    if (tray) return
    tray = new Tray(createTrayIcon())
    tray.setToolTip('Launcher')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Mostrar', click: () => showWindow() },
        { label: 'Recarregar índice de apps', click: () => buildIndex() },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() }
      ])
    )
    tray.on('click', () => toggleWindow())
  }

  function destroyTray(): void {
    if (!tray) return
    tray.destroy()
    tray = null
  }

  function applyContentSecurityPolicy(): void {
    const devConnect = isDev ? ' ws://localhost:* http://localhost:*' : ''
    const csp = [
      "default-src 'self'",
      "img-src 'self' app-icon:",
      "style-src 'self'",
      "font-src 'self'",
      "script-src 'self'",
      `connect-src 'self'${devConnect}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join('; ')

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })
  }

  function registerIconProtocol(): void {
    protocol.handle('app-icon', (request) => {
      // The renderer only ever supplies an app id, never a filesystem path —
      // the actual icon path is looked up server-side, which rules out traversal.
      const id = decodeURIComponent(request.url.replace('app-icon://', '').replace(/\/$/, ''))
      const entry = getIndex().find((e) => e.id === id)
      if (!entry?.iconPath || !existsSync(entry.iconPath)) {
        return new Response(null, { status: 404 })
      }
      const data = readFileSync(entry.iconPath)
      const ext = entry.iconPath.split('.').pop()
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'xpm' ? 'image/x-xpixmap' : 'image/png'
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': mime } })
    })
  }

  app.whenReady().then(async () => {
    loadFrecency()
    loadSettings()
    loadIndex()
    applyContentSecurityPolicy()
    registerIconProtocol()
    if (getSettings().showTray) createTray()
    mainWindow = createWindow()

    const result = await applyShortcutSetting(getSettings().shortcut, toggleWindow)
    if (!result.ok) {
      console.error('[shortcut]', result.error)
      // The saved shortcut (e.g. Super-tap on a system that lost xcape) is
      // no longer usable — fall back to the default rather than leaving the
      // user with literally no way to open the launcher.
      const fallback = await applyShortcutSetting(DEFAULT_SHORTCUT, toggleWindow)
      if (fallback.ok) saveSettings({ ...getSettings(), shortcut: DEFAULT_SHORTCUT })
    }

    watchAppDirs(() => {
      mainWindow?.webContents.send('index-updated')
    })
  })

  ipcMain.handle('search', (_e, query: unknown) => {
    if (typeof query !== 'string') return []
    return searchApps(query.slice(0, 200))
  })

  ipcMain.handle('launch', (_e, id: unknown) => {
    if (typeof id !== 'string') return { ok: false, error: 'id inválido' }
    const entry = getIndex().find((e) => e.id === id)
    if (!entry) return { ok: false, error: 'app não encontrado no índice' }
    try {
      launchApp(entry)
      recordLaunch(id)
      hideWindow()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.on('hide', () => hideWindow())

  ipcMain.on('resize', (_e, height: unknown) => {
    if (typeof height !== 'number' || !mainWindow) return
    const clamped = Math.max(76, Math.min(620, Math.round(height)))
    // On Linux, resizable:false locks the WM size hints, which silently
    // blocks programmatic shrinking (growing still works). Toggle it off
    // just for the resize call so the window can shrink back down too.
    mainWindow.setResizable(true)
    mainWindow.setSize(640, clamped)
    mainWindow.setResizable(false)
  })

  ipcMain.handle('settings:get', () => ({ ...getSettings(), autostart: isAutostartEnabled() }))

  ipcMain.handle('settings:setAutostart', (_e, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return { ok: false, error: 'valor inválido' }
    return setAutostart(enabled)
  })

  ipcMain.handle('settings:setShowTray', (_e, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return { ok: false, error: 'valor inválido' }
    if (enabled) createTray()
    else destroyTray()
    saveSettings({ ...getSettings(), showTray: enabled })
    return { ok: true }
  })

  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

  ipcMain.handle('settings:setTheme', (_e, theme: unknown) => {
    if (typeof theme !== 'object' || theme === null) return { ok: false, error: 'tema inválido' }
    const t = theme as Record<string, unknown>
    if (t.type !== 'solid' && t.type !== 'gradient') return { ok: false, error: 'tipo de tema inválido' }
    if (!HEX_COLOR_RE.test(String(t.color1))) return { ok: false, error: 'cor 1 inválida' }
    if (t.type === 'gradient' && !HEX_COLOR_RE.test(String(t.color2))) {
      return { ok: false, error: 'cor 2 inválida' }
    }
    const next = {
      type: t.type as 'solid' | 'gradient',
      color1: t.color1 as string,
      ...(t.type === 'gradient' ? { color2: t.color2 as string } : {})
    }
    saveSettings({ ...getSettings(), theme: next })
    return { ok: true }
  })

  ipcMain.on('app:quit', () => app.quit())

  ipcMain.on('clipboard:writeText', (_e, text: unknown) => {
    if (typeof text !== 'string') return
    // Electron's native clipboard module, unlike the web Clipboard API,
    // isn't gated on document focus — reliable even if the window is
    // mid-hide by the time this runs.
    clipboard.writeText(text.slice(0, 10_000))
  })

  ipcMain.handle('settings:setShortcut', async (_e, accelerator: unknown) => {
    if (typeof accelerator !== 'string' || accelerator.length > 64) {
      return { ok: false, error: 'formato inválido' }
    }
    const result = await applyShortcutSetting(accelerator, toggleWindow)
    if (result.ok) saveSettings({ ...getSettings(), shortcut: accelerator })
    return result
  })

  ipcMain.handle('settings:pickAppImageDir', async () => {
    if (!mainWindow) return { ok: false, dirs: getSettings().appImageDirs }
    pickerOpen = true
    let result: Electron.OpenDialogReturnValue
    try {
      result = await dialog.showOpenDialog(mainWindow, {
        title: 'Escolher pasta de AppImages',
        properties: ['openDirectory']
      })
    } finally {
      pickerOpen = false
    }
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dirs: getSettings().appImageDirs }
    }
    const dir = result.filePaths[0]
    const settings = getSettings()
    if (!settings.appImageDirs.includes(dir)) {
      saveSettings({ ...settings, appImageDirs: [...settings.appImageDirs, dir] })
      buildIndex()
      rewatchAppDirs()
      mainWindow.webContents.send('index-updated')
    }
    return { ok: true, dirs: getSettings().appImageDirs }
  })

  ipcMain.on('system:openKeyboardSettings', () => {
    // Fixed argv, no user input involved — just a convenience shortcut to the
    // system's own keyboard-shortcuts panel so the user can free up a combo.
    const child = spawn('gnome-control-center', ['keyboard'], { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      spawn('gnome-control-center', [], { detached: true, stdio: 'ignore' }).unref()
    })
    child.unref()
  })

  ipcMain.handle('settings:removeAppImageDir', (_e, dir: unknown) => {
    const settings = getSettings()
    if (typeof dir !== 'string') return { ok: false, dirs: settings.appImageDirs }
    saveSettings({ ...settings, appImageDirs: settings.appImageDirs.filter((d) => d !== dir) })
    buildIndex()
    mainWindow?.webContents.send('index-updated')
    return { ok: true, dirs: getSettings().appImageDirs }
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray; only quit explicitly via the tray menu.
  })

  app.on('will-quit', () => {
    unregisterAll()
    releaseTapKeycode()
  })
}
