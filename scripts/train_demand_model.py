#!/usr/bin/env python3
"""Train and spatially validate relative hourly cycling demand."""

import csv
from datetime import datetime, timezone
import json
import math
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCAL_PACKAGES = ROOT / ".data-python"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))

import joblib
import numpy as np
from sklearn.compose import TransformedTargetRegressor
from sklearn.base import clone
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DATA = ROOT / "data" / "processed" / "counter-training.csv"
MANIFEST_PATH = ROOT / "data" / "processed" / "training-manifest.json"
MODEL_DIRECTORY = ROOT / "data" / "models"
EVALUATION_PATH = ROOT / "data" / "processed" / "model-evaluation.json"
PUBLIC_METRICS = ROOT / "public" / "data" / "model-metrics.json"

FEATURE_COLUMNS = [
    "bike_share_stations_1km",
    "bike_share_trip_ends_1km",
    "cyclist_ksi_collisions_1km",
    "cycling_network_km_1km",
    "neighbourhood_population",
    "neighbourhood_low_income_pct",
    "neighbourhood_improvement_area",
]
LOG_COLUMNS = {1, 2, 4}


def feature_vector(row):
    values = []
    for index, column in enumerate(FEATURE_COLUMNS):
        value = float(row[column]) if row[column] is not None and row[column] != "" else float("nan")
        values.append(math.log1p(max(0, value)) if index in LOG_COLUMNS and math.isfinite(value) else value)
    weekday = int(row["day_of_week"])
    values.extend([math.sin(2 * math.pi * weekday / 7), math.cos(2 * math.pi * weekday / 7)])
    return values


def pipeline(estimator):
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
        ("model", TransformedTargetRegressor(regressor=estimator, func=np.log1p, inverse_func=np.expm1)),
    ])


def main():
    if not DATA.exists():
        raise FileNotFoundError("Run npm run data:prepare:training before training")
    manifest = json.loads(MANIFEST_PATH.read_text())
    rows = list(csv.DictReader(DATA.open()))
    if hashlib.sha256(DATA.read_bytes()).hexdigest() != manifest["trainingDataSha256"]:
        raise ValueError("Training CSV changed since preparation")
    train_ids, test_ids = set(manifest["trainGroupIds"]), set(manifest["testGroupIds"])
    if train_ids & test_ids:
        raise ValueError("Train and test groups overlap")
    train_rows = [row for row in rows if row["group_id"] in train_ids]
    test_rows = [row for row in rows if row["group_id"] in test_ids]
    if not train_rows or not test_rows:
        raise ValueError("Frozen spatial split produced an empty partition")

    x_train = np.asarray([feature_vector(row) for row in train_rows], dtype=float)
    raw_y_train = np.asarray([float(row["bicycles_per_observed_hour"]) for row in train_rows])
    x_test = np.asarray([feature_vector(row) for row in test_rows], dtype=float)
    raw_y_test = np.asarray([float(row["bicycles_per_observed_hour"]) for row in test_rows])
    train_groups = np.asarray([row["group_id"] for row in train_rows])
    reference = float(np.median(raw_y_train))
    if not np.isfinite(reference) or reference <= 0:
        raise ValueError("Training-only normalization requires a positive median")
    y_train, y_test = raw_y_train / reference, raw_y_test / reference

    candidates = {
        "ridge-alpha-1": pipeline(Ridge(alpha=1.0)),
        "ridge-alpha-10": pipeline(Ridge(alpha=10.0)),
        "gradient-boosting": pipeline(GradientBoostingRegressor(random_state=20240915, n_estimators=200, learning_rate=0.03, max_depth=2, loss="huber")),
        "random-forest": pipeline(RandomForestRegressor(random_state=20240915, n_estimators=300, max_depth=5, min_samples_leaf=8, n_jobs=-1)),
    }
    folds = GroupKFold(n_splits=min(5, len(train_ids)))
    cv_scores = {}
    for name, candidate in candidates.items():
        scores = []
        for fit_indices, validation_indices in folds.split(x_train, y_train, groups=train_groups):
            fold_reference = float(np.median(raw_y_train[fit_indices]))
            candidate.fit(x_train[fit_indices], raw_y_train[fit_indices] / fold_reference)
            prediction = np.maximum(0, candidate.predict(x_train[validation_indices])) * fold_reference
            scores.append(mean_absolute_error(raw_y_train[validation_indices], prediction))
        cv_scores[name] = float(np.mean(scores))

    selected_name = min(cv_scores, key=cv_scores.get)
    selected = candidates[selected_name]
    selected.fit(x_train, y_train)
    prediction = np.maximum(0, selected.predict(x_test))
    baseline_prediction = np.full_like(y_test, np.median(y_train))
    model_mae = float(mean_absolute_error(y_test, prediction))
    baseline_mae = float(mean_absolute_error(y_test, baseline_prediction))
    production_eligible = model_mae < baseline_mae
    # Calibrate from held-out training groups; outer test labels are evaluation-only.
    oof_prediction = np.empty_like(raw_y_train)
    for fit_indices, validation_indices in folds.split(x_train, y_train, groups=train_groups):
        fold_reference = float(np.median(raw_y_train[fit_indices]))
        fold_model = clone(selected)
        fold_model.fit(x_train[fit_indices], raw_y_train[fit_indices] / fold_reference)
        oof_prediction[validation_indices] = np.maximum(0, fold_model.predict(x_train[validation_indices])) * fold_reference
    absolute_residual = np.abs(raw_y_train - oof_prediction) / reference
    residual_quantile_80 = float(np.quantile(absolute_residual, 0.8))
    test_interval_coverage = float(np.mean(np.abs(y_test-prediction) <= residual_quantile_80))
    trained_at = datetime.now(timezone.utc).isoformat()

    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIRECTORY / "demand-model.joblib"
    joblib.dump({
        "pipeline": selected,
        "featureColumns": FEATURE_COLUMNS,
        "featureVersion": manifest["featureVersion"],
        "referenceBicyclesPerHour": reference,
        "uncertainty80": residual_quantile_80,
        "trainedAt": trained_at,
        "trainingDataSha256": hashlib.sha256(DATA.read_bytes()).hexdigest(),
    }, model_path)

    evaluation = {
        "schemaVersion": "velocity.model-evaluation.v1",
        "modelId": selected_name,
        "modelVersion": "1.0.0",
        "trainedAt": trained_at,
        "featureVersion": manifest["featureVersion"],
        "target": "relative-bicycles-per-observed-hour",
        "unit": "dimensionless-relative-hourly-demand",
        "normalization": {"referenceBicyclesPerHour": round(reference, 6), "fittedOn": "training-only"},
        "validation": {
            "strategy": "spatial-holdout",
            "grouping": "counter-site",
            "metric": "mae",
            "modelValue": round(model_mae, 6),
            "medianBaselineValue": round(baseline_mae, 6),
            "baseline": "training-median",
            "lowerIsBetter": True,
            "trainGroupIds": sorted(train_ids),
            "testGroupIds": sorted(test_ids),
        },
        "productionEligible": production_eligible,
        "trainingSelection": {"strategy": "group-k-fold", "metricUnit": "bicycles-per-observed-hour", "folds": folds.n_splits, "candidateMae": {key: round(value, 6) for key, value in cv_scores.items()}},
        "trainingDataSha256": hashlib.sha256(DATA.read_bytes()).hexdigest(),
        "uncertainty": {"level": 0.8, "method": "spatial-holdout-residual-quantile", "calibration": "out-of-fold residuals from training sites only; nominal, not guaranteed coverage", "absoluteResidual": round(residual_quantile_80, 6), "heldOutCoverage": round(test_interval_coverage, 6)},
        "sampleCounts": {"trainingRows": len(train_rows), "testRows": len(test_rows), "trainingSites": len(train_ids), "testSites": len(test_ids)},
        "warnings": manifest["warnings"] + ["Only 13 physical sites; neighbouring sites may remain spatially correlated. The holdout was revisited after data-quality fixes; use external sites for confirmatory evaluation.", f"Nominal 80% uncertainty band covered {test_interval_coverage:.1%} of held-out observations; uncertainty is not well calibrated for new sites."],
    }
    EVALUATION_PATH.write_text(json.dumps(evaluation, indent=2) + "\n")
    PUBLIC_METRICS.write_text(json.dumps({
        "schema_version": "1.0.0",
        "status": "trained" if production_eligible else "fallback",
        "target": evaluation["target"],
        "validation": evaluation["validation"],
        "baseline": {"name": "training-median", "mean_absolute_error": evaluation["validation"]["medianBaselineValue"]},
        "model": {"id": selected_name, "version": "1.0.0", "mean_absolute_error": evaluation["validation"]["modelValue"]},
        "selected_strategy": "model" if production_eligible else "median_baseline",
        "warnings": evaluation["warnings"] + ([] if production_eligible else ["Model did not beat the spatially held-out training-median baseline; consumers must use fallback."]),
    }, indent=2) + "\n")
    print(json.dumps({"model": selected_name, "modelMAE": model_mae, "baselineMAE": baseline_mae, "productionEligible": production_eligible, "referenceBicyclesPerHour": reference}, indent=2))


if __name__ == "__main__":
    main()
