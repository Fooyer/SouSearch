import { shell } from 'electron'
import { spawn } from 'child_process'
import { accessSync, chmodSync, constants } from 'fs'
import { homedir } from 'os'
import { parseExecToArgv } from './execParser'
import type { IndexedApp } from './appIndex'

const TERMINAL = 'x-terminal-emulator'

function buildTerminalArgs(command: string, argv: string[]): string[] {
  // xterm and its direct derivatives don't understand "--"; everything else
  // Debian's x-terminal-emulator alternative resolves to does.
  if (command.includes('xterm')) return ['-e', ...argv]
  return ['--', ...argv]
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    cwd: homedir(),
    shell: false
  })
  child.on('error', (err) => {
    console.error('[launcher] falha ao iniciar', command, err)
  })
  child.unref()
}

function launchShortcut(entry: IndexedApp): void {
  if (!entry.path) throw new Error('Atalho sem caminho definido')
  // shell.openPath resolves the .lnk exactly like Explorer would (target,
  // arguments, working directory, file-type association, elevation) —
  // there's no robust way to replicate that by spawning the target ourselves,
  // since some shortcuts point at non-executables (.msc, .cpl, ...) that only
  // work through the shell's association lookup.
  shell.openPath(entry.path).then((err) => {
    if (err) console.error('[launcher] falha ao abrir atalho', entry.path, err)
  })
}

function launchUwpApp(appId: string): void {
  // Packaged apps have no filesystem target to spawn — shell:AppsFolder is
  // the virtual folder Explorer itself uses to resolve and launch them.
  spawnDetached('explorer.exe', [`shell:AppsFolder\\${appId}`])
}

function launchSetting(uri: string): void {
  // ms-settings: is a registered URI scheme, not a file path, so it needs
  // openExternal (ShellExecute) rather than openPath.
  shell.openExternal(uri).catch((err) => {
    console.error('[launcher] falha ao abrir configuração', uri, err)
  })
}

function launchAppImage(filePath: string): void {
  try {
    accessSync(filePath, constants.X_OK)
  } catch {
    // Most "double-click does nothing" AppImage complaints are just a missing
    // +x bit after download; fix it here instead of failing with a cryptic EACCES.
    try {
      chmodSync(filePath, 0o755)
    } catch (err) {
      console.error('[launcher] não foi possível tornar o AppImage executável', filePath, err)
    }
  }
  spawnDetached(filePath, [])
}

/**
 * Launches an already-indexed app. `entry` must come from the current index
 * (looked up by id in the IPC handler) — never build this from raw renderer
 * input, since Exec strings/paths are executed via spawn with an argv array.
 */
export function launchApp(entry: IndexedApp): void {
  if (entry.kind === 'appimage') {
    if (!entry.path) throw new Error('AppImage sem caminho definido')
    launchAppImage(entry.path)
    return
  }

  if (entry.kind === 'shortcut') {
    launchShortcut(entry)
    return
  }

  if (entry.kind === 'uwp') {
    launchUwpApp(entry.exec)
    return
  }

  if (entry.kind === 'setting') {
    launchSetting(entry.exec)
    return
  }

  const argv = parseExecToArgv(entry.exec)
  if (argv.length === 0) throw new Error('Exec vazio após parsing')

  const command = entry.terminal ? TERMINAL : argv[0]
  const args = entry.terminal ? buildTerminalArgs(TERMINAL, argv) : argv.slice(1)
  spawnDetached(command, args)
}
