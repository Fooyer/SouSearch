import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface FrecencyEntry {
  count: number
  lastUsed: number
}

type FrecencyMap = Record<string, FrecencyEntry>

function file(): string {
  return join(app.getPath('userData'), 'frecency.json')
}

let data: FrecencyMap = {}

export function loadFrecency(): void {
  try {
    if (existsSync(file())) data = JSON.parse(readFileSync(file(), 'utf-8'))
  } catch {
    data = {}
  }
}

export function recordLaunch(id: string): void {
  const entry = data[id] || { count: 0, lastUsed: 0 }
  entry.count += 1
  entry.lastUsed = Date.now()
  data[id] = entry
  try {
    writeFileSync(file(), JSON.stringify(data))
  } catch {
    // Non-fatal: usage ranking just won't persist across restarts.
  }
}

export function getFrecencyScore(id: string): number {
  const entry = data[id]
  if (!entry) return 0
  const ageDays = (Date.now() - entry.lastUsed) / 86_400_000
  const recencyBoost = Math.max(0, 10 - ageDays)
  return entry.count * 2 + recencyBoost
}

/** Raw last-launch timestamp (ms epoch), or 0 if the app was never launched. */
export function getLastUsed(id: string): number {
  return data[id]?.lastUsed ?? 0
}
