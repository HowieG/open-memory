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
  extractEmojiPortrait,
  parseConvCandidates,
  rankSignals,
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

/** Provider that answers per-conversation, keyed on the title in the prompt.
 *  A "THROW" value simulates a failed call for that conversation. */
function providerByTitle(map: Record<string, string>): MemoryProvider {
  return {
    info: { ...PROVIDERS.stub.info },
    async complete(_system, user) {
      const title = /Conversation title: "(.*?)"/.exec(user)?.[1] ?? "";
      const r = map[title] ?? "[]";
      if (r === "THROW") throw new Error("simulated call failure");
      return r;
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
    for (const e of ["🏍️", "💻", "🤖", FALLBACK_EMOJI]) expect(isAllowedEmoji(e)).toBe(true);
    expect(new Set(CURATED_EMOJI).size).toBe(CURATED_EMOJI.length); // no dupes
  });

  it("coerces an off-set emoji to the neutral fallback (never an accidental match)", () => {
    expect(coerceEmoji("🔠", "my motorcycle")).toBe(FALLBACK_EMOJI); // not curated -> ✨
    expect(coerceEmoji("💻", "coding")).toBe("💻"); // allowed -> kept
    expect(isAllowedEmoji("🔠")).toBe(false);
  });

  it("matches keywords on whole words, not substrings", () => {
    expect(mapKeywordToEmoji("uruguay flag identification")).toBe(FALLBACK_EMOJI); // not 🐈 from 'identifiCATion'
    expect(mapKeywordToEmoji("rain boots quality check")).toBe(FALLBACK_EMOJI); // not 🤖 from 'rAIn'
    expect(mapKeywordToEmoji("coffee tasting")).toBe("☕"); // real word match still works
  });
});

describe("buildEmojiUserPrompt (single conversation)", () => {
  it("includes the allowlist, title, and only user text", () => {
    const p = buildEmojiUserPrompt(conv("a", "Motorcycle", ["I rebuilt my carb"]));
    expect(p).toContain("ALLOWED emoji");
    expect(p).toContain("🏍️");
    expect(p).toContain('Conversation title: "Motorcycle"');
    expect(p).toContain("I rebuilt my carb");
    expect(p).not.toContain("how can I help"); // assistant text excluded
  });
});

describe("parseConvCandidates", () => {
  const c = conv("a", "A", ["t"]);

  it("parses a fenced array, coerces emoji, stamps the convId", () => {
    const raw =
      'Here:\n```json\n[{"keyword":"My Motorcycle","emoji":"🏍️","excerpt":"rebuilt the carb"},' +
      '{"keyword":"random thing","emoji":"🔠","excerpt":"x"}]\n```';
    const got = parseConvCandidates(raw, c);
    expect(got[0]).toEqual({ keyword: "my motorcycle", emoji: "🏍️", sourceConvId: "a", excerpt: "rebuilt the carb" });
    expect(got[1]!.emoji).toBe("✨"); // off-set -> neutral fallback, never a wrong guess
    expect(got[1]!.sourceConvId).toBe("a");
  });

  it("returns [] on empty array, garbage, or missing keyword", () => {
    expect(parseConvCandidates("[]", c)).toEqual([]);
    expect(parseConvCandidates("no json", c)).toEqual([]);
    expect(parseConvCandidates('[{"emoji":"💻"},{"keyword":"  "}]', c)).toEqual([]);
  });
});

describe("rankSignals (frequency)", () => {
  it("ranks emojis by how many conversations voted; keeps ✨ as weak extras", () => {
    const cand = (keyword: string, emoji: string, id: string) => ({ keyword, emoji, sourceConvId: id, excerpt: "" });
    const out = rankSignals(
      [
        cand("motorcycle", "🏍️", "1"),
        cand("moto", "🏍️", "2"),
        cand("bike build", "🏍️", "3"),
        cand("coding", "💻", "4"),
        cand("weird one", "✨", "5"),
      ],
      10,
    );
    expect(out[0]!.emoji).toBe("🏍️");
    expect(out[0]!.count).toBe(3); // 3 conversations -> strongest
    expect(out[1]!.emoji).toBe("💻");
    expect(out.at(-1)!.emoji).toBe("✨"); // weak signal ranked last, still shown
  });

  it("respects max and de-dupes ✨ by keyword", () => {
    const cand = (keyword: string, emoji: string) => ({ keyword, emoji, sourceConvId: "x", excerpt: "" });
    const out = rankSignals([cand("a", "✨"), cand("a", "✨"), cand("b", "✨")], 5);
    expect(out.map((s) => s.keyword)).toEqual(["a", "b"]); // dup ✨ keyword collapsed
  });
});

describe("extractEmojiPortrait (per-conversation, frequency-ranked)", () => {
  it("ranks a recurring theme above a one-off", async () => {
    const convs = [
      conv("m1", "Bike trip", ["riding my motorcycle up the coast"]),
      conv("m2", "Carb tuning", ["tuning the carb on my bike"]),
      conv("m3", "Garage day", ["cleaned the garage, worked on the moto"]),
      conv("c1", "Code help", ["help with this function"]),
    ];
    const provider = providerByTitle({
      "Bike trip": '[{"keyword":"motorcycle","emoji":"🏍️","excerpt":"riding"}]',
      "Carb tuning": '[{"keyword":"motorcycle","emoji":"🏍️","excerpt":"carb"}]',
      "Garage day": '[{"keyword":"moto","emoji":"🏍️","excerpt":"garage"}]',
      "Code help": '[{"keyword":"coding","emoji":"💻","excerpt":"fn"}]',
    });
    const got = await extractEmojiPortrait(convs, { provider, concurrency: 4 });
    expect(got[0]!.emoji).toBe("🏍️");
    expect(got[0]!.count).toBe(3); // recurring -> first
    expect(got[1]!.emoji).toBe("💻"); // one-off -> after
  });

  it("a failed conversation doesn't break the rest", async () => {
    const convs = [conv("a", "A", ["x"]), conv("b", "B", ["y"]), conv("c", "C", ["z"])];
    const provider = providerByTitle({
      A: '[{"keyword":"motorcycle","emoji":"🏍️","excerpt":"x"}]',
      B: "THROW",
      C: '[{"keyword":"coding","emoji":"💻","excerpt":"z"}]',
    });
    const got = await extractEmojiPortrait(convs, { provider, concurrency: 3 });
    expect(got.map((s) => s.emoji).sort()).toEqual(["🏍️", "💻"]);
  });

  it("respects max", async () => {
    const convs = [conv("a", "A", ["x"]), conv("b", "B", ["y"]), conv("c", "C", ["z"])];
    const provider = providerByTitle({
      A: '[{"keyword":"motorcycle","emoji":"🏍️","excerpt":"x"}]',
      B: '[{"keyword":"coding","emoji":"💻","excerpt":"y"}]',
      C: '[{"keyword":"running","emoji":"🏃","excerpt":"z"}]',
    });
    const got = await extractEmojiPortrait(convs, { provider, max: 2, concurrency: 3 });
    expect(got.length).toBe(2);
  });

  it("reports progress over the conversation set", async () => {
    const convs = [conv("a", "A", ["x"]), conv("b", "B", ["y"])];
    const provider = providerByTitle({ A: "[]", B: "[]" });
    let seen = 0;
    let total = 0;
    await extractEmojiPortrait(convs, {
      provider,
      concurrency: 2,
      onProgress: (p, t) => ((seen = Math.max(seen, p)), (total = t)),
    });
    expect(seen).toBe(2);
    expect(total).toBe(2);
  });

  it("returns [] when cancelled", async () => {
    const convs = [conv("a", "A", ["x"])];
    const provider = providerByTitle({ A: '[{"keyword":"x","emoji":"🏍️","excerpt":""}]' });
    const got = await extractEmojiPortrait(convs, { provider, signal: { aborted: true } });
    expect(got).toEqual([]);
  });
});

describe("extractEmojiPortrait with the offline stub (no network)", () => {
  it("produces a deterministic portrait from conversation titles", async () => {
    const convs = [
      conv("a", "Motorcycle carb tuning", ["how do I tune the carburetor on my bike"]),
      conv("b", "Learning to code", ["help me with this python function"]),
    ];
    const out = await extractEmojiPortrait(convs, { provider: PROVIDERS.stub, concurrency: 2 });
    expect(out.map((s) => s.emoji).sort()).toEqual(["🏍️", "💻"]);
    out.forEach((s) => expect(isAllowedEmoji(s.emoji)).toBe(true));
    const moto = out.find((s) => s.emoji === "🏍️")!;
    expect(moto.sourceConvId).toBe("a");
    expect(moto.excerpt).toContain("carburetor");
  });
});
