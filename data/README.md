# Member A data notes

## Source-to-score mapping

| Score/output | Primary source | MVP transformation |
|---|---|---|
| Candidate geometry | 2025–2027 programmed cycling projects | Select 15–25 corridors; reproject to EPSG:4326 |
| Current demand | June 2024 Bike Share | Starts + ends within 1 km of corridor midpoint; all accepted trips |
| Potential demand | Census population and schools | Population × (1 + school count); opportunity proxy only |
| Safety | Cyclist-involved KSI events, June 2019–May 2024 | Deduplicated collision count within 1 km of midpoint; higher = need |
| Connectivity | Existing cycling network | Number of network polylines within 250 m of candidate endpoints; no routing |
| Coverage | Existing cycling network | Fraction of sampled candidate points farther than 250 m from existing routes |
| Equity | 2021 Neighbourhood Profiles | Midpoint neighbourhood LIM-AT low-income percentage |
| Transit | Current TTC GTFS | Unique stop coordinate locations within 250 m; no frequency weighting |
| Barriers | City Bridge Structures | Bridge/culvert locations within 250 m; presence proxy, no crossing-feasibility claim |
| Destinations | City School Locations | Unique school coordinate locations within 250 m; incomplete destination coverage |

## Verified source shapes

- Bike Share GBFS snapshot: 1,068 stations; join using `station_id`/`name`; coordinates are `lat` and `lon`.
- Cycling network: 1,581 features; useful fields include `STREET_NAME`, `INFRA_HIGHORDER`, `INFRA_LOWORDER`, `INSTALLED`, `CNPCLASS` and `SEGMENT_ID`.
- KSI collisions: 20,723 person-level features; filter `road_user`/`cyclist`, retain `collision_id`, severity, date and coordinates, then deduplicate appropriately.
- Permanent counters: 43 location features; daily observations join using `location_dir_id`.
- 2021 profiles: indicators are rows and the 158 neighbourhoods are columns; transpose before joining by neighbourhood number.

Counts above describe the source snapshot downloaded on 2026-09-15 and may change.

## Handoff rule

Raw downloads stay in `data/raw/` and are ignored by Git. Only commit the schemas, source registry and validated files under `public/data/`. Every score must retain its raw value, normalization rule and source ID in the processing code or final manifest.

Member B's TypeScript names are canonical: `corridorId`, `candidateType`, `currentDemand`, `potentialDemand`, `equity`, `meanScore`, `strongInputCount` and `tier`. Training/export code must not emit snake_case aliases.

`npm run data:prepare:bike-share` streams the annual ZIP without extracting its 969 MB CSV and publishes the 2,000 strongest valid June OD pairs to `public/data/flows.json`.

`npm run data:prepare:training` creates leakage-safe counter rows and a frozen spatial split in `data/processed/`. Run `npm run pretrain:check` before training. The check enforces disjoint counter-site groups, training-only normalization, Member B's field names and the evidence-only `velocity.corridor-demand.v2` boundary.

See [TRAINING.md](TRAINING.md) for the trained model, output contract and important interpretation limits. Evidence scores use min/max over the frozen candidate set; this is separate from demand-model normalization, which is fitted on training sites only. The model uses raw features, not the nine descriptive scores.
