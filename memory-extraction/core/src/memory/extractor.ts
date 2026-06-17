import type { CanonicalConversation } from "../schema";
import { memoryExtractionSource } from "../memory-source";
import type { ConversationStore } from "../store";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * The memory extractor. Pulls the user's most-recent eligible conversations
 * (newest-first, capped) and extracts durable facts from each — in PARALLEL with
 * bounded concurrency, so a Haiku-class model finishes fast without tripping rate
 * limits. Facts are merged + deduped across conversations afterward.
 *
 * Parallel means each conversation is extracted independently (no shared running
 * state), so cross-conversation consolidation/invalidation is a later pass.
 */

export interface KnowledgeFact {
  text: string;
  /** conversation ids this fact was derived from */
  from: string[];
}

export interface ExtractionResult {
  facts: KnowledgeFact[];
  followups: string[];
  conversationsProcessed: number;
}

export interface ExtractOptions {
  /** cap how many (most-recent) conversations to process. Default: all. */
  limit?: number;
  /** max in-flight model calls (rate-limit guard). Default: 5. */
  concurrency?: number;
  /** called after each conversation finishes (for a progress bar) */
  onProgress?: (processed: number) => void;
  /** abort a long run (the user clicked Cancel) */
  signal?: { aborted: boolean };
}

interface ExtractionUpdate {
  add: string[];
  followups: string[];
}

const SYSTEM_PROMPT =
  "You extract durable facts about a user from ONE of their AI chat conversations. " +
  "Identify NEW, durable knowledge about them — who they are, their interests, what they're " +
  "researching, considering, or have decided. Skip ephemeral details. Also propose follow-up " +
  "questions that would complete the picture of them. " +
  'Reply with ONLY JSON: {"add": string[], "followups": string[]}. ' +
  "Each fact is one concise sentence about the user. No prose outside the JSON.";

function buildUserPrompt(conv: CanonicalConversation): string {
  const transcript = conv.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  return `Conversation from ${conv.source}, title: "${conv.title ?? "(untitled)"}":\n${transcript}`;
}

/** Tolerant JSON parse — strips code fences and trailing prose. */
export function parseExtraction(raw: string): ExtractionUpdate {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return { add: [], followups: [] };
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as Partial<ExtractionUpdate>;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { add: arr(obj.add), followups: arr(obj.followups) };
  } catch {
    return { add: [], followups: [] };
  }
}

/** bounded-concurrency map */
async function pMap<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length || 1) }, worker));
}

/** Run extraction over the most-recent eligible conversations, in parallel. */
export async function extractMemories(
  store: ConversationStore,
  provider: MemoryProvider,
  config?: ProviderConfig,
  opts: ExtractOptions = {},
): Promise<ExtractionResult> {
  const limit = opts.limit ?? Infinity;

  // newest-first, capped
  const conversations: CanonicalConversation[] = [];
  for await (const conv of memoryExtractionSource(store)) {
    conversations.push(conv);
    if (conversations.length >= limit) break;
  }

  const facts = new Map<string, KnowledgeFact>();
  const followups: string[] = [];
  let processed = 0;

  await pMap(conversations, opts.concurrency ?? 5, async (conv) => {
    if (opts.signal?.aborted) return;
    let update: ExtractionUpdate = { add: [], followups: [] };
    try {
      update = parseExtraction(await provider.complete(SYSTEM_PROMPT, buildUserPrompt(conv), config));
    } catch {
      // one failed conversation doesn't abort the run
    }
    for (const text of update.add) {
      const existing = facts.get(text);
      if (existing) existing.from.push(conv.id);
      else facts.set(text, { text, from: [conv.id] });
    }
    for (const f of update.followups) if (!followups.includes(f)) followups.push(f);
    processed++;
    opts.onProgress?.(processed);
  });

  return { facts: [...facts.values()], followups, conversationsProcessed: processed };
}
