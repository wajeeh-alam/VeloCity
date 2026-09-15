# VeloCity — Toronto Bike-Lane Agent Simulator

> Find where Torontonians would bike if a safe connection existed.

**Hackathon MVP — planning evidence, not an official recommendation.**

VeloCity combines observed cycling demand, potential demand, road danger, accessibility and network gaps. A user selects a candidate corridor, reviews its evidence, virtually adds it to the cycling network and compares simulated low-stress access before and after.

## Current status

Member A trained a random-forest demand model on 754 June 2024 counter observations (10 training sites and 3 test sites) and exported 20 official candidate segments. Held-out relative MAE is 0.675 versus the training-median baseline's 1.115. Member B's deterministic scenario layer is joined with that evidence in `public/data/corridor-opportunities.json`. The React UI remains Member C's work.

## Sixty-second demo

1. Select a plan-backed or exploratory corridor.
2. Review its nine normalized evidence inputs and rating.
3. Virtually build the connection.
4. Watch representative weighted agents use the official candidate alignment.
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
  A[Toronto Open Data + Bike Share] --> B[Member A preprocessing]
  B --> C[Demand model + spatial validation]
  C --> D[Versioned corridor evidence]
  D --> E[Member B illustrative scenarios + portfolio]
  E --> F[Static JSON and GeoJSON]
  F --> G[Member C React dashboard]
```

## Member A: data/model workflow

The source registry is [`data/source-registry.json`](data/source-registry.json). Large raw files are intentionally ignored by Git.

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-data.txt
# Includes the 206 MB Bike Share archive and all corridor evidence layers:
npm run data:fetch -- --include-large --include-optional
npm run data:prepare:bike-share
npm run data:prepare:training
npm run data:validate
npm run pretrain:check
npm run model:train
npm run test:demand
```

For the hackathon, extract only June 2024 from the annual Bike Share archive. Join trip station IDs/names to the snapshotted GBFS station coordinates. Keep the date and checksum from `data/raw/download-report.json` in the final manifest.

Member A exports demand evidence to `corridor-demand.json`. Its output excludes routing, agents, before/after benefits and rollout; Member B supplies those. Legacy `corridors.geojson` remains a visibly synthetic fixture.

Training uses `data/processed/counter-training.csv`: valid interval volumes divided by observed hours for each direction/day, grouped by physical counter site. Both directions stay in the same split. Features use Bike Share, cycling network, pre-June-2024 cyclist KSI events and census. The frozen split, hashes and dates are in `data/processed/training-manifest.json`. The final export satisfies `data/contracts/corridor-demand.v2.schema.json`; its example under `data/fixtures/` must not be published.

## Handoff contract

Commit these small, host-ready artifacts:

| File | Consumer | Purpose |
|---|---|---|
| `public/data/corridor-demand.json` | Members B and C | Trained demand, uncertainty, raw features, nine evidence scores |
| `public/data/candidate-catalogue.geojson` | Members B and C | Matching IDs, names, official candidate geometry and plan status |
| `public/data/corridors.geojson` | Legacy only | Synthetic fixture; not a source for training |
| `public/data/flows.json` | Member B | Observed June 2024 station OD flows and relative weights |
| `public/data/model-metrics.json` | Members B and C | Baseline/model validation and selected strategy |
| `public/data/data-manifest.json` | Everyone | Provenance, status and limitations |
| `data/contracts/corridor-demand.v2.schema.json` | Everyone | Evidence-only v2 demand contract |
| `public/data/corridor-opportunities.json` | Member C | Joined evidence, scenario comparison, weighted agents and Year 1–3 placement |
| `data/contracts/corridor-opportunities.v1.schema.json` | Member C | Joined handoff contract |

Do **not** send raw archives through Git. If another member needs raw data, share an external read-only folder plus its checksum. Announce schema changes before pushing them.

Member B's generated scenario layer joins by `corridorId`; these real candidate IDs differ from the six legacy synthetic IDs. A's `productionEligible` flag only means the demand model beat the baseline. Member C should follow [`data/MEMBER_C_HANDOFF.md`](data/MEMBER_C_HANDOFF.md) and visibly distinguish trained demand evidence from synthetic scenario comparisons.

## Development and hosting

```bash
npm run dev
npm run lint
npm test
npm run data:validate
npm run opportunities:generate
npm run handoff:check
npm run build
npm run preview
```

GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`. In GitHub, open **Settings → Pages**, choose **GitHub Actions** as the source, then merge to `main`. A green workflow publishes the `dist` build. Pull requests validate the data and production builds locally before merge.

## MVP boundaries

- Use 15–25 plan-backed candidates and 3–5 exploratory connections.
- Precompute the strongest 10 scenarios and animate only representative agents.
- Exclude live model training, arbitrary route drawing, exhaustive citywide optimization and precise engineering costs.
- Bike Share has geographic and membership bias; a one-month sample is seasonal.
- Candidate alignments come from the City plan dataset; no pathfinding or alternate-route inference is performed.
- Counter timing and coverage are inconsistent.
- Engineering feasibility, road width, utilities, consultation and approvals remain outside the MVP.

## Team workflow

| Owner | Branch | Owned work |
|---|---|---|
| Member A | `feature/data-model` | Ingestion, transformations, features, model metrics and manifest |
| Member B | `feature/simulation-scoring` | Routing, agents, scenarios, portfolio and generated simulation data |
| Member C | `feature/dashboard-demo` | React map, animation, evidence cards, responsive UI and deployment |

Freeze contracts and fixtures first. Integrate small reviewed pull requests in this order: contracts/foundation → data/model → simulation/scoring → dashboard/integration. Never push directly to `main`.
