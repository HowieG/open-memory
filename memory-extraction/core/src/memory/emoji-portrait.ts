import type { CanonicalConversation } from "../schema";
import { CURATED_EMOJI, coerceEmoji } from "./emoji-set";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * Emoji portrait extractor — the first-delight feature.
 *
 * Turns uploaded chat history into ~20 emojis that represent WHO THE USER IS
 * (things they own / do / care about — not things they merely referenced).
 * Reuses the MemoryProvider seam (BYO key, `stub` for offline/tests).
 *
 * MAP-REDUCE, streamed:
 *   conversations ──chunk(byCharBudget)──► [chunk₀, chunk₁, …]
 *        each chunk ──provider.complete──► EmojiSignal[]   (MAP)
 *        yield new ones, skipping emoji/keyword already seen (REDUCE = dedup-on-arrival)
 *
 * No global ranking pass: a radial layout has no visual "first", so signals are
 * emitted in arrival order and the renderer never reshuffles. Selection (does this
 * represent the user?) is the model's job; placement order is not.
 */

export interface EmojiSignal {
  /** short lowercase phrase, e.g. "motorcycle restoration" */
  keyword: string;
  /** one emoji from the curated set */
  emoji: string;
  /** conversation id this came from (drives hover→open-conversation) */
  sourceConvId: string;
  /** 1-2 line quote from the user's own words (drives the hover snippet) */
  excerpt: string;
}

export interface EmojiPortraitOptions {
  provider: MemoryProvider;
  config?: ProviderConfig;
  /** target number of signals (default 20). The generator stops once reached. */
  max?: number;
  /** approx chars per map chunk (keeps each LLM call under context). default ~600k (~150k tok) */
  chunkCharBudget?: number;
  /** abort a long run (user navigated away / cancelled) */
  signal?: { aborted: boolean };
  /** called with the running count after each yielded signal */
  onProgress?: (count: number) => void;
}

export const EMOJI_SYSTEM_PROMPT =
  "You read a person's real AI chat history and draw a portrait of WHO THEY ARE as a " +
  "few emoji. Surface their DURABLE IDENTITY — what they do for work, their hobbies, " +
  "things they own and maintain, places tied to them, people/pets, recurring projects, " +
  "values. A good signal recurs across conversations or is clearly part of their life " +
  "(they tune THEIR motorcycle, they ship THEIR startup, they train for THEIR marathon).\n" +
  "HARD RULES — do NOT include:\n" +
  "- one-off curiosity questions (a trivia lookup, 'what flag is this', a random fact)\n" +
  "- a thing mentioned in a SINGLE conversation with no sign they own/do it\n" +
  "- generic tech how-tos unless coding/their field is clearly their work\n" +
  "- the literal conversation title — infer the underlying trait, not the topic.\n" +
  "Quality over quantity: return FEWER, stronger signals rather than padding. Merge " +
  "near-duplicates (don't list 'running' and 'marathon' separately). For each signal " +
  "pick the single best emoji from the ALLOWED list (use ✨ only if nothing fits), a " +
  "2-4 word lowercase keyword naming the TRAIT (not the question), the convId of the " +
  "most representative conversation, and a short verbatim snippet of the user's words.\n" +
  'Reply with ONLY a JSON array, best signals first: [{"keyword": string, "emoji": ' +
  'string, "convId": string, "excerpt": string}]. No prose.';

function userText(conv: CanonicalConversation): string {
  return conv.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

/** Group conversations into chunks whose combined user-text stays under the budget.
 *  A single oversized conversation gets its own chunk (truncated by the prompt builder). */
export function chunkConversations(
  conversations: CanonicalConversation[],
  charBudget: number,
): CanonicalConversation[][] {
  const chunks: CanonicalConversation[][] = [];
  let current: CanonicalConversation[] = [];
  let size = 0;
  for (const conv of conversations) {
    const len = userText(conv).length;
    if (current.length && size + len > charBudget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(conv);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const PER_CONV_CHARS = 4000; // cap each conversation's user text in the prompt

export function buildEmojiUserPrompt(chunk: CanonicalConversation[]): string {
  const allowed = CURATED_EMOJI.join(" ");
  const blocks = chunk
    .map((c) => {
      const text = userText(c).slice(0, PER_CONV_CHARS);
      return `convId: ${c.id}\ntitle: "${c.title ?? "(untitled)"}"\nuser said:\n${text}`;
    })
    .join("\n\n---\n\n");
  return `ALLOWED emoji (choose only from these): ${allowed}\n\nConversations:\n\n${blocks}`;
}

interface RawItem {
  keyword?: unknown;
  emoji?: unknown;
  convId?: unknown;
  excerpt?: unknown;
}

/** Tolerant parse — strips code fences, finds the JSON array, coerces each item.
 *  Emoji is forced into the curated set; convId falls back to the chunk's first conv. */
export function parseEmojiItems(raw: string, chunk: CanonicalConversation[]): EmojiSignal[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const validIds = new Set(chunk.map((c) => c.id));
  const fallbackId = chunk[0]?.id ?? "";
  const out: EmojiSignal[] = [];
  for (const it of arr as RawItem[]) {
    if (!it || typeof it.keyword !== "string" || !it.keyword.trim()) continue;
    const keyword = it.keyword.trim().toLowerCase();
    const emoji = coerceEmoji(typeof it.emoji === "string" ? it.emoji : undefined, keyword);
    const convId = typeof it.convId === "string" && validIds.has(it.convId) ? it.convId : fallbackId;
    const excerpt = typeof it.excerpt === "string" ? it.excerpt.trim() : "";
    out.push({ keyword, emoji, sourceConvId: convId, excerpt });
  }
  return out;
}

const DEFAULT_MAX = 20;
const DEFAULT_CHUNK_CHARS = 600_000;

/** Stream emoji signals as each chunk's MAP call returns. Dedups by emoji AND
 *  keyword on arrival; stops at `max`. Cancellable via `signal`. */
export async function* extractEmojiPortrait(
  conversations: CanonicalConversation[],
  opts: EmojiPortraitOptions,
): AsyncGenerator<EmojiSignal> {
  const max = opts.max ?? DEFAULT_MAX;
  const budget = opts.chunkCharBudget ?? DEFAULT_CHUNK_CHARS;
  const seenEmoji = new Set<string>();
  const seenKeyword = new Set<string>();
  let count = 0;

  for (const chunk of chunkConversations(conversations, budget)) {
    if (opts.signal?.aborted || count >= max) break;
    let raw: string;
    try {
      // ~20 items with excerpts need more than the default output budget, or the
      // JSON gets truncated mid-array and the whole chunk fails to parse.
      raw = await opts.provider.complete(EMOJI_SYSTEM_PROMPT, buildEmojiUserPrompt(chunk), {
        ...opts.config,
        maxTokens: opts.config?.maxTokens ?? 2048,
      });
    } catch {
      // a failed chunk drops its signals but never wipes what's already placed
      continue;
    }
    for (const sig of parseEmojiItems(raw, chunk)) {
      if (count >= max) break;
      if (seenEmoji.has(sig.emoji) || seenKeyword.has(sig.keyword)) continue;
      seenEmoji.add(sig.emoji);
      seenKeyword.add(sig.keyword);
      count++;
      opts.onProgress?.(count);
      yield sig;
    }
  }
}
