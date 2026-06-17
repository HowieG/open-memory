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

/** The memory buckets — drive the Memories view filter + card labels. Anything
 *  that doesn't fit one of these stays uncategorized and shows as "Other". */
export const BUCKETS = [
  "Body", "Work", "Places", "Taste", "People", "Money",
  "Identity", "Learning", "Food", "Hobbies", "Media", "Goals", "Home", "Beliefs",
] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Human-readable bucket descriptions, shared by every prompt so they stay in sync. */
export const BUCKET_GUIDE =
  "Body (health, fitness, medical, mental wellbeing), Work (career, job, business, professional), " +
  "Places (travel, trips, where they live or go), Taste (style, fashion, design, aesthetics), " +
  "People (relationships, family, friends, social), Money (personal finance, income, investments, purchases), " +
  "Identity (core facts about who they are — name, age, location, background), " +
  "Learning (studying, researching, topics they're curious about), Food (cooking, eating, diet, restaurants), " +
  "Hobbies (sports, games, crafts, side activities), Media (books, music, film, shows, podcasts they enjoy), " +
  "Goals (plans, decisions, aspirations, intentions), Home (living situation, pets, household, possessions), " +
  "Beliefs (values, opinions, politics, worldview)";

/** Common labels a model reaches for, mapped onto the closest bucket. */
const BUCKET_ALIASES: Record<string, Bucket> = {
  tech: "Work", technology: "Work", coding: "Work", code: "Work", dev: "Work", development: "Work",
  engineering: "Work", software: "Work", programming: "Work", career: "Work", business: "Work",
  job: "Work", project: "Work", projects: "Work", productivity: "Work", startup: "Work",
  travel: "Places", location: "Places", geography: "Places", place: "Places",
  health: "Body", fitness: "Body", wellness: "Body", medical: "Body", exercise: "Body",
  cooking: "Food", recipe: "Food", recipes: "Food", restaurant: "Food", restaurants: "Food", diet: "Food", eating: "Food",
  style: "Taste", fashion: "Taste", design: "Taste", aesthetic: "Taste", aesthetics: "Taste",
  music: "Media", film: "Media", films: "Media", movie: "Media", movies: "Media", book: "Media", books: "Media",
  tv: "Media", show: "Media", shows: "Media", podcast: "Media", podcasts: "Media", reading: "Media", entertainment: "Media",
  family: "People", relationship: "People", relationships: "People", social: "People", friends: "People", dating: "People",
  finance: "Money", financial: "Money", investing: "Money", investment: "Money", budget: "Money", purchases: "Money",
  hobby: "Hobbies", sport: "Hobbies", sports: "Hobbies", craft: "Hobbies", crafts: "Hobbies", gaming: "Hobbies",
  learning: "Learning", study: "Learning", studying: "Learning", research: "Learning", education: "Learning", curiosity: "Learning",
  goal: "Goals", plan: "Goals", plans: "Goals", decision: "Goals", decisions: "Goals", aspiration: "Goals",
  house: "Home", pet: "Home", pets: "Home", household: "Home", possessions: "Home",
  belief: "Beliefs", values: "Beliefs", value: "Beliefs", politics: "Beliefs", religion: "Beliefs", opinion: "Beliefs", worldview: "Beliefs",
  identity: "Identity", bio: "Identity", personal: "Identity", background: "Identity", lifestyle: "Identity",
};

/** Coerce an arbitrary string to a known bucket (case-insensitive, with aliases). */
export function toBucket(v: unknown): Bucket | undefined {
  if (typeof v !== "string") return undefined;
  const k = v.trim().toLowerCase();
  return BUCKETS.find((b) => b.toLowerCase() === k) ?? BUCKET_ALIASES[k];
}

export interface KnowledgeFact {
  text: string;
  /** conversation ids this fact was derived from */
  from: string[];
  /** which bucket this fact belongs to (Body/Work/Places/Taste/People/Money) */
  category?: Bucket;
  /** health/financial/employment/relationship → blurred + locked in the UI */
  sensitive?: boolean;
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

export interface ExtractedFact {
  text: string;
  category?: Bucket;
  sensitive?: boolean;
}

interface ExtractionUpdate {
  add: ExtractedFact[];
  followups: string[];
}

const SYSTEM_PROMPT =
  "You extract durable facts about a user from ONE of their AI chat conversations. " +
  "Be SELECTIVE: capture only NEW, durable, meaningful knowledge about who they are — their identity, " +
  "ongoing projects, decisions, preferences, and circumstances. Do NOT record ephemeral details, " +
  "one-off questions, generic technical Q&A, or facts about the assistant's answer rather than the user. " +
  "Prefer a few high-signal facts over many trivial ones; emit at most 5, and none if the conversation " +
  "reveals nothing durable about the user. Also propose follow-up questions that would complete their picture. " +
  "For EACH fact, assign the single best-fitting category bucket from: " +
  BUCKET_GUIDE +
  '. If none fits well, use "Other". Also mark sensitive=true when the fact concerns ' +
  "health, finances, employment, or relationships. " +
  'Reply with ONLY JSON: {"add": [{"text": string, "category": string, "sensitive": boolean}], "followups": string[]}. ' +
  "Each fact text is one concise sentence about the user. No prose outside the JSON.";

function buildUserPrompt(conv: CanonicalConversation): string {
  const transcript = conv.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  return `Conversation from ${conv.source}, title: "${conv.title ?? "(untitled)"}":\n${transcript}`;
}

/** Coerce one `add` item — a bare string (legacy) or {text, category?, sensitive?}. */
function toFact(x: unknown): ExtractedFact | null {
  if (typeof x === "string") return x ? { text: x } : null;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text) return null;
    return { text: o.text, category: toBucket(o.category), sensitive: o.sensitive === true };
  }
  return null;
}

/** Tolerant JSON parse — strips code fences and trailing prose. Accepts both the
 *  legacy `add: string[]` shape and the bucketed `add: {text,category,sensitive}[]`. */
export function parseExtraction(raw: string): ExtractionUpdate {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return { add: [], followups: [] };
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as Partial<ExtractionUpdate>;
    const add = Array.isArray(obj.add) ? obj.add.map(toFact).filter((f): f is ExtractedFact => f !== null) : [];
    const followups = Array.isArray(obj.followups)
      ? obj.followups.filter((x): x is string => typeof x === "string")
      : [];
    return { add, followups };
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
    for (const f of update.add) {
      const existing = facts.get(f.text);
      if (existing) {
        existing.from.push(conv.id);
        if (!existing.category && f.category) existing.category = f.category;
        if (f.sensitive) existing.sensitive = true;
      } else {
        facts.set(f.text, { text: f.text, from: [conv.id], category: f.category, sensitive: f.sensitive });
      }
    }
    for (const f of update.followups) if (!followups.includes(f)) followups.push(f);
    processed++;
    opts.onProgress?.(processed);
  });

  return { facts: [...facts.values()], followups, conversationsProcessed: processed };
}
