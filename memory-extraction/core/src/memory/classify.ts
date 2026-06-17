import type { ConversationStore } from "../store";
import { type Bucket, BUCKET_GUIDE, toBucket } from "./extractor";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * The conversation classify pass. A single cheap LLM call (Claude defaults to
 * Haiku) labels every stored conversation by its title: is it SENSITIVE (health,
 * financial, employment, relationship) and which memory bucket does it belong to.
 * The tags are written back onto the index so the sidebar can blur+lock sensitive
 * titles. Runs after extraction, reusing the same provider + BYO key.
 */

export interface ConversationTag {
  id: string;
  sensitive: boolean;
  category?: Bucket;
}

export const CLASSIFY_SYSTEM_PROMPT =
  "You classify a user's AI chat conversations by their titles. For EACH conversation, decide " +
  "if it is SENSITIVE — concerning health, finances, employment, or relationships — and assign the " +
  "single best-fitting category bucket from: " +
  BUCKET_GUIDE +
  '. If none fits well, use "Other". ' +
  'Reply with ONLY a JSON array: [{"id": string, "sensitive": boolean, "category": string}]. ' +
  "Include every id exactly once. No prose outside the JSON.";

export function buildClassifyPrompt(entries: { id: string; title?: string }[]): string {
  const lines = entries.map((e) => `id=${e.id} title="${(e.title ?? "(untitled)").replace(/"/g, "'")}"`);
  return `Classify these ${entries.length} conversations:\n${lines.join("\n")}`;
}

/** Tolerant parse — strips code fences, finds the JSON array, coerces each tag. */
export function parseClassification(raw: string): ConversationTag[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(body.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    const tags: ConversationTag[] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (typeof o.id !== "string") continue;
      tags.push({ id: o.id, sensitive: o.sensitive === true, category: toBucket(o.category) });
    }
    return tags;
  } catch {
    return [];
  }
}

/** Classify every stored conversation and persist the tags onto the index. */
export async function classifyConversations(
  store: ConversationStore,
  provider: MemoryProvider,
  config?: ProviderConfig,
  opts: { signal?: { aborted: boolean } } = {},
): Promise<ConversationTag[]> {
  const entries = store.list().map((e) => ({ id: e.id, title: e.title }));
  if (entries.length === 0 || opts.signal?.aborted) return [];
  const raw = await provider.complete(CLASSIFY_SYSTEM_PROMPT, buildClassifyPrompt(entries), config);
  const tags = parseClassification(raw);
  if (tags.length) await store.applyTags(tags);
  return tags;
}
