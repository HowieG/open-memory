import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyConversations, parseClassification } from "../src/memory/classify";
import { PROVIDERS } from "../src/memory/providers";
import type { CanonicalConversation } from "../src/schema";
import { ConversationStore } from "../src/store";

const conv = (id: string, title: string): CanonicalConversation => ({
  id,
  source: "claude",
  title,
  created_at: 1,
  messages: [{ role: "user", content: `about ${title}` }],
  source_metadata: {},
});

describe("parseClassification", () => {
  it("parses a fenced JSON array and coerces buckets", () => {
    const tags = parseClassification('```json\n[{"id":"a","sensitive":true,"category":"Money"},{"id":"b","sensitive":false,"category":"???"}]\n```');
    expect(tags).toEqual([
      { id: "a", sensitive: true, category: "Money" },
      { id: "b", sensitive: false, category: undefined },
    ]);
  });
  it("returns empty on garbage", () => {
    expect(parseClassification("no array here")).toEqual([]);
  });
});

describe("classifyConversations (stub provider)", () => {
  it("tags sensitive conversations and persists onto the index", async () => {
    const store = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-classify-")));
    await store.init();
    await store.upsert([conv("a", "Therapy session notes"), conv("b", "React performance")]);

    const tags = await classifyConversations(store, PROVIDERS.stub);

    expect(tags.find((t) => t.id === "a")?.sensitive).toBe(true);
    expect(tags.find((t) => t.id === "b")?.sensitive).toBe(false);
    // persisted onto the index entries
    const byId = Object.fromEntries(store.list().map((e) => [e.id, e]));
    expect(byId.a!.sensitive).toBe(true);
    expect(byId.b!.sensitive).toBe(false);
    expect(byId.b!.category).toBe("Work");
  });

  it("no-ops on an empty store", async () => {
    const store = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-classify-")));
    await store.init();
    expect(await classifyConversations(store, PROVIDERS.stub)).toEqual([]);
  });
});
