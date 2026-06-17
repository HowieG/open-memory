const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** Secure bridge: the renderer gets a tiny API, no Node access. */
contextBridge.exposeInMainWorld("api", {
  pickAndIngest: () => ipcRenderer.invoke("pick-and-ingest"),
  ingestPath: (zipPath) => ipcRenderer.invoke("ingest-path", zipPath),
  listConversations: () => ipcRenderer.invoke("list-conversations"),
  getConversation: (id) => ipcRenderer.invoke("get-conversation", id),
  // Electron removed File.path; this is the supported way to get a dropped file's path.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
