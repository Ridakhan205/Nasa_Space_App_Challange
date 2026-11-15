"""ASTRA backend — crew cognitive-state monitoring API.

Endpoints
    GET  /api/overview            model metadata + dataset summary
    GET  /api/subjects            pilots available for playback
    GET  /api/stream/{subject}    scored windows for one pilot
    GET  /api/metrics             leave-one-subject-out evaluation
    POST /api/upload              score an uploaded CSV of features

Run:
    python src/api.py            # port 8000 (or PORT)
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from scoring import (
    META_COLUMNS,
    ROOT,
    eeg_summary,
    load_bundle,
    required_input_columns,
    score_frame,
)

DATA_PATH = ROOT / "data" / "features.csv"
METRICS_PATH = ROOT / "models" / "nasa_metrics.json"
STATIC_DIR = ROOT / "src" / "static"

SESSION_ORDER = {"CA": 0, "DA": 1, "SS": 2, "LOFT": 3}

app = FastAPI(title="ASTRA", version="1.0")
BUNDLE = load_bundle()
DATA = pd.read_csv(DATA_PATH)


def _ordered(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["_session_order"] = frame["session"].map(SESSION_ORDER).fillna(9)
    return frame.sort_values(["_session_order", "start_s"]).drop(columns="_session_order")


def _window(row: pd.Series, index: int) -> dict:
    return {
        "index": index,
        "session": str(row["session"]),
        "start_s": round(float(row["start_s"]), 1),
        "heart_rate": round(float(row["heart_rate"]), 1),
        "rmssd_ms": round(float(row["rmssd_ms"]), 1),
        "sdnn_ms": round(float(row["sdnn_ms"]), 1),
        "resp_rate": round(float(row["resp_rate"]), 1),
        "gsr_mean": round(float(row["gsr_mean"]), 1),
        "gsr_slope": round(float(row["gsr_slope"]), 2),
        "risk": float(row["load_risk"]),
        "state": row["state"],
        "actual": str(row["event_label"]),
        "eeg": eeg_summary(row),
    }


@app.get("/api/overview")
def overview() -> dict:
    metrics = json.loads(METRICS_PATH.read_text()) if METRICS_PATH.exists() else {}
    best = metrics.get("results", {}).get(metrics.get("best_model", ""), {})
    return {
        "project": "ASTRA",
        "subtitle": "AI-Driven Crew Cognitive State Monitoring",
        "task": BUNDLE["task"],
        "threshold": BUNDLE["threshold"],
        "n_features": len(BUNDLE["features"]),
        "model": metrics.get("best_model", "random_forest"),
        "metrics": {
            "auc": best.get("auc"),
            "recall": best.get("recall"),
            "precision": best.get("precision"),
            "f1": best.get("f1"),
        },
        "dataset": {
            "source": BUNDLE["source"],
            "subjects": int(DATA["subject"].nunique()),
            "windows": int(len(DATA)),
            "sessions": int(DATA.groupby(["subject", "session"]).ngroups),
        },
    }


@app.get("/api/subjects")
def subjects() -> list[dict]:
    groups = DATA.groupby("subject")
    result = []
    for subject, group in groups:
        result.append(
            {
                "id": str(subject),
                "windows": int(len(group)),
                "sessions": sorted(group["session"].unique().tolist()),
                "loaded_windows": int((group["event_fraction"] > 0.2).sum()),
            }
        )
    return sorted(result, key=lambda item: item["id"])


@app.get("/api/stream/{subject}")
def stream(subject: str, limit: int = 400) -> dict:
    rows = DATA[DATA["subject"].astype(str) == subject]
    if rows.empty:
        raise HTTPException(status_code=404, detail="unknown subject")

    ordered = _ordered(rows)
    scored = score_frame(BUNDLE, ordered, subject=subject).head(limit)

    return {
        "subject": subject,
        "threshold": BUNDLE["threshold"],
        "windows": [_window(row, index) for index, (_, row) in enumerate(scored.iterrows())],
    }


@app.get("/api/metrics")
def metrics() -> dict:
    if not METRICS_PATH.exists():
        raise HTTPException(status_code=404, detail="metrics not found")
    return json.loads(METRICS_PATH.read_text())


@app.post("/api/upload")
def upload(file: UploadFile = File(...)) -> dict:
    try:
        raw = pd.read_csv(io.BytesIO(file.file.read()))
    except Exception as exc:  # noqa: BLE001 - surface a readable message
        raise HTTPException(status_code=400, detail=f"could not read CSV: {exc}") from exc

    required = required_input_columns(BUNDLE)
    missing = [column for column in required if column not in raw.columns]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "CSV is missing required physiological feature columns",
                "missing": missing[:12],
                "missing_count": len(missing),
                "required_count": len(required),
            },
        )

    subject = None
    try:
        if "subject" in raw.columns and raw["subject"].notna().any():
            # Calibrate each pilot with their own statistics when the file
            # contains several of them.
            subject = str(raw["subject"].dropna().iloc[0])
            parts = [
                score_frame(BUNDLE, group, subject=str(name))
                for name, group in raw.groupby("subject", sort=False)
            ]
            scored = pd.concat(parts, ignore_index=True)
        else:
            scored = score_frame(BUNDLE, raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    windows = [_window(row, index) for index, (_, row) in enumerate(scored.head(500).iterrows())]
    loaded = int((scored["load_risk"] >= BUNDLE["threshold"]).sum())

    return {
        "filename": file.filename,
        "rows": int(len(scored)),
        "windows": windows,
        "summary": {
            "loaded_windows": loaded,
            "baseline_windows": int(len(scored) - loaded),
            "mean_risk": round(float(scored["load_risk"].mean()), 3),
            "peak_risk": round(float(scored["load_risk"].max()), 3),
            "threshold": BUNDLE["threshold"],
            "subject": subject,
        },
    }


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
