import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

function autostartDir(): string {
  return join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'autostart')
}

function autostartFile(): string {
  return join(autostartDir(), 'search-launcher.desktop')
}

function buildExecLine(): string {
  // Electron's setLoginItemSettings isn't implemented on Linux, so we write a
  // standard freedesktop autostart entry ourselves. In a packaged build,
  // execPath is the app's own binary; in dev it's the electron binary plus
  // the project path, mirroring what `electron .` does.
  const execPath = process.execPath
  if (app.isPackaged) return `"${execPath}"`
  return `"${execPath}" "${app.getAppPath()}"`
}

// Windows has a real, built-in equivalent (registered under
// HKCU\...\Run via the Startup folder), unlike Linux where Electron's
// setLoginItemSettings isn't implemented at all — so there we still write
// the freedesktop autostart entry ourselves below.
function isAutostartEnabledWindows(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

function setAutostartWindows(enabled: boolean): { ok: boolean; error?: string } {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
    } else {
      // Mirrors buildExecLine()'s dev-mode handling below: in dev,
      // process.execPath is electron.exe itself, so it needs the project
      // path as an argument, same as running `electron .` would.
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] })
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function isAutostartEnabled(): boolean {
  if (process.platform === 'win32') return isAutostartEnabledWindows()
  return existsSync(autostartFile())
}

export function setAutostart(enabled: boolean): { ok: boolean; error?: string } {
  if (process.platform === 'win32') return setAutostartWindows(enabled)

  try {
    if (enabled) {
      mkdirSync(autostartDir(), { recursive: true })
      const content =
        ['[Desktop Entry]', 'Type=Application', 'Name=Launcher', `Exec=${buildExecLine()}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true'].join(
          '\n'
        ) + '\n'
      writeFileSync(autostartFile(), content)
    } else if (existsSync(autostartFile())) {
      unlinkSync(autostartFile())
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
