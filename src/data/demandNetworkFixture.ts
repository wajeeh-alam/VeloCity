import type { SimulationNetwork } from '../lib/corridorNetworkSimulation.ts'

/** Host-ready versioned example only; never automatically loaded as Toronto evidence. */
export const DEMO_NETWORK_METADATA = {
  isIllustrative: true,
  disclaimer: 'Synthetic routing fixture for integration testing. Geography, travel times, populations and OD weights are illustrative, not measured.',
} as const

/** Matches the stable eglinton-east catalogue ID so hosts can exercise the v2 adapter. */
export const DEMO_SIMULATION_NETWORK: SimulationNetwork = {
  schemaVersion: 'velocity.simulation-network.v1',
  coordinateReferenceSystem: 'EPSG:4326',
  version: 'synthetic-demo-1',
  sourceName: 'VeloCity synthetic integration fixture — not source-derived',
  sourceUrl: 'https://example.com/velocity/synthetic-network-fixture',
  isIllustrative: true,
  accessibilityMinutes: 15,
  stressPenalty: 3,
  maxLowStressDetourRatio: 2,
  nodes: [
    { id: 'demo-west', longitude: -79.27, latitude: 43.733, population: 100, destinations: 0 },
    { id: 'demo-east', longitude: -79.24, latitude: 43.74, population: 0, destinations: 2 },
    { id: 'demo-detour', longitude: -79.255, latitude: 43.75, population: 50, destinations: 0 },
  ],
  edges: [
    { id: 'demo-direct', from: 'demo-west', to: 'demo-east', minutes: 8, highStress: true, corridorId: 'eglinton-east' },
    { id: 'demo-detour-west', from: 'demo-west', to: 'demo-detour', minutes: 7, highStress: false },
    { id: 'demo-detour-east', from: 'demo-detour', to: 'demo-east', minutes: 7, highStress: false },
  ],
  flows: [{ id: 'demo-od', from: 'demo-west', to: 'demo-east', corridorId: 'eglinton-east', weight: 1 }],
}
