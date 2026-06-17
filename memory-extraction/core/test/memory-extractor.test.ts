import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractMemories, parseExtraction } from "../src/memory/extractor";
import { PROVIDERS, rankProviders } from "../src/memory/providers";
import type { CanonicalConversation } from "../src/schema";
import { ConversationStore } from "../src/store";

const conv = (id: string, created_at: number, title: string, dnr = false): CanonicalConversation => ({
  id,
  source: "claude",
  title,
  created_at,
  messages: [{ role: "user", content: `let's talk about ${title}` }],
  source_metadata: { is_do_not_remember: dnr },
});

describe("rankProviders (by uploaded conversation counts)", () => {
  it("orders providers by the count of their source, descending; local last", () => {
    const ranked = rankProviders({ chatgpt: 1300, claude: 552, gemini: 0 });
    expect(ranked.map((p) => p.id)).toEqual(["openai", "claude", "gemini", "ollama"]);
  });

  it("never exposes the internal stub", () => {
    expect(rankProviders({}).some((p) => p.id === "stub")).toBe(false);
  });
});

describe("parseExtraction", () => {
  it("parses legacy bare-string add[] (back-compat)", () => {
    const u = parseExtraction('Sure!\n```json\n{"add":["x"],"invalidate":[],"followups":["y?"]}\n```');
    expect(u.add.map((f) => f.text)).toEqual(["x"]);
    expect(u.followups).toEqual(["y?"]);
  });
  it("parses bucketed add[{text,category,sensitive}] and coerces unknown buckets", () => {
    const u = parseExtraction('{"add":[{"text":"trains jiu-jitsu","category":"Body","sensitive":false},{"text":"sees a therapist","category":"nope","sensitive":true}],"followups":[]}');
    expect(u.add).toEqual([
      { text: "trains jiu-jitsu", category: "Body", sensitive: false },
      { text: "sees a therapist", category: undefined, sensitive: true },
    ]);
  });
  it("returns empty on garbage", () => {
    expect(parseExtraction("no json here")).toEqual({ add: [], followups: [] });
  });
});

describe("extractMemories (stub provider, end-to-end)", () => {
  it("extracts a fact per eligible conversation, skipping do-not-remember", async () => {
    const store = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-ext-")));
    await store.init();
    await store.upsert([
      conv("b", 200, "React performance"),
      conv("secret", 150, "Private thing", true), // do-not-remember -> excluded
      conv("a", 100, "Postgres indexing"),
    ]);

    const result = await extractMemories(store, PROVIDERS.stub);

    expect(result.conversationsProcessed).toBe(2); // dnr excluded
    // parallel -> assert the set, not order
    expect(result.facts.map((f) => f.text).sort()).toEqual(["Discussed: Postgres indexing", "Discussed: React performance"]);
    expect(JSON.stringify(result)).not.toContain("Private thing");
  });

  it("caps to the most-recent N conversations", async () => {
    const store = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-ext-")));
    await store.init();
    await store.upsert([conv("a", 100, "A"), conv("b", 200, "B"), conv("c", 300, "C")]);

    const result = await extractMemories(store, PROVIDERS.stub, undefined, { limit: 2 });
    expect(result.conversationsProcessed).toBe(2);
    expect(result.facts.map((f) => f.text).sort()).toEqual(["Discussed: B", "Discussed: C"]); // newest two
  });

  it("reports progress and honors cancellation", async () => {
    const store = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-ext-")));
    await store.init();
    await store.upsert([conv("a", 1, "A"), conv("b", 2, "B"), conv("c", 3, "C")]);

    const progress: number[] = [];
    const full = await extractMemories(store, PROVIDERS.stub, undefined, { onProgress: (n) => progress.push(n) });
    expect(progress).toEqual([1, 2, 3]);
    expect(full.conversationsProcessed).toBe(3);

    const cancelled = await extractMemories(store, PROVIDERS.stub, undefined, { signal: { aborted: true } });
    expect(cancelled.conversationsProcessed).toBe(0);
  });
});
