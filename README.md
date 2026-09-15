# VeloCity — Toronto Bike-Lane Agent Simulator

> Find where Torontonians would bike if a safe connection existed.

**Hackathon MVP — planning evidence, not an official recommendation.**

VeloCity combines observed cycling demand, potential demand, road danger, accessibility and network gaps. A user selects a candidate corridor, reviews its evidence, virtually adds it to the cycling network and compares simulated low-stress access before and after.

## Current status

The repository contains the React/Vite shell plus a versioned Member A data contract and synthetic fixtures. The fixtures make parallel dashboard and simulation work possible; they are not analytical results.

## Sixty-second demo

1. Select a plan-backed or exploratory corridor.
2. Review its nine normalized evidence inputs and rating.
3. Virtually build the connection.
4. Watch a representative sample of weighted travel-demand agents reroute.
5. Compare low-stress trips, population connected, destinations reached and dangerous segments avoided.
6. Advance through an illustrative Year 1–3 portfolio.

## Data and scoring

The nine 0–100 inputs are safety, connectivity, equity/population, current demand, potential demand, transit access, barrier crossings, network coverage and destinations. An input is strong at `>=60`.

- `Top`: 8–9 strong inputs and no score below 40 for safety, connectivity or potential demand.
- `High`: 6–7 strong inputs, or 8–9 with a core weakness.
- `Medium`: 4–5 strong inputs.
- `Low`: 0–3 strong inputs.

Rank corridors within a tier by mean score. It is valid for no corridor to be `Top`.

The demand target is **relative bicycles per observed hour**, not a precise forecast of future riders. Validate spatially against a median baseline and keep that baseline unless the model performs better. Report outcomes as “simulated low-stress uptake” and “accessibility benefit,” never causal ridership growth.

## Architecture

```mermaid
flowchart LR
  A[Toronto Open Data + Bike Share + OSM] --> B[Member A preprocessing]
  B --> C[Demand model + spatial validation]
  C --> D[Versioned corridor evidence]
  D --> E[Member B routing + simulation]
  E --> F[Static JSON and GeoJSON]
  F --> G[Member C React dashboard]
```

## Member A: data/model workflow

The source registry is [`data/source-registry.json`](data/source-registry.json). Large raw files are intentionally ignored by Git.

```bash
npm install
npm run data:fetch
# Also download the 206 MB Bike Share 2024 archive:
npm run data:fetch -- --include-large
# Also download optional TTC GTFS:
npm run data:fetch -- --include-optional
npm run data:prepare:bike-share
npm run data:validate
```

For the hackathon, extract only June 2024 from the annual Bike Share archive. Join trip station IDs/names to the snapshotted GBFS station coordinates. Keep the date and checksum from `data/raw/download-report.json` in the final manifest.

Member A replaces the synthetic fixtures with observed/modelled corridor evidence, updates `model-metrics.json`, changes `artifact_status`, and runs validation before handoff.

## Handoff contract

Commit these small, host-ready artifacts:

| File | Consumer | Purpose |
|---|---|---|
| `public/data/corridors.geojson` | Members B and C | Candidate geometry, nine scores and rating |
| `public/data/flows.json` | Member B | Observed June 2024 station OD flows and relative weights |
| `public/data/model-metrics.json` | Members B and C | Baseline/model validation and selected strategy |
| `public/data/data-manifest.json` | Everyone | Provenance, status and limitations |
| `data/contracts/*.schema.json` | Everyone | Frozen v1 interface |

Do **not** send raw archives through Git. Push the files above to `feature/data-model`; if another member needs raw data, share an external read-only folder plus its checksum. Announce schema changes before pushing them.

Member B should treat `corridor_id` as the stable join key and add simulation output without changing Member A’s score names. Member C can develop against the committed fixtures immediately.

## Development and hosting

```bash
npm run dev
npm run lint
npm run data:validate
npm run build
npm run preview
```

GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the source, then merge to `main`. A green workflow publishes the `dist` build. Pull requests validate the data and production builds locally before merge.

## MVP boundaries

- Use 15–25 plan-backed candidates and 3–5 exploratory connections.
- Precompute the strongest 10 scenarios and animate only representative agents.
- Exclude live model training, arbitrary route drawing, exhaustive citywide optimization and precise engineering costs.
- Bike Share has geographic and membership bias; a one-month sample is seasonal.
- Routes are inferred rather than GPS-observed.
- Counter timing and coverage are inconsistent.
- Engineering feasibility, road width, utilities, consultation and approvals remain outside the MVP.

## Team workflow

| Owner | Branch | Owned work |
|---|---|---|
| Member A | `feature/data-model` | Ingestion, transformations, features, model metrics and manifest |
| Member B | `feature/simulation-scoring` | Routing, agents, scenarios, portfolio and generated simulation data |
| Member C | `feature/dashboard-demo` | React map, animation, evidence cards, responsive UI and deployment |

Freeze contracts and fixtures first. Integrate small reviewed pull requests in this order: contracts/foundation → data/model → simulation/scoring → dashboard/integration. Never push directly to `main`.
