const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = [
  "network-info",
  "phone-status",
  "vigem-status",
  "telemetry",
  "latency",
  "leaderboard",
  "session-info",
  "flags",
  "penalties",
  "track-trace",
  "car-positions",
  "telemetry-status",
  "lap-complete",
];

contextBridge.exposeInMainWorld("pitwall", {
  on: (channel, callback) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
  adbReverse: () => ipcRenderer.invoke("adb-reverse"),
  adbReverseRemove: () => ipcRenderer.invoke("adb-reverse-remove"),

  // Runtime control of how often high-frequency channels reach the phone.
  setPhoneThrottle: (ms) => ipcRenderer.invoke("set-phone-throttle", ms),
  getPhoneThrottle: () => ipcRenderer.invoke("get-phone-throttle"),

  // Per-lap telemetry history, for the "Bandingkan Lap" compare chart.
  getLapHistory: () => ipcRenderer.invoke("get-lap-history"),
});
