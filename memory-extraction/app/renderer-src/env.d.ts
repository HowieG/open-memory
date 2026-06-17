/// <reference types="vite/client" />

export type Msg = { role: string; content: string };
export type ConvMeta = { id: string; title: string; source: string; sensitive?: boolean };
export type UploadResult = { source: string; count: number; failed: number; uploaded: ConvMeta[] };
export type ConvData = { id: string; title?: string; source: string; messages: Msg[] };

export type ProviderInfo = {
  id: string;
  label: string;
  kind: "api" | "local";
  source?: string;
  defaultModel: string;
  configHint: string;
};
export type Fact = { id: string; text: string; from: string[]; category?: string; sensitive?: boolean; date?: number };
export type MemoriesDoc = {
  facts: Fact[];
  followups: string[];
  extractedAt: string | null;
  provider: string | null;
  processed?: number;
  error?: string;
};
export type Eligibility = { eligible: number; excluded: number; total: number };
export type RateLimitInfo = { attempt: number; waitMs: number };

export type EmojiSignal = { keyword: string; emoji: string; sourceConvId: string; excerpt: string; count?: number };
export type EmojiProgress = { processed: number; total: number };
export type EmojiPortraitResult = { count: number; conversations: number; cached?: boolean } | { error: string };

type Ingest = UploadResult | { canceled: true } | { error: string };

declare global {
  interface Window {
    api: {
      pickAndIngest(): Promise<Ingest>;
      ingestPath(path: string): Promise<Ingest>;
      listConversations(): Promise<ConvMeta[]>;
      getConversationData(id: string): Promise<ConvData | { error: string }>;
      pathForFile(file: File): string;
      memoryEligibility(): Promise<Eligibility>;
      listProviders(): Promise<ProviderInfo[]>;
      getMemories(): Promise<MemoriesDoc>;
      extractMemories(providerId: string, config?: { apiKey?: string; endpoint?: string }, limit?: number): Promise<MemoriesDoc>;
      cancelExtract(): Promise<void>;
      onExtractProgress(cb: (processed: number) => void): () => void;
      onExtractRateLimit(cb: (info: RateLimitInfo) => void): () => void;
      onExtractPhase(cb: (phase: string) => void): () => void;
      editFact(id: string, text: string): Promise<MemoriesDoc>;
      forgetFact(id: string): Promise<MemoriesDoc>;
      setFactSensitive(id: string, sensitive: boolean): Promise<MemoriesDoc>;
      clearConversations(): Promise<{ ok: true }>;
      clearMemories(): Promise<{ ok: true }>;
      startEmojiPortrait(
        providerId: string,
        config?: { apiKey?: string; endpoint?: string },
        max?: number,
        force?: boolean,
      ): Promise<EmojiPortraitResult>;
      cancelEmojiPortrait(): Promise<void>;
      onEmojiSignal(cb: (sig: EmojiSignal) => void): () => void;
      onEmojiProgress(cb: (p: EmojiProgress) => void): () => void;
      onEmojiFinal(cb: (sigs: EmojiSignal[]) => void): () => void;
      sharePortrait(
        rect: { x: number; y: number; width: number; height: number },
        text?: string,
      ): Promise<{ ok: true } | { error: string }>;
    };
  }
}
