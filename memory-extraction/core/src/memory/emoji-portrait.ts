import type { CanonicalConversation } from "../schema";
import { CURATED_EMOJI, FALLBACK_EMOJI, coerceEmoji } from "./emoji-set";
import type { MemoryProvider, ProviderConfig } from "./providers";

/**
 * Emoji portrait extractor — the first-delight feature.
 *
 * Turns uploaded chat history into ~20 emojis representing WHO THE USER IS.
 * Reuses the MemoryProvider seam (BYO key, `stub` for offline/tests).
 *
 * PER-CONVERSATION + FREQUENCY RANK (not one giant dump):
 *   each conversation ──provider.complete──► 0-2 identity candidates   (MAP, parallel)
 *   all candidates ──group by emoji, count──► rank by how many convs    (REDUCE)
 *                                              voted for each theme
 *
 * Why per-conversation: full model attention on one conversation at a time beats
 * asking it to distill 150k tokens at once. Why frequency: a theme that recurs
 * across many conversations (their motorcycle) outranks a one-off question (a game
 * they asked about once) — exactly the "deeply personal" signal we want. A radial
 * layout has no "first", so placement order doesn't matter; rank picks the SET.
 */

export interface EmojiSignal {
  /** short lowercase phrase, e.g. "motorcycle restoration" */
  keyword: string;
  /** one emoji from the curated set (✨ when nothing fit) */
  emoji: string;
  /** conversation id this came from (drives hover→open-conversation) */
  sourceConvId: string;
  /** 1-2 line quote from the user's own words (drives the hover snippet) */
  excerpt: string;
  /** how many conversations surfaced this theme (signal strength) */
  count?: number;
}

export interface EmojiPortraitOptions {
  provider: MemoryProvider;
  config?: ProviderConfig;
  /** target number of signals (default 20) */
  max?: number;
  /** parallel conversation calls in flight (default 8) */
  concurrency?: number;
  /** abort a long run (user navigated away / cancelled) */
  signal?: { aborted: boolean };
  /** called after each conversation is processed (drives the progress bar) */
  onProgress?: (processed: number, total: number) => void;
  /** called the FIRST time a new emoji theme is seen, so the canvas can fill live
   *  while processing. The final ranked set (the return value) supersedes these. */
  onCandidate?: (sig: EmojiSignal) => void;
}

export const EMOJI_SYSTEM_PROMPT =
  "You read ONE conversation from a person's AI chat history and decide whether it " +
  "reveals a DURABLE IDENTITY signal about them — something they own, do, are, build, " +
  "or genuinely care about (their motorcycle, their job, their dog, their startup, a " +
  "place tied to them). Most conversations DON'T: a one-off trivia question, a generic " +
  "how-to, a random lookup ('what flag is this'), or something they only reference once " +
  "with no sign they own/do it → return an empty array [].\n" +
  "If there IS a real signal, return 1-2 of them. For each: a 2-4 word lowercase " +
  "keyword naming the TRAIT (not the conversation topic/title), the single best emoji " +
  "from the ALLOWED list (✨ only if nothing fits), and a short verbatim snippet of the " +
  "user's own words.\n" +
  'Reply with ONLY a JSON array (possibly empty): [{"keyword": string, "emoji": ' +
  'string, "excerpt": string}]. No prose.';

function userText(conv: CanonicalConversation): string {
  return conv.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

const PER_CONV_CHARS = 6000; // cap one conversation's user text in the prompt

/** Prompt for a SINGLE conversation. (convId is carried separately; the model
 *  doesn't need to echo it.) */
export function buildEmojiUserPrompt(conv: CanonicalConversation): string {
  const allowed = CURATED_EMOJI.join(" ");
  const text = userText(conv).slice(0, PER_CONV_CHARS);
  return (
    `ALLOWED emoji (choose only from these): ${allowed}\n\n` +
    `Conversation title: "${conv.title ?? "(untitled)"}"\nThe user said:\n${text}`
  );
}

interface RawItem {
  keyword?: unknown;
  emoji?: unknown;
  excerpt?: unknown;
}

interface Candidate {
  keyword: string;
  emoji: string;
  sourceConvId: string;
  excerpt: string;
}

/** Tolerant parse of one conversation's response → candidates (emoji coerced into
 *  the set; convId stamped from the conversation). Empty/garbage → []. */
export function parseConvCandidates(raw: string, conv: CanonicalConversation): Candidate[] {
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
  const out: Candidate[] = [];
  for (const it of arr as RawItem[]) {
    if (!it || typeof it.keyword !== "string" || !it.keyword.trim()) continue;
    const keyword = it.keyword.trim().toLowerCase();
    out.push({
      keyword,
      emoji: coerceEmoji(typeof it.emoji === "string" ? it.emoji : undefined, keyword),
      sourceConvId: conv.id,
      excerpt: typeof it.excerpt === "string" ? it.excerpt.trim() : "",
    });
  }
  return out;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let max = 0;
  for (const [v, n] of counts) if (n > max) ((max = n), (best = v));
  return best;
}

/**
 * Reduce candidates → ranked signals. Real-emoji candidates cluster by emoji and
 * rank by how many conversations voted (frequency = personal-ness). ✨ candidates
 * are weak ("a signal but no good icon") — each kept individually, ranked last to
 * fill remaining slots, never clustered together.
 */
export function rankSignals(candidates: Candidate[], max: number): EmojiSignal[] {
  const byEmoji = new Map<string, Candidate[]>();
  const fallbacks: Candidate[] = [];
  for (const c of candidates) {
    if (c.emoji === FALLBACK_EMOJI) fallbacks.push(c);
    else (byEmoji.get(c.emoji) ?? byEmoji.set(c.emoji, []).get(c.emoji)!).push(c);
  }
  const ranked: EmojiSignal[] = [...byEmoji.entries()]
    .map(([emoji, group]) => ({
      emoji,
      count: group.length,
      keyword: mostCommon(group.map((g) => g.keyword)),
      excerpt: group.find((g) => g.excerpt)?.excerpt ?? "",
      sourceConvId: (group.find((g) => g.excerpt) ?? group[0]!).sourceConvId,
    }))
    .sort((a, b) => b.count - a.count);

  // de-dupe ✨ by keyword so distinct weak signals can still show
  const seenKw = new Set(ranked.map((r) => r.keyword));
  const extras: EmojiSignal[] = [];
  for (const f of fallbacks) {
    if (seenKw.has(f.keyword)) continue;
    seenKw.add(f.keyword);
    extras.push({ keyword: f.keyword, emoji: f.emoji, sourceConvId: f.sourceConvId, excerpt: f.excerpt, count: 1 });
  }
  return [...ranked, ...extras].slice(0, max);
}

/** Run an async fn over items with a bounded number in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

const DEFAULT_MAX = 20;
const DEFAULT_CONCURRENCY = 8;

/** Extract one conversation at a time (parallel), then frequency-rank to the top
 *  `max` signals. Returns the ranked set; reports progress per conversation. */
export async function extractEmojiPortrait(
  conversations: CanonicalConversation[],
  opts: EmojiPortraitOptions,
): Promise<EmojiSignal[]> {
  const max = opts.max ?? DEFAULT_MAX;
  const candidates: Candidate[] = [];
  const liveSeen = new Set<string>(); // emojis already shown provisionally
  let processed = 0;

  await pool(conversations, opts.concurrency ?? DEFAULT_CONCURRENCY, async (conv) => {
    if (opts.signal?.aborted) return;
    try {
      const raw = await opts.provider.complete(EMOJI_SYSTEM_PROMPT, buildEmojiUserPrompt(conv), {
        ...opts.config,
        maxTokens: opts.config?.maxTokens ?? 400,
      });
      const found = parseConvCandidates(raw, conv);
      candidates.push(...found);
      // Live fill: pop a real emoji in the moment it's first discovered. ✨ (weak)
      // signals wait for the final settle so the canvas shows the interesting ones.
      for (const c of found) {
        if (c.emoji === FALLBACK_EMOJI || liveSeen.has(c.emoji) || liveSeen.size >= max) continue;
        liveSeen.add(c.emoji);
        opts.onCandidate?.({ keyword: c.keyword, emoji: c.emoji, sourceConvId: c.sourceConvId, excerpt: c.excerpt });
      }
    } catch {
      // a failed conversation just doesn't contribute a vote — never fatal
    } finally {
      processed++;
      opts.onProgress?.(processed, conversations.length);
    }
  });

  if (opts.signal?.aborted) return [];
  return rankSignals(candidates, max);
}
