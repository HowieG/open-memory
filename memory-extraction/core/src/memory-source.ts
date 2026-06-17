import type { CanonicalConversation } from "./schema";
import type { ConversationStore } from "./store";

/**
 * MemoryExtractionSource — the read-interface the (future) LLM memory extractor
 * consumes. It is the seam that turns this from a conversation viewer into a
 * memory product.
 *
 *   store ──[eligible + chronological]──> extractor (accumulated knowledge + conversation
 *                                                    -> save / invalidate / increment facts)
 *
 * Two guarantees the extractor relies on:
 *   1. ELIGIBILITY is enforced here — conversations the user marked do-not-remember
 *      are never yielded, so opted-out data never reaches extraction.
 *   2. CHRONOLOGICAL order — the extractor builds and temporally-invalidates
 *      knowledge over time, so it must see conversations oldest-first.
 */

/** A conversation is ineligible if the user marked it do-not-remember (ChatGPT's
 *  `is_do_not_remember` pill). Other sources have no equivalent today, so they're
 *  eligible by default. */
export function isEligibleForMemory(c: CanonicalConversation): boolean {
  return c.source_metadata?.is_do_not_remember !== true;
}

/** Yield eligible conversations, NEWEST-first (most recent activity prioritized,
 *  so a capped run captures the user's current state). Loaded lazily from disk. */
export async function* memoryExtractionSource(
  store: ConversationStore,
): AsyncGenerator<CanonicalConversation> {
  for (const entry of [...store.list()].reverse()) {
    const c = await store.get(entry.id);
    if (c && isEligibleForMemory(c)) yield c;
  }
}

/** Counts for the UI: how many conversations feed memory vs are excluded. */
export async function memoryEligibility(
  store: ConversationStore,
): Promise<{ eligible: number; excluded: number; total: number }> {
  let eligible = 0;
  for (const entry of store.list()) {
    const c = await store.get(entry.id);
    if (c && isEligibleForMemory(c)) eligible++;
  }
  const total = store.size();
  return { eligible, excluded: total - eligible, total };
}
