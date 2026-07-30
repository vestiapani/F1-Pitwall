// ---------------------------------------------------------------------------
// PITWALL renderer — status chips, leaderboard, track map, flags/penalties,
// own-car telemetry (gear/speed/rpm/tyres/throttle-brake trace), plus the
// Overview / Telemetry / Timing page switcher.
// ---------------------------------------------------------------------------

// ---- page switcher ----
// All panels always live in the DOM and keep receiving live data no matter
// which page is active — switching pages just re-weights/hides sections via
// CSS ([data-page="..."] rules in index.html), so nothing needs to reload.
const appRoot = document.getElementById("app");
document.querySelectorAll(".navbtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".navbtn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    appRoot.dataset.page = btn.dataset.page;
    // Each page defines its own column count/widths in CSS (see index.html);
    // drop any manual resize override so the new page's layout applies cleanly,
    // then re-measure and re-drop the drag handles once the reflow settles.
    RESIZABLE_GRIDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.gridTemplateColumns = "";
    });
    setTimeout(layoutAllResizers, 50);
  });
});

// ---- connection mode: WiFi (default, no action needed) vs USB (adb reverse) ----
// The socket.io server always listens on 0.0.0.0:3000, so WiFi just works as long
// as the phone and PC share a network. "USB" additionally runs `adb reverse
// tcp:3000 tcp:3000` so a phone plugged in with USB debugging on can reach the
// server via 127.0.0.1:3000 even with no shared WiFi network.
const btnWifi = document.getElementById("btnWifi");
const btnUsb = document.getElementById("btnUsb");
const adbStatus = document.getElementById("adbStatus");

btnWifi.addEventListener("click", async () => {
  btnWifi.classList.add("active");
  btnUsb.classList.remove("active", "warn");
  adbStatus.textContent = "";
  try {
    await window.pitwall.adbReverseRemove();
  } catch {
    /* ignore — removing a tunnel that was never set up is harmless */
  }
});

btnUsb.addEventListener("click", async () => {
  adbStatus.textContent = "menghubungkan…";
  const res = await window.pitwall.adbReverse();
  if (res && res.ok) {
    btnUsb.classList.add("active");
    btnUsb.classList.remove("warn");
    btnWifi.classList.remove("active");
    adbStatus.textContent = "adb reverse aktif";
  } else {
    btnUsb.classList.add("warn");
    btnUsb.classList.remove("active");
    adbStatus.textContent = "gagal — cek USB debugging / adb di PATH";
  }
});

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
// sector time colour: purple = session-fastest, green = personal-best improvement,
// red = not an improvement (set by main.js, see classifySector)
function sectorCls(cls) {
  return cls ? ` s-${cls}` : "";
}

// ---------------------------------------------------------------------------
// ---- resizable columns (drag dividers between grid panels) ----
// Works generically over the two multi-column grids (#zoneA, #zoneB): measures
// whichever direct-child columns are currently visible, drops a thin draggable
// handle between each adjacent pair, and dragging adjusts just that pair of
// tracks (converted to px) while leaving the others alone. Because Overview /
// Telemetry / Timing each define a different column count via CSS, the inline
// override is cleared on every page switch (see the navbtn handler above) so
// the new page's own layout takes over before we re-measure.
// ---------------------------------------------------------------------------
const RESIZABLE_GRIDS = ["zoneA", "zoneB"];

function visibleColumns(el) {
  return [...el.children].filter(
    (c) => !c.classList.contains("col-resizer") && c.offsetParent !== null,
  );
}

function saveColWidths(gridId, page, widths) {
  try {
    localStorage.setItem(
      `pitwall-cols-${gridId}-${page}`,
      JSON.stringify(widths),
    );
  } catch {
    /* storage unavailable — resizing still works, just won't persist */
  }
}
function loadColWidths(gridId, page, count) {
  try {
    const raw = localStorage.getItem(`pitwall-cols-${gridId}-${page}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === count) return arr;
  } catch {
    /* ignore malformed/unavailable storage */
  }
  return null;
}

function layoutResizers(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.querySelectorAll(".col-resizer").forEach((r) => r.remove());

  const cols = visibleColumns(grid);
  if (cols.length < 2) return;

  const page = appRoot.dataset.page;
  const saved = loadColWidths(gridId, page, cols.length);
  if (saved) {
    grid.style.gridTemplateColumns = saved.map((w) => w + "px").join(" ");
  }

  const gridRect = grid.getBoundingClientRect();
  cols.slice(0, -1).forEach((col, i) => {
    const rect = col.getBoundingClientRect();
    const x = rect.right - gridRect.left;
    const handle = document.createElement("div");
    handle.className = "col-resizer";
    handle.style.left = x - 4 + "px";
    grid.appendChild(handle);

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      const startWidths = getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .map((v) => parseFloat(v));
      const startX = e.clientX;

      function onMove(ev) {
        const delta = ev.clientX - startX;
        const widths = [...startWidths];
        widths[i] = Math.max(80, startWidths[i] + delta);
        widths[i + 1] = Math.max(80, startWidths[i + 1] - delta);
        grid.style.gridTemplateColumns = widths.map((w) => w + "px").join(" ");
      }
      function onUp() {
        handle.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const finalWidths = getComputedStyle(grid)
          .gridTemplateColumns.split(" ")
          .map((v) => parseFloat(v));
        saveColWidths(gridId, appRoot.dataset.page, finalWidths);
        layoutResizers(gridId); // re-drop handles at their new boundaries
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function layoutAllResizers() {
  RESIZABLE_GRIDS.forEach(layoutResizers);
}

window.addEventListener("resize", () => {
  clearTimeout(window._resizeT);
  window._resizeT = setTimeout(layoutAllResizers, 120);
});
setTimeout(layoutAllResizers, 300); // once after first paint/layout settles

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
let lastSeenLapMs = null;
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
      <td class="lb-num${sectorCls(r.s1Cls)}">${r.s1Ms ? (r.s1Ms / 1000).toFixed(3) : "—"}</td>
      <td class="lb-num${sectorCls(r.s2Cls)}">${r.s2Ms ? (r.s2Ms / 1000).toFixed(3) : "—"}</td>
      <td class="lb-num${sectorCls(r.s3Cls)}">${r.s3Ms ? (r.s3Ms / 1000).toFixed(3) : "—"}</td>
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

    // feed the LAP chart mode: one bar per completed lap of the player's own race
    if (me.lastLapMs && me.lastLapMs !== lastSeenLapMs) {
      lastSeenLapMs = me.lastLapMs;
      lapTimesHistory.push(me.lastLapMs);
      if (lapTimesHistory.length > 30) lapTimesHistory.shift();
      if (chartMode === "lap") drawChart();
    }
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

const TYRE_COMPOUND_NAME = {
  15: "C0",
  16: "C5",
  17: "C4",
  18: "C3",
  19: "C2",
  20: "C1",
  7: "INTER",
  8: "WET",
};
const FUEL_MIX_NAME = ["LEAN", "STANDARD", "RICH", "MAX"];

function setKv(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("on", "off", "warn");
  if (cls) el.classList.add(cls);
}

const throttleHistory = [];
const brakeHistory = [];
const speedHistory = [];
const rpmHistory = [];
const lapTimesHistory = []; // completed player lap times (ms), fed from the leaderboard event
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
    speedHistory.push(d.speed);
    if (speedHistory.length > MAX_POINTS) speedHistory.shift();
    if (chartMode === "speed") drawChart();
  }

  if (typeof d.throttle !== "undefined" || typeof d.brake !== "undefined") {
    throttleHistory.push(d.throttle ?? 0);
    brakeHistory.push(d.brake ?? 0);
    if (throttleHistory.length > MAX_POINTS) throttleHistory.shift();
    if (brakeHistory.length > MAX_POINTS) brakeHistory.shift();
    if (chartMode === "tb") drawChart();
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

    rpmHistory.push(d.rpm);
    if (rpmHistory.length > MAX_POINTS) rpmHistory.shift();
    if (chartMode === "rpm") drawChart();
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

  // brake temperatures (carTelemetry.m_brakesTemperature, order RL,RR,FL,FR)
  if (typeof d.brakeTemp !== "undefined" && d.brakeTemp) {
    const [rl, rr, fl, fr] = d.brakeTemp;
    document.getElementById("txtBFL").textContent =
      "FL " + Math.round(fl) + "°";
    document.getElementById("txtBFR").textContent =
      "FR " + Math.round(fr) + "°";
    document.getElementById("txtBRL").textContent =
      "RL " + Math.round(rl) + "°";
    document.getElementById("txtBRR").textContent =
      "RR " + Math.round(rr) + "°";
  }

  // tyre pressures (carTelemetry.m_tyresPressure, order RL,RR,FL,FR)
  if (typeof d.tyrePressure !== "undefined" && d.tyrePressure) {
    const [rl, rr, fl, fr] = d.tyrePressure;
    document.getElementById("txtPFL").textContent = "FL " + fl.toFixed(1);
    document.getElementById("txtPFR").textContent = "FR " + fr.toFixed(1);
    document.getElementById("txtPRL").textContent = "RL " + rl.toFixed(1);
    document.getElementById("txtPRR").textContent = "RR " + rr.toFixed(1);
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
  if (typeof d.ersHarvestMGUK !== "undefined") {
    setKv("ersHarvestK", (d.ersHarvestMGUK / 1000).toFixed(0) + " kJ");
  }
  if (typeof d.ersHarvestMGUH !== "undefined") {
    setKv("ersHarvestH", (d.ersHarvestMGUH / 1000).toFixed(0) + " kJ");
  }
  if (typeof d.fuel !== "undefined") {
    document.getElementById("fuelVal").textContent = d.fuel.toFixed(1) + " KG";
  }
  if (typeof d.fuelRemainingLaps !== "undefined") {
    const low = d.fuelRemainingLaps < 1;
    setKv(
      "fuelLapsVal",
      (d.fuelRemainingLaps >= 0 ? "+" : "") + d.fuelRemainingLaps.toFixed(2),
      low ? "warn" : null,
    );
  }
  if (typeof d.fuelMix !== "undefined") {
    setKv("fuelMixVal", FUEL_MIX_NAME[d.fuelMix] || "—");
  }
  if (typeof d.tyreCompound !== "undefined") {
    setKv("tyreCompoundVal", TYRE_COMPOUND_NAME[d.tyreCompound] || "—");
  }
  if (typeof d.tyreAge !== "undefined") {
    setKv("tyreAgeVal", d.tyreAge + " lap");
  }
  if (typeof d.brakeBias !== "undefined") {
    setKv("brakeBiasVal", d.brakeBias + "% / " + (100 - d.brakeBias) + "%");
  }
  if (typeof d.tractionControl !== "undefined") {
    setKv(
      "tcVal",
      d.tractionControl === 0
        ? "OFF"
        : d.tractionControl === 1
          ? "MEDIUM"
          : "FULL",
      d.tractionControl === 0 ? "off" : "on",
    );
  }
  if (typeof d.absEnabled !== "undefined") {
    setKv(
      "absVal",
      d.absEnabled ? "AKTIF" : "NONAKTIF",
      d.absEnabled ? "on" : "off",
    );
  }
  if (typeof d.pitLimiter !== "undefined") {
    setKv(
      "pitLimiterVal",
      d.pitLimiter ? "AKTIF" : "OFF",
      d.pitLimiter ? "warn" : "off",
    );
  }
  if (typeof d.delta !== "undefined") {
    const el = document.getElementById("deltaval");
    const val = parseFloat(d.delta) || 0;
    el.textContent = (val > 0 ? "+" : "") + val.toFixed(3);
    el.classList.remove("neg", "pos");
    el.classList.add(val < 0 ? "neg" : "pos");
  }

  // g-force mini gauge (motion.m_gForceLateral / m_gForceLongitudinal)
  if (
    typeof d.gForceLat !== "undefined" ||
    typeof d.gForceLon !== "undefined"
  ) {
    const lat = d.gForceLat ?? 0;
    const lon = d.gForceLon ?? 0;
    const MAXG = 5; // clamp range for the little gauge
    const nx = Math.max(-1, Math.min(1, lat / MAXG));
    const ny = Math.max(-1, Math.min(1, -lon / MAXG)); // braking (negative lon) shown as "up"
    const dot = document.getElementById("gforceDot");
    dot.style.left = 50 + nx * 45 + "%";
    dot.style.top = 50 + ny * 45 + "%";
    document.getElementById("gLatVal").textContent = Math.abs(lat).toFixed(1);
    document.getElementById("gLonVal").textContent = Math.abs(lon).toFixed(1);
  }
});

// ---- telemetry chart: throttle/brake, speed, RPM, or lap-time trend ----
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");
let chartMode = "tb";

document.querySelectorAll(".chartTab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".chartTab")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartMode = btn.dataset.mode;
    drawChart();
  });
});

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio;
  canvas.height = r.height * devicePixelRatio;
  drawChart();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function drawSeries(values, color, max) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * devicePixelRatio;
  const n = values.length;
  values.forEach((v, i) => {
    const x = (i / (n - 1 || 1)) * canvas.width;
    const y = canvas.height - (v / (max || 1)) * canvas.height * 0.92 - 3;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// lap-time trend: one bar per completed lap, taller = faster, purple = session best
function drawLapBars() {
  const valid = lapTimesHistory.filter((v) => v);
  if (!valid.length) return;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const barW = canvas.width / lapTimesHistory.length;
  lapTimesHistory.forEach((v, i) => {
    if (!v) return;
    const h = 0.12 + 0.86 * (1 - (v - min) / range); // faster lap -> taller bar
    const barH = h * canvas.height * 0.92;
    ctx.fillStyle = v === min ? "#b34dff" : "#3d7bfd";
    ctx.fillRect(
      i * barW + barW * 0.15,
      canvas.height - barH,
      barW * 0.7,
      barH,
    );
  });
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

  if (chartMode === "lap") {
    drawLapBars();
    return;
  }
  if (chartMode === "speed") {
    if (speedHistory.length < 2) return;
    drawSeries(speedHistory, "#00d4ff", Math.max(100, ...speedHistory));
    return;
  }
  if (chartMode === "rpm") {
    if (rpmHistory.length < 2) return;
    drawSeries(rpmHistory, "#ff2b4d", state.maxRpm);
    return;
  }
  // default: throttle / brake
  if (throttleHistory.length < 2) return;
  drawSeries(throttleHistory, "#17e88f", 1);
  drawSeries(brakeHistory, "#ff2b4d", 1);
}
