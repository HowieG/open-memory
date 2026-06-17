import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dirReader } from "../src/dir";
import { __test, chatgptAdapter } from "../src/sources/chatgpt/adapter";

const { flatten, extractText } = __test;

// Synthetic conversation: a linear thread with an off-path edit branch, a hidden
// system turn, a tool turn, and a multimodal_text message with an image pointer.
const conv = {
  conversation_id: "c1",
  title: "Test Conversation",
  create_time: 1719967409,
  current_node: "a2",
  is_starred: true,
  is_do_not_remember: false,
  default_model_slug: "gpt-4o",
  mapping: {
    root: { message: null, parent: null },
    sys: {
      message: {
        author: { role: "system" },
        content: { content_type: "text", parts: [""] },
        metadata: { is_visually_hidden_from_conversation: true },
      },
      parent: "root",
    },
    u1: {
      message: { author: { role: "user" }, content: { content_type: "text", parts: ["hello"] }, create_time: 1 },
      parent: "sys",
    },
    a1: {
      message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["hi there"] } },
      parent: "u1",
    },
    "a1-edit": {
      message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["DIFFERENT branch"] } },
      parent: "u1", // sibling of a1 — off the current_node path
    },
    u2: {
      message: {
        author: { role: "user" },
        content: {
          content_type: "multimodal_text",
          parts: ["look at this", { content_type: "image_asset_pointer", asset_pointer: "file-x" }],
        },
      },
      parent: "a1",
    },
    tool1: {
      message: { author: { role: "tool" }, content: { content_type: "text", parts: ["browse result"] } },
      parent: "u2",
    },
    a2: {
      message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["final answer"] } },
      parent: "tool1",
    },
  },
};

describe("chatgpt extractText (text-only)", () => {
  it("keeps string parts and drops image-pointer objects (no [object Object])", () => {
    const text = extractText({
      content_type: "multimodal_text",
      parts: ["look at this", { content_type: "image_asset_pointer" }],
    });
    expect(text).toBe("look at this");
    expect(text).not.toContain("object Object");
  });
});

describe("chatgpt flatten (mapping tree)", () => {
  const out = flatten(conv);

  it("walks current_node -> root and reverses to chronological order", () => {
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(out.messages[0]!.content).toBe("hello");
    expect(out.messages[3]!.content).toBe("final answer");
  });

  it("excludes off-path edit branches", () => {
    expect(JSON.stringify(out)).not.toContain("DIFFERENT branch");
  });

  it("drops hidden system and tool turns", () => {
    expect(out.messages.some((m) => m.role !== "user" && m.role !== "assistant")).toBe(false);
    expect(JSON.stringify(out)).not.toContain("browse result");
  });

  it("keeps multimodal string content, drops the image", () => {
    expect(out.messages[2]!.content).toBe("look at this");
  });

  it("preserves pills in source_metadata", () => {
    expect(out.source_metadata.is_starred).toBe(true);
    expect(out.source_metadata.is_do_not_remember).toBe(false);
    expect(out.source_metadata.default_model_slug).toBe("gpt-4o");
  });

  it("sets id, title, created_at", () => {
    expect(out.id).toBe("c1");
    expect(out.title).toBe("Test Conversation");
    expect(out.created_at).toBe(1719967409);
  });

  it("throws on a conversation with no id", () => {
    expect(() => flatten({ ...conv, conversation_id: undefined, id: undefined } as never)).toThrow();
  });
});

// Integration against the real fixture, skipped if it hasn't been generated.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "..", "..", "fixtures", "chatgpt");

describe.skipIf(!existsSync(FIXTURE))("chatgpt adapter (real fixture)", () => {
  it("parses the fixture into conversations with messages", async () => {
    const outcome = await chatgptAdapter.parse(dirReader(FIXTURE, "chatgpt"));
    expect(outcome.ok.length).toBeGreaterThan(0);
    expect(outcome.failed.length).toBe(0);
    for (const c of outcome.ok) {
      expect(c.source).toBe("chatgpt");
      expect(c.id).toBeTruthy();
      expect(c.messages.length).toBeGreaterThan(0);
      expect(c.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
    }
  });
});
