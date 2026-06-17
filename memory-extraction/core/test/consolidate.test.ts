import { describe, expect, it } from "vitest";
import { consolidateFacts, parseConsolidation } from "../src/memory/consolidate";
import type { KnowledgeFact } from "../src/memory/extractor";
import type { MemoryProvider } from "../src/memory/providers";
import { PROVIDERS } from "../src/memory/providers";

describe("parseConsolidation", () => {
  it("parses a fenced array and coerces buckets + sources", () => {
    const out = parseConsolidation('```json\n[{"text":"trains bjj","category":"Body","sensitive":false,"sources":[0,2]},{"text":"x","category":"nope","sensitive":true,"sources":["bad",1]}]\n```');
    expect(out).toEqual([
      { text: "trains bjj", category: "Body", sensitive: false, sources: [0, 2] },
      { text: "x", category: undefined, sensitive: true, sources: [1] },
    ]);
  });
  it("returns empty on garbage", () => {
    expect(parseConsolidation("no array")).toEqual([]);
  });
});

describe("consolidateFacts", () => {
  const facts: KnowledgeFact[] = [
    { text: "Builds a Chrome extension", from: ["a"], category: "Work", sensitive: false },
    { text: "Building a browser extension", from: ["b"], category: "Work", sensitive: false },
    { text: "Trains jiu-jitsu", from: ["c"], category: "Body", sensitive: false },
  ];

  it("returns the input unchanged for 0 or 1 facts (no call)", async () => {
    expect(await consolidateFacts([], PROVIDERS.stub)).toEqual([]);
    const one = [facts[0]!];
    expect(await consolidateFacts(one, PROVIDERS.stub)).toEqual(one);
  });

  it("stub is identity — preserves text, category, sensitive, provenance", async () => {
    const out = await consolidateFacts(facts, PROVIDERS.stub);
    expect(out).toHaveLength(3);
    expect(out.map((f) => f.text)).toEqual(facts.map((f) => f.text));
    expect(out.map((f) => f.category)).toEqual(["Work", "Work", "Body"]);
    expect(out[0]!.from).toEqual(["a"]);
  });

  it("merges facts and unions their provenance from source indices", async () => {
    const merger: MemoryProvider = {
      info: { id: "stub", label: "m", kind: "local", defaultModel: "x", configHint: "" },
      async complete() {
        return JSON.stringify([
          { text: "Builds a browser extension", category: "Work", sensitive: false, sources: [0, 1] },
          { text: "Trains jiu-jitsu", category: "Body", sensitive: false, sources: [2] },
        ]);
      },
    };
    const out = await consolidateFacts(facts, merger);
    expect(out).toHaveLength(2);
    expect(out[0]!.from.sort()).toEqual(["a", "b"]); // unioned provenance
    expect(out[0]!.category).toBe("Work");
    expect(out[1]!.from).toEqual(["c"]);
  });

  it("falls back to the input when the model returns nothing usable", async () => {
    const broken: MemoryProvider = {
      info: { id: "stub", label: "m", kind: "local", defaultModel: "x", configHint: "" },
      async complete() {
        return "sorry, no json";
      },
    };
    expect(await consolidateFacts(facts, broken)).toEqual(facts);
  });
});
