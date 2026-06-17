/** Public entry point for the headless core — what the Electron app bundles. */
export { ingestZip } from "./pipeline";
export type { IngestResult } from "./pipeline";
export { renderConversationsHtml } from "./render";
export { detectSource, DetectionError } from "./sources/detect";
export { adapters } from "./sources/registry";
export { parseExportEmail, matchProvider } from "./email/parse";
export type { RawEmail, ParsedExportEmail } from "./email/parse";
export { EMAIL_PROVIDERS } from "./email/providers";
export type { EmailProvider, EmailProviderId, FetchStrategy } from "./email/providers";
export type { GmailClient, GmailMessageRef, GmailHistoryPage } from "./gmail/types";
export { GmailHistoryGoneError, GmailAuthRevokedError } from "./gmail/types";
export { ConversationStore } from "./store";
export { memoryExtractionSource, memoryEligibility, isEligibleForMemory } from "./memory-source";
export { PROVIDERS, rankProviders, heuristicTag } from "./memory/providers";
export type { ProviderId, ProviderInfo, ProviderConfig, MemoryProvider } from "./memory/providers";
export { extractMemories, parseExtraction, BUCKETS, toBucket } from "./memory/extractor";
export type { KnowledgeFact, ExtractedFact, ExtractionResult, ExtractOptions, Bucket } from "./memory/extractor";
export { classifyConversations, parseClassification, buildClassifyPrompt, CLASSIFY_SYSTEM_PROMPT } from "./memory/classify";
export type { ConversationTag } from "./memory/classify";
export { consolidateFacts, parseConsolidation, buildConsolidatePrompt, CONSOLIDATE_SYSTEM_PROMPT } from "./memory/consolidate";
export type { ConsolidatedFact } from "./memory/consolidate";
export {
  extractEmojiPortrait,
  chunkConversations,
  buildEmojiUserPrompt,
  parseEmojiItems,
  EMOJI_SYSTEM_PROMPT,
} from "./memory/emoji-portrait";
export type { EmojiSignal, EmojiPortraitOptions } from "./memory/emoji-portrait";
export {
  CURATED_EMOJI,
  FALLBACK_EMOJI,
  mapKeywordToEmoji,
  coerceEmoji,
  isAllowedEmoji,
} from "./memory/emoji-set";
export type {
  CanonicalConversation,
  CanonicalMessage,
  ConversationIndexEntry,
  ExtractionManifest,
  SourceId,
} from "./schema";
