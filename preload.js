const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = ["network-info", "phone-status", "vigem-status", "telemetry", "latency"];

contextBridge.exposeInMainWorld("pitwall", {
  on: (channel, callback) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
  adbReverse: () => ipcRenderer.invoke("adb-reverse"),
  adbReverseRemove: () => ipcRenderer.invoke("adb-reverse-remove"),
});
