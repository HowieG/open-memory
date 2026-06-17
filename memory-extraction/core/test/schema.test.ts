import { describe, expect, it } from "vitest";
import {
  assertCanonicalConversation,
  CanonicalConversationSchema,
  RoleSchema,
} from "../src/schema";

const valid = {
  id: "conv-1",
  source: "claude",
  title: "hello",
  created_at: 1719967409,
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello there" },
  ],
  source_metadata: { summary: "a greeting" },
};

describe("CanonicalConversation schema", () => {
  it("accepts a valid conversation", () => {
    expect(() => assertCanonicalConversation(valid)).not.toThrow();
  });

  it("accepts the tool role (ChatGPT on-path turns)", () => {
    expect(RoleSchema.safeParse("tool").success).toBe(true);
  });

  it("rejects an unknown role", () => {
    const bad = { ...valid, messages: [{ role: "robot", content: "x" }] };
    expect(CanonicalConversationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing required field (id)", () => {
    const { id: _omit, ...noId } = valid;
    expect(CanonicalConversationSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects wrong type for content (must be a string, text-only)", () => {
    const bad = { ...valid, messages: [{ role: "user", content: ["parts"] }] };
    expect(CanonicalConversationSchema.safeParse(bad).success).toBe(false);
  });

  it("requires source_metadata (lossless bag, even if empty)", () => {
    const { source_metadata: _omit, ...noMeta } = valid;
    expect(CanonicalConversationSchema.safeParse(noMeta).success).toBe(false);
    expect(CanonicalConversationSchema.safeParse({ ...noMeta, source_metadata: {} }).success).toBe(
      true,
    );
  });
});
