const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { ingestZip, renderConversationsHtml } = require("./core.cjs");

/**
 * Minimal Electron main process. The Node side runs the headless ingest core
 * (bundled into core.cjs); the renderer is just UI. Files never leave the machine.
 */

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 840,
    backgroundColor: "#EDEBE4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
}

async function ingestAndRender(zipPath) {
  const { source, conversations, failed } = await ingestZip(zipPath);
  const html = renderConversationsHtml(conversations, { source, failed: failed.length });
  return { source, count: conversations.length, failed: failed.length, html, path: zipPath };
}

ipcMain.handle("pick-and-ingest", async () => {
  const res = await dialog.showOpenDialog({
    title: "Choose an export .zip",
    filters: [{ name: "Export archive", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  try {
    return await ingestAndRender(res.filePaths[0]);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("ingest-path", async (_event, zipPath) => {
  try {
    return await ingestAndRender(zipPath);
  } catch (err) {
    return { error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
