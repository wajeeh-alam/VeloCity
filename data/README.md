# Member A data notes

## Source-to-score mapping

| Score/output | Primary source | MVP transformation |
|---|---|---|
| Candidate geometry | 2025–2027 programmed cycling projects | Select 15–25 corridors; reproject to EPSG:4326 |
| Current demand | June 2024 Bike Share OD + daily counters | Aggregate observed trips/counts near each corridor |
| Potential demand | OD trips not currently served + population | Relative opportunity score, not predicted riders |
| Safety | KSI collision GeoJSON | Filter cyclist/VRU records; distance-weight near corridor |
| Connectivity | Existing cycling network | Measure network links/gaps at corridor endpoints |
| Coverage | Existing cycling network | Prioritize areas outside a 250 m network buffer |
| Equity/population | 2021 Neighbourhood Profiles | Population and priority indicators intersecting corridor buffer |
| Transit | TTC GTFS | Stops/stations and service within corridor buffer |
| Barriers | OSM road/rail/water geometry | Count useful highway, railway and water crossings |
| Destinations | Schools, employment and daily needs | Count destinations within 250 m |

## Verified source shapes

- Bike Share GBFS snapshot: 1,068 stations; join using `station_id`/`name`; coordinates are `lat` and `lon`.
- Cycling network: 1,581 features; useful fields include `STREET_NAME`, `INFRA_HIGHORDER`, `INFRA_LOWORDER`, `INSTALLED`, `CNPCLASS` and `SEGMENT_ID`.
- KSI collisions: 20,723 person-level features; filter `road_user`/`cyclist`, retain `collision_id`, severity, date and coordinates, then deduplicate appropriately.
- Permanent counters: 43 location features; daily observations join using `location_dir_id`.
- 2021 profiles: indicators are rows and the 158 neighbourhoods are columns; transpose before joining by neighbourhood number.

Counts above describe the source snapshot downloaded on 2026-09-15 and may change.

## Handoff rule

Raw downloads stay in `data/raw/` and are ignored by Git. Only commit the schemas, source registry and validated files under `public/data/`. Every score must retain its raw value, normalization rule and source ID in the processing code or final manifest.

`npm run data:prepare:bike-share` streams the annual ZIP without extracting its 969 MB CSV and publishes the 2,000 strongest valid June OD pairs to `public/data/flows.json`.
