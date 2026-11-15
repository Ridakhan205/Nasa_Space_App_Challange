"""Model loading and scoring for ASTRA.

Wraps the trained NASA crew-state model so the API can score windows that came
from the extracted feature file or from an upload.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_PATH = ROOT / "models" / "nasa_crew_state.joblib"

# Columns that identify a row rather than describe physiology.
META_COLUMNS = ["subject", "session", "start_s", "event", "event_label", "event_fraction"]

EEG_BANDS = ["theta", "alpha", "beta"]
EEG_CHANNELS = ["fz", "cz", "pz", "o1", "f3", "f4", "p3", "p4"]


def load_bundle() -> dict:
    if not BUNDLE_PATH.exists():
        raise RuntimeError(f"model bundle missing: {BUNDLE_PATH}")
    return joblib.load(BUNDLE_PATH)


def required_input_columns(bundle: dict) -> list[str]:
    """Columns an upload must contain (rolling means are derived here)."""
    return [column for column in bundle["features"] if not column.endswith("_r3")]


def add_rolling_means(frame: pd.DataFrame, bundle: dict) -> pd.DataFrame:
    frame = frame.copy()
    for column in bundle["smooth_base"]:
        if column in frame.columns and f"{column}_r3" not in frame.columns:
            frame[f"{column}_r3"] = frame[column].rolling(3, min_periods=1).mean()
    return frame


def score_frame(bundle: dict, frame: pd.DataFrame, subject: str | None = None) -> pd.DataFrame:
    """Add `load_risk` (0-1) and `state` (baseline/loaded) columns."""
    frame = add_rolling_means(frame, bundle)
    features = bundle["features"]

    missing = [column for column in features if column not in frame.columns]
    if missing:
        raise ValueError(f"missing feature columns: {', '.join(missing[:8])}")

    stats = bundle["subject_stats"].get(str(subject)) if subject else None
    if stats is None:
        stats = bundle["population_stats"]

    prepared = frame.copy()
    for column in features:
        mean, spread = stats[column]
        prepared[column] = (prepared[column] - mean) / (spread or 1.0)

    probabilities = bundle["model"].predict_proba(prepared[features])[:, 1]
    out = frame.copy()
    out["load_risk"] = probabilities.round(3)
    out["state"] = [
        "loaded" if probability >= bundle["threshold"] else "baseline"
        for probability in probabilities
    ]
    return out


def eeg_summary(row: pd.Series) -> dict:
    """Average relative band power across the EEG channels, for charting."""
    summary = {}
    for band in EEG_BANDS:
        values = [
            row.get(f"{channel}_{band}")
            for channel in EEG_CHANNELS
            if f"{channel}_{band}" in row.index
        ]
        values = [value for value in values if pd.notna(value)]
        summary[band] = round(float(sum(values) / len(values)), 4) if values else None
    return summary
