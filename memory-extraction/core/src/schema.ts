import { z } from "zod";

/**
 * Canonical conversation schema — the seam every source adapter converts into.
 *
 * Shape follows the de-facto OpenAI/mem0 `messages: [{role, content}]` convention
 * so it renders natively in assistant-ui (M2) and feeds the memory extractor.
 * v1 is TEXT-ONLY: `content` is a string (markdown), no multimodal content parts.
 *
 *   source export ──[adapter]──> CanonicalConversation ──> per-conversation file + index.json
 *                                                          └─> MemoryExtractionSource (downstream)
 */

/** Known source ids. `SourceId` is intentionally an open string — a new source
 *  is a new adapter, not a schema change. */
export const KNOWN_SOURCES = ["chatgpt", "claude", "gemini"] as const;
export type KnownSource = (typeof KNOWN_SOURCES)[number];
export type SourceId = string;

/** `tool` and `system` appear on-path in ChatGPT (browsing/python/dalle, custom
 *  instructions). Adapters decide which to keep; the type must be able to name them. */
export const RoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type Role = z.infer<typeof RoleSchema>;

export const CanonicalMessageSchema = z.object({
  role: RoleSchema,
  /** plain text / markdown — text-only in v1 */
  content: z.string(),
  /** epoch seconds when the source provides it */
  timestamp: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CanonicalMessage = z.infer<typeof CanonicalMessageSchema>;

export const CanonicalConversationSchema = z.object({
  /** source-native id (ChatGPT conversation_id, Claude uuid, Gemini content-hash) */
  id: z.string().min(1),
  source: z.string().min(1),
  title: z.string().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  messages: z.array(CanonicalMessageSchema),
  /** lossless bag of source-specific fields (ChatGPT's 11 pills, etc.) — drives viewer pills */
  source_metadata: z.record(z.string(), z.unknown()),
});
export type CanonicalConversation = z.infer<typeof CanonicalConversationSchema>;

/** One entry per conversation in index.json — small, drives the timeline + lazy-load. */
export const ConversationIndexEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string().optional(),
  created_at: z.number().optional(),
  /** relative path to the per-conversation file */
  file: z.string(),
  /** subset of source_metadata surfaced as pills (e.g. is_starred) */
  pills: z.record(z.string(), z.unknown()).optional(),
});
export type ConversationIndexEntry = z.infer<typeof ConversationIndexEntrySchema>;

/** The plain replacement for the scrapped OKF envelope. */
export const ExtractionManifestSchema = z.object({
  schema_version: z.string(),
  source: z.string(),
  ingested_at: z.string(),
  entry_count: z.number().int().nonnegative(),
  partial: z
    .object({
      ok: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      errors: z.array(z.object({ id: z.string().optional(), reason: z.string() })),
    })
    .optional(),
});
export type ExtractionManifest = z.infer<typeof ExtractionManifestSchema>;

export const SCHEMA_VERSION = "1.0.0";

/** Throws if `value` is not a valid CanonicalConversation. Used at the core boundary
 *  so a malformed adapter output fails loudly in tests, not silently downstream. */
export function assertCanonicalConversation(value: unknown): CanonicalConversation {
  return CanonicalConversationSchema.parse(value);
}
