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

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

export interface MemoryProvider {
  info: ProviderInfo;
  complete(system: string, user: string, config?: ProviderConfig): Promise<string>;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const claude: MemoryProvider = {
  info: { id: "claude", label: "Claude (Anthropic)", kind: "api", source: "claude", defaultModel: "claude-sonnet-4-6", configHint: "ANTHROPIC_API_KEY" },
  async complete(system, user, cfg = {}) {
    const key = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("Claude provider needs an API key (ANTHROPIC_API_KEY)");
    const j = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      { model: cfg.model ?? this.info.defaultModel, max_tokens: 1024, system, messages: [{ role: "user", content: user }] },
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
      { model: cfg.model ?? this.info.defaultModel, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
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
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }] },
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
      { model: cfg.model ?? this.info.defaultModel, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
    )) as { message?: { content?: string } };
    return j.message?.content ?? "";
  },
};

/** Deterministic, offline. Produces real-shaped output for BOTH extraction modes
 *  (memory facts and the emoji portrait) with no network/key — so the stub powers
 *  the e2e and unit tests. Branches on the system prompt's mode. */
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
    const title = /title: "(.*?)"/.exec(user)?.[1]?.trim();
    const subject = title || "this conversation";
    return JSON.stringify({ add: [`Discussed: ${subject}`], invalidate: [], followups: [`Want to revisit ${subject}?`] });
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
