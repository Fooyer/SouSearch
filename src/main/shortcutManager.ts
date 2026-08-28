import { globalShortcut } from 'electron'
import { startSuperTapRemap, stopSuperTapRemap, TAP_KEYSYM } from './superTap'

// Sentinel stored in settings.shortcut when the user picked "Super (toque
// único)" instead of a normal Ctrl/Alt/Shift+key combo.
export const SUPER_TAP_VALUE = 'SuperTap'

// Electron's recognized modifier tokens across platforms.
const MODIFIERS = new Set([
  'Ctrl',
  'Control',
  'Alt',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
  'Command',
  'Cmd',
  'CommandOrControl',
  'CmdOrCtrl',
  'Option'
])

/**
 * Requires at least one modifier plus exactly one trailing non-modifier key,
 * e.g. "Super+Space" or "Ctrl+Alt+Space" — never a bare key, which would
 * hijack normal typing system-wide. (The one bare-key exception, the
 * synthetic Super-tap signal, is handled entirely outside this validator.)
 */
export function isValidAccelerator(accelerator: string): boolean {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return false
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (MODIFIERS.has(key)) return false
  return mods.length > 0 && mods.every((m) => MODIFIERS.has(m))
}

let active: string | undefined

function teardown(value: string | undefined): void {
  if (!value) return
  if (value === SUPER_TAP_VALUE) {
    try {
      globalShortcut.unregister(TAP_KEYSYM)
    } catch {
      // Already unregistered; nothing to do.
    }
    stopSuperTapRemap()
  } else {
    try {
      globalShortcut.unregister(value)
    } catch {
      // Already unregistered; nothing to do.
    }
  }
}

function bringUp(value: string, onTrigger: () => void): { ok: boolean; error?: string } {
  if (value === SUPER_TAP_VALUE) {
    const tap = startSuperTapRemap()
    if (!tap.ok) return tap

    // The F13 keycode this relies on is mapped once at app startup (see
    // ensureTapKeycodeMapped) specifically so this register() call always
    // has a real keycode to grab — Electron/GDK never re-read the X11
    // keymap after startup, so mapping it only now, on demand, would
    // silently never work no matter how long you wait.
    let ok = false
    try {
      ok = globalShortcut.register(TAP_KEYSYM, onTrigger)
    } catch {
      ok = false
    }
    if (!ok) {
      stopSuperTapRemap()
      return { ok: false, error: 'Não foi possível registrar o atalho de toque do Super — tente novamente.' }
    }
    return { ok: true }
  }

  if (!isValidAccelerator(value)) {
    return {
      ok: false,
      error: 'Combinação inválida: use ao menos um modificador (Ctrl, Alt, Shift, Super) e uma tecla.'
    }
  }

  let ok = false
  try {
    ok = globalShortcut.register(value, onTrigger)
  } catch {
    // Electron's native accelerator parser throws (rather than returning
    // false) for a handful of malformed strings — treat that the same as a
    // failed registration instead of letting it blow up the IPC call.
    ok = false
  }
  if (!ok) {
    return {
      ok: false,
      error:
        'Não foi possível registrar o atalho — provavelmente já está em uso pelo sistema (ex.: o GNOME usa Super+Espaço para trocar layout de teclado).'
    }
  }
  return { ok: true }
}

/**
 * Switches the active global shortcut to `value` (a normal accelerator
 * string, or SUPER_TAP_VALUE). Tears down whatever was active first — xcape
 * process included, if applicable — and if the new value fails to register,
 * best-effort restores the previous one so the user isn't left with no
 * working shortcut at all.
 */
export async function applyShortcutSetting(
  value: string,
  onTrigger: () => void
): Promise<{ ok: boolean; error?: string }> {
  const previous = active
  teardown(previous)

  const result = await bringUp(value, onTrigger)
  if (!result.ok) {
    if (previous) await bringUp(previous, onTrigger)
    return result
  }

  active = value
  return { ok: true }
}

export function unregisterAll(): void {
  teardown(active)
  active = undefined
}
