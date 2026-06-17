import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalConversation } from "../src/schema";
import { ConversationStore } from "../src/store";

const conv = (id: string, created_at: number, title: string): CanonicalConversation => ({
  id,
  source: "claude",
  title,
  created_at,
  messages: [{ role: "user", content: `hi from ${id}` }],
  source_metadata: {},
});

const freshDir = () => mkdtempSync(path.join(tmpdir(), "om-store-"));

describe("ConversationStore", () => {
  it("upserts, lists chronologically, and lazy-gets by id", async () => {
    const store = new ConversationStore(freshDir());
    await store.init();
    await store.upsert([conv("b", 200, "Second"), conv("a", 100, "First")]);

    expect(store.size()).toBe(2);
    expect(store.list().map((e) => e.id)).toEqual(["a", "b"]); // sorted by created_at
    expect(store.list()[0]!.title).toBe("First");

    const got = await store.get("a");
    expect(got?.messages[0]!.content).toBe("hi from a");
    expect(await store.get("missing")).toBeNull();
  });

  it("persists across store instances (survives 'restart')", async () => {
    const dir = freshDir();
    const a = new ConversationStore(dir);
    await a.init();
    await a.upsert([conv("x", 1, "X")]);

    const b = new ConversationStore(dir);
    await b.init();
    expect(b.size()).toBe(1);
    expect((await b.get("x"))?.title).toBe("X");
  });

  it("upsert overwrites by id (newer wins)", async () => {
    const store = new ConversationStore(freshDir());
    await store.init();
    await store.upsert([conv("x", 1, "old")]);
    await store.upsert([conv("x", 1, "new")]);
    expect(store.size()).toBe(1);
    expect((await store.get("x"))?.title).toBe("new");
  });
});
