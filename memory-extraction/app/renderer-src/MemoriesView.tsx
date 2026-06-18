import { useMemo, useState } from "react";
import type { Eligibility, Fact, MemoriesDoc, RateLimitInfo } from "./env";

/** The buckets (mirror of core's BUCKETS) and their paper-palette accents. */
const BUCKETS = [
  "Body", "Work", "Places", "Taste", "People", "Money",
  "Identity", "Learning", "Food", "Hobbies", "Media", "Goals", "Home", "Beliefs",
] as const;
type Bucket = (typeof BUCKETS)[number];
const BUCKET_COLORS: Record<Bucket, string> = {
  Body: "#d97757",
  Work: "#6c6cf0",
  Places: "#3fae7a",
  Taste: "#d86c9e",
  People: "#4f9cf0",
  Money: "#b08a2e",
  Identity: "#c0508a",
  Learning: "#2fa0a0",
  Food: "#e0883c",
  Hobbies: "#7aa53f",
  Media: "#9b6cd0",
  Goals: "#d2595b",
  Home: "#6f8fb0",
  Beliefs: "#a07c50",
};
const asBucket = (v?: string): Bucket | null => (v && (BUCKETS as readonly string[]).includes(v) ? (v as Bucket) : null);

/** How many open threads to reveal per page. */
const THREADS_PAGE = 6;
const dayKey = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const formatDay = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });

/**
 * The "Your memories" hero. Extraction is automatic (the latest 25 conversations,
 * using the Anthropic key from the app's .env — no key prompt, no provider picker).
 * Three states:
 *   preparing → kicking off / no conversations yet
 *   extracting→ live progress + Cancel
 *   reveal    → extracted facts, each editable + forgettable, with provenance,
 *               plus an "Upgrade to Pro" call to action
 */

interface Props {
  eligibility: Eligibility | null;
  memories: MemoriesDoc | null;
  extracting: boolean;
  progress: number;
  phase: string | null;
  rateLimited: RateLimitInfo | null;
  error: string | null;
  onCancel: () => void;
  onEdit: (id: string, text: string) => void;
  onForget: (id: string) => void;
  onHide: (id: string, sensitive: boolean) => void;
  onProvenance: (convId: string) => void;
  onReset: () => void;
}

function FactCard({
  fact,
  onEdit,
  onForget,
  onHide,
  onProvenance,
}: {
  fact: Fact;
  onEdit: (id: string, text: string) => void;
  onForget: (id: string) => void;
  onHide: (id: string, sensitive: boolean) => void;
  onProvenance: (convId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [text, setText] = useState(fact.text);
  const bucket = asBucket(fact.category);
  const accent = bucket ? BUCKET_COLORS[bucket] : "var(--muted)";
  const locked = !!fact.sensitive && !revealed;
  return (
    <div className="fact-card" data-testid="fact" data-bucket={bucket ?? "none"}>
      <div className="fact-cat" style={{ color: accent }}>
        <span className="fact-dot" style={{ background: accent }} />
        {bucket ?? "Other"}
        {fact.sensitive && (
          <span
            className="fact-lock"
            role="button"
            tabIndex={0}
            title={locked ? "Sensitive — click to reveal" : "Hide"}
            onClick={() => setRevealed((r) => !r)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRevealed((r) => !r); } }}
          >
            {locked ? "🔒" : "🔓"}
          </span>
        )}
      </div>
      {editing ? (
        <textarea className="fact-edit" value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit memory" rows={2} />
      ) : (
        <div
          className={"fact-text" + (locked ? " locked" : "")}
          onClick={() => locked && setRevealed(true)}
        >
          {fact.text}
        </div>
      )}
      <div className="fact-foot">
        <button className="prov" title="Where this came from" onClick={() => fact.from[0] && onProvenance(fact.from[0])}>
          {fact.from.length} conversation{fact.from.length === 1 ? "" : "s"}
        </button>
        <span className="fact-actions">
          {editing ? (
            <>
              <button className="link" onClick={() => { onEdit(fact.id, text.trim()); setEditing(false); }}>Save</button>
              <button className="link" onClick={() => { setText(fact.text); setEditing(false); }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="link" data-testid="fact-edit" onClick={() => setEditing(true)}>Edit</button>
              <button className="link" data-testid="fact-hide" onClick={() => onHide(fact.id, !fact.sensitive)}>
                {fact.sensitive ? "Unhide" : "Hide"}
              </button>
              <button className="link danger" data-testid="fact-forget" onClick={() => onForget(fact.id)}>Forget</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

const FREE_LIMIT = 25;

export function MemoriesView(props: Props) {
  const { eligibility, memories, extracting, progress, phase, rateLimited, error } = props;
  const [filter, setFilter] = useState<"All" | Bucket | "Other">("All");
  const [threadsShown, setThreadsShown] = useState(THREADS_PAGE);
  // Placeholder consent control (no backend yet) — local + accessible so the
  // sharing row reads/behaves like a real switch.
  const [sharingEnabled, setSharingEnabled] = useState(true);
  const limit = FREE_LIMIT;

  const hasFacts = !!memories && memories.facts.length > 0;
  const extracted = !!memories?.extractedAt;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of memories?.facts ?? []) {
      const key = asBucket(f.category) ?? "Other";
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [memories]);

  if (extracting) {
    const eligible = eligibility?.eligible ?? 0; // x — full eligible count
    const cap = limit ?? eligible; // 25 on Free, all on Premium
    const capped = limit !== undefined && eligible > limit;
    const done = Math.min(progress, cap);
    const pct = eligible ? Math.round((done / eligible) * 100) : 0;
    const finalizing = phase === "finalizing";
    return (
      <div className="memories">
        <h2>{finalizing ? "Organizing your memories…" : "Extracting your memories…"}</h2>
        <div className="note">
          {finalizing
            ? "Sorting into categories and merging duplicates — almost done."
            : "Reading your conversations and building a picture of you."}
        </div>
        <div className={"progress" + (finalizing ? " indeterminate" : "")}>
          <div className="bar" style={finalizing ? undefined : { width: `${pct}%` }} />
        </div>
        <div className="status">{finalizing ? "Finalizing…" : `${done} / ${eligible} conversations`}</div>
        {capped && !finalizing && (
          <div className="cap-note" data-testid="cap-note">
            Free version is capped at {limit} conversations. Sign up for Premium to process all {eligible}.
          </div>
        )}
        {rateLimited && (
          <div className="ratelimit" data-testid="ratelimit">
            ⏸ Hit a rate limit — pausing and retrying (waiting {Math.round(rateLimited.waitMs / 1000)}s, attempt {rateLimited.attempt})…
          </div>
        )}
        <button className="secondary" data-testid="cancel-extract" onClick={props.onCancel}>Cancel</button>
      </div>
    );
  }

  if (hasFacts) {
    const facts = memories!.facts;
    const extractedMs = (memories!.extractedAt && Date.parse(memories!.extractedAt)) || Date.now();
    const shown =
      filter === "All"
        ? facts
        : filter === "Other"
          ? facts.filter((f) => !asBucket(f.category))
          : facts.filter((f) => asBucket(f.category) === filter);

    // Group the visible memories by the day of their newest source conversation.
    const byDay = new Map<string, { ms: number; facts: Fact[] }>();
    for (const f of shown) {
      const ms = f.date ?? extractedMs;
      const key = dayKey(ms);
      const g = byDay.get(key) ?? { ms, facts: [] };
      g.facts.push(f);
      byDay.set(key, g);
    }
    const dayGroups = [...byDay.entries()].sort((a, b) => b[1].ms - a[1].ms);

    const fus = memories!.followups;
    const visibleThreads = fus.slice(0, threadsShown);
    const threadsLeft = fus.length - visibleThreads.length;

    return (
      <div className="memories memories-wide">
        <div className="om-hero">
          <div className="om-hero-cap">// your portrait — developing</div>
          <h2 className="om-hero-title">You, in full color.</h2>
          <p className="om-hero-sub">
            Extracted from {memories!.processed ?? facts.length} conversations
            {eligibility?.excluded ? ` · ${eligibility.excluded} excluded (do-not-remember)` : ""}.
            <button className="link" data-testid="reextract" onClick={props.onReset}>Re-extract</button>
          </p>
        </div>

        <div className="om-upgrade">
          <button className="om-upgrade-btn" data-testid="upgrade-pro">Upgrade to Pro</button>
          <div className="om-upgrade-note">Free users get 25 free memories.</div>
        </div>

        {fus.length > 0 && (
          <>
            <div className="section-head">Open threads <span className="section-hint">{fus.length}</span></div>
            <div className="threads">
              {visibleThreads.map((t, i) => (
                <div className="thread-card" key={i}>{t}</div>
              ))}
            </div>
            {(threadsLeft > 0 || threadsShown > THREADS_PAGE) && (
              <div className="threads-controls">
                {threadsLeft > 0 && (
                  <button className="threads-toggle" onClick={() => setThreadsShown((n) => n + THREADS_PAGE)}>
                    View {Math.min(THREADS_PAGE, threadsLeft)} more · {threadsLeft} left ↓
                  </button>
                )}
                {threadsShown > THREADS_PAGE && (
                  <button className="threads-toggle" onClick={() => setThreadsShown(THREADS_PAGE)}>Collapse ↑</button>
                )}
              </div>
            )}
          </>
        )}

        <div className="section-head">
          What I've learned <span className="section-hint">hover a card to edit or forget</span>
        </div>
        <div className="bucket-bar" data-testid="bucket-bar">
          <button className={"chip" + (filter === "All" ? " on" : "")} onClick={() => setFilter("All")}>
            All <span className="chip-n">{facts.length}</span>
          </button>
          {BUCKETS.filter((b) => (counts[b] ?? 0) > 0).map((b) => (
            <button
              key={b}
              className={"chip" + (filter === b ? " on" : "")}
              style={filter === b ? { background: BUCKET_COLORS[b], borderColor: BUCKET_COLORS[b], color: "#fff" } : { color: BUCKET_COLORS[b] }}
              onClick={() => setFilter(b)}
            >
              {b} <span className="chip-n">{counts[b]}</span>
            </button>
          ))}
          {(counts.Other ?? 0) > 0 && (
            <button className={"chip" + (filter === "Other" ? " on" : "")} onClick={() => setFilter("Other")}>
              Other <span className="chip-n">{counts.Other}</span>
            </button>
          )}
        </div>

        <div data-testid="facts">
          {dayGroups.map(([key, g]) => (
            <div className="date-group" key={key}>
              <div className="date-marker"><span>{formatDay(g.ms)}</span></div>
              <div className="facts-grid">
                {g.facts.map((f) => (
                  <FactCard
                    key={f.id}
                    fact={f}
                    onEdit={props.onEdit}
                    onForget={props.onForget}
                    onHide={props.onHide}
                    onProvenance={props.onProvenance}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="om-share-row">
          <div>
            <div className="om-share-cap">// sharing</div>
            <div className="om-share-title">Let services read your portrait</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sharingEnabled}
            aria-label="Let services read your portrait"
            className={"om-toggle" + (sharingEnabled ? " on" : "")}
            onClick={() => setSharingEnabled((s) => !s)}
          >
            <span className="om-toggle-knob" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  if (extracted) {
    return (
      <div className="memories">
        <h2>Your memories</h2>
        <div className="note">No memories were extracted. Try a different model, or upload more conversations.</div>
        <button data-testid="reextract" onClick={props.onReset}>Try again</button>
      </div>
    );
  }

  // preparing — extraction auto-starts as soon as there are eligible conversations.
  const noConversations = !eligibility || eligibility.eligible === 0;
  return (
    <div className="memories">
      <h2>Your memories</h2>
      {error ? (
        <>
          <div className="status err" data-testid="extract-error">{error}</div>
          <button data-testid="reextract" onClick={props.onReset}>Try again</button>
        </>
      ) : noConversations ? (
        <div className="note">Import a ChatGPT or Claude export to start building your memories.</div>
      ) : (
        <div className="status" data-testid="estimate">
          Reading the latest {Math.min(eligibility!.eligible, FREE_LIMIT)} of {eligibility!.eligible} conversation
          {eligibility!.eligible === 1 ? "" : "s"}…
        </div>
      )}
    </div>
  );
}
