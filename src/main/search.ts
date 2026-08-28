import fuzzysort from 'fuzzysort'
import { getIndex, type IndexedApp } from './appIndex'
import { getFrecencyScore, getLastUsed } from './frecency'

export interface SearchResult {
  id: string
  name: string
  comment?: string
  iconId: string
  hasIcon: boolean
}

const MAX_RESULTS = 9

function toResult(entry: IndexedApp): SearchResult {
  return {
    id: entry.id,
    name: entry.name,
    comment: entry.comment,
    iconId: entry.id,
    hasIcon: !!entry.iconPath
  }
}

export function searchApps(query: string): SearchResult[] {
  const index = getIndex()
  const trimmed = query.trim()

  if (trimmed === '') {
    // Empty query: show actual recently-launched apps first (most recent
    // launch time wins, like Spotlight/Alfred/Raycast), then pad with the
    // rest so the list isn't sparse before any usage history exists.
    const used = index.filter((e) => getLastUsed(e.id) > 0).sort((a, b) => getLastUsed(b.id) - getLastUsed(a.id))
    const unused = index.filter((e) => getLastUsed(e.id) === 0)
    return [...used, ...unused].slice(0, MAX_RESULTS).map(toResult)
  }

  const results = fuzzysort.go(trimmed, index, {
    keys: ['name', 'genericName'],
    limit: 50
  })

  const ranked = [...results]
    .sort((a, b) => b.score + getFrecencyScore(b.obj.id) - (a.score + getFrecencyScore(a.obj.id)))
    .slice(0, MAX_RESULTS)

  return ranked.map((r) => toResult(r.obj))
}
