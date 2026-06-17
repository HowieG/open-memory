/** Public entry point for the headless core — what the Electron app bundles. */
export { ingestZip } from "./pipeline";
export type { IngestResult } from "./pipeline";
export { renderConversationsHtml } from "./render";
export { detectSource, DetectionError } from "./sources/detect";
export { adapters } from "./sources/registry";
export type {
  CanonicalConversation,
  CanonicalMessage,
  ExtractionManifest,
  SourceId,
} from "./schema";
