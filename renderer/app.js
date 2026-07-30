// ---------------------------------------------------------------------------
// PITWALL renderer — status chips, leaderboard, track map, flags/penalties,
// and own-car telemetry (gear/speed/rpm/tyres/throttle-brake trace).
// ---------------------------------------------------------------------------

const TOTAL_LEDS = 20;
const rpmbar = document.getElementById("rpmbar");
for (let i = 0; i < TOTAL_LEDS; i++) {
  const d = document.createElement("div");
  d.className = "rpmled";
  rpmbar.appendChild(d);
}
const leds = [...rpmbar.children];

const state = { maxRpm: 13000 };

function setDot(id, on) {
  const el = document.getElementById(id);
  el.classList.remove("on", "off");
  el.classList.add(on ? "on" : "off");
}

function fmtMs(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000);
  const s = ((abs % 60000) / 1000).toFixed(3).padStart(6, "0");
  return m > 0 ? `${sign}${m}:${s}` : `${sign}${(abs / 1000).toFixed(3)}`;
}
function fmtGap(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms === 0)
    return "—";
  return (ms >= 0 ? "+" : "") + (ms / 1000).toFixed(3);
}
// F1 2020 has no native time-delta field in LapData, so gap/interval are derived from
// m_totalDistance and shown in metres rather than seconds (see main.js for details).
function fmtGapMetres(m) {
  if (m === null || m === undefined || Number.isNaN(m) || m === 0) return "—";
  return (m >= 0 ? "+" : "") + Math.round(m) + "m";
}

// ---- top strip / connection status ----
window.pitwall.on("network-info", ({ ip, port }) => {
  document.getElementById("ipVal").textContent = ip;
  setDot("dotServer", true);
});

window.pitwall.on("phone-status", ({ connected }) => {
  setDot("dotPhone", connected);
  document.getElementById("phoneVal").textContent = connected
    ? "Terhubung"
    : "Terputus";
});

window.pitwall.on("vigem-status", ({ connected }) => {
  setDot("dotVigem", connected);
  document.getElementById("vigemVal").textContent = connected
    ? "Aktif"
    : "Nonaktif";
});

window.pitwall.on("latency", ({ ms }) => {
  document.getElementById("pingVal").textContent = ms + " ms";
});

// ---- session info ----
const WEATHER_NAME = [
  "Cerah",
  "Mendung Tipis",
  "Mendung",
  "Hujan Ringan",
  "Hujan",
  "Badai",
];
window.pitwall.on("session-info", (s) => {
  document.getElementById("trackVal").textContent =
    s.trackId != null ? `#${s.trackId}` : "—";
  document.getElementById("mapTrackName").textContent =
    s.trackId != null ? `TRACK #${s.trackId}` : "—";
  document.getElementById("weatherVal").textContent =
    WEATHER_NAME[s.weather] || "—";

  const chip = document.getElementById("trackStatusChip");
  const val = document.getElementById("statusVal");
  val.textContent = s.trackStatus;
  chip.classList.remove("clear", "sc", "vsc");
  if (s.trackStatus === "CLEAR") chip.classList.add("clear");
  else if (s.trackStatus === "SAFETY CAR") chip.classList.add("sc");
  else if (s.trackStatus === "VIRTUAL SC") chip.classList.add("vsc");

  const lapCounter = document.getElementById("lapCounter");
  if (s.totalLaps) lapCounter.textContent = `L?/${s.totalLaps}`;

  const banner = document.getElementById("trackStatusBanner");
  banner.textContent = s.trackStatus;
  banner.classList.toggle("warn", s.trackStatus !== "CLEAR");
});

// ---- flags ----
// F1 2020 gives two independent flag signals: the marshal-zone list (track-wide, from the
// Session packet) and m_vehicleFiaFlags (personal, from the CarStatus packet — "what flag
// is being shown to me right now"). We OR them together so either source can light a chip.
window.pitwall.on("flags", ({ zones, trackStatus, ownCarFlag }) => {
  const present = new Set((zones || []).map((z) => z.flag));
  if (ownCarFlag) present.add(ownCarFlag);

  const map = {
    flagGreen: present.has("GREEN") || present.size === 0,
    flagYellow: present.has("YELLOW"),
    flagBlue: present.has("BLUE"),
    flagRed: present.has("RED"),
  };
  document
    .getElementById("flagGreen")
    .classList.toggle("active-green", map.flagGreen && !map.flagYellow);
  document
    .getElementById("flagYellow")
    .classList.toggle("active-yellow", map.flagYellow);
  document
    .getElementById("flagBlue")
    .classList.toggle("active-blue", map.flagBlue);

  // "double yellow" = 2+ zones simultaneously showing yellow
  const yellowCount = (zones || []).filter((z) => z.flag === "YELLOW").length;
  document
    .getElementById("flagDoubleYellow")
    .classList.toggle("active-yellow", yellowCount >= 2);

  if (trackStatus) {
    const banner = document.getElementById("trackStatusBanner");
    banner.textContent = trackStatus;
    banner.classList.toggle("warn", trackStatus !== "CLEAR");
  }
});

// ---- penalties ----
const PENALTY_TYPE = {
  0: "Drive-through",
  1: "Stop & Go",
  2: "Grid penalty",
  3: "Penalty reminder",
  4: "Time penalty",
  5: "Warning",
  6: "Disqualified",
  7: "Removed from formation",
  8: "Parked too long",
  9: "Tyre regs",
  10: "This lap invalidated",
  11: "This+next lap invalidated",
  12: "This lap invalidated (no reason)",
  13: "This+next invalidated (no reason)",
  14: "This+prev invalidated",
  15: "This+prev invalidated (no reason)",
  16: "Retired",
  17: "Black flag timer",
};
window.pitwall.on("penalties", (list) => {
  document.getElementById("penCount").textContent = list.length;
  const el = document.getElementById("penList");
  if (!list.length) {
    el.innerHTML = `<li class="empty">Belum ada penalty</li>`;
    return;
  }
  el.innerHTML = list
    .map(
      (p) => `
    <li>
      <div class="pen-head"><span>${p.driver}</span><span>${p.seconds ? "+" + p.seconds + "s" : ""}</span></div>
      <div class="pen-sub">${PENALTY_TYPE[p.penaltyType] || "Penalty"} · Lap ${p.lap ?? "—"}</div>
    </li>
  `,
    )
    .join("");
});

// ---- leaderboard ----
window.pitwall.on("leaderboard", (rows) => {
  const body = document.getElementById("lbBody");
  if (!rows || !rows.length) return;

  const leaderBest = Math.min(...rows.map((r) => r.bestLapMs).filter((v) => v));

  body.innerHTML = rows
    .map((r) => {
      const isBestOverall = r.bestLapMs && r.bestLapMs === leaderBest;
      return `
    <tr class="${r.isPlayer ? "me" : ""} ${r.inPit ? "inpit" : ""}">
      <td class="pos lb-num">${r.position ?? "-"}</td>
      <td><span class="teamtag" style="background:${r.color}">${r.tag}</span> ${r.name}${r.inPit ? ' <span class="pit-badge">PIT</span>' : ""}</td>
      <td class="lb-num">${fmtGapMetres(r.gapM)}</td>
      <td class="lb-num">${fmtGapMetres(r.intervalM)}</td>
      <td class="lb-num">${r.s1Ms ? (r.s1Ms / 1000).toFixed(3) : "—"}</td>
      <td class="lb-num">${r.s2Ms ? (r.s2Ms / 1000).toFixed(3) : "—"}</td>
      <td class="lb-num">${fmtMs(r.lastLapMs)}</td>
      <td class="lb-num" style="color:${isBestOverall ? "var(--purple)" : "var(--green)"}">${fmtMs(r.bestLapMs)}</td>
      <td class="lb-num">${r.penalties ? "+" + r.penalties + "s" : "—"}</td>
    </tr>
  `;
    })
    .join("");

  const me = rows.find((r) => r.isPlayer);
  if (me) {
    const counter = document.getElementById("lapCounter");
    const totalLaps = counter.textContent.split("/")[1] || "?";
    counter.textContent = `L${me.lapNum ?? "?"}/${totalLaps}`;
  }
});

// ---- track map: live-traced outline + car dots ----
const trackSvg = document.getElementById("trackSvg");
let currentBounds = null;
let outlinePath = null;

function projectToSvg(x, z, bounds) {
  const pad = 24;
  const w = 300 - pad * 2,
    h = 300 - pad * 2;
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;
  const scale = Math.min(w / rangeX, h / rangeZ);
  const offX = (300 - rangeX * scale) / 2;
  const offZ = (300 - rangeZ * scale) / 2;
  return {
    x: offX + (x - bounds.minX) * scale,
    y: offZ + (z - bounds.minZ) * scale,
  };
}

window.pitwall.on("track-trace", ({ points, bounds, complete }) => {
  document.getElementById("traceStatus").textContent = complete
    ? "COMPLETE"
    : "TRACING…";
  if (!points || points.length < 2 || !bounds) return;
  currentBounds = bounds;

  const pts = points.map((p) => projectToSvg(p.x, p.z, bounds));
  const d =
    "M " +
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") +
    (complete ? " Z" : "");

  if (!outlinePath) {
    outlinePath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    outlinePath.setAttribute("class", "track-outline");
    trackSvg.appendChild(outlinePath);
  }
  outlinePath.setAttribute("d", d);
});

let carDots = {};
window.pitwall.on("car-positions", ({ positions, bounds }) => {
  document.getElementById("mapCarCount").textContent = (positions || []).filter(
    (p) => Math.abs(p.x) > 0.01 || Math.abs(p.z) > 0.01,
  ).length;
  const useBounds = bounds || currentBounds;
  if (!useBounds) return;

  positions.forEach((p) => {
    if (Math.abs(p.x) < 0.01 && Math.abs(p.z) < 0.01) return; // not on track
    const proj = projectToSvg(p.x, p.z, useBounds);
    let dot = carDots[p.idx];
    if (!dot) {
      dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", p.isPlayer ? 4.5 : 3.2);
      dot.setAttribute("class", "car-dot" + (p.isPlayer ? " player" : ""));
      dot.setAttribute("fill", p.isPlayer ? "#00d4ff" : "#8b9bb0");
      trackSvg.appendChild(dot);
      carDots[p.idx] = dot;
    }
    dot.setAttribute("cx", proj.x.toFixed(1));
    dot.setAttribute("cy", proj.y.toFixed(1));
  });
});

// ---- own-car telemetry ----
function tyreColor(t) {
  if (t == null) return "#1a1f28";
  if (t < 85) return "#29b6f6";
  if (t <= 105) return "#17e88f";
  return "#ff2b4d";
}

const throttleHistory = [];
const brakeHistory = [];
const MAX_POINTS = 240; // ~60s at 4Hz

window.pitwall.on("telemetry", (d) => {
  if (d.maxRpm) state.maxRpm = d.maxRpm;

  if (typeof d.gear !== "undefined") {
    const label = d.gear === -1 ? "R" : d.gear === 0 ? "N" : d.gear;
    document.getElementById("gearval").textContent = label;
  }

  if (typeof d.speed !== "undefined") {
    document.getElementById("speedval").innerHTML =
      Math.round(d.speed) + "<span>KM/H</span>";
  }

  if (typeof d.throttle !== "undefined" || typeof d.brake !== "undefined") {
    throttleHistory.push(d.throttle ?? 0);
    brakeHistory.push(d.brake ?? 0);
    if (throttleHistory.length > MAX_POINTS) throttleHistory.shift();
    if (brakeHistory.length > MAX_POINTS) brakeHistory.shift();
    drawChart();
  }

  if (typeof d.rpm !== "undefined") {
    const pct = Math.min(100, Math.round((d.rpm / state.maxRpm) * 100));
    document.getElementById("rpmPct").textContent = pct + "%";
    document.getElementById("rpmnum").textContent = Math.round(d.rpm);
    const lit = Math.round((pct / 100) * TOTAL_LEDS);
    leds.forEach((el, i) => {
      let c = "#1a1f28";
      if (i < lit) {
        if (i >= TOTAL_LEDS - 3) c = "#3d7bfd";
        else if (i >= TOTAL_LEDS * 0.55) c = "#ff2b4d";
        else c = "#17e88f";
      }
      el.style.background = c;
    });
    document
      .getElementById("gearval")
      .classList.toggle("redline", lit >= TOTAL_LEDS - 3);
  }

  if (typeof d.drs !== "undefined") {
    document.getElementById("drsVal").textContent = d.drs === 1 ? "ON" : "OFF";
  }

  if (typeof d.tyreTemp !== "undefined") {
    const [rl, rr, fl, fr] = d.tyreTemp;
    const map = { tFL: fl, tFR: fr, tRL: rl, tRR: rr };
    for (const [id, t] of Object.entries(map)) {
      document.getElementById(id).setAttribute("fill", tyreColor(t));
    }
    document.getElementById("txtFL").textContent = "FL " + Math.round(fl) + "°";
    document.getElementById("txtFR").textContent = "FR " + Math.round(fr) + "°";
    document.getElementById("txtRL").textContent = "RL " + Math.round(rl) + "°";
    document.getElementById("txtRR").textContent = "RR " + Math.round(rr) + "°";
  }

  if (typeof d.ersMode !== "undefined") {
    const names = ["NONE", "MED", "HOTLAP", "OVERTAKE"];
    document.getElementById("ersMode").textContent = names[d.ersMode] || "NONE";
  }
  if (typeof d.ersEnergy !== "undefined") {
    const pct =
      Math.min(100, Math.max(0, Math.round((d.ersEnergy / 4000000) * 100))) ||
      0;
    document.getElementById("ersEnergy").textContent = pct + "%";
  }
  if (typeof d.fuel !== "undefined") {
    document.getElementById("fuelVal").textContent = d.fuel.toFixed(1) + " KG";
  }
  if (typeof d.delta !== "undefined") {
    const el = document.getElementById("deltaval");
    const val = parseFloat(d.delta) || 0;
    el.textContent = (val > 0 ? "+" : "") + val.toFixed(3);
    el.classList.remove("neg", "pos");
    el.classList.add(val < 0 ? "neg" : "pos");
  }
});

// ---- throttle/brake trace (replaces the old speed-only oscilloscope) ----
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio;
  canvas.height = r.height * devicePixelRatio;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function drawSeries(values, color, max) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * devicePixelRatio;
  values.forEach((v, i) => {
    const x = (i / (MAX_POINTS - 1)) * canvas.width;
    const y = canvas.height - (v / max) * canvas.height * 0.92 - 3;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawChart() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(35,43,56,0.9)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (canvas.height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  if (throttleHistory.length < 2) return;
  drawSeries(throttleHistory, "#17e88f", 1);
  drawSeries(brakeHistory, "#ff2b4d", 1);
}
