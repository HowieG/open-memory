import { type Bucket, BUCKET_GUIDE, type KnowledgeFact, toBucket } from "./extractor";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * The consolidation pass. Per-conversation extraction is intentionally noisy —
 * it emits many overlapping, sometimes trivial facts. This is the single cross-
 * conversation cleanup call: it merges near-duplicates, drops ephemera, assigns
 * a category bucket to each surviving fact, and preserves provenance by unioning
 * the `from` lists of the raw facts it merged. Reliable categorization happens
 * here (one capable call) rather than per-conversation.
 */

export interface ConsolidatedFact {
  text: string;
  category?: Bucket;
  sensitive?: boolean;
  /** indices into the input fact list that this consolidated fact came from */
  sources: number[];
}

export const CONSOLIDATE_SYSTEM_PROMPT =
  "You consolidate a user's raw extracted memory facts into a clean, durable set. " +
  "Rules: (1) MERGE duplicates and near-duplicates into one concise fact. (2) DROP trivial, " +
  "ephemeral, or low-signal facts — keep only durable, meaningful things about the user. (3) Assign " +
  "each surviving fact the single best-fitting category bucket from: " +
  BUCKET_GUIDE +
  ' (use "Other" if none fits). (4) Mark ' +
  "sensitive=true for health, financial, employment, or relationship facts. (5) For each consolidated " +
  "fact, list the source indices (the [N] numbers) it was derived from. Aim for far fewer facts than you " +
  "were given. " +
  'Reply with ONLY a JSON array: [{"text": string, "category": string, "sensitive": boolean, "sources": number[]}]. ' +
  "No prose outside the JSON.";

export function buildConsolidatePrompt(facts: KnowledgeFact[]): string {
  const lines = facts.map((f, i) => `[${i}] cat=${f.category ?? "?"} sens=${f.sensitive ? 1 : 0} :: ${f.text}`);
  return `Consolidate these ${facts.length} raw facts:\n${lines.join("\n")}`;
}

/** Tolerant parse — strips code fences, finds the JSON array, coerces each entry. */
export function parseConsolidation(raw: string): ConsolidatedFact[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(body.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: ConsolidatedFact[] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (typeof o.text !== "string" || !o.text) continue;
      const sources = Array.isArray(o.sources)
        ? o.sources.filter((n): n is number => typeof n === "number" && Number.isInteger(n))
        : [];
      out.push({ text: o.text, category: toBucket(o.category), sensitive: o.sensitive === true, sources });
    }
    return out;
  } catch {
    return [];
  }
}

/** Merge + prune + categorize raw facts in one call. Falls back to the input on
 *  any failure so a flaky consolidation never loses memories. */
export async function consolidateFacts(
  facts: KnowledgeFact[],
  provider: MemoryProvider,
  config?: ProviderConfig,
  opts: { signal?: { aborted: boolean } } = {},
): Promise<KnowledgeFact[]> {
  if (facts.length <= 1 || opts.signal?.aborted) return facts;
  let raw = "";
  try {
    raw = await provider.complete(CONSOLIDATE_SYSTEM_PROMPT, buildConsolidatePrompt(facts), { ...config, maxTokens: 4096 });
  } catch {
    return facts;
  }
  const consolidated = parseConsolidation(raw);
  if (consolidated.length === 0) return facts;
  return consolidated.map((c) => {
    const from = [...new Set(c.sources.flatMap((i) => facts[i]?.from ?? []))];
    return { text: c.text, from, category: c.category, sensitive: c.sensitive };
  });
}
