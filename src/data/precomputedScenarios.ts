export type RoutedFlow = {
  flowId: string
  weight: number
  before: { coordinates: [number, number][] }
  after: { coordinates: [number, number][] }
}

export type PrecomputedScenario = {
  corridorId: string
  status: 'precomputed' | 'blocked'
  blockers: string[]
  simulations: Array<{
    partitionId: string
    simulation: {
      mode: string
      disclaimer: string
      routes: RoutedFlow[]
    }
  }>
}

export type PrecomputedBundle = {
  schemaVersion: 'velocity.b-precompute.v2'
  scenarios: PrecomputedScenario[]
}

export function parsePrecomputedBundle(value: unknown): PrecomputedBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('B precompute bundle must be an object')
  }
  const bundle = value as Partial<PrecomputedBundle>
  if (bundle.schemaVersion !== 'velocity.b-precompute.v2' || !Array.isArray(bundle.scenarios)) {
    throw new Error('Unsupported B precompute bundle')
  }
  return bundle as PrecomputedBundle
}

export async function loadPrecomputedBundle(fetcher: typeof fetch = fetch): Promise<PrecomputedBundle> {
  const response = await fetcher(`${import.meta.env.BASE_URL}data/b-precomputed.json`)
  if (!response.ok) throw new Error(`B routing data failed to load (${response.status})`)
  return parsePrecomputedBundle(await response.json())
}
