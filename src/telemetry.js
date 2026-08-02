const {
  F1TelemetryClient,
  constants,
} = require("@racehub-io/f1-telemetry-client");
const { PACKETS } = constants;

const TEAM_META = {
  0: { tag: "MER", color: "#00d2be" },
  1: { tag: "FER", color: "#c00000" },
  2: { tag: "RBR", color: "#1e41ff" },
  3: { tag: "WIL", color: "#00a0de" },
  4: { tag: "RPT", color: "#f596c8" },
  5: { tag: "REN", color: "#fff500" },
  6: { tag: "ATR", color: "#469bff" },
  7: { tag: "HAA", color: "#b6babd" },
  8: { tag: "MCL", color: "#ff8700" },
  9: { tag: "ARC", color: "#900000" },
  10: { tag: "M88", color: "#e8a33d" },
  11: { tag: "M91", color: "#e8a33d" },
  12: { tag: "W92", color: "#00a0de" },
  13: { tag: "F95", color: "#c00000" },
  14: { tag: "W96", color: "#00a0de" },
  15: { tag: "M98", color: "#e8a33d" },
  16: { tag: "F02", color: "#c00000" },
  17: { tag: "F04", color: "#c00000" },
  18: { tag: "R06", color: "#fff500" },
  19: { tag: "F07", color: "#c00000" },
  20: { tag: "M08", color: "#e8a33d" },
  21: { tag: "R10", color: "#1e41ff" },
  31: { tag: "M90", color: "#e8a33d" },
  38: { tag: "W03", color: "#00a0de" },
  39: { tag: "B09", color: "#8fbf3f" },
  41: { tag: "GEN", color: "#5b6b80" },
  42: { tag: "ART", color: "#5b6b80" },
  43: { tag: "CMP", color: "#5b6b80" },
  44: { tag: "CAR", color: "#5b6b80" },
  45: { tag: "SJC", color: "#5b6b80" },
  46: { tag: "DAM", color: "#5b6b80" },
  47: { tag: "UNI", color: "#5b6b80" },
  48: { tag: "MPM", color: "#5b6b80" },
  49: { tag: "PRE", color: "#5b6b80" },
  50: { tag: "TRI", color: "#5b6b80" },
  51: { tag: "ARD", color: "#5b6b80" },
  53: { tag: "B94", color: "#8fbf3f" },
  54: { tag: "B95", color: "#8fbf3f" },
  55: { tag: "F00", color: "#c00000" },
  56: { tag: "J91", color: "#5b6b80" },
  63: { tag: "F90", color: "#c00000" },
  64: { tag: "M10", color: "#e8a33d" },
  65: { tag: "F10", color: "#c00000" },
  255: { tag: "MYT", color: "#8b9bb0" },
};

const FLAG_NAME = {
  "-1": "NONE",
  0: "NONE",
  1: "GREEN",
  2: "BLUE",
  3: "YELLOW",
  4: "RED",
};

let send = null;

const session = {
  trackId: null,
  weather: null,
  trackTemp: null,
  airTemp: null,
  totalLaps: null,
  timeLeft: null,
  playerIndex: 0,
  drivers: {},
  leaderboard: [],
  flags: [],
  trackStatus: "CLEAR",
  penalties: [],
  trackTrace: [],
  carPositions: [],
  driverSectors: {},
  bestSectors: { 1: null, 2: null, 3: null },
  currentLapSamples: [],
  lapStartTime: Date.now(),
  lapHistory: {},
};

const lastSpeedByIdx = {};
const MAX_LAP_HISTORY = 30;
const LAP_SAMPLE_INTERVAL_MS = 100;
let lastLapSampleTime = 0;
let lastKnownTelemetry = { speed: 0, rpm: 0, throttle: 0, brake: 0 };
let traceLapIndex = -1;
let traceStarted = false;
let traceBounds = null;

function classifySector(ds, sector, value) {
  if (!value) return ds.sectors[sector] || { value: null, cls: null };
  const stored = ds.sectors[sector];
  if (stored && stored.value === value) return stored;

  let cls;
  const prevPb = ds.pb[sector];
  if (prevPb == null || value < prevPb) {
    ds.pb[sector] = value;
    cls = "green";
  } else {
    cls = "red";
  }

  const prevGlobal = session.bestSectors[sector];
  if (prevGlobal == null || value < prevGlobal) {
    session.bestSectors[sector] = value;
  }
  if (session.bestSectors[sector] === value) cls = "purple";

  const result = { value, cls };
  ds.sectors[sector] = result;
  return result;
}

function completeLapRecording(completedLapNum, lapTimeMs, s1Ms, s2Ms) {
  const samples = session.currentLapSamples;
  session.currentLapSamples = [];
  session.lapStartTime = Date.now();

  if (!completedLapNum || samples.length < 2) return;

  const entry = { lapNum: completedLapNum, lapTimeMs, s1Ms, s2Ms, samples };
  session.lapHistory[completedLapNum] = entry;

  const keys = Object.keys(session.lapHistory)
    .map(Number)
    .sort((a, b) => a - b);
  while (keys.length > MAX_LAP_HISTORY) {
    delete session.lapHistory[keys.shift()];
  }

  send("lap-complete", entry);
}

function initTelemetry(sendCallback) {
  send = sendCallback;
  const f1 = new F1TelemetryClient({ port: 20777, bigintEnabled: false });

  let lastCarTelemetryTime = 0;
  let lastCarStatusTime = 0;
  let lastLapDataTime = 0;
  let lastMotionTime = 0;
  let lastSessionTime = 0;

  f1.on(PACKETS.carTelemetry, (data) => {
    const now = Date.now();
    data.m_carTelemetryData.forEach((p, idx) => {
      lastSpeedByIdx[idx] = p.m_speed;
    });
    if (now - lastCarTelemetryTime < 16) return;
    lastCarTelemetryTime = now;
    const idx = data.m_header.m_playerCarIndex;
    const p = data.m_carTelemetryData[idx];
    const payload = {
      speed: p.m_speed,
      gear: p.m_gear,
      rpm: p.m_engineRPM,
      maxRpm: p.m_engineRpmMax || p.m_engineRPMMax || 13000,
      drs: p.m_drs,
      tyreTemp: p.m_tyresSurfaceTemperature,
      brakeTemp: p.m_brakesTemperature,
      tyrePressure: p.m_tyresPressure,
      throttle: p.m_throttle,
      brake: p.m_brake,
    };
    send("telemetry", payload);

    lastKnownTelemetry = {
      speed: p.m_speed,
      rpm: p.m_engineRPM,
      throttle: p.m_throttle,
      brake: p.m_brake,
    };
    if (now - lastLapSampleTime >= LAP_SAMPLE_INTERVAL_MS) {
      lastLapSampleTime = now;
      session.currentLapSamples.push({
        t: now - session.lapStartTime,
        ...lastKnownTelemetry,
      });
    }
  });

  f1.on(PACKETS.carStatus, (data) => {
    const now = Date.now();
    if (now - lastCarStatusTime < 500) return;
    lastCarStatusTime = now;
    const p = data.m_carStatusData[data.m_header.m_playerCarIndex];
    send("telemetry-status", {
      ersMode: p.m_ersDeployMode,
      ersEnergy: p.m_ersStoreEnergy,
      ersHarvestMGUK: p.m_ersHarvestedThisLapMGUK,
      ersHarvestMGUH: p.m_ersHarvestedThisLapMGUH,
      fuel: p.m_fuelInTank,
      fuelRemainingLaps: p.m_fuelRemainingLaps,
      fuelMix: p.m_fuelMix,
      brakeBias: p.m_frontBrakeBias,
      tractionControl: p.m_tractionControl,
      absEnabled: p.m_antiLockBrakes,
      pitLimiter: p.m_pitLimiterStatus,
      tyreCompound: p.m_visualTyreCompound,
      tyreAge: p.m_tyresAgeLaps,
    });
    const myFlag = FLAG_NAME[p.m_vehicleFiaFlags] ?? "NONE";
    send("flags", {
      zones: session.flags,
      trackStatus: session.trackStatus,
      ownCarFlag: myFlag,
    });
  });

  f1.on(PACKETS.participants, (data) => {
    data.m_participants.forEach((p, idx) => {
      const meta = TEAM_META[p.m_teamId] || { tag: "—", color: "#5b6b80" };
      session.drivers[idx] = {
        name: (p.m_name || `DRIVER ${idx}`).toUpperCase(),
        teamId: p.m_teamId,
        tag: meta.tag,
        color: meta.color,
      };
    });
    session.playerIndex = data.m_header.m_playerCarIndex;
  });

  f1.on(PACKETS.lapData, (data) => {
    const now = Date.now();
    if (now - lastLapDataTime < 200) return;
    lastLapDataTime = now;

    const rows = data.m_lapData
      .map((lap, idx) => {
        const drv = session.drivers[idx] || {
          name: `DRIVER ${idx}`,
          tag: "—",
          color: "#5b6b80",
        };
        const s1 = lap.m_sector1TimeInMS || null;
        const s2 = lap.m_sector2TimeInMS || null;
        const lapNum = lap.m_currentLapNum;
        const lastLapMs = lap.m_lastLapTime
          ? Math.round(lap.m_lastLapTime * 1000)
          : null;

        let ds = session.driverSectors[idx];
        if (!ds) {
          ds = session.driverSectors[idx] = {
            lastLapNum: lapNum,
            prevS1: s1,
            prevS2: s2,
            s3: null,
            pb: { 1: null, 2: null, 3: null },
            sectors: { 1: null, 2: null, 3: null },
          };
        }

        if (lapNum > ds.lastLapNum && ds.prevS1 && ds.prevS2 && lastLapMs) {
          ds.s3 = lastLapMs - ds.prevS1 - ds.prevS2;
          if (idx === session.playerIndex)
            completeLapRecording(lapNum - 1, lastLapMs, ds.prevS1, ds.prevS2);
        }
        ds.lastLapNum = lapNum;
        if (s1) ds.prevS1 = s1;
        if (s2) ds.prevS2 = s2;

        const S1 = classifySector(ds, 1, s1);
        const S2 = classifySector(ds, 2, s2);
        const S3 = classifySector(ds, 3, ds.s3);

        return {
          idx,
          name: drv.name,
          tag: drv.tag,
          color: drv.color,
          isPlayer: idx === session.playerIndex,
          position: lap.m_carPosition,
          lastLapMs,
          bestLapMs: lap.m_bestLapTime
            ? Math.round(lap.m_bestLapTime * 1000)
            : null,
          s1Ms: S1.value,
          s1Cls: S1.cls,
          s2Ms: S2.value,
          s2Cls: S2.cls,
          s3Ms: S3.value,
          s3Cls: S3.cls,
          totalDistance: lap.m_totalDistance ?? null,
          lapNum,
          pitStatus: lap.m_pitStatus,
          inPit: lap.m_pitStatus === 1 || lap.m_pitStatus === 2,
          penalties: lap.m_penalties || 0,
          currentLapInvalid: lap.m_currentLapInvalid === 1,
          resultStatus: lap.m_resultStatus,
        };
      })
      .filter((r) => r.name);

    rows.sort((a, b) => (a.position || 999) - (b.position || 999));

    const leaderDistance = rows[0] ? rows[0].totalDistance : null;
    rows.forEach((r, i) => {
      const speedMps = (lastSpeedByIdx[r.idx] || 0) / 3.6;
      r.gapS =
        leaderDistance != null && r.totalDistance != null && speedMps > 1
          ? (leaderDistance - r.totalDistance) / speedMps
          : null;
      const ahead = rows[i - 1];
      r.intervalS =
        ahead &&
        ahead.totalDistance != null &&
        r.totalDistance != null &&
        speedMps > 1
          ? (ahead.totalDistance - r.totalDistance) / speedMps
          : null;
    });

    session.leaderboard = rows;
    send("leaderboard", rows);
    const me = rows.find((r) => r.isPlayer);
    if (me) send("my-status", me);
  });

  f1.on(PACKETS.session, (data) => {
    const now = Date.now();
    if (now - lastSessionTime < 500) return;
    lastSessionTime = now;

    session.trackId = data.m_trackId;
    session.weather = data.m_weather;
    session.trackTemp = data.m_trackTemperature;
    session.airTemp = data.m_airTemperature;
    session.totalLaps = data.m_totalLaps;
    session.timeLeft = data.m_sessionTimeLeft;

    session.flags = (data.m_marshalZones || []).map((z, i) => ({
      zone: i,
      pos: z.m_zoneStart,
      flag: FLAG_NAME[z.m_zoneFlag] ?? "NONE",
    }));

    const scStatus = data.m_safetyCarStatus;
    session.trackStatus =
      scStatus === 1
        ? "SAFETY CAR"
        : scStatus === 2
          ? "VIRTUAL SC"
          : scStatus === 3
            ? "FORMATION"
            : "CLEAR";

    send("session-info", {
      trackId: session.trackId,
      weather: session.weather,
      trackTemp: session.trackTemp,
      airTemp: session.airTemp,
      totalLaps: session.totalLaps,
      timeLeft: session.timeLeft,
      trackStatus: session.trackStatus,
    });
    send("flags", { zones: session.flags, trackStatus: session.trackStatus });

    if (
      session._lastTrackId !== undefined &&
      session._lastTrackId !== session.trackId
    ) {
      session.trackTrace = [];
      traceStarted = false;
      traceBounds = null;
      session.driverSectors = {};
      session.bestSectors = { 1: null, 2: null, 3: null };
      session.currentLapSamples = [];
      session.lapStartTime = Date.now();
      session.lapHistory = {};
      send("track-trace", { points: [], complete: false });
    }
    session._lastTrackId = session.trackId;
  });

  f1.on(PACKETS.event, (data) => {
    const code = (data.m_eventStringCode || "").toString().trim();
    if (code === "PENA" && data.m_eventDetails) {
      const d = data.m_eventDetails;
      const vehicleIdx = d.m_vehicleIdx ?? d.vehicleIdx;
      const drv = session.drivers[vehicleIdx] || {
        name: `DRIVER ${vehicleIdx}`,
      };
      const entry = {
        time: Date.now(),
        driver: drv.name,
        penaltyType: d.m_penaltyType ?? d.penaltyType,
        infringement: d.m_infringementType ?? d.infringementType,
        seconds: (d.m_time ?? d.time) || 0,
        lap: d.m_lapNum ?? d.lapNum,
        placesGained: d.m_placesGained ?? d.placesGained ?? 0,
      };
      session.penalties.unshift(entry);
      session.penalties = session.penalties.slice(0, 20);
      send("penalties", session.penalties);
    }
    if (code === "SEND" || code === "RCWN" || code === "CHQF") {
      send("flags", {
        zones: session.flags,
        trackStatus: session.trackStatus,
        event: code,
      });
    }
  });

  f1.on(PACKETS.motion, (data) => {
    const now = Date.now();
    if (now - lastMotionTime < 66) return;
    lastMotionTime = now;

    const cars = data.m_carMotionData;
    const positions = cars.map((c, idx) => ({
      idx,
      x: c.m_worldPositionX,
      z: c.m_worldPositionZ,
      isPlayer: idx === session.playerIndex,
    }));
    session.carPositions = positions;

    const myMotion = cars[session.playerIndex];
    if (myMotion) {
      send("telemetry", {
        gForceLat: myMotion.m_gForceLateral,
        gForceLon: myMotion.m_gForceLongitudinal,
        gForceVert: myMotion.m_gForceVertical,
      });
    }

    const me = positions[session.playerIndex];
    if (me && (Math.abs(me.x) > 0.01 || Math.abs(me.z) > 0.01)) {
      if (!traceStarted) {
        traceStarted = true;
        session.trackTrace = [{ x: me.x, z: me.z }];
        traceBounds = { minX: me.x, maxX: me.x, minZ: me.z, maxZ: me.z };
      } else {
        const last = session.trackTrace[session.trackTrace.length - 1];
        if (Math.hypot(me.x - last.x, me.z - last.z) > 4) {
          session.trackTrace.push({ x: me.x, z: me.z });
          traceBounds.minX = Math.min(traceBounds.minX, me.x);
          traceBounds.maxX = Math.max(traceBounds.maxX, me.x);
          traceBounds.minZ = Math.min(traceBounds.minZ, me.z);
          traceBounds.maxZ = Math.max(traceBounds.maxZ, me.z);
          if (
            session.trackTrace.length > 50 &&
            Math.hypot(
              me.x - session.trackTrace[0].x,
              me.z - session.trackTrace[0].z,
            ) < 15
          ) {
            send("track-trace", {
              points: session.trackTrace,
              bounds: traceBounds,
              complete: true,
            });
            traceStarted = "done";
          }
        }
      }
      if (traceStarted !== "done") {
        send("track-trace", {
          points: session.trackTrace,
          bounds: traceBounds,
          complete: false,
        });
      }
    }
    send("car-positions", { positions, bounds: traceBounds });
  });

  f1.start();
  return session.lapHistory; // Kasih referensi ke main.js buat dipake IPC
}

module.exports = initTelemetry;
