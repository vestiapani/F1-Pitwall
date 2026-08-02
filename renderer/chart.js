const chartCompare = document.getElementById("chartCompare");
const ctxCompare = chartCompare.getContext("2d");
const compareMetric = document.getElementById("compareMetric");
compareMetric.addEventListener("change", drawCompare);

function drawCompareSeries(
  ctx,
  canvas,
  samples,
  color,
  gutter,
  maxVal,
  prop,
  isDashed = false,
) {
  if (!samples || samples.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * devicePixelRatio;

  if (isDashed) ctx.setLineDash([4, 4]);
  else ctx.setLineDash([]);

  const plotW = canvas.width - gutter;
  const padY = 3 * devicePixelRatio;
  const plotH = canvas.height - padY * 2;
  const n = samples.length - 1;

  samples.forEach((s, i) => {
    const x = gutter + (i / n) * plotW;
    const y = padY + plotH - (s[prop] / (maxVal || 1)) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCompare() {
  const r = chartCompare.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    chartCompare.width = r.width * devicePixelRatio;
    chartCompare.height = r.height * devicePixelRatio;
  }

  const a = lapHistoryMap[Number(compareLapA.value)];
  const b = lapHistoryMap[Number(compareLapB.value)];
  const metric = compareMetric.value || "speed";

  ctxCompare.clearRect(0, 0, chartCompare.width, chartCompare.height);

  let gutter = 0;

  if (metric === "speed") {
    const maxSpeed = Math.max(
      a ? Math.max(...a.samples.map((s) => s.speed)) : 0,
      b ? Math.max(...b.samples.map((s) => s.speed)) : 0,
      100,
    );
    const ticks = [0, 1, 2, 3, 4].map((i) =>
      String(Math.round((maxSpeed * (4 - i)) / 4)),
    );
    gutter = drawAxisGrid(ctxCompare, chartCompare, ticks);

    drawCompareSeries(
      ctxCompare,
      chartCompare,
      a?.samples,
      "#ffee00",
      gutter,
      maxSpeed,
      "speed",
    );
    drawCompareSeries(
      ctxCompare,
      chartCompare,
      b?.samples,
      "#b34dff",
      gutter,
      maxSpeed,
      "speed",
    );
  } else if (metric === "rpm") {
    const maxRpm = state.maxRpm || 13000;
    const ticks = [0, 1, 2, 3, 4].map((i) =>
      String(Math.round((maxRpm * (4 - i)) / 4 / 100) * 100),
    );
    gutter = drawAxisGrid(ctxCompare, chartCompare, ticks);

    drawCompareSeries(
      ctxCompare,
      chartCompare,
      a?.samples,
      "#ffee00",
      gutter,
      maxRpm,
      "rpm",
    );
    drawCompareSeries(
      ctxCompare,
      chartCompare,
      b?.samples,
      "#b34dff",
      gutter,
      maxRpm,
      "rpm",
    );
  } else if (metric === "tb") {
    const ticks = ["100%", "75%", "50%", "25%", "0%"];
    gutter = drawAxisGrid(ctxCompare, chartCompare, ticks);

    drawCompareSeries(
      ctxCompare,
      chartCompare,
      a?.samples,
      "#ffee00",
      gutter,
      1,
      "throttle",
      false,
    );
    drawCompareSeries(
      ctxCompare,
      chartCompare,
      a?.samples,
      "#ffee00",
      gutter,
      1,
      "brake",
      true,
    );
    drawCompareSeries(
      ctxCompare,
      chartCompare,
      b?.samples,
      "#b34dff",
      gutter,
      1,
      "throttle",
      false,
    );
    drawCompareSeries(
      ctxCompare,
      chartCompare,
      b?.samples,
      "#b34dff",
      gutter,
      1,
      "brake",
      true,
    );
  }

  // --- GAMBAR GARIS SEKTOR VERTICAL (S1 & S2) ---
  const refLap = a || b;
  if (refLap && refLap.s1Ms && refLap.s2Ms) {
    const plotW = chartCompare.width - gutter;
    const xS1 = gutter + (refLap.s1Ms / refLap.lapTimeMs) * plotW;
    const xS2 =
      gutter + ((refLap.s1Ms + refLap.s2Ms) / refLap.lapTimeMs) * plotW;

    ctxCompare.beginPath();
    ctxCompare.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctxCompare.lineWidth = 1 * devicePixelRatio;
    ctxCompare.setLineDash([4, 4]);
    ctxCompare.moveTo(xS1, 0);
    ctxCompare.lineTo(xS1, chartCompare.height);
    ctxCompare.moveTo(xS2, 0);
    ctxCompare.lineTo(xS2, chartCompare.height);
    ctxCompare.stroke();
    ctxCompare.setLineDash([]);
    ctxCompare.font = `${10 * devicePixelRatio}px "SFMono-Regular","Consolas",monospace`;
    ctxCompare.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctxCompare.fillText("S1", xS1 + 4, 15 * devicePixelRatio);
    ctxCompare.fillText("S2", xS2 + 4, 15 * devicePixelRatio);
  }
}

// ---------------------------------------------------------------------------
// ---- telemetry charts: 4 always-visible small multiples + lap trend + compare ----
// Gas/Rem, Speed, RPM and Lap-time trend each get their own canvas + a live
// numeric readout in the header (see #chartsGrid in index.html), so nothing
// needs tab-switching and every trace is legible at a glance. The lap-trend
// chart scrolls horizontally as more laps come in (see #lapScrollWrap), and
// the compare panel overlays any two recorded laps' speed traces.
// ---------------------------------------------------------------------------
const chartTB = document.getElementById("chartTB");
const ctxTB = chartTB.getContext("2d");
const chartSpeed = document.getElementById("chartSpeed");
const ctxSpeed = chartSpeed.getContext("2d");
const chartRpm = document.getElementById("chartRpm");
const ctxRpm = chartRpm.getContext("2d");
const chartLap = document.getElementById("chartLap");
const ctxLap = chartLap.getContext("2d");
const lapScrollWrap = document.getElementById("lapScrollWrap");
const ALL_CHARTS = [
  { canvas: chartTB, ctx: ctxTB, draw: () => drawTB() },
  { canvas: chartSpeed, ctx: ctxSpeed, draw: () => drawSpeed() },
  { canvas: chartRpm, ctx: ctxRpm, draw: () => drawRpm() },
  { canvas: chartLap, ctx: ctxLap, draw: () => drawLap(), ownWidth: true },
  { canvas: chartCompare, ctx: ctxCompare, draw: () => drawCompare() },
];
