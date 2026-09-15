import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import './App.css'
import { TorontoMap } from './TorontoMap.tsx'
import {
  SCORE_INPUT_SEMANTICS,
  SCORE_KEYS,
  SIMULATION_METRIC_DEFINITIONS,
  type SimulationMetricKey,
} from './data/corridors.ts'
import {
  loadOpportunityArtifact,
  type OpportunityArtifact,
  type OpportunityProfile,
} from './data/opportunities.ts'
import { loadPrecomputedBundle, type PrecomputedBundle } from './data/precomputedScenarios.ts'

const metricIcons: Record<SimulationMetricKey, string> = {
  lowStressTrips: '↗',
  populationConnected: '◎',
  destinationsReached: '⌖',
  dangerousSegments: '◇',
}

function formatMetric(value: number) {
  return value >= 1000
    ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
    : value.toLocaleString()
}

function formatObservationRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${formatter.format(new Date(`${start}T00:00:00`))}–${formatter.format(new Date(`${end}T00:00:00`))}`
}

function App() {
  const [artifact, setArtifact] = useState<OpportunityArtifact | null>(null)
  const [routingBundle, setRoutingBundle] = useState<PrecomputedBundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAllRoutes, setShowAllRoutes] = useState(false)
  const [year, setYear] = useState<1 | 2 | 3>(1)

  useEffect(() => {
    let live = true
    Promise.all([loadOpportunityArtifact(), loadPrecomputedBundle()])
      .then(([value, routing]) => {
        if (!live) return
        setArtifact(value)
        setRoutingBundle(routing)
        setSelectedId(value.records[0]?.corridorId ?? null)
      })
      .catch((error: unknown) => {
        if (live) setLoadError(error instanceof Error ? error.message : 'Opportunity data failed to load')
      })
    return () => { live = false }
  }, [])

  const activeIds = useMemo(() => {
    if (!artifact) return []
    return artifact.portfolio.years
      .filter((entry) => entry.year <= year)
      .flatMap((entry) => entry.corridorIds)
  }, [artifact, year])

  if (loadError) {
    return (
      <main className="load-state">
        <strong>VeloCity could not load the corridor handoff.</strong>
        <p>{loadError}</p>
      </main>
    )
  }

  if (!artifact || !routingBundle || !selectedId) {
    return <main className="load-state"><strong>Loading Toronto corridor evidence…</strong></main>
  }

  const listedOpportunities = artifact.records
  const selected = artifact.records.find((record) => record.corridorId === selectedId) ?? artifact.records[0]
  const comparison = selected.comparison
  const routingScenario = routingBundle.scenarios.find((scenario) => scenario.corridorId === selected.corridorId)
  const routedFlows = routingScenario?.status === 'precomputed'
    ? routingScenario.simulations.flatMap((entry) => entry.simulation.routes)
    : []
  const shownMetrics = comparison.after
  const prediction = selected.evidence.prediction
  const metricKeys = Object.keys(artifact.scenarioModel.metricDefinitions) as SimulationMetricKey[]

  function selectCorridor(corridor: OpportunityProfile) {
    setSelectedId(corridor.corridorId)
    setYear(corridor.priority.rolloutYear)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><strong>VeloCity</strong><span>Toronto cycling network planner</span></div>
        <div className="demo-label"><i /> Trained evidence + illustrative scenarios</div>
      </header>

      <main className="dashboard">
        <aside className="corridor-panel">
          <div className="eyebrow">Priority network gaps</div>
          <h1>Possible<br />bike routes</h1>
          <p className="intro">Explore all plan-backed routes ranked with the shared evidence pipeline.</p>
          <div className="list-heading"><span>Top {listedOpportunities.length} ML-ranked routes</span><span>Score</span></div>
          <div className="corridor-list">
            {listedOpportunities.map((corridor) => (
              <button
                key={corridor.corridorId}
                className={`corridor-row ${selected.corridorId === corridor.corridorId ? 'active' : ''}`}
                onClick={() => selectCorridor(corridor)}
                aria-pressed={selected.corridorId === corridor.corridorId}
              >
                <span className="rank">{String(corridor.priority.rank).padStart(2, '0')}</span>
                <span className="swatch" />
                <span className="corridor-name"><strong>{corridor.name}</strong><small>{corridor.subtitle}</small></span>
                <span className="corridor-score">{Math.round(corridor.priority.score)}</span>
              </button>
            ))}
          </div>
          <div className="source-note"><span>Evidence artifact</span><b>{artifact.evidenceArtifactId}</b></div>
        </aside>

        <section className="workspace">
          <div className="map-card is-built">
            <div className="map-toolbar">
              <div><span className="pulse" /><b>Network view</b><small>Toronto · Official candidate alignments</small></div>
              <div className="map-actions">
                <button
                  className={`routes-toggle ${showAllRoutes ? 'active' : ''}`}
                  onClick={() => setShowAllRoutes((value) => !value)}
                  aria-pressed={showAllRoutes}
                >
                  {showAllRoutes ? `Showing all ${artifact.records.length}` : `Show all ${artifact.records.length} routes`}
                </button>
                <span className="proposed-label">Proposed</span>
              </div>
            </div>
            <TorontoMap
              opportunities={artifact.records}
              selected={selected}
              activeIds={activeIds}
              built
              showAllRoutes={showAllRoutes}
              onSelect={selectCorridor}
              routedFlows={routedFlows}
            />
            <div className="map-legend">
              <span><i className="legend-line existing" />Current bike network</span>
              <span><i className="legend-line candidate" />Selected proposal</span>
              <span><i className="legend-dot" />Weighted routed flow</span>
            </div>
            <div className="map-callout"><small>Selected connection</small><strong>{selected.name}</strong><span>{selected.subtitle}</span></div>
            <div className={`routing-state ${routedFlows.length ? 'ready' : ''}`}>
              <b>{routedFlows.length ? `${routedFlows.length} B-routed flows` : 'B routing unavailable'}</b>
              <span>{routedFlows.length ? 'Trained demand · agents appear in Proposed view' : routingScenario?.blockers[0] ?? 'No matching B scenario'}</span>
            </div>
          </div>

          <section className="impact-section">
            <div className="impact-heading">
              <div><span className="eyebrow">Illustrative scenario</span><h2>A safer network, connected.</h2></div>
              <div className="comparison-key"><span>Current</span><span>With corridor</span></div>
            </div>
            <div className="metrics-grid">
              {metricKeys.map((key) => {
                const definition = artifact.scenarioModel.metricDefinitions[key]
                const before = comparison.before[key]
                const after = comparison.after[key]
                const lower = definition.betterDirection === 'lower'
                const change = before === 0 ? 0 : Math.round(Math.abs(after - before) / before * 100)
                return <article className="metric-card" key={key} title={definition.unit}>
                  <div className="metric-icon">{metricIcons[key]}</div>
                  <span>{SIMULATION_METRIC_DEFINITIONS[key].label}</span>
                  <strong>{formatMetric(shownMetrics[key])}</strong>
                  <div className="metric-change">{lower ? '↓' : '↑'} {change}% <small>illustrative change</small></div>
                  <div className="metric-track"><i style={{ width: `${Math.max(8, shownMetrics[key] / Math.max(before, after, 1) * 100)}%` }} /></div>
                </article>
              })}
            </div>
            <details className="scenario-warnings">
              <summary>{comparison.warnings.length} scenario notes and limitations</summary>
              <ul>{comparison.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          </section>
        </section>

        <aside className="evidence-panel">
          <div className="evidence-head">
            <div><span className="eyebrow">Corridor evidence</span><h2>{selected.name}</h2><p>{selected.subtitle}</p></div>
            <div className="score-ring" style={{ '--score-angle': `${selected.priority.score * 3.6}deg` } as CSSProperties}><b>{Math.round(selected.priority.score)}</b><small>/100</small></div>
          </div>
          <div className="priority-banner"><span>●</span><div><b>{selected.priority.tier} priority · rank {selected.priority.rank}</b><small>{selected.sourceStatus}</small></div></div>

          <section className="model-evidence">
            <div className="profile-head"><b>Trained demand evidence</b><span>{selected.evidence.modelBeatBaseline ? 'Beats baseline' : 'Below baseline'}</span></div>
            <strong>{prediction.relativeBicyclesPerObservedHour.toFixed(2)}</strong>
            <p>relative bicycles per observed hour</p>
            <small>{prediction.uncertainty.lower.toFixed(2)}–{prediction.uncertainty.upper.toFixed(2)} · {Math.round(prediction.uncertainty.level * 100)}% interval</small>
            <small>{formatObservationRange(selected.evidence.observation.start, selected.evidence.observation.end)}</small>
            <small>{selected.evidence.modelValidation.metric.toUpperCase()} {selected.evidence.modelValidation.modelValue.toFixed(2)} vs {selected.evidence.modelValidation.medianBaselineValue.toFixed(2)} median baseline</small>
          </section>

          <div className="profile-head"><b>Opportunity profile</b><span>Index / 100</span></div>
          <div className="score-list">
            {SCORE_KEYS.map((key) => (
              <div className="score-item" key={key} title={SCORE_INPUT_SEMANTICS[key].highValueMeans}>
                <div><span>{SCORE_INPUT_SEMANTICS[key].label}</span><b>{Math.round(selected.evidence.inputScores[key])}</b></div>
                <div className="score-track"><i style={{ width: `${selected.evidence.inputScores[key]}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="scenario-notice"><b>Illustrative scenario</b><p>{artifact.portfolio.disclaimer}</p></div>
          <div className="rollout">
            <div className="rollout-head"><div><span className="eyebrow">Network rollout</span><b>3-year scenario</b></div><span>{activeIds.length} active</span></div>
            <div className="year-selector">{([1, 2, 3] as const).map((value) => <button key={value} className={year === value ? 'active' : ''} onClick={() => setYear(value)}><b>0{value}</b><small>YEAR</small></button>)}</div>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
