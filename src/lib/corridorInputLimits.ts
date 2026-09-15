/** Synchronous browser adapters accept bounded JSON, not arbitrarily large graphs. */
export const INPUT_LIMITS = {
  errors: 20, stringLength: 2048, idLength: 128, depth: 12,
  objectKeys: 128, arrayLength: 2048, visitedValues: 100_000,
  records: 512, rawFeatures: 64, geometryPoints: 512, sourceUrls: 8, sourceIds: 64,
  spatialGroups: 2048, networkNodes: 48, networkEdges: 128, networkFlows: 64,
  routingWork: 5_000_000,
} as const

/** Stops before allocation-heavy hashing, sorting or routing. Includes cyclic inputs. */
export function boundedJsonError(value: unknown): string | undefined {
  let visited = 0
  function visit(current: unknown, depth: number): string | undefined {
    if (++visited > INPUT_LIMITS.visitedValues) return 'Input exceeds aggregate value limit'
    if (depth > INPUT_LIMITS.depth) return 'Input exceeds nesting limit'
    if (typeof current === 'string' && current.length > INPUT_LIMITS.stringLength) return 'Input exceeds string length limit'
    if (!current || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      if (current.length > INPUT_LIMITS.arrayLength) return 'Input exceeds array cardinality limit'
      for (const item of current) { const error = visit(item, depth + 1); if (error) return error }
    } else {
      let count = 0
      for (const key in current) {
        if (!Object.hasOwn(current, key)) continue
        if (++count > INPUT_LIMITS.objectKeys) return 'Input exceeds object key limit'
        if (key.length > INPUT_LIMITS.idLength) return 'Input exceeds property name length limit'
        const error = visit((current as Record<string, unknown>)[key], depth + 1)
        if (error) return error
      }
    }
    return undefined
  }
  return visit(value, 0)
}

export function addValidationError(errors: string[], message: string): void {
  if (errors.length < INPUT_LIMITS.errors) errors.push(message)
}
