const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { readFile, writeFile } = require("node:fs/promises");
const {
  ingestZip,
  renderConversationsHtml,
  ConversationStore,
  memoryEligibility,
  memoryExtractionSource,
  rankProviders,
  PROVIDERS,
  extractMemories,
  consolidateFacts,
  classifyConversations,
  extractEmojiPortrait,
} = require("./core.cjs");

/**
 * Minimal Electron main process. The Node side runs the headless ingest core
 * (bundled into core.cjs) and persists conversations to a disk-backed store
 * (per-conversation files + index.json). The sidebar reads the index; a
 * conversation loads from disk on click (lazy). Files never leave the machine.
 */

// OM_STORE_DIR override lets the e2e use an isolated, deterministic store.
let store; // ConversationStore, created on app ready
let memoriesPath; // <storeDir>/memories.json — extracted facts
let extractAbort = null; // AbortController-like for cancel

const emptyMemories = () => ({ facts: [], followups: [], extractedAt: null, provider: null });

async function loadFacts() {
  try {
    return JSON.parse(await readFile(memoriesPath, "utf8"));
  } catch {
    return emptyMemories();
  }
}
async function saveFacts(doc) {
  await writeFile(memoriesPath, JSON.stringify(doc, null, 2), "utf8");
}
function sourceCounts() {
  const counts = {};
  for (const e of store.list()) counts[e.source] = (counts[e.source] || 0) + 1;
  return counts;
}

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
  win.loadFile("renderer-dist/index.html");
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

// newest-first for the sidebar (store.list() is oldest-first; .reverse() is safe — fresh array)
ipcMain.handle("list-conversations", () =>
  store.list().reverse().map((e) => ({ id: e.id, title: e.title || "(untitled)", source: e.source, sensitive: !!e.sensitive })),
);

ipcMain.handle("get-conversation", async (_event, id) => {
  const c = await store.get(id);
  if (!c) return { error: "conversation not found" };
  return { html: renderConversationsHtml([c], { source: c.source, header: false }) };
});

// Raw conversation data for the React/assistant-ui renderer.
ipcMain.handle("get-conversation-data", async (_event, id) => {
  const c = await store.get(id);
  if (!c) return { error: "conversation not found" };
  return { id: c.id, title: c.title, source: c.source, messages: c.messages };
});

// --- memory extraction ---

ipcMain.handle("memory-eligibility", () => memoryEligibility(store));
ipcMain.handle("list-providers", () => rankProviders(sourceCounts()));
ipcMain.handle("get-memories", () => loadFacts());

ipcMain.handle("extract-memories", async (event, { providerId, config, limit }) => {
  const provider = PROVIDERS[providerId];
  if (!provider) return { error: `unknown provider "${providerId}"` };
  extractAbort = { aborted: false };
  try {
    const cfg = { ...config, onRateLimit: (info) => event.sender.send("extract-rate-limit", info) };
    const result = await extractMemories(store, provider, cfg, {
      limit: typeof limit === "number" ? limit : undefined,
      concurrency: 5,
      signal: extractAbort,
      onProgress: (n) => event.sender.send("extract-progress", n),
    });
    // Tag conversations as sensitive/bucketed (Haiku for Claude) so the sidebar can
    // blur+lock them — and so memory categories have a reliable fallback. Best-effort.
    try {
      await classifyConversations(store, provider, cfg, { signal: extractAbort });
    } catch {
      /* classify is non-essential; ignore */
    }
    // Consolidate: merge near-duplicates, prune trivia, assign buckets. Falls back to
    // the raw facts on failure, so we never lose memories.
    let merged = result.facts;
    try {
      merged = await consolidateFacts(result.facts, provider, cfg, { signal: extractAbort });
    } catch {
      /* keep raw facts */
    }
    // Fallback category: inherit the source conversation's classified bucket.
    const convCat = {};
    for (const e of store.list()) if (e.category) convCat[e.id] = e.category;
    const facts = merged.map((f, i) => ({
      id: `f${i}`,
      text: f.text,
      from: f.from,
      category: f.category || convCat[f.from[0]] || undefined,
      sensitive: !!f.sensitive,
    }));
    const doc = {
      facts,
      followups: result.followups,
      extractedAt: new Date().toISOString(),
      provider: providerId,
      processed: result.conversationsProcessed,
    };
    await saveFacts(doc);
    return doc;
  } catch (err) {
    return { error: err.message };
  } finally {
    extractAbort = null;
  }
});

ipcMain.handle("cancel-extract", () => {
  if (extractAbort) extractAbort.aborted = true;
});

ipcMain.handle("edit-fact", async (_event, { id, text }) => {
  const doc = await loadFacts();
  const fact = doc.facts.find((f) => f.id === id);
  if (fact) fact.text = text;
  await saveFacts(doc);
  return doc;
});

ipcMain.handle("forget-fact", async (_event, id) => {
  const doc = await loadFacts();
  doc.facts = doc.facts.filter((f) => f.id !== id);
  await saveFacts(doc);
  return doc;
});

// --- settings: clear local data ---

ipcMain.handle("clear-conversations", async () => {
  await store.clear();
  return { ok: true };
});

ipcMain.handle("clear-memories", async () => {
  await saveFacts(emptyMemories());
  return { ok: true };
});

// --- emoji portrait (first-delight) ---
// Streams {keyword,emoji,sourceConvId,excerpt} signals to the renderer as each
// map-reduce chunk returns. BYO key arrives in `config` (same as extract-memories).
// `stub` provider needs no key — drives offline/e2e. Returns a summary when done.
let emojiAbort = null;

ipcMain.handle("start-emoji-portrait", async (event, { providerId, config, max } = {}) => {
  const provider = PROVIDERS[providerId];
  if (!provider) return { error: `unknown provider "${providerId}"` };
  emojiAbort = { aborted: false };
  try {
    const conversations = [];
    for await (const c of memoryExtractionSource(store)) conversations.push(c);
    let count = 0;
    for await (const sig of extractEmojiPortrait(conversations, {
      provider,
      config,
      max: typeof max === "number" ? max : undefined,
      signal: emojiAbort,
    })) {
      if (emojiAbort?.aborted) break;
      event.sender.send("emoji-signal", sig);
      count++;
    }
    return { count, conversations: conversations.length };
  } catch (err) {
    return { error: err.message };
  } finally {
    emojiAbort = null;
  }
});

ipcMain.handle("cancel-emoji-portrait", () => {
  if (emojiAbort) emojiAbort.aborted = true;
});

app.whenReady().then(async () => {
  const baseDir = process.env.OM_STORE_DIR || path.join(app.getPath("userData"), "store");
  memoriesPath = path.join(baseDir, "memories.json");
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
