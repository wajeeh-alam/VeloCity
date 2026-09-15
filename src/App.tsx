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

const DISPLAYED_OPPORTUNITIES = 8

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [built, setBuilt] = useState(false)
  const [year, setYear] = useState<1 | 2 | 3>(1)

  useEffect(() => {
    let live = true
    loadOpportunityArtifact()
      .then((value) => {
        if (!live) return
        setArtifact(value)
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

  if (!artifact || !selectedId) {
    return <main className="load-state"><strong>Loading Toronto corridor evidence…</strong></main>
  }

  const listedOpportunities = artifact.records.slice(0, DISPLAYED_OPPORTUNITIES)
  const selected = artifact.records.find((record) => record.corridorId === selectedId) ?? artifact.records[0]
  const comparison = selected.comparison
  const shownMetrics = built ? comparison.after : comparison.before
  const prediction = selected.evidence.prediction
  const metricKeys = Object.keys(artifact.scenarioModel.metricDefinitions) as SimulationMetricKey[]

  function selectCorridor(corridor: OpportunityProfile) {
    setSelectedId(corridor.corridorId)
    setBuilt(false)
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
          <h1>Candidate<br />corridors</h1>
          <p className="intro">Explore plan-backed connections ranked with the shared evidence pipeline.</p>
          <div className="list-heading"><span>{listedOpportunities.length} of {artifact.records.length} opportunities</span><span>Score</span></div>
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
          <div className={`map-card ${built ? 'is-built' : ''}`}>
            <div className="map-toolbar">
              <div><span className="pulse" /><b>Network view</b><small>Toronto · Official candidate alignments</small></div>
              <div className="view-switch" aria-label="Map scenario view">
                <button className={!built ? 'active' : ''} onClick={() => setBuilt(false)}>Existing</button>
                <button className={built ? 'active' : ''} onClick={() => setBuilt(true)}>Proposed</button>
              </div>
            </div>
            <TorontoMap
              opportunities={artifact.records}
              selected={selected}
              activeIds={activeIds}
              built={built}
              onSelect={selectCorridor}
            />
            <div className="map-legend">
              <span><i className="legend-line existing" />Current bike network</span>
              <span><i className="legend-line candidate" />Selected proposal</span>
              <span><i className="legend-dot" />Weighted agent marker</span>
            </div>
            <div className="map-callout"><small>Selected connection</small><strong>{selected.name}</strong><span>{selected.subtitle}</span></div>
          </div>

          <section className="impact-section">
            <div className="impact-heading">
              <div><span className="eyebrow">Illustrative scenario</span><h2>{built ? 'A safer network, connected.' : 'What changes if we build it?'}</h2></div>
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
                  <div className="metric-change">{lower ? '↓' : '↑'} {change}% <small>{built ? 'illustrative change' : 'opportunity'}</small></div>
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
          <button className={`build-button ${built ? 'built' : ''}`} onClick={() => setBuilt((value) => !value)}>
            <span>+</span>{built ? 'Reset scenario' : 'Build this corridor'}<b>→</b>
          </button>
          <div className="scenario-notice"><b>Illustrative scenario</b><p>{artifact.portfolio.disclaimer}</p></div>
          <div className="rollout">
            <div className="rollout-head"><div><span className="eyebrow">Network rollout</span><b>3-year scenario</b></div><span>{activeIds.length} active</span></div>
            <div className="year-selector">{([1, 2, 3] as const).map((value) => <button key={value} className={year === value ? 'active' : ''} onClick={() => { setYear(value); setBuilt(false) }}><b>0{value}</b><small>YEAR</small></button>)}</div>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
