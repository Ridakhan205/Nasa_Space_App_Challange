/* ASTRA dashboard logic — no framework, no external chart library. */

const state = {
  overview: null,
  subjects: [],
  subject: null,
  windows: [],
  cursor: 0,
  playing: false,
  timer: null,
};

const THRESHOLD_DEFAULT = 0.32;

/* ------------------------------------------------------------------ utils */

const fmt = (value, digits = 0) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : Number(value).toFixed(digits);

function el(id) {
  return document.getElementById(id);
}

function scale(value, min, max, height, pad) {
  if (max === min) return pad + height / 2;
  return pad + height - ((value - min) / (max - min)) * height;
}

function linePath(values, xFn, yFn) {
  if (!values.length) return "";
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${xFn(index).toFixed(1)},${yFn(value).toFixed(1)}`)
    .join(" ");
}

/* ----------------------------------------------------------------- charts */

function drawChart(container, series, options = {}) {
  const width = 860;
  const height = options.height || 250;
  const pad = { top: 14, right: 16, bottom: 22, left: 40 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const all = series.flatMap((item) => item.values).filter((value) => Number.isFinite(value));
  const min = options.min !== undefined ? options.min : Math.min(...all, 0);
  const max = options.max !== undefined ? options.max : Math.max(...all, 1);
  const count = Math.max(...series.map((item) => item.values.length), 2);

  const xFn = (index) => pad.left + (index / Math.max(count - 1, 1)) * innerWidth;
  const yFn = (value) => scale(value, min, max, innerHeight, pad.top);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const y = pad.top + innerHeight * fraction;
      const label = (max - (max - min) * fraction).toFixed(options.decimals ?? 0);
      return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + innerWidth}" y2="${y}" stroke="#1a2537" stroke-width="1"/>
              <text x="6" y="${y + 3}" fill="#6f84a3" font-size="9.5">${label}</text>`;
    })
    .join("");

  const thresholdLine =
    options.threshold !== undefined && options.threshold >= min && options.threshold <= max
      ? `<line x1="${pad.left}" y1="${yFn(options.threshold)}" x2="${pad.left + innerWidth}" y2="${yFn(options.threshold)}"
               stroke="#f5b83d" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.85"/>`
      : "";

  const paths = series
    .map((item) => {
      const path = linePath(item.values, xFn, yFn);
      const area = item.fill
        ? `${path} L${xFn(item.values.length - 1).toFixed(1)},${(pad.top + innerHeight).toFixed(1)} L${pad.left},${(pad.top + innerHeight).toFixed(1)} Z`
        : "";
      return `${area ? `<path d="${area}" fill="${item.color}" opacity="0.10"/>` : ""}
              <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${item.width || 2}"
                    stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");

  const alerts = options.alertIndices || [];
  const markers = alerts
    .map(
      (index) =>
        `<line x1="${xFn(index)}" y1="${pad.top}" x2="${xFn(index)}" y2="${pad.top + innerHeight}"
               stroke="#4c8dff" stroke-width="1" opacity="0.35"/>`
    )
    .join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${options.label || "chart"}">
      ${gridLines}
      ${thresholdLine}
      ${markers}
      ${paths}
      <line x1="${pad.left}" y1="${pad.top + innerHeight}" x2="${pad.left + innerWidth}" y2="${pad.top + innerHeight}" stroke="#1c2839"/>
    </svg>`;
}

/* ------------------------------------------------------------------ render */

function currentWindow() {
  return state.windows[Math.min(state.cursor, state.windows.length - 1)] || null;
}

function visibleWindows() {
  return state.windows.slice(0, Math.max(state.cursor, 1));
}

function renderHeader() {
  const overview = state.overview;
  if (!overview) return;

  el("modelChips").innerHTML = [
    `Model <b>${overview.model.replace("_", " ")}</b>`,
    `<b>${overview.n_features}</b> features`,
    `AUC <b>${overview.metrics.auc}</b>`,
    `Threshold <b>${overview.threshold}</b>`,
    `<b>${overview.dataset.subjects}</b> pilots · <b>${overview.dataset.windows}</b> windows`,
  ]
    .map((text) => `<span class="chip">${text}</span>`)
    .join("");
}

function renderStatus() {
  const window = currentWindow();
  const pill = el("statusPill");
  if (!window) {
    pill.className = "pill baseline";
    pill.textContent = "No data";
    return;
  }
  const loaded = window.state === "loaded";
  pill.className = `pill ${loaded ? "loaded" : "baseline"}`;
  pill.textContent = loaded ? "Elevated cognitive load" : "Baseline state";

  const stateCard = el("kpiState");
  stateCard.className = `card kpi ${loaded ? "crit" : "ok"}`;
  stateCard.querySelector(".value").textContent = loaded ? "ELEVATED" : "BASELINE";

  const riskCard = el("kpiRisk");
  riskCard.className = `card kpi ${window.risk >= state.overview.threshold ? "crit" : ""}`;
  riskCard.querySelector(".value").textContent = `${(window.risk * 100).toFixed(0)}%`;
  el("kpiRiskSub").textContent = `alert at ${(state.overview.threshold * 100).toFixed(0)}%`;
}

function renderCharts() {
  const visible = visibleWindows();
  const threshold = state.overview.threshold;
  const alertIndices = [];
  visible.forEach((window, index) => {
    if (window.risk >= threshold) alertIndices.push(index);
  });

  drawChart(
    el("riskChart"),
    [{ name: "risk", color: "#ef4b5b", values: visible.map((w) => w.risk), fill: true }],
    { min: 0, max: 1, threshold, decimals: 2, alertIndices, label: "load probability", height: 260 }
  );

  drawChart(
    el("vitalsChart"),
    [
      { name: "hr", color: "#4c8dff", values: visible.map((w) => w.heart_rate) },
      { name: "hrv", color: "#2fbf71", values: visible.map((w) => w.rmssd_ms) },
      { name: "resp", color: "#9d7bff", values: visible.map((w) => w.resp_rate) },
    ],
    { min: undefined, max: undefined, label: "cardiovascular trend", height: 240 }
  );

  drawChart(
    el("eegChart"),
    [
      { name: "theta", color: "#9d7bff", values: visible.map((w) => (w.eeg ? w.eeg.theta : null)) },
      { name: "alpha", color: "#4c8dff", values: visible.map((w) => (w.eeg ? w.eeg.alpha : null)) },
      { name: "beta", color: "#f5b83d", values: visible.map((w) => (w.eeg ? w.eeg.beta : null)) },
    ],
    { min: 0, max: undefined, decimals: 2, label: "EEG band power", height: 230 }
  );
}

function renderAlerts() {
  const threshold = state.overview.threshold;
  const visible = visibleWindows();

  const episodes = [];
  let current = null;
  visible.forEach((window) => {
    if (window.risk >= threshold) {
      if (!current) current = { start: window, count: 1, peak: window.risk };
      else {
        current.count += 1;
        if (window.risk > current.peak) {
          current.peak = window.risk;
          current.peakWindow = window;
        }
      }
    } else if (current) {
      episodes.push(current);
      current = null;
    }
  });
  if (current) episodes.push(current);

  el("kpiAlerts").querySelector(".value").textContent = visible.filter(
    (window) => window.risk >= threshold
  ).length;

  const list = el("alertList");
  if (!episodes.length) {
    list.innerHTML = `<div class="empty">No elevated-load episodes yet.</div>`;
    return;
  }

  list.innerHTML = episodes
    .slice()
    .reverse()
    .map(
      (episode) => `
      <div class="alert">
        <div class="t">Elevated load · ${episode.count} window${episode.count > 1 ? "s" : ""} · peak ${(episode.peak * 100).toFixed(0)}%</div>
        <div class="d">
          Session ${episode.start.session}, t=${episode.start.start_s}s · HR ${episode.start.heart_rate} bpm,
          RMSSD ${episode.start.rmssd_ms} ms, respiration ${episode.start.resp_rate}/min<br />
          Model-generated indication — consider a break and a self-check. Not a diagnosis.
        </div>
      </div>`
    )
    .join("");
}

function renderSnapshot() {
  const window = currentWindow();
  if (!window) return;
  el("snapHr").textContent = `${window.heart_rate}`;
  el("snapRmssd").textContent = `${window.rmssd_ms}`;
  el("snapResp").textContent = `${window.resp_rate}`;
  el("snapGsr").textContent = `${window.gsr_mean}`;
  el("riskNow").textContent = `${(window.risk * 100).toFixed(0)}%`;
}

function renderHistory() {
  const rows = visibleWindows()
    .slice(-60)
    .reverse()
    .map(
      (window) => `
      <tr class="${window.state === "loaded" ? "loaded" : ""}">
        <td>${window.index + 1}</td>
        <td>${window.session}</td>
        <td>${window.start_s}</td>
        <td>${window.heart_rate}</td>
        <td>${window.rmssd_ms}</td>
        <td>${(window.risk * 100).toFixed(0)}%</td>
        <td>${window.state === "loaded" ? "Elevated" : "Baseline"}</td>
      </tr>`
    )
    .join("");
  el("historyBody").innerHTML = rows || `<tr><td colspan="7" class="empty">No windows processed yet.</td></tr>`;
}

function renderProgress() {
  const total = state.windows.length;
  const done = state.cursor;
  el("counter").textContent = `${done} / ${total}`;
  el("progressBar").style.width = `${total ? (done / total) * 100 : 0}%`;
  el("kpiWindows").querySelector(".value").textContent = done;
}

function renderAll() {
  renderStatus();
  renderCharts();
  renderAlerts();
  renderSnapshot();
  renderHistory();
  renderProgress();
}

/* --------------------------------------------------------------- playback */

function stopPlayback() {
  state.playing = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  el("playBtn").textContent = "▶ Resume monitoring";
}

function startPlayback() {
  if (!state.windows.length) return;
  if (state.cursor >= state.windows.length) state.cursor = 0;
  state.playing = true;
  el("playBtn").textContent = "⏸ Pause";
  state.timer = setInterval(() => {
    if (state.cursor >= state.windows.length) {
      stopPlayback();
      el("playBtn").textContent = "▶ Replay session";
      return;
    }
    state.cursor += 1;
    renderAll();
  }, 90);
}

/* ------------------------------------------------------------------- load */

async function loadSubject(subjectId) {
  stopPlayback();
  state.subject = subjectId;
  const response = await fetch(`/api/stream/${subjectId}`);
  const payload = await response.json();
  state.windows = payload.windows;
  state.cursor = Math.min(1, state.windows.length);
  renderAll();
}

async function init() {
  const [overview, subjects] = await Promise.all([
    fetch("/api/overview").then((r) => r.json()),
    fetch("/api/subjects").then((r) => r.json()),
  ]);

  state.overview = overview;
  state.subjects = subjects;
  renderHeader();

  const select = el("subjectSelect");
  select.innerHTML = subjects
    .map(
      (subject) =>
        `<option value="${subject.id}">Pilot ${subject.id} · ${subject.windows} windows · ${subject.sessions.join(", ")}</option>`
    )
    .join("");

  if (subjects.length) await loadSubject(subjects[0].id);

  select.addEventListener("change", (event) => loadSubject(event.target.value));
  el("playBtn").addEventListener("click", () => (state.playing ? stopPlayback() : startPlayback()));
  el("resetBtn").addEventListener("click", () => {
    stopPlayback();
    state.cursor = 1;
    renderAll();
  });
}

/* ----------------------------------------------------------------- upload */

async function uploadFile(file) {
  const result = el("uploadResult");
  result.innerHTML = `<div class="empty">Analysing ${file.name}…</div>`;

  const body = new FormData();
  body.append("file", file);

  const response = await fetch("/api/upload", { method: "POST", body });
  const payload = await response.json();

  if (!response.ok) {
    const detail = payload.detail;
    const message =
      typeof detail === "string"
        ? detail
        : `${detail.message} (${detail.missing_count} missing, e.g. ${detail.missing.slice(0, 4).join(", ")})`;
    result.innerHTML = `<div class="error">${message}</div>`;
    return;
  }

  const summary = payload.summary;
  result.innerHTML = `
    <div class="upload-summary">
      <div><b>${payload.rows}</b>windows analysed</div>
      <div><b>${summary.loaded_windows}</b>elevated load</div>
      <div><b>${(summary.mean_risk * 100).toFixed(0)}%</b>mean risk</div>
      <div><b>${(summary.peak_risk * 100).toFixed(0)}%</b>peak risk</div>
    </div>
    <div class="empty">Threshold ${summary.threshold}${summary.subject ? ` · subject ${summary.subject}` : ""}</div>
    <table style="margin-top:10px;">
      <thead><tr><th>#</th><th>Session</th><th>Time</th><th>HR</th><th>Risk</th><th>State</th></tr></thead>
      <tbody>
        ${payload.windows
          .slice(0, 12)
          .map(
            (window) => `<tr class="${window.state === "loaded" ? "loaded" : ""}">
              <td>${window.index + 1}</td><td>${window.session}</td><td>${window.start_s}</td>
              <td>${window.heart_rate}</td><td>${(window.risk * 100).toFixed(0)}%</td>
              <td>${window.state === "loaded" ? "Elevated" : "Baseline"}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function initUpload() {
  const drop = el("dropZone");
  const input = el("fileInput");

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files[0] && uploadFile(input.files[0]));

  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("hot");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove("hot");
    })
  );
  drop.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
}

init();
initUpload();
