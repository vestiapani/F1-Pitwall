const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { Server } = require("socket.io");
const { F1TelemetryClient } = require("@racehub-io/f1-telemetry-client");
const ViGEmClient = require("vigemclient");

let mainWindow = null;
let io = null;
let controller = null;
let phoneConnected = false;
let lastPingAt = 0;
let lastPingMs = null;

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
      if (data.A !== lastIn.A) { controller.button.A.setValue(data.A); lastIn.A = data.A; }
      if (data.B !== lastIn.B) { controller.button.B.setValue(data.B); lastIn.B = data.B; }
      if (data.X !== lastIn.X) { controller.button.X.setValue(data.X); lastIn.X = data.X; }
      if (data.Y !== lastIn.Y) { controller.button.Y.setValue(data.Y); lastIn.Y = data.Y; }
      if (data.LB !== lastIn.LB) { controller.button.LEFT_SHOULDER.setValue(data.LB); lastIn.LB = data.LB; }
      if (data.RB !== lastIn.RB) { controller.button.RIGHT_SHOULDER.setValue(data.RB); lastIn.RB = data.RB; }
      if (data.RT !== lastIn.RT) { controller.axis.rightTrigger.setValue(data.RT); lastIn.RT = data.RT; }
      if (data.LT !== lastIn.LT) { controller.axis.leftTrigger.setValue(data.LT); lastIn.LT = data.LT; }
      if (data.LX !== lastIn.LX) { controller.axis.leftX.setValue(data.LX); lastIn.LX = data.LX; }
    });

    socket.on("disconnect", () => {
      phoneConnected = false;
      send("phone-status", { connected: false });
    });
  });

  // Lightweight latency sampling, cheap enough not to touch the input loop.
  setInterval(() => {
    if (!phoneConnected) return;
    const start = Date.now();
    io.timeout(500).emit("latency-probe", () => {
      lastPingMs = Date.now() - start;
      send("latency", { ms: lastPingMs });
    });
  }, 1000);

  const f1TelemetryClient = new F1TelemetryClient({ port: 20777, bigintEnabled: false });

  let lastCarTelemetryTime = 0;
  let lastCarStatusTime = 0;
  let lastLapDataTime = 0;

  f1TelemetryClient.on("carTelemetry", (data) => {
    const now = Date.now();
    if (now - lastCarTelemetryTime < 50) return;
    lastCarTelemetryTime = now;
    const p = data.m_carTelemetryData[data.m_header.m_playerCarIndex];
    const payload = {
      speed: p.m_speed,
      gear: p.m_gear,
      rpm: p.m_engineRPM,
      maxRpm: p.m_engineRpmMax || p.m_engineRPMMax || 13000,
      drs: p.m_drs,
      tyreTemp: p.m_tyresSurfaceTemperature,
    };
    io.volatile.emit("f1Data", payload);
    send("telemetry", payload);
  });

  f1TelemetryClient.on("carStatus", (data) => {
    const now = Date.now();
    if (now - lastCarStatusTime < 500) return;
    lastCarStatusTime = now;
    const p = data.m_carStatusData[data.m_header.m_playerCarIndex];
    const payload = { ersMode: p.m_ersDeployMode, ersEnergy: p.m_ersStoreEnergy, fuel: p.m_fuelInTank };
    io.volatile.emit("f1Data", payload);
    send("telemetry", payload);
  });

  f1TelemetryClient.on("lapData", (data) => {
    const now = Date.now();
    if (now - lastLapDataTime < 100) return;
    lastLapDataTime = now;
    const p = data.m_lapData[data.m_header.m_playerCarIndex];
    let rawDelta =
      p.m_deltaToSessionBestLapInMS || p.m_deltaToPersonalBestLapInMS ||
      p.m_deltaToSessionBestLap || p.m_deltaToPersonalBestLap ||
      p.m_deltaToCarInFrontInMS || p.m_deltaToRaceLeaderInMS || 0;
    const delta = rawDelta > 100 || rawDelta < -100 ? rawDelta / 1000 : rawDelta;
    io.volatile.emit("f1Data", { delta });
    send("telemetry", { delta });
  });

  f1TelemetryClient.start();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0a0c10",
    autoHideMenuBar: true,
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
