export interface DesktopEntry {
  id: string
  name: string
  genericName?: string
  comment?: string
  exec: string
  icon?: string
  terminal: boolean
  noDisplay: boolean
  hidden: boolean
  categories: string[]
  filePath: string
}

function getLocaleCandidates(): string[] {
  const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  const base = raw.split('.')[0]
  if (!base) return []
  const candidates = [base]
  if (base.includes('_')) candidates.push(base.split('_')[0])
  return candidates
}

function unescapeValue(value: string): string {
  return value
    .replace(/\\s/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
}

/**
 * Parses the [Desktop Entry] section of a freedesktop .desktop file.
 * Returns null for non-Application entries or entries missing required fields,
 * so callers can safely skip them without special-casing.
 */
export function parseDesktopFile(content: string, filePath: string, id: string): DesktopEntry | null {
  const lines = content.split(/\r?\n/)
  let inEntrySection = false
  const values = new Map<string, string>()

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inEntrySection = line === '[Desktop Entry]'
      continue
    }
    if (!inEntrySection) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    values.set(key, value)
  }

  const type = values.get('Type')
  if (type !== 'Application') return null

  const exec = values.get('Exec')
  if (!exec) return null

  const locales = getLocaleCandidates()
  const localized = (base: string): string | undefined => {
    for (const loc of locales) {
      const v = values.get(`${base}[${loc}]`)
      if (v) return unescapeValue(v)
    }
    const plain = values.get(base)
    return plain ? unescapeValue(plain) : undefined
  }

  const name = localized('Name')
  if (!name) return null

  return {
    id,
    name,
    genericName: localized('GenericName'),
    comment: localized('Comment'),
    exec,
    icon: values.get('Icon'),
    terminal: values.get('Terminal') === 'true',
    noDisplay: values.get('NoDisplay') === 'true',
    hidden: values.get('Hidden') === 'true',
    categories: (values.get('Categories') || '').split(';').filter(Boolean),
    filePath
  }
}
