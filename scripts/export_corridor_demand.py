#!/usr/bin/env python3
"""Export Member A evidence on existing City candidate geometry. No routing/scenarios."""
import csv
import hashlib
import io
import json
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / ".data-python").exists():
    sys.path.insert(0, str(ROOT / ".data-python"))

import joblib
import numpy as np
from pyproj import CRS, Transformer
import shapefile
from prepare_training_data import build_spatial_features, lines, haversine, point_segment_distance
from train_demand_model import feature_vector, FEATURE_COLUMNS

RAW = ROOT / "data/raw"
PUBLIC = ROOT / "public/data"
PROCESSED = ROOT / "data/processed"


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def candidates():
    """Preserve supplied geometry; select the longest 20 unique proposed segments."""
    with zipfile.ZipFile(RAW / "cycling-program-2025-2027.zip") as archive:
        base = "Programmed_Cycling_Projects"
        transformer = Transformer.from_crs(CRS.from_wkt(archive.read(base + ".prj").decode()), 4326, always_xy=True)
        reader = shapefile.Reader(shp=io.BytesIO(archive.read(base + ".shp")),
                                  shx=io.BytesIO(archive.read(base + ".shx")),
                                  dbf=io.BytesIO(archive.read(base + ".dbf")))
        found = {}
        for item in reader.iterShapeRecords():
            props = item.record.as_dict()
            if props["map_legend"] not in {"New and Major Upgrade", "Study or Design", "Approved for Future Implementation"}:
                continue
            identity = "|".join(props[key] for key in ["street", "from_stree", "to_street", "map_legend"])
            identifier = "toronto-plan-" + hashlib.sha256(identity.encode()).hexdigest()[:16]
            parts = list(item.shape.parts) + [len(item.shape.points)]
            coordinates = [[list(transformer.transform(*point)) for point in item.shape.points[a:b]]
                           for a, b in zip(parts, parts[1:])]
            if any(len(line) < 2 for line in coordinates):
                continue
            value = {"type": "Feature", "id": identifier,
                     "geometry": {"type": "MultiLineString", "coordinates": coordinates},
                     "properties": {"corridorId": identifier, "name": props["street"],
                                    "fromStreet": props["from_stree"], "toStreet": props["to_street"],
                                    "sourceStatus": props["map_legend"], "sourceRecordId": identity,
                                    "lengthMetres": props["Shape_Leng"]}}
            if identifier not in found or props["Shape_Leng"] > found[identifier]["properties"]["lengthMetres"]:
                found[identifier] = value
    return sorted(found.values(), key=lambda item: (-item["properties"]["lengthMetres"], item["id"]))[:25]


def sample_geometry(geometry, spacing=100):
    samples = []
    for line in lines(geometry):
        for a, b in zip(line, line[1:]):
            count = max(1, int(haversine(*a[:2], *b[:2]) / spacing))
            for i in range(count):
                fraction = i / count
                samples.append([a[0] + (b[0]-a[0])*fraction, a[1]+(b[1]-a[1])*fraction])
        samples.append(line[-1][:2])
    return samples


def geo_points(path):
    points = []
    for feature in json.loads(path.read_text())["features"]:
        geom = feature.get("geometry") or {}
        if geom.get("type") == "Point":
            points.append(geom["coordinates"][:2])
        elif geom.get("type") == "MultiPoint":
            points.extend(point[:2] for point in geom["coordinates"])
    return sorted(set(tuple(round(value, 7) for value in point) for point in points))


def main():
    bundle = joblib.load(ROOT / "data/models/demand-model.joblib")
    evaluation = json.loads((PROCESSED / "model-evaluation.json").read_text())
    training = json.loads((PROCESSED / "training-manifest.json").read_text())
    if digest(PROCESSED / "counter-training.csv") != bundle["trainingDataSha256"]:
        raise ValueError("Training data changed; retrain before exporting")
    if bundle["featureVersion"] != training["featureVersion"]:
        raise ValueError("Feature version changed; retrain before exporting")

    catalogue = candidates()
    sample_points = {item["id"]: sample_geometry(item["geometry"]) for item in catalogue}
    anchors = [{"geometry": {"type": "Point", "coordinates": sample_points[item["id"]][len(sample_points[item["id"]])//2]},
                "properties": {"location_dir_id": item["id"], "location_name": item["properties"]["name"]}} for item in catalogue]
    static, _, _ = build_spatial_features(anchors)
    network = json.loads((RAW / "cycling-network.geojson").read_text())["features"]
    # Existing network segment geometry is used for proximity evidence only.
    network_segments = [list(zip(line, line[1:])) for feature in network for line in lines(feature["geometry"])]
    schools = geo_points(RAW / "schools.geojson")
    bridges = geo_points(RAW / "bridges.geojson")
    with zipfile.ZipFile(RAW / "ttc-gtfs.zip") as archive:
        stops = sorted({(float(row["stop_lon"]), float(row["stop_lat"])) for row in
                        csv.DictReader(io.TextIOWrapper(archive.open("stops.txt"), encoding="utf-8-sig"))})

    days = [date(2024, 6, 1) + timedelta(days=i) for i in range(30)]
    day_weights = Counter(day.weekday() for day in days)
    records = []
    indicators = []
    warnings = list(evaluation["warnings"])
    accepted_catalogue = []
    training_rows = list(csv.DictReader((PROCESSED / "counter-training.csv").open()))
    feature_ranges = {key: (min(float(r[key]) for r in training_rows if r["group_id"] in training["trainGroupIds"] and r[key]),
                            max(float(r[key]) for r in training_rows if r["group_id"] in training["trainGroupIds"] and r[key])) for key in FEATURE_COLUMNS}

    for item in catalogue:
        if len(records) == 20:
            break
        identifier = item["id"]
        raw = static[identifier]
        if any(raw[key] is None for key in FEATURE_COLUMNS):
            warnings.append(f"Excluded {identifier} ({item['properties']['name']}): midpoint has no matching census neighbourhood.")
            continue
        accepted_catalogue.append(item)
        corridor_segments = [pair for line in lines(item["geometry"]) for pair in zip(line, line[1:])]
        points = [p for line in lines(item["geometry"]) for p in line]
        west, east = min(p[0] for p in points) - 0.005, max(p[0] for p in points) + 0.005
        south, north = min(p[1] for p in points) - 0.003, max(p[1] for p in points) + 0.003
        nearby_network = [[(a, b) for a, b in pairs if max(a[0], b[0]) >= west and min(a[0], b[0]) <= east
                           and max(a[1], b[1]) >= south and min(a[1], b[1]) <= north] for pairs in network_segments]
        nearby_network = [pairs for pairs in nearby_network if pairs]
        def near_corridor(point):
            return (west <= point[0] <= east and south <= point[1] <= north
                    and any(point_segment_distance(point, a, b) <= 250 for a, b in corridor_segments))
        school_count = sum(near_corridor(point) for point in schools)
        bridge_count = sum(near_corridor(point) for point in bridges)
        stop_count = sum(near_corridor(point) for point in stops)
        endpoints = [point for line in lines(item["geometry"]) for point in [line[0], line[-1]]]
        connections = sum(any(point_segment_distance(point, a, b) <= 250 for point in endpoints for a, b in pairs) for pairs in nearby_network)
        samples = sample_points[identifier]
        uncovered = sum(not any(point_segment_distance(point, a, b) <= 250 for pairs in nearby_network for a, b in pairs) for point in samples) / len(samples)
        proxy = {"safety": raw["cyclist_ksi_collisions_1km"], "connectivity": connections,
                 "equity": raw["neighbourhood_low_income_pct"], "currentDemand": raw["bike_share_trip_ends_1km"],
                 "potentialDemand": raw["neighbourhood_population"] * (1 + school_count),
                 "transit": stop_count, "barriers": bridge_count, "coverage": uncovered, "destinations": school_count}
        indicators.append(proxy)
        prediction = sum(max(0.0, float(bundle["pipeline"].predict(np.asarray([feature_vector({**raw, "day_of_week": weekday})]))[0])) * weight / 30
                         for weekday, weight in day_weights.items())
        spread = bundle["uncertainty80"]
        outside = [key for key, (low, high) in feature_ranges.items() if not low <= float(raw[key]) <= high]
        if outside:
            warnings.append(f"{identifier}: beyond training feature range for {', '.join(outside)}; spatial extrapolation.")
        records.append({"corridorId": identifier, "geometry": item["geometry"], "inputScores": {},
                        "rawFeatures": {**{key: raw[key] for key in FEATURE_COLUMNS},
                                        "anchorLongitude": raw["longitude"], "anchorLatitude": raw["latitude"],
                                        **{f"evidence_{key}": value for key, value in proxy.items()}},
                        "prediction": {"relativeBicyclesPerObservedHour": round(prediction, 6),
                                       "uncertainty": {"lower": round(max(0, prediction-spread), 6), "upper": round(prediction+spread, 6),
                                                       "level": 0.8, "method": "spatial-holdout-residual-quantile"}},
                        "observation": {"start": "2024-06-01", "end": "2024-06-30"},
                        "sourceProvenance": training["sourceIds"] + ["cycling-program-2025-2027", "ttc-gtfs", "school-locations-all-types", "bridge-structures"]})

    # Descriptive evidence scores are normalized across this frozen candidate set.
    # These are not fitted model features; model preprocessing uses training sites only.
    score_scales = {}
    for key in indicators[0]:
        low, high = min(x[key] for x in indicators), max(x[key] for x in indicators)
        score_scales[key] = {"minimum": low, "maximum": high}
        for record, proxy in zip(records, indicators):
            record["inputScores"][key] = round(100 * (proxy[key]-low)/(high-low), 2) if high > low else 0.0

    generated = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    registry = json.loads((ROOT / "data/source-registry.json").read_text())
    used_ids = set(records[0]["sourceProvenance"])
    sources = []
    for source in registry["sources"]:
        if source["id"] in used_ids:
            file = RAW / source["output"]
            sources.append({**source, "sha256": digest(file), "bytes": file.stat().st_size,
                            "localSnapshotAt": datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat(timespec="milliseconds"),
                            "status": "processed", "localSnapshotAtMeaning": "local download timestamp; not observation date"})
    if used_ids != {source["id"] for source in sources}:
        raise ValueError("Unregistered provenance source")
    manifest_version = "velocity-demand-sources-" + hashlib.sha256(json.dumps([(s["id"], s["sha256"]) for s in sources]).encode()).hexdigest()[:16]
    model = {"id": evaluation["modelId"], "version": evaluation["modelVersion"], "trainedAt": evaluation["trainedAt"],
             "datasetManifestVersion": manifest_version, "featureVersion": training["featureVersion"],
             "target": evaluation["target"], "unit": evaluation["unit"], "normalization": evaluation["normalization"],
             "validation": evaluation["validation"], "productionEligible": evaluation["productionEligible"]}
    artifact_id = "demand-" + hashlib.sha256(json.dumps({"model": model, "records": records}, sort_keys=True).encode()).hexdigest()[:16]
    artifact = {"schemaVersion": "velocity.corridor-demand.v2", "artifactId": artifact_id,
                "generatedAt": generated, "model": model, "records": records}
    warnings += [
        "Predictions estimate a directional counter-equivalent June mean hour at the corridor midpoint; not corridor totals or future induced demand.",
        "Uncertainty is a nominal 80% training-group out-of-fold residual band, not a guaranteed confidence interval for an unobserved corridor.",
        "School-only destinations, bridge-proximity barriers and population-times-school-count potential demand are limited evidence proxies, not official City scores.",
        "OpenStreetMap evidence service unavailable; City sources substituted. Connectivity measures endpoint proximity, not routed reachability.",
        "Candidates: first 20 with complete midpoint evidence among the longest 25 unique proposed segments in the 2025–2027 archive; not a ranked recommended portfolio.",
        "Scores use candidate-set min/max normalization; changing the set changes scores. Demand-model normalization is separately fitted on training sites only."
    ]
    manifest = {"schema_version": "1.0.0", "version": manifest_version, "generated_at": generated,
                "artifact_status": "mixed", "demandArtifactStatus": "trained" if model["productionEligible"] else "baseline-gate-failed",
                "demandArtifactId": artifact_id, "coordinate_reference_system": "EPSG:4326",
                "sourceObservationPeriods": {"counter-and-bike-share": ["2024-06-01", "2024-06-30"], "collisions": ["2019-06-01", "2024-05-31"], "census": "2021", "remaining-layers": "downloaded current snapshots"},
                "scoreNormalization": {"version": "velocity-evidence-proxies.v1", "method": "candidate-set min/max; constant columns=0", "scales": score_scales},
                "sources": sources, "limitations": warnings,
                "legacyArtifacts": {"corridors.geojson": "synthetic-fixture; not consumed by demand training"}}
    for target, payload in [(PUBLIC / "corridor-demand.json", artifact), (PUBLIC / "data-manifest.json", manifest),
                            (PUBLIC / "candidate-catalogue.geojson", {"type": "FeatureCollection", "features": accepted_catalogue})]:
        target.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")
    print(f"Exported {len(records)} evidence-only corridor records; artifact {artifact_id}")


if __name__ == "__main__":
    main()
