import type { SourceId } from "../schema";
import { mapKeywordToEmoji } from "./emoji-set";

/**
 * Pluggable memory-extraction providers. Four are built in out of the box —
 * Claude, OpenAI, Gemini, Ollama — plus a deterministic local `stub` so the
 * pipeline runs end-to-end without any API key.
 *
 * A provider does ONE thing: given a system + user prompt, return the model's
 * text. The extractor owns the prompt, the JSON parsing, and the knowledge state.
 */

export type ProviderId = "claude" | "openai" | "gemini" | "ollama" | "stub";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: "api" | "local";
  /** the export source this provider corresponds to (drives upload-ranked order) */
  source?: SourceId;
  defaultModel: string;
  /** how the user configures it (env var or endpoint) */
  configHint: string;
}

export interface RateLimitInfo {
  attempt: number;
  waitMs: number;
}

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  /** cap on output tokens (the consolidation pass needs a larger budget) */
  maxTokens?: number;
  /** called before each rate-limit backoff so the UI can communicate the pause */
  onRateLimit?: (info: RateLimitInfo) => void;
}

export interface MemoryProvider {
  info: ProviderInfo;
  complete(system: string, user: string, config?: ProviderConfig): Promise<string>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fetch with retry on rate limits (429/529): honor Retry-After, else exponential
 *  backoff (capped 30s). Calls onRateLimit before each pause. `inject.sleep` is
 *  overridable for tests. */
export async function requestWithRetry(
  doFetch: () => Promise<Response>,
  onRateLimit?: (info: RateLimitInfo) => void,
  inject: { maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<unknown> {
  const maxRetries = inject.maxRetries ?? 5;
  const wait = inject.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch();
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
      onRateLimit?.({ attempt: attempt + 1, waitMs });
      await wait(waitMs);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  }
}

function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onRateLimit?: (info: RateLimitInfo) => void,
): Promise<unknown> {
  return requestWithRetry(
    () => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
    onRateLimit,
  );
}

const claude: MemoryProvider = {
  info: { id: "claude", label: "Claude (Anthropic)", kind: "api", source: "claude", defaultModel: "claude-haiku-4-5-20251001", configHint: "ANTHROPIC_API_KEY" },
  async complete(system, user, cfg = {}) {
    const key = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Claude provider needs an API key (ANTHROPIC_API_KEY)");
    const j = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      { model: cfg.model ?? this.info.defaultModel, max_tokens: cfg.maxTokens ?? 1024, system, messages: [{ role: "user", content: user }] },
      cfg.onRateLimit,
    )) as { content?: { text?: string }[] };
    return j.content?.[0]?.text ?? "";
  },
};

const openai: MemoryProvider = {
  info: { id: "openai", label: "OpenAI (ChatGPT)", kind: "api", source: "chatgpt", defaultModel: "gpt-4o-mini", configHint: "OPENAI_API_KEY" },
  async complete(system, user, cfg = {}) {
    const key = cfg.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI provider needs an API key (OPENAI_API_KEY)");
    const j = (await postJson(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${key}` },
      { model: cfg.model ?? this.info.defaultModel, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}) },
      cfg.onRateLimit,
    )) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  },
};

const gemini: MemoryProvider = {
  info: { id: "gemini", label: "Gemini (Google)", kind: "api", source: "gemini", defaultModel: "gemini-2.0-flash", configHint: "GEMINI_API_KEY" },
  async complete(system, user, cfg = {}) {
    const key = cfg.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini provider needs an API key (GEMINI_API_KEY)");
    const model = cfg.model ?? this.info.defaultModel;
    const j = (await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {},
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], ...(cfg.maxTokens ? { generationConfig: { maxOutputTokens: cfg.maxTokens } } : {}) },
      cfg.onRateLimit,
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  },
};

const ollama: MemoryProvider = {
  info: { id: "ollama", label: "Ollama (local)", kind: "local", defaultModel: "llama3.1", configHint: "http://localhost:11434" },
  async complete(system, user, cfg = {}) {
    const endpoint = cfg.endpoint ?? "http://localhost:11434";
    const j = (await postJson(
      `${endpoint}/api/chat`,
      {},
      { model: cfg.model ?? this.info.defaultModel, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(cfg.maxTokens ? { options: { num_predict: cfg.maxTokens } } : {}) },
      cfg.onRateLimit,
    )) as { message?: { content?: string } };
    return j.message?.content ?? "";
  },
};

/** Deterministic keyword tagger — used by the offline stub for BOTH the memory
 *  buckets and the classify pass, so e2e/unit runs are stable without a model. */
export function heuristicTag(text: string): { category: string; sensitive: boolean } {
  const t = text.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => t.includes(w));
  const sensitive =
    has("health", "medical", "therapy", "doctor", "anxiety", "depress", "diagnos", "symptom") ||
    has("salary", "income", "debt", "tax", "loan", "invest", "401k", "hsa", "mortgage", "net worth") ||
    has("job", "fired", "laid off", "resign", "boss", "interview", "promotion", "employer") ||
    has("relationship", "dating", "divorce", "breakup", "marriage", "partner", "girlfriend", "boyfriend");
  const category = has("money", "finance", "invest", "401k", "hsa", "tax", "salary", "budget", "savings")
    ? "Money"
    : has("relationship", "dating", "family", "friend", "partner", "marriage")
      ? "People"
      : has("travel", "trip", "city", "country", "move", "vanlife", "visa", "residency", "flight")
        ? "Places"
        : has("fashion", "style", "music", "food", "fragrance", "dance", "dress", "coffee", "wine")
          ? "Taste"
          : has("health", "fitness", "gym", "workout", "jiu-jitsu", "skin", "diet", "sleep", "body", "doctor")
            ? "Body"
            : "Work";
  return { category, sensitive };
}

/** Deterministic, offline. Produces real-shaped output for ALL three modes
 *  (memory facts, the emoji portrait, the classify pass) with no network/key — so
 *  the stub powers the e2e and unit tests. Branches on the system prompt's mode. */
const stub: MemoryProvider = {
  info: { id: "stub", label: "Local (no model)", kind: "local", defaultModel: "deterministic", configHint: "none" },
  async complete(system, user) {
    if (/emoji/i.test(system)) {
      // Emoji portrait: one signal per conversation block, emoji derived from title.
      const items: { keyword: string; emoji: string; convId: string; excerpt: string }[] = [];
      const re = /convId: (\S+)\ntitle: "(.*?)"\nuser said:\n([\s\S]*?)(?=\n\n---\n\n|$)/g;
      for (let m = re.exec(user); m; m = re.exec(user)) {
        const [, convId, title, said] = m;
        const keyword = (title || "this topic").trim().toLowerCase();
        items.push({
          keyword,
          emoji: mapKeywordToEmoji(keyword),
          convId: convId!,
          excerpt: (said ?? "").trim().split("\n")[0]!.slice(0, 160),
        });
      }
      return JSON.stringify(items);
    }
    if (/classify/i.test(system)) {
      // Classify pass: one tag per "id=<id> title=\"<title>\"" line.
      const tags: { id: string; sensitive: boolean; category: string }[] = [];
      const re = /id=(\S+) title="(.*?)"/g;
      for (let m = re.exec(user); m; m = re.exec(user)) {
        const [, id, title] = m;
        const { category, sensitive } = heuristicTag(title ?? "");
        tags.push({ id: id!, sensitive, category });
      }
      return JSON.stringify(tags);
    }
    if (/consolidate/i.test(system)) {
      // Consolidation pass: identity — echo each "[i] cat=X sens=0/1 :: text" line back.
      const out: { text: string; category: string; sensitive: boolean; sources: number[] }[] = [];
      const re = /\[(\d+)\] cat=(\S+) sens=([01]) :: (.*)/g;
      for (let m = re.exec(user); m; m = re.exec(user)) {
        const [, idx, cat, sens, text] = m;
        out.push({ text: text!.trim(), category: cat === "?" ? "" : cat!, sensitive: sens === "1", sources: [Number(idx)] });
      }
      return JSON.stringify(out);
    }
    const title = /title: "(.*?)"/.exec(user)?.[1]?.trim();
    const subject = title || "this conversation";
    const { category, sensitive } = heuristicTag(subject);
    return JSON.stringify({ add: [{ text: `Discussed: ${subject}`, category, sensitive }], followups: [`Want to revisit ${subject}?`] });
  },
};

export const PROVIDERS: Record<ProviderId, MemoryProvider> = { claude, openai, gemini, ollama, stub };

/** Order providers by how many conversations the user uploaded from each
 *  provider's source (descending). Local providers (no source) sink to the end.
 *  `stub` is excluded — it's an internal fallback, not a user-facing choice. */
export function rankProviders(counts: Record<string, number>): ProviderInfo[] {
  return Object.values(PROVIDERS)
    .map((p) => p.info)
    .filter((info) => info.id !== "stub")
    .sort((a, b) => {
      const ca = a.source ? (counts[a.source] ?? 0) : -1;
      const cb = b.source ? (counts[b.source] ?? 0) : -1;
      return cb - ca;
    });
}
