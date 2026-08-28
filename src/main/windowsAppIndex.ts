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

  const out: IndexedApp[] = scanned
    .filter((item) => item.target)
    .map((item) => ({
      id: item.path,
      name: item.name,
      exec: item.target,
      terminal: false,
      iconPath: item.iconPath || undefined,
      kind: 'shortcut' as const,
      path: item.path
    }))

  return out.sort((a, b) => a.name.localeCompare(b.name))
}
