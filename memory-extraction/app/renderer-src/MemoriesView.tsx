import { useState } from "react";
import type { Eligibility, Fact, MemoriesDoc, ProviderInfo } from "./env";

/**
 * The "Your memories" hero. Three states, per the design review:
 *   idle      → cost/eligibility estimate + provider picker + key + Extract
 *   extracting→ live progress + Cancel
 *   reveal    → extracted facts, each editable + forgettable, with provenance
 */

interface Props {
  eligibility: Eligibility | null;
  providers: ProviderInfo[];
  memories: MemoriesDoc | null;
  extracting: boolean;
  progress: number;
  error: string | null;
  onExtract: (providerId: string, config: { apiKey?: string; endpoint?: string }) => void;
  onPreview: () => void;
  onCancel: () => void;
  onEdit: (id: string, text: string) => void;
  onForget: (id: string) => void;
  onProvenance: (convId: string) => void;
  onReset: () => void;
}

function FactRow({
  fact,
  onEdit,
  onForget,
  onProvenance,
}: {
  fact: Fact;
  onEdit: (id: string, text: string) => void;
  onForget: (id: string) => void;
  onProvenance: (convId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  return (
    <div className="fact" data-testid="fact">
      {editing ? (
        <input className="fact-edit" value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit memory" />
      ) : (
        <span className="fact-text">{fact.text}</span>
      )}
      <button
        className="prov"
        title="Where this came from"
        onClick={() => fact.from[0] && onProvenance(fact.from[0])}
      >
        from {fact.from.length} conversation{fact.from.length === 1 ? "" : "s"}
      </button>
      {editing ? (
        <>
          <button className="link" onClick={() => { onEdit(fact.id, text.trim()); setEditing(false); }}>Save</button>
          <button className="link" onClick={() => { setText(fact.text); setEditing(false); }}>Cancel</button>
        </>
      ) : (
        <>
          <button className="link" data-testid="fact-edit" onClick={() => setEditing(true)}>Edit</button>
          <button className="link danger" data-testid="fact-forget" onClick={() => onForget(fact.id)}>Forget</button>
        </>
      )}
    </div>
  );
}

export function MemoriesView(props: Props) {
  const { eligibility, providers, memories, extracting, progress, error } = props;
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("http://localhost:11434");

  const selected = providers.find((p) => p.id === providerId) ?? providers[0];
  const hasFacts = !!memories && memories.facts.length > 0;
  const extracted = !!memories?.extractedAt;

  if (extracting) {
    const total = eligibility?.eligible ?? 0;
    const pct = total ? Math.round((progress / total) * 100) : 0;
    return (
      <div className="memories">
        <h2>Extracting your memories…</h2>
        <div className="note">Reading your conversations and building a picture of you.</div>
        <div className="progress"><div className="bar" style={{ width: `${pct}%` }} /></div>
        <div className="status">{progress} of {total} conversations</div>
        <button className="secondary" data-testid="cancel-extract" onClick={props.onCancel}>Cancel</button>
      </div>
    );
  }

  if (hasFacts) {
    return (
      <div className="memories">
        <h2>Your memories</h2>
        <div className="status">
          Extracted from {memories!.processed ?? memories!.facts.length} conversations
          {eligibility?.excluded ? ` · ${eligibility.excluded} excluded (do-not-remember)` : ""}
          <button className="link" data-testid="reextract" onClick={props.onReset}>Re-extract</button>
        </div>
        <div className="facts" data-testid="facts">
          {memories!.facts.map((f) => (
            <FactRow key={f.id} fact={f} onEdit={props.onEdit} onForget={props.onForget} onProvenance={props.onProvenance} />
          ))}
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

  // idle
  return (
    <div className="memories">
      <h2>Your memories</h2>
      <div className="note">Extract durable facts about you from your conversations — saved, invalidated, and yours to control.</div>
      {eligibility && (
        <div className="status" data-testid="estimate">
          {eligibility.eligible} eligible conversation{eligibility.eligible === 1 ? "" : "s"}
          {eligibility.excluded ? ` · ${eligibility.excluded} excluded (do-not-remember)` : ""}
        </div>
      )}
      <div className="picker">
        <label htmlFor="prov">Model</label>
        <select id="prov" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {providers.map((p, i) => (
            <option key={p.id} value={p.id}>{p.label}{i === 0 ? " (recommended)" : ""}</option>
          ))}
        </select>
      </div>
      {selected?.kind === "api" ? (
        <div className="config">
          <label htmlFor="key">{selected.label} API key</label>
          <input id="key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={selected.configHint} />
          <div className="privacy warn">Your conversations will be sent to {selected.label} to extract memories.</div>
        </div>
      ) : (
        <div className="config">
          <label htmlFor="endpoint">Ollama endpoint</label>
          <input id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          <div className="privacy">Runs locally — nothing leaves your machine.</div>
        </div>
      )}
      {error && <div className="status err" data-testid="extract-error">{error}</div>}
      <div className="actions">
        <button data-testid="extract" onClick={() => props.onExtract(providerId, selected?.kind === "api" ? { apiKey } : { endpoint })}>
          Extract my memories
        </button>
        <button className="secondary" data-testid="preview" onClick={props.onPreview} title="Run a local preview with no model">
          Preview without a key
        </button>
      </div>
    </div>
  );
}
