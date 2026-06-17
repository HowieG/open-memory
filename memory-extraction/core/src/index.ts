/** Public entry point for the headless core — what the Electron app bundles. */
export { ingestZip } from "./pipeline";
export type { IngestResult } from "./pipeline";
export { renderConversationsHtml } from "./render";
export { detectSource, DetectionError } from "./sources/detect";
export { adapters } from "./sources/registry";
export { ConversationStore } from "./store";
export { memoryExtractionSource, memoryEligibility, isEligibleForMemory } from "./memory-source";
export { PROVIDERS, rankProviders } from "./memory/providers";
export type { ProviderId, ProviderInfo, ProviderConfig, MemoryProvider } from "./memory/providers";
export { extractMemories, parseExtraction } from "./memory/extractor";
export type { KnowledgeFact, ExtractionResult, ExtractOptions } from "./memory/extractor";
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
