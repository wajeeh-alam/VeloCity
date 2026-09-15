# Member A → Member B/C: trained demand evidence

## Results

- Training data: 754 direction/day observations, June 2024; 574 rows at 10 sites used for training, 180 rows at 3 sites held out.
- Model: random forest, selected from four fixed candidates using five-fold counter-site grouped cross-validation inside training sites.
- Relative held-out MAE: **0.674890**; training-median baseline: **1.114836** (39.46% lower).
- Reference demand: **32.0625 bicycles/hour**, fitted on training sites. A relative prediction of 1 means this reference rate.
- This is a prototype spatial estimate with 13 physical sites. Adjacent sites may remain correlated, and the same holdout was revisited after correctness fixes. More sites are needed for confirmatory evaluation.
- Nominal 80% residual bands achieved **61.1% coverage** on the test observations. Display uncertainty as provisional; it is not a reliable 80% guarantee for new corridors.

Exact machine-readable metrics: `data/processed/model-evaluation.json`. The fitted pipeline is saved locally at `data/models/demand-model.joblib` (Git-ignored; only load trusted joblib files).

## What to consume

1. `public/data/corridor-demand.json`: `velocity.corridor-demand.v2`, 20 records.
2. `public/data/candidate-catalogue.geojson`: matching stable IDs, display names, street endpoints, plan status and official geometry.
3. `public/data/data-manifest.json`: matching manifest version, input URLs, hashes, dates, score normalization and per-corridor extrapolation warnings.
4. `data/contracts/corridor-demand.v2.schema.json`: the implemented local handoff schema. B must wire a v2 reader; the existing v1 scenario parser cannot read it directly.

Join `records[].corridorId` to GeoJSON `id`. IDs use a deterministic hash of the source street/from/to/status tuple, prefixed `toronto-plan-`; they do not match the six old synthetic corridor IDs. This is a selected candidate sample, not a portfolio ranking. Geometry is converted from the supplied City shapefile; A does not construct alternative routes.

`prediction.relativeBicyclesPerObservedHour` estimates the directional counter-equivalent mean June hourly rate at the candidate midpoint, averaged over June's weekday mix. It does not estimate a whole corridor's total riders, latent mode shift or construction uplift.

`rawFeatures` includes model inputs and nine `evidence_*` indicators. `inputScores` contains their 0–100 candidate-set min/max scaling, documented in `data/README.md`. `potentialDemand` is a population/school proxy; learned demand is a separate output. Missing midpoint census joins are excluded and reported. Out-of-training-range candidate features are flagged in the manifest.

`productionEligible` is true only when model MAE is strictly below the training-median baseline. It is not certification of scenario benefits. B supplies routing, before/after metrics, agents and rollout; C labels those outputs separately from A's trained evidence.

## Training rules and limitations

- Labels sum valid interval counts and divide by actual recorded hours; at least 20 hours per day required. Duplicate bins removed, zeros retained, negative bins rejected, totals over 10,000 excluded. Counters include other micromobility and count only their detection zones.
- Both directions and all days at a physical site share one group. The split is frozen in `training-manifest.json`.
- Imputation, scaling and reference normalization fit only on training sites, including inside each CV fold. Constant log transforms are specified in code. No held-out targets enter the model.
- Uncertainty uses selected-model out-of-fold residuals from training groups. It is exploratory and undercovers on the outer holdout; do not use it as a calibrated confidence claim.
- Collisions are deduplicated cyclist-involved KSI events from June 2019 through May 2024. Current network and station snapshots accompany 2024 observations; do not describe this as validation of historical forecasts.
- Bike Share station matching drops retired/unmatched stations; `flows.json` reports exclusions. Training features use all retained station activity, not just the 2,000 displayed OD pairs.
- Bridge proximity and school-only destinations substitute for unavailable OpenStreetMap evidence. Connectivity and coverage are geometric indicators, not accessibility results.
- Raw source refreshes can change features and must trigger preparation, retraining and export. Hash gates reject stale training rows.

## Commands

With Python 3.12 and `requirements-data.txt` installed in the active environment:

```bash
npm run data:fetch -- --include-large --include-optional
npm run data:prepare:bike-share
npm run data:prepare:training
npm run model:train
npm run demand:validate
npm run test:demand
```

Training performs the existing pre-training checks before fitting. The final artifact can be served as static JSON with Vite; it does not require a Python server. Raw downloads and local model binaries stay out of Git. The app currently still needs Member B/C integration to display this artifact.
