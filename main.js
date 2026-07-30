const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { Server } = require("socket.io");
const {
  F1TelemetryClient,
  constants,
} = require("@racehub-io/f1-telemetry-client");
const { PACKETS } = constants;
const ViGEmClient = require("vigemclient");

// F1 2020 team ID table (per the official 2020 UDP spec appendix).
// 0-9 are the 2020 grid; 10+ are classic/historic liveries (career mode, time trial, etc.)
// and 255 is "My Team". Colors are best-effort based on each team's real livery.
const TEAM_META = {
  0: { tag: "MER", color: "#00d2be" }, // Mercedes
  1: { tag: "FER", color: "#c00000" }, // Ferrari
  2: { tag: "RBR", color: "#1e41ff" }, // Red Bull Racing
  3: { tag: "WIL", color: "#00a0de" }, // Williams
  4: { tag: "RPT", color: "#f596c8" }, // Racing Point
  5: { tag: "REN", color: "#fff500" }, // Renault
  6: { tag: "ATR", color: "#469bff" }, // AlphaTauri
  7: { tag: "HAA", color: "#b6babd" }, // Haas
  8: { tag: "MCL", color: "#ff8700" }, // McLaren
  9: { tag: "ARC", color: "#900000" }, // Alfa Romeo
  10: { tag: "M88", color: "#e8a33d" }, // McLaren 1988
  11: { tag: "M91", color: "#e8a33d" }, // McLaren 1991
  12: { tag: "W92", color: "#00a0de" }, // Williams 1992
  13: { tag: "F95", color: "#c00000" }, // Ferrari 1995
  14: { tag: "W96", color: "#00a0de" }, // Williams 1996
  15: { tag: "M98", color: "#e8a33d" }, // McLaren 1998
  16: { tag: "F02", color: "#c00000" }, // Ferrari 2002
  17: { tag: "F04", color: "#c00000" }, // Ferrari 2004
  18: { tag: "R06", color: "#fff500" }, // Renault 2006
  19: { tag: "F07", color: "#c00000" }, // Ferrari 2007
  20: { tag: "M08", color: "#e8a33d" }, // McLaren 2008
  21: { tag: "R10", color: "#1e41ff" }, // Red Bull 2010
  31: { tag: "M90", color: "#e8a33d" }, // McLaren 1990
  38: { tag: "W03", color: "#00a0de" }, // Williams 2003
  39: { tag: "B09", color: "#8fbf3f" }, // Brawn 2009
  41: { tag: "GEN", color: "#5b6b80" }, // F1 Generic car
  42: { tag: "ART", color: "#5b6b80" }, // ART Grand Prix
  43: { tag: "CMP", color: "#5b6b80" }, // Campos Racing
  44: { tag: "CAR", color: "#5b6b80" }, // Carlin
  45: { tag: "SJC", color: "#5b6b80" }, // Sauber Junior by Charouz
  46: { tag: "DAM", color: "#5b6b80" }, // DAMS
  47: { tag: "UNI", color: "#5b6b80" }, // UNI-Virtuosi
  48: { tag: "MPM", color: "#5b6b80" }, // MP Motorsport
  49: { tag: "PRE", color: "#5b6b80" }, // PREMA Racing
  50: { tag: "TRI", color: "#5b6b80" }, // Trident
  51: { tag: "ARD", color: "#5b6b80" }, // BWT Arden
  53: { tag: "B94", color: "#8fbf3f" }, // Benetton 1994
  54: { tag: "B95", color: "#8fbf3f" }, // Benetton 1995
  55: { tag: "F00", color: "#c00000" }, // Ferrari 2000
  56: { tag: "J91", color: "#5b6b80" }, // Jordan 1991
  63: { tag: "F90", color: "#c00000" }, // Ferrari 1990
  64: { tag: "M10", color: "#e8a33d" }, // McLaren 2010
  65: { tag: "F10", color: "#c00000" }, // Ferrari 2010
  255: { tag: "MYT", color: "#8b9bb0" }, // My Team
};

// Marshal-zone flag codes as sent by the game
const FLAG_NAME = {
  "-1": "NONE",
  0: "NONE",
  1: "GREEN",
  2: "BLUE",
  3: "YELLOW",
  4: "RED",
};

let mainWindow = null;
let io = null;
let controller = null;
let phoneConnected = false;

// ---------------------------------------------------------------------------
// Session state, rebuilt continuously from UDP packets, pushed to renderer.
// ---------------------------------------------------------------------------
const session = {
  trackId: null,
  weather: null,
  trackTemp: null,
  airTemp: null,
  totalLaps: null,
  timeLeft: null,
  playerIndex: 0,
  drivers: {}, // idx -> { name, team, tag, color }
  leaderboard: [], // sorted array for display
  flags: [], // per marshal zone: { zone, flag }
  trackStatus: "CLEAR",
  penalties: [], // recent penalty events, newest first
  trackTrace: [], // [{x,z}] normalized outline points, built live
  carPositions: [], // [{idx, x, z, isPlayer}] latest world pos per car
  driverSectors: {}, // idx -> per-driver sector tracking state (see lapData handler)
  bestSectors: { 1: null, 2: null, 3: null }, // session-wide fastest sector times (ms)
};

let traceLapIndex = -1; // which car we're currently tracing (first seen crossing s/f cleanly)
let traceStarted = false;
let traceBounds = null; // {minX,maxX,minZ,maxZ} for normalization

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Judge one driver's sector reading against their own personal best and the
// session-wide best for that sector, returning { value, cls }. `cls` is one of
// "purple" (fastest in the whole session), "green" (a new personal best that
// isn't the overall fastest), "red" (not an improvement), or null (no reading
// yet). Sector readings are HELD by the game for the whole lap once set, so we
// only re-judge when the value actually changes — otherwise the same reading
// would get re-compared against the personal best it just set and flip to red.
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

// ---------------------------------------------------------------------------
// Server "Otak Ganda": socket.io + ViGEm, isolated in the Main Process so the
// renderer never competes for CPU cycles with the input/telemetry loop.
// ---------------------------------------------------------------------------
function startCoreServer() {
  io = new Server(3000, { cors: { origin: "*" }, perMessageDeflate: false });

  const client = new ViGEmClient();
  client.connect();
  controller = client.createX360Controller();
  controller.connect();
  send("vigem-status", { connected: true });

  let lastVib = { large: 0, small: 0 };
  controller.on("vibration", ({ large, small }) => {
    if (large !== lastVib.large || small !== lastVib.small) {
      io.volatile.emit("vibrationData", { large, small });
      lastVib = { large, small };
    }
  });

  io.on("connection", (socket) => {
    phoneConnected = true;
    send("phone-status", { connected: true });

    socket.on("ping-check", (clientTime) => {
      socket.emit("pong-check", clientTime);
    });

    let lastIn = {};
    socket.on("controllerInput", (data) => {
      if (data.A !== lastIn.A) {
        controller.button.A.setValue(data.A);
        lastIn.A = data.A;
      }
      if (data.B !== lastIn.B) {
        controller.button.B.setValue(data.B);
        lastIn.B = data.B;
      }
      if (data.X !== lastIn.X) {
        controller.button.X.setValue(data.X);
        lastIn.X = data.X;
      }
      if (data.Y !== lastIn.Y) {
        controller.button.Y.setValue(data.Y);
        lastIn.Y = data.Y;
      }
      if (data.LB !== lastIn.LB) {
        controller.button.LEFT_SHOULDER.setValue(data.LB);
        lastIn.LB = data.LB;
      }
      if (data.RB !== lastIn.RB) {
        controller.button.RIGHT_SHOULDER.setValue(data.RB);
        lastIn.RB = data.RB;
      }
      if (data.RT !== lastIn.RT) {
        controller.axis.rightTrigger.setValue(data.RT);
        lastIn.RT = data.RT;
      }
      if (data.LT !== lastIn.LT) {
        controller.axis.leftTrigger.setValue(data.LT);
        lastIn.LT = data.LT;
      }
      if (data.LX !== lastIn.LX) {
        controller.axis.leftX.setValue(data.LX);
        lastIn.LX = data.LX;
      }
    });

    socket.on("disconnect", () => {
      phoneConnected = false;
      send("phone-status", { connected: false });
    });
  });

  setInterval(() => {
    if (!phoneConnected) return;
    const start = Date.now();
    io.timeout(500).emit("latency-probe", () => {
      send("latency", { ms: Date.now() - start });
    });
  }, 1000);

  const f1 = new F1TelemetryClient({ port: 20777, bigintEnabled: false });

  let lastCarTelemetryTime = 0;
  let lastCarStatusTime = 0;
  let lastLapDataTime = 0;
  let lastMotionTime = 0;
  let lastSessionTime = 0;

  // ---- own-car telemetry (gear/speed/rpm/throttle/brake/tyres + brake temps/pressures) ----
  f1.on(PACKETS.carTelemetry, (data) => {
    const now = Date.now();
    if (now - lastCarTelemetryTime < 50) return;
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
      // extra: brake temps (°C) and tyre pressures (psi), same [RL,RR,FL,FR] order
      // as tyresSurfaceTemperature per the F1 2020 UDP spec.
      brakeTemp: p.m_brakesTemperature,
      tyrePressure: p.m_tyresPressure,
      throttle: p.m_throttle,
      brake: p.m_brake,
    };
    send("telemetry", payload);
  });

  f1.on(PACKETS.carStatus, (data) => {
    const now = Date.now();
    if (now - lastCarStatusTime < 500) return;
    lastCarStatusTime = now;
    const p = data.m_carStatusData[data.m_header.m_playerCarIndex];
    send("telemetry", {
      ersMode: p.m_ersDeployMode,
      ersEnergy: p.m_ersStoreEnergy,
      ersHarvestMGUK: p.m_ersHarvestedThisLapMGUK,
      ersHarvestMGUH: p.m_ersHarvestedThisLapMGUH,
      fuel: p.m_fuelInTank,
      // extra: race-strategy relevant fields already in CarStatus but previously unused
      fuelRemainingLaps: p.m_fuelRemainingLaps,
      fuelMix: p.m_fuelMix,
      brakeBias: p.m_frontBrakeBias,
      tractionControl: p.m_tractionControl,
      absEnabled: p.m_antiLockBrakes,
      pitLimiter: p.m_pitLimiterStatus,
      tyreCompound: p.m_visualTyreCompound,
      tyreAge: p.m_tyresAgeLaps,
    });

    // F1 2020-specific: per-car FIA flag shown to the player right now (own car),
    // distinct from the marshal-zone list which is track-wide. Useful as the
    // authoritative "am I personally being shown a flag" signal.
    const myFlag = FLAG_NAME[p.m_vehicleFiaFlags] ?? "NONE";
    send("flags", {
      zones: session.flags,
      trackStatus: session.trackStatus,
      ownCarFlag: myFlag,
    });
  });

  // ---- participants: names/teams for the whole grid ----
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

  // ---- lapData: full grid positions, sectors, pit status ----
  // NOTE: F1 2020's LapData struct does NOT include delta-to-leader / delta-to-car-in-front
  // fields (those were added in later games). Also m_lastLapTime / m_bestLapTime are FLOAT
  // SECONDS in 2020, not "...InMS" integers — only the sector times are already in ms.
  // We convert lap/best times to ms for consistent formatting, and derive gap/interval
  // ourselves from m_totalDistance (works while the field is green-flag racing at speed;
  // it's an approximation, not a true time delta, since 2020 doesn't broadcast one).
  //
  // Sector 3 isn't a native field either: LapData only exposes sector1/sector2 for the
  // CURRENT lap (held at their final value until the next lap resets them to 0). We snapshot
  // each driver's last-seen s1/s2 right before their lap number increments, then derive
  // sector3 = lastLapTime - s1 - s2 for the lap that just ended. This is an approximation
  // bound by our 200ms poll rate, same spirit as the gap/interval approximation above.
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

        // Lap just rolled over: the s1/s2 we were holding from the previous tick are
        // (most likely) the completed lap's final sector times, pre-reset.
        if (lapNum > ds.lastLapNum && ds.prevS1 && ds.prevS2 && lastLapMs) {
          ds.s3 = lastLapMs - ds.prevS1 - ds.prevS2;
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
          pitStatus: lap.m_pitStatus, // 0 none, 1 pitting, 2 in pit area
          inPit: lap.m_pitStatus === 1 || lap.m_pitStatus === 2,
          penalties: lap.m_penalties || 0,
          currentLapInvalid: lap.m_currentLapInvalid === 1,
          resultStatus: lap.m_resultStatus, // 0 invalid,1 inactive,2 active,3 finished,4 DSQ,5 not classified,6 retired
        };
      })
      .filter((r) => r.name);

    rows.sort((a, b) => (a.position || 999) - (b.position || 999));

    // Derive gap-to-leader / interval-to-car-ahead from total distance travelled.
    // This is a distance-based approximation (converted using each car's current speed
    // isn't available here without cross-referencing carTelemetry, so we fall back to a
    // simple "metres behind" figure) since 2020 has no native time-delta field.
    const leaderDistance = rows[0] ? rows[0].totalDistance : null;
    rows.forEach((r, i) => {
      r.gapM =
        leaderDistance != null && r.totalDistance != null
          ? leaderDistance - r.totalDistance
          : null;
      const ahead = rows[i - 1];
      r.intervalM =
        ahead && ahead.totalDistance != null && r.totalDistance != null
          ? ahead.totalDistance - r.totalDistance
          : null;
    });

    session.leaderboard = rows;
    send("leaderboard", rows);
  });

  // ---- session: track id, weather, marshal-zone flags, safety car ----
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

    const zones = (data.m_marshalZones || []).map((z, i) => ({
      zone: i,
      pos: z.m_zoneStart,
      flag: FLAG_NAME[z.m_zoneFlag] ?? "NONE",
    }));
    session.flags = zones;

    const scStatus = data.m_safetyCarStatus; // 0 none,1 full,2 virtual,3 formation
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

    // reset trace if track changed
    if (
      session._lastTrackId !== undefined &&
      session._lastTrackId !== session.trackId
    ) {
      session.trackTrace = [];
      traceStarted = false;
      traceBounds = null;
      session.driverSectors = {};
      session.bestSectors = { 1: null, 2: null, 3: null };
      send("track-trace", { points: [], complete: false });
    }
    session._lastTrackId = session.trackId;
  });

  // ---- events: flag changes / penalties ----
  // F1 2020's Penalty union fields: vehicleIdx, otherVehicleIdx, penaltyType,
  // infringementType, time, lapNum, placesGained (no "m_" in the union itself per the
  // forum spec, but the client library may still expose them with the m_ prefix like
  // every other packet — so we accept both spellings defensively).
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
    // F1 2020 has no dedicated "FLAG" event code — flag state changes come through the
    // Session packet's marshal zones / m_vehicleFiaFlags instead. SEND/RCWN still apply.
    if (code === "SEND" || code === "RCWN" || code === "CHQF") {
      send("flags", {
        zones: session.flags,
        trackStatus: session.trackStatus,
        event: code,
      });
    }
  });

  // ---- motion: world coordinates -> live track trace + car dots + own-car g-force ----
  f1.on(PACKETS.motion, (data) => {
    const now = Date.now();
    if (now - lastMotionTime < 66) return; // ~15Hz is plenty for a map
    lastMotionTime = now;

    const cars = data.m_carMotionData;
    const positions = cars.map((c, idx) => ({
      idx,
      x: c.m_worldPositionX,
      z: c.m_worldPositionZ,
      isPlayer: idx === session.playerIndex,
    }));
    session.carPositions = positions;

    // Own-car g-force readout, straight from the Motion packet.
    const myMotion = cars[session.playerIndex];
    if (myMotion) {
      send("telemetry", {
        gForceLat: myMotion.m_gForceLateral,
        gForceLon: myMotion.m_gForceLongitudinal,
        gForceVert: myMotion.m_gForceVertical,
      });
    }

    // Trace the player's own line as the track outline until we have a closed loop.
    const me = positions[session.playerIndex];
    if (me && (Math.abs(me.x) > 0.01 || Math.abs(me.z) > 0.01)) {
      if (!traceStarted) {
        traceStarted = true;
        session.trackTrace = [{ x: me.x, z: me.z }];
        traceBounds = { minX: me.x, maxX: me.x, minZ: me.z, maxZ: me.z };
      } else {
        const last = session.trackTrace[session.trackTrace.length - 1];
        const dist = Math.hypot(me.x - last.x, me.z - last.z);
        if (dist > 4) {
          // sample roughly every 4m
          session.trackTrace.push({ x: me.x, z: me.z });
          traceBounds.minX = Math.min(traceBounds.minX, me.x);
          traceBounds.maxX = Math.max(traceBounds.maxX, me.x);
          traceBounds.minZ = Math.min(traceBounds.minZ, me.z);
          traceBounds.maxZ = Math.max(traceBounds.maxZ, me.z);

          // closed loop once we're back near the start after a reasonable distance
          if (session.trackTrace.length > 50) {
            const start = session.trackTrace[0];
            const backNearStart =
              Math.hypot(me.x - start.x, me.z - start.z) < 15;
            if (backNearStart) {
              send("track-trace", {
                points: session.trackTrace,
                bounds: traceBounds,
                complete: true,
              });
              traceStarted = "done";
            }
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
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    send("network-info", { ip: getLocalIP(), port: 3000 });
  });
}

ipcMain.handle("adb-reverse", async () => {
  return new Promise((resolve) => {
    exec("adb reverse tcp:3000 tcp:3000", (err) => resolve({ ok: !err }));
  });
});

ipcMain.handle("adb-reverse-remove", async () => {
  return new Promise((resolve) => {
    exec("adb reverse --remove tcp:3000", () => resolve({ ok: true }));
  });
});

app.whenReady().then(() => {
  createWindow();
  startCoreServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
