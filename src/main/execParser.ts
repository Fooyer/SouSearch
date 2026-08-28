/**
 * Tokenizes an Exec= value per the Desktop Entry Specification quoting rules
 * (no shell involved), then strips field codes (%f %F %u %U %d %D %n %N %i %c
 * %k %v %m) since we launch without passing file/URL arguments.
 */
export function parseExecToArgv(execValue: string): string[] {
  const tokens = tokenize(execValue)
  return tokens
    .map(stripFieldCodes)
    .filter((t) => t.length > 0)
}

function stripFieldCodes(token: string): string {
  return token.replace(/%[fFuUdDnNickvm]/g, '').replace(/%%/g, '%')
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '\\' && i + 1 < input.length && '"$`\\'.includes(input[i + 1])) {
        current += input[i + 1]
        i += 2
        continue
      }
      if (ch === '"') {
        inQuotes = false
        i++
        continue
      }
      current += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      i++
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1]
      i += 2
      continue
    }
    current += ch
    i++
  }

  if (current.length > 0) tokens.push(current)
  return tokens
}
