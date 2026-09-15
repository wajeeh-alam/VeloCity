import { useMemo, useState } from 'react'
import type { Corridor, CorridorSimulation } from '../data/corridors.ts'
import type { OpportunityProfile } from '../data/opportunities.ts'
import { TorontoMap } from '../TorontoMap.tsx'
import './NetworkView.css'

export type NetworkViewProps = {
  corridors: Corridor[]
  opportunities: OpportunityProfile[]
  selected: Corridor
  selectedOpportunity: OpportunityProfile
  activeIds: string[]
  built: boolean
  simulation: CorridorSimulation
  onSelect: (corridor: Corridor) => void
  onSelectOpportunity: (corridor: OpportunityProfile) => void
}

type NetworkFilter = 'all' | 'active' | 'gaps'

const districtCoverage = [
  { district: 'Toronto–East York', coverage: 78.4, protected: 94.7, stress: 'Low', change: '+3.8' },
  { district: 'North York Centre', coverage: 61.2, protected: 57.3, stress: 'Moderate', change: '+5.1' },
  { district: 'Scarborough Southwest', coverage: 53.8, protected: 38.6, stress: 'Elevated', change: '+7.4' },
  { district: 'Etobicoke–Lakeshore', coverage: 49.6, protected: 44.1, stress: 'Elevated', change: '+2.7' },
  { district: 'York South–Weston', coverage: 46.9, protected: 26.8, stress: 'High', change: '+6.2' },
  { district: 'Don Valley', coverage: 44.5, protected: 31.4, stress: 'Moderate', change: '+4.6' },
  { district: 'Scarborough North', coverage: 37.1, protected: 20.9, stress: 'High', change: '+8.8' },
]

const infrastructureMix = [
  { label: 'Cycle tracks', km: 198.4, share: 34, tone: 'strong' },
  { label: 'Protected lanes', km: 143.7, share: 25, tone: 'medium' },
  { label: 'Multi-use trails', km: 118.6, share: 20, tone: 'medium' },
  { label: 'Painted lanes', km: 82.9, share: 14, tone: 'faint' },
  { label: 'Neighbourhood routes', km: 39.8, share: 7, tone: 'faint' },
]

const maintenanceItems = [
  { asset: 'Richmond cycle track', work: 'Bollard replacement', date: '18 Sep', status: 'Scheduled' },
  { asset: 'Martin Goodman Trail', work: 'Surface inspection', date: '20 Sep', status: 'Monitoring' },
  { asset: 'Bloor Street West', work: 'Drainage repair', date: '23 Sep', status: 'Scheduled' },
  { asset: 'Don Valley trail', work: 'Vegetation clearance', date: '26 Sep', status: 'Planned' },
]

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-CA').format(Math.round(value))
}

function MiniIcon({ name }: { name: 'route' | 'junction' | 'shield' | 'alert' | 'clock' }) {
  const paths = {
    route: <><path d="M5 3v4a2 2 0 0 0 2 2h2a2 2 0 0 1 2 2v4" /><circle cx="5" cy="3" r="1.4" /><circle cx="11" cy="15" r="1.4" /></>,
    junction: <><path d="M4 3v3a3 3 0 0 0 3 3h7" /><path d="M4 15v-3a3 3 0 0 1 3-3" /><path d="m12 6 3 3-3 3" /></>,
    shield: <path d="M9 2.5 14 4v4.2c0 3.2-2 5.8-5 7.3-3-1.5-5-4.1-5-7.3V4l5-1.5Z" />,
    alert: <><path d="M9 2.5 16 15H2L9 2.5Z" /><path d="M9 7v3.5M9 13h.01" /></>,
    clock: <><circle cx="9" cy="9" r="6.5" /><path d="M9 5.5V9l2.5 1.5" /></>,
  }
  return <svg className="network-view__icon" viewBox="0 0 18 18" aria-hidden="true">{paths[name]}</svg>
}

export function NetworkView({ corridors, opportunities, selected, selectedOpportunity, activeIds, built, simulation, onSelect, onSelectOpportunity }: NetworkViewProps) {
  const [filter, setFilter] = useState<NetworkFilter>('all')

  const networkMetrics = useMemo(() => {
    const totalLength = corridors.reduce((sum, corridor) => sum + 11.8 + corridor.inputs.coverage * 0.095, 0)
    const activeLength = corridors
      .filter((corridor) => activeIds.includes(corridor.id))
      .reduce((sum, corridor) => sum + 11.8 + corridor.inputs.coverage * 0.095, 0)
    const averageConnectivity = corridors.reduce((sum, corridor) => sum + corridor.inputs.connectivity, 0) / Math.max(corridors.length, 1)
    const highStress = corridors.reduce((sum, corridor) => sum + Math.round((100 - corridor.inputs.safety) / 5), 0)
    return {
      totalLength,
      activeLength,
      averageConnectivity,
      highStress,
      nodes: 1842 + corridors.length * 37,
    }
  }, [activeIds, corridors])

  const visibleCorridors = useMemo(() => {
    if (filter === 'active') return corridors.filter((corridor) => activeIds.includes(corridor.id))
    if (filter === 'gaps') return [...corridors].sort((a, b) => a.inputs.connectivity - b.inputs.connectivity).slice(0, 5)
    return corridors
  }, [activeIds, corridors, filter])
  const visibleOpportunityIds = new Set(visibleCorridors.map((corridor) => corridor.id))
  const visibleOpportunities = opportunities.filter((opportunity) => visibleOpportunityIds.has(opportunity.corridorId))

  const gains = simulation.after.populationConnected - simulation.before.populationConnected

  return (
    <section className="network-view" aria-labelledby="network-view-title">
      <header className="network-view__header">
        <div>
          <div className="network-view__eyebrow"><span /> Illustrative planning snapshot</div>
          <h1 id="network-view-title">Corridor network</h1>
          <p>Coverage, continuity and operating condition across Toronto&apos;s cycling grid.</p>
        </div>
        <div className="network-view__scope" aria-label="Network scope">
          <span>Scope</span>
          {(['all', 'active', 'gaps'] as const).map((option) => (
            <button key={option} type="button" className={filter === option ? 'is-active' : ''} onClick={() => setFilter(option)}>
              {option === 'all' ? 'All network' : option === 'active' ? 'Active plan' : 'Priority gaps'}
            </button>
          ))}
        </div>
      </header>

      <div className="network-view__metrics" aria-label="Network coverage metrics">
        <article><MiniIcon name="route" /><div><span>Mapped network</span><strong>{networkMetrics.totalLength.toFixed(1)} <small>km</small></strong><em>+18.6 km this cycle</em></div></article>
        <article><MiniIcon name="junction" /><div><span>Connected junctions</span><strong>{formatNumber(networkMetrics.nodes)}</strong><em>{networkMetrics.averageConnectivity.toFixed(1)} connectivity index</em></div></article>
        <article><MiniIcon name="shield" /><div><span>Low-stress coverage</span><strong>64.7<small>%</small></strong><em>+4.2 pts year over year</em></div></article>
        <article><MiniIcon name="alert" /><div><span>Critical network gaps</span><strong>{networkMetrics.highStress + 7}</strong><em>11 under active review</em></div></article>
        <article><MiniIcon name="clock" /><div><span>Inspection currency</span><strong>91.3<small>%</small></strong><em>42 assets due in 30 days</em></div></article>
      </div>

      <div className="network-view__primary-grid">
        <article className="network-view__panel network-view__map-panel">
          <div className="network-view__panel-heading">
            <div><h2>Network coverage</h2><p>{visibleOpportunities.length} ranked routes visible · {networkMetrics.activeLength.toFixed(1)} km in active plan</p></div>
            <div className="network-view__map-key"><span><i className="is-existing" />Existing</span><span><i className="is-selected" />Selected</span><b>{built ? 'Proposed state' : 'Existing state'}</b></div>
          </div>
          <div className="network-view__map-stage">
            <TorontoMap opportunities={visibleOpportunities} selected={selectedOpportunity} activeIds={activeIds} built={built} showAllRoutes onSelect={onSelectOpportunity} />
            <div className="network-view__map-stat"><span>Ranked alignments</span><strong>{opportunities.length} official candidates</strong><small>2025–2027 cycling programme</small></div>
          </div>
        </article>

        <aside className="network-view__panel network-view__health">
          <div className="network-view__panel-heading"><div><h2>Network health</h2><p>System condition by segment</p></div><span>Updated 14 Sep</span></div>
          <div className="network-view__health-score">
            <div><strong>82.6</strong><span>/ 100</span></div>
            <p>Good operating condition</p>
            <div className="network-view__score-track"><i /></div>
          </div>
          <dl className="network-view__stress-list">
            <div><dt><i className="is-low" />Low stress</dt><dd>376.4 km <span>64.5%</span></dd></div>
            <div><dt><i className="is-moderate" />Moderate</dt><dd>128.7 km <span>22.1%</span></dd></div>
            <div><dt><i className="is-high" />High stress</dt><dd>78.3 km <span>13.4%</span></dd></div>
          </dl>
          <div className="network-view__health-note">
            <span>Scenario impact</span>
            <strong>+{formatNumber(Math.max(gains, 0))} residents connected</strong>
            <p>if the selected corridor enters service.</p>
          </div>
          <div className="network-view__inspection">
            <span>Next field audit</span><strong>West Toronto Railpath</strong><time>18 Sep · 07:30</time>
          </div>
        </aside>
      </div>

      <div className="network-view__detail-grid">
        <article className="network-view__panel network-view__districts">
          <div className="network-view__panel-heading"><div><h2>District coverage</h2><p>Residents within 500 m of a low-stress route</p></div><span>7 districts</span></div>
          <div className="network-view__table-wrap">
            <table>
              <thead><tr><th>District</th><th>Coverage</th><th>Protected km</th><th>Stress</th><th>12 mo.</th></tr></thead>
              <tbody>{districtCoverage.map((row) => <tr key={row.district}><td>{row.district}</td><td><span className="network-view__coverage"><i style={{ width: `${row.coverage}%` }} />{row.coverage}%</span></td><td>{row.protected.toFixed(1)}</td><td><b className={`network-view__stress network-view__stress--${row.stress.toLowerCase()}`}>{row.stress}</b></td><td className="network-view__positive">{row.change}</td></tr>)}</tbody>
            </table>
          </div>
        </article>

        <article className="network-view__panel network-view__mix">
          <div className="network-view__panel-heading"><div><h2>Infrastructure mix</h2><p>583.4 mapped route kilometres</p></div><span>2026 inventory</span></div>
          <div className="network-view__mix-list">{infrastructureMix.map((item) => <div key={item.label}><div><span>{item.label}</span><strong>{item.km.toFixed(1)} km</strong></div><div className="network-view__mix-track"><i className={`is-${item.tone}`} style={{ width: `${item.share}%` }} /></div><small>{item.share}%</small></div>)}</div>
        </article>

        <article className="network-view__panel network-view__gaps">
          <div className="network-view__panel-heading"><div><h2>Priority gaps</h2><p>Ranked by connectivity deficit</p></div><span>{corridors.length} candidates</span></div>
          <div className="network-view__gap-list">{[...corridors].sort((a, b) => a.inputs.connectivity - b.inputs.connectivity).slice(0, 5).map((corridor, index) => <button key={corridor.id} type="button" className={corridor.id === selected.id ? 'is-selected' : ''} onClick={() => onSelect(corridor)}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{corridor.name}</strong><small>{corridor.subtitle}</small></span><em>{corridor.inputs.connectivity}<small>/100</small></em></button>)}</div>
        </article>

        <article className="network-view__panel network-view__maintenance">
          <div className="network-view__panel-heading"><div><h2>Maintenance queue</h2><p>Next scheduled network interventions</p></div><span>4 upcoming</span></div>
          <div className="network-view__maintenance-list">{maintenanceItems.map((item) => <div key={item.asset}><span><strong>{item.asset}</strong><small>{item.work}</small></span><time>{item.date}</time><b className={`is-${item.status.toLowerCase()}`}>{item.status}</b></div>)}</div>
        </article>
      </div>
    </section>
  )
}
