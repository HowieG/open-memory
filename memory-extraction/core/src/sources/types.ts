import type { Readable } from "node:stream";
import type { CanonicalConversation, SourceId } from "../schema";

/**
 * Read-in-place access to an export archive. Adapters never extract to disk —
 * they read the JSON entries they need directly from the zip (text-only means
 * we only ever need the conversation JSON, never the binary attachments).
 */
export interface ArchiveReader {
  /** the intake filename (carries the source prefix we assign) */
  readonly filename: string;
  /** all non-junk entry paths (no __MACOSX/, no directory entries) */
  entries(): Promise<string[]>;
  /** full text of the first entry matching `match` */
  readText(match: (entryPath: string) => boolean): Promise<string>;
  /** a stream of the first entry matching `match` (for streaming JSON parse, T2) */
  readStream(match: (entryPath: string) => boolean): Promise<Readable>;
}

/** Per-conversation failure isolation: one bad conversation never fails the whole ingest. */
export interface ConversationParseOutcome {
  ok: CanonicalConversation[];
  failed: { id?: string; reason: string }[];
}

/**
 * Every source (chatgpt, claude, gemini, and future email/browser-history) implements
 * this. Shared work — zip reading, validation, manifest + index + per-conversation file
 * writing, partial-failure capture — lives in the pipeline, NOT here. An adapter does
 * exactly one thing: source payload -> canonical conversations.
 */
export interface SourceAdapter {
  readonly id: SourceId;
  /**
   * Parse the export payload into canonical conversations, isolating per-conversation
   * failures into `outcome.failed` rather than throwing.
   */
  parse(reader: ArchiveReader): Promise<ConversationParseOutcome>;
}
