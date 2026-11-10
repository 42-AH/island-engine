const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("workshop", {
  call: (method, args) => ipcRenderer.invoke("workshop", method, args),
});
