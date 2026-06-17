import type { CanonicalConversation } from "../schema";
import type { ConversationStore } from "../store";
import { memoryExtractionSource } from "../memory-source";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * The memory extractor. Walks eligible conversations oldest-first (via
 * MemoryExtractionSource) and, for each, asks the chosen provider to update an
 * accumulating picture of the user: save new knowledge, invalidate stale
 * knowledge, and propose follow-up questions. This is the seam that turns the
 * "Your memories" page from placeholders into real, extracted facts.
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

interface ExtractionUpdate {
  add: string[];
  invalidate: string[];
  followups: string[];
}

const SYSTEM_PROMPT =
  "You build a durable, evolving picture of a user from their AI chat history. " +
  "Given what is already known about them and one new conversation, identify any NEW, durable " +
  "knowledge about them — who they are, their interests, what they're researching or considering, " +
  "decisions they've made. Invalidate anything the new conversation contradicts or makes stale. " +
  "Also propose follow-up questions that would complete the picture (e.g. 'are you still doing X?'). " +
  'Reply with ONLY JSON: {"add": string[], "invalidate": string[], "followups": string[]}. ' +
  "Each fact is one concise sentence. No prose outside the JSON.";

function buildUserPrompt(knowledge: KnowledgeFact[], conv: CanonicalConversation): string {
  const known = knowledge.length ? knowledge.map((f) => `- ${f.text}`).join("\n") : "(nothing known yet)";
  const transcript = conv.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  return (
    `Known about the user so far:\n${known}\n\n` +
    `New conversation from ${conv.source}, title: "${conv.title ?? "(untitled)"}":\n${transcript}`
  );
}

/** Tolerant JSON parse — strips code fences and trailing prose. */
export function parseExtraction(raw: string): ExtractionUpdate {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return { add: [], invalidate: [], followups: [] };
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as Partial<ExtractionUpdate>;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { add: arr(obj.add), invalidate: arr(obj.invalidate), followups: arr(obj.followups) };
  } catch {
    return { add: [], invalidate: [], followups: [] };
  }
}

function applyUpdate(facts: Map<string, KnowledgeFact>, update: ExtractionUpdate, convId: string): void {
  for (const text of update.invalidate) {
    const needle = text.toLowerCase();
    for (const key of [...facts.keys()]) {
      if (key.toLowerCase().includes(needle) || needle.includes(key.toLowerCase())) facts.delete(key);
    }
  }
  for (const text of update.add) {
    const existing = facts.get(text);
    if (existing) existing.from.push(convId);
    else facts.set(text, { text, from: [convId] });
  }
}

/** Run extraction over the whole store with the given provider. */
export async function extractMemories(
  store: ConversationStore,
  provider: MemoryProvider,
  config?: ProviderConfig,
): Promise<ExtractionResult> {
  const facts = new Map<string, KnowledgeFact>();
  const followups: string[] = [];
  let processed = 0;

  for await (const conv of memoryExtractionSource(store)) {
    const raw = await provider.complete(SYSTEM_PROMPT, buildUserPrompt([...facts.values()], conv), config);
    const update = parseExtraction(raw);
    applyUpdate(facts, update, conv.id);
    for (const f of update.followups) if (!followups.includes(f)) followups.push(f);
    processed++;
  }

  return { facts: [...facts.values()], followups, conversationsProcessed: processed };
}
