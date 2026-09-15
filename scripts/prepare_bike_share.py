#!/usr/bin/env python3
"""Aggregate June 2024 Bike Share trips into a small, host-ready OD artifact."""

from collections import defaultdict
from datetime import datetime, timezone
import csv
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUTPUT = ROOT / "public" / "data" / "flows.json"
PERIOD = "2024-06"
MAX_FLOWS = 2_000
MIN_DURATION_SECONDS = 60
MAX_DURATION_SECONDS = 6 * 60 * 60


def station_id(value: str) -> str:
    value = value.strip()
    return value[:-2] if value.endswith(".0") else value


def load_stations() -> dict[str, dict]:
    payload = json.loads((RAW / "bike-share-stations.json").read_text())
    stations = payload.get("data", {}).get("stations", [])
    return {
        station_id(str(item["station_id"])): {
            "station_id": station_id(str(item["station_id"])),
            "name": item["name"],
            "lat": item["lat"],
            "lon": item["lon"],
        }
        for item in stations
        if item.get("station_id") and item.get("lat") is not None and item.get("lon") is not None
    }


def main() -> int:
    archive = RAW / "bike-share-2024.zip"
    if not archive.exists():
        print("Missing data/raw/bike-share-2024.zip. Run: npm run data:fetch -- --include-large", file=sys.stderr)
        return 1

    stations = load_stations()
    aggregates: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    rows_seen = june_rows = accepted_rows = 0
    missing_station_rows = invalid_duration_rows = 0

    with zipfile.ZipFile(archive) as bundle:
        csv_names = [name for name in bundle.namelist() if name.lower().endswith(".csv")]
        if len(csv_names) != 1:
            raise ValueError(f"Expected one CSV in {archive}, found {len(csv_names)}")
        with bundle.open(csv_names[0]) as binary:
            lines = (line.decode("utf-8-sig") for line in binary)
            for row in csv.DictReader(lines):
                rows_seen += 1
                if not row["Start_Time"].startswith(PERIOD):
                    continue
                june_rows += 1
                origin = station_id(row["Start_Station_Id"])
                destination = station_id(row["End_Station_Id"])
                if origin not in stations or destination not in stations:
                    missing_station_rows += 1
                    continue
                try:
                    duration = int(float(row["Trip_Duration"]))
                except (TypeError, ValueError):
                    invalid_duration_rows += 1
                    continue
                if not MIN_DURATION_SECONDS <= duration <= MAX_DURATION_SECONDS:
                    invalid_duration_rows += 1
                    continue
                aggregates[(origin, destination)][0] += 1
                aggregates[(origin, destination)][1] += duration
                accepted_rows += 1

    ranked = sorted(aggregates.items(), key=lambda item: (-item[1][0], item[0]))[:MAX_FLOWS]
    maximum = ranked[0][1][0] if ranked else 1
    flows = [
        {
            "origin": stations[origin],
            "destination": stations[destination],
            "trip_count": count,
            "relative_weight": round(count / maximum, 6),
            "mean_duration_seconds": round(total_duration / count, 1),
        }
        for (origin, destination), (count, total_duration) in ranked
    ]

    payload = {
        "schema_version": "1.0.0",
        "data_status": "observed",
        "period": PERIOD,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "archive_rows_scanned": rows_seen,
            "june_rows": june_rows,
            "accepted_rows": accepted_rows,
            "missing_current_station_rows": missing_station_rows,
            "invalid_duration_rows": invalid_duration_rows,
            "unique_od_pairs": len(aggregates),
            "published_top_od_pairs": len(flows),
            "duration_range_seconds": [MIN_DURATION_SECONDS, MAX_DURATION_SECONDS],
        },
        "flows": flows,
        "limitations": [
            "Station metadata is a current snapshot joined to historical 2024 trips; retired or renamed stations may not match.",
            "Only the top OD pairs are published for browser performance.",
            "Bike Share users and station geography do not represent all Toronto cycling demand.",
        ],
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(flows):,} observed OD flows from {accepted_rows:,} accepted June trips to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
