// A minimal, hand-rolled arithmetic evaluator for the search box's calculator
// shortcut. Deliberately NOT eval()/Function() — those would run arbitrary
// JS from user-typed text, which is exactly the kind of injection this app's
// whole design (CSP, no shell, no eval) exists to avoid. This only ever
// walks a grammar of numbers, + - * / % ^, parentheses and unary +/-.

export interface CalcResult {
  ok: boolean
  formatted?: string
}

const VALID_CHARS = /^[\d\s+\-*/%^().]+$/

export function looksLikeMath(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length === 0) return false
  if (!VALID_CHARS.test(trimmed)) return false
  if (!/\d/.test(trimmed)) return false
  if (!/[+\-*/^%]/.test(trimmed)) return false
  return true
}

class ParseError extends Error {}

function evaluate(input: string): number {
  const s = input.replace(/\s+/g, '')
  let pos = 0

  const peek = (): string | undefined => s[pos]
  const consume = (ch: string): void => {
    if (s[pos] !== ch) throw new ParseError(`esperado '${ch}'`)
    pos++
  }

  function parseExpr(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++]
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  function parseTerm(): number {
    let value = parsePower()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[pos++]
      const rhs = parsePower()
      if (op === '*') value *= rhs
      else if (op === '/') {
        if (rhs === 0) throw new ParseError('divisão por zero')
        value /= rhs
      } else {
        value %= rhs
      }
    }
    return value
  }

  function parsePower(): number {
    const base = parseUnary()
    if (peek() === '^') {
      pos++
      return Math.pow(base, parsePower()) // right-associative
    }
    return base
  }

  function parseUnary(): number {
    if (peek() === '-') {
      pos++
      return -parseUnary()
    }
    if (peek() === '+') {
      pos++
      return parseUnary()
    }
    return parsePrimary()
  }

  function parsePrimary(): number {
    if (peek() === '(') {
      pos++
      const value = parseExpr()
      consume(')')
      return value
    }
    const start = pos
    while (pos < s.length && /[\d.]/.test(s[pos])) pos++
    if (pos === start) throw new ParseError('número esperado')
    const value = Number(s.slice(start, pos))
    if (Number.isNaN(value)) throw new ParseError('número inválido')
    return value
  }

  const result = parseExpr()
  if (pos !== s.length) throw new ParseError('caracteres inesperados')
  return result
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  // Trim FP noise (0.1 + 0.2) without collapsing genuinely long decimals.
  return String(parseFloat(value.toFixed(10)))
}

export function tryCalculate(query: string): CalcResult {
  if (!looksLikeMath(query)) return { ok: false }
  try {
    const value = evaluate(query)
    if (!Number.isFinite(value)) return { ok: false }
    return { ok: true, formatted: formatNumber(value) }
  } catch {
    return { ok: false }
  }
}
