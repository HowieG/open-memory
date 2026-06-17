import { describe, expect, it } from "vitest";
import { detectSource, DetectionError, sourceFromSignature } from "../src/sources/detect";

const HASH = "a34886-2026/";
const chatgptSharded = [
  `${HASH}conversations-000.json`,
  `${HASH}conversations-007.json`,
  `${HASH}chat.html`,
  `${HASH}user.json`,
];
const claude = ["conversations.json", "users.json", "memories.json", "projects/x.json"];
const gemini = ["Takeout/My Activity/Gemini Apps/MyActivity.json"];

describe("sourceFromSignature", () => {
  it("identifies ChatGPT from sharded conversations + chat.html", () => {
    expect(sourceFromSignature(chatgptSharded)).toBe("chatgpt");
  });

  it("identifies Claude from conversations.json + users.json", () => {
    expect(sourceFromSignature(claude)).toBe("claude");
  });

  it("identifies Gemini from the Takeout MyActivity path", () => {
    expect(sourceFromSignature(gemini)).toBe("gemini");
  });

  it("does NOT confuse Claude's conversations.json for ChatGPT", () => {
    // both have conversations.json; only ChatGPT has chat.html / shards / user.json
    expect(sourceFromSignature(claude)).not.toBe("chatgpt");
  });

  it("returns null for an unrecognized archive", () => {
    expect(sourceFromSignature(["random.txt", "notes/foo.md"])).toBeNull();
  });
});

describe("detectSource (prefix-primary, signature guard)", () => {
  it("uses the intake prefix when present", () => {
    expect(detectSource("CLAUDE_EXPORT_abc.zip", claude)).toBe("claude");
    expect(detectSource("OPENAI_EXPORT_abc.zip", chatgptSharded)).toBe("chatgpt");
    expect(detectSource("GEMINI_EXPORT_abc.zip", gemini)).toBe("gemini");
  });

  it("falls back to signature when no prefix", () => {
    expect(detectSource("export-uuid.zip", chatgptSharded)).toBe("chatgpt");
  });

  it("throws when prefix and contents disagree (mislabeled file)", () => {
    expect(() => detectSource("OPENAI_EXPORT_abc.zip", claude)).toThrow(DetectionError);
  });

  it("throws when nothing matches", () => {
    expect(() => detectSource("mystery.zip", ["random.txt"])).toThrow(DetectionError);
  });

  it("trusts the prefix even when the signature is null (UI declared the source)", () => {
    expect(detectSource("GEMINI_EXPORT_abc.zip", ["random.txt"])).toBe("gemini");
  });
});
