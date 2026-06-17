import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dirReader } from "../src/dir";
import { __test, claudeAdapter } from "../src/sources/claude/adapter";

const { flatten, messageText, epochSeconds } = __test;

const conv = {
  uuid: "u-1",
  name: "sst unlock command not found",
  summary: "debugging sst",
  account: { uuid: "acct-1" },
  created_at: "2026-03-06T03:48:13.385665Z",
  updated_at: "2026-03-06T08:17:15.590138Z",
  chat_messages: [
    { sender: "human", text: "sst unlock command not found", created_at: "2026-03-06T03:48:13.385665Z" },
    // .text empty -> fall back to content[] text blocks
    {
      sender: "assistant",
      text: "",
      content: [
        { type: "text", text: "Try `npx sst unlock`." },
        { type: "tool_use", name: "bash" }, // non-text block ignored
      ],
      created_at: "2026-03-06T03:49:00Z",
    },
    { sender: "system", text: "ignored" }, // unknown sender skipped
    { sender: "human", text: "   " }, // whitespace-only skipped
  ],
};

describe("claude messageText + epochSeconds", () => {
  it("prefers .text when present", () => {
    expect(messageText({ text: "hello", content: [{ type: "text", text: "other" }] })).toBe("hello");
  });
  it("falls back to content[] text blocks when .text is empty", () => {
    expect(messageText({ text: "", content: [{ type: "text", text: "from blocks" }] })).toBe("from blocks");
  });
  it("ignores non-text blocks", () => {
    expect(messageText({ content: [{ type: "tool_use" }, { type: "text", text: "kept" }] })).toBe("kept");
  });
  it("converts ISO to epoch seconds", () => {
    expect(epochSeconds("2026-03-06T03:48:13Z")).toBe(Math.floor(Date.parse("2026-03-06T03:48:13Z") / 1000));
    expect(epochSeconds("not-a-date")).toBeUndefined();
  });
});

describe("claude flatten", () => {
  const out = flatten(conv);

  it("maps sender to role in order", () => {
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  it("uses the content-block fallback for the assistant turn", () => {
    expect(out.messages[1]!.content).toBe("Try `npx sst unlock`.");
  });
  it("skips unknown senders and empty messages", () => {
    expect(out.messages.length).toBe(2);
    expect(JSON.stringify(out)).not.toContain("ignored");
  });
  it("sets id, title, epoch timestamps, and source_metadata", () => {
    expect(out.id).toBe("u-1");
    expect(out.title).toBe("sst unlock command not found");
    expect(out.source).toBe("claude");
    expect(typeof out.created_at).toBe("number");
    expect(out.source_metadata.summary).toBe("debugging sst");
  });
  it("throws on a conversation with no uuid", () => {
    expect(() => flatten({ ...conv, uuid: undefined } as never)).toThrow();
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "..", "..", "fixtures", "claude");

describe.skipIf(!existsSync(FIXTURE))("claude adapter (real fixture)", () => {
  it("parses the fixture into conversations with messages", async () => {
    const outcome = await claudeAdapter.parse(dirReader(FIXTURE, "claude"));
    expect(outcome.ok.length).toBeGreaterThan(0);
    expect(outcome.failed.length).toBe(0);
    for (const c of outcome.ok) {
      expect(c.source).toBe("claude");
      expect(c.id).toBeTruthy();
      expect(c.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
    }
  });
});
