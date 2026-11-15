# ASTRA

**AI-Driven Crew Cognitive State Monitoring and Early Warning System**

ASTRA estimates whether a crew member is operating at **baseline** or under **elevated
cognitive load**, from 30 seconds of physiological data — and raises a plain-language
early warning when the load stays high.

Built for the **NASA Space Apps Challenge 2026** challenge *"Create Health Monitoring
Software for Astronauts on Space Missions"*.

- **Team:** Adromeda · **Event:** Universal Local Event
- **Data:** real, publicly released NASA flight-crew physiology (no simulation)
- **Status:** research prototype — decision support only, not a medical device

---

## The problem

Crew members in aviation and spaceflight face situations that demand sustained attention
and fast, correct decisions. Under stress, attention can fail in three recognisable ways:

| State | What happens | Operational consequence |
| --- | --- | --- |
| **Startle / surprise** | A sudden event disrupts attention and decision quality | Slower, riskier reactions |
| **Channelized attention** | Fixation on one task; other signals go unseen | Missed warnings, degraded situational awareness |
| **Diverted attention** | Attention pulled to another task at the wrong moment | Task errors under high workload |

On long-duration missions there is no clinician beside the crew. The astronaut has to
notice the change in themselves and act on it — which is exactly the gap ASTRA targets.

### Why we changed direction

Our first concept was an **orthostatic intolerance (OI)** early-warning system. During the
research phase we could not find a public, labelled astronaut cardiovascular/OI dataset:
NASA's human research data (LSDA / LSAH) is available through an approved data request,
and the Apollo-era OI results survive only as scanned report tables, not as a trainable
dataset.

Rather than build an unsupported cardiovascular predictor, we followed the data: NASA
publishes real, labelled flight-crew physiological recordings, so we built and validated a
cognitive-state model on those instead.


---

## What the system does

1. **Ingests physiological windows** — EEG, ECG, respiration and skin conductance.
2. **Extracts 36 features** — heart rate, HRV (RMSSD, SDNN), respiration rate, skin
   conductance level and slope, relative EEG theta/alpha/beta power, plus rolling means.
3. **Calibrates to the person** — per-subject normalisation, so the model reads physiology
   rather than identity (resting heart rate, electrode impedance).
4. **Predicts load** — a probability score and a state (`baseline` / `loaded`) at a
   calibrated threshold of **0.32**.
5. **Explains and warns** — the dashboard shows which signals moved, how long the episode
   lasted, and reminds the user that the output is a model-generated indication.

---

## Dataset

**Flight Crew Physiological Data for Crew State Monitoring** — NASA Open Data Portal
(public, no login): <https://data.nasa.gov/dataset/flight-crew-physiological-data-for-crew-state-monitoring>

| Property | Value |
| --- | --- |
| Subjects used | 6 pilots |
| Recordings | 24 (benchmark sessions + LOFT simulator flights) |
| Sampling rate | 256 Hz |
| Signals | 8 EEG channels, 3-point ECG, respiration, skin conductance |
| Windows extracted | 6,072 (30 s window, 5 s step) |
| Elevated-load windows | 1,180 |
| Labels | `Event` marker: baseline / startle (1) / channelized (2) / diverted (5) |

Labels are aggregated from the dataset's event markers into two classes: `baseline` and
`elevated load`.

---

## Model

| Item | Detail |
| --- | --- |
| Algorithm | Random Forest Classifier |
| Features | 36 |
| Threshold | 0.32 |
| Validation | **Leave-one-subject-out** — each pilot scored by a model trained only on the other five |
| Artefacts | Model bundle (`joblib`), metrics JSON, feature extractor, prediction CLI |

### Results (held-out pilots)

| Metric | Value |
| --- | --- |
| ROC-AUC | **0.626** |
| Recall | 0.540 |
| Precision | 0.269 |
| F1 score | 0.359 |

**Reading these honestly:** cardiac and skin-conductance features alone reached AUC ≈ 0.56;
adding EEG relative band power raised it to 0.63. Cross-person cognitive-state detection
from a single 30-second window is genuinely hard, and with six pilots the confidence
intervals are wide. The number is reported as measured, not tuned to look better.

---

## Architecture

```
  EEG · ECG · respiration · skin conductance
                 │
                 ▼
   signal processing  ──►  R-peak detection, RR artefact rejection,
                           relative EEG band power, rolling means
                 │
                 ▼
        36 features  ──►  per-subject calibration + smoothing
                 │
                 ▼
    Random Forest  ──►  probability ──► state (threshold 0.32)
                 │
                 ▼
       ASTRA dashboard  ──►  trends · alerts · history · CSV upload
```

| Component | Technology |
| --- | --- |
| API | Python, FastAPI, Uvicorn |
| ML | scikit-learn, joblib |
| Data processing | pandas, NumPy, SciPy |
| Frontend | HTML, CSS, vanilla JavaScript (inline SVG charts) |

---

## Quickstart

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PORT=3000 .venv/bin/python src/api.py
```

Open <http://localhost:3000>.

The repository ships with the trained model (`models/nasa_crew_state.joblib`) and the
extracted feature table (`data/features.csv`), so the dashboard runs immediately.

### API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/overview` | Model metadata and dataset summary |
| GET | `/api/subjects` | Available pilots and their sessions |
| GET | `/api/stream/{subject}` | Scored windows for one pilot (dashboard playback) |
| GET | `/api/metrics` | Leave-one-subject-out evaluation results |
| POST | `/api/upload` | Score an uploaded CSV of physiological features |

Upload example:

```bash
curl -X POST -F "file=@data/features.csv" http://localhost:3000/api/upload
```

Missing feature columns return `422` with the exact list of what is required.

---

## Project structure

```
astra/
├── src/
│   ├── api.py              FastAPI backend
│   ├── scoring.py          model loading, calibration, scoring
│   └── static/
│       ├── index.html      dashboard
│       └── app.js          playback, charts, alerts, upload
├── models/
│   ├── nasa_crew_state.joblib
│   └── nasa_metrics.json
├── data/
│   └── features.csv        extracted windows from the NASA recordings
└── requirements.txt
```

---

## Limitations

- **AUC 0.626 is modest.** This is a hard cross-person task with only six pilots.
- **Aggregated classes.** The model predicts baseline vs elevated load; it does not
  separately classify startle, channelized attention and diverted attention.
- **Not astronaut data.** The recordings are simulator and benchmark sessions with pilots,
  not spaceflight.
- **Not an OI or cardiovascular detector.** It does not diagnose any medical condition.
- **Not real-time.** Signal processing expects recorded windows; live sensor integration
  is future work.
- **Decision support only.** Outputs are model-generated indications, not medical advice.

---

## Future work

- More pilots and longer recordings to tighten the confidence intervals.
- Separate three-way classification of startle / channelized / diverted attention.
- Wearable and flight-simulator sensor integration for live streaming.
- Per-crew calibration with a short baseline recording at mission start.
- Revisit cardiovascular and orthostatic-intolerance monitoring once a labelled dataset is
  accessible through NASA's data request process.

---

## Team

| Member | Role | Country |
| --- | --- | --- |
| Emanuel William | ML and signal processing | Tanzania |
| Rida Khan | Backend and API | Pakistan |
| Emanuel dismas | Frontend and design | Tanzania |
| Sana Akram | Research and presentation | Bahrain |
| Benjamini mashimba | Research and presentation | Tanzania |

---

## Acknowledgements

Physiological data: NASA Open Data Portal, *Flight Crew Physiological Data for Crew State
Monitoring* (public domain / NASA open data terms).

Context on orthostatic intolerance in spaceflight: NASA Human Research Program and
published literature, including the systematic review on post-flight OI incidence (≈30%).

