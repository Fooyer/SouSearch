// latin-ext (not the full multi-script bundle) keeps this small while still
// covering Portuguese accents — this app is 100% offline, so only the
// weights actually used are worth shipping.
import '@fontsource/nunito/latin-ext-400.css'
import '@fontsource/nunito/latin-ext-600.css'
import '@fontsource/nunito/latin-ext-700.css'
import './style.css'
import { computeThemeVars, applyThemeVars, type ThemeInput } from './contrast'
import { tryCalculate } from './calculator'

interface SearchResult {
  id: string
  name: string
  comment?: string
  iconId: string
  hasIcon: boolean
  isCalc?: boolean
}

const CALC_ID = '__calc__'

const appEl = document.getElementById('app') as HTMLDivElement
const queryInput = document.getElementById('query') as HTMLInputElement
const resultsList = document.getElementById('results') as HTMLUListElement
const mainBar = document.getElementById('main-bar') as HTMLDivElement
const settingsBar = document.getElementById('settings-bar') as HTMLDivElement
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement
const backBtn = document.getElementById('back-btn') as HTMLButtonElement
const settingsView = document.getElementById('settings-view') as HTMLDivElement
const currentShortcutEl = document.getElementById('current-shortcut') as HTMLSpanElement
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
const liveKeysEl = document.getElementById('live-keys') as HTMLDivElement
const settingsError = document.getElementById('settings-error') as HTMLParagraphElement
const openKbSettingsBtn = document.getElementById('open-kb-settings-btn') as HTMLButtonElement
const appimageDirsList = document.getElementById('appimage-dirs') as HTMLUListElement
const addDirBtn = document.getElementById('add-dir-btn') as HTMLButtonElement
const autostartSwitch = document.getElementById('autostart-switch') as HTMLButtonElement
const traySwitch = document.getElementById('tray-switch') as HTMLButtonElement
const generalError = document.getElementById('general-error') as HTMLParagraphElement
const quitBtn = document.getElementById('quit-btn') as HTMLButtonElement
const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'))
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>('.settings-tab'))
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-btn'))
const color1Input = document.getElementById('theme-color1') as HTMLInputElement
const color2Input = document.getElementById('theme-color2') as HTMLInputElement
const color2Field = document.getElementById('theme-color2-field') as HTMLLabelElement
const themeSwatchesEl = document.getElementById('theme-swatches') as HTMLDivElement

let selectedIndex = 0
let currentResults: SearchResult[] = []
let debounceHandle: number | undefined
let inSettings = false

function reportSize(): void {
  // rAF so the DOM has settled (icons/text reflow) before we measure.
  requestAnimationFrame(() => window.launcher.resize(appEl.scrollHeight))
}

// --- Main search view ---

function render(results: SearchResult[]): void {
  currentResults = results
  selectedIndex = 0
  resultsList.innerHTML = ''

  results.forEach((r, i) => {
    const li = document.createElement('li')
    li.className = 'result' + (i === 0 ? ' selected' : '')

    const icon = document.createElement('div')
    icon.className = 'icon'
    if (r.isCalc) {
      icon.textContent = '='
      icon.classList.add('fallback')
    } else if (r.hasIcon) {
      const img = document.createElement('img')
      img.src = `app-icon://${encodeURIComponent(r.iconId)}`
      img.alt = ''
      icon.appendChild(img)
    } else {
      icon.textContent = r.name.charAt(0).toUpperCase()
      icon.classList.add('fallback')
    }

    const text = document.createElement('div')
    text.className = 'text'
    const nameEl = document.createElement('div')
    nameEl.className = 'name'
    nameEl.textContent = r.name
    text.appendChild(nameEl)
    if (r.comment) {
      const commentEl = document.createElement('div')
      commentEl.className = 'comment'
      commentEl.textContent = r.comment
      text.appendChild(commentEl)
    }

    li.appendChild(icon)
    li.appendChild(text)
    li.addEventListener('mouseenter', () => {
      selectedIndex = i
      updateSelection()
    })
    li.addEventListener('click', () => launch(i))
    resultsList.appendChild(li)
  })

  reportSize()
}

function updateSelection(): void {
  Array.from(resultsList.children).forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIndex)
  })
  const el = resultsList.children[selectedIndex] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
}

async function search(query: string): Promise<void> {
  const results: SearchResult[] = await window.launcher.search(query)
  const calc = tryCalculate(query)
  if (calc.ok && calc.formatted !== undefined) {
    results.unshift({
      id: CALC_ID,
      name: calc.formatted,
      comment: `${query.trim()} — Enter para copiar`,
      iconId: '',
      hasIcon: false,
      isCalc: true
    })
  }
  render(results)
}

function launch(index: number): void {
  const entry = currentResults[index]
  if (!entry) return
  if (entry.isCalc) {
    window.launcher.copyToClipboard(entry.name)
    window.launcher.hide()
    return
  }
  window.launcher.launch(entry.id)
}

queryInput.addEventListener('input', () => {
  if (debounceHandle) window.clearTimeout(debounceHandle)
  debounceHandle = window.setTimeout(() => search(queryInput.value), 60)
})

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1)
    updateSelection()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex = Math.max(selectedIndex - 1, 0)
    updateSelection()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    launch(selectedIndex)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    window.launcher.hide()
  } else if (e.key === ',' && e.ctrlKey) {
    e.preventDefault()
    openSettings()
  }
})

function resetUI(): void {
  if (inSettings) closeSettings()
  queryInput.value = ''
  queryInput.focus()
  search('')
}

window.launcher.onShown(resetUI)
window.launcher.onIndexUpdated(() => {
  if (!inSettings) search(queryInput.value)
})

// Apply the saved theme immediately at boot, not just once settings are
// opened — the accent color affects the main search view too.
window.launcher.getSettings().then((s) => applyTheme(s.theme))

// --- Settings view ---

const TAB_ORDER = ['general', 'theme', 'shortcut', 'appimage']
const settingsNav = document.querySelector('.settings-nav') as HTMLElement

function switchTab(tab: string): void {
  navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab))
  tabPanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab))
  reportSize()
}

function activeTabIndex(): number {
  const active = navItems.find((b) => b.classList.contains('active'))?.dataset.tab
  const idx = TAB_ORDER.indexOf(active as string)
  return idx === -1 ? 0 : idx
}

function stepTab(delta: number): void {
  const next = (activeTabIndex() + delta + TAB_ORDER.length) % TAB_ORDER.length
  switchTab(TAB_ORDER[next])
  navItems[next].focus()
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab as string))
})

// Arrow-key navigation between sidebar tabs (standard tablist pattern).
settingsNav.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  stepTab(e.key === 'ArrowDown' ? 1 : -1)
})

// Ctrl+Tab / Ctrl+Shift+Tab cycles tabs from anywhere in settings, not just
// when focus happens to be on the sidebar — mirrors browser/app tab-cycling.
document.addEventListener('keydown', (e) => {
  if (!inSettings || recording || e.key !== 'Tab' || !e.ctrlKey) return
  e.preventDefault()
  stepTab(e.shiftKey ? -1 : 1)
})

async function openSettings(): Promise<void> {
  inSettings = true
  mainBar.classList.add('hidden')
  settingsBar.classList.remove('hidden')
  resultsList.classList.add('hidden')
  settingsView.classList.remove('hidden')
  settingsError.textContent = ''
  switchTab('general')
  navItems[0].focus()

  const s = await window.launcher.getSettings()
  currentShortcutEl.textContent = formatShortcutLabel(s.shortcut)
  renderAppImageDirs(s.appImageDirs)
  setSwitch(autostartSwitch, s.autostart)
  setSwitch(traySwitch, s.showTray)
  renderThemeForm(s.theme)
  reportSize()
}

function closeSettings(): void {
  stopRecording()
  inSettings = false
  mainBar.classList.remove('hidden')
  settingsBar.classList.add('hidden')
  resultsList.classList.remove('hidden')
  settingsView.classList.add('hidden')
  queryInput.focus()
  reportSize()
}

settingsBtn.addEventListener('click', () => openSettings())
backBtn.addEventListener('click', () => closeSettings())

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !inSettings) return
  e.preventDefault()
  if (recording) stopRecording()
  else closeSettings()
})

// --- Shortcut recording ---

let recording = false
let recordTimeoutHandle: number | undefined
const heldModifiers = new Set<string>()

const MODIFIER_KEY_NAMES: Record<string, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Super'
}

const CODE_TO_KEY: Record<string, string> = { Space: 'Space' }
for (let c = 65; c <= 90; c++) {
  const letter = String.fromCharCode(c)
  CODE_TO_KEY[`Key${letter}`] = letter
}
for (let d = 0; d <= 9; d++) CODE_TO_KEY[`Digit${d}`] = String(d)
for (let f = 1; f <= 12; f++) CODE_TO_KEY[`F${f}`] = `F${f}`

function updateLiveKeys(): void {
  if (heldModifiers.size === 0) {
    liveKeysEl.textContent = 'Aguardando teclas...'
    return
  }
  liveKeysEl.textContent = [...heldModifiers].join(' + ') + ' + ...'
}

function startRecording(): void {
  recording = true
  heldModifiers.clear()
  recordBtn.textContent = 'Cancelar'
  settingsError.textContent = ''
  liveKeysEl.classList.remove('hidden')
  updateLiveKeys()

  recordTimeoutHandle = window.setTimeout(() => {
    stopRecording()
    settingsError.textContent =
      'Nenhuma combinação detectada em 6s. Se você tentou usar a tecla Super e nada apareceu acima, o sistema provavelmente já está reservando essa tecla — tente outra combinação ou libere o atalho conflitante em "Atalhos de teclado do sistema".'
  }, 6000)
}

function stopRecording(): void {
  recording = false
  heldModifiers.clear()
  recordBtn.textContent = 'Gravar'
  liveKeysEl.classList.add('hidden')
  if (recordTimeoutHandle) {
    window.clearTimeout(recordTimeoutHandle)
    recordTimeoutHandle = undefined
  }
}

recordBtn.addEventListener('click', () => {
  if (recording) stopRecording()
  else startRecording()
})

openKbSettingsBtn.addEventListener('click', () => window.launcher.openKeyboardSettings())

document.addEventListener('keydown', async (e) => {
  if (!recording) return
  e.preventDefault()

  const modName = MODIFIER_KEY_NAMES[e.key]
  if (modName) {
    heldModifiers.add(modName)
    updateLiveKeys()
    return
  }

  const parts = new Set(heldModifiers)
  if (e.ctrlKey) parts.add('Ctrl')
  if (e.altKey) parts.add('Alt')
  if (e.shiftKey) parts.add('Shift')
  if (e.metaKey) parts.add('Super')

  const mapped = CODE_TO_KEY[e.code]
  if (!mapped || parts.size === 0) {
    settingsError.textContent = 'Combine ao menos um modificador (Ctrl/Alt/Shift/Super) com uma tecla.'
    return
  }

  const accelerator = [...parts, mapped].join('+')
  stopRecording()
  await applyShortcut(accelerator)
})

document.addEventListener('keyup', (e) => {
  if (!recording) return
  const modName = MODIFIER_KEY_NAMES[e.key]
  if (!modName) return

  heldModifiers.delete(modName)
  updateLiveKeys()

  // Released every modifier without ever pressing a second key: they tapped
  // a bare modifier (often Super) alone. The OS/Electron don't support that
  // as a global shortcut — explain why instead of leaving it unexplained.
  if (heldModifiers.size === 0) {
    const tapHint = modName === 'Super' ? ' Ou use a opção "Só a tecla Super (toque único)" logo abaixo.' : ''
    settingsError.textContent =
      `${modName} sozinho não pode virar atalho gravando assim — segure ${modName} e pressione outra tecla junto (ex.: ${modName}+Espaço).${tapHint}`
  }
})

document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => applyShortcut(btn.dataset.preset as string))
})

function formatShortcutLabel(value: string): string {
  return value === 'SuperTap' ? 'Super (toque único)' : value
}

async function applyShortcut(accelerator: string): Promise<void> {
  const result = await window.launcher.setShortcut(accelerator)
  if (result.ok) {
    currentShortcutEl.textContent = formatShortcutLabel(accelerator)
    settingsError.textContent = ''
  } else {
    settingsError.textContent = result.error || 'Falha ao registrar atalho.'
  }
}

// --- AppImage folders ---

function renderAppImageDirs(dirs: string[]): void {
  appimageDirsList.innerHTML = ''
  dirs.forEach((dir) => {
    const li = document.createElement('li')
    li.className = 'dir-row'

    const path = document.createElement('span')
    path.className = 'dir-path'
    path.textContent = dir
    path.title = dir

    const removeBtn = document.createElement('button')
    removeBtn.textContent = '✕'
    removeBtn.title = 'Remover pasta'
    removeBtn.addEventListener('click', async () => {
      const result = await window.launcher.removeAppImageDir(dir)
      renderAppImageDirs(result.dirs)
      reportSize()
    })

    li.appendChild(path)
    li.appendChild(removeBtn)
    appimageDirsList.appendChild(li)
  })
  reportSize()
}

addDirBtn.addEventListener('click', async () => {
  const result = await window.launcher.pickAppImageDir()
  renderAppImageDirs(result.dirs)
})

// --- General toggles ---

function setSwitch(el: HTMLButtonElement, on: boolean): void {
  el.setAttribute('aria-checked', String(on))
}

function isOn(el: HTMLButtonElement): boolean {
  return el.getAttribute('aria-checked') === 'true'
}

autostartSwitch.addEventListener('click', async () => {
  const next = !isOn(autostartSwitch)
  setSwitch(autostartSwitch, next)
  generalError.textContent = ''
  const result = await window.launcher.setAutostart(next)
  if (!result.ok) {
    setSwitch(autostartSwitch, !next)
    generalError.textContent = result.error || 'Falha ao configurar início automático.'
  }
})

traySwitch.addEventListener('click', async () => {
  const next = !isOn(traySwitch)
  setSwitch(traySwitch, next)
  generalError.textContent = ''
  const result = await window.launcher.setShowTray(next)
  if (!result.ok) {
    setSwitch(traySwitch, !next)
    generalError.textContent = result.error || 'Falha ao configurar o ícone da bandeja.'
  }
})

quitBtn.addEventListener('click', () => window.launcher.quit())

// --- Theme ---

const THEME_PRESETS: ThemeInput[] = [
  { type: 'solid', color1: '#5b8def' },
  { type: 'solid', color1: '#8b5cf6' },
  { type: 'solid', color1: '#22c55e' },
  { type: 'solid', color1: '#ef4444' },
  { type: 'solid', color1: '#f97316' },
  { type: 'solid', color1: '#ec4899' },
  { type: 'gradient', color1: '#5b8def', color2: '#8b5cf6' },
  { type: 'gradient', color1: '#f97316', color2: '#ec4899' },
  { type: 'gradient', color1: '#22c55e', color2: '#0ea5e9' }
]

function themePreviewBg(theme: ThemeInput): string {
  return theme.type === 'gradient' && theme.color2 ? `linear-gradient(135deg, ${theme.color1}, ${theme.color2})` : theme.color1
}

function sameTheme(a: ThemeInput, b: ThemeInput): boolean {
  return a.type === b.type && a.color1 === b.color1 && (a.type !== 'gradient' || a.color2 === b.color2)
}

function applyTheme(theme: ThemeInput): void {
  applyThemeVars(computeThemeVars(theme))
}

function renderSwatches(active: ThemeInput): void {
  themeSwatchesEl.innerHTML = ''
  THEME_PRESETS.forEach((preset) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'theme-swatch' + (sameTheme(preset, active) ? ' active' : '')
    btn.style.background = themePreviewBg(preset)
    btn.title = preset.type === 'gradient' ? `${preset.color1} → ${preset.color2}` : preset.color1
    btn.addEventListener('click', () => selectTheme(preset))
    themeSwatchesEl.appendChild(btn)
  })
}

function renderThemeForm(theme: ThemeInput): void {
  modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.themeMode === theme.type))
  color2Field.classList.toggle('hidden', theme.type !== 'gradient')
  color1Input.value = theme.color1
  color2Input.value = theme.color2 || '#8b5cf6'
  renderSwatches(theme)
}

async function selectTheme(theme: ThemeInput): Promise<void> {
  applyTheme(theme)
  renderThemeForm(theme)
  await window.launcher.setTheme(theme)
}

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.themeMode as 'solid' | 'gradient'
    selectTheme({ type, color1: color1Input.value, color2: type === 'gradient' ? color2Input.value : undefined })
  })
})

function currentFormMode(): 'solid' | 'gradient' {
  return modeButtons.find((b) => b.classList.contains('active'))?.dataset.themeMode === 'gradient' ? 'gradient' : 'solid'
}

color1Input.addEventListener('input', () => {
  const type = currentFormMode()
  selectTheme({ type, color1: color1Input.value, color2: type === 'gradient' ? color2Input.value : undefined })
})

color2Input.addEventListener('input', () => {
  selectTheme({ type: 'gradient', color1: color1Input.value, color2: color2Input.value })
})

search('')
