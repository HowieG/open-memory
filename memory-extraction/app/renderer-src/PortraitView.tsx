import { useEffect, useRef, useState } from "react";
import type { EmojiSignal } from "./env";

/**
 * The first-delight screen. After import, we offer to "draw a picture of you" in
 * emoji (the consent tease IS the privacy disclosure). On yes, emojis stream onto
 * a radial portrait in arrival order — no reshuffle, because a radial has no
 * visual "first". Hover/focus an emoji to see the chat snippet it came from
 * (proof these are your own words); click to open that conversation.
 *
 * Provider: defaults to the offline `stub` (deterministic, no key) so this runs
 * and is e2e-testable with no network. A real key routes to "claude" (BYO).
 */

const GOLDEN = 137.5 * (Math.PI / 180);

/** phyllotaxis spiral — arrival-order placement, evenly spread, never reshuffled.
 *  Base radius clears the center wordmark; growth keeps later rings from crowding. */
function radialPos(i: number): { x: number; y: number } {
  const r = 168 + 30 * Math.sqrt(i);
  const a = i * GOLDEN;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

type Phase = "consent" | "drawing" | "done" | "error";

// Haiku for cost (the brief's "light model"); the prompt does the heavy lifting.
const PORTRAIT_MODEL = "claude-haiku-4-5-20251001";

export function PortraitView({
  onOpenConversation,
  onSkip,
}: {
  onOpenConversation: (convId: string) => void;
  onSkip: () => void;
}) {
  const api = window.api;
  const [phase, setPhase] = useState<Phase>("consent");
  // BYO Anthropic key — without it we fall back to an offline preview (low quality).
  // localStorage is a stopgap; safeStorage in main is the proper home (deferred).
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("om-anthropic-key") ?? "");
  const [signals, setSignals] = useState<EmojiSignal[]>([]);
  const [active, setActive] = useState<EmojiSignal | null>(null);
  const [convCount, setConvCount] = useState(0);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const runningRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  async function share() {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const text = `a portrait of me, in ${signals.length} emoji — drawn from my own chats by OpenMemory`;
    const res = await api.sharePortrait(
      { x: r.left, y: r.top, width: r.width, height: r.height },
      text,
    );
    setToast("error" in res ? `Couldn’t share: ${res.error}` : "Image copied — paste it into your post");
    setTimeout(() => setToast(null), 4000);
  }

  // The signal listener lives for the component's lifetime — NOT per-draw. If we
  // unsubscribed right after startEmojiPortrait resolves, the invoke reply can be
  // processed before the queued emoji-signal events, dropping them. A persistent
  // listener can't lose them.
  useEffect(() => {
    // Provisional signals fill the canvas live (dedup by emoji); the final ranked
    // set replaces them once every conversation has voted.
    const unsubSig = api.onEmojiSignal((sig) =>
      setSignals((prev) => (prev.some((s) => s.emoji === sig.emoji) ? prev : [...prev, sig])),
    );
    const unsubFinal = api.onEmojiFinal((sigs) => setSignals(sigs));
    const unsubProg = api.onEmojiProgress((p) => setProgress(p));
    return () => {
      unsubSig();
      unsubFinal();
      unsubProg();
      void api.cancelEmojiPortrait();
    };
  }, []);

  async function draw(force = false) {
    if (runningRef.current) return;
    runningRef.current = true;
    const key = apiKey.trim();
    if (key) localStorage.setItem("om-anthropic-key", key);
    // Real portrait via Claude (Haiku) when a key is present; offline stub preview otherwise.
    const providerId = key ? "claude" : "stub";
    const config = key ? { apiKey: key, model: PORTRAIT_MODEL } : {};
    setPhase("drawing");
    setSignals([]);
    setProgress(null);
    setError(null);
    try {
      const res = await api.startEmojiPortrait(providerId, config, 20, force);
      runningRef.current = false;
      if ("error" in res) {
        setError(res.error);
        setPhase("error"); // keep whatever streamed in — never wipe the canvas
      } else {
        setConvCount(res.conversations);
        setPhase("done");
      }
    } catch (e) {
      runningRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  if (phase === "consent") {
    return (
      <div className="portrait-consent" data-testid="portrait-consent">
        <h2>While we get your memories in order…</h2>
        <p className="tease">
          Can we convince you we <em>get</em> you? Let us draw a quick picture of you — in emoji —
          from your own words.
        </p>
        <input
          className="key-input"
          data-testid="portrait-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-… (your Anthropic API key)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <div className="consent-actions">
          <button data-testid="portrait-yes" onClick={() => draw()}>
            {apiKey.trim() ? "Yes — draw my portrait" : "Show me a preview"}
          </button>
          <button className="secondary" data-testid="portrait-no" onClick={onSkip}>
            No thanks
          </button>
        </div>
      </div>
    );
  }

  const count = signals.length;
  const countLine =
    phase === "drawing"
      ? progress
        ? `reading your conversations… ${progress.processed}/${progress.total}`
        : "reading your conversations…"
      : phase === "error"
        ? `we drew what we could — ${count} ${count === 1 ? "piece" : "pieces"}`
        : `a portrait of you, in ${count} ${count === 1 ? "piece" : "pieces"}` +
          (convCount ? ` · from ${convCount} conversations` : "");

  return (
    <div className="portrait" data-testid="portrait">
      <div className="portrait-count" data-testid="portrait-count">
        {countLine}
        {phase === "drawing" && <span className="dots" aria-hidden="true" />}
      </div>
      {phase === "drawing" && progress && progress.total > 0 && (
        <div className="portrait-progress" aria-hidden="true">
          <div className="bar" style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} />
        </div>
      )}

      <div className="portrait-canvas" ref={canvasRef} role="group" aria-label="Your emoji portrait">
        <div className="portrait-center" aria-hidden="true">
          <span className="wordmark">
            Open<b>me</b>mory
          </span>
        </div>

        {signals.map((sig, i) => {
          const { x, y } = radialPos(i);
          return (
            <button
              key={`${sig.emoji}-${sig.keyword}`}
              className="emoji-tile"
              data-testid="emoji-tile"
              style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
              aria-label={`${sig.keyword} — from your conversations`}
              title={sig.keyword}
              onMouseEnter={() => setActive(sig)}
              onFocus={() => setActive(sig)}
              onMouseLeave={() => setActive((a) => (a === sig ? null : a))}
              onBlur={() => setActive((a) => (a === sig ? null : a))}
              onClick={() => onOpenConversation(sig.sourceConvId)}
            >
              <span className="emoji-glyph">{sig.emoji}</span>
              <span className="emoji-caption">{sig.keyword}</span>
            </button>
          );
        })}
      </div>

      {/* assistant-ui-style excerpt: the matched line, faded at the bottom to signal
          "there's more of this conversation, and we kept it." */}
      {active && (
        <div className="excerpt-pop" data-testid="excerpt" role="status">
          <div className="excerpt-emoji">{active.emoji}</div>
          <div className="excerpt-body">
            <div className="excerpt-bubble">
              {active.excerpt || active.keyword}
              <div className="excerpt-fade" aria-hidden="true" />
            </div>
            <button className="excerpt-open" onClick={() => onOpenConversation(active.sourceConvId)}>
              open this conversation →
            </button>
          </div>
        </div>
      )}

      {phase !== "drawing" && (
        <div className="portrait-actions">
          {signals.length > 0 && (
            <button data-testid="portrait-share" onClick={share}>
              Share ↗
            </button>
          )}
          <button className="secondary" data-testid="portrait-redraw" onClick={() => draw(true)}>
            Redraw
          </button>
          <button className="secondary" data-testid="portrait-continue" onClick={onSkip}>
            See your memories →
          </button>
        </div>
      )}
      {toast && (
        <div className="portrait-toast" data-testid="portrait-toast" role="status">
          {toast}
        </div>
      )}
      {error && phase === "error" && (
        <div className="portrait-error">Couldn’t finish: {error}</div>
      )}
    </div>
  );
}
