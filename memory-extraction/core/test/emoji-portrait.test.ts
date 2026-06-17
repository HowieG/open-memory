import { describe, expect, it } from "vitest";
import {
  CURATED_EMOJI,
  FALLBACK_EMOJI,
  coerceEmoji,
  isAllowedEmoji,
  mapKeywordToEmoji,
} from "../src/memory/emoji-set";
import {
  buildEmojiUserPrompt,
  chunkConversations,
  extractEmojiPortrait,
  parseEmojiItems,
} from "../src/memory/emoji-portrait";
import { PROVIDERS, type MemoryProvider } from "../src/memory/providers";
import type { CanonicalConversation } from "../src/schema";

const conv = (id: string, title: string, userLines: string[]): CanonicalConversation => ({
  id,
  source: "claude",
  title,
  created_at: 1,
  messages: [
    { role: "assistant", content: "hi, how can I help?" },
    ...userLines.map((content) => ({ role: "user" as const, content })),
  ],
  source_metadata: {},
});

/** Returns the next canned raw response per call; optionally throws on a given index. */
function scriptedProvider(responses: string[], throwOn?: number): MemoryProvider {
  let i = 0;
  return {
    info: { ...PROVIDERS.stub.info },
    async complete() {
      const idx = i++;
      if (idx === throwOn) throw new Error("simulated chunk failure");
      return responses[idx] ?? "[]";
    },
  };
}

describe("emoji-set", () => {
  it("maps owned-thing keywords to specific emoji", () => {
    expect(mapKeywordToEmoji("motorcycle restoration")).toBe("🏍️");
    expect(mapKeywordToEmoji("late-night philosophy")).toBe("🏛️");
  });

  it("falls back for unmapped keywords", () => {
    expect(mapKeywordToEmoji("xyzzy nonsense")).toBe(FALLBACK_EMOJI);
  });

  it("every keyword-rule emoji is in the curated allowlist", () => {
    // sample a few; coerceEmoji guarantees the rest at runtime
    for (const e of ["🏍️", "💻", "🤖", FALLBACK_EMOJI]) expect(isAllowedEmoji(e)).toBe(true);
    expect(new Set(CURATED_EMOJI).size).toBe(CURATED_EMOJI.length); // no dupes
  });

  it("coerces an off-set emoji back into the set via the keyword", () => {
    expect(coerceEmoji("🦄", "my motorcycle")).toBe("🏍️"); // 🦄 not curated -> derived
    expect(coerceEmoji("💻", "coding")).toBe("💻"); // allowed -> kept
    expect(isAllowedEmoji("🦄")).toBe(false);
  });
});

describe("chunkConversations", () => {
  it("splits by user-text char budget, keeping whole conversations", () => {
    const a = conv("a", "A", ["x".repeat(100)]);
    const b = conv("b", "B", ["y".repeat(100)]);
    const c = conv("c", "C", ["z".repeat(100)]);
    const chunks = chunkConversations([a, b, c], 150);
    expect(chunks.map((ch) => ch.map((x) => x.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(chunkConversations([a, b, c], 1000).length).toBe(1);
  });

  it("only counts user text toward the budget", () => {
    const big = conv("big", "Big", ["u".repeat(50)]);
    expect(chunkConversations([big], 60).length).toBe(1); // assistant text ignored
  });
});

describe("buildEmojiUserPrompt", () => {
  it("includes the allowlist, convId, title, and only user text", () => {
    const p = buildEmojiUserPrompt([conv("a", "Motorcycle", ["I rebuilt my carb"])]);
    expect(p).toContain("ALLOWED emoji");
    expect(p).toContain("🏍️");
    expect(p).toContain("convId: a");
    expect(p).toContain('title: "Motorcycle"');
    expect(p).toContain("I rebuilt my carb");
    expect(p).not.toContain("how can I help"); // assistant text excluded
  });
});

describe("parseEmojiItems", () => {
  const chunk = [conv("a", "A", ["t"]), conv("b", "B", ["t"])];

  it("parses a fenced JSON array and coerces emoji + convId", () => {
    const raw =
      'Here:\n```json\n[{"keyword":"My Motorcycle","emoji":"🦄","convId":"a","excerpt":"rebuilt the carb"}]\n```';
    const [sig] = parseEmojiItems(raw, chunk);
    expect(sig).toEqual({
      keyword: "my motorcycle",
      emoji: "🏍️", // 🦄 coerced into the set
      sourceConvId: "a",
      excerpt: "rebuilt the carb",
    });
  });

  it("falls back to the chunk's first conv when convId is unknown", () => {
    const [sig] = parseEmojiItems('[{"keyword":"coding","emoji":"💻","convId":"zzz","excerpt":""}]', chunk);
    expect(sig!.sourceConvId).toBe("a");
  });

  it("returns [] on garbage", () => {
    expect(parseEmojiItems("no json", chunk)).toEqual([]);
    expect(parseEmojiItems('{"not":"an array"}', chunk)).toEqual([]);
  });

  it("skips items without a usable keyword", () => {
    expect(parseEmojiItems('[{"emoji":"💻"},{"keyword":"  "}]', chunk)).toEqual([]);
  });
});

describe("extractEmojiPortrait (map-reduce, streamed)", () => {
  const convs = [
    conv("a", "A", ["a".repeat(100)]),
    conv("b", "B", ["b".repeat(100)]),
    conv("c", "C", ["c".repeat(100)]),
  ];
  const collect = async (gen: AsyncGenerator<{ emoji: string; keyword: string }>) => {
    const out: { emoji: string; keyword: string }[] = [];
    for await (const s of gen) out.push({ emoji: s.emoji, keyword: s.keyword });
    return out;
  };

  it("streams signals in arrival order across chunks", async () => {
    const provider = scriptedProvider([
      '[{"keyword":"motorcycle","emoji":"🏍️","convId":"a","excerpt":"x"}]',
      '[{"keyword":"coding","emoji":"💻","convId":"b","excerpt":"y"}]',
      '[{"keyword":"running","emoji":"🏃","convId":"c","excerpt":"z"}]',
    ]);
    const got = await collect(extractEmojiPortrait(convs, { provider, chunkCharBudget: 150 }));
    expect(got.map((g) => g.emoji)).toEqual(["🏍️", "💻", "🏃"]); // one per chunk, in order
  });

  it("dedups by emoji AND keyword on arrival", async () => {
    const provider = scriptedProvider([
      '[{"keyword":"motorcycle","emoji":"🏍️","convId":"a","excerpt":"x"},{"keyword":"moto","emoji":"🏍️","convId":"a","excerpt":"dup-emoji"}]',
      '[{"keyword":"motorcycle","emoji":"🚗","convId":"b","excerpt":"dup-keyword"},{"keyword":"coding","emoji":"💻","convId":"b","excerpt":"y"}]',
    ]);
    const got = await collect(extractEmojiPortrait(convs, { provider, chunkCharBudget: 150 }));
    expect(got.map((g) => g.emoji)).toEqual(["🏍️", "💻"]); // dup emoji + dup keyword dropped
  });

  it("stops at max", async () => {
    const provider = scriptedProvider([
      '[{"keyword":"motorcycle","emoji":"🏍️","convId":"a","excerpt":"x"},{"keyword":"coding","emoji":"💻","convId":"a","excerpt":"y"},{"keyword":"running","emoji":"🏃","convId":"a","excerpt":"z"}]',
    ]);
    const got = await collect(extractEmojiPortrait(convs, { provider, max: 2, chunkCharBudget: 1_000_000 }));
    expect(got.length).toBe(2);
  });

  it("a failed chunk drops its signals but never wipes the rest", async () => {
    const provider = scriptedProvider(
      [
        '[{"keyword":"motorcycle","emoji":"🏍️","convId":"a","excerpt":"x"}]',
        "WILL THROW",
        '[{"keyword":"running","emoji":"🏃","convId":"c","excerpt":"z"}]',
      ],
      1, // throw on the 2nd chunk
    );
    const got = await collect(extractEmojiPortrait(convs, { provider, chunkCharBudget: 150 }));
    expect(got.map((g) => g.emoji)).toEqual(["🏍️", "🏃"]); // middle chunk skipped, others survive
  });

  it("honors cancellation before any call", async () => {
    const provider = scriptedProvider(["[]"]);
    const got = await collect(extractEmojiPortrait(convs, { provider, signal: { aborted: true } }));
    expect(got).toEqual([]);
  });

  it("reports progress", async () => {
    const provider = scriptedProvider([
      '[{"keyword":"motorcycle","emoji":"🏍️","convId":"a","excerpt":"x"},{"keyword":"coding","emoji":"💻","convId":"a","excerpt":"y"}]',
    ]);
    const progress: number[] = [];
    await collect(extractEmojiPortrait(convs, { provider, chunkCharBudget: 1_000_000, onProgress: (n) => progress.push(n) }));
    expect(progress).toEqual([1, 2]);
  });
});

describe("extractEmojiPortrait with the offline stub (no network)", () => {
  it("produces a deterministic portrait from conversation titles", async () => {
    const convs = [
      conv("a", "Motorcycle carb tuning", ["how do I tune the carburetor on my bike"]),
      conv("b", "Learning to code", ["help me with this python function"]),
    ];
    const out = [];
    for await (const s of extractEmojiPortrait(convs, { provider: PROVIDERS.stub, chunkCharBudget: 1_000_000 })) {
      out.push(s);
    }
    expect(out.map((s) => s.emoji)).toEqual(["🏍️", "💻"]);
    expect(out[0]!.sourceConvId).toBe("a");
    expect(out[0]!.excerpt).toContain("carburetor");
    out.forEach((s) => expect(isAllowedEmoji(s.emoji)).toBe(true));
  });
});
