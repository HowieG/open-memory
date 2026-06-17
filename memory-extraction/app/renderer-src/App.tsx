import { useEffect, useRef, useState } from "react";
import { ConversationView } from "./ConversationView";
import { MemoriesView } from "./MemoriesView";
import { PortraitView } from "./PortraitView";
import type { ConvData, ConvMeta, Eligibility, MemoriesDoc, ProviderInfo, RateLimitInfo, UploadResult } from "./env";

// Real brand logos dropped into ./logos/ (openai|claude|gemini . svg|png) render
// instead of the inline approximations below. Missing ones fall back gracefully.
const PROVIDED = import.meta.glob("./logos/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const BRAND: Record<string, string> = { chatgpt: "openai", claude: "claude", gemini: "gemini" };
function providedLogo(source: string): string | undefined {
  const brand = BRAND[source];
  if (!brand) return undefined;
  const hit = Object.entries(PROVIDED).find(([p]) => p.split("/").pop()!.replace(/\.(svg|png)$/i, "") === brand);
  return hit?.[1];
}

function Logo({ source, size = 16 }: { source: string; size?: number }) {
  const provided = providedLogo(source);
  if (provided) return <img className="om-logo-img" src={provided} alt={source} width={size} height={size} style={{ width: size, height: size }} />;
  if (source === "chatgpt") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="#000" aria-label="OpenAI">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.062l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.376-3.454l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z" />
      </svg>
    );
  }
  if (source === "claude") {
    const rays: Array<[number, number, number, number]> = [
      [16, 12, 21, 12], [14.83, 14.83, 18.36, 18.36], [12, 16, 12, 21], [9.17, 14.83, 5.64, 18.36],
      [8, 12, 3, 12], [9.17, 9.17, 5.64, 5.64], [12, 8, 12, 3], [14.83, 9.17, 18.36, 5.64],
    ];
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-label="Claude">
        <g stroke="#D97757" strokeWidth="2.2" strokeLinecap="round">
          {rays.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        </g>
      </svg>
    );
  }
  return <span className="om-dot">•</span>;
}

type View = "memories" | "conversations" | "import" | "portrait" | "settings";

export function App() {
  const api = window.api;
  const [view, setView] = useState<View>("import");
  const [conversations, setConversations] = useState<ConvMeta[]>([]);
  const [selected, setSelected] = useState<ConvData | null>(null);
  const [memories, setMemories] = useState<MemoriesDoc | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState<RateLimitInfo | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<UploadResult | null>(null);
  const [status, setStatus] = useState("");
  const [hot, setHot] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const didInit = useRef(false);

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function refresh() {
    const [convs, mem, elig, provs] = await Promise.all([
      api.listConversations(),
      api.getMemories(),
      api.memoryEligibility(),
      api.listProviders(),
    ]);
    setConversations(convs);
    setMemories(mem);
    setEligibility(elig);
    setProviders(provs);
    return convs;
  }

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    refresh().then((convs) => {
      if (convs.length > 0) setView("memories");
    });
  }, []);

  // ---- import ----
  function handleIngest(r: Awaited<ReturnType<typeof api.pickAndIngest>>) {
    if ("canceled" in r) return setStatus("");
    if ("error" in r) return setStatus("Error: " + r.error);
    setStatus("");
    setImportResult(r);
    refresh();
  }
  async function doPick() {
    setStatus("Reading…");
    handleIngest(await api.pickAndIngest());
  }
  async function doDrop(e: React.DragEvent) {
    e.preventDefault();
    setHot(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setStatus("Reading…");
    handleIngest(await api.ingestPath(api.pathForFile(file)));
  }

  // ---- conversations ----
  async function selectConv(id: string) {
    const c = await api.getConversationData(id);
    if (!("error" in c)) {
      setSelected(c);
      setView("conversations");
    }
  }

  // ---- memories ----
  async function runExtract(providerId: string, config: { apiKey?: string; endpoint?: string }, limit?: number) {
    setExtracting(true);
    setProgress(0);
    setExtractError(null);
    setRateLimited(null);
    setPhase(null);
    const unsubP = api.onExtractProgress((n) => {
      setProgress(n);
      setRateLimited(null); // a completed conversation means we're moving again
    });
    const unsubR = api.onExtractRateLimit(setRateLimited);
    const unsubF = api.onExtractPhase(setPhase);
    const doc = await api.extractMemories(providerId, config, limit);
    unsubP();
    unsubR();
    unsubF();
    setRateLimited(null);
    setPhase(null);
    setExtracting(false);
    if (doc.error) setExtractError(doc.error);
    else {
      setMemories(doc);
      // the post-extract classify pass may have tagged conversations as sensitive
      setConversations(await api.listConversations());
    }
  }

  // ---- settings ----
  async function clearConversations() {
    if (!window.confirm("Clear all imported conversations? This can't be undone.")) return;
    await api.clearConversations();
    setSelected(null);
    setImportResult(null);
    setRevealed(new Set());
    await refresh();
  }
  async function clearMemories() {
    if (!window.confirm("Forget all extracted memories? This can't be undone.")) return;
    await api.clearMemories();
    setMemories(await api.getMemories());
  }

  const navBtn = (v: View, label: string) => (
    <button className={"nav-item" + (view === v ? " active" : "")} data-testid={`nav-${v}`} onClick={() => setView(v)}>
      {label}
    </button>
  );

  return (
    <div className="om-app">
      <header>
        <h1>open-memory</h1>
        <span className="sub">everything stays on your machine</span>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav className="nav">
            {navBtn("memories", "Memories")}
            {navBtn("conversations", "Conversations")}
            {navBtn("import", "Import")}
            {navBtn("settings", "Settings")}
          </nav>
          <div className="side-head">Conversations</div>
          <div className="conv-list">
            {conversations.map((c) => {
              const locked = !!c.sensitive && !revealed.has(c.id);
              return (
                <button
                  key={c.id}
                  className={"om-conv-item" + (selected?.id === c.id ? " active" : "")}
                  data-testid="conv-item"
                  data-source={c.source}
                  onClick={() => selectConv(c.id)}
                >
                  <span className="om-logo" title={c.source}><Logo source={c.source} /></span>
                  <span className={"om-title" + (locked ? " locked" : "")}>{c.title}</span>
                  {c.sensitive && (
                    <span
                      className="om-lock"
                      role="button"
                      tabIndex={0}
                      title={locked ? "Sensitive — click to reveal" : "Hide"}
                      onClick={(e) => { e.stopPropagation(); toggleReveal(c.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleReveal(c.id); } }}
                    >
                      {locked ? "🔒" : "🔓"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="main">
          {view === "memories" && (
            <MemoriesView
              eligibility={eligibility}
              providers={providers}
              memories={memories}
              extracting={extracting}
              progress={progress}
              phase={phase}
              rateLimited={rateLimited}
              error={extractError}
              onExtract={runExtract}
              onPreview={(limit) => runExtract("stub", {}, limit)}
              onCancel={() => api.cancelExtract()}
              onEdit={async (id, text) => setMemories(await api.editFact(id, text))}
              onForget={async (id) => setMemories(await api.forgetFact(id))}
              onProvenance={(convId) => selectConv(convId)}
              onReset={() => setMemories(null)}
            />
          )}

          {view === "portrait" && (
            <PortraitView onOpenConversation={selectConv} onSkip={() => setView("memories")} />
          )}

          {view === "settings" && (
            <div className="settings" data-testid="settings">
              <h2>Settings</h2>
              <div className="note">Everything stays on your machine. These actions wipe local data and can't be undone.</div>
              <div className="setting-row">
                <div className="setting-copy">
                  <div className="setting-title">Conversations</div>
                  <div className="setting-sub">{conversations.length} imported · removes every conversation and its index.</div>
                </div>
                <button className="secondary danger-btn" data-testid="clear-conversations" onClick={clearConversations}>Clear conversations</button>
              </div>
              <div className="setting-row">
                <div className="setting-copy">
                  <div className="setting-title">Memories</div>
                  <div className="setting-sub">{memories?.facts.length ?? 0} extracted · forgets every memory.</div>
                </div>
                <button className="secondary danger-btn" data-testid="clear-memories" onClick={clearMemories}>Clear memories</button>
              </div>
            </div>
          )}

          {view === "conversations" &&
            (selected ? (
              <div className="conv-pane">
                <div className="conv-head">
                  <h2>{selected.title || "(untitled)"}</h2>
                  <div className="meta">{selected.source} · {selected.messages.length} msgs</div>
                </div>
                <ConversationView messages={selected.messages} />
              </div>
            ) : (
              <div className="facts"><div className="note">Pick a conversation from the sidebar to read it.</div></div>
            ))}

          {view === "import" && (
            <div className="import">
              {importResult ? (
                <>
                  <div className="checkline"><span className="check">✓</span><h2>Conversations uploaded to your memory store</h2></div>
                  <div className="status">{importResult.count} from {importResult.source}{importResult.failed ? ` · ${importResult.failed} skipped` : ""}</div>
                  <button data-testid="to-portrait" onClick={() => setView("portrait")}>Draw my portrait ✨</button>
                  <button className="secondary" data-testid="to-memories" onClick={() => setView("memories")}>See your memories →</button>
                  <button className="secondary" onClick={() => setImportResult(null)}>Import another</button>
                </>
              ) : (
                <div
                  className={"drop" + (hot ? " hot" : "")}
                  data-testid="drop"
                  onDragOver={(e) => { e.preventDefault(); setHot(true); }}
                  onDragLeave={() => setHot(false)}
                  onDrop={doDrop}
                >
                  <div className="drop-logos">
                    <span className="drop-logo"><Logo source="chatgpt" size={44} /></span>
                    <span className="drop-logo"><Logo source="claude" size={44} /></span>
                  </div>
                  <div className="drop-head">Drop your export zip here</div>
                  <div className="or">or</div>
                  <button data-testid="pick" onClick={doPick}>Choose file</button>
                  <div className={"status" + (status.startsWith("Error") ? " err" : "")}>{status}</div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
