const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require("electron");
const path = require("node:path");
const crypto = require("node:crypto");
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
  heuristicTag,
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
let portraitPath; // <storeDir>/emoji-portrait.json — cached emoji signals
let extractAbort = null; // AbortController-like for cancel

// Hash of the current conversation set — the emoji-portrait cache key. Changes
// when conversations are added/removed, so a new import re-draws automatically.
function convSetHash() {
  const ids = store.list().map((e) => e.id).sort();
  return crypto.createHash("sha1").update(ids.join(",")).digest("hex");
}
async function loadPortrait() {
  try {
    return JSON.parse(await readFile(portraitPath, "utf8"));
  } catch {
    return null;
  }
}

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
    // Category + date come from a fallback chain so nothing reads "Other":
    // model fact category -> source conversation's classified bucket -> keyword
    // heuristic (which always yields a bucket). Date = newest source conversation.
    const convMeta = {};
    for (const e of store.list()) convMeta[e.id] = { category: e.category, created_at: e.created_at };
    const facts = merged.map((f, i) => {
      const from = f.from || [];
      const heur = heuristicTag(f.text);
      const srcCat = from.map((id) => convMeta[id]?.category).find(Boolean);
      const dates = from.map((id) => convMeta[id]?.created_at).filter((n) => typeof n === "number");
      return {
        id: `f${i}`,
        text: f.text,
        from,
        category: f.category || srcCat || heur.category,
        sensitive: !!f.sensitive || heur.sensitive,
        date: dates.length ? Math.max(...dates) * 1000 : undefined,
      };
    });
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

ipcMain.handle("start-emoji-portrait", async (event, { providerId, config, max, force } = {}) => {
  const provider = PROVIDERS[providerId];
  if (!provider) return { error: `unknown provider "${providerId}"` };
  const hash = convSetHash();

  // Cache hit: replay the stored signals (no re-run, no re-pay) unless redrawing.
  if (!force) {
    const cached = await loadPortrait();
    if (cached && cached.hash === hash && Array.isArray(cached.signals) && cached.signals.length) {
      event.sender.send("emoji-final", cached.signals); // instant render from cache
      return { count: cached.signals.length, conversations: cached.conversations ?? 0, cached: true };
    }
  }

  emojiAbort = { aborted: false };
  try {
    const conversations = [];
    for await (const c of memoryExtractionSource(store)) conversations.push(c);
    // Per-conversation parallel extraction → frequency-ranked signals. Progress
    // streams during the (minutes-long) run; the ranked set arrives at the end.
    const signals = await extractEmojiPortrait(conversations, {
      provider,
      config,
      max: typeof max === "number" ? max : undefined,
      signal: emojiAbort,
      onProgress: (processed, total) => event.sender.send("emoji-progress", { processed, total }),
      onCandidate: (sig) => event.sender.send("emoji-signal", sig), // live fill while processing
    });
    if (!emojiAbort.aborted) event.sender.send("emoji-final", signals); // settle to the ranked set
    // Cache only a complete, non-cancelled run keyed on this conversation set.
    if (!emojiAbort.aborted && signals.length) {
      await writeFile(
        portraitPath,
        JSON.stringify({ hash, signals, conversations: conversations.length, provider: providerId, drawnAt: new Date().toISOString() }, null, 2),
        "utf8",
      );
    }
    return { count: signals.length, conversations: conversations.length, cached: false };
  } catch (err) {
    return { error: err.message };
  } finally {
    emojiAbort = null;
  }
});

ipcMain.handle("cancel-emoji-portrait", () => {
  if (emojiAbort) emojiAbort.aborted = true;
});

// Capture the portrait card region as a real screenshot (native emoji render
// exactly as the user sees them), copy it to the clipboard, and open the X
// composer with pre-filled text. Intent URLs can't attach an image, so the flow
// is "image copied -> paste into your post". OM_NO_EXTERNAL skips the browser
// open (e2e). Returns { ok } or { error }.
ipcMain.handle("share-portrait", async (event, { rect, text } = {}) => {
  try {
    const dip = rect && {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const image = await event.sender.capturePage(dip);
    if (image.isEmpty()) return { error: "capture was empty" };
    clipboard.writeImage(image);
    if (text && !process.env.OM_NO_EXTERNAL) {
      await shell.openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

app.whenReady().then(async () => {
  const baseDir = process.env.OM_STORE_DIR || path.join(app.getPath("userData"), "store");
  memoriesPath = path.join(baseDir, "memories.json");
  portraitPath = path.join(baseDir, "emoji-portrait.json");
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
