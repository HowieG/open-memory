import { useEffect, useState } from "react";
import { ConversationView } from "./ConversationView";
import type { ConvData, ConvMeta, UploadResult } from "./env";

const FACTS = [
  "Based in San Francisco.",
  "Runs an AI strategy & implementation consulting practice.",
  "Building open-memory — user-controlled memory you carry between AI apps.",
  "Prefers a near-monochrome design with restrained accents.",
  "Recently working through ChatGPT and Claude data-export ingestion.",
  "Leans on tests and self-checking infrastructure before shipping.",
];

function Logo({ source }: { source: string }) {
  if (source === "chatgpt") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="#000" aria-label="OpenAI">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.062l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.376-3.454l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z" />
      </svg>
    );
  }
  if (source === "claude") {
    const rays: Array<[number, number, number, number]> = [
      [16, 12, 21, 12],
      [14.83, 14.83, 18.36, 18.36],
      [12, 16, 12, 21],
      [9.17, 14.83, 5.64, 18.36],
      [8, 12, 3, 12],
      [9.17, 9.17, 5.64, 5.64],
      [12, 8, 12, 3],
      [14.83, 9.17, 18.36, 5.64],
    ];
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Claude">
        <g stroke="#D97757" strokeWidth="2.2" strokeLinecap="round">
          {rays.map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
      </svg>
    );
  }
  return <span className="om-dot">•</span>;
}

function ConvRow({ c, onClick, active }: { c: ConvMeta; onClick?: () => void; active?: boolean }) {
  return (
    <div
      className={"om-conv-item" + (active ? " active" : "")}
      data-testid="conv-item"
      data-source={c.source}
      onClick={onClick}
    >
      <span className="om-logo" title={c.source}>
        <Logo source={c.source} />
      </span>
      <span className="om-title">{c.title}</span>
    </div>
  );
}

export function App() {
  const api = window.api;
  const [screen, setScreen] = useState<"upload" | "uploaded" | "memories">("upload");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [list, setList] = useState<ConvMeta[]>([]);
  const [selected, setSelected] = useState<ConvData | null>(null);
  const [status, setStatus] = useState("");
  const [hot, setHot] = useState(false);
  const [resumeCount, setResumeCount] = useState(0);

  useEffect(() => {
    api.listConversations().then((l) => setResumeCount(l.length));
  }, []);

  function handleIngest(r: Awaited<ReturnType<typeof api.pickAndIngest>>) {
    if ("canceled" in r) return setStatus("");
    if ("error" in r) return setStatus("Error: " + r.error);
    setResult(r);
    setStatus("");
    setScreen("uploaded");
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

  async function openMemories() {
    const l = await api.listConversations();
    setList(l);
    setSelected(null);
    setScreen("memories");
  }

  async function selectConv(id: string) {
    const c = await api.getConversationData(id);
    if (!("error" in c)) setSelected(c);
  }

  return (
    <div className="om-app">
      <header>
        <h1>open-memory</h1>
        <span className="sub">everything stays on your machine</span>
      </header>

      {screen === "upload" && (
        <section className="screen upload">
          <div
            className={"drop" + (hot ? " hot" : "")}
            data-testid="drop"
            onDragOver={(e) => {
              e.preventDefault();
              setHot(true);
            }}
            onDragLeave={() => setHot(false)}
            onDrop={doDrop}
          >
            <div>
              Drop a <strong>ChatGPT</strong> or <strong>Claude</strong> export <code>.zip</code> here
            </div>
            <div className="or">or</div>
            <button data-testid="pick" onClick={doPick}>
              Choose file
            </button>
            <div className={"status" + (status.startsWith("Error") ? " err" : "")}>{status}</div>
            {resumeCount > 0 && (
              <div className="resume">
                <button onClick={openMemories}>
                  View your {resumeCount} stored conversation{resumeCount === 1 ? "" : "s"} →
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {screen === "uploaded" && result && (
        <section className="screen uploaded">
          <div className="checkline">
            <span className="check">✓</span>
            <h2>Conversations uploaded to your memory store</h2>
          </div>
          <div className="status">
            {result.count} conversation{result.count === 1 ? "" : "s"} from {result.source}
            {result.failed ? ` · ${result.failed} skipped` : ""}
          </div>
          <div className="titlelist" data-testid="uploaded-list">
            {result.uploaded.map((c) => (
              <ConvRow key={c.id} c={c} />
            ))}
          </div>
          <button data-testid="next" onClick={openMemories}>
            Next →
          </button>
        </section>
      )}

      {screen === "memories" && (
        <section className="screen memories">
          <aside className="sidebar">
            <div className="side-head">Conversations</div>
            <div data-testid="mem-list">
              {list.map((c) => (
                <ConvRow
                  key={c.id}
                  c={c}
                  active={selected?.id === c.id}
                  onClick={() => selectConv(c.id)}
                />
              ))}
            </div>
          </aside>
          <div className="main">
            {selected ? (
              <>
                <div className="backbar">
                  <button onClick={() => setSelected(null)}>← Your memories</button>
                </div>
                <div className="conv-head">
                  <h2>{selected.title || "(untitled)"}</h2>
                  <div className="meta">
                    {selected.source} · {selected.messages.length} msgs
                  </div>
                </div>
                <ConversationView messages={selected.messages} />
              </>
            ) : (
              <div className="facts" data-testid="facts">
                <h2>Your memories</h2>
                <div className="note">
                  Placeholder facts — your real memories will be extracted from your {list.length}{" "}
                  conversation{list.length === 1 ? "" : "s"}.
                </div>
                <ul>
                  {FACTS.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
