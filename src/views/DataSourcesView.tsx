import './DataSourcesView.css'

type SourceStatus = 'Current' | 'Processing' | 'Review'

type DataSource = {
  name: string
  publisher: string
  format: string
  records: string
  coverage: string
  refreshed: string
  cadence: string
  status: SourceStatus
}

const sources: DataSource[] = [
  { name: 'Cycling Network', publisher: 'Toronto Open Data', format: 'GeoJSON', records: '6,814 segments', coverage: 'Citywide', refreshed: 'Sep 14, 2026', cadence: 'Weekly', status: 'Current' },
  { name: 'Bike Share Trips', publisher: 'Bike Share Toronto', format: 'Parquet', records: '2.31M trips', coverage: 'May–Aug 2026', refreshed: 'Sep 15, 2026', cadence: 'Daily', status: 'Current' },
  { name: 'Bicycle Counts', publisher: 'Transportation Services', format: 'CSV', records: '18.7M observations', coverage: '142 counters', refreshed: 'Sep 15, 2026', cadence: 'Hourly', status: 'Processing' },
  { name: 'Killed or Seriously Injured', publisher: 'Toronto Police Service', format: 'GeoJSON', records: '7,483 collisions', coverage: '2015–2026', refreshed: 'Sep 12, 2026', cadence: 'Monthly', status: 'Current' },
  { name: 'TTC Stops & Service', publisher: 'Toronto Transit Commission', format: 'GTFS', records: '9,321 stops', coverage: 'Active schedule', refreshed: 'Sep 13, 2026', cadence: 'Weekly', status: 'Current' },
  { name: 'Street Centreline', publisher: 'Toronto Open Data', format: 'GeoPackage', records: '68,429 links', coverage: 'Citywide', refreshed: 'Sep 09, 2026', cadence: 'Monthly', status: 'Current' },
  { name: 'OpenStreetMap Context', publisher: 'Geofabrik / OSM', format: 'PBF', records: '438K features', coverage: 'Toronto CMA', refreshed: 'Sep 15, 2026', cadence: 'Daily', status: 'Current' },
  { name: 'Neighbourhood Profiles', publisher: 'City Planning', format: 'CSV', records: '158 profiles', coverage: '2021 census', refreshed: 'Aug 28, 2026', cadence: 'Annual', status: 'Review' },
]

const pipelines = [
  { label: 'Bike Share trips', state: 'Ingesting', detail: '84% · 1.94M rows', tone: 'processing', width: '84%' },
  { label: 'Permanent counters', state: 'Healthy', detail: '18 min ago', tone: 'current', width: '97%' },
  { label: 'Collision records', state: 'Healthy', detail: '3 days ago', tone: 'current', width: '93%' },
  { label: 'TTC schedule', state: 'Healthy', detail: '2 days ago', tone: 'current', width: '96%' },
  { label: 'Neighbourhood profiles', state: 'Review', detail: '18 days ago', tone: 'review', width: '72%' },
]

const artifacts = [
  {
    name: 'network-segments.geojson',
    version: 'v2026.09.14',
    fields: ['segment_id', 'facility', 'direction', 'length_m', 'geometry'],
    lineage: 'Cycling Network → topology repair → corridor join',
  },
  {
    name: 'corridor-evidence.parquet',
    version: 'v4.18.2',
    fields: ['corridor_id', 'trips', 'ksi_rate', 'transit_gap', 'score'],
    lineage: 'Trips + counters + KSI + TTC → normalized evidence',
  },
  {
    name: 'simulation-profile.json',
    version: 'model-2026.09',
    fields: ['baseline', 'uplift', 'uncertainty', 'horizon_year'],
    lineage: 'Evidence table → calibrated scenario model → UI artifact',
  },
]

function StatusBadge({ status }: { status: SourceStatus }) {
  return <span className={`ds-status ds-status--${status.toLowerCase()}`}><i aria-hidden="true" />{status}</span>
}

export function DataSourcesView() {
  return (
    <section className="ds-view" aria-labelledby="data-sources-title">
      <header className="ds-heading">
        <div>
          <p className="ds-eyebrow">Evidence registry / Toronto</p>
          <h1 id="data-sources-title">Data sources</h1>
          <p>Source coverage, ingestion health, and artifact provenance used by the corridor model.</p>
        </div>
        <div className="ds-sync" aria-label="Latest registry sync">
          <span>Registry sync</span>
          <strong><i aria-hidden="true" />15 Sep 2026 · 09:42 EDT</strong>
        </div>
      </header>

      <section className="ds-metrics" aria-label="Ingestion summary">
        <article><span>Registered sources</span><strong>08</strong><small>6 public · 2 derived</small></article>
        <article><span>Indexed records</span><strong>21.5M</strong><small>+284.7K this refresh</small></article>
        <article><span>Spatial coverage</span><strong>97.4%</strong><small>Toronto road network</small></article>
        <article><span>Validation checks</span><strong>46 / 48</strong><small>2 awaiting review</small></article>
      </section>

      <div className="ds-layout">
        <article className="ds-panel ds-registry" aria-labelledby="registry-title">
          <header className="ds-panel__heading">
            <div><h2 id="registry-title">Source registry</h2><p>Inputs currently available to the scoring pipeline</p></div>
            <span>8 connected</span>
          </header>
          <div className="ds-table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Dataset</th><th scope="col">Format</th><th scope="col">Records</th><th scope="col">Coverage</th><th scope="col">Refreshed</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.name}>
                    <td><strong>{source.name}</strong><small>{source.publisher}</small></td>
                    <td><code>{source.format}</code></td>
                    <td>{source.records}</td>
                    <td>{source.coverage}</td>
                    <td><time dateTime="2026-09-15">{source.refreshed}</time><small>{source.cadence}</small></td>
                    <td><StatusBadge status={source.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="ds-panel ds-health" aria-labelledby="health-title">
          <header className="ds-panel__heading">
            <div><h2 id="health-title">Ingestion health</h2><p>Latest pipeline activity</p></div>
            <span className="ds-health__score">94.6%</span>
          </header>
          <div className="ds-pipelines">
            {pipelines.map((pipeline) => (
              <div className="ds-pipeline" key={pipeline.label}>
                <div><strong>{pipeline.label}</strong><span className={`ds-pipeline__state ds-pipeline__state--${pipeline.tone}`}>{pipeline.state}</span></div>
                <div className="ds-pipeline__track" aria-hidden="true"><i style={{ width: pipeline.width }} /></div>
                <small>{pipeline.detail}</small>
              </div>
            ))}
          </div>
          <dl className="ds-health__facts">
            <div><dt>Median latency</dt><dd>22 min</dd></div>
            <div><dt>Rejected rows</dt><dd>0.18%</dd></div>
            <div><dt>Geometry repairs</dt><dd>312</dd></div>
            <div><dt>Last full rebuild</dt><dd>06:20 EDT</dd></div>
          </dl>
        </aside>

        <article className="ds-panel ds-provenance" aria-labelledby="provenance-title">
          <header className="ds-panel__heading">
            <div><h2 id="provenance-title">Schemas &amp; provenance</h2><p>Published artifacts and their transformation lineage</p></div>
            <span>SHA-256 verified</span>
          </header>
          <div className="ds-artifacts">
            {artifacts.map((artifact) => (
              <section className="ds-artifact" key={artifact.name}>
                <div className="ds-artifact__title"><strong>{artifact.name}</strong><code>{artifact.version}</code></div>
                <div className="ds-fields" aria-label={`${artifact.name} fields`}>
                  {artifact.fields.map((field) => <code key={field}>{field}</code>)}
                </div>
                <p><span>Lineage</span>{artifact.lineage}</p>
              </section>
            ))}
          </div>
        </article>

        <aside className="ds-panel ds-quality" aria-labelledby="quality-title">
          <header className="ds-panel__heading">
            <div><h2 id="quality-title">Quality controls</h2><p>Most recent validation run</p></div>
            <span>09:37 EDT</span>
          </header>
          <ul>
            <li><span><i className="ds-check" aria-hidden="true" />Schema conformance</span><strong>8 / 8</strong></li>
            <li><span><i className="ds-check" aria-hidden="true" />Coordinate bounds</span><strong>21.5M passed</strong></li>
            <li><span><i className="ds-check" aria-hidden="true" />Stable corridor joins</span><strong>99.3%</strong></li>
            <li><span><i className="ds-warn" aria-hidden="true" />Stale source threshold</span><strong>1 flagged</strong></li>
            <li><span><i className="ds-warn" aria-hidden="true" />Unmatched KSI records</span><strong>47 rows</strong></li>
          </ul>
          <footer><span>Public source license</span><strong>Open Government Licence – Toronto</strong></footer>
        </aside>
      </div>
    </section>
  )
}

export default DataSourcesView
