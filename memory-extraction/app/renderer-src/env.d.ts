/// <reference types="vite/client" />

export type Msg = { role: string; content: string };
export type ConvMeta = { id: string; title: string; source: string };
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
export type Fact = { id: string; text: string; from: string[] };
export type MemoriesDoc = {
  facts: Fact[];
  followups: string[];
  extractedAt: string | null;
  provider: string | null;
  processed?: number;
  error?: string;
};
export type Eligibility = { eligible: number; excluded: number; total: number };

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
      editFact(id: string, text: string): Promise<MemoriesDoc>;
      forgetFact(id: string): Promise<MemoriesDoc>;
    };
  }
}
