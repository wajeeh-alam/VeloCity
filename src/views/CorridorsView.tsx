import { useMemo, useState } from 'react'
import type { Corridor } from '../lib/corridorDomain.ts'
import './CorridorsView.css'

type CorridorsViewProps = {
  corridors: Corridor[]
  selectedId: string
  onSelect: (corridor: Corridor) => void
}

type DeliveryStatus = 'Design' | 'Procurement' | 'Review' | 'Planned'
type SortKey = 'score' | 'cost' | 'completion' | 'year'

type CorridorDetail = {
  lengthKm: number
  costMillions: number
  completion: number
  status: DeliveryStatus
  owner: string
  ward: string
  deliveryLead: string
  procurement: string
  nextMilestone: string
  milestoneDate: string
  risk: 'Low' | 'Moderate' | 'Elevated'
  dailyTrips: number
}

const corridorDetails: Record<string, CorridorDetail> = {
  'eglinton-east': {
    lengthKm: 11.8,
    costMillions: 28.4,
    completion: 42,
    status: 'Design',
    owner: 'Transportation Services',
    ward: 'Wards 20–22',
    deliveryLead: 'Eastern Mobility Unit',
    procurement: 'RFP-24-1187',
    nextMilestone: '60% design review',
    milestoneDate: '18 Nov 2026',
    risk: 'Moderate',
    dailyTrips: 6840,
  },
  'jane-north': {
    lengthKm: 9.6,
    costMillions: 23.7,
    completion: 58,
    status: 'Procurement',
    owner: 'Major Projects',
    ward: 'Wards 6–7',
    deliveryLead: 'North District Delivery',
    procurement: 'RFT-26-0441',
    nextMilestone: 'Tender close',
    milestoneDate: '04 Dec 2026',
    risk: 'Low',
    dailyTrips: 5190,
  },
  'dufferin-gap': {
    lengthKm: 7.4,
    costMillions: 19.2,
    completion: 31,
    status: 'Design',
    owner: 'Cycling & Pedestrian Projects',
    ward: 'Wards 9–11',
    deliveryLead: 'Central Mobility Unit',
    procurement: 'ENG-25-0932',
    nextMilestone: 'Utility coordination',
    milestoneDate: '12 Jan 2027',
    risk: 'Elevated',
    dailyTrips: 7340,
  },
  'don-mills-south': {
    lengthKm: 8.2,
    costMillions: 21.6,
    completion: 24,
    status: 'Review',
    owner: 'Transportation Planning',
    ward: 'Wards 14–16',
    deliveryLead: 'Valley Connections Office',
    procurement: 'EA-25-0068',
    nextMilestone: 'Environmental review',
    milestoneDate: '22 Feb 2027',
    risk: 'Moderate',
    dailyTrips: 4280,
  },
  'lawrence-east': {
    lengthKm: 13.1,
    costMillions: 34.8,
    completion: 14,
    status: 'Planned',
    owner: 'Network Planning',
    ward: 'Wards 21–24',
    deliveryLead: 'Scarborough Programme',
    procurement: 'CAP-27-0214',
    nextMilestone: 'Concept endorsement',
    milestoneDate: '09 Mar 2027',
    risk: 'Moderate',
    dailyTrips: 3610,
  },
  'kipling-south': {
    lengthKm: 6.9,
    costMillions: 16.5,
    completion: 9,
    status: 'Planned',
    owner: 'Network Planning',
    ward: 'Wards 2–3',
    deliveryLead: 'West District Delivery',
    procurement: 'CAP-27-0176',
    nextMilestone: 'Feasibility sign-off',
    milestoneDate: '28 Apr 2027',
    risk: 'Low',
    dailyTrips: 2940,
  },
}

const statusOptions: Array<DeliveryStatus | 'All'> = [
  'All',
  'Design',
  'Procurement',
  'Review',
  'Planned',
]

const formatCompact = new Intl.NumberFormat('en-CA', { notation: 'compact' })

const generatedOwners = ['Transportation Services', 'Major Projects', 'Network Planning', 'Cycling & Pedestrian Projects']
const generatedLeads = ['Central Mobility Unit', 'Eastern Mobility Unit', 'North District Delivery', 'West District Delivery']
const generatedStatuses: DeliveryStatus[] = ['Design', 'Procurement', 'Review', 'Planned']
const generatedRisks: CorridorDetail['risk'][] = ['Low', 'Moderate', 'Elevated', 'Moderate']

function generatedDetail(corridor: Corridor, index: number): CorridorDetail {
  const year = corridor.plannedRolloutYear ?? corridor.rolloutYear
  const completion = Math.max(8, Math.round(68 - year * 14 - index * 1.7))
  return {
    lengthKm: Number((2.8 + corridor.inputs.coverage * 0.085).toFixed(1)),
    costMillions: Number((8.6 + corridor.inputs.barriers * 0.19 + corridor.inputs.connectivity * 0.08).toFixed(1)),
    completion,
    status: generatedStatuses[(year + index) % generatedStatuses.length],
    owner: generatedOwners[index % generatedOwners.length],
    ward: `Ward ${2 + index % 23}`,
    deliveryLead: generatedLeads[index % generatedLeads.length],
    procurement: `CNP-${26 + year}-${String(410 + index * 17).padStart(4, '0')}`,
    nextMilestone: ['30% design review', 'Utility coordination', 'Tender readiness', 'Concept endorsement'][index % 4],
    milestoneDate: `${String(6 + index % 22).padStart(2, '0')} ${['Oct', 'Nov', 'Dec', 'Jan'][index % 4]} ${2026 + Math.floor(index / 12)}`,
    risk: generatedRisks[index % generatedRisks.length],
    dailyTrips: Math.round(1750 + corridor.inputs.currentDemand * 54 + corridor.inputs.potentialDemand * 19),
  }
}

export default function CorridorsView({ corridors, selectedId, onSelect }: CorridorsViewProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<DeliveryStatus | 'All'>('All')
  const [sortBy, setSortBy] = useState<SortKey>('score')

  const enrichedCorridors = useMemo(
    () => corridors.map((corridor, index) => ({ corridor, detail: corridorDetails[corridor.id] ?? generatedDetail(corridor, index) })),
    [corridors],
  )

  const visibleCorridors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return enrichedCorridors
      .filter(({ corridor, detail }) => {
        const matchesStatus = status === 'All' || detail.status === status
        const searchable = `${corridor.name} ${corridor.subtitle} ${detail.owner} ${detail.ward}`.toLowerCase()
        return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery))
      })
      .sort((a, b) => {
        if (sortBy === 'cost') return b.detail.costMillions - a.detail.costMillions
        if (sortBy === 'completion') return b.detail.completion - a.detail.completion
        if (sortBy === 'year') return a.corridor.rolloutYear - b.corridor.rolloutYear
        return b.corridor.meanScore - a.corridor.meanScore
      })
  }, [enrichedCorridors, query, sortBy, status])

  const totalLength = enrichedCorridors.reduce((sum, item) => sum + item.detail.lengthKm, 0)
  const totalInvestment = enrichedCorridors.reduce((sum, item) => sum + item.detail.costMillions, 0)
  const averageScore = enrichedCorridors.reduce((sum, item) => sum + item.corridor.meanScore, 0) / enrichedCorridors.length
  const forecastTrips = enrichedCorridors.reduce((sum, item) => sum + item.detail.dailyTrips, 0)
  const selectedItem = enrichedCorridors.find(({ corridor }) => corridor.id === selectedId) ?? enrichedCorridors[0]

  return (
    <section className="corridors-view" aria-labelledby="corridors-view-title">
      <header className="corridors-header">
        <div>
          <p className="corridors-eyebrow">2026–2029 capital programme</p>
          <h1 id="corridors-view-title">Corridor portfolio</h1>
          <p>Delivery status, investment exposure and network value across active candidates.</p>
        </div>
        <div className="corridors-asof"><i />Portfolio current <span>15 Sep 2026</span></div>
      </header>

      <div className="corridors-summary" aria-label="Portfolio summary">
        <div><span>Active corridors</span><strong>{String(corridors.length).padStart(2, '0')}</strong><small>{enrichedCorridors.filter(({ detail }) => detail.status !== 'Planned').length} in delivery</small></div>
        <div><span>Programme length</span><strong>{totalLength.toFixed(1)} <em>km</em></strong><small>Protected network</small></div>
        <div><span>Committed value</span><strong>${totalInvestment.toFixed(1)} <em>M</em></strong><small>2026 dollars</small></div>
        <div><span>Mean priority score</span><strong>{averageScore.toFixed(1)}</strong><small>Weighted / 100</small></div>
        <div><span>Forecast uptake</span><strong>{formatCompact.format(forecastTrips)}</strong><small>Weekday trips</small></div>
      </div>

      <div className="corridors-toolbar">
        <label className="corridors-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <span className="sr-only">Search corridors</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search corridor, ward or owner" />
        </label>
        <div className="corridors-status-filter" aria-label="Filter by status">
          {statusOptions.map((option) => (
            <button key={option} className={status === option ? 'active' : ''} onClick={() => setStatus(option)}>{option}</button>
          ))}
        </div>
        <label className="corridors-sort">
          <span>Sort</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
            <option value="score">Priority score</option>
            <option value="completion">Completion</option>
            <option value="cost">Investment</option>
            <option value="year">Rollout year</option>
          </select>
        </label>
      </div>

      <div className="corridors-ledger">
        <div className="corridors-ledger-head">
          <span>Corridor / segment</span><span>Priority</span><span>Stage</span><span>Length</span><span>Investment</span><span>Delivery</span><span>Risk</span><span>Owner</span>
        </div>
        <div className="corridors-ledger-body">
          {visibleCorridors.map(({ corridor, detail }, index) => (
            <button
              type="button"
              className={`corridor-record ${corridor.id === selectedId ? 'selected' : ''}`}
              key={corridor.id}
              onClick={() => onSelect(corridor)}
            >
              <span className="corridor-identity"><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{corridor.name}</strong><small>{corridor.subtitle} · {detail.ward}</small></span></span>
              <span className="corridor-score"><strong>{Math.round(corridor.meanScore)}</strong><small>{corridor.tier}</small></span>
              <span><i className={`corridor-status status-${detail.status.toLowerCase()}`} />{detail.status}</span>
              <span className="mono-value">{detail.lengthKm.toFixed(1)} km</span>
              <span className="mono-value">${detail.costMillions.toFixed(1)}M</span>
              <span className="corridor-progress"><span><i style={{ width: `${detail.completion}%` }} /></span><small>{detail.completion}%</small></span>
              <span><em className={`risk risk-${detail.risk.toLowerCase()}`}>{detail.risk}</em></span>
              <span className="corridor-owner"><strong>{detail.owner}</strong><small>{detail.deliveryLead}</small></span>
            </button>
          ))}
          {visibleCorridors.length === 0 && (
            <div className="corridors-empty"><strong>No matching corridors</strong><span>Clear the search or choose another delivery stage.</span></div>
          )}
        </div>
      </div>

      <div className="corridors-detail-grid">
        <article className="corridor-brief">
          <div className="corridor-panel-heading"><div><span>Selected corridor</span><h2>{selectedItem.corridor.name}</h2></div><b>{selectedItem.corridor.tier} priority</b></div>
          <p>{selectedItem.corridor.summary}</p>
          <dl>
            <div><dt>Programme owner</dt><dd>{selectedItem.detail.owner}</dd></div>
            <div><dt>Delivery lead</dt><dd>{selectedItem.detail.deliveryLead}</dd></div>
            <div><dt>Procurement file</dt><dd>{selectedItem.detail.procurement}</dd></div>
            <div><dt>Rollout horizon</dt><dd>Year {selectedItem.corridor.plannedRolloutYear ?? selectedItem.corridor.rolloutYear}</dd></div>
          </dl>
        </article>
        <article className="corridor-milestone">
          <div className="corridor-panel-heading"><div><span>Next control point</span><h2>{selectedItem.detail.nextMilestone}</h2></div><b>{selectedItem.detail.milestoneDate}</b></div>
          <div className="milestone-track" aria-label={`${selectedItem.detail.completion}% complete`}><i style={{ width: `${selectedItem.detail.completion}%` }} /></div>
          <div className="milestone-labels"><span>Initiation</span><span>Design</span><span>Construction</span><span>Open</span></div>
          <div className="milestone-stats"><span><b>{formatCompact.format(selectedItem.detail.dailyTrips)}</b> forecast weekday trips</span><span><b>{selectedItem.detail.risk}</b> delivery risk</span><span><b>{selectedItem.detail.completion}%</b> complete</span></div>
        </article>
      </div>
    </section>
  )
}
