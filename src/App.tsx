import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import './App.css'
import { TorontoMap } from './TorontoMap.tsx'
import {
  CORRIDOR_DATA_METADATA,
  SCORE_INPUT_SEMANTICS,
  SCORE_KEYS,
  SIMULATION_METRIC_DEFINITIONS,
  corridors,
  createArtifactAwareSimulator,
  parseCorridorPredictionArtifact,
  simulateCorridor,
  withCorridorInputs,
  type Corridor,
  type CorridorPredictionArtifact,
  type SimulationMetricKey,
} from './data/corridors.ts'

const metricIcons: Record<SimulationMetricKey, string> = {
  lowStressTrips: '↗',
  populationConnected: '◎',
  destinationsReached: '⌖',
  dangerousSegments: '◇',
}

function formatMetric(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : value.toLocaleString()
}

function App() {
  const [selectedId, setSelectedId] = useState(corridors[0].id)
  const [built, setBuilt] = useState(false)
  const [year, setYear] = useState<1 | 2 | 3>(1)
  const [artifact, setArtifact] = useState<CorridorPredictionArtifact | null>(null)

  useEffect(() => {
    let live = true
    fetch('/corridor-predictions.json')
      .then((response) => response.ok ? response.json() as Promise<unknown> : Promise.reject())
      .then((value) => {
        const result = parseCorridorPredictionArtifact(value)
        if (live && result.ok) setArtifact(result.artifact)
      })
      .catch(() => { /* The shared simulator intentionally supplies its deterministic fallback. */ })
    return () => { live = false }
  }, [])

  const activeIds = useMemo(
    () => corridors.filter((corridor) => (corridor.plannedRolloutYear ?? corridor.rolloutYear) <= year).map((corridor) => corridor.id),
    [year],
  )
  const selected = corridors.find((corridor) => corridor.id === selectedId) ?? corridors[0]
  const scenarioCorridor = withCorridorInputs(selected, selected.inputs, year)
  const simulation = artifact
    ? createArtifactAwareSimulator(artifact, { horizonYear: year, activeCorridorIds: activeIds })(scenarioCorridor)
    : simulateCorridor(scenarioCorridor, { networkState: { horizonYear: year, activeCorridorIds: activeIds } })
  const shownMetrics = built ? simulation.after : simulation.before
  const selectedScore = simulation.scoring?.meanScore ?? selected.meanScore

  function selectCorridor(corridor: Corridor) {
    setSelectedId(corridor.id)
    setBuilt(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="logo" aria-hidden="true"><span>V</span></div>
        <div className="brand"><strong>VeloCity</strong><span>Toronto cycling network planner</span></div>
        <div className="model-state"><i /> Network model <b>{simulation.mode === 'trained-artifact' ? 'LIVE' : 'DEMO'}</b></div>
        <div className="demo-label">ILLUSTRATIVE DEMO DATA</div>
      </header>

      <main className="dashboard">
        <aside className="corridor-panel">
          <div className="eyebrow">Priority network gaps</div>
          <h1>Candidate<br />corridors</h1>
          <p className="intro">Explore connections with the greatest potential to unlock safe cycling trips.</p>
          <div className="list-heading"><span>{corridors.length} opportunities</span><span>Score</span></div>
          <div className="corridor-list">
            {corridors.map((corridor, index) => (
              <button
                key={corridor.id}
                className={`corridor-row ${selected.id === corridor.id ? 'active' : ''}`}
                onClick={() => selectCorridor(corridor)}
                aria-pressed={selected.id === corridor.id}
              >
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="swatch" style={{ backgroundColor: corridor.color }} />
                <span className="corridor-name"><strong>{corridor.name}</strong><small>{corridor.subtitle}</small></span>
                <span className="corridor-score">{Math.round(corridor.meanScore)}</span>
              </button>
            ))}
          </div>
          <div className="source-note"><span>DATA MODE</span><b>{CORRIDOR_DATA_METADATA.mode.replaceAll('-', ' ')}</b></div>
        </aside>

        <section className="workspace">
          <div className={`map-card ${built ? 'is-built' : ''}`}>
            <div className="map-toolbar">
              <div><span className="pulse" /><b>NETWORK VIEW</b><small>Toronto · Weekday scenario</small></div>
              <div className="view-switch" aria-label="Map scenario view">
                <button className={!built ? 'active' : ''} onClick={() => setBuilt(false)}>Existing</button>
                <button className={built ? 'active' : ''} onClick={() => setBuilt(true)}>Proposed</button>
              </div>
            </div>
            <TorontoMap corridors={corridors} selected={selected} activeIds={activeIds} built={built} simulation={simulation} onSelect={selectCorridor} />
            <div className="map-legend"><span><i className="legend-line existing" />Included by Year {year}</span><span><i className="legend-line candidate" />Selected</span><span><i className="legend-dot" />Weighted agent</span></div>
            <div className="map-callout"><small>SELECTED CONNECTION</small><strong>{selected.name}</strong><span>{selected.subtitle}</span></div>
          </div>

          <section className="impact-section">
            <div className="impact-heading">
              <div><span className="eyebrow">Scenario impact</span><h2>{built ? 'A safer network, connected.' : 'What changes if we build it?'}</h2></div>
              <div className="comparison-key"><span>● CURRENT</span><span>● WITH CORRIDOR</span></div>
            </div>
            <div className="metrics-grid">
              {(Object.keys(SIMULATION_METRIC_DEFINITIONS) as SimulationMetricKey[]).map((key) => {
                const definition = SIMULATION_METRIC_DEFINITIONS[key]
                const before = simulation.before[key]
                const after = simulation.after[key]
                const lower = definition.betterDirection === 'lower'
                const change = before === 0 ? 0 : Math.round(Math.abs(after - before) / before * 100)
                return <article className="metric-card" key={key}>
                  <div className="metric-icon">{metricIcons[key]}</div>
                  <span>{definition.label}</span>
                  <strong>{formatMetric(shownMetrics[key])}</strong>
                  <div className="metric-change">{lower ? '↓' : '↑'} {change}% <small>{built ? 'modelled change' : 'opportunity'}</small></div>
                  <div className="metric-track"><i style={{ width: `${Math.max(8, shownMetrics[key] / Math.max(before, after) * 100)}%` }} /></div>
                </article>
              })}
            </div>
          </section>
        </section>

        <aside className="evidence-panel">
          <div className="evidence-head">
            <div><span className="eyebrow">Corridor evidence</span><h2>{selected.name}</h2><p>{selected.subtitle}</p></div>
            <div className="score-ring" style={{ '--score-angle': `${selectedScore * 3.6}deg` } as CSSProperties}><b>{Math.round(selectedScore)}</b><small>/100</small></div>
          </div>
          <div className="priority-banner"><span>●</span><div><b>{selected.tier} priority</b><small>{selected.summary}</small></div></div>
          <div className="profile-head"><b>Opportunity profile</b><span>INDEX / 100</span></div>
          <div className="score-list">
            {SCORE_KEYS.map((key) => (
              <div className="score-item" key={key} title={SCORE_INPUT_SEMANTICS[key].highValueMeans}>
                <div><span>{SCORE_INPUT_SEMANTICS[key].label}</span><b>{selected.inputs[key]}</b></div>
                <div className="score-track"><i style={{ width: `${selected.inputs[key]}%` }} /></div>
              </div>
            ))}
          </div>
          <button className={`build-button ${built ? 'built' : ''}`} onClick={() => setBuilt((value) => !value)}>
            <span>+</span>{built ? 'Reset scenario' : 'Build this corridor'}<b>→</b>
          </button>
          <div className="scenario-notice"><b>{simulation.mode?.replace('-', ' ')}</b><p>{simulation.disclaimer}</p></div>
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
