const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { exec } = require("child_process");
const initServer = require("./src/server");
const initTelemetry = require("./src/telemetry");

let mainWindow = null;
let io = null;
let lapHistoryRef = {};
let phoneThrottleMs = 150;
let lastPhoneEmit = {};
let controller = null;

const PC_ONLY = new Set([
  "car-positions",
  "track-trace",
  "leaderboard",
  "lap-complete",
]);

const CHANNEL_THROTTLE_MS = {
  flags: 200,
  leaderboard: 200,
};
let lastChannelEmit = {};

// Fungsi filter IP yang udah fix
function getLocalIP() {
  const interfaces = require("os").networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes("wsl") ||
      lowerName.includes("virtual") ||
      lowerName.includes("vbox") ||
      lowerName.includes("vmware") ||
      lowerName.includes("vethernet")
    ) {
      continue;
    }
    for (const iface of interfaces[name]) {
      if ((iface.family === "IPv4" || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function send(channel, payload) {
  const minInterval = CHANNEL_THROTTLE_MS[channel];
  if (minInterval) {
    const now = Date.now();
    if (
      lastChannelEmit[channel] &&
      now - lastChannelEmit[channel] < minInterval
    ) {
      return;
    }
    lastChannelEmit[channel] = now;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }

  if (io && !PC_ONLY.has(channel)) {
    const now = Date.now();
    if (channel === "my-status") {
      io.volatile.emit("my-status", payload);
      return;
    }

    if (
      channel === "flags" ||
      channel === "penalties" ||
      channel === "session-info"
    ) {
      io.emit(channel, payload);
      return;
    }

    // Throttling untuk data yang update tiap frame (telemetry, posisi)
    if (
      !lastPhoneEmit[channel] ||
      now - lastPhoneEmit[channel] >= phoneThrottleMs
    ) {
      let phonePayload = payload;
      if (channel === "telemetry") {
        phonePayload = {
          speed: payload.speed,
          gear: payload.gear,
          rpm: payload.rpm,
          drs: payload.drs,
          tyreTemp: payload.tyreTemp,
        };
      }
      io.volatile.emit(channel, phonePayload);
      lastPhoneEmit[channel] = now;
    }
  }
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
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    send("network-info", { ip: getLocalIP(), port: 3000 });
    if (controller) {
      send("vigem-status", { connected: true });
    }
  });
}

// IPC Handlers
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

ipcMain.handle("set-phone-throttle", async (_event, ms) => {
  const val = Number(ms);
  if (!Number.isFinite(val) || val < 16)
    return { ok: false, ms: phoneThrottleMs };
  phoneThrottleMs = Math.round(val);
  return { ok: true, ms: phoneThrottleMs };
});

ipcMain.handle("get-phone-throttle", async () => phoneThrottleMs);

ipcMain.handle("get-lap-history", async () => {
  return Object.values(lapHistoryRef).sort((a, b) => a.lapNum - b.lapNum);
});

// Start app
app.whenReady().then(() => {
  createWindow();
  const serverState = initServer(send);
  io = serverState.io;
  controller = serverState.controller;
  lapHistoryRef = initTelemetry(send);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
