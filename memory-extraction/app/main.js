const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { ingestZip, renderConversationsHtml, ConversationStore } = require("./core.cjs");

/**
 * Minimal Electron main process. The Node side runs the headless ingest core
 * (bundled into core.cjs) and persists conversations to a disk-backed store
 * (per-conversation files + index.json). The sidebar reads the index; a
 * conversation loads from disk on click (lazy). Files never leave the machine.
 */

// OM_STORE_DIR override lets the e2e use an isolated, deterministic store.
let store; // ConversationStore, created on app ready

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    backgroundColor: "#EDEBE4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
}

function light(c) {
  return { id: c.id, title: c.title || "(untitled)", source: c.source };
}

async function ingestAndStore(zipPath) {
  const { source, conversations, failed } = await ingestZip(zipPath);
  await store.upsert(conversations);
  return { source, count: conversations.length, failed: failed.length, uploaded: conversations.map(light) };
}

ipcMain.handle("pick-and-ingest", async () => {
  const res = await dialog.showOpenDialog({
    title: "Choose an export .zip",
    filters: [{ name: "Export archive", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  try {
    return await ingestAndStore(res.filePaths[0]);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("ingest-path", async (_event, zipPath) => {
  try {
    return await ingestAndStore(zipPath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("list-conversations", () =>
  store.list().map((e) => ({ id: e.id, title: e.title || "(untitled)", source: e.source })),
);

ipcMain.handle("get-conversation", async (_event, id) => {
  const c = await store.get(id);
  if (!c) return { error: "conversation not found" };
  return { html: renderConversationsHtml([c], { source: c.source, header: false }) };
});

app.whenReady().then(async () => {
  const baseDir = process.env.OM_STORE_DIR || path.join(app.getPath("userData"), "store");
  store = new ConversationStore(baseDir);
  await store.init();

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
