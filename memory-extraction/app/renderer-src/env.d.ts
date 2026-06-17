/// <reference types="vite/client" />

export type Msg = { role: string; content: string };
export type ConvMeta = { id: string; title: string; source: string };
export type UploadResult = { source: string; count: number; failed: number; uploaded: ConvMeta[] };
export type ConvData = { id: string; title?: string; source: string; messages: Msg[] };

type Ingest = UploadResult | { canceled: true } | { error: string };

declare global {
  interface Window {
    api: {
      pickAndIngest(): Promise<Ingest>;
      ingestPath(path: string): Promise<Ingest>;
      listConversations(): Promise<ConvMeta[]>;
      getConversationData(id: string): Promise<ConvData | { error: string }>;
      pathForFile(file: File): string;
    };
  }
}
