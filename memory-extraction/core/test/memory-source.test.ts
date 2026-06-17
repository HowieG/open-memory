import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEligibleForMemory, memoryEligibility, memoryExtractionSource } from "../src/memory-source";
import type { CanonicalConversation } from "../src/schema";
import { ConversationStore } from "../src/store";

const conv = (id: string, created_at: number, doNotRemember = false): CanonicalConversation => ({
  id,
  source: "chatgpt",
  title: id,
  created_at,
  messages: [{ role: "user", content: "x" }],
  source_metadata: { is_do_not_remember: doNotRemember },
});

const store = async (...convs: CanonicalConversation[]) => {
  const s = new ConversationStore(mkdtempSync(path.join(tmpdir(), "om-mem-")));
  await s.init();
  await s.upsert(convs);
  return s;
};

describe("memory handoff", () => {
  it("isEligibleForMemory excludes do-not-remember", () => {
    expect(isEligibleForMemory(conv("a", 1, false))).toBe(true);
    expect(isEligibleForMemory(conv("b", 1, true))).toBe(false);
  });

  it("yields eligible conversations oldest-first, dropping do-not-remember", async () => {
    const s = await store(conv("c", 300), conv("dnr", 200, true), conv("a", 100));
    const ids: string[] = [];
    for await (const c of memoryExtractionSource(s)) ids.push(c.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("counts eligible vs excluded", async () => {
    const s = await store(conv("a", 1), conv("b", 2, true), conv("c", 3));
    expect(await memoryEligibility(s)).toEqual({ eligible: 2, excluded: 1, total: 3 });
  });
});
