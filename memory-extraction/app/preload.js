const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** Secure bridge: the renderer gets a tiny API, no Node access. */
contextBridge.exposeInMainWorld("api", {
  pickAndIngest: () => ipcRenderer.invoke("pick-and-ingest"),
  ingestPath: (zipPath) => ipcRenderer.invoke("ingest-path", zipPath),
  listConversations: () => ipcRenderer.invoke("list-conversations"),
  getConversation: (id) => ipcRenderer.invoke("get-conversation", id),
  getConversationData: (id) => ipcRenderer.invoke("get-conversation-data", id),
  // Electron removed File.path; this is the supported way to get a dropped file's path.
  pathForFile: (file) => webUtils.getPathForFile(file),

  // memory extraction
  memoryEligibility: () => ipcRenderer.invoke("memory-eligibility"),
  listProviders: () => ipcRenderer.invoke("list-providers"),
  getMemories: () => ipcRenderer.invoke("get-memories"),
  extractMemories: (providerId, config, limit) => ipcRenderer.invoke("extract-memories", { providerId, config, limit }),
  cancelExtract: () => ipcRenderer.invoke("cancel-extract"),
  onExtractProgress: (cb) => {
    const handler = (_event, n) => cb(n);
    ipcRenderer.on("extract-progress", handler);
    return () => ipcRenderer.removeListener("extract-progress", handler);
  },
  editFact: (id, text) => ipcRenderer.invoke("edit-fact", { id, text }),
  forgetFact: (id) => ipcRenderer.invoke("forget-fact", id),

  // emoji portrait (first-delight) — streaming
  startEmojiPortrait: (providerId, config, max, force) =>
    ipcRenderer.invoke("start-emoji-portrait", { providerId, config, max, force }),
  cancelEmojiPortrait: () => ipcRenderer.invoke("cancel-emoji-portrait"),
  onEmojiSignal: (cb) => {
    const handler = (_event, sig) => cb(sig);
    ipcRenderer.on("emoji-signal", handler);
    return () => ipcRenderer.removeListener("emoji-signal", handler);
  },
  sharePortrait: (rect, text) => ipcRenderer.invoke("share-portrait", { rect, text }),
});
