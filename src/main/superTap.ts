import { spawn, execFileSync, type ChildProcess } from 'child_process'

// A bare Super key press/release is never delivered to X11 clients as an
// ordinary key event — GNOME/Mutter (and X11 itself) treat it purely as a
// modifier. xcape watches the raw X11 event stream (via XRecord) and, when
// it sees Super pressed and released *alone* with nothing else in between,
// synthesizes a keypress for an unused keysym instead. F13 has no physical
// key on virtually any keyboard and nothing binds it by default, so it's
// safe to repurpose as a stand-in "Super tap" signal.
//
// Catch #1: F13 being a valid *keysym* doesn't mean it has a *keycode* in
// the current keyboard map — on a standard PC layout it usually doesn't,
// and with no keycode there's nothing for xcape to synthesize or for
// Electron's globalShortcut to grab.
//
// Catch #2 (the one that actually bit us): Electron/GDK read the X11
// keyboard map once at startup and never refresh it for the rest of the
// process's life. Mapping the keycode *after* the app is already running —
// e.g. only when the user first enables this mode — never takes effect, no
// matter how long you wait or retry. So this must run once, unconditionally,
// as early as possible at startup, before any window or globalShortcut call
// — see ensureTapKeycodeMapped().
const TAP_KEYSYM = 'F13'
const KEYCODE_SCAN_RANGE = { min: 191, max: 253 }

let xcapeProcess: ChildProcess | null = null
let mappedKeycode: number | null = null

export function isXcapeAvailable(): boolean {
  try {
    execFileSync('which', ['xcape'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function readKeymap(): string | null {
  try {
    return execFileSync('xmodmap', ['-pke'], { encoding: 'utf-8' })
  } catch {
    return null
  }
}

/**
 * A keycode already mapped to F13 from a previous run that didn't shut down
 * cleanly (killed dev-mode reload, crash, force-quit) — reusing it instead
 * of always hunting for a pristine slot keeps repeated ungraceful restarts
 * (very normal during `electron-vite dev`) from slowly eating every free
 * keycode in the scan range until none are left.
 */
function findExistingTapKeycode(keymap: string): number | null {
  for (const line of keymap.split('\n')) {
    const m = line.match(/^keycode\s+(\d+)\s*=\s*(.*)$/)
    if (m && m[2].trim().split(/\s+/).includes(TAP_KEYSYM)) return Number(m[1])
  }
  return null
}

function findFreeKeycode(keymap: string): number | null {
  const assigned = new Set<number>()
  for (const line of keymap.split('\n')) {
    const m = line.match(/^keycode\s+(\d+)\s*=\s*(.*)$/)
    if (m && m[2].trim().length > 0) assigned.add(Number(m[1]))
  }

  for (let kc = KEYCODE_SCAN_RANGE.min; kc <= KEYCODE_SCAN_RANGE.max; kc++) {
    if (!assigned.has(kc)) return kc
  }
  return null
}

/**
 * Call once, unconditionally, as early as possible at app startup —
 * regardless of whether Super-tap is the active shortcut yet. Harmless if
 * xcape isn't installed or Super-tap never gets used: it just leaves one
 * otherwise-unused keycode mapped to F13 for the session.
 */
export function ensureTapKeycodeMapped(): void {
  if (mappedKeycode !== null) return

  const keymap = readKeymap()
  if (keymap === null) return

  const existing = findExistingTapKeycode(keymap)
  if (existing !== null) {
    mappedKeycode = existing
    return
  }

  const freeKeycode = findFreeKeycode(keymap)
  if (freeKeycode === null) return
  try {
    execFileSync('xmodmap', ['-e', `keycode ${freeKeycode} = ${TAP_KEYSYM}`])
    mappedKeycode = freeKeycode
  } catch {
    // Super-tap just won't be available this session; startSuperTapRemap
    // below surfaces a clear error when the user actually tries to use it.
  }
}

function stopXcape(): void {
  if (!xcapeProcess) return
  try {
    xcapeProcess.kill()
  } catch {
    // Already gone; nothing to clean up.
  }
  xcapeProcess = null
}

export function startSuperTapRemap(): { ok: boolean; error?: string } {
  if (!isXcapeAvailable()) {
    return {
      ok: false,
      error:
        'O toque único do Super precisa do utilitário "xcape", que não está instalado. Rode no terminal: sudo apt install xcape'
    }
  }
  if (mappedKeycode === null) {
    return {
      ok: false,
      error: 'Não foi possível preparar a tecla auxiliar para o toque do Super neste sistema.'
    }
  }

  stopXcape()

  try {
    // -d ("debug") keeps xcape as a plain foreground process instead of its
    // default double-fork-into-a-daemon behavior — without it, the process
    // we spawn() exits almost immediately after forking, and the handle we
    // hold no longer refers to anything real, so kill() silently does
    // nothing and the actual daemon is orphaned and left running forever.
    xcapeProcess = spawn('xcape', ['-d', '-e', `Super_L=${TAP_KEYSYM};Super_R=${TAP_KEYSYM}`], { stdio: 'ignore' })
    xcapeProcess.on('error', (err) => {
      console.error('[superTap] xcape falhou', err)
      xcapeProcess = null
    })
    return { ok: true }
  } catch (err) {
    xcapeProcess = null
    return { ok: false, error: String(err) }
  }
}

/** Stops xcape when switching away from Super-tap mode. Keeps the keycode
 * mapped for the rest of the session — see the note on ensureTapKeycodeMapped. */
export function stopSuperTapRemap(): void {
  stopXcape()
}

/** Full teardown on app quit: stops xcape and releases the keycode mapping. */
export function releaseTapKeycode(): void {
  stopXcape()
  if (mappedKeycode !== null) {
    try {
      execFileSync('xmodmap', ['-e', `keycode ${mappedKeycode} = NoSymbol`])
    } catch {
      // Best-effort revert; leaving the keycode mapped is harmless if this fails.
    }
    mappedKeycode = null
  }
}

export { TAP_KEYSYM }
