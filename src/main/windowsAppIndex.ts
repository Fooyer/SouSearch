import { app } from 'electron'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, type Dirent } from 'fs'
import { join } from 'path'
import type { IndexedApp } from './appIndex'

// Resolves each shortcut's target and icon through WScript.Shell — the same
// COM object Explorer itself uses — instead of hand-parsing the .lnk binary
// format, which has many optional/versioned sections we'd otherwise have to
// replicate. Launching later goes through shell.openPath() on the .lnk path
// itself (see launcher.ts), so we only need the target here to drop dead
// shortcuts and to pick an icon to extract — not to launch anything.
const SCAN_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$InputJson
)

$ErrorActionPreference = 'SilentlyContinue'
# Without this, accented names (Câmera, Configurações, ...) come back mangled:
# PowerShell writes redirected stdout in the system OEM codepage by default,
# not UTF-8, which is what Node decodes it as on the other end.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$payload = Get-Content -Raw -LiteralPath $InputJson | ConvertFrom-Json
$iconDir = $payload.iconDir
if (-not (Test-Path -LiteralPath $iconDir)) {
  New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$results = New-Object System.Collections.ArrayList

foreach ($link in $payload.links) {
  $lnkPath = $link.path
  $iconOut = Join-Path $iconDir ($link.hash + '.png')

  try {
    $sc = $shell.CreateShortcut($lnkPath)
    $target = $sc.TargetPath
    $iconLocation = $sc.IconLocation
  } catch {
    continue
  }

  if ([string]::IsNullOrWhiteSpace($target)) { continue }
  if (-not (Test-Path -LiteralPath $target)) { continue }

  if (-not (Test-Path -LiteralPath $iconOut)) {
    try {
      $iconSourcePath = $target
      if ($iconLocation) {
        $iconLocationPath = $iconLocation.Split(',')[0].Trim()
        if ($iconLocationPath.Length -gt 0 -and (Test-Path -LiteralPath $iconLocationPath)) {
          $iconSourcePath = $iconLocationPath
        }
      }
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconSourcePath)
      if ($icon) {
        $bmp = $icon.ToBitmap()
        $bmp.Save($iconOut, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $icon.Dispose()
      }
    } catch {}
  }

  [void]$results.Add([PSCustomObject]@{
    path     = $lnkPath
    name     = [System.IO.Path]::GetFileNameWithoutExtension($lnkPath)
    target   = $target
    iconPath = if (Test-Path -LiteralPath $iconOut) { $iconOut } else { $null }
  })
}

ConvertTo-Json -InputObject @($results) -Depth 3 -Compress
`

interface ScannedShortcut {
  path: string
  name: string
  target: string
  iconPath: string | null
}

export function windowsStartMenuDirs(): string[] {
  const dirs = [
    process.env.APPDATA ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : undefined,
    process.env.ProgramData
      ? join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : undefined
  ].filter((d): d is string => !!d)
  return [...new Set(dirs)].filter(existsSync)
}

function findShortcuts(dir: string, out: string[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      findShortcuts(full, out)
    } else if (entry.isFile() && /\.lnk$/i.test(entry.name)) {
      out.push(full)
    }
  }
}

function runScan(lnkPaths: string[], iconDir: string): ScannedShortcut[] {
  if (lnkPaths.length === 0) return []

  const tmpDir = app.getPath('temp')
  const scriptPath = join(tmpDir, 'sousearch-winscan.ps1')
  const inputPath = join(tmpDir, `sousearch-winscan-input-${process.pid}.json`)

  const links = lnkPaths.map((p) => ({ path: p, hash: createHash('sha1').update(p).digest('hex') }))

  try {
    writeFileSync(scriptPath, SCAN_SCRIPT, 'utf-8')
    writeFileSync(inputPath, JSON.stringify({ iconDir, links }), 'utf-8')

    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InputJson', inputPath],
      { maxBuffer: 32 * 1024 * 1024, timeout: 30000, windowsHide: true }
    ).toString('utf-8')

    const trimmed = out.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    // Shell-out failed (PowerShell missing/blocked by policy, bad JSON, etc.)
    // — fall back to an empty index rather than crashing app startup.
    return []
  } finally {
    try {
      unlinkSync(inputPath)
    } catch {
      // Best-effort cleanup.
    }
  }
}

interface StartApp {
  Name: string
  AppID: string
}

// Get-StartApps reads the Start menu's own app cache, so it also surfaces
// packaged/UWP apps (Calculator, Settings, Store apps, ...) that have no
// .lnk file on disk for us to scan — that's the gap the shortcut scan above
// can't close on its own.
function runStartAppsScan(): StartApp[] {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        // Same OEM-codepage-vs-UTF8 mismatch as the shortcut scan above —
        // most packaged apps have accented names too.
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 15000, windowsHide: true }
    ).toString('utf-8')

    const trimmed = out.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function scanUwpApps(existingNames: Set<string>): IndexedApp[] {
  const out: IndexedApp[] = []
  const seenIds = new Set<string>()

  for (const item of runStartAppsScan()) {
    if (!item?.AppID || !item?.Name) continue
    // A packaged app's AppID looks like "Pkg.Family_8wekyb3d8bbwe!App"; a
    // classic Win32 entry's AppID is just its exe path, which the .lnk scan
    // above already covers — only the packaged ones fill a real gap here.
    if (!item.AppID.includes('!')) continue
    if (seenIds.has(item.AppID)) continue
    seenIds.add(item.AppID)
    if (existingNames.has(item.Name.trim().toLowerCase())) continue

    out.push({
      id: `uwp:${item.AppID}`,
      name: item.Name,
      exec: item.AppID,
      terminal: false,
      kind: 'uwp',
      path: undefined
    })
  }

  return out
}

// Curated ms-settings: deep links — these pages aren't backed by .lnk files
// or Start-menu entries at all, so nothing above can discover them. Names are
// prefixed to group them visually and keep them easy to search alongside apps.
const WINDOWS_SETTINGS: Array<[string, string]> = [
  ['Sistema', 'system'],
  ['Vídeo', 'display'],
  ['Som', 'sound'],
  ['Notificações', 'notifications'],
  ['Foco', 'focus'],
  ['Energia e bateria', 'powersleep'],
  ['Armazenamento', 'storagesense'],
  ['Multitarefa', 'multitasking'],
  ['Ativação', 'activation'],
  ['Área de trabalho remota', 'remotedesktop'],
  ['Compartilhar', 'sharing'],
  ['Área de transferência', 'clipboard'],
  ['Sobre o dispositivo', 'about'],
  ['Bluetooth e dispositivos', 'bluetooth'],
  ['Impressoras e scanners', 'printers'],
  ['Mouse', 'mousetouchpad'],
  ['Touchpad', 'devices-touchpad'],
  ['Digitação', 'typing'],
  ['Reprodução automática', 'autoplay'],
  ['USB', 'usb'],
  ['Rede e Internet', 'network-status'],
  ['Wi-Fi', 'network-wifi'],
  ['Ethernet', 'network-ethernet'],
  ['VPN', 'network-vpn'],
  ['Modo avião', 'network-airplanemode'],
  ['Hotspot móvel', 'network-mobilehotspot'],
  ['Proxy', 'network-proxy'],
  ['Cores', 'personalization-colors'],
  ['Temas', 'themes'],
  ['Plano de fundo', 'personalization-background'],
  ['Tela de bloqueio', 'lockscreen'],
  ['Fontes', 'fonts'],
  ['Barra de tarefas', 'taskbar'],
  ['Iniciar', 'personalization-start'],
  ['Aplicativos e recursos', 'appsfeatures'],
  ['Aplicativos padrão', 'defaultapps'],
  ['Aplicativos opcionais', 'optionalfeatures'],
  ['Inicialização automática', 'startupapps'],
  ['Contas', 'yourinfo'],
  ['E-mail e contas', 'emailandaccounts'],
  ['Opções de entrada', 'signinoptions'],
  ['Família', 'family-group'],
  ['Data e hora', 'dateandtime'],
  ['Idioma', 'regionlanguage'],
  ['Fala', 'speech'],
  ['Jogos', 'gaming-gamebar'],
  ['Modo de jogo', 'gaming-gamemode'],
  ['Xbox Game Bar', 'gaming-xboxnetworking'],
  ['Acessibilidade', 'easeofaccess'],
  ['Texto e visibilidade', 'easeofaccess-display'],
  ['Legendas', 'easeofaccess-closedcaptioning'],
  ['Privacidade', 'privacy'],
  ['Localização', 'privacy-location'],
  ['Câmera', 'privacy-webcam'],
  ['Microfone', 'privacy-microphone'],
  ['Windows Update', 'windowsupdate'],
  ['Segurança do Windows', 'windowsdefender'],
  ['Backup', 'backup'],
  ['Solução de problemas', 'troubleshoot'],
  ['Recuperação', 'recovery'],
  ['Desenvolvedor', 'developers']
]

function windowsSettingsEntries(): IndexedApp[] {
  return WINDOWS_SETTINGS.map(([label, page]) => ({
    id: `setting:${page}`,
    name: `Configurações: ${label}`,
    exec: `ms-settings:${page}`,
    terminal: false,
    kind: 'setting' as const,
    path: undefined
  }))
}

export function scanWindowsApps(): IndexedApp[] {
  const lnkPaths: string[] = []
  for (const dir of windowsStartMenuDirs()) findShortcuts(dir, lnkPaths)

  const iconDir = join(app.getPath('userData'), 'icon-cache')
  try {
    mkdirSync(iconDir, { recursive: true })
  } catch {
    // Non-fatal: icons just won't be cached/extracted this run.
  }

  const scanned = runScan(lnkPaths, iconDir)

  const seenShortcutNames = new Set<string>()
  const shortcuts: IndexedApp[] = scanned
    .filter((item) => item.target)
    // Installers commonly leave more than one .lnk for the same app (a
    // per-user Start Menu entry plus an all-users one, a root-level copy
    // alongside a vendor-subfolder one, a stale leftover from a reinstall
    // under a different target path, a Startup copy, ...) — collapse those
    // down to one result by name instead of listing the same app several
    // times. windowsStartMenuDirs() puts the per-user dir first, so when a
    // name collides that's the copy kept.
    .filter((item) => {
      const key = item.name.trim().toLowerCase()
      if (seenShortcutNames.has(key)) return false
      seenShortcutNames.add(key)
      return true
    })
    .map((item) => ({
      id: item.path,
      name: item.name,
      exec: item.target,
      terminal: false,
      iconPath: item.iconPath || undefined,
      kind: 'shortcut' as const,
      path: item.path
    }))

  const existingNames = new Set(shortcuts.map((s) => s.name.trim().toLowerCase()))
  const uwpApps = scanUwpApps(existingNames)

  const out = [...shortcuts, ...uwpApps, ...windowsSettingsEntries()]
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
