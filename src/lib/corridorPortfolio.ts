import type { Corridor, PortfolioNetworkState } from './corridorDomain.ts'
import { evaluateScore } from './corridorScoring.ts'

export type PortfolioCandidate = { corridor: Corridor; dependsOn?: string[] }
export type PortfolioRollout = {
  years: Array<PortfolioNetworkState & { builtCorridorIds: string[] }>
  rankedCorridorIds: string[]
  unbuiltCorridorIds: string[]
  warnings: string[]
}
/** Rank by recalculated tier, descending score, then ASCII stable ID. Dependencies must be built in a prior year. */
export function generatePortfolioRollout(candidates: PortfolioCandidate[], capacityPerYear = 2): PortfolioRollout {
  if (!Number.isInteger(capacityPerYear) || capacityPerYear < 0) throw new Error('Annual corridor capacity must be a nonnegative integer')
  const ids = candidates.map(({ corridor }) => corridor.id)
  if (ids.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('Portfolio requires unique stable corridor IDs')
  const tiers = { Top: 0, High: 1, Medium: 2, Low: 3 }
  const ranked = candidates.map((candidate) => ({ ...candidate, score: evaluateScore(candidate.corridor.inputs) })).sort((a, b) => tiers[a.score.tier] - tiers[b.score.tier] || b.score.meanScore - a.score.meanScore || (a.corridor.id < b.corridor.id ? -1 : 1))
  const active = new Set<string>()
  const warnings: string[] = []
  const known = new Set(ids)
  for (const item of ranked) {
    const dependencies = item.dependsOn ?? []
    if (new Set(dependencies).size !== dependencies.length) throw new Error(`Duplicate dependencies for ${item.corridor.id}`)
    for (const dependency of dependencies) if (!known.has(dependency)) warnings.push(`${item.corridor.id} depends on unknown corridor ${dependency}; it cannot be scheduled.`)
  }
  const years: PortfolioRollout['years'] = []
  for (const year of [1, 2, 3] as const) {
    const eligible = ranked.filter((item) => !active.has(item.corridor.id) && (item.dependsOn ?? []).every((id) => active.has(id)))
    const builtCorridorIds = eligible.slice(0, capacityPerYear).map((item) => item.corridor.id)
    builtCorridorIds.forEach((id) => active.add(id))
    years.push({ horizonYear: year, builtCorridorIds, activeCorridorIds: [...active].sort() })
  }
  const unbuiltCorridorIds = ranked.map((item) => item.corridor.id).filter((id) => !active.has(id))
  if (unbuiltCorridorIds.length) warnings.push('Some corridors remain unbuilt because of annual capacity, missing prerequisites, or cyclic dependencies.')
  return { years, rankedCorridorIds: ranked.map((item) => item.corridor.id), unbuiltCorridorIds, warnings }
}
