import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import { TorontoMap } from './TorontoMap.tsx'
import CorridorsView from './views/CorridorsView.tsx'
import { DataSourcesView } from './views/DataSourcesView.tsx'
import { NetworkView } from './views/NetworkView.tsx'
import {
  SCORE_INPUT_SEMANTICS,
  SCORE_KEYS,
  SIMULATION_METRIC_DEFINITIONS,
  type Corridor,
  type CorridorSimulation,
  type SimulationMetricKey,
} from './data/corridors.ts'
import {
  loadOpportunityArtifact,
  type OpportunityArtifact,
  type OpportunityProfile,
} from './data/opportunities.ts'
import {
  loadPrecomputedBundle,
  type PrecomputedBundle,
  type RoutedFlow,
} from './data/precomputedScenarios.ts'

type IconName = 'overview' | 'route' | 'network' | 'database' | 'document' | 'search' | 'collapse'
type ViewId = 'overview' | 'corridors' | 'network' | 'data-sources'

const viewTitles: Record<ViewId, string> = {
  overview: 'Network overview',
  corridors: 'Corridor portfolio',
  network: 'Network coverage',
  'data-sources': 'Data sources',
}

const metricLabels: Record<SimulationMetricKey, string> = {
  lowStressTrips: 'Low-stress trips',
  populationConnected: 'Population connected',
  destinationsReached: 'Destinations reached',
  dangerousSegments: 'High-stress segments',
}

const metricFooters: Record<SimulationMetricKey, string> = {
  lowStressTrips: 'More people cycling',
  populationConnected: 'Greater access',
  destinationsReached: 'More opportunities',
  dangerousSegments: 'Lower-risk network',
}

const scoreChartLabels = {
  safety: 'Safety',
  connectivity: 'Connect.',
  equity: 'Equity',
  currentDemand: 'Demand',
  potentialDemand: 'Potential',
  transit: 'Transit',
  barriers: 'Barriers',
  coverage: 'Coverage',
  destinations: 'Dest.',
}

function Icon({ name }: { name: IconName }) {
  let paths: ReactNode
  if (name === 'overview') {
    paths = <><path d="M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z" /></>
  } else if (name === 'route') {
    paths = <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7.5 16.5 12 12m0 0 4.5-4.5M12 12h5a3 3 0 0 0 3-3V8" /></>
  } else if (name === 'network') {
    paths = <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="m10.7 7.2-4.4 8.6m7-8.6 4.4 8.6M7.5 18h9" /></>
  } else if (name === 'database') {
    paths = <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>
  } else if (name === 'document') {
    paths = <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>
  } else if (name === 'search') {
    paths = <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>
  } else {
    paths = <><path d="M8 5 3 12l5 7M21 5h-8v14h8" /></>
  }

  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>
}

function formatMetric(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : value.toLocaleString()
}

function opportunityToCorridor(opportunity: OpportunityProfile): Corridor {
  const prediction = opportunity.evidence.prediction
  return {
    id: opportunity.corridorId,
    name: opportunity.name,
    subtitle: opportunity.subtitle,
    tier: opportunity.priority.tier,
    meanScore: opportunity.priority.score,
    inputs: opportunity.evidence.inputScores,
    path: '',
    color: '#7067e8',
    rolloutYear: opportunity.priority.rolloutYear,
    plannedRolloutYear: opportunity.priority.rolloutYear,
    summary: `${opportunity.sourceStatus}. Trained demand evidence: ${prediction.relativeBicyclesPerObservedHour.toFixed(2)} relative bicycles per observed hour (${prediction.uncertainty.lower.toFixed(2)}–${prediction.uncertainty.upper.toFixed(2)} provisional interval).`,
    provenance: {
      candidate: {
        kind: 'plan-backed',
        sourceName: 'City of Toronto Cycling Network Plan',
        sourceUrl: 'https://www.toronto.ca/services-payments/streets-parking-transportation/cycling-in-toronto/cycling-infrastructure-definitions/cycling-network-plan/',
      },
      observedDemand: {
        kind: 'counter-observation',
        sourceName: 'City of Toronto bicycle counters',
        sourceUrl: 'https://open.toronto.ca/',
        observationStart: opportunity.evidence.observation.start,
        observationEnd: opportunity.evidence.observation.end,
      },
    },
  }
}

function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [built, setBuilt] = useState(false)
  const [year, setYear] = useState<1 | 2 | 3>(1)
  const [query, setQuery] = useState('')
  const [activeView, setActiveView] = useState<ViewId>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [artifact, setArtifact] = useState<OpportunityArtifact | null>(null)
  const [routingBundle, setRoutingBundle] = useState<PrecomputedBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    Promise.all([loadOpportunityArtifact(), loadPrecomputedBundle()])
      .then(([opportunities, routing]) => {
        if (!live) return
        setArtifact(opportunities)
        setRoutingBundle(routing)
        setSelectedId(opportunities.records[0]?.corridorId ?? null)
        setYear(opportunities.records[0]?.priority.rolloutYear ?? 1)
      })
      .catch((error: unknown) => {
        if (live) setLoadError(error instanceof Error ? error.message : 'Model artifacts failed to load')
      })
    return () => { live = false }
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const corridorData = useMemo(
    () => artifact?.records.map(opportunityToCorridor) ?? [],
    [artifact],
  )
  const activeIds = useMemo(() => artifact?.portfolio.years
    .filter((entry) => entry.year <= year)
    .flatMap((entry) => entry.corridorIds) ?? [], [artifact, year])
  const visibleCorridors = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? corridorData.filter((corridor) => `${corridor.name} ${corridor.subtitle}`.toLowerCase().includes(normalized))
      : corridorData
  }, [corridorData, query])

  const selectedOpportunity = artifact?.records.find((record) => record.corridorId === selectedId) ?? artifact?.records[0]
  const selected = corridorData.find((corridor) => corridor.id === selectedOpportunity?.corridorId) ?? corridorData[0]
  const routingScenario = routingBundle?.scenarios.find((scenario) => scenario.corridorId === selectedOpportunity?.corridorId)
  const routedFlows: RoutedFlow[] = routingScenario?.status === 'precomputed'
    ? routingScenario.simulations.flatMap((entry) => entry.simulation.routes)
    : []

  if (loadError) {
    return <main className="page-frame load-state"><strong>VeloCity could not load the model artifacts.</strong><p>{loadError}</p></main>
  }

  if (!artifact || !routingBundle || !selectedOpportunity || !selected || !selectedId) {
    return <main className="page-frame load-state"><strong>Loading Toronto corridor evidence…</strong></main>
  }

  const simulation: CorridorSimulation = {
    before: selectedOpportunity.comparison.before,
    after: selectedOpportunity.comparison.after,
    agents: selectedOpportunity.comparison.representativeAgents.map((agent, index) => ({
      id: agent.id,
      delay: index * 0.12,
      path: '',
      weight: agent.weight,
      weightUnit: 'weighted-trips-per-weekday',
    })),
    disclaimer: artifact.portfolio.disclaimer,
    artifactId: artifact.artifactId,
    warnings: selectedOpportunity.comparison.warnings,
    demand: {
      prediction: selectedOpportunity.evidence.prediction.relativeBicyclesPerObservedHour,
      lower: selectedOpportunity.evidence.prediction.uncertainty.lower,
      upper: selectedOpportunity.evidence.prediction.uncertainty.upper,
      unit: 'dimensionless-relative-hourly-demand',
    },
  }
  const shownMetrics = built ? simulation.after : simulation.before
  const selectedScore = selectedOpportunity.priority.score
  const highestScore = Math.max(...SCORE_KEYS.map((key) => selected.inputs[key]))

  function selectCorridor(corridor: Corridor) {
    setSelectedId(corridor.id)
    setYear(corridor.plannedRolloutYear ?? corridor.rolloutYear as 1 | 2 | 3)
    setBuilt(false)
  }

  function selectOpportunity(opportunity: OpportunityProfile) {
    setSelectedId(opportunity.corridorId)
    setYear(opportunity.priority.rolloutYear)
    setBuilt(false)
  }

  return (
    <div className="page-frame">
      <a className="skip-link" href="#main-content">Skip to dashboard</a>
      <section className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} aria-label="VeloCity planning dashboard">
        <header className="topbar">
          <div className="brand-area">
            <div className="brand-mark" aria-hidden="true">V</div>
            <strong>VeloCity</strong>
            <button className="icon-button collapse-button" type="button" aria-label="Collapse sidebar" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}><Icon name="collapse" /></button>
          </div>
          <div className="page-title">{viewTitles[activeView]}</div>
          <div className="top-actions">
            {activeView === 'overview' && (
              <label className="search-control">
                <Icon name="search" />
                <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search corridors..." />
                <kbd>⌘ K</kbd>
              </label>
            )}
            <span className="profile-badge" aria-label="VeloCity workspace">VC</span>
          </div>
        </header>

        <div className="app-body">
          <aside className="sidebar">
            <nav aria-label="Primary navigation">
              <span className="nav-label">Planning</span>
              <button type="button" className={`nav-item ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setActiveView('overview')}><Icon name="overview" /><span>Overview</span></button>
              <button type="button" className={`nav-item ${activeView === 'corridors' ? 'active' : ''}`} onClick={() => setActiveView('corridors')}><Icon name="route" /><span>Corridors</span></button>
              <button type="button" className={`nav-item ${activeView === 'network' ? 'active' : ''}`} onClick={() => setActiveView('network')}><Icon name="network" /><span>Network</span></button>
              <button type="button" className={`nav-item ${activeView === 'data-sources' ? 'active' : ''}`} onClick={() => setActiveView('data-sources')}><Icon name="database" /><span>Data sources</span></button>
            </nav>
            <div className="sidebar-foot"><strong>Toronto</strong><span>Planning evidence, not an official recommendation.</span></div>
          </aside>

          <main className={`content ${activeView === 'overview' ? '' : 'content-view'}`} id="main-content">
            {activeView === 'overview' ? <>
            <div className="content-heading">
              <div>
                <h1>Toronto network overview</h1>
                <p>Illustrative weekday effects for {selected.name}</p>
              </div>
              <div className="updated"><span>Scenario year {year}</span><b>{activeIds.length} active corridors</b></div>
            </div>

            <section className="kpi-grid" aria-label="Scenario metrics">
              {(Object.keys(SIMULATION_METRIC_DEFINITIONS) as SimulationMetricKey[]).map((key) => {
                const definition = SIMULATION_METRIC_DEFINITIONS[key]
                const before = simulation.before[key]
                const after = simulation.after[key]
                const isLower = definition.betterDirection === 'lower'
                const change = before === 0 ? 0 : Math.round(Math.abs(after - before) / before * 100)
                return (
                  <article className="kpi-card" key={key}>
                    <div className="kpi-head"><span>{metricLabels[key]}</span></div>
                    <strong>{formatMetric(shownMetrics[key])}</strong>
                    <div className="kpi-change"><b>{isLower ? '↓' : '↑'} {change}%</b><span>vs. current</span></div>
                    <div className="kpi-footer"><span>{metricFooters[key]}</span><b>→</b></div>
                  </article>
                )
              })}
            </section>

            <section className="analysis-grid">
              <article className="card chart-card" aria-labelledby="profile-title">
                <div className="card-heading">
                  <div><h2 id="profile-title">Opportunity profile</h2><p>Relative score across nine planning factors</p></div>
                  <span>{Math.round(selectedScore)} / 100</span>
                </div>
                <div className="chart">
                  <div className="y-axis"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
                  <div className="plot">
                    <div className="grid-lines" aria-hidden="true"><i /><i /><i /><i /><i /></div>
                    <div className="bars">
                      {SCORE_KEYS.map((key) => (
                        <div className="bar-column" key={key} title={SCORE_INPUT_SEMANTICS[key].highValueMeans}>
                          <div className={`bar ${selected.inputs[key] === highestScore ? 'highlighted' : ''}`} style={{ height: `${selected.inputs[key]}%` }}><span>{selected.inputs[key]}</span></div>
                          <small>{scoreChartLabels[key]}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>

              <article className="card map-card" id="network" aria-labelledby="map-title">
                <div className="card-heading map-heading">
                  <div><h2 id="map-title">Toronto cycling network</h2><p>Official candidate alignments · {artifact.records.length} ranked routes</p></div>
                  <div className="view-switch" aria-label="Map scenario view">
                    <button className={!built ? 'active' : ''} onClick={() => setBuilt(false)}>Existing</button>
                    <button className={built ? 'active' : ''} onClick={() => setBuilt(true)}>Proposed</button>
                  </div>
                </div>
                <TorontoMap opportunities={artifact.records} selected={selectedOpportunity} activeIds={activeIds} built={built} showAllRoutes onSelect={selectOpportunity} routedFlows={routedFlows} />
                <div className="map-legend" aria-label="Map legend"><span><i className="network-line" />Current bike network</span><span><i className="proposal-line" />Selected proposal</span><span><i className="flow-line" />Weighted routed flow</span></div>
              </article>

              <article className="card table-card" id="corridors" aria-labelledby="corridors-title">
                <div className="card-heading">
                  <div><h2 id="corridors-title">Ranked corridors</h2><p>Select a corridor to update the scenario</p></div>
                  <span>{visibleCorridors.length} results</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Corridor</th><th>Score</th><th>Priority</th><th>Rollout</th></tr></thead>
                    <tbody>
                      {visibleCorridors.map((corridor, index) => (
                        <tr className={corridor.id === selected.id ? 'selected' : ''} key={corridor.id} onClick={() => selectCorridor(corridor)}>
                          <td>{String(index + 1).padStart(2, '0')}</td>
                          <td><button type="button" onClick={() => selectCorridor(corridor)}>{corridor.name}<small>{corridor.subtitle}</small></button></td>
                          <td>{Math.round(corridor.meanScore)}</td>
                          <td><span className={`status status-${corridor.tier.toLowerCase()}`}>{corridor.tier}</span></td>
                          <td>Year {corridor.plannedRolloutYear ?? corridor.rolloutYear}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {visibleCorridors.length === 0 && <div className="empty-state">No corridors match “{query}”.</div>}
                </div>
              </article>

              <article className="card scenario-card" id="methodology" aria-labelledby="scenario-title">
                <div className="card-heading">
                  <div><h2 id="scenario-title">Scenario controls</h2><p>Test the selected connection</p></div>
                  <span>{selected.tier} priority</span>
                </div>
                <div className="selected-corridor">
                  <span>Selected corridor</span>
                  <strong>{selected.name}</strong>
                  <p>{selected.summary}</p>
                  <small className="scenario-caveat">Illustrative scenario · {selectedOpportunity.comparison.warnings[0]}</small>
                </div>
                <div className="control-group">
                  <span>Network scenario</span>
                  <div className="segmented">
                    <button className={!built ? 'active' : ''} onClick={() => setBuilt(false)}>Existing</button>
                    <button className={built ? 'active' : ''} onClick={() => setBuilt(true)}>Proposed</button>
                  </div>
                </div>
                <div className="control-group">
                  <span>Implementation year</span>
                  <div className="segmented year-selector">
                    {([1, 2, 3] as const).map((value) => <button key={value} className={year === value ? 'active' : ''} onClick={() => { setYear(value); setBuilt(false) }}>Year {value}</button>)}
                  </div>
                </div>
                <button className={`build-button ${built ? 'built' : ''}`} onClick={() => setBuilt((value) => !value)}>
                  {built ? 'Reset corridor' : 'Add corridor'}<span>→</span>
                </button>
              </article>
            </section>
            </> : activeView === 'corridors' ? (
              <CorridorsView corridors={corridorData} selectedId={selectedId} onSelect={selectCorridor} />
            ) : activeView === 'network' ? (
              <NetworkView corridors={corridorData} opportunities={artifact.records} selected={selected} selectedOpportunity={selectedOpportunity} activeIds={activeIds} built={built} simulation={simulation} routedFlows={routedFlows} onSelect={selectCorridor} onSelectOpportunity={selectOpportunity} />
            ) : (
              <DataSourcesView />
            )}
          </main>
        </div>
      </section>
    </div>
  )
}

export default App
